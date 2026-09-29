import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertTestDatabase } from "./test-database";
import { bootstrap } from "../../apps/api/src/main";
import { db } from "../../apps/api/src/core";
import { passwordHash, passwordMatches } from "../../apps/api/src/auth";
import {
  prepareRegistrationTemplates,
  provisionRegisteredCenter,
} from "../../apps/api/src/tenant-provisioning";
import {
  registrationSchema,
  profileSchema,
} from "../../packages/contracts/src";

test("public self-registration isolates a complete unapproved center atomically", async (t) => {
  assertTestDatabase();
  process.env.PORT = "0";
  process.env.DEMO_ORIGIN = "http://localhost:3119";
  const app = await bootstrap();
  const base = await app.getUrl();
  const suffix = randomUUID();
  const input = (label: string) => ({
    legalForm: "TOO",
    ownNameRu: `Synthetic ${label} ${suffix}`,
    ownNameKz: "",
    displayName: "Synthetic administrator",
    email: `register-${label}-${suffix}@example.test`,
    password: "Synthetic-registration-password!",
  });
  const send = (
    path: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(base + path, {
      method,
      headers: {
        origin: process.env.DEMO_ORIGIN!,
        ...(body ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  const credentials = (response: Response, csrfToken: string) => ({
    cookie: response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; "),
    "x-csrf-token": csrfToken,
  });
  let first: {
    tenant: { id: string };
    user: { id: string; role: string };
    csrfToken: string;
  };
  let auth: Record<string, string>;
  try {
    await t.test(
      "origin, method, size and strict authority boundaries precede provisioning",
      async () => {
        assert.equal(
          (
            await send("/auth/register", "POST", input("origin"), {
              origin: "https://evil.invalid",
            })
          ).status,
          403,
        );
        assert.equal((await send("/auth/register")).status, 404);
        const injected = await send("/auth/register", "POST", {
          ...input("inject"),
          tenantId: "existing",
          role: "ADMIN",
          approved: true,
        });
        assert.equal(injected.status, 400);
        assert.equal(injected.headers.get("set-cookie"), null);
        assert.equal(
          (
            await send("/auth/register", "POST", {
              ...input("size"),
              ownNameRu: "x".repeat(9000),
            })
          ).status,
          413,
        );
        assert.equal(
          await db.user.count({ where: { email: input("inject").email } }),
          0,
        );
      },
    );
    await t.test(
      "creates ADMIN, private tenant, profile, all templates, sequences and session with approvals false",
      async () => {
        const response = await send("/auth/register", "POST", input("first"));
        assert.equal(response.status, 201, await response.clone().text());
        first = await response.json();
        auth = credentials(response, first.csrfToken);
        assert.equal(first.user.role, "ADMIN");
        assert.equal("passwordHash" in first.user, false);
        assert.match(auth.cookie, /demo_session=/);
        const tenant = await db.tenant.findUniqueOrThrow({
          where: { id: first.tenant.id },
        });
        assert.equal(tenant.demoOnly, false);
        const profiles = await db.issuerProfileVersion.findMany({
          where: { tenantId: tenant.id },
        });
        assert.equal(profiles.length, 1);
        const profile = profileSchema.parse(profiles[0].profile);
        assert.equal(profile.approved, false);
        assert.deepEqual(profile.commission, []);
        assert.equal(profile.nameRu, `ТОО ${input("first").ownNameRu}`);
        assert.equal(profile.nameKz, `${input("first").ownNameRu} ЖШС`);
        const templates = await db.templateVersion.findMany({
          where: { tenantId: tenant.id },
        });
        assert.equal(templates.length, 16);
        assert.ok(
          templates.every(
            (row) =>
              !row.approved && row.storageKey && row.checksum.length === 64,
          ),
        );
        assert.equal(
          await db.numberSequence.count({ where: { tenantId: tenant.id } }),
          11,
        );
        assert.equal(
          await db.session.count({
            where: { tenantId: tenant.id, userId: first.user.id },
          }),
          1,
        );
        assert.equal(
          (await send("/context", "GET", undefined, auth)).status,
          200,
        );
      },
    );
    await t.test(
      "duplicate email never moves existing user or changes password and returns no cookie",
      async () => {
        const original = await db.user.findUniqueOrThrow({
          where: { id: first.user.id },
        });
        const response = await send("/auth/register", "POST", {
          ...input("first"),
          email: input("first").email.toUpperCase(),
          password: "Different-password-123!",
          ownNameRu: `Replacement ${suffix}`,
        });
        assert.equal(response.status, 409);
        assert.equal(response.headers.get("set-cookie"), null);
        const after = await db.user.findUniqueOrThrow({
          where: { id: first.user.id },
        });
        assert.equal(after.tenantId, original.tenantId);
        assert.equal(after.passwordHash, original.passwordHash);
        assert.ok(
          await passwordMatches(input("first").password, after.passwordHash),
        );
        assert.equal(
          await db.tenant.count({
            where: { name: `ТОО Replacement ${suffix}` },
          }),
          0,
        );
      },
    );
    await t.test(
      "concurrent same-email requests produce one tenant and one session",
      async () => {
        const responses = await Promise.all([
          send("/auth/register", "POST", input("race")),
          send("/auth/register", "POST", input("race")),
        ]);
        assert.deepEqual(
          responses.map((response) => response.status).sort(),
          [201, 409],
        );
        assert.equal(
          await db.user.count({ where: { email: input("race").email } }),
          1,
        );
        assert.equal(
          await db.tenant.count({
            where: { name: `ТОО ${input("race").ownNameRu}` },
          }),
          1,
        );
        const raceUser = await db.user.findUniqueOrThrow({
          where: { email: input("race").email },
        });
        assert.equal(
          await db.session.count({ where: { userId: raceUser.id } }),
          1,
        );
      },
    );
    await t.test(
      "template insertion failure rolls back every tenant-owned database row",
      async () => {
        const templates = await prepareRegistrationTemplates();
        const data = registrationSchema.parse(input("rollback"));
        await assert.rejects(
          provisionRegisteredCenter(
            data,
            await passwordHash(data.password),
            [...templates, templates[0]],
            {
              token: randomUUID(),
              csrf: randomUUID(),
              correlationId: randomUUID(),
            },
          ),
          (error: unknown) => (error as { code: string }).code === "P2002",
        );
        assert.equal(await db.user.count({ where: { email: data.email } }), 0);
        assert.equal(
          await db.tenant.count({ where: { name: `ТОО ${data.ownNameRu}` } }),
          0,
        );
      },
    );
    await t.test(
      "unapproved setup allows drafts, blocks finalization and rejects another center profile",
      async () => {
        const secondResponse = await send(
          "/auth/register",
          "POST",
          input("second"),
        );
        assert.equal(secondResponse.status, 201);
        const second = await secondResponse.json();
        const secondAuth = credentials(secondResponse, second.csrfToken);
        const draftResponse = await send(
          "/print-requests",
          "POST",
          {
            kind: "PERSON",
            schemaVersion: 2,
            title: "Synthetic incomplete draft",
            items: [],
          },
          auth,
        );
        assert.equal(draftResponse.status, 201);
        const draft = await draftResponse.json();
        assert.equal(
          (
            await send(
              `/print-requests/${draft.id}`,
              "GET",
              undefined,
              secondAuth,
            )
          ).status,
          404,
        );
        const finalized = await send(
          `/print-requests/${draft.id}/finalize`,
          "POST",
          { expectedRevision: 0 },
          { ...auth, "idempotency-key": randomUUID() },
        );
        assert.equal(finalized.status, 422);
        assert.match(
          await finalized.text(),
          /PROFILE_NOT_APPROVED|PROFILE_UNAPPROVED|Реквизиты|реквизиты/,
        );
        const foreignProfile = await db.issuerProfileVersion.findFirstOrThrow({
          where: { tenantId: second.tenant.id },
        });
        assert.equal(
          (
            await send(
              "/print-requests",
              "POST",
              {
                kind: "PERSON",
                schemaVersion: 2,
                profileVersionId: foreignProfile.id,
                items: [],
              },
              auth,
            )
          ).status,
          404,
        );
      },
    );
    await t.test(
      "profile version preserves schedule and people without creating accounts or mutating prior version",
      async () => {
        const initial = await db.issuerProfileVersion.findFirstOrThrow({
          where: { tenantId: first.tenant.id },
        });
        const profile = profileSchema.parse(initial.profile);
        const input = {
          ...profile,
          headName: "Synthetic director",
          commission: [
            { name: "Chair", position: "Chair" },
            { name: "Member", position: "Teacher" },
          ],
          people: [
            {
              name: "Synthetic teacher",
              position: "Engineer",
              role: "TEACHER",
            },
            { name: "Synthetic signer", position: "Director", role: "SIGNER" },
          ],
          commonFields: {
            hours: "40",
            documentDate: "2026-09-29",
            trainingDateRule: {
              hoursPerDay: 8,
              hoursSource: "THEORY",
              calendar: "WEEKDAYS",
              anchor: "DOCUMENT_AFTER_TRAINING",
              protocolDate: "DOCUMENT_DATE",
              source: "Approved center schedule",
            },
          },
        };
        const response = await send("/settings/profile", "POST", input, auth);
        assert.equal(response.status, 201, await response.clone().text());
        const saved = await response.json();
        assert.equal(saved.version, 2);
        assert.notEqual(saved.id, initial.id);
        assert.deepEqual(saved.profile.commonFields, input.commonFields);
        assert.deepEqual(saved.profile.people, input.people);
        const current = await (
          await send("/context", "GET", undefined, auth)
        ).json();
        assert.equal(current.profileVersionId, saved.id);
        assert.deepEqual(current.profile.commonFields, input.commonFields);
        assert.deepEqual(
          (
            await db.issuerProfileVersion.findUniqueOrThrow({
              where: { id: initial.id },
            })
          ).profile,
          initial.profile,
        );
        assert.equal(
          await db.user.count({ where: { tenantId: first.tenant.id } }),
          1,
        );
      },
    );
    await t.test(
      "email limit cannot be bypassed with caller-supplied forwarding addresses",
      async () => {
        for (let attempt = 0; attempt < 2; attempt++)
          assert.equal(
            (
              await send("/auth/register", "POST", input("first"), {
                "x-forwarded-for": `198.51.100.${attempt}`,
              })
            ).status,
            409,
          );
        const blocked = await send("/auth/register", "POST", input("first"), {
          "x-forwarded-for": "203.0.113.50",
        });
        assert.equal(blocked.status, 429);
        assert.equal(blocked.headers.get("set-cookie"), null);
      },
    );
  } finally {
    await app.close();
    await db.$disconnect();
  }
});

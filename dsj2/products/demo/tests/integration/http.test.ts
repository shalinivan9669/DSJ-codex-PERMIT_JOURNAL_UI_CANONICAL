import { assertTestDatabase } from "./test-database";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { bootstrap } from "../../apps/api/src/main";
import { db } from "../../apps/api/src/core";
import { provision } from "../../scripts/setup";
import { passwordHash } from "../../apps/api/src/auth";
import { draftSchema } from "../../packages/contracts/src";
test("real Nest HTTP authentication, role revocation, CSRF, uploads and tenant boundary", async (t) => {
  assert.match(process.env.DATABASE_URL || "", /demo_test|demo_integration/);
  assertTestDatabase();
  process.env.PORT = "0";
  process.env.DEMO_ORIGIN = "http://localhost:3100";
  const app = await bootstrap();
  const base = await app.getUrl();
  assertTestDatabase();
  const suffix = randomUUID();
  const a = await provision({
    email: `http-a-${suffix}@example.test`,
    password: "Http-Only-Test-Password!",
    name: "HTTP A",
    sample: true,
  });
  const b = await provision({
    email: `http-b-${suffix}@example.test`,
    password: "Http-Only-Test-Password!",
    name: "HTTP B",
    sample: true,
  });
  let cookie = "",
    csrf = "";
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    override: Record<string, string> = {},
  ) =>
    fetch(base + path, {
      method,
      headers: {
        origin: "http://localhost:3100",
        cookie,
        "x-csrf-token": csrf,
        ...(body ? { "content-type": "application/json" } : {}),
        ...override,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    await t.test(
      "anonymous/old JWT/frozen route matrix before all auth",
      async () => {
        for (const bearer of ["", "Bearer old.dsj.jwt"]) {
          for (const path of [
            "/employees",
            "/v1/biot-cards/generate",
            "/signing/invites/test",
            "/protocols",
            "/courses",
            "/downloads/private",
          ])
            for (const method of ["GET", "POST", "DELETE"])
              assert.equal(
                (await call(path, method, undefined, { authorization: bearer }))
                  .status,
                404,
              );
          assert.equal(
            (
              await call("/context", "GET", undefined, {
                authorization: bearer,
              })
            ).status,
            401,
          );
        }
        assert.equal(
          (
            await call("/context", "GET", undefined, {
              "next-action": "oldAction",
            })
          ).status,
          404,
        );
      },
    );
    await t.test(
      "login, Origin and CSRF, logout invalidates persisted session",
      async () => {
        assert.equal(
          (
            await call(
              "/auth/login",
              "POST",
              { email: a.email, password: "Http-Only-Test-Password!" },
              { origin: "https://evil.example" },
            )
          ).status,
          403,
        );
        const response = await call("/auth/login", "POST", {
          email: a.email,
          password: "Http-Only-Test-Password!",
        });
        assert.equal(response.status, 201);
        const payload = await response.json();
        csrf = payload.csrfToken;
        cookie = response.headers
          .getSetCookie()
          .map((v) => v.split(";")[0])
          .join("; ");
        assert.equal((await call("/context")).status, 200);
        assert.equal(
          (
            await call(
              "/print-requests",
              "POST",
              { kind: "PERSON" },
              { "x-csrf-token": "wrong" },
            )
          ).status,
          403,
        );
      },
    );
    await t.test(
      "role changes revoke old session; viewer cannot mutate",
      async () => {
        const user = await db.user.create({
          data: {
            tenantId: a.tenantId,
            email: `viewer-${suffix}@example.test`,
            displayName: "Просмотр",
            role: "VIEWER",
            passwordHash: await passwordHash("Http-Only-Test-Password!"),
          },
        });
        const sessionResponse = await call("/auth/login", "POST", {
          email: user.email,
          password: "Http-Only-Test-Password!",
        });
        const session = await sessionResponse.json();
        const viewerCookie = sessionResponse.headers
          .getSetCookie()
          .map((v) => v.split(";")[0])
          .join("; ");
        assert.equal(
          (
            await call(
              "/print-requests",
              "POST",
              { kind: "PERSON" },
              { cookie: viewerCookie, "x-csrf-token": session.csrfToken },
            )
          ).status,
          403,
        );
        assert.equal(
          (await call(`/users/${user.id}`, "PATCH", { role: "OPERATOR" }))
            .status,
          200,
        );
        assert.equal(
          (await call("/context", "GET", undefined, { cookie: viewerCookie }))
            .status,
          401,
        );
        const relogin = await call("/auth/login", "POST", {
          email: user.email,
          password: "Http-Only-Test-Password!",
        });
        const operatorCookie = relogin.headers
          .getSetCookie()
          .map((v) => v.split(";")[0])
          .join("; ");
        assert.equal(
          (await call(`/users/${user.id}`, "PATCH", { disabled: true })).status,
          200,
        );
        assert.equal(
          (await call("/context", "GET", undefined, { cookie: operatorCookie }))
            .status,
          401,
        );
        assert.equal(
          (
            await call("/auth/login", "POST", {
              email: user.email,
              password: "Http-Only-Test-Password!",
            })
          ).status,
          401,
        );
      },
    );
    await t.test(
      "direct HTTP foreign request/photo/job denied with admin role",
      async () => {
        const foreign = await db.printRequest.create({
          data: {
            tenantId: b.tenantId,
            kind: "PERSON",
            draft: draftSchema.parse({ kind: "PERSON" }),
            createdBy: b.userId,
          },
        });
        assert.equal((await call(`/print-requests/${foreign.id}`)).status, 404);
        assert.equal(
          (
            await call(`/print-requests/${foreign.id}`, "PATCH", {
              expectedRevision: 0,
              draft: { kind: "PERSON" },
            })
          ).status,
          404,
        );
        const photo = await db.photoAsset.create({
          data: {
            tenantId: b.tenantId,
            ownerId: b.userId,
            storageKey: `scope-${randomUUID()}.png`,
            originalStorageKey: "scope-original.png",
            sha256: "test",
            size: 4,
            width: 1,
            height: 1,
          },
        });
        const profile = await db.issuerProfileVersion.findFirstOrThrow({
          where: { tenantId: b.tenantId },
        });
        const snapshot = await db.renderInputSnapshot.create({
          data: {
            tenantId: b.tenantId,
            requestId: foreign.id,
            revision: 0,
            profileVersionId: profile.id,
            input: {},
            inputHash: "scope",
          },
        });
        const job = await db.generationJob.create({
          data: {
            tenantId: b.tenantId,
            requestId: foreign.id,
            snapshotId: snapshot.id,
            kind: "DOCX",
            logicalKey: randomUUID(),
          },
        });
        const artifact = await db.artifact.create({
          data: {
            tenantId: b.tenantId,
            requestId: foreign.id,
            jobId: job.id,
            format: "DOCX",
            storageKey: `scope-${randomUUID()}.docx`,
            sha256: "scope",
            size: 4,
            mimeType: "application/octet-stream",
            fileName: "scope.docx",
            rendererVersion: "scope",
            inputHash: "scope",
          },
        });
        assert.equal((await call("/photos/" + photo.id)).status, 404);
        assert.equal((await call("/artifacts/" + artifact.id)).status, 404);
        assert.equal(
          (
            await call("/artifacts/" + artifact.id + "/restore", "POST", {
              reason: "Foreign reconstruction must be denied",
            })
          ).status,
          404,
        );
        assert.equal(
          (await call("/jobs/" + job.id + "/retry", "POST", {})).status,
          404,
        );
        assert.equal(
          (await (await call("/jobs?requestId=" + foreign.id)).json()).items
            .length,
          0,
        );
        assert.equal(
          (await (await call("/print-requests?search=" + foreign.id)).json())
            .total,
          0,
        );
        const template = await db.templateVersion.findFirstOrThrow({
          where: { tenantId: b.tenantId },
        });
        assert.equal(
          (
            await call(
              "/settings/templates/" + template.id + "/approve",
              "POST",
              { approved: true },
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await call("/print-requests/" + foreign.id + "/export", "POST", {
              format: "XLSX",
            })
          ).status,
          404,
        );
        // A single valid large request may exceed 1000 jobs; the scoped
        // progress endpoint must return all rows, without opening tenant A.
        await db.generationJob.createMany({
          data: Array.from({ length: 1000 }, () => ({
            tenantId: b.tenantId,
            requestId: foreign.id,
            snapshotId: snapshot.id,
            kind: "XLSX",
            logicalKey: randomUUID(),
          })),
        });
        const otherLogin = await call("/auth/login", "POST", {
          email: b.email,
          password: "Http-Only-Test-Password!",
        });
        const otherCookie = otherLogin.headers
          .getSetCookie()
          .map((v) => v.split(";")[0])
          .join("; ");
        const ownJobs = await (
          await call("/jobs?requestId=" + foreign.id, "GET", undefined, {
            cookie: otherCookie,
          })
        ).json();
        assert.equal(ownJobs.items.length, 1001);
        assert.equal(ownJobs.total, 1001);
        assert.equal(
          (await (await call("/jobs?requestId=" + foreign.id)).json()).total,
          0,
        );
      },
    );
    await t.test(
      "malformed image, unsupported XLSM, oversized JSON and errors have correlation id",
      async () => {
        const form = new FormData();
        form.append(
          "file",
          new Blob([Buffer.from("not an image")], { type: "image/png" }),
          "bad.png",
        );
        const response = await fetch(base + "/photos", {
          method: "POST",
          headers: {
            origin: "http://localhost:3100",
            cookie,
            "x-csrf-token": csrf,
          },
          body: form,
        });
        assert.equal(response.status, 400);
        assert.ok((await response.json()).correlationId);
        const imports = new FormData();
        imports.append("file", new Blob(["a"]), "macro.xlsm");
        assert.equal(
          (
            await fetch(base + "/imports/preview", {
              method: "POST",
              headers: {
                origin: "http://localhost:3100",
                cookie,
                "x-csrf-token": csrf,
              },
              body: imports,
            })
          ).status,
          400,
        );
        const large = await call("/print-requests", "POST", {
          kind: "PERSON",
          title: "X".repeat(2 * 1024 * 1024),
        });
        assert.equal(large.status, 413);
        assert.ok(large.headers.get("x-correlation-id"));
      },
    );
    await t.test(
      "password change and logout invalidate every session",
      async () => {
        const result = await call("/auth/password", "POST", {
          currentPassword: "Http-Only-Test-Password!",
          newPassword: "Changed-Http-Test-Password!",
        });
        assert.equal(result.status, 201);
        assert.equal((await call("/context")).status, 401);
        const logged = await call("/auth/login", "POST", {
          email: a.email,
          password: "Changed-Http-Test-Password!",
        });
        const data = await logged.json();
        cookie = logged.headers
          .getSetCookie()
          .map((v) => v.split(";")[0])
          .join("; ");
        csrf = data.csrfToken;
        assert.equal((await call("/auth/logout", "POST")).status, 201);
        assert.equal((await call("/context")).status, 401);
      },
    );
  } finally {
    await app.close();
    await db.$disconnect();
  }
});

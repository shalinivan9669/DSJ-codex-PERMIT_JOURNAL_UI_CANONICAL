import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { bootstrap } from "../../apps/api/src/main";
import { db, json } from "../../apps/api/src/core";
import {
  ArtifactStore,
  PRODUCT_ROOT,
  templateManifest,
} from "../../packages/printing/src";
import { registerLmsTemplates } from "../../scripts/maintenance/register-lms-templates";
import {
  lmsHttp,
  lmsJson,
  lmsLearner,
  lmsSession,
  lmsTenant,
} from "./lms-fixture";

test("S11: existing-center LMS template upgrade is append-only and actual HTTP approval preserves role, scope and byte validation", async (t) => {
  process.env.PORT = "0";
  process.env.DEMO_ORIGIN = "http://localhost:3159";
  const tenant = await lmsTenant("template upgrade old center");
  const foreign = await lmsTenant("template upgrade foreign");
  const learner = await lmsLearner(
    tenant.tenant.id,
    "template approval denied",
  );
  const store = new ArtifactStore();
  const manifest = await templateManifest();
  const legacy = manifest.templates.find((entry) => entry.id === "pb-card")!;
  assert.ok(legacy);
  const bytes = await readFile(
    join(PRODUCT_ROOT, "assets/templates", String(legacy.file)),
  );
  const stored = await store.put(bytes, "docx");
  const old = await db.templateVersion.create({
    data: {
      tenantId: tenant.tenant.id,
      templateId: String(legacy.id),
      version: String(legacy.version),
      storageKey: stored.storageKey,
      checksum: stored.sha256,
      contract: json(legacy),
      approved: true,
    },
  });
  const app = await bootstrap();
  const base = await app.getUrl();
  const director = lmsHttp(base, await lmsSession(base, tenant.user.email));
  const other = lmsHttp(base, await lmsSession(base, foreign.user.email));
  const learnerHttp = lmsHttp(base, await lmsSession(base, learner.user.email));
  const evidence: Record<string, unknown> = {
    fixtureVersion: "lms-existing-center-template-upgrade-v1",
    tenantId: tenant.tenant.id,
  };
  let passedCases = 0;
  try {
    const historical = await lmsJson(
      await director("/print-requests", "POST", {
        kind: "PERSON",
        schemaVersion: 2,
        title: "Synthetic retained ordinary manual result",
        items: [
          {
            id: randomUUID(),
            fullNameRu: "Синтетический прежний получатель",
            assignments: [
              {
                id: randomUUID(),
                templateId: "pb-card",
                outcome: { status: "FAILED", source: "MANUAL" },
                fieldOrigins: { outcome: "MANUAL" },
              },
            ],
          },
        ],
      }),
      201,
    );
    const historicalBefore = await db.printRequest.findUniqueOrThrow({
      where: { id: historical.id },
    });
    const numberingBefore = await db.numberSequence.findMany({
      where: { tenantId: tenant.tenant.id },
      orderBy: { namespace: "asc" },
    });
    let registered: Awaited<ReturnType<typeof db.templateVersion.findMany>> =
      [];
    await t.test(
      "dry-run is read-only; two concurrent applies add exactly three unapproved forms and preserve old bytes/data",
      async () => {
        const dry = await registerLmsTemplates(db, store, {
          tenantId: tenant.tenant.id,
        });
        assert.equal(dry.mode, "DRY_RUN");
        assert.equal(dry.created, 0);
        assert.equal(dry.pending, 3);
        assert.equal(
          await db.templateVersion.count({
            where: { tenantId: tenant.tenant.id },
          }),
          1,
        );
        const concurrent = await Promise.all([
          registerLmsTemplates(db, store, {
            tenantId: tenant.tenant.id,
            apply: true,
          }),
          registerLmsTemplates(db, store, {
            tenantId: tenant.tenant.id,
            apply: true,
          }),
        ]);
        assert.deepEqual(
          concurrent.map((value) => value.created).sort(),
          [0, 3],
        );
        assert.ok(concurrent.every((value) => value.oldRowsUnchanged));
        registered = await db.templateVersion.findMany({
          where: {
            tenantId: tenant.tenant.id,
            templateId: { startsWith: "lms-" },
          },
          orderBy: { templateId: "asc" },
        });
        assert.equal(registered.length, 3);
        assert.ok(registered.every((row) => !row.approved));
        for (const row of registered)
          assert.equal(
            createHash("sha256")
              .update(await store.read(row.storageKey, row.checksum))
              .digest("hex"),
            row.checksum,
          );
        assert.deepEqual(
          await db.templateVersion.findUniqueOrThrow({ where: { id: old.id } }),
          old,
        );
        assert.deepEqual(await store.read(old.storageKey, old.checksum), bytes);
        assert.deepEqual(
          await db.printRequest.findUniqueOrThrow({
            where: { id: historical.id },
          }),
          historicalBefore,
        );
        assert.deepEqual(
          await db.numberSequence.findMany({
            where: { tenantId: tenant.tenant.id },
            orderBy: { namespace: "asc" },
          }),
          numberingBefore,
        );
        assert.equal(
          await db.auditEvent.count({
            where: { tenantId: tenant.tenant.id, action: "TEMPLATE_APPROVAL" },
          }),
          0,
        );
        evidence.upgrade = {
          dryRunPending: dry.pending,
          concurrentCreated: concurrent.map((value) => value.created),
          newForms: registered.map(
            ({ id, templateId, checksum, approved }) => ({
              id,
              templateId,
              checksum,
              approved,
            }),
          ),
          oldTemplateHash: old.checksum,
          oldRequestUnchanged: true,
          oldNumberingUnchanged: true,
        };
        passedCases++;
      },
    );
    await t.test(
      "actual director approval works for all three LMS forms, audits the exact actor and denies learner/foreign scope",
      async () => {
        const approvalEvents = [];
        for (const row of registered) {
          assert.equal(
            (
              await learnerHttp(
                `/settings/templates/${row.id}/approve`,
                "POST",
                { approved: true },
              )
            ).status,
            403,
          );
          assert.equal(
            (
              await other(`/settings/templates/${row.id}/approve`, "POST", {
                approved: true,
              })
            ).status,
            404,
          );
          assert.equal(
            (
              await db.templateVersion.findUniqueOrThrow({
                where: { id: row.id },
              })
            ).approved,
            false,
          );
          const response = await director(
            `/settings/templates/${row.id}/approve`,
            "POST",
            { approved: true },
          );
          const approved = await lmsJson(response.clone(), 201);
          assert.equal(approved.id, row.id);
          assert.equal(approved.approved, true);
          assert.equal(approved.checksum, row.checksum);
          const correlationId = response.headers.get("x-correlation-id");
          assert.ok(correlationId);
          const events = await db.auditEvent.findMany({
            where: {
              tenantId: tenant.tenant.id,
              entityId: row.id,
              action: "TEMPLATE_APPROVAL",
              correlationId,
            },
          });
          assert.equal(events.length, 1);
          assert.equal(events[0].actorId, tenant.user.id);
          assert.deepEqual(events[0].metadata, {
            approved: true,
            source: "browser",
            requestSource: "browser",
            trustedIp: "127.0.0.1",
          });
          approvalEvents.push({
            templateId: row.templateId,
            eventId: events[0].id,
            actorId: events[0].actorId,
            correlationId,
          });
        }
        const again = await registerLmsTemplates(db, store, {
          tenantId: tenant.tenant.id,
          apply: true,
        });
        assert.equal(again.created, 0);
        assert.ok(again.templates.every((row) => row.approved));
        assert.equal(
          await db.templateVersion.count({
            where: { tenantId: tenant.tenant.id },
          }),
          4,
        );
        assert.deepEqual(
          await db.templateVersion.findUniqueOrThrow({ where: { id: old.id } }),
          old,
        );
        assert.deepEqual(
          await db.printRequest.findUniqueOrThrow({
            where: { id: historical.id },
          }),
          historicalBefore,
        );
        evidence.approval = {
          directorAccepted: 3,
          learnerDenied: 3,
          foreignDenied: 3,
          approvalEvents,
          repeatedUpgradePreservesApprovals: true,
        };
        passedCases++;
      },
    );
    await t.test(
      "unknown historical form and missing/corrupt private template bytes cannot be approved",
      async () => {
        const badBytes = await store.put(
          Buffer.from(`Synthetic corrupt template ${randomUUID()}`),
          "docx",
        );
        const denied = [
          {
            templateId: `historical-unsupported-${randomUUID()}`,
            storageKey: old.storageKey,
            checksum: old.checksum,
            code: "TEMPLATE_UNSUPPORTED",
          },
          {
            templateId: "lms-protocol",
            storageKey: `objects/00/missing-${randomUUID()}.docx`,
            checksum: "0".repeat(64),
            code: "TEMPLATE_UNAVAILABLE",
          },
          {
            templateId: "lms-certificate",
            storageKey: badBytes.storageKey,
            checksum: "0".repeat(64),
            code: "TEMPLATE_UNAVAILABLE",
          },
        ];
        const outcomes = [];
        for (const candidate of denied) {
          const row = await db.templateVersion.create({
            data: {
              tenantId: tenant.tenant.id,
              templateId: candidate.templateId,
              version: `negative-${randomUUID()}`,
              storageKey: candidate.storageKey,
              checksum: candidate.checksum,
              approved: false,
              contract: { syntheticNegativeFixture: true },
            },
          });
          const response = await lmsJson(
            await director(`/settings/templates/${row.id}/approve`, "POST", {
              approved: true,
            }),
            422,
          );
          assert.equal(response.code, candidate.code);
          assert.equal(
            (
              await db.templateVersion.findUniqueOrThrow({
                where: { id: row.id },
              })
            ).approved,
            false,
          );
          assert.equal(
            await db.auditEvent.count({
              where: {
                tenantId: tenant.tenant.id,
                entityId: row.id,
                action: "TEMPLATE_APPROVAL",
              },
            }),
            0,
          );
          outcomes.push({
            templateId: candidate.templateId,
            status: 422,
            code: response.code,
            approved: false,
          });
        }
        for (const row of registered) {
          assert.equal(
            createHash("sha256")
              .update(await store.read(row.storageKey, row.checksum))
              .digest("hex"),
            row.checksum,
          );
          assert.equal(
            (
              await db.templateVersion.findUniqueOrThrow({
                where: { id: row.id },
              })
            ).approved,
            true,
          );
        }
        assert.deepEqual(await store.read(old.storageKey, old.checksum), bytes);
        evidence.negativeApprovals = outcomes;
        passedCases++;
      },
    );
    assert.equal(
      passedCases,
      3,
      "No PASS report is written if any required subcase failed",
    );
    const folder = resolve(
      "docs/evidence/lms-one-run-20261015/agent-c/template-upgrade",
    );
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, "acceptance.json"),
      JSON.stringify(
        {
          status: "PASS",
          checkedAt: new Date().toISOString(),
          ...evidence,
          boundary:
            "Actual isolated PostgreSQL and Nest HTTP; no template approval bypass, renderer, production tenant or external service.",
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
    await db.$disconnect();
  }
});

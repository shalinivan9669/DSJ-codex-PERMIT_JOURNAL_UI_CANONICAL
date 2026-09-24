import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";
import { db, type Context } from "../../apps/api/src/core";
import {
  createRequest,
  finalize,
  validateRequest,
} from "../../apps/api/src/requests";
import { saveProfile } from "../../apps/api/src/settings";
import { provision } from "../setup";
import { draftSchema, commonFieldsSchema } from "../../packages/contracts/src";
import { ArtifactStore, PRODUCT_ROOT } from "../../packages/printing/src";
import {
  claimJob,
  executeJob,
  heartbeat,
  settleFailure,
} from "../../apps/render-worker/src/queue";
import { assertTestDatabase } from "../../tests/integration/test-database";

const output = join(PRODUCT_ROOT, "docs/evidence/operator-value/golden");
async function source(name: string) {
  return JSON.parse(
    await readFile(
      join(PRODUCT_ROOT, "tests/fixtures/operator-value", name),
      "utf8",
    ),
  );
}
async function golden(scenario: "G1" | "G2") {
  const start = performance.now();
  const seed = await provision({
    email: `golden-${scenario}-${randomUUID()}@example.test`,
    password: "Synthetic-Golden-Password!",
    name: `OT Center — ${scenario} — синтетические данные`,
    sample: true,
  });
  const c: Context = {
    ...seed,
    role: "ADMIN",
    sessionId: "test",
    csrfHash: "test",
    correlationId: randomUUID(),
  };
  const profile = await db.issuerProfileVersion.findFirstOrThrow({
    where: { tenantId: c.tenantId },
  });
  await saveProfile(c, {
    ...(profile.profile as object),
    commission: [
      { name: "Тестовый Председатель", position: "Председатель" },
      { name: "Тестовый Член Один", position: "Член комиссии" },
      { name: "Тестовый Член Два", position: "Член комиссии" },
    ],
  });
  const people = (await source("100_people.json")).people;
  const events = (await source("training_events.json")).events.filter(
    (e: any) => e.id.endsWith(scenario),
  );
  const results = (await source(`results_${scenario}.json`)).rows;
  // Source fixture omits the mandatory BIOT check type. This explicit synthetic
  // test supplement is not a product default or a legal rule.
  const mappedEvents = events.map((e: any) => ({
    id: randomUUID(),
    title: e.id,
    revision: 0,
    protocolTemplateId: e.groupProtocolTemplateFamily,
    commonFields: commonFieldsSchema.parse({
      ...Object.fromEntries(
        Object.entries(e).filter(
          ([k, v]) => k in commonFieldsSchema.shape && v !== null,
        ),
      ),
      ...(e.track === "BIOT" ? { biotCheckType: "PERIODIC" } : {}),
    }),
  }));
  const draft = draftSchema.parse({
    kind: "PERSON",
    schemaVersion: 2,
    title: `${scenario}: контрольный объём`,
    demoMode: true,
    events: mappedEvents,
    items: people.map((p: any) => {
      const { externalPersonKey, ...person } = p;
      return {
        ...person,
        id: externalPersonKey,
        externalId: externalPersonKey,
        assignments: events.flatMap((e: any, index: number) => {
          if (!e.externalPersonKeys.includes(externalPersonKey)) return [];
          const confirmed = results.find(
            (r: any) =>
              r.externalPersonKey === externalPersonKey && r.eventKey === e.id,
          );
          assert.ok(confirmed);
          return [
            {
              id: randomUUID(),
              templateId: e.credentialTemplateId,
              eventId: mappedEvents[index].id,
              protocolMode: "GROUP",
              result: confirmed.resultText,
              outcome: {
                status: confirmed.outcome,
                source: confirmed.evidenceKey,
              },
              fieldOrigins: Object.fromEntries(
                Object.keys(mappedEvents[index].commonFields).map((k) => [
                  k,
                  "INHERITED",
                ]),
              ),
            },
          ];
        }),
      };
    }),
  });
  const request = await createRequest(c, draft);
  const createdAt = performance.now();
  const validation = await validateRequest(c, request.id, {
    expectedRevision: 0,
  });
  await writeFile(
    join(output, `${scenario}-validation.json`),
    JSON.stringify(validation, null, 2),
  );
  assert.equal(validation.valid, true, JSON.stringify(validation.issues));
  const before = await db.numberSequence.findMany({
    where: { tenantId: c.tenantId },
  });
  const key = randomUUID();
  const result = await finalize(c, request.id, { expectedRevision: 0 }, key);
  const registeredAt = performance.now();
  assert.deepEqual(
    await finalize(c, request.id, { expectedRevision: 0 }, key),
    result,
  );
  const expected = (await source("EXPECTED_FIXTURES.json"))[scenario];
  const documents = await db.issuedDocument.findMany({
    where: { requestId: request.id },
  });
  const jobs = await db.generationJob.findMany({
    where: { requestId: request.id },
  });
  assert.equal(documents.length, expected.registeredDocuments);
  assert.equal(jobs.length, expected.canonicalJobsAndArtifacts);
  const after = await db.numberSequence.findMany({
    where: { tenantId: c.tenantId },
  });
  for (const [namespace, increment] of Object.entries(
    expected.namespaceIncrements,
  ))
    assert.equal(
      after.find((x) => x.namespace === namespace)!.value -
        before.find((x) => x.namespace === namespace)!.value,
      increment,
    );
  const store = new ArtifactStore();
  let completed = 0;
  const failures: Array<{ jobId: string; code: string }> = [];
  await Promise.all(
    Array.from({ length: 4 }, async (_, index) => {
      const owner = `golden-${scenario}-${index}-${randomUUID()}`;
      for (;;) {
        const job = await claimJob(db, owner, c.tenantId);
        if (!job) {
          const pending = await db.generationJob.count({
            where: {
              tenantId: c.tenantId,
              status: { in: ["PENDING", "RUNNING", "RETRY"] },
            },
          });
          if (!pending) break;
          await new Promise((r) => setTimeout(r, 750));
          continue;
        }
        const beat = setInterval(() => {
          void heartbeat(db, job, owner);
        }, 5000);
        try {
          await executeJob(db, store, job, owner, new AbortController().signal);
          completed++;
          if (completed % 40 === 0)
            console.log(`${scenario} generated ${completed}/${jobs.length}`);
        } catch (e) {
          await settleFailure(db, job, owner, e);
          if (e instanceof Error && e.name !== "DeferredJob")
            failures.push({
              jobId: job.id,
              code: e instanceof Error ? e.message : "ERROR",
            });
        } finally {
          clearInterval(beat);
        }
      }
    }),
  );
  const artifacts = await db.artifact.findMany({
    where: { requestId: request.id },
  });
  const finalJobs = await db.generationJob.findMany({
    where: { requestId: request.id },
  });
  const evidence = {
    scenario,
    synthetic: true,
    tenantId: c.tenantId,
    requestId: request.id,
    documents: documents.length,
    groupProtocols: documents.filter((d) => d.ownerKind === "GROUP").length,
    jobs: jobs.length,
    artifacts: artifacts.length,
    jobStates: finalJobs.reduce(
      (a, j) => ({ ...a, [j.status]: (a[j.status] || 0) + 1 }),
      {} as Record<string, number>,
    ),
    numberIncrements: after.map((a) => ({
      namespace: a.namespace,
      increment:
        a.value - before.find((b) => b.namespace === a.namespace)!.value,
    })),
    milliseconds: {
      create: createdAt - start,
      validateAndRegister: registeredAt - createdAt,
      generate: performance.now() - registeredAt,
      total: performance.now() - start,
    },
    failures,
    measurementScope:
      "Direct real API/worker execution. Not browser interaction time or customer pilot.",
    repeatedCommonFieldValuesInSourceRows: draft.items.reduce(
      (n, i) =>
        n +
        i.assignments.filter((a) => a.trainingSubject || a.documentDate).length,
      0,
    ),
    sourceResults: results.length,
    files: artifacts.map((a) => ({
      id: a.id,
      documentId: a.documentId,
      format: a.format,
      sha256: a.sha256,
      size: a.size,
    })),
  };
  await writeFile(
    join(output, `${scenario}.json`),
    JSON.stringify(evidence, null, 2),
  );
  const demoDir = join(output, scenario);
  await mkdir(demoDir, { recursive: true });
  for (const a of artifacts.filter(
    (a) =>
      a.format === "ZIP" ||
      a.format === "XLSX" ||
      documents.some((d) => d.ownerKind === "GROUP" && d.id === a.documentId),
  ))
    await copyFile(
      store.path(a.storageKey),
      join(demoDir, `${a.documentId || scenario}.${a.format.toLowerCase()}`),
    );
  assert.equal(artifacts.length, expected.canonicalJobsAndArtifacts);
  assert.ok(finalJobs.every((j) => j.status === "SUCCEEDED"));
  console.log(
    JSON.stringify({
      scenario,
      documents: documents.length,
      artifacts: artifacts.length,
      totalMs: evidence.milliseconds.total,
    }),
  );
}
async function main() {
  assertTestDatabase();
  await mkdir(output, { recursive: true });
  for (const scenario of ["G1", "G2"] as const)
    if (
      !process.env.DEMO_GOLDEN_SCENARIO ||
      process.env.DEMO_GOLDEN_SCENARIO === scenario
    )
      await golden(scenario);
}
main()
  .catch(async (error) => {
    await mkdir(output, { recursive: true });
    await writeFile(join(output, "failure.txt"), String(error.stack || error));
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

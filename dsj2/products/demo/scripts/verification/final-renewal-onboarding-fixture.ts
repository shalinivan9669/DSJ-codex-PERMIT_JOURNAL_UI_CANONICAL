import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { provision } from "../setup";
import { db, type Context } from "../../apps/api/src/core";
import {
  createRequest,
  finalize,
  validateRequest,
} from "../../apps/api/src/requests";
import { saveRecipient } from "../../apps/api/src/recipients";
import {
  createRenewalNeed,
  createExternalEvidence,
  verifyExternalEvidence,
} from "../../apps/api/src/operator-value";
import { assertTestDatabase } from "../../tests/integration/test-database";
import { ArtifactStore } from "../../packages/printing/src";
import {
  claimJob,
  executeJob,
  heartbeat,
  settleFailure,
  DeferredJob,
} from "../../apps/render-worker/src/queue";

const authPath = resolve(".runtime/final-renewal-onboarding-auth.json");
async function counts(tenantId: string) {
  const where = { tenantId };
  return {
    requests: await db.printRequest.count({ where }),
    customers: await db.customerOrganization.count({ where }),
    recipients: await db.recipient.count({ where }),
    orders: await db.serviceOrder.count({ where }),
    memberships: await db.employerMembership.count({ where }),
    reservations: await db.numberReservation.count({ where }),
    issuances: await db.issuance.count({ where }),
    serviceRules: await db.serviceRuleVersion.count({ where }),
    dossierRecords: await db.dossierRecord.count({ where }),
    contacts: await db.renewalContact.count({ where }),
  };
}
async function main() {
  assertTestDatabase();
  const mode = process.argv[2];
  if (mode === "provision") {
    const setupStarted = Date.now();
    const centers: Record<string, unknown> = {};
    for (const key of ["V06", "V10"]) {
      const email = `final-${key.toLowerCase()}-${randomUUID()}@example.test`;
      const password = `Synthetic-${randomUUID()}!`;
      const principal = await provision({
        email,
        password,
        name: `Синтетический финальный центр ${key}`,
        sample: true,
      });
      const c: Context = {
        ...principal,
        role: "ADMIN",
        sessionId: "fixture",
        csrfHash: "fixture",
        correlationId: randomUUID(),
      };
      const initialCounts = await counts(c.tenantId);
      assert.equal(initialCounts.requests, 0);
      assert.equal(initialCounts.customers, 0);
      assert.equal(initialCounts.orders, 0);
      assert.equal(initialCounts.memberships, 0);
      if (key === "V10") {
        centers[key] = {
          ...principal,
          email,
          password,
          initialCounts,
          setupPath: "scripts/setup.ts provision(sample:true)",
          demoOnly: true,
        };
        continue;
      }
      const fixture = JSON.parse(
        await readFile(
          resolve("tests/fixtures/operator-value/DAILY_WORKFLOWS.json"),
          "utf8",
        ),
      );
      const customer = await db.customerOrganization.create({
        data: {
          tenantId: c.tenantId,
          nameRu: "V06 — ДЕМО заказчик пяти состояний",
        },
      });
      const people = [];
      for (const source of fixture.people.slice(0, 5)) {
        const recipient = await saveRecipient(c, {
          id: randomUUID(),
          externalId: source.externalPersonKey,
          fullNameRu: source.fullNameRu,
          fullNameKz: source.fullNameKz,
          positionRu: source.positionRu,
          personnelNumber: source.personnelNumber,
          employerId: customer.id,
          workplaceRu: customer.nameRu,
          assignments: [],
        });
        people.push({
          key: source.externalPersonKey,
          recipientId: recipient.id,
          rowId: randomUUID(),
          assignmentId: randomUUID(),
          fullNameRu: source.fullNameRu,
          data: {
            fullNameRu: source.fullNameRu,
            fullNameKz: source.fullNameKz,
            positionRu: source.positionRu,
            personnelNumber: source.personnelNumber,
            workplaceRu: customer.nameRu,
          },
        });
      }
      const historical = await createRequest(c, {
        kind: "COMPANY",
        customerId: customer.id,
        demoMode: true,
        title: "V06 — пять сохранённых оснований",
        items: people.map((p) => ({
          ...p.data,
          id: p.rowId,
          recipientId: p.recipientId,
          employerId: customer.id,
          externalId: p.key,
          assignments: [
            {
              id: p.assignmentId,
              templateId: "pb-card",
              protocolMode: "EXTERNAL_REFERENCE",
              externalBasisNumber: `SYNTHETIC-V06-${p.key}`,
              documentDate: "2026-09-22",
              protocolDate: "2026-09-22",
              trainingStart: "2026-09-21",
              trainingEnd: "2026-09-22",
              trainingSubject: "Синтетическая программа ПБ",
              result: "Сдал",
              outcome: {
                status: "PASSED",
                source: "DAILY_WORKFLOWS синтетическая ведомость",
              },
            },
          ],
        })),
      });
      const validation = await validateRequest(c, historical.id, {
        expectedRevision: 0,
      });
      assert.deepEqual(validation.issues, []);
      await finalize(c, historical.id, { expectedRevision: 0 }, randomUUID());
      const needs = [];
      for (const p of people) {
        const need = await createRenewalNeed(c, {
          customerId: customer.id,
          recipientId: p.recipientId,
          sourceRequestId: historical.id,
          sourceRowId: p.rowId,
          assignmentId: p.assignmentId,
          policySource:
            "DAILY_WORKFLOWS V06: явная синтетическая проверка заказчика, срок следующей проверки неизвестен",
          policyVersion: "V06-exact-1",
          basisDate: "2026-09-22",
        });
        needs.push({ ...p, needId: need.id });
      }
      const external = await createExternalEvidence(c, {
        customerId: customer.id,
        recipientId: people[3].recipientId,
        program: "Синтетическая программа ПБ",
        issuer: "ДЕМО — другой центр",
        originalNumber: "SYNTHETIC-EXTERNAL-P004",
        documentDate: "2026-09-22",
        source: "SYNTHETIC_EXTERNAL_RECORD",
      });
      await verifyExternalEvidence(c, external.id, {
        status: "VERIFIED",
        verificationNote: "Синтетический источник явно проверен центром",
      });
      centers[key] = {
        ...principal,
        email,
        password,
        customerId: customer.id,
        customerName: customer.nameRu,
        historyId: historical.id,
        needs,
        externalEvidenceId: external.id,
        initialCounts,
        readyCounts: await counts(c.tenantId),
      };
    }
    await mkdir(resolve(".runtime"), { recursive: true });
    await writeFile(
      authPath,
      JSON.stringify({ ...centers, setupMs: Date.now() - setupStarted }),
    );
    console.log(
      JSON.stringify({ status: "READY", setupMs: Date.now() - setupStarted }),
    );
    return;
  }
  const all = JSON.parse(await readFile(authPath, "utf8"));
  const key = process.argv[3];
  assert.ok(key === "V06" || key === "V10");
  const auth = all[key];
  const tenant = await db.tenant.findUniqueOrThrow({
    where: { id: auth.tenantId },
  });
  assert.equal(tenant.demoOnly, true);
  assert.equal(tenant.name, `Синтетический финальный центр ${key}`);
  if (mode === "state") {
    console.log(JSON.stringify(await counts(auth.tenantId)));
    return;
  }
  assert.equal(mode, "drain");
  const id = process.argv[4];
  await db.printRequest.findFirstOrThrow({
    where: { id, tenantId: auth.tenantId },
  });
  const started = Date.now(),
    deadline = Date.now() + 240000,
    owner = `exact-${key}-${randomUUID()}`;
  const store = new ArtifactStore();
  let handled = 0;
  while (Date.now() < deadline) {
    const pending = await db.generationJob.findMany({
      where: {
        requestId: id,
        tenantId: auth.tenantId,
        status: { not: "SUCCEEDED" },
      },
    });
    if (!pending.length) {
      console.log(
        JSON.stringify({
          status: "PASS",
          requestId: id,
          handled,
          renderWorkerMs: Date.now() - started,
        }),
      );
      return;
    }
    assert.ok(pending.every((j) => j.status !== "FAILED"));
    const job = await claimJob(db, owner, auth.tenantId);
    if (!job) {
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    assert.equal(job.requestId, id);
    const beat = setInterval(() => {
      void heartbeat(db, job, owner);
    }, 5000);
    try {
      await executeJob(db, store, job, owner, new AbortController().signal);
      handled++;
    } catch (error) {
      await settleFailure(db, job, owner, error);
      if (!(error instanceof DeferredJob)) throw error;
    } finally {
      clearInterval(beat);
    }
  }
  throw new Error("EXACT_SCENARIO_RENDER_TIMEOUT");
}
void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

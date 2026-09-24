import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  access,
  realpath,
} from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { provision } from "../setup";
import { db, type Context } from "../../apps/api/src/core";
import { createRequest } from "../../apps/api/src/requests";
import { saveRecipient } from "../../apps/api/src/recipients";
import { ArtifactStore } from "../../packages/printing/src";
import { assertTestDatabase } from "../../tests/integration/test-database";
import {
  claimJob,
  executeJob,
  heartbeat,
  settleFailure,
  DeferredJob,
} from "../../apps/render-worker/src/queue";

const authPath = resolve(".runtime/final-history-ui-auth.json");
async function main() {
  assertTestDatabase();
  const mode = process.argv[2];
  if (mode === "provision") {
    const email = `final-history-${randomUUID()}@example.test`;
    const password = `Synthetic-${randomUUID()}!`;
    const principal = await provision({
      email,
      password,
      name: "Синтетическая проверка истории",
      sample: true,
    });
    const c: Context = {
      ...principal,
      role: "ADMIN",
      sessionId: "fixture",
      csrfHash: "fixture",
      correlationId: randomUUID(),
    };
    const personData = {
      id: randomUUID(),
      fullNameRu: "Синтетический Слушатель Истории",
      fullNameKz: "Синтетикалық Тыңдаушы",
      positionRu: "Инженер",
      positionKz: "Инженер",
      workplaceRu: "Тестовая организация",
      workplaceKz: "Сынақ ұйымы",
      assignments: [],
    };
    const person = await saveRecipient(c, personData);
    const draft = {
      kind: "PERSON",
      demoMode: true,
      title: "История: исходный синтетический выпуск",
      items: [
        {
          ...personData,
          id: randomUUID(),
          recipientId: person.id,
          assignments: [
            {
              id: randomUUID(),
              templateId: "pb-card",
              protocolMode: "EXTERNAL_REFERENCE",
              externalBasisNumber: "SYNTHETIC-HISTORY-2026-09",
              documentDate: "2026-09-24",
              protocolDate: "2026-09-24",
              trainingStart: "2026-09-23",
              trainingEnd: "2026-09-24",
              trainingSubject: "Синтетическая программа ПБ",
              result: "Сдал",
              outcome: {
                status: "PASSED",
                source: "Синтетическая ведомость истории",
              },
            },
          ],
        },
      ],
    };
    const original = await createRequest(c, draft);
    const duplicate = await createRequest(c, {
      ...draft,
      title: "Проверка возможного повтора",
      items: draft.items.map((row) => ({
        ...row,
        id: randomUUID(),
        assignments: row.assignments.map((a) => ({ ...a, id: randomUUID() })),
      })),
    });
    await mkdir(resolve(".runtime"), { recursive: true });
    await writeFile(
      authPath,
      JSON.stringify({
        email,
        password,
        ...principal,
        originalId: original.id,
        duplicateId: duplicate.id,
      }),
    );
    console.log(
      JSON.stringify({
        status: "READY",
        tenantId: principal.tenantId,
        originalId: original.id,
        duplicateId: duplicate.id,
      }),
    );
    return;
  }
  const auth = JSON.parse(await readFile(authPath, "utf8"));
  const tenant = await db.tenant.findUniqueOrThrow({
    where: { id: auth.tenantId },
  });
  assert.equal(tenant.demoOnly, true);
  assert.equal(tenant.name, "Синтетическая проверка истории");
  const id = process.argv[3];
  if (mode === "state") {
    console.log(
      JSON.stringify({
        requests: await db.printRequest.count({
          where: { tenantId: auth.tenantId },
        }),
        reservations: await db.numberReservation.count({
          where: { tenantId: auth.tenantId },
        }),
        jobs: await db.generationJob.count({
          where: { tenantId: auth.tenantId },
        }),
      }),
    );
    return;
  }
  assert.match(id || "", /^[a-f0-9-]{36}$/);
  const store = new ArtifactStore();
  if (mode === "drain") {
    await db.printRequest.findFirstOrThrow({
      where: { id, tenantId: auth.tenantId },
    });
    const owner = `history-ui-${randomUUID()}`;
    const deadline = Date.now() + 240000;
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
        console.log(JSON.stringify({ status: "PASS", requestId: id, handled }));
        return;
      }
      assert.ok(
        pending.every((job) => job.status !== "FAILED"),
        "History render failed",
      );
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
    throw new Error("HISTORY_RENDER_TIMEOUT");
  }
  assert.ok(mode === "lose" || mode === "restore");
  const artifact = await db.artifact.findFirstOrThrow({
    where: {
      id,
      tenantId: auth.tenantId,
      provenance: "ORIGINAL",
      format: "PDF",
    },
  });
  const original = store.path(artifact.storageKey);
  const held = original + ".history-drill-held";
  const root = await realpath(store.root);
  const pathToCheck = await realpath(mode === "lose" ? original : held);
  const inside = relative(root, pathToCheck);
  assert.ok(!inside.startsWith("..") && !isAbsolute(inside));
  assert.equal(
    await db.artifact.count({ where: { storageKey: artifact.storageKey } }),
    1,
  );
  const bytes = await readFile(pathToCheck);
  const { createHash } = await import("node:crypto");
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    artifact.sha256,
  );
  const destination = mode === "lose" ? held : original;
  await assert.rejects(access(destination));
  await rename(pathToCheck, destination);
  console.log(
    JSON.stringify({
      status: "PASS",
      mode,
      artifactId: id,
      preservedSha256: artifact.sha256,
    }),
  );
}
void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

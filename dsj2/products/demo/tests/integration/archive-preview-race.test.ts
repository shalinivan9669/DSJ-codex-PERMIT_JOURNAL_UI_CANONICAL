import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@demo/database";
import { db, type Context } from "../../apps/api/src/core";
import { provision } from "../../scripts/setup";
import { saveUser } from "../../apps/api/src/settings";
import {
  createRequest,
  deleteDraft,
  preview,
} from "../../apps/api/src/requests";
import { decideProposal } from "../../apps/api/src/approvals";
import { assertTestDatabase } from "./test-database";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("archive decision serializes with preview so a concurrent archive cannot enqueue a stale print set", async () => {
  assertTestDatabase();
  const center = await provision({
    email: `archive-race-${randomUUID()}@example.test`,
    password: "Synthetic-archive-race-password!",
    name: "Синтетический центр проверки архива",
    sample: true,
  });
  const director: Context = {
    tenantId: center.tenantId,
    userId: center.userId,
    role: "DIRECTOR",
    correlationId: randomUUID(),
    csrfHash: "synthetic",
    sessionId: "synthetic",
  };
  const user = await saveUser(director, {
    email: `archive-race-manager-${randomUUID()}@example.test`,
    password: "Synthetic-archive-race-password!",
    displayName: "Синтетический менеджер",
    role: "OPERATOR",
  });
  const manager = { ...director, userId: user.id, role: "OPERATOR" };
  const created = await createRequest(manager, {
    kind: "PERSON",
    demoMode: true,
    items: [
      {
        id: randomUUID(),
        employeeCategory: "WORKER",
        fullNameRu: "Синтетический Получатель Архив",
        fullNameKz: "Синтетический Получатель Архив",
        positionRu: "Монтажник",
        positionKz: "Монтажник",
        workplaceRu: "Синтетический работодатель",
        workplaceKz: "Синтетический работодатель",
        assignments: [
          {
            id: randomUUID(),
            templateId: "ptm-card",
            documentDate: "2026-10-02",
            protocolDate: "2026-10-02",
            trainingStart: "2026-09-29",
            trainingEnd: "2026-10-01",
            trainingSubject: "Синтетическая программа ПТМ",
            hours: "16",
            result: "Сдал",
            outcome: { status: "PASSED", source: "Синтетическая проверка" },
          },
        ],
      },
    ],
  });
  await decideProposal(director, created.approval.proposalId, {
    decision: "APPROVE",
    reason: "Синтетическая проверка",
    expectedProposalHash: created.approval.proposalHash,
  });
  const archive = await deleteDraft(manager, created.id);
  const archiveHoldingRow = deferred();
  const releaseArchive = deferred();
  const previewBackend = deferred<number>();
  const originalTransaction = db.$transaction;
  type Run = (tx: Prisma.TransactionClient) => Promise<unknown>;
  const transactionClient = db as unknown as {
    $transaction: (run: Run, options?: unknown) => Promise<unknown>;
  };
  const realTransaction = transactionClient.$transaction.bind(db);
  let invocation = 0;
  transactionClient.$transaction = (run, options) =>
    realTransaction(async (tx) => {
      const current = ++invocation;
      if (current === 2) {
        const [{ pid }] = await tx.$queryRaw<
          { pid: number }[]
        >`SELECT pg_backend_pid() AS pid`;
        previewBackend.resolve(pid);
      }
      if (current !== 1) return run(tx);
      let paused = false;
      // Pause after archive's FOR UPDATE has acquired the real PostgreSQL row
      // lock. Other transactions and every actual mutation still use PostgreSQL.
      const archivedTx = new Proxy(tx, {
        get(target, key) {
          if (key === "printRequest")
            return new Proxy(target.printRequest, {
              get(model, operation) {
                if (operation === "findFirst")
                  return async (
                    ...args: Parameters<typeof model.findFirst>
                  ) => {
                    const record = await model.findFirst(...args);
                    if (!paused) {
                      paused = true;
                      archiveHoldingRow.resolve();
                      await releaseArchive.promise;
                    }
                    return record;
                  };
                return Reflect.get(model, operation);
              },
            });
          return Reflect.get(target, key);
        },
      });
      return run(archivedTx);
    }, options);
  let archiveResult: Promise<unknown> | undefined;
  let previewResult: Promise<{ value?: unknown; error?: unknown }> | undefined;
  try {
    archiveResult = decideProposal(director, archive.approval.proposalId, {
      decision: "APPROVE",
      reason: "Синтетическая проверка параллельного архива",
      expectedProposalHash: archive.approval.proposalHash,
    });
    await archiveHoldingRow.promise;
    let previewSettled = false;
    previewResult = preview(manager, created.id, {
      expectedRevision: archive.revision,
    })
      .then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      )
      .finally(() => {
        previewSettled = true;
      });
    const pid = await previewBackend.promise;
    let blockedOnArchive = false;
    for (let attempt = 0; attempt < 100 && !previewSettled; attempt++) {
      const [activity] = await db.$queryRaw<
        { wait_event_type: string | null }[]
      >`
        SELECT wait_event_type FROM pg_stat_activity WHERE pid=${pid}`;
      if (activity?.wait_event_type === "Lock") {
        blockedOnArchive = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(
      blockedOnArchive,
      true,
      "Preview must wait on the archive row lock before checking request state",
    );
    releaseArchive.resolve();
    await archiveResult;
    const result = await previewResult;
    assert.equal(
      (
        result.error as { getResponse(): { code: string } } | undefined
      )?.getResponse().code,
      "REQUEST_ARCHIVED",
    );
    assert.ok(
      (await db.printRequest.findUniqueOrThrow({ where: { id: created.id } }))
        .archivedAt,
    );
    assert.equal(
      await db.generationJob.count({ where: { requestId: created.id } }),
      0,
    );
    assert.equal(
      await db.renderInputSnapshot.count({ where: { requestId: created.id } }),
      0,
    );
  } finally {
    releaseArchive.resolve();
    await Promise.allSettled([archiveResult, previewResult]);
    db.$transaction = originalTransaction;
    await db.$disconnect();
  }
});

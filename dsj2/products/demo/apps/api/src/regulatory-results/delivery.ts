import { createHmac, timingSafeEqual } from "node:crypto";

import type { Prisma } from "@demo/database";

import {
  dataAccessAllowed,
  dataAccessPolicySchema,
  type RegulatoryAdapter,
  type ProviderReceipt,
  type ProviderResponse,
} from "@demo/contracts/src/regulatory-results";

import { db, fail, hash, json, transaction } from "../core";

export function assertTestAdapterRuntime() {
  let url: URL;

  try {
    url = new URL(process.env.DATABASE_URL || "");
  } catch {
    throw new Error("TEST_ADAPTER_FORBIDDEN");
  }

  if (
    process.env.NODE_ENV === "production" ||
    process.env.DEMO_LMS_TEST_RUNTIME !== "1" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    !/^\/demo_test[a-zA-Z0-9_]*$/.test(url.pathname)
  )
    throw new Error("TEST_ADAPTER_FORBIDDEN");
}

async function connectionAllowed(
  tenantId: string,
  destination: string,
  tx: Prisma.TransactionClient = db,
) {
  const [connection, tenant] = await Promise.all([
    tx.integrationConnection.findUnique({
      where: { tenantId_destination: { tenantId, destination } },
    }),

    tx.tenant.findUnique({ where: { id: tenantId } }),
  ]);

  if (
    !tenant?.demoOnly ||
    !connection ||
    connection.state !== "SANDBOX" ||
    !connection.contractVersion
  )
    return false;

  const policy = dataAccessPolicySchema.safeParse(connection.dataAccessPolicy);

  return policy.success && dataAccessAllowed(policy.data);
}

export async function heartbeatDelivery(
  id: string,
  leaseToken: number,
  now = new Date(),
  leaseMs = 30_000,
) {
  return (
    (
      await db.integrationDelivery.updateMany({
        where: { id, leaseToken, state: "SENDING", lockedUntil: { gt: now } },
        data: { lockedUntil: new Date(now.getTime() + leaseMs) },
      })
    ).count === 1
  );
}

export async function claimDelivery(
  tenantId: string,
  destination: string,
  now = new Date(),
  leaseMs = 30_000,
) {
  assertTestAdapterRuntime();

  return transaction(async (tx) => {
    if (!(await connectionAllowed(tenantId, destination, tx))) return null;

    // A crashed sender might have reached the provider. Never turn it directly into READY.

    await tx.integrationDelivery.updateMany({
      where: {
        tenantId,
        destination,
        state: "SENDING",
        lockedUntil: { lte: now },
      },
      data: { state: "UNKNOWN", lockedUntil: null, availableAt: now },
    });

    const rows = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT d.id FROM "IntegrationDelivery" d JOIN "RegulatoryBatchItem" i ON i.id=d."batchItemId" JOIN "SanitaryJournalEntry" j ON j.id=i."journalEntryId" JOIN "VerifiedExamResult" r ON r.id=d."resultId" AND r."tenantId"=d."tenantId" WHERE r."examAt" IS NOT NULL AND d."tenantId"=${tenantId} AND d.destination=${destination} AND d.state IN ('READY','RETRY_WAIT','UNKNOWN','AWAITING_RECEIPT') AND d."availableAt"<=${now} AND (d."lockedUntil" IS NULL OR d."lockedUntil"<${now}) AND NOT EXISTS (SELECT 1 FROM "LmsResultEvent" e WHERE e."tenantId"=d."tenantId" AND e."resultId"=d."resultId" AND e.kind IN ('VOIDED','SUPERSEDED')) AND j."signatureState" IN ('NOT_REQUIRED','SIGNED') ORDER BY d."createdAt" FOR UPDATE OF d SKIP LOCKED LIMIT 1`;

    if (!rows.length) return null;

    const previous = await tx.integrationDelivery.findUniqueOrThrow({
      where: { id: rows[0].id },
    });

    const claimed = await tx.integrationDelivery.update({
      where: { id: previous.id },
      data: {
        state: "SENDING",
        lockedUntil: new Date(now.getTime() + leaseMs),
        leaseToken: { increment: 1 },
        attempts: { increment: 1 },
      },
    });

    return { ...claimed, previousState: previous.state };
  });
}

async function recordReceipt(
  tx: Prisma.TransactionClient,
  delivery: Awaited<ReturnType<typeof db.integrationDelivery.findFirstOrThrow>>,
  receipt: ProviderReceipt,
  lmkCapability: boolean,
) {
  if (
    receipt.correlationId !== delivery.correlationId ||
    receipt.payloadHash !== delivery.payloadHash ||
    !receipt.receiptId ||
    !receipt.externalId ||
    (delivery.externalId && delivery.externalId !== receipt.externalId)
  )
    fail(409, "RECEIPT_MISMATCH", "Ответ не соответствует записи");

  const receiptHash = hash(json(receipt));

  const existing = await tx.integrationReceipt.findUnique({
    where: {
      tenantId_deliveryId_receiptId: {
        tenantId: delivery.tenantId,
        deliveryId: delivery.id,
        receiptId: receipt.receiptId,
      },
    },
  });

  if (existing) {
    if (existing.payloadHash !== receiptHash)
      fail(
        409,
        "RECEIPT_REPLAY_CONFLICT",
        "Повторный ответ отличается от сохранённого",
      );

    return { replay: true };
  }

  if (
    ["ACCEPTED", "REJECTED"].includes(delivery.state) &&
    receipt.outcome !== delivery.state
  )
    fail(
      409,
      "RECEIPT_TERMINAL_CONFLICT",
      "Итоговый ответ требует отдельного уточнения",
    );

  await tx.integrationReceipt.create({
    data: {
      tenantId: delivery.tenantId,
      deliveryId: delivery.id,
      receiptId: receipt.receiptId,
      payloadHash: receiptHash,
      outcome: receipt.outcome,
      externalId: receipt.externalId,
      evidence: json(receipt.evidence),
    },
  });

  // A late receipt is retained but never resurrects a corrected/voided source.

  if (delivery.state !== "SUPERSEDED")
    await tx.integrationDelivery.update({
      where: { id: delivery.id },
      data: {
        state:
          receipt.outcome === "PENDING" ? "AWAITING_RECEIPT" : receipt.outcome,
        externalId: receipt.externalId,
        lmkState:
          receipt.outcome === "ACCEPTED" &&
          receipt.lmkConfirmed &&
          lmkCapability
            ? "CONFIRMED"
            : delivery.lmkState,
        lockedUntil: null,
        availableAt: new Date(Date.now() + 30_000),
        lastError: null,
      },
    });

  return { replay: false };
}

export async function applyDeliveryResponse(
  id: string,
  leaseToken: number,
  operation: string,
  response: ProviderResponse,
  adapter: RegulatoryAdapter,
  now = new Date(),
) {
  assertTestAdapterRuntime();

  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "IntegrationDelivery" WHERE id=${id} FOR UPDATE`;

    const delivery = await tx.integrationDelivery.findFirst({
      where: { id, leaseToken, state: "SENDING", lockedUntil: { gt: now } },
    });

    if (!delivery) return { stale: true };

    if (response.receipt)
      await recordReceipt(
        tx,
        delivery,
        response.receipt,
        adapter.capabilities.lmkConfirmation,
      );
    else {
      const status = response.transportStatus;

      const throttled = status === 429;

      const permanent = !!status && status >= 400 && status < 500 && !throttled;

      const state =
        permanent || delivery.attempts >= 8
          ? "NEEDS_REVIEW"
          : throttled
            ? "RETRY_WAIT"
            : status && status >= 200 && status < 300
              ? "AWAITING_RECEIPT"
              : "UNKNOWN";

      const delay = throttled
        ? Math.min(3600_000, Math.max(1000, response.retryAfterMs || 30_000))
        : Math.min(300_000, 1000 * 2 ** Math.min(delivery.attempts, 8));

      await tx.integrationDelivery.update({
        where: { id },
        data: {
          state,
          lockedUntil: null,
          externalId: response.externalId || delivery.externalId,
          availableAt: new Date(
            now.getTime() + delay + Math.floor(Math.random() * 500),
          ),
          lastError: permanent ? "PROVIDER_REJECTED_REQUEST" : null,
        },
      });
    }

    await tx.deliveryAttempt.create({
      data: {
        tenantId: delivery.tenantId,
        deliveryId: id,
        leaseToken,
        operation,
        outcome: response.receipt?.outcome || "TRANSPORT_ONLY",
        transportStatus: response.transportStatus,
      },
    });

    return { stale: false };
  });
}

export async function deliverOne(
  tenantId: string,
  destination: string,
  adapter: RegulatoryAdapter,
) {
  assertTestAdapterRuntime();

  if (adapter.environment !== "TEST")
    throw new Error("PROVIDER_CONTRACT_NOT_CONNECTED");

  const connection = await db.integrationConnection.findUnique({
    where: { tenantId_destination: { tenantId, destination } },
  });

  if (!connection || connection.contractVersion !== adapter.contractVersion)
    return false;

  const delivery = await claimDelivery(tenantId, destination);

  if (!delivery) return false;

  const unknown = ["UNKNOWN", "AWAITING_RECEIPT"].includes(
    delivery.previousState,
  );

  if (
    unknown &&
    !(adapter.capabilities.lookup && adapter.lookup) &&
    !adapter.capabilities.idempotentSubmit
  ) {
    await db.integrationDelivery.updateMany({
      where: {
        id: delivery.id,
        leaseToken: delivery.leaseToken,
        state: "SENDING",
      },
      data: {
        state: "NEEDS_REVIEW",
        lockedUntil: null,
        lastError: "RECONCILIATION_REQUIRED",
      },
    });

    return true;
  }

  const correction = (
    delivery.payload as { correction?: { supersedesResultId: string } }
  ).correction;
  const previous = correction
    ? await db.integrationDelivery.findFirst({
        where: {
          tenantId,
          destination,
          resultId: correction.supersedesResultId,
        },
      })
    : null;
  const needsCorrection =
    !!previous && (previous.attempts > 0 || !!previous.externalId);
  if (
    needsCorrection &&
    (!previous.externalId ||
      !adapter.capabilities.correction ||
      !adapter.correct)
  ) {
    await db.integrationDelivery.updateMany({
      where: {
        id: delivery.id,
        leaseToken: delivery.leaseToken,
        state: "SENDING",
      },
      data: {
        state: "NEEDS_REVIEW",
        lockedUntil: null,
        lastError: "CORRECTION_ROUTE_UNAVAILABLE",
      },
    });
    return true;
  }
  const operation =
    unknown && adapter.capabilities.lookup && adapter.lookup
      ? "LOOKUP"
      : needsCorrection
        ? "CORRECT"
        : "SUBMIT";

  const heartbeat = setInterval(() => {
    void heartbeatDelivery(delivery.id, delivery.leaseToken).catch(
      () => undefined,
    );
  }, 10_000);

  try {
    const response =
      operation === "LOOKUP" && adapter.lookup
        ? await adapter.lookup({
            correlationId: delivery.correlationId,
            externalId: delivery.externalId,
            payloadHash: delivery.payloadHash,
          })
        : operation === "CORRECT"
          ? await adapter.correct!({
              idempotencyKey: delivery.idempotencyKey,
              correlationId: delivery.correlationId,
              payloadHash: delivery.payloadHash,
              payload: delivery.payload,
              previousExternalId: previous!.externalId!,
            })
          : await adapter.submit({
              idempotencyKey: delivery.idempotencyKey,
              correlationId: delivery.correlationId,
              payloadHash: delivery.payloadHash,
              payload: delivery.payload,
            });

    await applyDeliveryResponse(
      delivery.id,
      delivery.leaseToken,
      operation,
      response,
      adapter,
    );
  } catch {
    await db.integrationDelivery.updateMany({
      where: {
        id: delivery.id,
        leaseToken: delivery.leaseToken,
        state: "SENDING",
      },
      data: {
        state: "UNKNOWN",
        lockedUntil: null,
        lastError: "OUTCOME_UNKNOWN",
        availableAt: new Date(Date.now() + 10_000),
      },
    });
  } finally {
    clearInterval(heartbeat);
  }

  return true;
}

/** Test contract only. No public production callback route is registered. */

export async function receiveTestCallback(
  input: {
    tenantId: string;
    destination: string;
    deliveryId: string;
    body: string;
    signature: string;
    secret: string;
    timestamp: number;
  },
  adapter: RegulatoryAdapter,
) {
  assertTestAdapterRuntime();

  if (adapter.environment !== "TEST")
    throw new Error("PROVIDER_CONTRACT_NOT_CONNECTED");

  if (
    input.secret.length < 32 ||
    Math.abs(Date.now() - input.timestamp) > 300_000 ||
    input.body.length > 100_000
  )
    fail(403, "CALLBACK_AUTH", "Ответ не подтверждён");

  const expected = createHmac("sha256", input.secret)
    .update(`${input.timestamp}.${input.body}`)
    .digest();

  const actual = Buffer.from(input.signature, "hex");

  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    fail(403, "CALLBACK_AUTH", "Ответ не подтверждён");

  if (!(await connectionAllowed(input.tenantId, input.destination)))
    fail(403, "CALLBACK_CONNECTION", "Подключение не настроено");

  const receipt = JSON.parse(input.body) as ProviderReceipt;

  if (!["PENDING", "ACCEPTED", "REJECTED", "UNKNOWN"].includes(receipt.outcome))
    fail(400, "CALLBACK_BODY", "Ответ не распознан");

  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "IntegrationDelivery" WHERE id=${input.deliveryId} FOR UPDATE`;

    const delivery = await tx.integrationDelivery.findFirst({
      where: {
        id: input.deliveryId,
        tenantId: input.tenantId,
        destination: input.destination,
        contractVersion: adapter.contractVersion,
      },
    });

    if (!delivery) fail(404, "NOT_FOUND", "Запись не найдена");

    return recordReceipt(
      tx,
      delivery,
      receipt,
      adapter.capabilities.lmkConfirmation,
    );
  });
}

import { randomUUID } from "node:crypto";
import { regulatoryProfileSchema, today } from "@demo/contracts";
import { db, transaction, hash, json, audit, type Context } from "../core";
import { preparationDeadline } from "./calendar";
import { assertEligibleResult } from "../lms/result-finalization";
import { assertLmsDeploymentAllowed } from "../lms/deployment-gate";

export async function claimPreparation(now = new Date(), leaseMs = 30_000) {
  return transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM "RegulatoryOutbox" WHERE status IN ('PENDING','PROCESSING') AND "availableAt"<=${now} AND ("lockedUntil" IS NULL OR "lockedUntil"<${now}) ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1`;
    if (!rows.length) return null;
    return tx.regulatoryOutbox.update({
      where: { id: rows[0].id },
      data: {
        status: "PROCESSING",
        leaseToken: { increment: 1 },
        lockedUntil: new Date(now.getTime() + leaseMs),
        attempts: { increment: 1 },
      },
    });
  });
}
export async function prepareClaimedEvent(
  id: string,
  leaseToken: number,
  now = new Date(),
) {
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "RegulatoryOutbox" WHERE id=${id} FOR UPDATE`;
    const event = await tx.regulatoryOutbox.findFirst({
      where: { id, status: "PROCESSING", leaseToken, lockedUntil: { gt: now } },
    });
    if (!event) return { stale: true };
    await assertLmsDeploymentAllowed(
      await tx.tenant.findUniqueOrThrow({ where: { id: event.tenantId } }),
    );
    await tx.$executeRaw`SELECT id FROM "VerifiedExamResult" WHERE id=${event.resultId} AND "tenantId"=${event.tenantId} FOR UPDATE`;
    const resultRecord = await tx.verifiedExamResult.findFirstOrThrow({
      where: { id: event.resultId, tenantId: event.tenantId },
    });
    const c: Context = {
      tenantId: event.tenantId,
      userId: "service:integration-worker",
      role: "SYSTEM",
      sessionId: "",
      csrfHash: "",
      correlationId: event.id,
      source: "integration-worker",
    };
    if (
      !resultRecord.eligible ||
      (await tx.lmsResultEvent.findFirst({
        where: {
          tenantId: c.tenantId,
          resultId: resultRecord.id,
          kind: { in: ["VOIDED", "SUPERSEDED"] },
        },
      }))
    ) {
      await tx.regulatoryOutbox.update({
        where: { id },
        data: { status: "CANCELLED", processedAt: now, lockedUntil: null },
      });
      return { cancelled: true };
    }
    const result = await assertEligibleResult(tx, c, event.resultId);
    const existing = await tx.regulatoryBatchItem.findUnique({
      where: {
        tenantId_resultId: { tenantId: c.tenantId, resultId: result.id },
      },
    });
    if (existing) {
      await tx.regulatoryOutbox.update({
        where: { id },
        data: { status: "DONE", processedAt: now, lockedUntil: null },
      });
      return { batchId: existing.batchId };
    }
    const snapshot = result.snapshot as Record<string, unknown>;
    const profile = regulatoryProfileSchema.parse(snapshot.profile);
    if (!profile.sanitary) {
      await tx.regulatoryOutbox.update({
        where: { id },
        data: { status: "CANCELLED", processedAt: now, lockedUntil: null },
      });
      return { cancelled: true };
    }
    const calendar = profile.calendarVersionId
      ? await tx.calendarVersion.findFirst({
          where: { id: profile.calendarVersionId, tenantId: c.tenantId },
        })
      : null;
    // Seal one immutable batch from ready events of this exact reviewed profile.
    // Competing workers may seal smaller batches; no worker appends to a sealed one.
    const pending = await tx.$queryRaw<
      Array<{ id: string; resultId: string }>
    >`SELECT o.id,o."resultId" FROM "RegulatoryOutbox" o JOIN "VerifiedExamResult" r ON r.id=o."resultId" AND r."tenantId"=o."tenantId" WHERE o."tenantId"=${c.tenantId} AND o.status='PENDING' AND o.kind='PREPARE' AND o."availableAt"<=${now} AND (o."lockedUntil" IS NULL OR o."lockedUntil"<${now}) AND r."regulatoryProfileVersionId"=${result.regulatoryProfileVersionId} AND r.eligible=true AND r.verdict='PASSED' AND r."assessmentKind"<>'PRACTICE' AND NOT EXISTS (SELECT 1 FROM "LmsResultEvent" e WHERE e."tenantId"=o."tenantId" AND e."resultId"=r.id AND e.kind IN ('VOIDED','SUPERSEDED')) AND NOT EXISTS (SELECT 1 FROM "RegulatoryBatchItem" i WHERE i."tenantId"=o."tenantId" AND i."resultId"=r.id) ORDER BY o."createdAt",o.id LIMIT 249 FOR UPDATE OF o,r SKIP LOCKED`;
    const selected = [{ id: event.id, resultId: result.id }, ...pending];
    const entries = [];
    for (const selectedEvent of selected) {
      const source =
        selectedEvent.id === event.id
          ? result
          : await assertEligibleResult(tx, c, selectedEvent.resultId);
      const frozen = source.snapshot as Record<string, unknown>;
      const deadline = preparationDeadline(
        source.examAt,
        calendar?.timezone === profile.timezone ? calendar : null,
        profile.cutoff,
      );
      const entrySnapshot = json({
        learner: frozen.learner,
        employer: frozen.employer,
        course: frozen.course,
        assignedAt: frozen.assignedAt,
        examAt: source.examAt,
        examDate: source.examAt ? today(profile.timezone, source.examAt) : null,
        reviewReasons: frozen.reviewReasons || [],
        verdict: source.verdict,
        score: source.score,
        maximum: source.maximum,
        assessmentKind: source.assessmentKind,
        source: frozen.source,
        resultId: source.id,
        resultRevision: source.revision,
        regulatoryProfileVersionId: source.regulatoryProfileVersionId,
        deadline: {
          ...deadline,
          basis: "INTERNAL_SLA",
          calendarVersionId: calendar?.id || null,
          timezone: profile.timezone,
          cutoff: profile.cutoff,
        },
        ...(frozen.correction ? { correction: frozen.correction } : {}),
      });
      entries.push({
        event: selectedEvent,
        source,
        deadline,
        snapshot: entrySnapshot,
      });
    }
    const earliest = entries
      .filter((entry) => entry.deadline.dueAt)
      .sort(
        (a, b) => a.deadline.dueAt!.getTime() - b.deadline.dueAt!.getTime(),
      )[0]?.deadline;
    const state = entries.some(
      (entry) => entry.deadline.state === "NEEDS_REVIEW",
    )
      ? "NEEDS_REVIEW"
      : "PREPARED";
    const batchSnapshot = json({
      version: 1,
      timezone: profile.timezone,
      cutoff: profile.cutoff,
      calendarVersionId: calendar?.id || null,
      basis: "INTERNAL_SLA",
      items: entries.map((entry) => entry.snapshot),
    });
    const batch = await tx.regulatoryBatch.create({
      data: {
        tenantId: c.tenantId,
        regulatoryProfileVersionId: result.regulatoryProfileVersionId,
        calendarVersionId: calendar?.id,
        destination: profile.destination,
        state,
        dueAt: earliest?.dueAt,
        dueDate: earliest?.dueDate,
        preparedAt: now,
        snapshot: batchSnapshot,
        snapshotHash: hash(batchSnapshot),
      },
    });
    for (const entry of entries) {
      const source = entry.source;
      const journal = await tx.sanitaryJournalEntry.create({
        data: {
          tenantId: c.tenantId,
          resultId: source.id,
          enrollmentId: source.enrollmentId,
          snapshot: entry.snapshot,
          snapshotHash: hash(entry.snapshot),
          signatureState: profile.requiresEmployeeSignature
            ? "AWAITING_SIGNATURE"
            : "NOT_REQUIRED",
        },
      });
      const item = await tx.regulatoryBatchItem.create({
        data: {
          tenantId: c.tenantId,
          batchId: batch.id,
          resultId: source.id,
          resultRevision: source.revision,
          journalEntryId: journal.id,
          snapshot: entry.snapshot,
          snapshotHash: hash(entry.snapshot),
        },
      });
      const idempotencyKey = hash({
        tenantId: c.tenantId,
        destination: profile.destination,
        resultId: source.id,
        revision: source.revision,
      });
      await tx.integrationDelivery.create({
        data: {
          tenantId: c.tenantId,
          batchItemId: item.id,
          resultId: source.id,
          resultRevision: source.revision,
          destination: profile.destination,
          idempotencyKey,
          correlationId: randomUUID(),
          payload: entry.snapshot,
          payloadHash: hash(entry.snapshot),
        },
      });
      await tx.regulatoryOutbox.update({
        where: { id: entry.event.id },
        data: { status: "DONE", processedAt: now, lockedUntil: null },
      });
    }
    await audit(tx, c, "SANITARY_PREPARED", batch.id, {
      resultIds: entries.map((entry) => entry.source.id),
      count: entries.length,
      calendarVersionId: calendar?.id || null,
      deadlineState: state,
    });
    return { batchId: batch.id };
  });
}
export async function preparationTick() {
  const event = await claimPreparation();
  if (!event) return false;
  try {
    await prepareClaimedEvent(event.id, event.leaseToken);
  } catch {
    await db.regulatoryOutbox.updateMany({
      where: {
        id: event.id,
        leaseToken: event.leaseToken,
        status: "PROCESSING",
      },
      data: {
        status: event.attempts >= 8 ? "NEEDS_REVIEW" : "PENDING",
        lockedUntil: null,
        availableAt: new Date(
          Date.now() +
            Math.min(300_000, 1000 * 2 ** event.attempts) +
            Math.floor(Math.random() * 500),
        ),
      },
    });
    throw new Error("SANITARY_PREPARATION_FAILED");
  }
  return true;
}

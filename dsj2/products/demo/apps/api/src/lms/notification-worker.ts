import { randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
import { Prisma, type LmsNotificationEvent } from "@demo/database";
import {
  courseContentSchema,
  regulatoryProfileSchema,
} from "@demo/contracts/src/lms";
import { db, audit, transaction, type Context } from "../core";
import { assertFinalAdmission } from "./final-admission";
import { enqueueEnrollmentNotification } from "./notification-events";
import { notificationVisibilitySql } from "./notifications";

export function reminderThreshold(
  date: string | null,
  now: Date,
  timezone: string,
): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(date + "T00:00:00Z");
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  )
    return null;
  const civil = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const days = Math.round(
    (Date.parse(date + "T00:00:00Z") - Date.parse(civil + "T00:00:00Z")) /
      86400000,
  );
  if (!Number.isFinite(days)) return null;
  if (days < 0) return 0;
  return [7, 30, 60, 90].find((n) => days <= n) ?? null;
}
function workerContext(
  tenantId: string,
  userId: string,
  role: string,
): Context {
  return {
    tenantId,
    userId,
    role,
    sessionId: "",
    csrfHash: "",
    correlationId: randomUUID(),
    source: "notification-worker",
  };
}
/** Each scan is bounded; a persisted cursor resumes after a stopped process. */
export async function scanLearningNotifications(now = new Date()) {
  await db.$executeRaw`INSERT INTO "LmsNotificationCheckpoint" ("tenantId","activatedAt","enrollmentCursor") SELECT id,"createdAt",'' FROM "Tenant" WHERE active ON CONFLICT ("tenantId") DO NOTHING`;
  return transaction(async (tx) => {
    const checkpoints = await tx.$queryRaw<
      {
        tenantId: string;
        activatedAt: Date;
        enrollmentCursor: string;
        timezone: string;
      }[]
    >`SELECT c.*,t.timezone FROM "LmsNotificationCheckpoint" c JOIN "Tenant" t ON t.id=c."tenantId" AND t.active ORDER BY c."scannedAt" ASC NULLS FIRST,c."tenantId" LIMIT 1 FOR UPDATE OF c SKIP LOCKED`;
    const checkpoint = checkpoints[0];
    if (!checkpoint) return 0;
    const { tenantId, activatedAt } = checkpoint;
    await tx.$executeRaw(Prisma.sql`INSERT INTO "LmsNotificationEvent" (id,"tenantId","userId","sourceType","sourceId",kind,"deliveryKey","titleRu","titleKz",href)
      SELECT gen_random_uuid()::text,u."tenantId",u.id,'ACCOUNT',u.id,'REGISTERED','REGISTERED:'||u.id,'Регистрация завершена','Тіркелу аяқталды','/lms/profile' FROM "User" u WHERE u."tenantId"=${tenantId} AND u.active AND u."createdAt">=${activatedAt} AND NOT EXISTS(SELECT 1 FROM "LmsNotificationEvent" e WHERE e."tenantId"=u."tenantId" AND e."userId"=u.id AND e."deliveryKey"='REGISTERED:'||u.id) ORDER BY u."createdAt",u.id LIMIT 100 ON CONFLICT DO NOTHING`);
    const enrollments = await tx.enrollment.findMany({
      where: { tenantId, id: { gt: checkpoint.enrollmentCursor } },
      orderBy: { id: "asc" },
      take: 20,
    });
    const ids = enrollments.map((e) => e.id);
    const [versions, results, links, changes, completions] = await Promise.all([
      tx.courseVersion.findMany({
        where: {
          tenantId,
          id: { in: [...new Set(enrollments.map((e) => e.courseVersionId))] },
        },
      }),
      tx.verifiedExamResult.findMany({
        where: {
          tenantId,
          enrollmentId: { in: ids },
          confirmedAt: { gte: activatedAt },
        },
        orderBy: { revision: "desc" },
      }),
      ids.length
        ? tx.$queryRaw<{ id: string; enrollmentId: string }[]>(
            Prisma.sql`SELECT d.id,r."enrollmentId" FROM "LmsDocumentLink" d JOIN "VerifiedExamResult" r ON r."tenantId"=d."tenantId" AND r.id=d."resultId" JOIN "IssuanceWorkflow" w ON w."tenantId"=d."tenantId" AND w."issuanceId"=d."issuanceId" WHERE d."tenantId"=${tenantId} AND r."enrollmentId" IN (${Prisma.join(ids)}) AND w.status='ISSUED' AND EXISTS(SELECT 1 FROM "Artifact" a WHERE a."tenantId"=d."tenantId" AND a."issuanceId"=d."issuanceId" AND a."createdAt">=${activatedAt})`,
          )
        : [],
      ids.length
        ? tx.$queryRaw<{ id: string }[]>(
            Prisma.sql`SELECT e.id FROM "Enrollment" e WHERE e."tenantId"=${tenantId} AND e.id IN (${Prisma.join(ids)}) AND (e."assignedAt">=${activatedAt} OR EXISTS(SELECT 1 FROM "LessonProgress" p WHERE p."tenantId"=e."tenantId" AND p."enrollmentId"=e.id AND p."updatedAt">=${activatedAt}) OR EXISTS(SELECT 1 FROM "LmsSubmission" p WHERE p."tenantId"=e."tenantId" AND p."enrollmentId"=e.id AND p."updatedAt">=${activatedAt}))`,
          )
        : [],
      tx.lmsLearningCompletion.findMany({
        where: {
          tenantId,
          enrollmentId: { in: ids },
          completedAt: { gte: activatedAt },
        },
      }),
    ]);
    const profiles = await tx.regulatoryProfileVersion.findMany({
      where: {
        tenantId,
        id: {
          in: [...new Set(versions.map((v) => v.regulatoryProfileVersionId))],
        },
      },
    });
    for (const e of enrollments) {
      if (e.status === "CANCELLED") continue;
      if (e.assignedAt >= activatedAt) {
        const app = e.sourceOrderId
          ? await tx.lmsApplication.findFirst({
              where: { tenantId, orderId: e.sourceOrderId, state: "ACCEPTED" },
              select: { id: true },
            })
          : null;
        await enqueueEnrollmentNotification(
          tx,
          e,
          app ? "ENROLLED" : "ASSIGNED",
          { key: `ASSIGNMENT:${e.id}` },
        );
      }
      if (e.startsAt && e.startsAt >= activatedAt && e.startsAt <= now)
        await enqueueEnrollmentNotification(tx, e, "STARTED");
      if (e.dueAt) {
        const expired = e.dueAt.getTime() <= now.getTime();
        const days = Math.ceil((e.dueAt.getTime() - now.getTime()) / 86400000);
        if (days <= 7 && (!expired || e.dueAt >= activatedAt))
          await enqueueEnrollmentNotification(
            tx,
            e,
            expired ? "ACCESS_EXPIRED" : "ACCESS_EXPIRING",
            {
              key: `ACCESS:${expired ? "EXPIRED" : "7"}:${e.id}:${e.dueAt.toISOString()}`,
            },
          );
      }
      for (const result of results.filter((r) => r.enrollmentId === e.id))
        await enqueueEnrollmentNotification(tx, e, "RESULT", {
          sourceType: "RESULT",
          sourceId: result.id,
        });
      for (const result of completions.filter((r) => r.enrollmentId === e.id))
        await enqueueEnrollmentNotification(tx, e, "RESULT", {
          sourceType: "RESULT",
          sourceId: result.id,
        });
      for (const link of links.filter((d) => d.enrollmentId === e.id))
        await enqueueEnrollmentNotification(tx, e, "DOCUMENT_READY", {
          sourceType: "DOCUMENT",
          sourceId: link.id,
        });
      if (!changes.some((r) => r.id === e.id)) continue;
      const seen = await tx.lmsNotificationEvent.findFirst({
        where: { tenantId, enrollmentId: e.id, kind: "TEST_AVAILABLE" },
        select: { id: true },
      });
      if (seen) continue;
      const version = versions.find((v) => v.id === e.courseVersionId),
        profile = profiles.find(
          (p) => p.id === version?.regulatoryProfileVersionId,
        );
      if (!version || version.status !== "PUBLISHED" || !profile) continue;
      const content = courseContentSchema.parse(version.content),
        definition = regulatoryProfileSchema.parse(profile.definition);
      if (!content.exam.questions.length) continue;
      try {
        await assertFinalAdmission(
          tx,
          workerContext(tenantId, e.assignedBy, "OPERATOR"),
          e,
          content,
          definition,
        );
        const attempts = await tx.examAttempt.count({
          where: { tenantId, enrollmentId: e.id, assessmentId: "FINAL" },
        });
        if (attempts < content.exam.maxAttempts)
          await enqueueEnrollmentNotification(tx, e, "TEST_AVAILABLE");
      } catch (error) {
        if (!(error instanceof HttpException) || error.getStatus() !== 409)
          throw error;
      }
    }
    await tx.lmsNotificationCheckpoint.update({
      where: { tenantId },
      data: {
        enrollmentCursor:
          enrollments.length === 20 ? enrollments.at(-1)!.id : "",
        scannedAt: now,
      },
    });
    return enrollments.length;
  });
}

export async function scanRenewalNotifications(now = new Date()) {
  // Separate durable cursor prevents a repeatedly deduplicated first page starving later records.
  const checkpoints = await db.$queryRaw<
    { tenantId: string; renewalCursor: string }[]
  >`SELECT c."tenantId",c."renewalCursor" FROM "LmsNotificationCheckpoint" c JOIN "Tenant" t ON t.id=c."tenantId" AND t.active ORDER BY c."renewalScannedAt" ASC NULLS FIRST,c."tenantId" LIMIT 1`;
  const checkpoint = checkpoints[0];
  if (!checkpoint) return 0;
  const page = await db.renewalNeed.findMany({
    where: {
      tenantId: checkpoint.tenantId,
      id: { gt: checkpoint.renewalCursor },
    },
    orderBy: { id: "asc" },
    take: 100,
    select: { id: true },
  });
  const ids = page.map((r) => r.id);
  if (!ids.length) {
    await db.$executeRaw`UPDATE "LmsNotificationCheckpoint" SET "renewalCursor"='',"renewalScannedAt"=${now} WHERE "tenantId"=${checkpoint.tenantId}`;
    return 0;
  }
  const rows = await db.$queryRaw<
    {
      id: string;
      tenantId: string;
      recipientId: string | null;
      customerId: string | null;
      date: string;
      dimension: string;
      timezone: string;
    }[]
  >`
    SELECT r.id,r."tenantId",r."recipientId",r."customerId",d.date,d.dimension,t.timezone FROM "RenewalNeed" r JOIN "Tenant" t ON t.id=r."tenantId" AND t.active JOIN "LmsNotificationCheckpoint" c ON c."tenantId"=r."tenantId" CROSS JOIN LATERAL (VALUES(r."documentValidUntil",'DOCUMENT'),(r."nextCheckDate",'TRAINING')) d(date,dimension)
    WHERE r.id=ANY(${ids}::text[]) AND r."tenantId"=${checkpoint.tenantId} AND r.confirmed AND r.state<>'IRRELEVANT' AND d.date ~ '^\\d{4}-\\d{2}-\\d{2}$' AND d.date <= to_char((${now}::timestamptz AT TIME ZONE t.timezone)::date+90,'YYYY-MM-DD') AND (d.date>=to_char((c."activatedAt" AT TIME ZONE 'UTC') AT TIME ZONE t.timezone,'YYYY-MM-DD') OR r."updatedAt">=c."activatedAt")
    ORDER BY r."updatedAt" DESC,r.id LIMIT 200`;
  let queued = 0;
  for (const row of rows) {
    const threshold = reminderThreshold(row.date, now, row.timezone);
    if (threshold === null) continue;
    const key = `RENEWAL:${threshold}:${row.id}:${row.dimension}:${row.date}`,
      kind = threshold === 0 ? "EXPIRED" : "REMINDER";
    const titleRu = `${row.dimension === "DOCUMENT" ? "Срок документа" : "Следующее обучение"}: ${row.date}`,
      titleKz = `${row.dimension === "DOCUMENT" ? "Құжат мерзімі" : "Келесі оқу"}: ${row.date}`;
    queued +=
      await db.$executeRaw(Prisma.sql`INSERT INTO "LmsNotificationEvent" (id,"tenantId","userId","sourceType","sourceId",kind,"deliveryKey","titleRu","titleKz",href)
      SELECT gen_random_uuid()::text,${row.tenantId},u.id,'RENEWAL',${row.id},${kind},${key},${titleRu},${titleKz},CASE WHEN u.role='LEARNER' THEN '/learn' ELSE '/lms/results' END FROM "User" u WHERE u."tenantId"=${row.tenantId} AND u.active AND (u.role IN ('SUPER_ADMIN','ADMIN','DIRECTOR','OPERATOR') OR EXISTS(SELECT 1 FROM "LearnerProfile" p WHERE p."tenantId"=u."tenantId" AND p."userId"=u.id AND p."recipientId"=${row.recipientId}) OR (u.role='EMPLOYER' AND EXISTS(SELECT 1 FROM "EmployerMembership" m WHERE m."tenantId"=u."tenantId" AND m."userId"=u.id AND m."customerId"=${row.customerId} AND m.active AND (m."expiresAt" IS NULL OR m."expiresAt">(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')) AND m.permissions @> '["READ"]'::jsonb AND (m."recipientIds"='[]'::jsonb OR m."recipientIds" @> jsonb_build_array(${row.recipientId}::text))))) ON CONFLICT ("tenantId","userId","deliveryKey") DO NOTHING`);
  }
  await db.$executeRaw`UPDATE "LmsNotificationCheckpoint" SET "renewalCursor"=${page.length === 100 ? page.at(-1)!.id : ""},"renewalScannedAt"=${now} WHERE "tenantId"=${checkpoint.tenantId} AND "renewalCursor"=${checkpoint.renewalCursor}`;
  return queued;
}
export async function deliverLearningNotification(
  owner = `notification:${randomUUID()}`,
) {
  await db.lmsNotificationEvent.updateMany({
    where: {
      state: "RUNNING",
      attempts: { gte: 8 },
      leaseUntil: { lt: new Date() },
    },
    data: { state: "FAILED", leaseOwner: null, leaseUntil: null },
  });
  const rows = await db.$queryRaw<
    LmsNotificationEvent[]
  >`UPDATE "LmsNotificationEvent" SET state='RUNNING',"leaseOwner"=${owner},"leaseUntil"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')+interval '30 seconds',attempts=attempts+1 WHERE id=(SELECT id FROM "LmsNotificationEvent" WHERE (state='PENDING' AND "runAfter"<=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC') OR state='RUNNING' AND "leaseUntil"<(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')) AND attempts<8 ORDER BY "createdAt",id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`;
  const event = rows[0];
  if (!event) return false;
  try {
    await transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "LmsNotificationEvent" WHERE id=${event.id} FOR UPDATE`;
      const current = await tx.lmsNotificationEvent.findFirst({
        where: {
          id: event.id,
          state: "RUNNING",
          leaseOwner: owner,
          leaseUntil: { gt: new Date() },
        },
      });
      if (!current) return;
      const user = await tx.user.findFirst({
        where: { tenantId: event.tenantId, id: event.userId, active: true },
      });
      const c = workerContext(
        event.tenantId,
        event.userId,
        user?.role || "UNKNOWN",
      );
      const visible = user
        ? await tx.$queryRaw<{ id: string }[]>(
            Prisma.sql`SELECT n.id FROM "LmsNotificationEvent" n WHERE n.id=${event.id} AND (${await notificationVisibilitySql(c, true)})`,
          )
        : [];
      if (visible.length) {
        await tx.lmsLearningNotification.upsert({
          where: {
            tenantId_userId_deliveryKey: {
              tenantId: event.tenantId,
              userId: event.userId,
              deliveryKey: event.deliveryKey,
            },
          },
          create: {
            tenantId: event.tenantId,
            userId: event.userId,
            sourceType: event.sourceType,
            sourceId: event.sourceId,
            enrollmentId: event.enrollmentId,
            kind: event.kind,
            deliveryKey: event.deliveryKey,
            titleRu: event.titleRu,
            titleKz: event.titleKz,
            href: event.href,
          },
          update: {},
        });
        await audit(tx, c, "LMS_NOTIFICATION_DELIVERED", event.id, {
          kind: event.kind,
          sourceType: event.sourceType,
          sourceId: event.sourceId,
        });
      }
      await tx.lmsNotificationEvent.update({
        where: { id: event.id },
        data: {
          state: visible.length ? "DELIVERED" : "SUPPRESSED",
          deliveredAt: visible.length ? new Date() : null,
          leaseOwner: null,
          leaseUntil: null,
        },
      });
    });
  } catch {
    await db.lmsNotificationEvent.updateMany({
      where: { id: event.id, state: "RUNNING", leaseOwner: owner },
      data: {
        state: event.attempts >= 8 ? "FAILED" : "PENDING",
        leaseOwner: null,
        leaseUntil: null,
        runAfter: new Date(
          Date.now() + Math.min(60_000, event.attempts * 1000),
        ),
      },
    });
    throw new Error("LMS_NOTIFICATION_RETRY");
  }
  return true;
}
export async function notificationTick() {
  const scanned = await scanLearningNotifications(),
    reminders = await scanRenewalNotifications();
  let delivered = 0;
  while (delivered < 100 && (await deliverLearningNotification())) delivered++;
  return { scanned, reminders, delivered, external: "NOT_CONNECTED" };
}

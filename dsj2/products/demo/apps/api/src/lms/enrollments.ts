import { Prisma, type Recipient } from "@demo/database";
import { z } from "@demo/contracts";
import {
  courseContentSchema,
  accessPolicySchema,
} from "@demo/contracts/src/lms";
import {
  db,
  parse,
  json,
  transaction,
  audit,
  fail,
  type Context,
} from "../core";
import { resolveAccessPolicy } from "./access-policy";
import {
  assertLmsStaff,
  employerMemberships,
  isLmsStaff,
  scopedEnrollment,
} from "./scope";
import { operatorProgrammes } from "./operator-programme";
import { assignmentOrigin, assertAccessDate } from "./assignment-operations";

export async function assignmentContext(c: Context, input: unknown) {
  if (!isLmsStaff(c) && c.role !== "EMPLOYER")
    fail(403, "ROLE_DENIED", "Недостаточно прав");
  const query = parse(
    z
      .object({
        requestId: z.string().max(100).optional(),
        orderId: z.string().max(100).optional(),
        groupId: z.string().max(100).optional(),
        customerId: z.string().max(100).optional(),
        search: z.string().max(300).optional(),
        page: z.coerce.number().int().min(1).default(1),
      })
      .strict(),
    input,
  );
  let recipientIds: string[] | undefined;
  let customerId: string | null = null;
  const group = query.groupId
    ? await db.lmsGroup.findFirst({
        where: { id: query.groupId, tenantId: c.tenantId },
      })
    : null;
  if (query.groupId) {
    assertLmsStaff(c);
    if (!group) fail(404, "NOT_FOUND", "Группа не найдена");
    query.requestId = group.sourceRequestId || undefined;
    query.orderId = group.sourceOrderId || undefined;
    customerId = group.customerId;
  }
  const origin = await assignmentOrigin(c, {
    sourceRequestId: query.requestId,
    sourceOrderId: query.orderId,
    customerId: customerId || query.customerId,
  });
  customerId = origin.customerId;
  if (origin.personalApplication) recipientIds = [...(origin.recipientIds || [])].filter((id): id is string => !!id);
  if (query.requestId) {
    assertLmsStaff(c);
    customerId = origin.customerId;
    recipientIds = [...(origin.recipientIds || [])].filter(
      (id): id is string => !!id,
    );
  }
  const memberships =
    c.role === "EMPLOYER" ? await employerMemberships(c, true) : [];
  if (c.role === "EMPLOYER") {
    if (customerId && !memberships.some((member) => member.customerId === customerId))
      fail(403, "EMPLOYER_SCOPE_DENIED", "Нет права назначать обучение этой организации");
    if (!customerId && memberships.length === 1) customerId = memberships[0].customerId;
  }
  const customer = customerId ? await db.customerOrganization.findFirst({ where: { tenantId: c.tenantId, id: customerId, archived: false }, select: { id: true, nameRu: true, nameKz: true } }) : null;
  if (customerId && !customer) fail(404, "NOT_FOUND", "Организация недоступна");
  const application = query.orderId ? await db.lmsApplication.findFirst({ where: { tenantId: c.tenantId, orderId: query.orderId, state: "ACCEPTED" }, select: { id: true, courseVersionId: true } }) : null;
  const clauses = [Prisma.sql`r."tenantId"=${c.tenantId} AND NOT r.archived`];
  if (customerId && !recipientIds) clauses.push(Prisma.sql`EXISTS (SELECT 1 FROM "RecipientEmployment" e WHERE e."tenantId"=r."tenantId" AND e."recipientId"=r.id AND e."employerId"=${customerId})`);
  if (recipientIds)
    clauses.push(
      recipientIds.length
        ? Prisma.sql`r.id IN (${Prisma.join(recipientIds)})`
        : Prisma.sql`false`,
    );
  if (c.role === "EMPLOYER")
    clauses.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "RecipientEmployment" employment
      JOIN "EmployerMembership" m ON m."tenantId"=employment."tenantId" AND m."customerId"=employment."employerId"
      WHERE employment."tenantId"=r."tenantId" AND employment."recipientId"=r.id
      AND m."userId"=${c.userId} AND m.active AND (m."expiresAt" IS NULL OR m."expiresAt">CURRENT_TIMESTAMP)
      AND m.permissions @> '["ASSIGN_TRAINING"]'::jsonb
      AND (m."recipientIds"='[]'::jsonb OR m."recipientIds" @> jsonb_build_array(r.id)))`);
  if (query.search?.trim()) {
    const search = `%${query.search.trim().replace(/[\\%_]/g, "\\$&")}%`;
    clauses.push(
      Prisma.sql`(r.data->>'fullNameRu' ILIKE ${search} OR r.data->>'fullNameKz' ILIKE ${search})`,
    );
  }
  const where = Prisma.join(clauses, " AND ");
  // Scope and search are applied in SQL before paging; only this page's directory data is read.
  const [recipients, count] = await Promise.all([
    db.$queryRaw<Recipient[]>(
      Prisma.sql`SELECT r.* FROM "Recipient" r WHERE ${where} ORDER BY r."createdAt" DESC,r.id DESC LIMIT 250 OFFSET ${(query.page - 1) * 250}`,
    ),
    db.$queryRaw<Array<{ total: bigint }>>(
      Prisma.sql`SELECT count(*) AS total FROM "Recipient" r WHERE ${where}`,
    ),
  ]);
  const employment = await db.recipientEmployment.findMany({
    where: {
      tenantId: c.tenantId,
      recipientId: { in: recipients.map((r) => r.id) },
    },
  });
  const items = recipients.map((r) => ({
    id: r.id,
    data: r.data,
    customerIds: [
      ...new Set(
        employment
          .filter(
            (e) =>
              e.recipientId === r.id &&
              (c.role !== "EMPLOYER" ||
                memberships.some(
                  (m) =>
                    m.customerId === e.employerId &&
                    (!(m.recipientIds as string[]).length ||
                      (m.recipientIds as string[]).includes(r.id)),
                )),
          )
          .map((e) => e.employerId),
      ),
    ],
  }));
  const courses = await operatorProgrammes(c, group?.courseVersionId || application?.courseVersionId);
  const published = courses.filter(
    (course) => course.latestVersion?.status === "PUBLISHED",
  );
  return {
    recipients: items,
    courses: published,
    customerId,
    customer,
    applicationId: application?.id || null,
    courseVersionId: group?.courseVersionId || application?.courseVersionId || null,
    sourceTitle: origin.request?.title || origin.order?.title || null,
    sourceRequestId: query.requestId || null,
    sourceOrderId: query.orderId || null,
    group,
    contextRecipientIds: recipientIds,
    page: query.page,
    pageSize: 250,
    total: Number(count[0].total),
  };
}

export { runAssignmentChunk as assignEnrollments } from "./assignment-operations";

export function progressPercent(
  content: ReturnType<typeof courseContentSchema.parse>,
  progress: { lessonId: string; completedAt: Date | null }[],
) {
  const required = content.modules
    .flatMap((m) => m.lessons)
    .filter((l) => l.required);
  return required.length
    ? Math.round(
        (100 *
          required.filter((lesson) =>
            progress.some((p) => p.lessonId === lesson.id && p.completedAt),
          ).length) /
          required.length,
      )
    : 100;
}

export function effectiveResult<
  T extends {
    id: string;
    eligible: boolean;
    verdict: string;
    assessmentKind?: string;
    examAt?: Date | null;
  },
>(result: T, events: { resultId: string; kind: string; createdAt: Date }[]) {
  const event = events.find(
    (entry) =>
      entry.resultId === result.id &&
      ["VOIDED", "SUPERSEDED"].includes(entry.kind),
  );
  const unknownExamDate =
    result.assessmentKind === "EXTERNAL_AUTHORIZED" && result.examAt == null;
  return {
    ...result,
    eligible: result.eligible && !event,
    documentEligible: result.eligible && !event && !unknownExamDate,
    reviewReasons: unknownExamDate ? ["EXAM_DATE_UNKNOWN"] : [],
    state: event?.kind || (unknownExamDate ? "NEEDS_REVIEW" : result.verdict),
  };
}

export { listEnrollmentPage as listEnrollments } from "./enrollment-list";

export async function extendEnrollment(c: Context, id: string, input: unknown) {
  assertLmsStaff(c);
  const data = parse(
    z
      .object({
        dueAt: z.string().datetime().nullable().optional(),
        accessPolicy: accessPolicySchema.optional(),
      })
      .strict(),
    input,
  );
  if (data.dueAt === undefined && !data.accessPolicy)
    fail(400, "ACCESS_POLICY_REQUIRED", "Укажите новый срок или режим доступа");
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "Enrollment" WHERE "tenantId"=${c.tenantId} AND id=${id} FOR UPDATE`;
    const before = await scopedEnrollment(c, id, tx);
    const version = await tx.courseVersion.findFirstOrThrow({
      where: { tenantId: c.tenantId, id: before.courseVersionId },
    });
    const resolved = resolveAccessPolicy(
      courseContentSchema.parse(version.content),
      new Date(),
      data.accessPolicy ||
        (before.accessPolicy as unknown as
          | z.infer<typeof accessPolicySchema>
          | undefined),
      data.dueAt,
    );
    if (resolved.dueAt) assertAccessDate(resolved.dueAt);
    const enrollment = await tx.enrollment.update({
      where: { id },
      data: {
        dueAt: resolved.dueAt,
        startsAt: resolved.startsAt,
        accessPolicy: json(resolved.policy),
        dueAtOverride: true,
      },
    });
    await audit(tx, c, "LMS_ACCESS_EXTENDED", id, {
      before: { dueAt: before.dueAt },
      after: { dueAt: data.dueAt },
    });
    return enrollment;
  });
}

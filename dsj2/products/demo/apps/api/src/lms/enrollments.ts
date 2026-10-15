import type { Prisma } from "@demo/database";
import { z } from "@demo/contracts";
import { courseContentSchema } from "@demo/contracts/src/lms";
import { db, parse, transaction, audit, fail, type Context } from "../core";
import {
  assertLmsStaff,
  employerMemberships,
  isLmsStaff,
  scopedEnrollment,
} from "./scope";
import { listCourses } from "./courses";
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
  });
  if (query.requestId) {
    assertLmsStaff(c);
    customerId = origin.customerId;
    recipientIds = [...(origin.recipientIds || [])].filter(
      (id): id is string => !!id,
    );
  }
  if (c.role === "EMPLOYER") {
    const memberships = await employerMemberships(c, true);
    const employment = await db.recipientEmployment.findMany({
      where: {
        tenantId: c.tenantId,
        employerId: { in: memberships.map((m) => m.customerId) },
      },
    });
    recipientIds = employment
      .filter((e) =>
        memberships.some(
          (m) =>
            m.customerId === e.employerId &&
            (!(m.recipientIds as string[]).length ||
              (m.recipientIds as string[]).includes(e.recipientId)),
        ),
      )
      .map((e) => e.recipientId);
    if (memberships.length === 1) customerId = memberships[0].customerId;
  }
  if (query.search) {
    const found = await db.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "Recipient" WHERE "tenantId"=${c.tenantId} AND NOT archived AND data::text ILIKE ${"%" + query.search + "%"}`;
    const matching = new Set(found.map((r) => r.id));
    recipientIds = recipientIds
      ? recipientIds.filter((id) => matching.has(id))
      : [...matching];
  }
  const where: Prisma.RecipientWhereInput = {
    tenantId: c.tenantId,
    archived: false,
    ...(recipientIds ? { id: { in: recipientIds } } : {}),
  };
  // Existing Recipient JSON is reused unchanged. Search never crosses the tenant boundary.
  const recipients = await db.recipient.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (query.page - 1) * 250,
    take: 250,
  });
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
          .filter((e) => e.recipientId === r.id)
          .map((e) => e.employerId),
      ),
    ],
  }));
  const courses = (await listCourses(c, { pageSize: 250, status: "PUBLISHED" }))
    .items;
  const published = courses.filter(
    (course) => course.latestVersion?.status === "PUBLISHED",
  );
  return {
    recipients: items,
    courses: published,
    customerId,
    sourceRequestId: query.requestId || null,
    sourceOrderId: query.orderId || null,
    group,
    contextRecipientIds: query.requestId ? recipientIds : undefined,
    page: query.page,
    pageSize: 250,
    total: await db.recipient.count({ where }),
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
    z.object({ dueAt: z.string().datetime() }).strict(),
    input,
  );
  const before = await scopedEnrollment(c, id);
  assertAccessDate(new Date(data.dueAt));
  return transaction(async (tx) => {
    const enrollment = await tx.enrollment.update({
      where: { id },
      data: { dueAt: new Date(data.dueAt), dueAtOverride: true },
    });
    await audit(tx, c, "LMS_ACCESS_EXTENDED", id, {
      before: { dueAt: before.dueAt },
      after: { dueAt: data.dueAt },
    });
    return enrollment;
  });
}

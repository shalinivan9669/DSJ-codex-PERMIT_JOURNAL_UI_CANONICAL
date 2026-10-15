import type { Prisma } from "@demo/database";
import { z } from "@demo/contracts";
import { courseContentSchema } from "@demo/contracts/src/lms";
import { db, parse, transaction, audit, fail, type Context } from "../core";
import { enrollInputSchema, pagingSchema, courseOutline } from "./validation";
import {
  assertLmsStaff,
  employerMemberships,
  enrollmentFilter,
  isLmsStaff,
  scopedEnrollment,
} from "./scope";
import { listCourses } from "./courses";

export async function assignmentContext(c: Context, input: unknown) {
  if (!isLmsStaff(c) && c.role !== "EMPLOYER")
    fail(403, "ROLE_DENIED", "Недостаточно прав");
  const query = parse(
    z
      .object({
        requestId: z.string().max(100).optional(),
        search: z.string().max(300).optional(),
        page: z.coerce.number().int().min(1).default(1),
      })
      .strict(),
    input,
  );
  let recipientIds: string[] | undefined;
  let customerId: string | null = null;
  if (query.requestId) {
    assertLmsStaff(c);
    const request = await db.printRequest.findFirst({
      where: { id: query.requestId, tenantId: c.tenantId },
    });
    if (!request) fail(404, "NOT_FOUND", "Заявка не найдена");
    customerId = request.customerId;
    const draft = request.draft as {
      items?: { recipientId?: string; id?: string }[];
    };
    recipientIds = (draft.items || [])
      .map((row) => row.recipientId || "")
      .filter(Boolean);
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
  const courses = (await listCourses(c, { pageSize: 250 })).items;
  const published = [];
  for (const course of courses) {
    const latestVersion = await db.courseVersion.findFirst({
      where: { tenantId: c.tenantId, courseId: course.id, status: "PUBLISHED" },
      orderBy: { version: "desc" },
    });
    if (latestVersion)
      published.push({
        ...course,
        latestVersion: {
          ...latestVersion,
          content: courseOutline(
            courseContentSchema.parse(latestVersion.content),
          ),
        },
      });
  }
  return {
    recipients: items,
    courses: published,
    customerId,
    page: query.page,
    pageSize: 250,
    total: await db.recipient.count({ where }),
  };
}

export async function assignEnrollments(c: Context, input: unknown) {
  if (!isLmsStaff(c) && c.role !== "EMPLOYER")
    fail(403, "ROLE_DENIED", "Недостаточно прав");
  const data = parse(enrollInputSchema, input);
  const version = await db.courseVersion.findFirst({
    where: {
      id: data.courseVersionId,
      tenantId: c.tenantId,
      status: "PUBLISHED",
    },
  });
  if (!version) fail(404, "NOT_FOUND", "Опубликованная программа не найдена");
  const content = courseContentSchema.parse(version.content);
  const uniqueIds = [...new Set(data.recipientIds)];
  const recipients = await db.recipient.findMany({
    where: { tenantId: c.tenantId, id: { in: uniqueIds }, archived: false },
  });
  const employment = await db.recipientEmployment.findMany({
    where: { tenantId: c.tenantId, recipientId: { in: uniqueIds } },
  });
  const profiles = await db.learnerProfile.findMany({
    where: { tenantId: c.tenantId, recipientId: { in: uniqueIds } },
  });
  if (
    data.customerId &&
    !(await db.customerOrganization.findFirst({
      where: { id: data.customerId, tenantId: c.tenantId, archived: false },
    }))
  )
    fail(404, "NOT_FOUND", "Организация не найдена");
  return transaction(async (tx) => {
    if (c.role === "EMPLOYER")
      await tx.$executeRaw`SELECT id FROM "EmployerMembership" WHERE "tenantId"=${c.tenantId} AND "userId"=${c.userId} ORDER BY id FOR UPDATE`;
    const memberships =
      c.role === "EMPLOYER" ? await employerMemberships(c, true, tx) : [];
    const items = [];
    const errors: { recipientId: string; code: string; message: string }[] = [];
    let created = 0,
      duplicates = data.recipientIds.length - uniqueIds.length;
    for (const recipientId of uniqueIds) {
      const recipient = recipients.find((r) => r.id === recipientId);
      const customers = employment
        .filter((e) => e.recipientId === recipientId)
        .map((e) => e.employerId);
      const customerId =
        data.customerId || (customers.length === 1 ? customers[0] : null);
      if (
        !recipient ||
        (c.role === "EMPLOYER" &&
          !memberships.some(
            (m) =>
              m.customerId === customerId &&
              customers.includes(m.customerId) &&
              (!(m.recipientIds as string[]).length ||
                (m.recipientIds as string[]).includes(recipientId)),
          ))
      ) {
        errors.push({
          recipientId,
          code: "RECIPIENT_UNAVAILABLE",
          message: "Сотрудник недоступен для назначения",
        });
        continue;
      }
      if (customerId && !customers.includes(customerId)) {
        errors.push({
          recipientId,
          code: "EMPLOYMENT_REQUIRED",
          message: "Проверьте связь сотрудника с организацией",
        });
        continue;
      }
      const existing = await tx.enrollment.findUnique({
        where: {
          tenantId_courseVersionId_recipientId: {
            tenantId: c.tenantId,
            courseVersionId: version.id,
            recipientId,
          },
        },
      });
      if (existing) {
        duplicates++;
        items.push(existing);
        continue;
      }
      const enrollment = await tx.enrollment.create({
        data: {
          tenantId: c.tenantId,
          courseVersionId: version.id,
          recipientId,
          learnerUserId: profiles.find((p) => p.recipientId === recipientId)
            ?.userId,
          customerId,
          groupKey: data.groupName,
          dueAt: new Date(Date.now() + content.accessDays * 86400000),
          assignedBy: c.userId,
        },
      });
      items.push(enrollment);
      created++;
    }
    await audit(tx, c, "LMS_BULK_ASSIGNED", version.id, {
      created,
      duplicates,
      errors: errors.map((e) => ({ recipientId: e.recipientId, code: e.code })),
    });
    return { items, created, duplicates, errors };
  });
}

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

export async function listEnrollments(c: Context, query: unknown) {
  const data = parse(pagingSchema, query);
  const where: Prisma.EnrollmentWhereInput = {
    ...(await enrollmentFilter(c)),
    ...(data.courseVersionId ? { courseVersionId: data.courseVersionId } : {}),
    ...(data.status ? { status: data.status } : {}),
  };
  const enrollments = await db.enrollment.findMany({
    where,
    orderBy: { assignedAt: "desc" },
    skip: (data.page - 1) * data.pageSize,
    take: data.pageSize,
  });
  const ids = enrollments.map((e) => e.id);
  const [versions, recipients, progress, results] = await Promise.all([
    db.courseVersion.findMany({
      where: {
        tenantId: c.tenantId,
        id: { in: enrollments.map((e) => e.courseVersionId) },
      },
    }),
    db.recipient.findMany({
      where: {
        tenantId: c.tenantId,
        id: { in: enrollments.map((e) => e.recipientId) },
      },
    }),
    db.lessonProgress.findMany({
      where: { tenantId: c.tenantId, enrollmentId: { in: ids } },
    }),
    db.verifiedExamResult.findMany({
      where: { tenantId: c.tenantId, enrollmentId: { in: ids } },
      orderBy: { revision: "desc" },
    }),
  ]);
  const documents = await db.lmsDocumentLink.findMany({
    where: { tenantId: c.tenantId, resultId: { in: results.map((r) => r.id) } },
  });
  const events = await db.lmsResultEvent.findMany({
    where: {
      tenantId: c.tenantId,
      resultId: { in: results.map((r) => r.id) },
      kind: { in: ["VOIDED", "SUPERSEDED"] },
    },
    orderBy: { createdAt: "desc" },
  });
  return {
    items: enrollments.map((e) => {
      const version = versions.find((v) => v.id === e.courseVersionId)!;
      const content = courseContentSchema.parse(version.content);
      const historical = results.find((r) => r.enrollmentId === e.id);
      const result = historical
        ? effectiveResult(historical, events)
        : undefined;
      return {
        ...e,
        recipient: recipients.find((r) => r.id === e.recipientId),
        courseVersion: { ...version, content: courseOutline(content) },
        progressPercent: progressPercent(
          content,
          progress.filter((p) => p.enrollmentId === e.id),
        ),
        result: result
          ? {
              id: result.id,
              verdict: result.verdict,
              assessmentKind: result.assessmentKind,
              eligible: result.eligible,
              documentEligible: result.documentEligible,
              reviewReasons: result.reviewReasons,
              score: result.score,
              maximum: result.maximum,
              state: result.state,
            }
          : null,
        documents: documents
          .filter((d) => d.resultId === result?.id)
          .map((document) => ({
            ...document,
            ...(["VOIDED", "SUPERSEDED"].includes(result?.state || "")
              ? { status: result!.state }
              : {}),
          })),
      };
    }),
    total: await db.enrollment.count({ where }),
    page: data.page,
    pageSize: data.pageSize,
  };
}

export async function extendEnrollment(c: Context, id: string, input: unknown) {
  assertLmsStaff(c);
  const data = parse(
    z.object({ dueAt: z.string().datetime() }).strict(),
    input,
  );
  await scopedEnrollment(c, id);
  return transaction(async (tx) => {
    const enrollment = await tx.enrollment.update({
      where: { id },
      data: { dueAt: new Date(data.dueAt) },
    });
    await audit(tx, c, "LMS_ACCESS_EXTENDED", id, { dueAt: data.dueAt });
    return enrollment;
  });
}

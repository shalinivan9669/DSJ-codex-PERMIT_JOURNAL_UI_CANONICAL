import { randomUUID } from "node:crypto";
import { z, draftSchema } from "@demo/contracts";
import { courseContentSchema } from "@demo/contracts/src/lms";
import type { Prisma } from "@demo/database";
import {
  audit,
  db,
  fail,
  hash,
  json,
  parse,
  transaction,
  type Context,
} from "../core";
import { employerMemberships, isLmsStaff } from "./scope";
import { enrollInputSchema } from "./validation";
import { workingRequest } from "../approvals";

export const ASSIGNMENT_CHUNK_SIZE = 100;
type Input = z.infer<typeof enrollInputSchema>;
type Tx = Prisma.TransactionClient;

/** The origin is explicit. A request linked to several orders never implies one of them. */
export async function assignmentOrigin(
  c: Context,
  data: Pick<Input, "sourceRequestId" | "sourceOrderId" | "customerId">,
  tx: Tx = db,
) {
  let request = null;
  let order = null;
  if (data.sourceRequestId || data.sourceOrderId) {
    if (!isLmsStaff(c)) fail(403, "ROLE_DENIED", "Недостаточно прав");
    if (data.sourceRequestId) {
      request = await tx.printRequest.findFirst({
        where: { tenantId: c.tenantId, id: data.sourceRequestId },
      });
      if (!request) fail(404, "NOT_FOUND", "Заявка не найдена");
      const current = await workingRequest(c, request.id, tx);
      const currentDraft = parse(draftSchema, current.draft);
      request = {
        ...request,
        customerId: currentDraft.customerId || request.customerId,
        draft: json(currentDraft),
      };
    }
    if (data.sourceOrderId) {
      order = await tx.serviceOrder.findFirst({
        where: { tenantId: c.tenantId, id: data.sourceOrderId },
      });
      if (!order) fail(404, "NOT_FOUND", "Заказ не найден");
      if (
        !request ||
        !(await tx.serviceOrderRequest.findUnique({
          where: {
            tenantId_orderId_requestId: {
              tenantId: c.tenantId,
              orderId: order.id,
              requestId: request.id,
            },
          },
        }))
      )
        fail(409, "ORDER_REQUEST_MISMATCH", "Выберите заявку этого заказа");
    }
    const employer =
      order?.employerId || order?.customerId || request?.customerId;
    if (data.customerId && employer && employer !== data.customerId)
      fail(
        409,
        "ORIGIN_CUSTOMER_MISMATCH",
        "Организация не соответствует источнику",
      );
  }
  const draft = request?.draft as
    | { items?: { recipientId?: string }[] }
    | undefined;
  return {
    request,
    order,
    recipientIds: draft
      ? new Set((draft.items || []).map((r) => r.recipientId).filter(Boolean))
      : null,
    customerId:
      data.customerId ||
      order?.employerId ||
      order?.customerId ||
      request?.customerId ||
      null,
  };
}

export function assertAccessDate(dueAt: Date) {
  if (!Number.isFinite(dueAt.getTime()) || dueAt.getTime() <= Date.now())
    fail(400, "DUE_DATE_INVALID", "Укажите будущую дату окончания доступа");
}

export async function runAssignmentChunk(c: Context, input: unknown) {
  if (!isLmsStaff(c) && c.role !== "EMPLOYER")
    fail(403, "ROLE_DENIED", "Недостаточно прав");
  const data = parse(enrollInputSchema, input);
  const ids = [...new Set(data.recipientIds)];
  const operationId = data.operationId || randomUUID();
  const inputHash = hash({
    ...data,
    operationId: undefined,
    recipientIds: ids,
  });
  const report = await transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.tenantId + ":lms-assignment:" + operationId},0))`;
    // One row lock serializes retries for an operation. Course lock below serializes pause/create.
    let operation = await tx.lmsAssignmentOperation.findFirst({
      where: { tenantId: c.tenantId, id: operationId },
    });
    if (!operation) {
      await assignmentOrigin(c, data, tx);
      await tx.lmsAssignmentOperation.create({
        data: {
          id: operationId,
          tenantId: c.tenantId,
          actorId: c.userId,
          inputHash,
          input: json(data),
        },
      });
    }
    await tx.$executeRaw`SELECT id FROM "LmsAssignmentOperation" WHERE id=${operationId} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    operation = await tx.lmsAssignmentOperation.findFirstOrThrow({
      where: { id: operationId, tenantId: c.tenantId },
    });
    if (operation.actorId !== c.userId)
      fail(404, "NOT_FOUND", "Операция не найдена");
    if (operation.inputHash !== inputHash)
      fail(
        409,
        "ASSIGNMENT_OPERATION_CONFLICT",
        "Состав операции изменился. Начните новое назначение",
      );
    const version = await tx.courseVersion.findFirst({
      where: {
        id: data.courseVersionId,
        tenantId: c.tenantId,
        status: "PUBLISHED",
      },
    });
    if (!version) fail(404, "NOT_FOUND", "Опубликованная программа не найдена");
    const origin = await assignmentOrigin(c, data, tx);
    if (
      origin.customerId &&
      !(await tx.customerOrganization.findFirst({
        where: { tenantId: c.tenantId, id: origin.customerId, archived: false },
      }))
    )
      fail(404, "NOT_FOUND", "Организация не найдена");
    await tx.$executeRaw`SELECT id FROM "Course" WHERE "tenantId"=${c.tenantId} AND id=${version.courseId} FOR UPDATE`;
    const course = await tx.course.findFirstOrThrow({
      where: { tenantId: c.tenantId, id: version.courseId },
    });
    if (c.role === "EMPLOYER")
      await tx.$executeRaw`SELECT id FROM "EmployerMembership" WHERE "tenantId"=${c.tenantId} AND "userId"=${c.userId} ORDER BY id FOR UPDATE`;
    const memberships =
      c.role === "EMPLOYER" ? await employerMemberships(c, true, tx) : [];
    if (c.role === "EMPLOYER") {
      if (!memberships.length) fail(403, "ROLE_DENIED", "Недостаточно прав");
      if (operation.cursor > 0) {
        // Replaying an owned operation does not retain revoked access to its prior successes.
        // Failed input IDs carry no additional directory facts; pending rows are checked below.
        const denied = await tx.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*) AS count FROM "LmsAssignmentRow" r
          JOIN "Enrollment" e ON e."tenantId"=r."tenantId" AND e.id=r."enrollmentId"
          WHERE r."tenantId"=${c.tenantId} AND r."operationId"=${operationId}
          AND NOT EXISTS (
            SELECT 1 FROM "EmployerMembership" m WHERE m."tenantId"=e."tenantId"
              AND m."userId"=${c.userId} AND m."customerId"=e."customerId"
              AND m.active AND (m."expiresAt" IS NULL OR m."expiresAt">CURRENT_TIMESTAMP)
              AND m.permissions @> '["ASSIGN_TRAINING"]'::jsonb
              AND (m."recipientIds"='[]'::jsonb OR m."recipientIds" @> jsonb_build_array(e."recipientId"))
              AND EXISTS (SELECT 1 FROM "RecipientEmployment" employment WHERE employment."tenantId"=e."tenantId" AND employment."recipientId"=e."recipientId" AND employment."employerId"=m."customerId")
          )`;
        if (Number(denied[0]?.count || 0) > 0)
          fail(403, "ROLE_DENIED", "Недостаточно прав");
      }
    }
    const content = courseContentSchema.parse(version.content);
    const dueAt = data.dueAt
      ? new Date(data.dueAt)
      : new Date(operation.createdAt.getTime() + content.accessDays * 86400000);
    if (data.dueAt && operation.cursor < ids.length) assertAccessDate(dueAt);
    let groupId = operation.groupId;
    if (!groupId && data.groupId) {
      const group = await tx.lmsGroup.findFirst({
        where: {
          tenantId: c.tenantId,
          id: data.groupId,
          courseVersionId: version.id,
        },
      });
      if (
        !group ||
        group.customerId !== origin.customerId ||
        group.sourceOrderId !== (data.sourceOrderId || null) ||
        group.sourceRequestId !== (data.sourceRequestId || null)
      )
        fail(
          409,
          "GROUP_CONTEXT_MISMATCH",
          "Проверьте программу, организацию и источник группы",
        );
      groupId = group.id;
      await tx.lmsAssignmentOperation.update({
        where: { id: operation.id },
        data: { groupId },
      });
    }
    const chunk = ids.slice(
      operation.cursor,
      operation.cursor + ASSIGNMENT_CHUNK_SIZE,
    );
    const [recipients, employment, profiles] = await Promise.all([
      tx.recipient.findMany({
        where: { tenantId: c.tenantId, id: { in: chunk }, archived: false },
      }),
      tx.recipientEmployment.findMany({
        where: { tenantId: c.tenantId, recipientId: { in: chunk } },
      }),
      tx.learnerProfile.findMany({
        where: { tenantId: c.tenantId, recipientId: { in: chunk } },
      }),
    ]);
    const items = [];
    let processed = 0;
    let paused = false;
    for (const recipientId of chunk) {
      const customers = employment
        .filter((e) => e.recipientId === recipientId)
        .map((e) => e.employerId);
      const customerId =
        origin.customerId || (customers.length === 1 ? customers[0] : null);
      let errorCode: string | null = null;
      if (
        !recipients.some((r) => r.id === recipientId) ||
        (c.role === "EMPLOYER" &&
          !memberships.some(
            (m) =>
              m.customerId === customerId &&
              customers.includes(m.customerId) &&
              (!(m.recipientIds as string[]).length ||
                (m.recipientIds as string[]).includes(recipientId)),
          ))
      )
        errorCode = "RECIPIENT_UNAVAILABLE";
      else if (origin.recipientIds && !origin.recipientIds.has(recipientId))
        errorCode = "ORIGIN_RECIPIENT_MISMATCH";
      else if (customerId && !customers.includes(customerId))
        errorCode = "EMPLOYMENT_REQUIRED";
      let outcome = "ERROR";
      let enrollment = errorCode
        ? null
        : await tx.enrollment.findUnique({
            where: {
              tenantId_courseVersionId_recipientId: {
                tenantId: c.tenantId,
                courseVersionId: version.id,
                recipientId,
              },
            },
          });
      if (enrollment) {
        outcome =
          (data.sourceRequestId &&
            data.sourceRequestId !== enrollment.sourceRequestId) ||
          (data.sourceOrderId &&
            data.sourceOrderId !== enrollment.sourceOrderId) ||
          (data.groupId && enrollment.groupId !== data.groupId)
            ? "CONFLICT"
            : "REUSED";
        if (
          outcome === "REUSED" &&
          data.groupId &&
          enrollment.groupId === data.groupId
        ) {
          const membership = await tx.lmsGroupMember.findUnique({
            where: {
              tenantId_groupId_enrollmentId: {
                tenantId: c.tenantId,
                groupId: data.groupId,
                enrollmentId: enrollment.id,
              },
            },
          });
          if (membership?.excludedAt) {
            await tx.lmsGroupMember.update({
              where: { id: membership.id },
              data: { excludedAt: null, excludedBy: null },
            });
            await audit(tx, c, "LMS_GROUP_MEMBER_RESTORED", data.groupId, {
              enrollmentId: enrollment.id,
              before: {
                excludedAt: membership.excludedAt,
                excludedBy: membership.excludedBy,
              },
              after: { active: true },
            });
          }
        }
      } else if (!errorCode) {
        if (course.assignmentPaused || course.archived) {
          paused = true;
          break;
        }
        if (!groupId && ids.length > 1) {
          // An automatic group exists only when this operation actually adds a new enrollment.
          const group = await tx.lmsGroup.create({
            data: {
              tenantId: c.tenantId,
              name:
                data.groupName ||
                `${course.titleRu} · ${operation.createdAt.toISOString().slice(0, 10)}`,
              courseVersionId: version.id,
              customerId: origin.customerId,
              sourceRequestId: data.sourceRequestId,
              sourceOrderId: data.sourceOrderId,
              dueAt,
              createdBy: c.userId,
            },
          });
          groupId = group.id;
          await tx.lmsAssignmentOperation.update({
            where: { id: operation.id },
            data: { groupId },
          });
          await audit(tx, c, "LMS_GROUP_CREATED", groupId, {
            courseVersionId: version.id,
            sourceRequestId: data.sourceRequestId,
            sourceOrderId: data.sourceOrderId,
          });
        }
        enrollment = await tx.enrollment.create({
          data: {
            tenantId: c.tenantId,
            courseVersionId: version.id,
            recipientId,
            learnerUserId: profiles.find((p) => p.recipientId === recipientId)
              ?.userId,
            customerId,
            groupKey: data.groupName,
            groupId,
            sourceRequestId: data.sourceRequestId,
            sourceOrderId: data.sourceOrderId,
            dueAt,
            assignedBy: c.userId,
          },
        });
        if (groupId)
          await tx.lmsGroupMember.create({
            data: {
              tenantId: c.tenantId,
              groupId,
              enrollmentId: enrollment.id,
            },
          });
        outcome = "CREATED";
      }
      await tx.lmsAssignmentRow.create({
        data: {
          tenantId: c.tenantId,
          operationId,
          recipientId,
          enrollmentId: enrollment?.id,
          outcome,
          errorCode,
        },
      });
      if (enrollment) items.push({ ...enrollment, outcome });
      processed++;
    }
    const cursor = operation.cursor + processed;
    const state =
      cursor >= ids.length ? "COMPLETED" : paused ? "PAUSED" : "PENDING";
    await tx.lmsAssignmentOperation.update({
      where: { id: operationId },
      data: { cursor, state },
    });
    await audit(tx, c, "LMS_ASSIGNMENT_CHUNK", operationId, {
      before: { cursor: operation.cursor },
      after: { cursor, state },
      groupId,
      sourceRequestId: data.sourceRequestId,
      sourceOrderId: data.sourceOrderId,
    });
    return { items, groupId, state, cursor };
  });
  const counts = await db.lmsAssignmentRow.groupBy({
    by: ["outcome"],
    where: { tenantId: c.tenantId, operationId },
    _count: true,
  });
  const errors = await db.lmsAssignmentRow.findMany({
    where: { tenantId: c.tenantId, operationId, outcome: "ERROR" },
    take: 250,
    orderBy: { id: "asc" },
  });
  const failedRows = await db.lmsAssignmentRow.findMany({
    where: { tenantId: c.tenantId, operationId, outcome: "ERROR" },
    select: { recipientId: true },
    orderBy: { id: "asc" },
  });
  const messages: Record<string, string> = {
    RECIPIENT_UNAVAILABLE: "Сотрудник недоступен для назначения",
    EMPLOYMENT_REQUIRED: "Проверьте связь сотрудника с организацией",
    ORIGIN_RECIPIENT_MISMATCH: "Сотрудник отсутствует в исходной заявке",
  };
  return {
    ...report,
    operationId,
    total: ids.length,
    errorCount: failedRows.length,
    failedRecipientIds: failedRows.map((row) => row.recipientId),
    created: counts.find((r) => r.outcome === "CREATED")?._count || 0,
    duplicates: counts
      .filter((r) => ["REUSED", "CONFLICT"].includes(r.outcome))
      .reduce((n, r) => n + r._count, 0),
    conflicts: counts.find((r) => r.outcome === "CONFLICT")?._count || 0,
    errors: errors.map((r) => ({
      recipientId: r.recipientId,
      code: r.errorCode!,
      params: {},
      message: messages[r.errorCode!] || "Проверьте строку",
    })),
    pauseError:
      report.state === "PAUSED"
        ? {
            code: "COURSE_ASSIGNMENT_PAUSED",
            params: {},
            message: "Новые назначения программы приостановлены",
          }
        : null,
  };
}

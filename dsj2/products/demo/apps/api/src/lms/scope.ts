import type { Prisma } from "@demo/database";
import { db, fail, type Context, type DemoRequest } from "../core";
import { teachingRoles, isTeachingRole, teachingBindingPermissionWhere } from "./learning-permissions";

const staff = new Set(["SUPER_ADMIN", "ADMIN", "DIRECTOR", "OPERATOR"]);
export function lmsContext(req: DemoRequest): Context {
  if (!req.context) fail(401, "SESSION_REQUIRED", "Войдите в DEMO");
  if (
    ![...staff, ...teachingRoles, "LEARNER", "EMPLOYER"].includes(
      req.context.role,
    ) &&
    !req.context.teachingMode
  )
    fail(403, "ROLE_DENIED", "Недостаточно прав");
  return req.context;
}
export function assertLmsStaff(c: Context) {
  if (!staff.has(c.role)) fail(403, "ROLE_DENIED", "Недостаточно прав");
}
export function isLmsStaff(c: Context) {
  return staff.has(c.role);
}
export async function employerMemberships(
  c: Context,
  assign = false,
  tx: Prisma.TransactionClient = db,
) {
  if (c.role !== "EMPLOYER") fail(403, "ROLE_DENIED", "Недостаточно прав");
  const memberships = await tx.employerMembership.findMany({
    where: {
      tenantId: c.tenantId,
      userId: c.userId,
      active: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });
  return memberships.filter((m) =>
    (m.permissions as string[]).includes(assign ? "ASSIGN_TRAINING" : "READ"),
  );
}
export async function enrollmentFilter(
  c: Context,
  tx: Prisma.TransactionClient = db,
): Promise<Prisma.EnrollmentWhereInput> {
  if (isLmsStaff(c) && !c.learningMode) return { tenantId: c.tenantId };
  if (isTeachingRole(c)) {
    const binding = {
      tenantId: c.tenantId,
      userId: c.userId,
      revokedAt: null,
      ...teachingBindingPermissionWhere("READ"),
      role: { in: ["TEACHER", "EXPERT"] },
    };
    return {
      tenantId: c.tenantId,
      OR: [
        {
          learningVersion: {
            teachingCourse: {
              teachingBindings: { some: { ...binding, groupId: null } },
            },
          },
        },
        {
          groupMemberships: {
            some: {
              excludedAt: null,
              group: { teachingBindings: { some: binding } },
            },
          },
        },
      ],
    };
  }
  if (c.role === "LEARNER" || c.learningMode) {
    const profile = await tx.learnerProfile.findUnique({
      where: { tenantId_userId: { tenantId: c.tenantId, userId: c.userId } },
    });
    if (!profile)
      fail(403, "LEARNER_LINK_REQUIRED", "Завершите регистрацию слушателя");
    return { tenantId: c.tenantId, recipientId: profile.recipientId };
  }
  const memberships = await employerMemberships(c, false, tx);
  return {
    tenantId: c.tenantId,
    OR: memberships.map((m) => ({
      customerId: m.customerId,
      ...((m.recipientIds as string[]).length
        ? { recipientId: { in: m.recipientIds as string[] } }
        : {}),
    })),
  };
}
export async function scopedEnrollment(
  c: Context,
  id: string,
  tx: Prisma.TransactionClient = db,
) {
  const enrollment = await tx.enrollment.findFirst({
    where: { id, ...(await enrollmentFilter(c, tx)) },
  });
  if (!enrollment) fail(404, "NOT_FOUND", "Назначение не найдено");
  return enrollment;
}
export async function learnerEnrollment(
  c: Context,
  id: string,
  tx: Prisma.TransactionClient = db,
) {
  const profile = await tx.learnerProfile.findUnique({
    where: { tenantId_userId: { tenantId: c.tenantId, userId: c.userId } },
  });
  if (!profile)
    fail(403, "LEARNER_ONLY", "Это действие доступно связанному слушателю");
  const enrollment = await tx.enrollment.findFirst({
    where: { id, tenantId: c.tenantId, recipientId: profile.recipientId },
  });
  if (!enrollment) fail(404, "NOT_FOUND", "Назначение не найдено");
  if (
    enrollment.status === "CANCELLED" ||
    (enrollment.dueAt !== null && enrollment.dueAt.getTime() < Date.now())
  )
    fail(
      409,
      "ACCESS_EXPIRED",
      "Срок обучения завершён. Обратитесь в учебный центр",
    );
  if (enrollment.startsAt && enrollment.startsAt.getTime() > Date.now())
    fail(409, "ACCESS_NOT_STARTED", "Доступ к обучению ещё не начался");
  return enrollment;
}

import { Prisma } from "@demo/database";
import { canManageLearning, isLmsStaffRole } from "@demo/contracts";
import { db, fail, type Context } from "../core";

export const teachingRoles = ["TEACHER", "METHODIST", "EXPERT"] as const;
export type LearningPermission =
  | "READ"
  | "EDIT"
  | "PUBLISH"
  | "MATERIAL"
  | "REVIEW"
  | "SCHEDULE"
  | "ATTENDANCE"
  | "MANAGE";
export const teachingRolePermissions: Record<string, LearningPermission[]> = {
  TEACHER: ["READ", "REVIEW", "SCHEDULE", "ATTENDANCE"],
  METHODIST: ["READ", "EDIT", "MATERIAL"],
  EXPERT: ["READ", "REVIEW"],
};

/** Stored grants are capped by the binding role, including assignments made before role changes. */
export function effectiveTeachingPermissions(binding: {
  role: string;
  permissions: unknown;
}): LearningPermission[] {
  const stored = Array.isArray(binding.permissions) ? binding.permissions : [];
  const legacyExpertReview =
    binding.role === "EXPERT" && stored.includes("READ") && stored.includes("PUBLISH");
  return (teachingRolePermissions[binding.role] || []).filter(
    (permission) => stored.includes(permission) || (permission === "REVIEW" && legacyExpertReview),
  );
}

export function teachingBindingPermissionWhere(
  permission: LearningPermission,
): Prisma.LmsTeachingBindingWhereInput {
  const roles = teachingRoles.filter((role) => teachingRolePermissions[role]!.includes(permission));
  if (!roles.length) return { role: { in: [] } };
  return {
    OR: [
      { role: { in: [...roles] }, permissions: { array_contains: [permission] } },
      ...(permission === "REVIEW"
        ? [{ role: "EXPERT", permissions: { array_contains: ["READ", "PUBLISH"] } }]
        : []),
    ],
  };
}

/** SQL equivalent for queues and notifications, applied before pagination/counting. */
export function teachingBindingPermissionSql(
  permission: LearningPermission,
  alias = "b",
): Prisma.Sql {
  const binding = aliasSql(alias);
  const roles = teachingRoles.filter((role) => teachingRolePermissions[role]!.includes(permission));
  if (!roles.length) return Prisma.sql`FALSE`;
  const current = Prisma.sql`(${binding}.role IN (${Prisma.join(roles)}) AND ${binding}.permissions @> ${JSON.stringify([permission])}::jsonb)`;
  return permission === "REVIEW"
    ? Prisma.sql`(${current} OR (${binding}.role='EXPERT' AND ${binding}.permissions @> '["READ","PUBLISH"]'::jsonb))`
    : current;
}
export function isTeachingRole(c: Context) {
  return (
    !c.learningMode &&
    (c.teachingMode === true ||
      teachingRoles.includes(c.role as (typeof teachingRoles)[number]))
  );
}

export async function hasLearningPermission(
  c: Context,
  courseId: string,
  groupId: string | null,
  permission: LearningPermission,
  tx: Prisma.TransactionClient = db,
) {
  if (c.learningMode) return false;
  if (canManageLearning(c.role)) return true;
  if (permission === "READ" && isLmsStaffRole(c.role)) return true;
  return !!(await tx.lmsTeachingBinding.findFirst({
    where: {
      tenantId: c.tenantId,
      userId: c.userId,
      courseId,
      revokedAt: null,
      AND: [
        { OR: [{ groupId: null }, ...(groupId ? [{ groupId }] : [])] },
        teachingBindingPermissionWhere(permission),
      ],
    },
    select: { id: true },
  }));
}

/** The mutation and revocation take the same lock, so an already-open page carries no authority. */
export async function assertLearningPermission(
  c: Context,
  courseId: string,
  groupId: string | null,
  permission: LearningPermission,
  tx: Prisma.TransactionClient = db,
) {
  if (!c.learningMode && canManageLearning(c.role)) return;
  if (tx !== db)
    await tx.$executeRaw`SELECT id FROM "LmsTeachingBinding" WHERE "tenantId"=${c.tenantId} AND "userId"=${c.userId} AND "courseId"=${courseId} ORDER BY id FOR UPDATE`;
  if (!(await hasLearningPermission(c, courseId, groupId, permission, tx)))
    fail(
      403,
      "LEARNING_PERMISSION_DENIED",
      "Учебное полномочие отсутствует или отозвано",
    );
}

function aliasSql(alias: string) {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error("INVALID_SQL_ALIAS");
  return Prisma.raw(`"${alias}"`);
}

/** Fixed identifier aliases only; all values are bound. Scope is applied before LIMIT/count. */
export function enrollmentScopeSql(
  c: Context,
  alias = "e",
  _tx: Prisma.TransactionClient = db,
): Prisma.Sql {
  const e = aliasSql(alias);
  const tenant = Prisma.sql`${e}."tenantId"=${c.tenantId}`;
  if (c.learningMode || (c.role === "LEARNER" && !c.teachingMode))
    return Prisma.sql`${tenant} AND EXISTS (SELECT 1 FROM "LearnerProfile" scope_lp WHERE scope_lp."tenantId"=${e}."tenantId" AND scope_lp."userId"=${c.userId} AND scope_lp."recipientId"=${e}."recipientId")`;
  if (isLmsStaffRole(c.role)) return tenant;
  if (c.role === "EMPLOYER")
    return Prisma.sql`${tenant} AND EXISTS (SELECT 1 FROM "EmployerMembership" scope_em WHERE scope_em."tenantId"=${e}."tenantId" AND scope_em."userId"=${c.userId} AND scope_em."customerId"=${e}."customerId" AND scope_em.active AND (scope_em."expiresAt" IS NULL OR scope_em."expiresAt">CURRENT_TIMESTAMP) AND scope_em.permissions @> '["READ"]'::jsonb AND (scope_em."recipientIds"='[]'::jsonb OR scope_em."recipientIds" @> jsonb_build_array(${e}."recipientId")))`;
  if (isTeachingRole(c))
    return Prisma.sql`${tenant} AND EXISTS (SELECT 1 FROM "LmsTeachingBinding" scope_b JOIN "CourseVersion" scope_cv ON scope_cv."tenantId"=scope_b."tenantId" AND scope_cv."courseId"=scope_b."courseId" WHERE scope_b."tenantId"=${e}."tenantId" AND scope_b."userId"=${c.userId} AND scope_b."revokedAt" IS NULL AND scope_b.role IN ('TEACHER','EXPERT') AND ${teachingBindingPermissionSql("READ", "scope_b")} AND scope_cv.id=${e}."courseVersionId" AND (scope_b."groupId" IS NULL OR (scope_b."groupId"=${e}."groupId" AND EXISTS (SELECT 1 FROM "LmsGroupMember" scope_gm WHERE scope_gm."tenantId"=${e}."tenantId" AND scope_gm."enrollmentId"=${e}.id AND scope_gm."groupId"=scope_b."groupId" AND scope_gm."excludedAt" IS NULL))))`;
  return Prisma.sql`FALSE`;
}

export function groupScopeSql(
  c: Context,
  alias = "g",
  _tx: Prisma.TransactionClient = db,
): Prisma.Sql {
  const g = aliasSql(alias);
  const tenant = Prisma.sql`${g}."tenantId"=${c.tenantId}`;
  if (!c.learningMode && isLmsStaffRole(c.role)) return tenant;
  if (isTeachingRole(c))
    return Prisma.sql`${tenant} AND EXISTS (SELECT 1 FROM "LmsTeachingBinding" scope_b JOIN "CourseVersion" scope_cv ON scope_cv."tenantId"=scope_b."tenantId" AND scope_cv."courseId"=scope_b."courseId" WHERE scope_b."tenantId"=${g}."tenantId" AND scope_b."userId"=${c.userId} AND scope_b."revokedAt" IS NULL AND scope_b.role IN ('TEACHER','EXPERT') AND ${teachingBindingPermissionSql("READ", "scope_b")} AND scope_cv.id=${g}."courseVersionId" AND (scope_b."groupId" IS NULL OR scope_b."groupId"=${g}.id))`;
  return Prisma.sql`${tenant} AND EXISTS (SELECT 1 FROM "Enrollment" scope_e JOIN "LmsGroupMember" scope_gm ON scope_gm."tenantId"=scope_e."tenantId" AND scope_gm."enrollmentId"=scope_e.id AND scope_gm."groupId"=${g}.id AND scope_gm."excludedAt" IS NULL WHERE scope_e."groupId"=${g}.id AND ${enrollmentScopeSql(c, "scope_e")})`;
}

export function courseScopeSql(c: Context, alias = "c") {
  const course = aliasSql(alias);
  if (!isTeachingRole(c)) return Prisma.sql`${course}."tenantId"=${c.tenantId}`;
  return Prisma.sql`${course}."tenantId"=${c.tenantId} AND EXISTS (SELECT 1 FROM "LmsTeachingBinding" scope_b WHERE scope_b."tenantId"=${course}."tenantId" AND scope_b."courseId"=${course}.id AND scope_b."userId"=${c.userId} AND scope_b."revokedAt" IS NULL AND ${teachingBindingPermissionSql("READ", "scope_b")})`;
}

export async function courseActions(
  c: Context,
  courseId: string,
  tx: Prisma.TransactionClient = db,
) {
  const checks = await Promise.all(
    (["EDIT", "PUBLISH", "MATERIAL", "MANAGE", "REVIEW"] as const).map(
      async (p) =>
        [p, await hasLearningPermission(c, courseId, null, p, tx)] as const,
    ),
  );
  const can = Object.fromEntries(checks);
  const canReview = can.REVIEW || (!c.learningMode && isTeachingRole(c) && !!(await tx.lmsTeachingBinding.findFirst({
    where: {
      tenantId: c.tenantId,
      userId: c.userId,
      courseId,
      revokedAt: null,
      AND: [teachingBindingPermissionWhere("READ"), teachingBindingPermissionWhere("REVIEW")],
    },
    select: { id: true },
  })));
  return [
    ...(can.EDIT ? ["edit", "submitReview", "clone"] : []),
    ...(can.PUBLISH ? ["publish", "approveReview", "returnReview"] : []),
    ...(can.MATERIAL ? ["material"] : []),
    ...(can.MANAGE ? ["archive", "pause", "bindings", "reviewRegulatory"] : []),
    ...(canReview ? ["reviewResults"] : []),
  ];
}

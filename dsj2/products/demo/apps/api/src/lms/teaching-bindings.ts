import { canManageLearning, z } from "@demo/contracts";
import { Prisma } from "@demo/database";
import {
  audit,
  db,
  fail,
  json,
  parse,
  transaction,
  type Context,
} from "../core";
import {
  courseScopeSql,
  effectiveTeachingPermissions,
  groupScopeSql,
  teachingRolePermissions,
} from "./learning-permissions";

function canManageBindings(c: Context) {
  return !c.learningMode && canManageLearning(c.role);
}

function assertManageBindings(c: Context) {
  if (!canManageBindings(c))
    fail(403, "LEARNING_PERMISSION_DENIED", "Назначение учебных полномочий доступно администратору");
}

const listSchema = z
  .object({
    courseId: z.string().max(100).optional(),
    groupId: z.string().max(100).optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();
export async function listTeachingBindings(c: Context, input: unknown) {
  const q = parse(listSchema, input);
  const where = {
    tenantId: c.tenantId,
    ...(canManageBindings(c) ? {} : { userId: c.userId }),
    ...(q.courseId ? { courseId: q.courseId } : {}),
    ...(q.groupId ? { groupId: q.groupId } : {}),
  };
  const [bindings, total] = await Promise.all([
    db.lmsTeachingBinding.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.lmsTeachingBinding.count({ where }),
  ]);
  const [users, courses, groups] = await Promise.all([
    db.user.findMany({
      where: {
        tenantId: c.tenantId,
        id: { in: bindings.map((b) => b.userId) },
      },
      select: { id: true, displayName: true, email: true, role: true },
    }),
    db.course.findMany({
      where: {
        tenantId: c.tenantId,
        id: { in: bindings.map((b) => b.courseId) },
      },
      select: { id: true, titleRu: true, titleKz: true },
    }),
    db.lmsGroup.findMany({
      where: {
        tenantId: c.tenantId,
        id: { in: bindings.map((b) => b.groupId || "") },
      },
      select: { id: true, name: true },
    }),
  ]);
  return {
    items: bindings.map((b) => ({
      ...b,
      permissions: effectiveTeachingPermissions(b),
      user: users.find((u) => u.id === b.userId),
      course: courses.find((course) => course.id === b.courseId),
      group: groups.find((g) => g.id === b.groupId) || null,
      allowedActions: canManageBindings(c) && !b.revokedAt ? ["revoke"] : [],
    })),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

export async function teachingContext(c: Context, input: unknown) {
  const q = parse(
    z
      .object({
        search: z.string().trim().max(300).default(""),
        courseSearch: z.string().trim().max(300).default(""),
        groupSearch: z.string().trim().max(300).default(""),
        groupCourseId: z.string().max(100).optional(),
        excludeCourseId: z.string().max(100).optional(),
        page: z.coerce.number().int().min(1).max(100000).default(1),
        userPage: z.coerce.number().int().min(1).max(100000).optional(),
        coursePage: z.coerce.number().int().min(1).max(100000).optional(),
        groupPage: z.coerce.number().int().min(1).max(100000).optional(),
        pageSize: z.coerce.number().int().min(1).max(100).default(100),
      })
      .strict(),
    input,
  );
  const canManage = canManageBindings(c);
  const userPage = q.userPage ?? q.page,
    coursePage = q.coursePage ?? q.page,
    groupPage = q.groupPage ?? q.page;
  const usersWhere: Prisma.UserWhereInput = {
    tenantId: c.tenantId,
    active: true,
    role: { not: "EMPLOYER" },
    OR: [
      { displayName: { contains: q.search, mode: "insensitive" } },
      { email: { contains: q.search, mode: "insensitive" } },
    ],
  };
  // The same scope and search predicates are applied to totals and visible pages.
  const coursesWhere = Prisma.sql`${courseScopeSql(c)} AND NOT c.archived
    AND (${q.courseSearch}='' OR POSITION(LOWER(${q.courseSearch}) IN LOWER(c."titleRu"))>0 OR POSITION(LOWER(${q.courseSearch}) IN LOWER(c."titleKz"))>0)
    ${q.excludeCourseId ? Prisma.sql`AND c.id<>${q.excludeCourseId}` : Prisma.empty}`;
  const groupsWhere = Prisma.sql`${groupScopeSql(c)}
    AND (${q.groupSearch}='' OR POSITION(LOWER(${q.groupSearch}) IN LOWER(g.name))>0)
    ${q.groupCourseId ? Prisma.sql`AND v."courseId"=${q.groupCourseId}` : Prisma.empty}`;
  const [users, usersTotal, courses, courseCount, groups, groupCount] =
    await Promise.all([
      canManage
        ? db.user.findMany({
            where: usersWhere,
            select: { id: true, displayName: true, email: true, role: true },
            orderBy: { id: "asc" },
            take: q.pageSize,
            skip: (userPage - 1) * q.pageSize,
          })
        : [],
      canManage ? db.user.count({ where: usersWhere }) : 0,
      db.$queryRaw<Array<{ id: string; titleRu: string; titleKz: string }>>(
        Prisma.sql`SELECT c.id,c."titleRu",c."titleKz" FROM "Course" c WHERE ${coursesWhere} ORDER BY c."createdAt" DESC,c.id LIMIT ${q.pageSize} OFFSET ${(coursePage - 1) * q.pageSize}`,
      ),
      db.$queryRaw<Array<{ total: bigint }>>(
        Prisma.sql`SELECT COUNT(*)::bigint AS total FROM "Course" c WHERE ${coursesWhere}`,
      ),
      db.$queryRaw<
        Array<{
          id: string;
          name: string;
          courseVersionId: string;
          courseId: string;
        }>
      >(
        Prisma.sql`SELECT g.id,g.name,g."courseVersionId",v."courseId" FROM "LmsGroup" g JOIN "CourseVersion" v ON v."tenantId"=g."tenantId" AND v.id=g."courseVersionId" WHERE ${groupsWhere} ORDER BY g."createdAt" DESC,g.id LIMIT ${q.pageSize} OFFSET ${(groupPage - 1) * q.pageSize}`,
      ),
      db.$queryRaw<Array<{ total: bigint }>>(
        Prisma.sql`SELECT COUNT(*)::bigint AS total FROM "LmsGroup" g JOIN "CourseVersion" v ON v."tenantId"=g."tenantId" AND v.id=g."courseVersionId" WHERE ${groupsWhere}`,
      ),
    ]);
  return {
    users,
    courses,
    groups,
    usersTotal,
    coursesTotal: Number(courseCount[0]?.total || 0),
    groupsTotal: Number(groupCount[0]?.total || 0),
    canManage,
    page: q.page,
    userPage,
    coursePage,
    groupPage,
    pageSize: q.pageSize,
  };
}

export async function createTeachingBinding(c: Context, input: unknown) {
  assertManageBindings(c);
  const value = parse(
    z
      .object({
        userId: z.string().min(1).max(100),
        role: z.enum(["TEACHER", "METHODIST", "EXPERT"]),
        courseId: z.string().min(1).max(100),
        groupId: z.string().max(100).nullable().optional(),
      })
      .strict(),
    input,
  );
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "Course" WHERE "tenantId"=${c.tenantId} AND id=${value.courseId} FOR UPDATE`;
    const [user, course, group] = await Promise.all([
      tx.user.findFirst({
        where: {
          tenantId: c.tenantId,
          id: value.userId,
          active: true,
          role: { not: "EMPLOYER" },
        },
      }),
      tx.course.findFirst({
        where: { tenantId: c.tenantId, id: value.courseId, archived: false },
      }),
      value.groupId
        ? tx.lmsGroup.findFirst({
            where: { tenantId: c.tenantId, id: value.groupId },
          })
        : null,
    ]);
    if (!user || !course)
      fail(404, "NOT_FOUND", "Курс или сотрудник не найден");
    if (value.groupId) {
      const version =
        group &&
        (await tx.courseVersion.findFirst({
          where: {
            tenantId: c.tenantId,
            id: group.courseVersionId,
            courseId: value.courseId,
          },
        }));
      if (!group || !version)
        fail(400, "BINDING_GROUP_COURSE", "Выберите группу этого курса");
      if (value.role === "METHODIST")
        fail(400, "BINDING_SCOPE", "Методист назначается на программу целиком");
    }
    const existing = await tx.lmsTeachingBinding.findFirst({
      where: {
        tenantId: c.tenantId,
        userId: value.userId,
        courseId: value.courseId,
        groupId: value.groupId || null,
        role: value.role,
        revokedAt: null,
      },
    });
    if (existing) return { ...existing, permissions: effectiveTeachingPermissions(existing) };
    const binding = await tx.lmsTeachingBinding.create({
      data: {
        ...value,
        groupId: value.groupId || null,
        tenantId: c.tenantId,
        createdBy: c.userId,
        permissions: json(teachingRolePermissions[value.role]),
      },
    });
    await audit(tx, c, "LMS_TEACHING_BINDING_CREATED", binding.id, {
      userId: value.userId,
      role: value.role,
      courseId: value.courseId,
      groupId: value.groupId || null,
    });
    return binding;
  });
}

export async function revokeTeachingBinding(
  c: Context,
  id: string,
  input: unknown,
) {
  assertManageBindings(c);
  const { reason } = parse(
    z.object({ reason: z.string().trim().min(1).max(2000) }).strict(),
    input,
  );
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "LmsTeachingBinding" WHERE "tenantId"=${c.tenantId} AND id=${id} FOR UPDATE`;
    const before = await tx.lmsTeachingBinding.findFirst({
      where: { tenantId: c.tenantId, id },
    });
    if (!before) fail(404, "NOT_FOUND", "Назначение полномочий не найдено");
    if (before.revokedAt) return { ...before, permissions: effectiveTeachingPermissions(before) };
    const saved = await tx.lmsTeachingBinding.update({
      where: { id },
      data: { revokedAt: new Date(), revokedBy: c.userId },
    });
    await audit(tx, c, "LMS_TEACHING_BINDING_REVOKED", id, { reason });
    return { ...saved, permissions: effectiveTeachingPermissions(saved) };
  });
}

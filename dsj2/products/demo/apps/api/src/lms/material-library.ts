import { Prisma } from "@demo/database";
import { canManageLearning, z } from "@demo/contracts";
import { audit, db, fail, parse, transaction, type Context } from "../core";
import {
  assertLearningPermission,
  hasLearningPermission,
  teachingBindingPermissionSql,
  teachingBindingPermissionWhere,
} from "./learning-permissions";

export async function assertMaterialForCourse(
  tx: Prisma.TransactionClient,
  c: Context,
  courseId: string,
  id: string,
) {
  const material = await tx.lmsMaterial.findFirst({
    where: { tenantId: c.tenantId, id },
  });
  const state = await tx.lmsMaterialState.findUnique({
    where: { tenantId_materialId: { tenantId: c.tenantId, materialId: id } },
  });
  if (
    !material ||
    state?.deleted ||
    state?.hidden ||
    (material.courseId !== courseId &&
      !(await tx.lmsMaterialBinding.findUnique({
        where: {
          tenantId_materialId_courseId: {
            tenantId: c.tenantId,
            materialId: id,
            courseId,
          },
        },
      })))
  )
    fail(
      400,
      "MATERIAL_UNAVAILABLE",
      "Материал не разрешён для этого курса или скрыт из библиотеки",
    );
  return material;
}
async function materialWriter(
  c: Context,
  id: string,
  tx: Prisma.TransactionClient,
) {
  const material = await tx.lmsMaterial.findFirst({
    where: { tenantId: c.tenantId, id },
  });
  if (!material) fail(404, "NOT_FOUND", "Материал не найден");
  await assertLearningPermission(c, material.courseId, null, "MATERIAL", tx);
  await tx.$executeRaw`SELECT id FROM "LmsMaterial" WHERE "tenantId"=${c.tenantId} AND id=${id} FOR UPDATE`;
  return material;
}
export async function listMaterialLibrary(c: Context, input: unknown) {
  const q = parse(
    z
      .object({
        courseId: z.string().max(100).optional(),
        search: z.string().max(300).default(""),
        page: z.coerce.number().int().positive().default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(30),
      })
      .strict(),
    input,
  );
  if (q.courseId)
    await assertLearningPermission(c, q.courseId, null, "MATERIAL");
  const canManage = !c.learningMode && canManageLearning(c.role);
  const scope = canManage
    ? Prisma.sql`course."tenantId"=${c.tenantId}`
    : Prisma.sql`course."tenantId"=${c.tenantId} AND EXISTS (SELECT 1 FROM "LmsTeachingBinding" material_b WHERE material_b."tenantId"=course."tenantId" AND material_b."courseId"=course.id AND material_b."userId"=${c.userId} AND material_b."revokedAt" IS NULL AND material_b."groupId" IS NULL AND ${teachingBindingPermissionSql("READ", "material_b")} AND ${teachingBindingPermissionSql("MATERIAL", "material_b")})`;
  if (
    c.learningMode || (!canManage && !q.courseId && !(await db.lmsTeachingBinding.findFirst({
      where: {
        tenantId: c.tenantId,
        userId: c.userId,
        revokedAt: null,
        groupId: null,
        AND: [teachingBindingPermissionWhere("READ"), teachingBindingPermissionWhere("MATERIAL")],
      },
    })))
  )
    fail(403, "ROLE_DENIED", "Недостаточно прав");
  const where = Prisma.sql`m."tenantId"=${c.tenantId} AND NOT COALESCE(s.deleted,false) AND (${q.search}='' OR POSITION(lower(${q.search}) IN lower(COALESCE(s.title,m."originalName")))>0) AND EXISTS (SELECT 1 FROM "Course" course WHERE course.id=m."courseId" AND ${scope})`;
  const [items, count] = await Promise.all([
    db.$queryRaw<
      Array<{
        id: string;
        courseId: string;
        originalName: string;
        title: string;
        mimeType: string;
        size: number;
        hidden: boolean;
        revision: number;
        familyId: string;
        supersedesMaterialId: string | null;
      }>
    >(
      Prisma.sql`SELECT m.id,m."courseId",m."originalName",m."mimeType",m.size,COALESCE(s.title,m."originalName") AS title,COALESCE(s.hidden,false) AS hidden,COALESCE(s.revision,0) AS revision,COALESCE(s."familyId",m.id) AS "familyId",s."supersedesMaterialId" FROM "LmsMaterial" m LEFT JOIN "LmsMaterialState" s ON s."tenantId"=m."tenantId" AND s."materialId"=m.id WHERE ${where} ORDER BY m."createdAt" DESC,m.id LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
    ),
    db.$queryRaw<Array<{ total: bigint }>>(
      Prisma.sql`SELECT count(*) AS total FROM "LmsMaterial" m LEFT JOIN "LmsMaterialState" s ON s."tenantId"=m."tenantId" AND s."materialId"=m.id WHERE ${where}`,
    ),
  ]);
  return {
    items: await Promise.all(
      items.map(async (item) => ({
        ...item,
        state: item.hidden ? "HIDDEN" : "VISIBLE",
        allowedActions: [
          ...(!item.hidden && q.courseId ? ["bind"] : []),
          ...((await hasLearningPermission(c, item.courseId, null, "MATERIAL"))
            ? ["state", "delete", "upload"]
            : []),
        ],
      })),
    ),
    total: Number(count[0].total),
    page: q.page,
    pageSize: q.pageSize,
  };
}
export async function bindMaterial(c: Context, id: string, input: unknown) {
  const { courseId } = parse(
    z.object({ courseId: z.string().min(1).max(100) }).strict(),
    input,
  );
  return transaction(async (tx) => {
    const material = await tx.lmsMaterial.findFirst({
      where: { id, tenantId: c.tenantId },
    });
    if (!material) fail(404, "NOT_FOUND", "Материал не найден");
    // A reuse operation depends on both scopes. Lock them in one stable order against revocation.
    if (!canManageLearning(c.role) || c.learningMode)
      await tx.$executeRaw(
        Prisma.sql`SELECT id FROM "LmsTeachingBinding" WHERE "tenantId"=${c.tenantId} AND "userId"=${c.userId} AND "courseId" IN (${Prisma.join([...new Set([courseId, material.courseId])].sort())}) ORDER BY "courseId",id FOR UPDATE`,
      );
    await assertLearningPermission(c, courseId, null, "MATERIAL", tx);
    await assertLearningPermission(c, material.courseId, null, "READ", tx);
    await tx.$executeRaw`SELECT id FROM "LmsMaterial" WHERE "tenantId"=${c.tenantId} AND id=${id} FOR UPDATE`;
    const state = await tx.lmsMaterialState.findUnique({
      where: { tenantId_materialId: { tenantId: c.tenantId, materialId: id } },
    });
    if (state?.hidden || state?.deleted)
      fail(409, "MATERIAL_HIDDEN", "Материал скрыт из библиотеки");
    const binding = await tx.lmsMaterialBinding.upsert({
      where: {
        tenantId_materialId_courseId: {
          tenantId: c.tenantId,
          materialId: id,
          courseId,
        },
      },
      create: {
        tenantId: c.tenantId,
        materialId: id,
        courseId,
        createdBy: c.userId,
      },
      update: {},
    });
    await audit(tx, c, "LMS_MATERIAL_BOUND", id, { courseId });
    return binding;
  });
}
export async function setMaterialState(c: Context, id: string, input: unknown) {
  const value = parse(
    z
      .object({
        state: z.enum(["VISIBLE", "HIDDEN"]),
        revision: z.number().int().nonnegative(),
      })
      .strict(),
    input,
  );
  return transaction(async (tx) => {
    const material = await materialWriter(c, id, tx);
    const old = await tx.lmsMaterialState.findUnique({
      where: { tenantId_materialId: { tenantId: c.tenantId, materialId: id } },
    });
    if (old?.deleted)
      fail(409, "MATERIAL_DELETED", "Материал удалён из библиотеки");
    if ((old?.revision || 0) !== value.revision)
      fail(409, "REVISION_CONFLICT", "Материал изменён, обновите библиотеку");
    const saved = await tx.lmsMaterialState.upsert({
      where: { tenantId_materialId: { tenantId: c.tenantId, materialId: id } },
      create: {
        tenantId: c.tenantId,
        materialId: id,
        title: material.originalName,
        familyId: id,
        hidden: value.state === "HIDDEN",
        revision: 1,
        updatedBy: c.userId,
      },
      update: {
        hidden: value.state === "HIDDEN",
        revision: { increment: 1 },
        updatedBy: c.userId,
      },
    });
    await audit(tx, c, "LMS_MATERIAL_VISIBILITY", id, {
      before: old?.hidden || false,
      after: saved.hidden,
    });
    return saved;
  });
}
export async function deleteUnusedMaterial(c: Context, id: string) {
  return transaction(async (tx) => {
    const material = await materialWriter(c, id, tx);
    const usage = await tx.$queryRaw<
      Array<{ used: boolean }>
    >`SELECT EXISTS(SELECT 1 FROM "CourseVersion" v CROSS JOIN LATERAL jsonb_array_elements(v.content->'modules') module CROSS JOIN LATERAL jsonb_array_elements(module->'lessons') lesson WHERE v."tenantId"=${c.tenantId} AND (lesson->>'materialId'=${id} OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(lesson->'subtitles','[]'::jsonb)) track WHERE track->>'materialId'=${id}))) OR EXISTS(SELECT 1 FROM "LmsTeachingEvent" event WHERE event."tenantId"=${c.tenantId} AND event."recordingMaterialId"=${id}) AS used`;
    if (usage[0]?.used)
      fail(
        409,
        "MATERIAL_IN_USE",
        "Материал используется в программе или занятии; сохранённый файл нельзя удалить",
      );
    const saved = await tx.lmsMaterialState.upsert({
      where: { tenantId_materialId: { tenantId: c.tenantId, materialId: id } },
      create: {
        tenantId: c.tenantId,
        materialId: id,
        title: material.originalName,
        familyId: id,
        deleted: true,
        hidden: true,
        revision: 1,
        updatedBy: c.userId,
      },
      update: {
        deleted: true,
        hidden: true,
        revision: { increment: 1 },
        updatedBy: c.userId,
      },
    });
    await audit(tx, c, "LMS_UNUSED_MATERIAL_REMOVED", id);
    return saved;
  });
}

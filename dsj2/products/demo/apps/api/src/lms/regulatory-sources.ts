import { Prisma } from "@demo/database";
import {
  canManageLearning,
  regulatoryProfileSchema,
  z,
  type RegulatoryProfile,
} from "@demo/contracts";
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
import {
  assertLearningPermission,
  courseScopeSql,
  hasLearningPermission,
} from "./learning-permissions";
import { enqueueRegulatoryNotification } from "./notification-events";

const writerRoles = ["METHODIST", "EXPERT"];
function assertRead(c: Context) {
  if (
    c.learningMode ||
    (!canManageLearning(c.role) && !writerRoles.includes(c.role))
  )
    fail(
      403,
      "ROLE_DENIED",
      "Нормативная библиотека доступна методисту, эксперту и администратору",
    );
}
function definition(input: unknown) {
  const source = regulatoryProfileSchema.parse({
    title: "Источник",
    sources: [input],
  }).sources[0];
  const {
    sourceId: _sourceId,
    sourceRevisionId: _revisionId,
    ...value
  } = source;
  if (value.url) {
    let url: URL;
    try {
      url = new URL(value.url);
    } catch {
      fail(
        400,
        "SOURCE_URL_INVALID",
        "Укажите полный адрес официального источника",
      );
    }
    if (url.protocol !== "https:" || url.username || url.password)
      fail(400, "SOURCE_URL_INVALID", "Используйте HTTPS-ссылку без пароля");
  }
  return value;
}
export async function normalizeSourceReferences(
  tx: Prisma.TransactionClient,
  c: Context,
  profile: RegulatoryProfile,
) {
  if (profile.synthetic) {
    const tenant = await tx.tenant.findUnique({ where: { id: c.tenantId }, select: { demoOnly: true } });
    if (!tenant?.demoOnly) fail(403, "SYNTHETIC_PROFILE_FORBIDDEN", "Учебное основание без юридической силы доступно только в демонстрационной установке");
  }
  const sources: RegulatoryProfile["sources"] = [];
  for (const source of profile.sources) {
    if (!source.sourceId && !source.sourceRevisionId) {
      sources.push(source);
      continue;
    }
    const revision =
      source.sourceId &&
      source.sourceRevisionId &&
      (await tx.regulatorySourceRevision.findFirst({
        where: {
          tenantId: c.tenantId,
          id: source.sourceRevisionId,
          sourceId: source.sourceId,
        },
      }));
    if (!revision)
      fail(
        400,
        "SOURCE_REVISION_NOT_FOUND",
        "Редакция нормативного источника недоступна",
      );
    if (
      profile.status === "CONFIRMED" &&
      !profile.synthetic &&
      (!revision.checkedAt ||
        definition(revision.definition).status !== "CURRENT")
    )
      fail(
        409,
        "SOURCE_REVIEW_REQUIRED",
        "Для подтверждённого основания требуется проверенная действующая редакция источника. Сначала завершите проверку в нормативной библиотеке",
      );
    sources.push({
      ...definition(revision.definition),
      sourceId: revision.sourceId,
      sourceRevisionId: revision.id,
    });
  }
  return { ...profile, sources };
}
export async function listSourceLibrary(c: Context, input: unknown) {
  assertRead(c);
  const q = parse(
    z
      .object({
        search: z.string().max(300).default(""),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25),
      })
      .strict(),
    input,
  );
  const where = {
    tenantId: c.tenantId,
    ...(q.search
      ? { title: { contains: q.search, mode: "insensitive" as const } }
      : {}),
  };
  const [sources, total] = await Promise.all([
    db.regulatorySource.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.regulatorySource.count({ where }),
  ]);
  return {
    items: await Promise.all(
      sources.map(async (source) => ({
        id: source.id,
        title: source.title,
        canEdit: canManageLearning(c.role) || source.createdBy === c.userId,
        canConfirm: canManageLearning(c.role) || c.role === "EXPERT",
        revisions: (
          await db.regulatorySourceRevision.findMany({
            where: { tenantId: c.tenantId, sourceId: source.id },
            orderBy: { version: "desc" },
            take: 100,
          })
        ).map((row) => ({
          id: row.id,
          version: row.version,
          definition: row.definition,
          checkedAt: row.checkedAt,
          reviewNote: row.reviewNote,
          createdAt: row.createdAt,
        })),
      })),
    ),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}
export async function saveSourceRevision(
  c: Context,
  input: unknown,
  id?: string,
) {
  assertRead(c);
  const body = parse(
    z
      .object({
        definition: z.unknown(),
        expectedVersion: z.number().int().min(0),
        confirmed: z.boolean().default(false),
        reviewNote: z.string().trim().max(4000).default(""),
      })
      .strict(),
    input,
  );
  const next = definition(body.definition);
  if (
    body.confirmed &&
    (!body.reviewNote || (!canManageLearning(c.role) && c.role !== "EXPERT"))
  )
    fail(
      403,
      "SOURCE_REVIEW_AUTHORITY",
      "Подтверждение источника требует решения эксперта или администратора и основания проверки",
    );
  return transaction(async (tx) => {
    if (id)
      await tx.$executeRaw`SELECT id FROM "RegulatorySource" WHERE "tenantId"=${c.tenantId} AND id=${id} FOR UPDATE`;
    const source = id
      ? await tx.regulatorySource.findFirst({
          where: { tenantId: c.tenantId, id },
        })
      : await tx.regulatorySource.create({
          data: {
            tenantId: c.tenantId,
            title: next.title,
            createdBy: c.userId,
          },
        });
    if (!source) fail(404, "NOT_FOUND", "Источник не найден");
    const previous = await tx.regulatorySourceRevision.findFirst({
      where: { tenantId: c.tenantId, sourceId: source.id },
      orderBy: { version: "desc" },
    });
    const canEdit = canManageLearning(c.role) || source.createdBy === c.userId;
    if (
      !canEdit &&
      !(
        c.role === "EXPERT" &&
        body.confirmed &&
        previous &&
        hash(previous.definition) === hash(next)
      )
    )
      fail(
        403,
        "SOURCE_EDIT_DENIED",
        "Редакцию изменяет её ответственный методист; эксперт подтверждает сохранённый текст",
      );
    if ((previous?.version || 0) !== body.expectedVersion) {
      if (
        previous &&
        hash(previous.definition) === hash(next) &&
        !!previous.checkedAt === body.confirmed &&
        previous.reviewNote === body.reviewNote
      )
        return previous;
      fail(
        409,
        "REVISION_CONFLICT",
        "Источник изменён. Откройте актуальную редакцию",
      );
    }
    const revision = await tx.regulatorySourceRevision.create({
      data: {
        tenantId: c.tenantId,
        sourceId: source.id,
        version: (previous?.version || 0) + 1,
        definition: json(next),
        createdBy: c.userId,
        checkedBy: body.confirmed ? c.userId : null,
        checkedAt: body.confirmed ? new Date() : null,
        reviewNote: body.reviewNote,
      },
    });
    await tx.regulatorySource.update({
      where: { id: source.id },
      data: { title: next.title },
    });
    const courses = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT DISTINCT v."courseId" AS id FROM "RegulatoryProfileVersion" p JOIN "CourseVersion" v ON v."tenantId"=p."tenantId" AND v."regulatoryProfileVersionId"=p.id WHERE p."tenantId"=${c.tenantId} AND EXISTS(SELECT 1 FROM jsonb_array_elements(p.definition->'sources') s WHERE s->>'sourceId'=${source.id})`,
    );
    for (const course of courses) {
      const owner = await tx.lmsTeachingBinding.findFirst({
        where: {
          tenantId: c.tenantId,
          courseId: course.id,
          groupId: null,
          revokedAt: null,
          role: "METHODIST",
          permissions: { array_contains: ["READ", "EDIT"] },
        },
        orderBy: { createdAt: "asc" },
      });
      await tx.regulatorySourceTask.create({
        data: {
          tenantId: c.tenantId,
          sourceId: source.id,
          sourceRevisionId: revision.id,
          courseId: course.id,
          assigneeId: owner?.userId,
          dueAt: new Date(Date.now() + 14 * 86400000),
          createdBy: c.userId,
        },
      });
      const review = await tx.regulatoryReview.upsert({
        where: {
          tenantId_courseId: { tenantId: c.tenantId, courseId: course.id },
        },
        create: {
          tenantId: c.tenantId,
          courseId: course.id,
          status: "REVIEW_REQUIRED",
          note: `Новая редакция источника: ${next.title}`,
          updatedBy: c.userId,
        },
        update: {
          status: "REVIEW_REQUIRED",
          note: `Новая редакция источника: ${next.title}`,
          updatedBy: c.userId,
        },
      });
      await enqueueRegulatoryNotification(tx, review);
    }
    await audit(tx, c, "LMS_REGULATORY_SOURCE_REVISED", source.id, {
      version: revision.version,
      confirmed: body.confirmed,
      affectedCourses: courses.length,
    });
    return revision;
  });
}
export async function sourceTasks(c: Context, input: unknown = {}) {
  assertRead(c);
  const query = parse(
    z.object({ page: z.coerce.number().int().min(1).default(1) }),
    input,
  );
  const scope = courseScopeSql(c, "course");
  const from = Prisma.sql`FROM "RegulatorySourceTask" task JOIN "Course" course ON course."tenantId"=task."tenantId" AND course.id=task."courseId" JOIN "RegulatorySource" s ON s."tenantId"=task."tenantId" AND s.id=task."sourceId" LEFT JOIN "User" u ON u."tenantId"=task."tenantId" AND u.id=task."assigneeId" WHERE task."tenantId"=${c.tenantId} AND (${scope})`;
  const items = await db.$queryRaw<
    Array<{
      id: string;
      courseId: string;
      title: string;
      sourceTitle: string;
      revision: number;
      status: string;
      note: string;
      dueAt: Date | null;
      assigneeId: string | null;
      assigneeName: string | null;
    }>
  >(
    Prisma.sql`SELECT task.*,course."titleRu" AS title,s.title AS "sourceTitle",u."displayName" AS "assigneeName" ${from} ORDER BY task."createdAt" DESC,task.id LIMIT 25 OFFSET ${(query.page - 1) * 25}`,
  );
  const [count] = await db.$queryRaw<Array<{ count: number }>>(
    Prisma.sql`SELECT COUNT(*)::int AS count ${from}`,
  );
  const editable = await Promise.all(
    items.map(async (item) => {
      const canEdit = await hasLearningPermission(
        c,
        item.courseId,
        null,
        "EDIT",
      );
      const assignees = canEdit
        ? await db.$queryRaw<
            Array<{ id: string; displayName: string }>
          >(Prisma.sql`
      SELECT person.id,person."displayName" FROM "User" person WHERE person."tenantId"=${c.tenantId} AND person.active=true AND
      (person.role IN ('DIRECTOR','ADMIN','SUPER_ADMIN') OR EXISTS(SELECT 1 FROM "LmsTeachingBinding" binding WHERE binding."tenantId"=person."tenantId" AND binding."userId"=person.id AND binding."courseId"=${item.courseId} AND binding."groupId" IS NULL AND binding."revokedAt" IS NULL AND binding.role='METHODIST' AND binding.permissions @> '["READ","EDIT"]'::jsonb)) ORDER BY person."displayName",person.id`)
        : [];
      return { ...item, canEdit, assignees };
    }),
  );
  return {
    items: editable,
    total: count.count,
    page: query.page,
    pageSize: 25,
  };
}
export async function resolveSourceTask(
  c: Context,
  id: string,
  input: unknown,
) {
  assertRead(c);
  const body = parse(
    z
      .object({
        revision: z.number().int().min(0),
        status: z.enum(["OPEN", "IN_REVIEW", "RESOLVED", "DISMISSED"]),
        note: z.string().trim().min(1).max(4000),
        assigneeId: z.string().uuid().nullable().optional(),
        dueAt: z.string().datetime().nullable().optional(),
      })
      .strict(),
    input,
  );
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "RegulatorySourceTask" WHERE "tenantId"=${c.tenantId} AND id=${id} FOR UPDATE`;
    const task = await tx.regulatorySourceTask.findFirst({
      where: { tenantId: c.tenantId, id },
    });
    if (!task) fail(404, "NOT_FOUND", "Задача не найдена");
    await assertLearningPermission(c, task.courseId, null, "EDIT", tx);
    if (task.revision !== body.revision)
      fail(
        409,
        "REVISION_CONFLICT",
        "Задача изменена. Откройте сохранённую версию",
      );
    if (body.assigneeId) {
      const user = await tx.user.findFirst({
        where: { tenantId: c.tenantId, id: body.assigneeId, active: true },
      });
      if (
        !user ||
        !(await hasLearningPermission(
          { ...c, userId: user.id, role: user.role },
          task.courseId,
          null,
          "EDIT",
          tx,
        ))
      )
        fail(
          400,
          "SOURCE_ASSIGNEE_INVALID",
          "Ответственный должен иметь право редактировать программу",
        );
    }
    if (body.status === "RESOLVED") {
      const latest = await tx.courseVersion.findFirst({
        where: { tenantId: c.tenantId, courseId: task.courseId },
        orderBy: { version: "desc" },
      });
      const profile =
        latest &&
        (await tx.regulatoryProfileVersion.findFirst({
          where: {
            tenantId: c.tenantId,
            id: latest.regulatoryProfileVersionId,
          },
        }));
      if (
        !profile ||
        !regulatoryProfileSchema
          .parse(profile.definition)
          .sources.some(
            (source) => source.sourceRevisionId === task.sourceRevisionId,
          )
      )
        fail(
          409,
          "SOURCE_UPDATE_REQUIRED",
          "Сначала выберите новую редакцию источника в новой версии программы; либо запишите решение «Изменение не требуется»",
        );
    }
    const updated = await tx.regulatorySourceTask.update({
      where: { id },
      data: {
        ...body,
        dueAt:
          body.dueAt === undefined
            ? undefined
            : body.dueAt
              ? new Date(body.dueAt)
              : null,
        revision: { increment: 1 },
      },
    });
    await audit(tx, c, "LMS_REGULATORY_TASK_DECISION", id, {
      before: {
        status: task.status,
        note: task.note,
        assigneeId: task.assigneeId,
        dueAt: task.dueAt,
      },
      after: {
        status: updated.status,
        note: updated.note,
        assigneeId: updated.assigneeId,
        dueAt: updated.dueAt,
      },
    });
    return updated;
  });
}

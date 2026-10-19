import {
  z,
  canManageLearning,
  lmsQuestionSchema,
  courseContentSchema,
  type LmsQuestion,
  type CourseContent,
} from "@demo/contracts";
import { Prisma } from "@demo/database";
import {
  db,
  parse,
  transaction,
  audit,
  fail,
  json,
  type Context,
} from "../core";
import {
  assertLearningPermission,
  hasLearningPermission,
  isTeachingRole,
  teachingBindingPermissionWhere,
} from "./learning-permissions";
import { assertQuestionPublishable } from "./validation";
import { questionSemanticHash, embeddedQuestionId } from "./question-semantics";

const questionInput = z
  .object({
    question: lmsQuestionSchema,
    originCourseId: z.string().max(100).nullable().optional(),
    originQuestionId: z.string().max(100).nullable().optional(),
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();
const listInput = z
  .object({
    search: z.string().max(300).default(""),
    category: z.string().max(1000).default(""),
    topic: z.string().max(1000).default(""),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(30),
    courseId: z.string().uuid().optional(),
  })
  .strict();

function revisionView(row: {
  id: string;
  questionBankId: string;
  version: number;
  definition: Prisma.JsonValue;
}) {
  return {
    id: row.id,
    version: row.version,
    question: {
      ...lmsQuestionSchema.parse(row.definition),
      id: row.questionBankId,
      version: row.version,
      libraryQuestionId: row.questionBankId,
      libraryRevisionId: row.id,
    },
  };
}
export async function listQuestions(c: Context, input: unknown) {
  const q = parse(listInput, input);
  let allowedCourses: string[] | undefined;
  if (c.learningMode || !canManageLearning(c.role)) {
    if (!isTeachingRole(c))
      fail(403, "LEARNING_PERMISSION_DENIED", "Библиотека вопросов доступна автору программы и администратору");
    allowedCourses = (
      await db.lmsTeachingBinding.findMany({
        where: {
          tenantId: c.tenantId,
          userId: c.userId,
          groupId: null,
          revokedAt: null,
          AND: [
            teachingBindingPermissionWhere("READ"),
            { OR: [teachingBindingPermissionWhere("EDIT"), teachingBindingPermissionWhere("PUBLISH")] },
          ],
          ...(q.courseId ? { courseId: q.courseId } : {}),
        },
        select: { courseId: true },
      })
    ).map((binding) => binding.courseId);
  }
  const where: Prisma.QuestionBankWhereInput = {
    tenantId: c.tenantId,
    ...(allowedCourses
      ? { AND: [{ OR: [{ originCourseId: { in: allowedCourses } }, ...(c.role === "METHODIST" && !c.learningMode ? [{ originCourseId: null }] : [])] }] }
      : q.courseId
        ? { AND: [{ OR: [{ originCourseId: q.courseId }, { originCourseId: null }] }] }
        : {}),
    ...(q.category ? { category: q.category } : {}),
    ...(q.topic ? { topic: q.topic } : {}),
    ...(q.search
      ? {
          OR: [
            { category: { contains: q.search, mode: "insensitive" } },
            { topic: { contains: q.search, mode: "insensitive" } },
            { searchText: { contains: q.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [banks, total] = await Promise.all([
    db.questionBank.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.questionBank.count({ where }),
  ]);
  const ids = banks.map((row) => row.id);
  const revisions = banks.length
    ? await db.$queryRaw<
        Array<{
          id: string;
          questionBankId: string;
          version: number;
          definition: Prisma.JsonValue;
        }>
      >`
    SELECT r.id, r."questionBankId", r.version, r.definition FROM "QuestionBank" b
    JOIN LATERAL (SELECT id, "questionBankId", version, definition FROM "QuestionRevision"
      WHERE "tenantId"=${c.tenantId} AND "questionBankId"=b.id ORDER BY version DESC LIMIT 1) r ON true
    WHERE b."tenantId"=${c.tenantId} AND b.id=ANY(${ids}::text[])`
    : [];
  return {
    items: banks.map((bank) => ({
      ...bank,
      canEdit: !c.learningMode && (canManageLearning(c.role) || (!bank.originCourseId && bank.createdBy === c.userId) || !!allowedCourses?.includes(bank.originCourseId || "")),
      latestRevision: revisionView(
        revisions.find((row) => row.questionBankId === bank.id)!,
      ),
    })),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}
export async function questionRevisions(c: Context, id: string) {
  const bank = await db.questionBank.findFirst({
    where: { id, tenantId: c.tenantId },
  });
  if (!bank) fail(404, "NOT_FOUND", "Вопрос не найден");
  await assertBankPermission(c, bank.originCourseId, "READ", db, bank.createdBy);
  const revisions = await db.questionRevision.findMany({
    where: { tenantId: c.tenantId, questionBankId: id },
    orderBy: { version: "desc" },
    take: 100,
  });
  return { ...bank, revisions: revisions.map(revisionView) };
}
export async function saveQuestion(c: Context, input: unknown, id?: string) {
  const data = parse(questionInput, input);
  assertQuestionPublishable(data.question);
  return transaction(async (tx) => {
    let originCourseId: string | null = null;
    let originQuestionId: string | null = null;
    if (!id && !data.originCourseId) await assertBankPermission(c, null, "EDIT", tx);
    if (!id && data.originCourseId) {
      const origin = await tx.course.findFirst({
        where: { id: data.originCourseId, tenantId: c.tenantId },
      });
      if (!origin) fail(404, "NOT_FOUND", "Курс не найден");
      await assertBankPermission(c, origin.id, "EDIT", tx);
      originCourseId = origin.id;
      if (data.originQuestionId) {
        const versions = await tx.courseVersion.findMany({
          where: { courseId: origin.id, tenantId: c.tenantId },
          orderBy: { version: "desc" },
          take: 1,
        });
        const embedded =
          versions[0] &&
          allCourseQuestions(
            courseContentSchema.parse(versions[0].content),
          ).find(
            (q) =>
              q.id === data.originQuestionId ||
              q.id ===
                embeddedQuestionId(origin.id, data.originQuestionId || ""),
          );
        if (
          !embedded ||
          questionSemanticHash(embedded) !== questionSemanticHash(data.question)
        )
          fail(
            409,
            "QUESTION_ORIGIN_CONFLICT",
            "Сохраните вопрос курса перед переносом в библиотеку",
          );
        originQuestionId = embedded.id;
      }
    }
    if (id)
      await tx.$executeRaw`SELECT id FROM "QuestionBank" WHERE id=${id} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    if (!id && !data.originCourseId) {
      const meaning = questionSemanticHash(data.question);
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${c.tenantId}),hashtext(${meaning}))`);
      const duplicate = await tx.$queryRaw<Array<{ id: string; questionBankId: string; version: number; definition: Prisma.JsonValue }>>(Prisma.sql`SELECT r.id,r."questionBankId",r.version,r.definition FROM "QuestionRevision" r JOIN "QuestionBank" b ON b."tenantId"=r."tenantId" AND b.id=r."questionBankId" WHERE r."tenantId"=${c.tenantId} AND r."semanticHash"=${meaning} AND b."originCourseId" IS NULL AND (${canManageLearning(c.role)} OR b."createdBy"=${c.userId}) ORDER BY r.version DESC LIMIT 1`);
      if (duplicate[0]) return revisionView(duplicate[0]);
    }
    const bank = id
      ? await tx.questionBank.findFirst({ where: { id, tenantId: c.tenantId } })
      : await tx.questionBank.create({
          data: {
            tenantId: c.tenantId,
            createdBy: c.userId,
            category: data.question.category,
            topic: data.question.topic || "",
            searchText: `${data.question.promptRu}\n${data.question.promptKz}`,
            originCourseId,
            originQuestionId,
          },
        });
    if (!bank) fail(404, "NOT_FOUND", "Вопрос не найден");
    await assertBankPermission(c, bank.originCourseId, "EDIT", tx, bank.createdBy);
    const previous = await tx.questionRevision.findFirst({
      where: { tenantId: c.tenantId, questionBankId: bank.id },
      orderBy: { version: "desc" },
    });
    const semanticHash = questionSemanticHash(data.question);
    if (previous?.semanticHash === semanticHash) return revisionView(previous);
    const selectedRevision = data.question.libraryRevisionId
      ? await tx.questionRevision.findFirst({
          where: {
            id: data.question.libraryRevisionId,
            tenantId: c.tenantId,
            questionBankId: bank.id,
          },
        })
      : null;
    if (
      previous &&
      (selectedRevision?.version || data.expectedVersion) !== previous.version
    )
      fail(
        409,
        "REVISION_CONFLICT",
        "Вопрос изменён. Откройте актуальную редакцию",
      );
    const revision = await tx.questionRevision.create({
      data: {
        tenantId: c.tenantId,
        questionBankId: bank.id,
        version: (previous?.version || 0) + 1,
        definition: json({
          ...data.question,
          id: bank.id,
          version: (previous?.version || 0) + 1,
          libraryQuestionId: null,
          libraryRevisionId: null,
        }),
        semanticHash,
        createdBy: c.userId,
      },
    });
    await tx.questionBank.update({
      where: { id: bank.id },
      data: {
        category: data.question.category,
        topic: data.question.topic || "",
        searchText: `${data.question.promptRu}\n${data.question.promptKz}`,
      },
    });
    await audit(
      tx,
      c,
      previous ? "LMS_QUESTION_REVISED" : "LMS_QUESTION_CREATED",
      bank.id,
      {
        before: previous
          ? { version: previous.version, semanticHash: previous.semanticHash }
          : null,
        after: { version: revision.version, semanticHash },
        originCourseId,
        originQuestionId,
      },
    );
    return revisionView(revision);
  });
}

/** Autosave normalizes one draft against its last published baseline; it writes no immutable revisions. */
export async function normalizeCourseQuestions(
  tx: Prisma.TransactionClient,
  c: Context,
  courseId: string,
  content: CourseContent,
  current?: CourseContent,
  publishing = false,
) {
  const published = await tx.courseVersion.findFirst({
    where: { tenantId: c.tenantId, courseId, status: "PUBLISHED" },
    orderBy: { version: "desc" },
  });
  const baseline = published
    ? allCourseQuestions(courseContentSchema.parse(published.content))
    : [];
  const revisionIds = [
    ...new Set(
      allCourseQuestions(content).flatMap((q) =>
        q.libraryRevisionId ? [q.libraryRevisionId] : [],
      ),
    ),
  ];
  const library = revisionIds.length
    ? await tx.questionRevision.findMany({
        where: { tenantId: c.tenantId, id: { in: revisionIds } },
      })
    : [];
  if ((c.learningMode || !canManageLearning(c.role)) && library.length) {
    const banks = await tx.questionBank.findMany({
      where: {
        tenantId: c.tenantId,
        id: { in: library.map((revision) => revision.questionBankId) },
      },
      select: { originCourseId: true, createdBy: true },
    });
    for (const bank of banks)
      await assertBankPermission(c, bank.originCourseId, "READ", tx, bank.createdBy);
  }
  const normalize = (q: LmsQuestion): LmsQuestion => {
    if (q.libraryRevisionId) {
      const revision = library.find(
        (row) =>
          row.id === q.libraryRevisionId &&
          row.questionBankId === q.libraryQuestionId,
      );
      if (!revision)
        fail(404, "QUESTION_NOT_FOUND", "Редакция вопроса недоступна");
      if (questionSemanticHash(q) === revision.semanticHash)
        return revisionView(revision).question;
    }
    const canonical = (current ? allCourseQuestions(current) : []).find(
      (old) => old.id === q.id || old.id === embeddedQuestionId(courseId, q.id),
    );
    const existing = baseline.find((old) => old.id === (canonical?.id || q.id));
    const id =
      q.libraryQuestionId && publishing
        ? embeddedQuestionId(courseId, q.libraryQuestionId)
        : canonical?.id || existing?.id || embeddedQuestionId(courseId, q.id);
    // A modified library question becomes a course-local question on publish.
    // Reusing that local identity must continue its own published revisions.
    const pinned = baseline.find((old) => old.id === id);
    const version = pinned
      ? pinned.version +
        (questionSemanticHash(pinned) === questionSemanticHash(q) ? 0 : 1)
      : 1;
    return {
      ...q,
      id,
      version,
      libraryQuestionId: publishing ? null : q.libraryQuestionId || null,
      libraryRevisionId: publishing ? null : q.libraryRevisionId || null,
    };
  };
  return {
    ...content,
    exam: { ...content.exam, questions: content.exam.questions.map(normalize) },
    modules: content.modules.map((module) => ({
      ...module,
      lessons: module.lessons.map((lesson) => ({
        ...lesson,
        ...(lesson.assessment
          ? {
              assessment: {
                ...lesson.assessment,
                questions: lesson.assessment.questions.map(normalize),
              },
            }
          : {}),
      })),
    })),
  };
}

function allCourseQuestions(content: CourseContent) {
  return [
    ...content.exam.questions,
    ...content.modules.flatMap((module) =>
      module.lessons.flatMap((lesson) => lesson.assessment?.questions || []),
    ),
  ];
}

async function assertBankPermission(
  c: Context,
  courseId: string | null,
  permission: "READ" | "EDIT",
  tx: Prisma.TransactionClient,
  createdBy?: string,
) {
  if (!c.learningMode && canManageLearning(c.role)) return;
  if (!c.learningMode && !courseId && c.role === "METHODIST" && (permission === "READ" || !createdBy || createdBy === c.userId)) return;
  if (!courseId || !isTeachingRole(c))
    fail(403, "LEARNING_PERMISSION_DENIED", "Библиотека вопросов недоступна");
  await assertLearningPermission(c, courseId, null, permission, tx);
  if (
    permission === "READ" &&
    !(await hasLearningPermission(c, courseId, null, "EDIT", tx)) &&
    !(await hasLearningPermission(c, courseId, null, "PUBLISH", tx))
  )
    fail(
      403,
      "LEARNING_PERMISSION_DENIED",
      "Библиотека вопросов доступна автору программы и администратору",
    );
}

import type { Prisma } from "@demo/database";
import {
  courseContentSchema,
  type CourseContent,
} from "@demo/contracts/src/lms";
import { fail, type Context } from "../core";
import { validateAccessPolicy } from "./access-policy";

export function safeLearningUrl(value: string) {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !!u.hostname &&
      !/^(localhost|127\.|0\.|169\.254\.|10\.|192\.168\.|\[|172\.(1[6-9]|2\d|3[01])\.)/i.test(
        u.hostname,
      )
    );
  } catch {
    return false;
  }
}
export function validateLearningStructure(content: CourseContent) {
  if (content.accessPolicy) validateAccessPolicy(content.accessPolicy);
  const modules = new Map(content.modules.map((m) => [m.id, m]));
  if (modules.size !== content.modules.length)
    fail(
      400,
      "MODULE_IDS_INVALID",
      "Модули должны иметь разные идентификаторы",
    );
  const seen = new Set<string>(),
    active = new Set<string>();
  function visit(id: string) {
    if (active.has(id))
      fail(
        400,
        "MODULE_PREREQUISITE_CYCLE",
        "Зависимости модулей образуют цикл",
      );
    if (seen.has(id)) return;
    const module = modules.get(id);
    if (!module)
      fail(400, "MODULE_PREREQUISITE_INVALID", "Предыдущий модуль не найден");
    active.add(id);
    for (const dep of module.prerequisiteModuleIds || []) visit(dep);
    active.delete(id);
    seen.add(id);
  }
  for (const id of modules.keys()) visit(id);
  const elementEdges = new Map(
    content.modules.flatMap((module) =>
      module.lessons.map(
        (lesson) =>
          [
            lesson.id,
            [
              ...lesson.prerequisiteLessonIds,
              ...(module.prerequisiteModuleIds || []).flatMap((id) =>
                modules
                  .get(id)!
                  .lessons.filter((l) => l.required)
                  .map((l) => l.id),
              ),
            ],
          ] as const,
      ),
    ),
  );
  const elementSeen = new Set<string>(),
    elementActive = new Set<string>();
  function visitElement(id: string) {
    if (elementActive.has(id))
      fail(
        400,
        "LEARNING_PREREQUISITE_CYCLE",
        "Зависимости модулей и элементов образуют цикл",
      );
    if (elementSeen.has(id)) return;
    const edges = elementEdges.get(id);
    if (!edges)
      fail(400, "PREREQUISITE_INVALID", "Предыдущий элемент не найден");
    elementActive.add(id);
    for (const dep of edges) visitElement(dep);
    elementActive.delete(id);
    elementSeen.add(id);
  }
  for (const id of elementEdges.keys()) visitElement(id);
  for (const lesson of content.modules.flatMap((m) => m.lessons)) {
    if (lesson.kind === "LINK" && !safeLearningUrl(lesson.url || ""))
      fail(400, "LINK_INVALID", "Укажите безопасную ссылку HTTPS без пароля");
    if (lesson.kind === "ASSESSMENT" && !lesson.assessment)
      fail(400, "ASSESSMENT_REQUIRED", "Настройте промежуточную проверку");
    if (
      lesson.kind === "ASSIGNMENT" &&
      (!lesson.assignment ||
        !lesson.assignment.instructionsRu.trim() ||
        !lesson.assignment.instructionsKz.trim() ||
        !lesson.assignment.criteriaRu.trim() ||
        !lesson.assignment.criteriaKz.trim() ||
        (!lesson.assignment.allowText && !lesson.assignment.allowFiles))
    )
      fail(
        400,
        "ASSIGNMENT_REQUIRED",
        "Укажите задание, критерии и разрешённый способ ответа",
      );
    if (lesson.kind === "SESSION" && !lesson.session)
      fail(400, "SESSION_REQUIRED", "Укажите требование к участию в занятии");
  }
}
export async function validatePublishedDependencies(
  tx: Prisma.TransactionClient,
  c: Context,
  courseId: string,
  content: CourseContent,
) {
  validateLearningStructure(content);
  const seen = new Set<string>();
  async function visit(id: string, stack: Set<string>) {
    if (stack.has(id))
      fail(
        400,
        "COURSE_PREREQUISITE_CYCLE",
        "Зависимости курсов образуют цикл",
      );
    if (seen.has(id)) return;
    const version = await tx.courseVersion.findFirst({
      where: { tenantId: c.tenantId, courseId: id, status: "PUBLISHED" },
      orderBy: { version: "desc" },
    });
    if (!version)
      fail(
        400,
        "COURSE_PREREQUISITE_UNAVAILABLE",
        "Предыдущий курс ещё не опубликован или недоступен",
      );
    const next = new Set(stack);
    next.add(id);
    if (next.size > 100)
      fail(400, "COURSE_PREREQUISITE_DEPTH", "Слишком глубокая цепочка курсов");
    for (const dep of courseContentSchema.parse(version.content)
      .coursePrerequisites || [])
      await visit(dep.courseId, next);
    seen.add(id);
  }
  for (const dep of content.coursePrerequisites || []) {
    if (dep.versionPolicy === "AT_LEAST" && !dep.minimumVersion)
      fail(
        400,
        "PREREQUISITE_VERSION_REQUIRED",
        "Укажите минимальную версию предыдущего курса",
      );
    await visit(dep.courseId, new Set([courseId]));
    if (
      dep.minimumVersion &&
      !(await tx.courseVersion.findFirst({
        where: {
          tenantId: c.tenantId,
          courseId: dep.courseId,
          status: "PUBLISHED",
          version: { gte: dep.minimumVersion },
        },
      }))
    )
      fail(
        400,
        "PREREQUISITE_VERSION_UNAVAILABLE",
        "Такая версия предыдущего курса не опубликована",
      );
  }
}

import { Prisma, type Enrollment } from "@demo/database";
import {
  courseContentSchema,
  type CourseContent,
} from "@demo/contracts/src/lms";
import { hash, json, type Context } from "../core";
import {
  completedLearningElements,
  loadLearningElementFacts,
} from "./learning-element-facts";

export function accessOpen(
  enrollment: Pick<Enrollment, "status" | "dueAt" | "startsAt">,
  now = new Date(),
) {
  return (
    enrollment.status !== "CANCELLED" &&
    (!enrollment.startsAt || enrollment.startsAt <= now) &&
    (!enrollment.dueAt || enrollment.dueAt >= now)
  );
}

export async function evaluateLearningEligibility(
  tx: Prisma.TransactionClient,
  c: Context,
  enrollment: Enrollment,
  content: CourseContent,
  seen = new Set<string>(),
) {
  const facts = (
    await loadLearningElementFacts(tx, c.tenantId, [enrollment.id])
  ).get(enrollment.id)!;
  const lessonRows = content.modules.flatMap((m) => m.lessons);
  const completedIds = completedLearningElements(lessonRows, facts);
  const moduleComplete = new Map(
    content.modules.map((m) => [
      m.id,
      m.lessons.filter((l) => l.required).every((l) => completedIds.has(l.id)),
    ]),
  );
  const prerequisites: Array<{
    courseId: string;
    satisfied: boolean;
    basis: string;
  }> = [];
  const branch = new Set(seen);
  branch.add(enrollment.courseVersionId);
  for (const requirement of content.coursePrerequisites || []) {
    let satisfied = false;
    let cursor: string | undefined;
    for (;;) {
      const candidates = await tx.enrollment.findMany({
        where: {
          tenantId: c.tenantId,
          recipientId: enrollment.recipientId,
          status: { not: "CANCELLED" },
          learningVersion: {
            courseId: requirement.courseId,
            ...(requirement.versionPolicy === "AT_LEAST"
              ? { version: { gte: requirement.minimumVersion || 1 } }
              : {}),
          },
        },
        take: 100,
        orderBy: { id: "asc" },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const candidate of candidates) {
        if (branch.has(candidate.courseVersionId) || branch.size > 100)
          continue;
        if (requirement.basis === "LEARNING_COMPLETION")
          satisfied = !!(await tx.lmsLearningCompletion.findUnique({
            where: {
              tenantId_enrollmentId: {
                tenantId: c.tenantId,
                enrollmentId: candidate.id,
              },
            },
          }));
        else if (requirement.basis === "OFFICIAL_RESULT") {
          const result = await tx.verifiedExamResult.findFirst({
            where: { tenantId: c.tenantId, enrollmentId: candidate.id },
            orderBy: { revision: "desc" },
          });
          satisfied =
            !!result &&
            result.eligible &&
            result.verdict === "PASSED" &&
            result.assessmentKind !== "PRACTICE" &&
            !(await tx.lmsResultEvent.findFirst({
              where: {
                tenantId: c.tenantId,
                resultId: result.id,
                kind: { in: ["VOIDED", "SUPERSEDED"] },
              },
            }));
          if (satisfied && result) {
            const invalid = await tx.$queryRaw<
              Array<{ invalid: boolean }>
            >`SELECT EXISTS(SELECT 1 FROM "LmsDocumentLink" link JOIN "PrintRequest" request ON request."tenantId"=link."tenantId" AND request.id=link."requestId" WHERE link."tenantId"=${c.tenantId} AND link."resultId"=${result.id} AND (request.status='CANCELLED' OR EXISTS(SELECT 1 FROM "IssuanceEvent" event WHERE event."tenantId"=link."tenantId" AND event."issuanceId"=link."issuanceId" AND event.kind IN ('CANCELLED','REPLACED')))) AS invalid`;
            satisfied = !invalid[0]?.invalid;
          }
        } else {
          const version = await tx.courseVersion.findFirstOrThrow({
            where: { tenantId: c.tenantId, id: candidate.courseVersionId },
          });
          const sourceContent = courseContentSchema.parse(version.content);
          const profile = await tx.regulatoryProfileVersion.findFirstOrThrow({
            where: {
              tenantId: c.tenantId,
              id: version.regulatoryProfileVersionId,
            },
          });
          if (
            sourceContent.learningOutcome !== "LEARNING" &&
            (profile.definition as { assessmentKind?: string })
              .assessmentKind === "PRACTICE"
          )
            continue;
          const evaluation = await evaluateLearningEligibility(
            tx,
            c,
            candidate,
            sourceContent,
            branch,
          );
          // Trial exams are never a prerequisite fact. ELEMENTS uses only actual element facts.
          satisfied =
            evaluation.requiredCount === evaluation.completedCount &&
            evaluation.prerequisitesSatisfied;
        }
        if (satisfied) break;
      }
      if (satisfied || candidates.length < 100) break;
      cursor = candidates.at(-1)!.id;
    }
    prerequisites.push({
      courseId: requirement.courseId,
      satisfied,
      basis: requirement.basis,
    });
  }
  const prerequisitesSatisfied = prerequisites.every((p) => p.satisfied);
  const open = accessOpen(enrollment);
  const lessons = content.modules.flatMap((module) =>
    module.lessons.map((lesson) => {
      const dependency =
        lesson.prerequisiteLessonIds.every((id) => completedIds.has(id)) &&
        (module.prerequisiteModuleIds || []).every(
          (id) => moduleComplete.get(id) === true,
        );
      const reason = !open
        ? "ACCESS_CLOSED"
        : !prerequisitesSatisfied
          ? "COURSE_PREREQUISITE_REQUIRED"
          : !dependency
            ? "PREREQUISITE_REQUIRED"
            : null;
      return {
        id: lesson.id,
        complete: completedIds.has(lesson.id),
        available: reason === null,
        reason,
      };
    }),
  );
  const required = lessonRows.filter((l) => l.required);
  const requiredCount = required.length;
  const completedCount = required.filter((l) => completedIds.has(l.id)).length;
  const elementsComplete = requiredCount === completedCount;
  const finalPassed = facts.finalPassed;
  const completed =
    elementsComplete &&
    prerequisitesSatisfied &&
    finalPassed &&
    enrollment.status !== "CANCELLED";
  return {
    lessons,
    completed,
    elementsComplete,
    finalAllowed: open && elementsComplete && prerequisitesSatisfied,
    blockingReasons: [
      ...(!open ? ["ACCESS_CLOSED"] : []),
      ...(!elementsComplete ? ["LESSONS_REQUIRED"] : []),
      ...(!prerequisitesSatisfied ? ["COURSE_PREREQUISITE_REQUIRED"] : []),
    ],
    prerequisitesSatisfied,
    prerequisites,
    requiredCount,
    completedCount,
  };
}

export async function recordLearningCompletion(
  tx: Prisma.TransactionClient,
  c: Context,
  enrollment: Enrollment,
  content: CourseContent,
) {
  const evaluation = await evaluateLearningEligibility(
    tx,
    c,
    enrollment,
    content,
  );
  if (!evaluation.completed) return null;
  const existing = await tx.lmsLearningCompletion.findUnique({
    where: {
      tenantId_enrollmentId: {
        tenantId: c.tenantId,
        enrollmentId: enrollment.id,
      },
    },
  });
  if (existing) return existing;
  const snapshot = {
    courseVersionId: enrollment.courseVersionId,
    enrollmentId: enrollment.id,
    recipientId: enrollment.recipientId,
    lessons: evaluation.lessons.map((l) => ({
      id: l.id,
      complete: l.complete,
    })),
    prerequisites: evaluation.prerequisites,
    basis: "VERIFIED_LEARNING_FACTS",
    legalDocument: false,
  };
  const completion = await tx.lmsLearningCompletion.create({
    data: {
      tenantId: c.tenantId,
      enrollmentId: enrollment.id,
      courseVersionId: enrollment.courseVersionId,
      snapshot: json(snapshot),
      snapshotHash: hash(snapshot),
    },
  });
  // A non-regulatory completion must also leave the incomplete list and stop
  // inheriting later group extensions. Legacy regulatory results keep their
  // existing lifecycle; this is not an issuance or a historical backfill.
  if (content.learningOutcome === "LEARNING") {
    await tx.enrollment.updateMany({
      where: { tenantId: c.tenantId, id: enrollment.id, status: "ACTIVE" },
      data: {
        status: "COMPLETED",
        completedAt: enrollment.completedAt || completion.completedAt,
      },
    });
  }
  return completion;
}

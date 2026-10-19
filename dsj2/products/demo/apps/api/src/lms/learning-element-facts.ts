import { Prisma } from "@demo/database";

export type LearningElement = {
  id: string;
  kind: string;
  required: boolean;
  session?: { attendanceRequired: boolean };
};

export async function loadLearningElementFacts(
  tx: Prisma.TransactionClient,
  tenantId: string,
  enrollmentIds: string[],
) {
  if (!enrollmentIds.length) return new Map<string, LearningElementFacts>();
  const [progress, attempts, submissions, attendance] = await Promise.all([
    tx.lessonProgress.findMany({
      where: {
        tenantId,
        enrollmentId: { in: enrollmentIds },
        completedAt: { not: null },
      },
      select: { enrollmentId: true, lessonId: true },
    }),
    tx.examAttempt.findMany({
      where: { tenantId, enrollmentId: { in: enrollmentIds } },
      select: {
        enrollmentId: true,
        assessmentId: true,
        purpose: true,
        state: true,
        verdict: true,
        assessmentKind: true,
        id: true,
      },
    }),
    tx.$queryRaw<Array<{ enrollmentId: string; elementId: string }>>(Prisma.sql`
      SELECT s."enrollmentId",s."elementId" FROM "LmsSubmission" s
      JOIN "LmsSubmissionRevision" r ON r."tenantId"=s."tenantId" AND r."submissionId"=s.id AND r.revision=s."currentRevision"
      JOIN "LmsReviewDecision" d ON d."tenantId"=s."tenantId" AND d."submissionRevisionId"=r.id AND d."contentHash"=r.hash
      WHERE s."tenantId"=${tenantId} AND s."enrollmentId" IN (${Prisma.join(enrollmentIds)}) AND s.state='ACCEPTED' AND d.decision='ACCEPTED'`),
    tx.$queryRaw<
      Array<{ enrollmentId: string; requirementId: string }>
    >(Prisma.sql`
      SELECT e.id AS "enrollmentId",event."requirementId" FROM "Enrollment" e
      JOIN "LmsTeachingEvent" event ON event."tenantId"=e."tenantId" AND event."courseVersionId"=e."courseVersionId" AND event."groupId"=e."groupId"
      CROSS JOIN LATERAL (SELECT status FROM "LmsAttendance" record WHERE record."tenantId"=event."tenantId" AND record."eventId"=event.id AND record."enrollmentId"=e.id ORDER BY revision DESC LIMIT 1) a
      WHERE e."tenantId"=${tenantId} AND e.id IN (${Prisma.join(enrollmentIds)}) AND event.status='SCHEDULED' AND event."requirementId" IS NOT NULL AND a.status='PRESENT'`),
  ]);
  const facts = new Map(
    enrollmentIds.map((id) => [
      id,
      {
        acknowledged: new Set<string>(),
        assessed: new Set<string>(),
        accepted: new Set<string>(),
        attended: new Set<string>(),
        finalPassed: false,
      },
    ]),
  );
  for (const row of progress)
    facts.get(row.enrollmentId)!.acknowledged.add(row.lessonId);
  for (const row of attempts) {
    if (row.state !== "FINISHED" || row.verdict !== "PASSED") continue;
    const fact = facts.get(row.enrollmentId)!;
    if (row.purpose === "INTERMEDIATE") fact.assessed.add(row.assessmentId);
    if (
      row.purpose === "LEARNING_FINAL" ||
      (row.purpose === "FINAL" && row.assessmentKind === "CENTER_EXAM")
    )
      fact.finalPassed = true;
  }
  for (const row of submissions)
    facts.get(row.enrollmentId)!.accepted.add(row.elementId);
  for (const row of attendance)
    facts.get(row.enrollmentId)!.attended.add(row.requirementId);
  return facts;
}

export type LearningElementFacts = {
  acknowledged: Set<string>;
  assessed: Set<string>;
  accepted: Set<string>;
  attended: Set<string>;
  finalPassed: boolean;
};

// Both the paginated list and the admission evaluator consume the same facts.
export function completedLearningElements(
  elements: LearningElement[],
  facts: LearningElementFacts,
) {
  return new Set(
    elements
      .filter((element) => {
        if (element.kind === "ASSESSMENT")
          return facts.assessed.has(element.id);
        if (element.kind === "ASSIGNMENT")
          return facts.accepted.has(element.id);
        if (element.kind === "SESSION" && element.session?.attendanceRequired)
          return facts.attended.has(element.id);
        return facts.acknowledged.has(element.id);
      })
      .map((element) => element.id),
  );
}

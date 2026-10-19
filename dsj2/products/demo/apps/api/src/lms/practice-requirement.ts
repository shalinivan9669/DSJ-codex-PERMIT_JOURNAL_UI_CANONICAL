import { Prisma, type Enrollment } from "@demo/database";
import type { CourseContent, RegulatoryProfile } from "@demo/contracts/src/lms";
import type { Context } from "../core";

/** Only the explicitly configured online route can use reviewed work as practice evidence. */
export async function evaluatePracticeRequirement(
  tx: Prisma.TransactionClient,
  c: Context,
  enrollment: Enrollment,
  content: CourseContent,
  profile: RegulatoryProfile,
) {
  const requiredElementIds = content.modules
    .flatMap((module) => module.lessons)
    .filter(
      (lesson) =>
        lesson.required &&
        lesson.kind ===
          (profile.practiceEvidenceMode === "IN_PERSON"
            ? "SESSION"
            : "ASSIGNMENT"),
    )
    .map((lesson) => lesson.id);
  const mode = profile.practiceEvidenceMode || "UNSPECIFIED";
  type Evidence = {
    elementId: string;
    submissionRevisionId?: string;
    eventId?: string;
    decisionId: string;
    contentHash: string;
    reviewedBy: string;
    reviewedAt: Date;
  };
  if (!profile.requiresPractice)
    return {
      satisfied: true,
      reason: null,
      mode,
      requiredElementIds,
      evidence: [] as Evidence[],
    };
  if (mode === "IN_PERSON") {
    if (!requiredElementIds.length)
      return {
        satisfied: false,
        reason: "PRACTICE_SESSION_REQUIRED",
        mode,
        requiredElementIds,
        evidence: [] as Evidence[],
      };
    const evidence = await tx.$queryRaw<Evidence[]>(Prisma.sql`
      SELECT e."requirementId" AS "elementId",e.id AS "eventId",d.id AS "decisionId",d."contentHash",d."actorId" AS "reviewedBy",d."createdAt" AS "reviewedAt"
      FROM "LmsTeachingEvent" e JOIN LATERAL (SELECT * FROM "LmsReviewDecision" r WHERE r."tenantId"=e."tenantId" AND r."targetType"='PRACTICE' AND r."targetId"=e.id||':'||${enrollment.id} ORDER BY r.revision DESC LIMIT 1) d ON true
      WHERE e."tenantId"=${c.tenantId} AND e."courseVersionId"=${enrollment.courseVersionId} AND e.status='SCHEDULED' AND e."endsAt"<=CURRENT_TIMESTAMP
        AND e."requirementId" IN (${Prisma.join(requiredElementIds)}) AND d.decision='ACCEPTED'
        AND EXISTS(SELECT 1 FROM "LmsGroupMember" m WHERE m."tenantId"=e."tenantId" AND m."groupId"=e."groupId" AND m."enrollmentId"=${enrollment.id} AND m."excludedAt" IS NULL)`);
    const satisfied = requiredElementIds.every((id) =>
      evidence.some((item) => item.elementId === id),
    );
    return {
      satisfied,
      reason: satisfied ? null : "IN_PERSON_PRACTICE_REQUIRED",
      mode,
      requiredElementIds,
      evidence,
    };
  }
  if (mode !== "REVIEWED_ASSIGNMENTS" || content.metadata?.format === "IN_PERSON") {
    return {
      satisfied: false,
      reason: "PRACTICE_MODE_REQUIRED",
      mode,
      requiredElementIds,
      evidence: [] as Evidence[],
    };
  }
  if (!requiredElementIds.length)
    return {
      satisfied: false,
      reason: "PRACTICE_ASSIGNMENT_REQUIRED",
      mode,
      requiredElementIds,
      evidence: [] as Evidence[],
    };
  const evidence = await tx.$queryRaw<Evidence[]>(Prisma.sql`
    SELECT s."elementId",r.id AS "submissionRevisionId",d.id AS "decisionId",d."contentHash",d."actorId" AS "reviewedBy",d."createdAt" AS "reviewedAt"
    FROM "LmsSubmission" s
    JOIN "LmsSubmissionRevision" r ON r."tenantId"=s."tenantId" AND r."submissionId"=s.id AND r.revision=s."currentRevision"
    JOIN "LmsReviewDecision" d ON d."tenantId"=s."tenantId" AND d."submissionRevisionId"=r.id AND d."contentHash"=r.hash
    WHERE s."tenantId"=${c.tenantId} AND s."enrollmentId"=${enrollment.id} AND s."elementId" IN (${Prisma.join(requiredElementIds)})
      AND s.state='ACCEPTED' AND d.decision='ACCEPTED'
    ORDER BY s."elementId",d.id`);
  const satisfied = requiredElementIds.every((id) =>
    evidence.some((item) => item.elementId === id),
  );
  return {
    satisfied,
    reason: satisfied ? null : "PRACTICE_REVIEW_REQUIRED",
    mode,
    requiredElementIds,
    evidence,
  };
}

import { readFile, writeFile } from "node:fs/promises";
import { PrismaClient } from "../../packages/database/src";

async function main() {
  const target = new URL(process.env.DATABASE_URL!);
  if (target.hostname !== "127.0.0.1" || target.port !== "55489" || target.pathname !== "/demo_test_mvp_roles_20261019_run01_browser") throw new Error("ISOLATED_BROWSER_REQUIRED");
  const runtime = ".runtime/mvp-all-roles-20261019/run-01";
  const fixture = JSON.parse(await readFile(`${runtime}/browser-fixture.json`, "utf8"));
  const chain = JSON.parse(await readFile(`${runtime}/chain-result.json`, "utf8"));
  const db = new PrismaClient();
  try {
    const evidence = await db.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const bootstrap = await tx.auditEvent.findMany({ where: { tenantId: fixture.otherTenantId, actorId: fixture.users.bootstrap.id, action: "FIRST_SUPER_ADMIN_EXPLICITLY_ASSIGNED" }, select: { id: true, action: true, actorId: true, createdAt: true } });
      const result = await tx.verifiedExamResult.findUniqueOrThrow({ where: { id: chain.resultId }, select: { id: true, enrollmentId: true, attemptId: true, verdict: true, assessmentKind: true, eligible: true, score: true, maximum: true, snapshotHash: true, courseVersionId: true, regulatoryProfileVersionId: true } });
      const attempts = await tx.examAttempt.findMany({ where: { enrollmentId: chain.enrollmentId }, select: { id: true, assessmentId: true, state: true, purpose: true, startedAt: true, finishedAt: true, verdict: true, score: true, maximum: true, sequence: true } });
      const submissions = await tx.lmsSubmission.findMany({ where: { enrollmentId: chain.enrollmentId }, select: { id: true, elementId: true, state: true, currentRevision: true, sequence: true } });
      const revisions = await tx.lmsSubmissionRevision.findMany({ where: { submissionId: { in: submissions.map(x => x.id) } }, select: { id: true, revision: true, hash: true, submittedAt: true }, orderBy: { revision: "asc" } });
      const decisions = await tx.lmsReviewDecision.findMany({ where: { targetId: { in: submissions.map(x => x.id) } }, select: { id: true, targetId: true, revision: true, decision: true, createdAt: true } });
      return { capturedAt: new Date().toISOString(), readOnly: true, database: target.pathname.slice(1), bootstrap, result, attempts, submissions, revisions, decisions };
    });
    console.log(JSON.stringify({bootstrap:evidence.bootstrap.length,result:evidence.result,decisions:evidence.decisions.map(x=>x.decision)}));
    if (!evidence.bootstrap.length || evidence.result.verdict !== "PASSED" || !evidence.result.eligible || !evidence.decisions.some(x => x.decision === "RETURNED") || !evidence.decisions.some(x => x.decision === "ACCEPTED")) throw new Error("CHAIN_EVIDENCE_MISSING");
    await writeFile("docs/evidence/mvp-all-roles-20261019/run-01/learning/PERSISTED_CHAIN.json", JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify({ bootstrap: evidence.bootstrap.length, attempts: evidence.attempts.length, revisions: evidence.revisions.length, verdict: evidence.result.verdict }));
  } finally { await db.$disconnect(); }
}
void main();

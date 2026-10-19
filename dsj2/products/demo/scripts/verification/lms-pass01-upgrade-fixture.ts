import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { db, hash } from "../../apps/api/src/core";
import { lmsCourse } from "../../tests/integration/lms-fixture";

const extended = process.env.DATABASE_URL?.includes(
  "/demo_test_lms_pass01_upgrade_extended",
);
const stateFile = `.runtime/lms-pass01-20261018/upgrade${extended ? "-extended" : ""}-before.json`;
const evidenceFile = `docs/evidence/lms-full-tz-pass-01-20261018/MIGRATION_UPGRADE${extended ? "_EXTENDED" : ""}.json`;

async function snapshot(tenantId: string) {
  const rows = await db.$queryRaw<Array<{ state: unknown }>>`
    SELECT jsonb_build_object(
      'versions',(SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM "CourseVersion" v WHERE "tenantId"=${tenantId}),
      'profiles',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM "RegulatoryProfileVersion" p WHERE "tenantId"=${tenantId}),
      'groups',(SELECT jsonb_agg(to_jsonb(g)-'startsAt'-'accessPolicy' ORDER BY id) FROM "LmsGroup" g WHERE "tenantId"=${tenantId}),
      'materials',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM "LmsMaterial" m WHERE "tenantId"=${tenantId}),
      'results',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM "VerifiedExamResult" r WHERE "tenantId"=${tenantId}),
      'enrollments',(SELECT jsonb_agg(to_jsonb(e)-'startsAt'-'accessPolicy' ORDER BY id) FROM "Enrollment" e WHERE "tenantId"=${tenantId}),
      'attempts',(SELECT jsonb_agg(to_jsonb(a)-'assessmentId'-'purpose'-'submittedAt'-'gradedAt'-'grading' ORDER BY id) FROM "ExamAttempt" a WHERE "tenantId"=${tenantId})
    ) AS state`;
  return rows[0].state;
}

async function main() {
  const target = new URL(process.env.DATABASE_URL || "");
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.port, "55479");
  assert.match(
    target.pathname,
    /^\/demo_test_lms_pass01_upgrade(?:_extended)?$/,
  );
  if (process.argv.includes("--before")) {
    const tenantId = randomUUID(),
      userId = randomUUID(),
      recipientId = randomUUID();
    const courseId = randomUUID(),
      profileId = randomUUID(),
      versionId = randomUUID();
    const enrollmentId = randomUUID(),
      attemptId = randomUUID(),
      groupId = randomUUID(),
      materialId = randomUUID();
    const fixture = lmsCourse({
      kind: "PRACTICE",
      questions: 1,
      required: false,
    });
    const content = JSON.stringify(fixture.content),
      profile = JSON.stringify(fixture.profile);
    const attemptSnapshot = JSON.stringify({
      courseVersionId: versionId,
      questions: fixture.content.exam.questions,
      policy: fixture.content.exam,
      profile: fixture.profile,
    });
    const resultSnapshot = JSON.stringify({
      legacy: true,
      score: 1,
      maximum: 1,
      qualification: false,
    });
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO "Tenant" (id,name,"demoOnly") VALUES (${tenantId},'Synthetic migration preservation',true)`;
      await tx.$executeRaw`INSERT INTO "User" (id,"tenantId",email,"displayName","passwordHash",role) VALUES (${userId},${tenantId},${`${userId}@example.test`},'Migration fixture','UNUSABLE-SYNTHETIC-NO-LOGIN','DIRECTOR')`;
      await tx.$executeRaw`INSERT INTO "Recipient" (id,"tenantId",data) VALUES (${recipientId},${tenantId},'{"fullNameRu":"Synthetic migration"}'::jsonb)`;
      await tx.$executeRaw`INSERT INTO "Course" (id,"tenantId","titleRu","createdBy") VALUES (${courseId},${tenantId},'Synthetic old course',${userId})`;
      await tx.$executeRaw`INSERT INTO "RegulatoryProfileVersion" (id,"tenantId","courseId",version,status,definition,"snapshotHash") VALUES (${profileId},${tenantId},${courseId},1,'CONFIRMED',${profile}::jsonb,${hash(fixture.profile)})`;
      await tx.$executeRaw`INSERT INTO "CourseVersion" (id,"tenantId","courseId",version,status,content,"regulatoryProfileVersionId","snapshotHash","createdBy","publishedAt") VALUES (${versionId},${tenantId},${courseId},1,'PUBLISHED',${content}::jsonb,${profileId},${hash(fixture.content)},${userId},'2026-10-17T12:00:00Z')`;
      await tx.$executeRaw`INSERT INTO "LmsMaterial" (id,"tenantId","courseId","storageKey",sha256,size,"mimeType","originalName","createdBy") VALUES (${materialId},${tenantId},${courseId},'synthetic/old-private.pdf',${hash("old synthetic bytes")},19,'application/pdf','old-private.pdf',${userId})`;
      await tx.$executeRaw`INSERT INTO "LmsGroup" (id,"tenantId",name,"courseVersionId","dueAt","createdBy","updatedAt") VALUES (${groupId},${tenantId},'Legacy group',${versionId},'2027-01-19T11:23:45Z',${userId},'2026-10-17T12:00:00Z')`;
      await tx.$executeRaw`INSERT INTO "Enrollment" (id,"tenantId","courseVersionId","recipientId","assignedBy","dueAt") VALUES (${enrollmentId},${tenantId},${versionId},${recipientId},${userId},'2027-01-19T11:23:45Z')`;
      await tx.$executeRaw`INSERT INTO "ExamAttempt" (id,"tenantId","enrollmentId","courseVersionId","regulatoryProfileVersionId","assessmentKind",ordinal,state,snapshot,answers,sequence,"deadlineAt","finishedAt",score,maximum,verdict) VALUES (${attemptId},${tenantId},${enrollmentId},${versionId},${profileId},'PRACTICE',1,'FINISHED',${attemptSnapshot}::jsonb,'{"q-0":["a"]}'::jsonb,7,'2026-10-17T12:30:00Z','2026-10-17T12:10:00Z',1,1,'PASSED')`;
      await tx.$executeRaw`INSERT INTO "ExamAttempt" (id,"tenantId","enrollmentId","courseVersionId","regulatoryProfileVersionId","assessmentKind",ordinal,state,"activeKey",snapshot,answers,sequence,"deadlineAt") VALUES (${randomUUID()},${tenantId},${enrollmentId},${versionId},${profileId},'PRACTICE',2,'IN_PROGRESS',${enrollmentId},${attemptSnapshot}::jsonb,'{"q-0":["b"]}'::jsonb,3,'2027-01-19T11:00:00Z')`;
      await tx.$executeRaw`INSERT INTO "VerifiedExamResult" (id,"tenantId","enrollmentId","attemptId","assessmentKind","regulatoryProfileVersionId","courseVersionId","recipientId",verdict,score,maximum,eligible,snapshot,"snapshotHash","createdBy") VALUES (${randomUUID()},${tenantId},${enrollmentId},${attemptId},'PRACTICE',${profileId},${versionId},${recipientId},'PASSED',1,1,false,${resultSnapshot}::jsonb,${hash(JSON.parse(resultSnapshot))},${userId})`;
    });
    const state = await snapshot(tenantId);
    await writeFile(
      stateFile,
      JSON.stringify({ tenantId, state, hash: hash(state) }, null, 2),
      { flag: "wx" },
    );
    console.log(
      "Synthetic previous-schema records saved; immutable snapshot and active attempt included.",
    );
  } else {
    const before = JSON.parse(await readFile(stateFile, "utf8"));
    const after = await snapshot(before.tenantId);
    assert.deepEqual(after, before.state);
    const attempts = await db.examAttempt.findMany({
      where: { tenantId: before.tenantId },
    });
    assert.equal(attempts.length, 2);
    assert.ok(
      attempts.every(
        (row) =>
          row.assessmentId === "FINAL" &&
          row.purpose === "FINAL" &&
          row.submittedAt === null &&
          row.gradedAt === null &&
          row.grading === null,
      ),
    );
    const enrollment = await db.enrollment.findFirstOrThrow({
      where: { tenantId: before.tenantId },
    });
    assert.equal(enrollment.startsAt, null);
    assert.equal(enrollment.accessPolicy, null);
    assert.equal(
      await db.lmsLearningCompletion.count({
        where: { tenantId: before.tenantId },
      }),
      0,
    );
    const migrations = await db.$queryRaw<
      Array<{ count: bigint }>
    >`SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    const result = {
      status: "PASS",
      database: target.pathname.slice(1),
      synthetic: true,
      migrationCount: Number(migrations[0].count),
      beforeHash: before.hash,
      afterHash: hash(after),
      preserved: [
        "legacy group and dueAt",
        "immutable material metadata and hash",
        "published course content and hash",
        "regulatory profile",
        "existing result and score",
        "old dueAt",
        "finished and active snapshots",
        "answers and sequence",
        "legacy activeKey",
      ],
      additiveDefaults:
        "FINAL / FINAL; no invented submittedAt, grading, learning completion or access policy",
    };
    await writeFile(evidenceFile, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  }
}

main().finally(() => db.$disconnect());

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { db, type Context } from "../../apps/api/src/core";
import { createCourse, publishVersion } from "../../apps/api/src/lms/courses";
import { queryReport } from "../../apps/api/src/lms/report-query";
import {
  createReport,
  listReports,
  reportFile,
  reportStatus,
} from "../../apps/api/src/lms/reports";
import { executeReport } from "../../apps/api/src/lms/report-worker";
import { lmsCourse, lmsLearner, lmsTenant } from "./lms-fixture";

const denied = (code: string, status = 403) => (error: unknown) => {
  const value = error as { getStatus(): number; getResponse(): { code: string } };
  return value.getStatus() === status && value.getResponse().code === code;
};

test("J13: report DOWNLOAD authority covers rows, totals, files and queued revocation", { timeout: 60000 }, async (t) => {
  const database = new URL(process.env.DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
  assert.match(database.pathname, /^\/demo_test_mvp_roles_\d{8}_run\d+_integration$/);
  assert.ok(process.env.DEMO_ARTIFACT_ROOT);
  t.after(() => db.$disconnect());
  const center = await lmsTenant("J13-report-download");
  const c = center.context;
  const course = await createCourse(c, lmsCourse({ questions: 1, required: false }));
  await publishVersion(c, course.version.id, { revision: 0 });
  const organizations = await Promise.all(["A", "B"].map((suffix) => db.customerOrganization.create({
    data: { tenantId: c.tenantId, nameRu: `SYNTHETIC REPORT ORG ${suffix}` },
  })));
  const enrollments = [];
  for (let i = 0; i < 3; i++) {
    const learner = await lmsLearner(c.tenantId, `DOWNLOAD-${i}`);
    enrollments.push(await db.enrollment.create({
      data: {
        tenantId: c.tenantId,
        recipientId: learner.recipient.id,
        learnerUserId: learner.user.id,
        courseVersionId: course.version.id,
        customerId: organizations[i < 2 ? 0 : 1].id,
        assignedBy: c.userId,
      },
    }));
  }
  const user = await db.user.create({
    data: {
      tenantId: c.tenantId,
      email: `${randomUUID()}@example.test`,
      displayName: "SYNTHETIC REPORT EMPLOYER",
      role: "EMPLOYER",
      passwordHash: center.user.passwordHash,
    },
  });
  const employer: Context = { ...c, role: "EMPLOYER", userId: user.id };
  const memberships = await Promise.all(organizations.map((organization) => db.employerMembership.create({
    data: {
      tenantId: c.tenantId,
      customerId: organization.id,
      userId: user.id,
      permissions: ["READ", "ASSIGN"],
      recipientIds: [],
      createdBy: c.userId,
    },
  })));
  const updateGrant = (data: Parameters<typeof db.employerMembership.update>[0]["data"]) =>
    db.employerMembership.update({ where: { id: memberships[0].id }, data });
  const request = (filters: Record<string, unknown> = {}, format = "CSV") => ({
    kind: "TRAINING", format, requestKey: randomUUID(), filters,
  });
  // Claim only this test's job; unrelated integration workers may share the disposable DB.
  const run = async (id: string) => {
    const job = await db.lmsReportJob.update({
      where: { id },
      data: {
        status: "RUNNING", attempts: { increment: 1 }, fencingToken: { increment: 1 },
        leaseOwner: `J13-${randomUUID()}`, leaseUntil: new Date(Date.now() + 60000),
      },
    });
    await executeReport(job);
    return db.lmsReportJob.findUniqueOrThrow({ where: { id } });
  };
  const fileText = async (id: string) => {
    const file = await reportFile(employer, id);
    assert.equal(file.opened.invalid, false);
    if (file.opened.invalid) throw new Error("Unexpected invalid file");
    const chunks: Buffer[] = [];
    for await (const chunk of file.opened.stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
  };

  const online = await queryReport(employer, {});
  assert.equal(online.total, 3);
  assert.equal(online.summary.participants, 3);
  assert.equal(online.summary.organizations, 2);
  for (const format of ["CSV", "XLSX", "PDF"])
    await assert.rejects(() => createReport(employer, request({}, format)), denied("EMPLOYER_DOCUMENT_DOWNLOAD_DENIED"));
  await assert.rejects(() => createReport(employer, request({ search: "NO MATCH" })), denied("EMPLOYER_DOCUMENT_DOWNLOAD_DENIED"));
  assert.equal(await db.lmsReportJob.count({ where: { tenantId: c.tenantId } }), 0);

  await updateGrant({ permissions: ["READ", "DOWNLOAD"] });
  // DOWNLOAD for A never combines with READ for B, even in aggregate reports.
  await assert.rejects(() => createReport(employer, request()), denied("EMPLOYER_DOCUMENT_DOWNLOAD_DENIED"));
  await assert.rejects(() => createReport(employer, { ...request(), kind: "ORGANIZATIONS" }), denied("EMPLOYER_DOCUMENT_DOWNLOAD_DENIED"));
  await assert.rejects(() => createReport(employer, request({ customerId: organizations[1].id })), denied("EMPLOYER_DOCUMENT_DOWNLOAD_DENIED"));
  const allowedRequest = request({ customerId: organizations[0].id });
  const allowed = await createReport(employer, allowedRequest);
  assert.equal(allowed.total, 2);
  assert.equal(allowed.summary.participants, 2);
  assert.equal(allowed.summary.organizations, 1);
  assert.deepEqual(new Set(allowed.items.map((row) => row.enrollmentId)), new Set(enrollments.slice(0, 2).map((row) => row.id)));
  assert.equal((await run(allowed.id)).status, "READY");
  const csv = await fileText(allowed.id);
  assert.match(csv, /DOWNLOAD-0/);
  assert.match(csv, /DOWNLOAD-1/);
  assert.doesNotMatch(csv, /DOWNLOAD-2|SYNTHETIC REPORT ORG B/);
  await assert.rejects(() => reportFile({ ...employer, tenantId: randomUUID() }, allowed.id), denied("NOT_FOUND", 404));

  await updateGrant({ permissions: ["READ", "ASSIGN"] });
  assert.equal((await queryReport(employer, {})).total, 3, "read access remains after DOWNLOAD revocation");
  await assert.rejects(() => reportFile(employer, allowed.id), denied("REPORT_ACCESS_REVOKED"));
  await assert.rejects(() => reportStatus(employer, allowed.id), denied("REPORT_ACCESS_REVOKED"));
  await assert.rejects(() => createReport(employer, allowedRequest), denied("REPORT_ACCESS_REVOKED"));
  assert.equal((await listReports(employer)).items.length, 0);

  await updateGrant({ permissions: ["READ", "DOWNLOAD"] });
  const queued = await createReport(employer, request({ customerId: organizations[0].id }));
  await updateGrant({ permissions: ["READ"] });
  const failed = await run(queued.id);
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.errorCode, "REPORT_ACCESS_REVOKED");
  assert.equal(failed.storageKey, null);
  assert.equal(failed.sha256, null);
  assert.equal(failed.size, null);
  assert.equal(await db.auditEvent.count({ where: { tenantId: c.tenantId, entityId: queued.id, action: "LMS_REPORT_READY" } }), 0);
  await assert.rejects(() => reportFile(employer, queued.id), denied("REPORT_ACCESS_REVOKED"));

  await updateGrant({ permissions: ["READ", "DOWNLOAD"], recipientIds: [enrollments[0].recipientId] });
  await assert.rejects(() => reportFile(employer, allowed.id), denied("REPORT_ACCESS_REVOKED"));
  const personOnly = await createReport(employer, request({ customerId: organizations[0].id }));
  assert.equal(personOnly.total, 1);
  assert.equal(personOnly.summary.participants, 1);
  assert.equal(personOnly.summary.organizations, 1);
  assert.equal(personOnly.items[0].enrollmentId, enrollments[0].id);
  assert.equal((await run(personOnly.id)).status, "READY");
  const onePerson = await fileText(personOnly.id);
  assert.match(onePerson, /DOWNLOAD-0/);
  assert.doesNotMatch(onePerson, /DOWNLOAD-1|DOWNLOAD-2|SYNTHETIC REPORT ORG B/);
  await updateGrant({ expiresAt: new Date(Date.now() - 1000) });
  await assert.rejects(() => reportFile(employer, personOnly.id), denied("REPORT_ACCESS_REVOKED"));
  assert.equal((await listReports(employer)).items.length, 0);

  // DOWNLOAD alone and another organisation's READ cannot form a combined grant.
  await updateGrant({ expiresAt: null, permissions: ["DOWNLOAD"] });
  await assert.rejects(() => createReport(employer, request()), denied("EMPLOYER_DOCUMENT_DOWNLOAD_DENIED"));
  const evidence = resolve(process.env.DEMO_REPORTS_TEST_EVIDENCE || ".runtime/mvp-all-roles-20261019/run-01/report-download-evidence");
  await mkdir(evidence, { recursive: true });
  await writeFile(join(evidence, "J13-report-download-authority.json"), JSON.stringify({
    status: "PASS", at: new Date().toISOString(), tenantId: c.tenantId,
    organizations: organizations.map((row) => row.id),
    jobs: { allowed: allowed.id, revokedAfterEnqueue: queued.id, oneRecipient: personOnly.id },
    assertions: ["READ/ASSIGN cannot export CSV/XLSX/PDF", "READ-only empty export rejected", "mixed-organisation export rejected", "allowed organisation rows and totals agree", "foreign tenant file hidden", "DOWNLOAD revocation blocks ready file and idempotent replay", "queued revocation fails without an artifact", "recipient restriction applies before count and file", "expired grant cannot download", "separate permissions do not combine"],
  }, null, 2) + "\n");
});

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { ArtifactStore } from "../../packages/printing/src";
import { db, hash, json, type Context } from "../../apps/api/src/core";
import { createCourse, publishVersion } from "../../apps/api/src/lms/courses";
import {
  createReport,
  reportStatus,
  reportFile,
  retryReport,
  cancelReport,
  listReports,
  expireReportFiles,
} from "../../apps/api/src/lms/reports";
import {
  queryReport,
  reportFilterOptions,
  metricKinds,
} from "../../apps/api/src/lms/report-query";
import {
  claimReport,
  executeReport,
} from "../../apps/api/src/lms/report-worker";
import { reportKinds } from "../../apps/api/src/lms/report-definitions";
import { lmsCourse, lmsTenant, lmsLearner } from "./lms-fixture";

const denied = (status: number) => (error: unknown) =>
  (error as { getStatus(): number }).getStatus() === status;
test(
  "N06/N07: snapshot analytics, 24 report formats, privacy and durable recovery",
  { timeout: 600000 },
  async (t) => {
    t.after(() => db.$disconnect());
    const database = new URL(process.env.DATABASE_URL!);
    assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
    assert.match(database.pathname, /^\/(?:demo_test_lms_pass02_reports|demo_test_mvp_roles_\d{8}_run\d+_integration)$/);
    assert.ok(process.env.DEMO_ARTIFACT_ROOT);
    const directory = resolve(
      process.env.DEMO_REPORTS_TEST_EVIDENCE || ".runtime/lms-pass02-operations-20261018/reports-evidence",
    );
    await mkdir(directory, { recursive: true });
    const checks: Array<Record<string, unknown>> = [];
    const center = await lmsTenant("operations-reports"),
      foreign = await lmsTenant("reports-foreign");
    const c = center.context,
      definition = lmsCourse({ questions: 1, required: false }),
      course = await createCourse(c, definition);
    await publishVersion(c, course.version.id, { revision: 0 });
    const org = await db.customerOrganization.create({
      data: {
        tenantId: c.tenantId,
        nameRu:
          "=Синтетическая организация с очень длинным наименованием для проверки переносов строк",
        nameKz: "ӘҒҚҢӨҰҮҺІ синтетикалық ұйым",
        bin: "001234567890",
        city: "Қызылорда",
        citySource: "SYNTHETIC_CONFIRMED",
      },
    });
    const otherOrg = await db.customerOrganization.create({
      data: {
        tenantId: c.tenantId,
        nameRu: "Вторая синтетическая организация",
        bin: "009999999999",
      },
    });
    const teacher = await db.user.create({
      data: {
        tenantId: c.tenantId,
        email: `${randomUUID()}@example.test`,
        displayName: "Synthetic teacher",
        role: "TEACHER",
        passwordHash: center.user.passwordHash,
      },
    });
    await db.lmsTeachingBinding.create({
      data: {
        tenantId: c.tenantId,
        userId: teacher.id,
        courseId: course.course.id,
        permissions: ["READ"],
        role: "TEACHER",
        createdBy: c.userId,
      },
    });
    const people = [];
    const enrollments = [];
    for (let i = 0; i < 6; i++) {
      const person = await lmsLearner(c.tenantId, `Отчёт-${i} ӘҒҚҢӨҰҮҺІ`);
      people.push(person);
      if (i === 0)
        await db.recipient.update({
          where: { id: person.recipient.id },
          data: {
            data: json({
              fullNameRu:
                "=Синтетический слушатель с очень длинным именем ".repeat(3),
              fullNameKz: "ӘҒҚҢӨҰҮҺІ Ұзын атауы бар синтетикалық тыңдаушы",
              positionRu: "Инженер",
              positionKz: "Инженер",
            }),
          },
        });
      enrollments.push(
        await db.enrollment.create({
          data: {
            tenantId: c.tenantId,
            recipientId: person.recipient.id,
            learnerUserId: person.user.id,
            courseVersionId: course.version.id,
            assignedBy: c.userId,
            customerId: i < 5 ? org.id : otherOrg.id,
            assignedAt: new Date("2026-10-18T05:00:00Z"),
            status: i === 1 ? "COMPLETED" : "ACTIVE",
            completedAt: i === 1 ? new Date() : null,
            dueAt: i === 0 ? null : new Date("2027-01-01T00:00:00Z"),
          },
        }),
      );
    }
    const profile = await db.regulatoryProfileVersion.findFirstOrThrow({
      where: {
        tenantId: c.tenantId,
        id: course.version.regulatoryProfileVersionId,
      },
    });
    const request = await db.printRequest.create({
      data: {
        tenantId: c.tenantId,
        kind: "COMPANY",
        customerId: org.id,
        status: "FINALIZED",
        draft: {},
        createdBy: c.userId,
      },
    });
    const issuer = await db.issuerProfileVersion.create({
      data: {
        tenantId: c.tenantId,
        version: 1,
        profile: {},
        createdBy: c.userId,
      },
    });
    const template = await db.templateVersion.create({
      data: {
        tenantId: c.tenantId,
        templateId: "lms-certificate",
        version: "report-synthetic",
        checksum: hash({}),
        storageKey: "synthetic-report",
        contract: {},
      },
    });
    const proposal = await db.requestProposal.create({
      data: {
        tenantId: c.tenantId,
        requestId: request.id,
        revision: 1,
        baseRevision: 0,
        status: "APPROVED",
        payload: {},
        before: {},
        diff: {},
        proposalHash: hash({}),
        submittedBy: c.userId,
      },
    });
    for (let i = 0; i < 6; i++) {
      const attempt = await db.examAttempt.create({
        data: {
          tenantId: c.tenantId,
          enrollmentId: enrollments[i].id,
          courseVersionId: course.version.id,
          regulatoryProfileVersionId: profile.id,
          assessmentKind: "CENTER_EXAM",
          ordinal: 1,
          snapshot: {},
          deadlineAt: new Date(),
          state: "FINISHED",
          submittedAt: new Date(),
          finishedAt: new Date(),
          score: 1,
          maximum: 1,
          verdict: "PASSED",
        },
      });
      const result = await db.verifiedExamResult.create({
        data: {
          tenantId: c.tenantId,
          enrollmentId: enrollments[i].id,
          attemptId: attempt.id,
          assessmentKind: "CENTER_EXAM",
          regulatoryProfileVersionId: profile.id,
          courseVersionId: course.version.id,
          recipientId: people[i].recipient.id,
          verdict: "PASSED",
          eligible: true,
          examAt: new Date(),
          snapshot: {},
          snapshotHash: hash({}),
          createdBy: c.userId,
        },
      });
      const issuance = await db.issuance.create({
        data: {
          tenantId: c.tenantId,
          requestId: request.id,
          sourceRevision: i,
          snapshot: {},
          inputHash: hash({ i }),
          profileVersionId: issuer.id,
          createdBy: c.userId,
        },
      });
      await db.issuanceWorkflow.create({
        data: {
          tenantId: c.tenantId,
          requestId: request.id,
          issuanceId: issuance.id,
          proposalId: proposal.id,
          status: i === 4 ? "AWAITING_SIGNATURE" : "ISSUED",
          requiredSigners: i === 4 ? ["synthetic-required"] : [],
        },
      });
      const type = i === 1 ? "CREDENTIAL" : "CERTIFICATE";
      await db.lmsDocumentLink.create({
        data: {
          tenantId: c.tenantId,
          resultId: result.id,
          documentType: type,
          legalForm: "INFORMATION_CARD",
          requestId: request.id,
          issuanceId: issuance.id,
        },
      });
      await db.issuedDocument.create({
        data: {
          tenantId: c.tenantId,
          requestId: request.id,
          issuanceId: issuance.id,
          rowId: people[i].recipient.id,
          assignmentId: `${result.id}-${type}`,
          templateId:
            type === "CERTIFICATE" ? "lms-certificate" : "lms-credential",
          templateVersionId: template.id,
          namespace: "SYNTHETIC",
          number: `000${i + 1}`,
          documentDate: "2026-10-18",
        },
      });
      if (i === 0 || i === 1)
        await db.renewalNeed.create({
          data: {
            tenantId: c.tenantId,
            customerId: org.id,
            recipientId: people[i].recipient.id,
            sourceRequestId: request.id,
            sourceRowId: people[i].recipient.id,
            assignmentId: `${result.id}-${type}`,
            sourceKey: randomUUID(),
            policySource: "SYNTHETIC confirmed date",
            policyVersion: "1",
            basisDate: "2026-10-18",
            documentValidUntil: i === 0 ? "2026-11-01" : "2027-12-31",
            nextCheckDate: "2027-01-15",
            confirmed: true,
            state: "CONFIRMED",
          },
        });
      if (i === 2)
        await db.issuanceEvent.create({
          data: {
            tenantId: c.tenantId,
            issuanceId: issuance.id,
            kind: "CANCELLED",
            reason: "SYNTHETIC cancellation",
            actorId: c.userId,
          },
        });
      if (i === 3)
        await db.issuanceEvent.create({
          data: {
            tenantId: c.tenantId,
            issuanceId: issuance.id,
            kind: "REPLACED",
            reason: "SYNTHETIC replacement",
            actorId: c.userId,
          },
        });
    }
    await db.examAttempt.create({
      data: {
        tenantId: c.tenantId,
        enrollmentId: enrollments[0].id,
        courseVersionId: course.version.id,
        regulatoryProfileVersionId: profile.id,
        assessmentKind: "CENTER_EXAM",
        ordinal: 2,
        snapshot: {},
        deadlineAt: new Date(),
        state: "FINISHED",
        submittedAt: new Date(),
        finishedAt: new Date(),
        score: 0,
        maximum: 1,
        verdict: "FAILED",
      },
    });
    const q = await queryReport(c, { kind: "TRAINING" });
    assert.equal(q.total, 6);
    assert.equal(q.items[0].payload.assignedAt, "2026-10-18 10:00");
    assert.equal(q.summary.participants, 6);
    assert.equal(q.summary.accounts, 6);
    assert.equal(q.summary.organizations, 2);
    assert.equal(q.summary.activeAssignments, 5);
    assert.equal(q.summary.completedAssignments, 1);
    assert.equal(q.summary.attempts, 7);
    assert.equal(q.summary.passedAttempts, 6);
    assert.equal(q.summary.issuedDocuments, 5);
    assert.equal(q.summary.unknownValidity, 1);
    assert.equal(q.summary.voidedDocuments, 1);
    assert.equal(q.summary.supersededDocuments, 1);
    for (const [metric, kind] of Object.entries(metricKinds))
      assert.equal(
        (await queryReport(c, { kind, metric })).total,
        q.summary[metric],
        metric,
      );
    const combined = {
      dateFrom: "2026-10-18T00:00:00Z",
      dateTo: "2026-10-18T23:59:59Z",
      courseVersionId: course.version.id,
      customerId: org.id,
      bin: org.bin,
      city: org.city,
      teacherUserId: teacher.id,
      status: "ACTIVE",
    };
    assert.equal((await queryReport(c, { filters: combined })).total, 4);
    assert.equal(
      (
        await queryReport(c, {
          filters: { ...combined, city: "Нет такого города" },
        })
      ).total,
      0,
    );
    assert.equal(
      (await queryReport(foreign.context, { filters: { customerId: org.id } }))
        .total,
      0,
    );
    assert.equal((await reportFilterOptions(c)).teachers[0].id, teacher.id);
    checks.push({
      check: "summary-and-seven-filters",
      result: "PASS",
      summary: q.summary,
    });
    const store = new ArtifactStore();
    for (const kind of reportKinds)
      for (const format of ["PDF", "XLSX", "CSV"]) {
        const live = await queryReport(c, {
          kind,
          language: format === "PDF" ? "kz" : "ru",
        });
        const input = {
          kind,
          format,
          language: format === "PDF" ? "kz" : "ru",
          requestKey: randomUUID(),
        };
        const report = await createReport(c, input);
        assert.equal(report.total, live.total);
        assert.deepEqual(report.summary, live.summary);
        assert.equal((await createReport(c, input)).id, report.id);
        await assert.rejects(
          () =>
            createReport(c, {
              ...input,
              format: format === "CSV" ? "PDF" : "CSV",
            }),
          denied(409),
        );
        const claim = await claimReport(`report-test-${randomUUID()}`);
        assert.equal(claim?.id, report.id);
        await executeReport(claim!);
        const done = await reportStatus(c, report.id);
        assert.equal(done.status, "READY", JSON.stringify(done));
        const record = await db.lmsReportJob.findUniqueOrThrow({
            where: { id: report.id },
          }),
          bytes = await store.read(record.storageKey!, record.sha256!);
        const file = join(directory, `${kind}.${format.toLowerCase()}`);
        await writeFile(file, bytes);
        if (format === "CSV") {
          assert.equal(
            bytes.toString("utf8").split("\r\n").filter(Boolean).length,
            live.total + 1,
          );
          if (kind === "ORGANIZATIONS")
            assert.ok(bytes.includes(Buffer.from("001234567890")));
        }
        if (format === "XLSX") {
          const probe = spawnSync(process.env.DEMO_PYTHON!, [
            "-I",
            "-c",
            "import sys,json,zipfile,xml.etree.ElementTree as E; z=zipfile.ZipFile(sys.argv[1]); s=E.fromstring(z.read('xl/worksheets/sheet1.xml')); n={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}; print(json.dumps({'rows':len(s.findall('.//s:row',n)),'formulas':len(s.findall('.//s:f',n))}))",
            file,
          ]);
          assert.equal(probe.status, 0, probe.stderr.toString());
          assert.deepEqual(JSON.parse(probe.stdout.toString()), {
            rows: live.total + 1,
            formulas: 0,
          });
        }
        if (format === "PDF") {
          assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
          const probe = spawnSync(process.env.DEMO_PYTHON!, [
            "-I",
            "-c",
            "import sys,json;from pypdf import PdfReader;r=PdfReader(sys.argv[1]); print(json.dumps({'pages':len(r.pages),'text':''.join(p.extract_text() for p in r.pages)}))",
            file,
          ]);
          assert.equal(probe.status, 0, probe.stderr.toString());
          const content = JSON.parse(probe.stdout.toString());
          assert.ok(content.text.includes("Кесінді"));
          assert.ok(
            content.text.includes("ӘҒҚҢӨҰҮҺІ") || kind === "ORGANIZATIONS",
            content.text,
          );
        }
        await assert.rejects(
          () => reportStatus(foreign.context, report.id),
          denied(404),
        );
        checks.push({
          check: `${kind}-${format}`,
          result: "PASS",
          rows: done.total,
          sha256: record.sha256,
          file,
        });
      }
    const snapshot = await createReport(c, {
      kind: "TRAINING",
      format: "CSV",
      requestKey: randomUUID(),
    });
    await db.enrollment.update({
      where: { id: enrollments[0].id },
      data: { status: "CANCELLED" },
    });
    const saved = await reportStatus(c, snapshot.id);
    assert.equal(
      saved.items.find((r) => r.enrollmentId === enrollments[0].id)?.payload
        .status,
      "ACTIVE",
    );
    assert.equal(
      (await queryReport(c, { filters: { status: "ACTIVE" } })).total,
      4,
    );
    const claimed = await claimReport("lost-worker");
    assert.equal(claimed?.id, snapshot.id);
    await db.lmsReportJob.update({
      where: { id: snapshot.id },
      data: { leaseUntil: new Date(0) },
    });
    const reclaimed = await claimReport("restarted-worker");
    assert.equal(reclaimed?.id, snapshot.id);
    assert.ok(reclaimed!.fencingToken > claimed!.fencingToken);
    await executeReport(reclaimed!);
    assert.equal((await reportStatus(c, snapshot.id)).status, "READY");
    const cancel = await createReport(c, {
      kind: "EMPLOYEES",
      format: "CSV",
      requestKey: randomUUID(),
    });
    await cancelReport(c, cancel.id);
    assert.equal((await reportStatus(c, cancel.id)).status, "CANCELLED");
    await assert.rejects(() => reportFile(c, cancel.id), denied(409));
    const failure = await createReport(c, {
      kind: "TRAINING",
      format: "CSV",
      requestKey: randomUUID(),
    });
    await db.lmsReportJob.update({
      where: { id: failure.id },
      data: {
        status: "FAILED",
        errorCode: "REPORT_PREPARATION_FAILED",
        attempts: 3,
      },
    });
    await retryReport(c, failure.id);
    const retried = await claimReport("retry-worker");
    assert.equal(retried?.id, failure.id);
    await executeReport(retried!);
    assert.equal((await reportStatus(c, failure.id)).status, "READY");
    const employerUser = await db.user.create({
      data: {
        tenantId: c.tenantId,
        email: `${randomUUID()}@example.test`,
        displayName: "Synthetic reports employer",
        role: "EMPLOYER",
        passwordHash: center.user.passwordHash,
      },
    });
    const membership = await db.employerMembership.create({
      data: {
        tenantId: c.tenantId,
        userId: employerUser.id,
        customerId: org.id,
        permissions: ["READ", "DOWNLOAD"],
        recipientIds: [],
        createdBy: c.userId,
      },
    });
    const employer: Context = {
      ...c,
      userId: employerUser.id,
      role: "EMPLOYER",
    };
    assert.equal((await queryReport(employer, {})).total, 5);
    assert.equal(
      (await queryReport(employer, { filters: { customerId: otherOrg.id } }))
        .total,
      0,
    );
    const privateReport = await createReport(employer, {
      kind: "TRAINING",
      format: "CSV",
      requestKey: randomUUID(),
    });
    await executeReport((await claimReport("private-worker"))!);
    assert.equal(
      (await reportStatus(employer, privateReport.id)).status,
      "READY",
    );
    assert.equal((await listReports(employer)).items.length, 1);
    await assert.rejects(() => reportFile(c, privateReport.id), denied(404));
    await assert.rejects(
      () => reportFile(foreign.context, privateReport.id),
      denied(404),
    );
    const permitted = await reportFile(employer, privateReport.id);
    if (!permitted.opened.invalid) permitted.opened.stream.destroy();
    await db.employerMembership.update({
      where: { id: membership.id },
      data: { active: false },
    });
    await assert.rejects(
      () => reportStatus(employer, privateReport.id),
      denied(403),
    );
    await assert.rejects(
      () => reportFile(employer, privateReport.id),
      denied(403),
    );
    assert.equal((await listReports(employer)).items.length, 0);
    const teacherContext: Context = {
      ...c,
      userId: teacher.id,
      role: "TEACHER",
    };
    const teacherReport = await createReport(teacherContext, {
      kind: "TRAINING",
      format: "CSV",
      requestKey: randomUUID(),
    });
    await executeReport((await claimReport("teacher-report-worker"))!);
    assert.equal(
      (await reportStatus(teacherContext, teacherReport.id)).status,
      "READY",
    );
    await db.lmsTeachingBinding.updateMany({
      where: { userId: teacher.id },
      data: { revokedAt: new Date() },
    });
    await assert.rejects(
      () => reportFile(teacherContext, teacherReport.id),
      denied(403),
    );
    assert.equal((await listReports(teacherContext)).items.length, 0);
    await db.user.update({
      where: { id: teacher.id },
      data: { role: "LEARNER" },
    });
    await assert.rejects(
      () => reportStatus(teacherContext, teacherReport.id),
      denied(403),
    );
    const expired = await db.lmsReportJob.update({
      where: { id: failure.id },
      data: { expiresAt: new Date(0) },
    });
    await assert.rejects(() => reportFile(c, failure.id), denied(410));
    await expireReportFiles();
    assert.equal((await reportStatus(c, failure.id)).status, "EXPIRED");
    assert.equal(
      await db.lmsReportRow.count({ where: { jobId: failure.id } }),
      0,
    );
    await assert.rejects(() =>
      store.read(expired.storageKey!, expired.sha256!),
    );
    checks.push({
      check: "snapshot-mutation-restart-fence-cancel-retry-revocation",
      result: "PASS",
    });
    const empty = await createReport(c, {
      kind: "TRAINING",
      format: "PDF",
      filters: { search: "none-exists" },
      requestKey: randomUUID(),
    });
    await executeReport((await claimReport("empty-worker"))!);
    assert.equal((await reportStatus(c, empty.id)).status, "READY");
    await writeFile(
      join(directory, "checks.json"),
      JSON.stringify(
        {
          runAt: new Date(),
          tenantId: c.tenantId,
          foreignTenantId: foreign.tenant.id,
          checks,
        },
        null,
        2,
      ),
    );
  },
);

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { spawnSync } from "node:child_process";
import type { Response } from "express";
import { ArtifactStore, BUNDLE_PART_BYTES } from "../../packages/printing/src";
import { db, hash, type Context } from "../../apps/api/src/core";
import { saveLessonProgress } from "../../apps/api/src/lms/learning";
import {
  startAttempt,
  saveAnswers,
  submitAttempt,
} from "../../apps/api/src/lms/exams";
import { createCourse, publishVersion } from "../../apps/api/src/lms/courses";
import {
  listEnrollmentPage,
  resultFilterOptions,
} from "../../apps/api/src/lms/enrollment-list";
import { exportResults } from "../../apps/api/src/lms/results-export";
import {
  prepareDocumentBundle,
  documentBundleStatus,
  documentBundlePart,
} from "../../apps/api/src/lms/document-bundles";
import { documentView } from "../../apps/api/src/lms/document-bridge";
import { claimJob, executeJob } from "../../apps/render-worker/src/queue";
import { lmsCourse, lmsTenant, lmsLearner } from "./lms-fixture";

class ExportResponse extends Writable {
  chunks: Buffer[] = [];
  headers = new Map<string, unknown>();
  _write(chunk: Buffer, _encoding: string, done: () => void) {
    this.chunks.push(Buffer.from(chunk));
    done();
  }
  type(value: string) {
    this.headers.set("Content-Type", value);
    return this;
  }
  setHeader(name: string, value: unknown) {
    this.headers.set(name, value);
    return this;
  }
  send(value: Buffer) {
    this.end(value);
    return this;
  }
  bytes() {
    return Buffer.concat(this.chunks);
  }
}

test(
  "V3 A1/S1.3/S1.7: scoped paginated facts, matching safe exports and durable automatic bundle parts",
  { timeout: 120_000 },
  async (t) => {
    t.after(() => db.$disconnect());
    process.env.DEMO_LMS_TEST_RUNTIME = "1";
    assert.ok(
      process.env.DEMO_ARTIFACT_ROOT,
      "task-owned private storage required",
    );
    const store = new ArtifactStore();
    const center = await lmsTenant("scaling-results");
    const foreign = await lmsTenant("scaling-results-foreign");
    const c = center.context;
    const definition = lmsCourse({ questions: 1 });
    const course = await createCourse(c, definition);
    await publishVersion(c, course.version.id, { revision: 0 });
    const customer = await db.customerOrganization.create({
      data: {
        tenantId: c.tenantId,
        nameRu: "=Synthetic company",
        nameKz: "Синтетикалық ұйым",
      },
    });
    const dueAt = new Date(Date.now() + 3 * 86400000);
    const group = await db.lmsGroup.create({
      data: {
        tenantId: c.tenantId,
        name: "Synthetic V3 group",
        courseVersionId: course.version.id,
        customerId: customer.id,
        dueAt,
        createdBy: c.userId,
      },
    });
    const learners = [];
    const enrollments = [];
    for (let i = 0; i < 5; i++) {
      const learner = await lmsLearner(c.tenantId, `V3-${i}`);
      learners.push(learner);
      const enrollment = await db.enrollment.create({
        data: {
          tenantId: c.tenantId,
          courseVersionId: course.version.id,
          recipientId: learner.recipient.id,
          customerId: customer.id,
          groupId: group.id,
          assignedBy: c.userId,
          dueAt,
          assignedAt: new Date(Date.now() + i),
        },
      });
      enrollments.push(enrollment);
      await db.lmsGroupMember.create({
        data: {
          tenantId: c.tenantId,
          groupId: group.id,
          enrollmentId: enrollment.id,
        },
      });
    }
    const page1 = await listEnrollmentPage(c, {
      groupId: group.id,
      pageSize: 2,
    });
    const page2 = await listEnrollmentPage(c, {
      groupId: group.id,
      pageSize: 2,
      page: 2,
    });
    assert.equal(page1.total, 5);
    assert.equal(page1.items.length, 2);
    assert.equal(
      new Set([...page1.items, ...page2.items].map((e) => e.id)).size,
      4,
    );
    assert.equal("modules" in page1.items[0].courseVersion.content, false);
    assert.equal((await listEnrollmentPage(c, { search: "V3-2" })).total, 1);
    assert.equal(
      (await listEnrollmentPage(c, { view: "EXPIRING", expiringDays: 2 }))
        .total,
      0,
    );
    assert.equal(
      (await listEnrollmentPage(c, { view: "EXPIRING", expiringDays: 5 }))
        .total,
      5,
    );
    assert.equal(
      (await listEnrollmentPage(foreign.context, { groupId: group.id })).total,
      0,
    );
    const employerUser = await db.user.create({
      data: {
        ...center.user,
        id: randomUUID(),
        email: `${randomUUID()}@example.test`,
        role: "EMPLOYER",
      },
    });
    const employer: Context = {
      ...c,
      role: "EMPLOYER",
      userId: employerUser.id,
    };
    await db.employerMembership.create({
      data: {
        tenantId: c.tenantId,
        customerId: customer.id,
        userId: employer.userId,
        permissions: ["READ"],
        recipientIds: [learners[0].recipient.id],
        createdBy: c.userId,
      },
    });
    assert.equal((await listEnrollmentPage(employer, {})).total, 1);
    assert.equal((await resultFilterOptions(employer)).groups.length, 1);
    const csv = new ExportResponse();
    await exportResults(
      c,
      { filters: { search: "V3-2" }, format: "CSV" },
      csv as unknown as Response,
    );
    assert.equal(
      csv.bytes().toString("utf8").split("\r\n").filter(Boolean).length,
      2,
    );
    assert.ok(csv.bytes().includes(Buffer.from("'=Synthetic company")));
    const xlsx = new ExportResponse();
    await exportResults(
      c,
      { filters: { search: "V3-2" }, format: "XLSX" },
      xlsx as unknown as Response,
    );
    assert.equal(xlsx.bytes().subarray(0, 2).toString(), "PK");
    const readback = spawnSync(
      process.env.DEMO_PYTHON || "python",
      [
        "-I",
        "-c",
        "import sys,io,zipfile,json,xml.etree.ElementTree as E; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); s=E.fromstring(z.read('xl/worksheets/sheet1.xml')); n={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}; print(json.dumps({'rows':len(s.findall('.//s:row',n)),'formulas':len(s.findall('.//s:f',n)),'text':' '.join(s.itertext())}))",
      ],
      { input: xlsx.bytes() },
    );
    assert.equal(readback.status, 0, readback.stderr.toString());
    const verifiedSheet = JSON.parse(readback.stdout.toString());
    assert.equal(verifiedSheet.rows, 2);
    assert.equal(verifiedSheet.formulas, 0);
    assert.match(verifiedSheet.text, /V3-2/);
    assert.match(verifiedSheet.text, /=Synthetic company/);
    const request = await db.printRequest.create({
      data: {
        tenantId: c.tenantId,
        kind: "COMPANY",
        customerId: customer.id,
        draft: {},
        createdBy: c.userId,
      },
    });
    const profileId = (
      await db.issuerProfileVersion.create({
        data: {
          tenantId: c.tenantId,
          version: 1,
          profile: {},
          createdBy: c.userId,
        },
      })
    ).id;
    const templateId = (
      await db.templateVersion.create({
        data: {
          tenantId: c.tenantId,
          templateId: "lms-certificate",
          version: "synthetic-v3",
          checksum: hash({}),
          storageKey: "synthetic-v3",
          contract: {},
        },
      })
    ).id;
    const proposalId = (
      await db.requestProposal.create({
        data: {
          tenantId: c.tenantId,
          requestId: request.id,
          revision: 1,
          baseRevision: 0,
          payload: {},
          before: {},
          diff: {},
          proposalHash: hash({}),
          submittedBy: c.userId,
        },
      })
    ).id;
    const issuance = await db.issuance.create({
      data: {
        tenantId: c.tenantId,
        requestId: request.id,
        sourceRevision: 0,
        snapshot: {},
        inputHash: hash({}),
        profileVersionId: profileId,
        createdBy: c.userId,
      },
    });
    await db.issuanceWorkflow.create({
      data: {
        tenantId: c.tenantId,
        requestId: request.id,
        issuanceId: issuance.id,
        proposalId,
        status: "ISSUED",
        requiredSigners: [],
      },
    });
    const documentIds = [];
    for (let i = 0; i < 3; i++) {
      await saveLessonProgress(
        learners[i].context,
        enrollments[i].id,
        "lesson-1",
        { sequence: 1, acknowledge: true },
      );
      const attempt = await startAttempt(
        learners[i].context,
        enrollments[i].id,
      );
      await saveAnswers(learners[i].context, attempt.id, {
        sequence: 1,
        answers: { [attempt.questions[0].id]: ["a"] },
      });
      await submitAttempt(learners[i].context, attempt.id);
      const result = await db.verifiedExamResult.findFirstOrThrow({
        where: { tenantId: c.tenantId, enrollmentId: enrollments[i].id },
      });
      const link = await db.lmsDocumentLink.create({
        data: {
          tenantId: c.tenantId,
          resultId: result.id,
          documentType: "CERTIFICATE",
          legalForm: "INFORMATION_CARD",
          requestId: request.id,
          issuanceId: issuance.id,
        },
      });
      documentIds.push(link.id);
      const document = await db.issuedDocument.create({
        data: {
          tenantId: c.tenantId,
          requestId: request.id,
          issuanceId: issuance.id,
          rowId: learners[i].recipient.id,
          assignmentId: `${result.id}-CERTIFICATE`,
          templateId: "lms-certificate",
          templateVersionId: templateId,
          namespace: "SYNTHETIC",
          number: `V3-${i}`,
          documentDate: "2026-10-15",
        },
      });
      const snapshot = await db.renderInputSnapshot.create({
        data: {
          tenantId: c.tenantId,
          requestId: request.id,
          revision: 0,
          profileVersionId: profileId,
          input: {},
          inputHash: hash({}),
        },
      });
      const job = await db.generationJob.create({
        data: {
          tenantId: c.tenantId,
          requestId: request.id,
          snapshotId: snapshot.id,
          kind: "PDF",
          logicalKey: randomUUID(),
          status: "SUCCEEDED",
        },
      });
      const saved = await store.put(
        Buffer.alloc(i === 2 ? BUNDLE_PART_BYTES + 1 : 35 * 1024 * 1024, i + 1),
        "pdf",
      );
      await db.artifact.create({
        data: {
          ...saved,
          tenantId: c.tenantId,
          requestId: request.id,
          issuanceId: issuance.id,
          documentId: document.id,
          jobId: job.id,
          format: "PDF",
          mimeType: "application/pdf",
          fileName: `Synthetic-${i}.pdf`,
          inputHash: hash({}),
          rendererVersion: "synthetic-test-bytes",
        },
      });
    }
    assert.equal((await documentView(c, documentIds[0])).status, "ISSUED");
    const targets = [
      [db, "$queryRaw"],
      [db.lmsResultEvent, "findMany"],
      [db.lmsDocumentLink, "findMany"],
      [db.issuedDocument, "findMany"],
      [db.issuanceWorkflow, "findMany"],
      [db.requestProposal, "findMany"],
      [db.artifact, "findMany"],
    ] as const;
    let queries = 0;
    const originals = targets.map(([object, key]) => {
      const target = object as unknown as Record<
        string,
        (...args: unknown[]) => unknown
      >;
      const original = target[key];
      target[key] = function (...args: unknown[]) {
        queries++;
        return Reflect.apply(original, object, args);
      };
      return () => {
        target[key] = original;
      };
    });
    try {
      await listEnrollmentPage(c, { pageSize: 3 });
      const smallPageQueries = queries;
      queries = 0;
      await listEnrollmentPage(c, { pageSize: 5 });
      assert.equal(
        queries,
        smallPageQueries,
        "page expansion must not add per-person/document queries",
      );
      assert.ok(queries <= 11, `bounded page calls: ${queries}`);
      t.diagnostic(`bounded page calls=${queries}; page sizes 3 and 5`);
    } finally {
      originals.forEach((restore) => restore());
    }
    assert.equal(
      (await listEnrollmentPage(c, { view: "WAITING_DOCUMENTS" })).total,
      0,
    );
    const bundle = await prepareDocumentBundle(c, {
      groupId: group.id,
      format: "PDF",
    });
    assert.equal(bundle.partCount, 2);
    assert.equal(bundle.directFiles.length, 1);
    assert.equal(
      (await prepareDocumentBundle(c, { documentIds, format: "PDF" })).id,
      bundle.id,
    );
    await assert.rejects(
      prepareDocumentBundle(employer, { documentIds, format: "PDF" }),
      (e: unknown) => (e as { getStatus(): number }).getStatus() === 404,
    );
    await assert.rejects(documentBundleStatus(foreign.context, bundle.id));
    const owner = randomUUID();
    const job = await claimJob(db, owner, c.tenantId);
    assert.equal(job?.id, bundle.id);
    await executeJob(db, store, job!, owner, new AbortController().signal);
    const ready = await documentBundleStatus(c, bundle.id);
    assert.equal(ready.status, "READY");
    assert.equal(ready.parts.length, 2);
    assert.ok(await documentBundlePart(c, bundle.id, 0));
    assert.equal(
      (await prepareDocumentBundle(c, { documentIds, format: "PDF" })).id,
      bundle.id,
    );
    assert.equal(
      await db.artifact.count({
        where: { tenantId: c.tenantId, jobId: bundle.id },
      }),
      2,
    );
    await db.lmsGroupMember.update({
      where: {
        tenantId_groupId_enrollmentId: {
          tenantId: c.tenantId,
          groupId: group.id,
          enrollmentId: enrollments[0].id,
        },
      },
      data: { excludedAt: new Date() },
    });
    assert.equal((await listEnrollmentPage(c, { groupId: group.id })).total, 4);
  },
);

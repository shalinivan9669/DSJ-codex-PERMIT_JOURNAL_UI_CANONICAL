import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { provision } from "../setup";
import { db, type Context } from "../../apps/api/src/core";
import { createCourse, publishVersion } from "../../apps/api/src/lms/courses";
import { assignEnrollments } from "../../apps/api/src/lms/enrollments";
import {
  addExternalEvidence,
  reviewExternalEvidence,
} from "../../apps/api/src/lms/external";
import { advanceLmsDocuments } from "../../apps/api/src/lms/document-bridge";
import { store } from "../../apps/api/src/files";
import { uploadDestination } from "../../apps/api/src/lms/materials";
import { assertTestDatabase } from "../../tests/integration/test-database";
import {
  lmsCourse,
  lmsLearner,
  LMS_PASSWORD,
} from "../../tests/integration/lms-fixture";
import { pdfObjects, pdfStream } from "../../tests/fixtures/pdf";

const file = resolve(".runtime/lms-one-run/copy-fixture.json");
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

async function main() {
  assertTestDatabase();
  const target = new URL(process.env.DATABASE_URL!);
  if (
    process.env.DEMO_LMS_TEST_RUNTIME !== "1" ||
    target.hostname !== "127.0.0.1" ||
    !target.pathname.startsWith("/demo_test_lms_browser_")
  )
    throw new Error("OWN_BROWSER_DATABASE_REQUIRED");
  if (process.argv.includes("--advance")) {
    const fixture = JSON.parse(await readFile(file, "utf8"));
    const tenant = await db.tenant.findUniqueOrThrow({
      where: { id: fixture.tenantId },
    });
    assert.equal(tenant.demoOnly, true);
    const deadline = performance.now() + 210000;
    while (performance.now() < deadline) {
      // Run the shipping mechanical advancement, never a fabricated issuance.
      // The already running render worker owns actual PDF/DOCX generation.
      await advanceLmsDocuments(100);
      const link = await db.lmsDocumentLink.findFirst({
        where: { tenantId: tenant.id, resultId: fixture.resultId },
      });
      if (link?.status === "ISSUED") return;
      await new Promise((done) => setTimeout(done, 1000));
    }
    throw new Error("COPY_APPLICATION_RENDER_NOT_COMPLETE");
  }
  if (process.argv.includes("--readback")) {
    const fixture = JSON.parse(await readFile(file, "utf8"));
    const tenant = await db.tenant.findUniqueOrThrow({
      where: { id: fixture.tenantId },
    });
    assert.equal(tenant.demoOnly, true);
    const result = await db.verifiedExamResult.findFirstOrThrow({
      where: { id: fixture.resultId, tenantId: fixture.tenantId },
    });
    const source = await db.lmsExternalEvidence.findFirstOrThrow({
      where: { id: fixture.sourceId, tenantId: fixture.tenantId },
    });
    const link = await db.lmsDocumentLink.findFirstOrThrow({
      where: { resultId: result.id, tenantId: fixture.tenantId },
    });
    const issuance = await db.issuance.findFirstOrThrow({
      where: { id: link.issuanceId!, tenantId: fixture.tenantId },
    });
    const workflow = await db.issuanceWorkflow.findFirstOrThrow({
      where: { issuanceId: issuance.id, tenantId: fixture.tenantId },
    });
    const privateBytes = await store.read(source.storageKey, source.sha256);
    const readback = {
      checkedAt: new Date().toISOString(),
      tenantId: fixture.tenantId,
      enrollmentId: fixture.enrollmentId,
      resultId: result.id,
      sourceId: source.id,
      assessmentKind: result.assessmentKind,
      score: result.score,
      maximum: result.maximum,
      sourceStatus: source.status,
      privateSourceSha256: digest(privateBytes),
      originalSourceSha256: fixture.sourceSha256,
      attempts: await db.examAttempt.count({
        where: {
          enrollmentId: fixture.enrollmentId,
          tenantId: fixture.tenantId,
        },
      }),
      signatures: await db.documentSignature.count({
        where: { issuanceId: issuance.id, tenantId: fixture.tenantId },
      }),
      workflowStatus: workflow.status,
      legalForm: link.legalForm,
      originalReference: link.originalReference,
      issuanceSnapshot: issuance.snapshot,
    };
    await writeFile(
      file.replace("fixture.json", "readback.json"),
      JSON.stringify(readback, null, 2),
    );
    return;
  }
  const started = performance.now();
  const center = await provision({
    email: `copy-${randomUUID()}@example.test`,
    password: LMS_PASSWORD,
    name: "Синтетический центр копии",
    sample: true,
  });
  const context: Context = {
    tenantId: center.tenantId,
    userId: center.userId,
    role: "DIRECTOR",
    sessionId: "copy-fixture",
    csrfHash: "",
    correlationId: randomUUID(),
  };
  const learner = await lmsLearner(center.tenantId, "Копия оригинала");
  const issuer = "Synthetic external authorized issuer COPY";
  const number = "SYNTHETIC-COPY-ORIGINAL-42";
  const definition = lmsCourse({
    kind: "EXTERNAL_AUTHORIZED",
    required: false,
  });
  definition.profile.legalForm = "COPY_OF_ORIGINAL";
  definition.profile.externalEvidenceLevel = "DOCUMENT_REVIEWED";
  definition.profile.documentTypes = ["CERTIFICATE"];
  definition.profile.issuer = issuer;
  definition.profile.examiner = issuer;
  definition.content.titleRu =
    "Синтетическая программа внешнего экзамена для копии";
  const course = await createCourse(context, definition);
  await publishVersion(context, course.version.id, { revision: 0 });
  const enrollment = (
    await assignEnrollments(context, {
      courseVersionId: course.version.id,
      recipientIds: [learner.recipient.id],
    })
  ).items[0];
  const bytes = pdfObjects([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    pdfStream(
      Buffer.from(
        `BT /F1 14 Tf 50 780 Td (SYNTHETIC EXTERNAL SOURCE - NOT A REAL QUALIFICATION) Tj 0 -30 Td (${issuer}) Tj 0 -30 Td (${number}) Tj 0 -30 Td (Document date 2026-01-14; exam date 2026-01-12; passed) Tj 0 -30 Td (No numerical score was supplied by the source.) Tj ET`,
      ),
    ),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]);
  const uploadPath = resolve(await uploadDestination(), `${randomUUID()}.pdf`);
  await writeFile(uploadPath, bytes);
  const source = await addExternalEvidence(
    context,
    enrollment.id,
    {
      issuer,
      sourceSystem: "Synthetic local engineering source",
      documentNumber: number,
      documentDate: "2026-01-14",
      examDate: "2026-01-12",
    },
    {
      originalname: "synthetic-external-copy-source.pdf",
      mimetype: "application/pdf",
      size: bytes.length,
      path: uploadPath,
    } as Express.Multer.File,
  );
  await reviewExternalEvidence(context, source.id, {
    status: "DOCUMENT_REVIEWED",
    verdict: "PASSED",
    reviewMethod:
      "Synthetic director inspected the private test source; this is document review, not machine verification or real authority.",
  });
  const result = await db.verifiedExamResult.findFirstOrThrow({
    where: { tenantId: center.tenantId, enrollmentId: enrollment.id },
  });
  assert.equal(result.score, null);
  assert.equal(result.maximum, null);
  assert.equal(
    await db.examAttempt.count({
      where: { tenantId: center.tenantId, enrollmentId: enrollment.id },
    }),
    0,
  );
  await mkdir(resolve(".runtime/lms-one-run"), { recursive: true });
  await writeFile(
    file,
    JSON.stringify(
      {
        fixtureVersion: "lms-copy-original-v1",
        tenantId: center.tenantId,
        director: center.email,
        learner: learner.user.email,
        fullName: "Синтетический слушатель Копия оригинала",
        enrollmentId: enrollment.id,
        resultId: result.id,
        sourceId: source.id,
        sourceSha256: digest(bytes),
        issuer,
        originalNumber: number,
        originalDocumentDate: "2026-01-14",
        examDate: "2026-01-12",
        setupMilliseconds: performance.now() - started,
        preconditions:
          "Prepared synthetic demoOnly tenant, director/learner, published CONFIRMED synthetic EXTERNAL_AUTHORIZED COPY_OF_ORIGINAL profile, assignment, real private PDF and DOCUMENT_REVIEWED result created through provisioning/domain functions. No local exam attempt, numerical score, electronic signature, issuance or generated document is seeded. This is prepared-form acceptance, not first entry or proof of real qualification.",
      },
      null,
      2,
    ),
  );
  console.log("LMS_COPY_FIXTURE_READY");
}
main().finally(() => db.$disconnect());

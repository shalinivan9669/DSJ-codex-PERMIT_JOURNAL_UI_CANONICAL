import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { bootstrap } from "../../apps/api/src/main";
import { db, type Context } from "../../apps/api/src/core";
import { provision } from "../../scripts/setup";
import { saveUser } from "../../apps/api/src/settings";
import { saveSignatory, signingState } from "../../apps/api/src/signing";
import { createCourse, publishVersion } from "../../apps/api/src/lms/courses";
import { assignEnrollments } from "../../apps/api/src/lms/enrollments";
import {
  startAttempt,
  saveAnswers,
  submitAttempt,
} from "../../apps/api/src/lms/exams";
import {
  prepareResultDocuments,
  advanceLmsDocuments,
} from "../../apps/api/src/lms/document-bridge";
import { decideProposal } from "../../apps/api/src/approvals";
import { store } from "../../apps/api/src/files";
import {
  claimJob,
  executeJob,
  heartbeat,
  settleFailure,
  DeferredJob,
} from "../../apps/render-worker/src/queue";
import {
  lmsCourse,
  lmsLearner,
  lmsSession,
  lmsHttp,
  LMS_PASSWORD,
} from "./lms-fixture";

test(
  "J08 authenticated HTTP checks the actual required signer before provider readiness",
  { timeout: 240000 },
  async () => {
    const target = new URL(process.env.DATABASE_URL || "http://invalid");
    assert.equal(target.hostname, "127.0.0.1");
    assert.equal(target.port, "55489");
    assert.equal(
      target.pathname,
      "/demo_test_mvp_roles_20261019_run01_integration",
    );
    process.env.DEMO_LMS_TEST_RUNTIME = "1";
    process.env.PORT = "0";
    process.env.DEMO_ORIGIN = "http://localhost:3179";
    for (const key of [
      "DEMO_SIGNATURE_VERIFIER_URL",
      "DEMO_SIGNATURE_VERIFIER_TOKEN",
      "DEMO_EGOV_SIGNING_CONNECTOR_URL",
      "DEMO_EGOV_SIGNING_CONNECTOR_TOKEN",
    ])
      delete process.env[key];
    const directory = resolve(
      "docs/evidence/mvp-all-roles-20261019/run-01/documents/signing-authority",
    );
    const runtime = resolve(
      ".runtime/mvp-all-roles-20261019/run-01/signing-authority-fixture.private.json",
    );
    await mkdir(directory, { recursive: true });
    const app = await bootstrap();
    const base = await app.getUrl();
    let fixture: {
      tenantId: string;
      directorId: string;
      requestId: string;
      issuanceId: string;
      artifactId: string;
      sha256: string;
      bindingId: string;
      signerId: string;
      signerEmail: string;
      signerName: string;
      nonSignerEmail: string;
    };
    try {
      try {
        if (process.env.DEMO_SIGNING_AUTHORITY_REUSE !== "1")
          throw new Error("Create a fresh isolated signing fixture");
        fixture = JSON.parse(await readFile(runtime, "utf8"));
      } catch {
        const center = await provision({
          email: `signing-http-${randomUUID()}@example.test`,
          password: LMS_PASSWORD,
          name: "Синтетическая проверка полномочий подписи",
          sample: true,
        });
        const c: Context = {
          tenantId: center.tenantId,
          userId: center.userId,
          role: "DIRECTOR",
          sessionId: "synthetic",
          csrfHash: "synthetic",
          correlationId: randomUUID(),
        };
        const signer = await saveUser(c, {
          email: `signer-${randomUUID()}@example.test`,
          password: LMS_PASSWORD,
          displayName: "Синтетический назначенный подписант HTTP",
          role: "OPERATOR",
        });
        const other = await saveUser(c, {
          email: `nonsigner-${randomUUID()}@example.test`,
          password: LMS_PASSWORD,
          displayName: "Синтетический оператор без подписи",
          role: "OPERATOR",
        });
        const binding = await saveSignatory(c, {
          userId: signer.id,
          displayName: signer.displayName,
          role: "CHAIR",
          iin: "000000000077",
        });
        const definition = lmsCourse({
          questions: 1,
          required: false,
          signatures: [signer.displayName],
        });
        definition.profile.legalForm = "ELECTRONIC_ORIGINAL";
        definition.profile.documentTypes = ["CERTIFICATE"];
        const course = await createCourse(c, definition);
        await publishVersion(c, course.version.id, { revision: 0 });
        const learner = await lmsLearner(c.tenantId, "HTTP подпись");
        const enrollment = (
          await assignEnrollments(c, {
            courseVersionId: course.version.id,
            recipientIds: [learner.recipient.id],
          })
        ).items[0];
        const attempt = await startAttempt(learner.context, enrollment.id);
        await saveAnswers(learner.context, attempt.id, {
          sequence: 1,
          answers: { [attempt.questions[0].id]: ["a"] },
        });
        const completed = await submitAttempt(learner.context, attempt.id);
        const prepared = await prepareResultDocuments(c, {
          resultIds: [completed.result!.id],
        });
        assert.deepEqual(prepared.errors, []);
        assert.equal(prepared.items.length, 1);
        const requestId = prepared.items[0].requestId;
        const proposal = await db.requestProposal.findFirstOrThrow({
          where: { tenantId: c.tenantId, requestId, status: "PENDING" },
        });
        await decideProposal(c, proposal.id, {
          decision: "APPROVE",
          reason: "Синтетическая HTTP проверка подписанта",
          expectedProposalHash: proposal.proposalHash,
        });
        await advanceLmsDocuments(30, c.tenantId);
        const owner = `signing-http-${randomUUID()}`;
        for (let n = 0; n < 40; n++) {
          if (
            !(await db.generationJob.count({
              where: {
                tenantId: c.tenantId,
                requestId,
                status: { not: "SUCCEEDED" },
              },
            }))
          )
            break;
          const job = await claimJob(db, owner, c.tenantId);
          if (!job) {
            await new Promise((done) => setTimeout(done, 250));
            continue;
          }
          const timer = setInterval(() => {
            void heartbeat(db, job, owner);
          }, 5000);
          try {
            await executeJob(
              db,
              store,
              job,
              owner,
              AbortSignal.timeout(180000),
            );
          } catch (error) {
            await settleFailure(db, job, owner, error);
            if (!(error instanceof DeferredJob)) throw error;
          } finally {
            clearInterval(timer);
          }
        }
        const state = await signingState(c, requestId);
        assert.equal(state.status, "AWAITING_SIGNATURE");
        assert.equal(state.documents.length, 1);
        const artifact = await db.artifact.findUniqueOrThrow({
          where: { id: state.documents[0].artifactId! },
        });
        assert.equal(
          artifact.rendererVersion === "synthetic-byte-fixture",
          false,
        );
        const bytes = await store.read(artifact.storageKey, artifact.sha256);
        assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
        await writeFile(
          resolve(directory, "unsigned-real-certificate.pdf"),
          bytes,
        );
        fixture = {
          tenantId: c.tenantId,
          directorId: c.userId,
          requestId,
          issuanceId: state.issuanceId!,
          artifactId: artifact.id,
          sha256: artifact.sha256,
          bindingId: binding.id,
          signerId: signer.id,
          signerEmail: signer.email,
          signerName: signer.displayName,
          nonSignerEmail: other.email,
        };
        await writeFile(runtime, JSON.stringify(fixture, null, 2));
      }
      await db.tenant.findUniqueOrThrow({ where: { id: fixture.tenantId } });
      const allowed = lmsHttp(
        base,
        await lmsSession(base, fixture.signerEmail),
      );
      const denied = lmsHttp(
        base,
        await lmsSession(base, fixture.nonSignerEmail),
      );
      const read = await allowed(
        `/print-requests/${fixture.requestId}/signing`,
      );
      assert.equal(read.status, 200);
      const state = await read.json();
      assert.equal(state.status, "AWAITING_SIGNATURE");
      assert.equal(
        state.documents[0].requiredSigners.find(
          (entry: { bindingId: string }) =>
            entry.bindingId === fixture.bindingId,
        ).canSign,
        true,
      );
      const otherRead = await denied(
        `/print-requests/${fixture.requestId}/signing`,
      );
      assert.equal(otherRead.status, 200);
      assert.equal(
        (await otherRead.json()).documents[0].requiredSigners.some(
          (entry: { canSign: boolean }) => entry.canSign,
        ),
        false,
      );
      const results = [];
      for (const provider of ["NCALAYER", "EGOV_QR"]) {
        assert.equal(state.providers[provider].available, false);
        for (const [who, client] of [
          ["assignedSigner", allowed],
          ["sameRoleNonSigner", denied],
        ] as const) {
          const response = await client(
            `/print-requests/${fixture.requestId}/signing/start`,
            "POST",
            {
              provider,
              artifactId: fixture.artifactId,
              bindingId: fixture.bindingId,
            },
          );
          const body = await response.json();
          results.push({
            who,
            provider,
            http: response.status,
            code: body.code,
          });
        }
      }
      const counts = {
        sessions: await db.signingSession.count({
          where: { tenantId: fixture.tenantId },
        }),
        signatures: await db.documentSignature.count({
          where: { tenantId: fixture.tenantId },
        }),
      };
      const passed = results.every((item) =>
        item.who === "assignedSigner"
          ? item.http === 503 && item.code === "SIGNING_PROVIDER_UNAVAILABLE"
          : item.http === 403 && item.code === "SIGNATORY_REQUIRED",
      );
      await writeFile(
        resolve(
          directory,
          passed
            ? "J08-signing-authority.json"
            : "before-authorization-order-fix.json",
        ),
        JSON.stringify(
          {
            status: passed ? "PASS" : "FAIL",
            synthetic: true,
            transport:
              "Actual Nest HTTP, authenticated sessions, valid Origin and CSRF",
            tenantId: fixture.tenantId,
            requestId: fixture.requestId,
            issuanceId: fixture.issuanceId,
            artifactId: fixture.artifactId,
            pdfSha256: fixture.sha256,
            legalForm: "ELECTRONIC_ORIGINAL",
            sameUserRole: "OPERATOR",
            requiredSignerCanSign: true,
            nonSignerCanSign: false,
            results,
            createdSigningSessions: counts.sessions,
            createdDocumentSignatures: counts.signatures,
            cryptographicSignatureAttempted: false,
            externalProviderCalled: false,
          },
          null,
          2,
        ),
      );
      assert.equal(counts.sessions, 0);
      assert.equal(counts.signatures, 0);
      assert.equal(
        passed,
        true,
        "Signer authority must be checked before provider availability; inspect secret-free evidence statuses",
      );
    } finally {
      await app.close();
      await db.$disconnect();
    }
  },
);

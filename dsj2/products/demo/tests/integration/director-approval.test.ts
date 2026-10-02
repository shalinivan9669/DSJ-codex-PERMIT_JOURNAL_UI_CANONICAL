import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { assertTestDatabase } from "./test-database";
import { createApprovalFixture } from "./live-approval-fixture";
import { provision } from "../../scripts/setup";
import { db, hash, json, audit, type Context } from "../../apps/api/src/core";
import {
  draftSchema,
  itemSchema,
  assignmentSchema,
  type Draft,
} from "../../packages/contracts/src";
import {
  createRequest,
  patchRequest,
  requestDetail,
  finalize,
  validateRequest,
  cancelRequest,
  deleteDraft,
  correction,
} from "../../apps/api/src/requests";
import {
  approvalDetail,
  decideProposal,
  workingRequest,
  requireApproved,
  requestActivity,
} from "../../apps/api/src/approvals";
import { saveUser } from "../../apps/api/src/settings";
import { applyImportReconciliation } from "../../apps/api/src/imports";
import {
  signingState,
  startSigning,
  completeSigning,
  assertVerification,
  connectorUrl,
  prepareSigningPolicy,
  signersFor,
} from "../../apps/api/src/signing";
import { store, readArtifact, registryExport } from "../../apps/api/src/files";
import {
  claimJob,
  executeJob,
  heartbeat,
} from "../../apps/render-worker/src/queue";

function context(tenantId: string, userId: string, role = "ADMIN"): Context {
  return {
    tenantId,
    userId,
    role,
    correlationId: randomUUID(),
    csrfHash: "test",
    sessionId: "test",
  };
}
function fixture(): Draft {
  return draftSchema.parse({
    kind: "PERSON",
    title: "Синтетическая проверка согласования",
    demoMode: true,
    items: [
      itemSchema.parse({
        id: randomUUID(),
        employeeCategory: "WORKER",
        personnelNumber: "TEST-001",
        externalId: "SYNTHETIC-TEST-001",
        fullNameRu: "Синтетический Получатель",
        fullNameKz: "Синтетикалық Алушы",
        positionRu: "Слесарь",
        positionKz: "Слесарь",
        workplaceRu: "Синтетическое предприятие",
        workplaceKz: "Синтетикалық кәсіпорын",
        assignments: [
          assignmentSchema.parse({
            id: randomUUID(),
            templateId: "pb-card",
            documentDate: "2026-10-01",
            trainingStart: "2026-09-29",
            trainingEnd: "2026-09-30",
            protocolDate: "2026-10-01",
            trainingSubject: "Пожарная безопасность",
            hours: "40",
            result: "Сдал",
            outcome: {
              status: "PASSED",
              source: "Синтетическая проверка знаний",
            },
          }),
        ],
      }),
    ],
  });
}
function rejectedCode(code: string) {
  return (error: unknown) => {
    const candidate = error as { getResponse?: () => { code?: string } };
    assert.equal(candidate.getResponse?.().code, code);
    return true;
  };
}
function editable(value: { draft: unknown }): Draft {
  return draftSchema.parse(value.draft);
}

test("director approval, immutable official versions and real CMS rejection in isolated PostgreSQL", async (t) => {
  assertTestDatabase();
  const suffix = randomUUID();
  const a = await provision({
    email: `approval-${suffix}@example.test`,
    password: "Synthetic-approval-password!",
    name: "Синтетический центр согласований",
    sample: true,
  });
  const b = await provision({
    email: `approval-other-${suffix}@example.test`,
    password: "Synthetic-approval-password!",
    name: "Изолированный синтетический центр",
    sample: true,
  });
  const admin = context(a.tenantId, a.userId),
    other = context(b.tenantId, b.userId);
  const operatorUser = await saveUser(admin, {
    email: `operator-${suffix}@example.test`,
    password: "Synthetic-approval-password!",
    displayName: "Синтетический менеджер",
    role: "OPERATOR",
  });
  const viewerUser = await saveUser(admin, {
    email: `viewer-${suffix}@example.test`,
    password: "Synthetic-approval-password!",
    displayName: "Синтетический читатель",
    role: "VIEWER",
  });
  const operator = context(a.tenantId, operatorUser.id, "OPERATOR"),
    viewer = context(a.tenantId, viewerUser.id, "VIEWER");
  const approvals = await createApprovalFixture(admin);
  const director = approvals.directorContext;
  try {
    await t.test(
      "any create or save stores a proposal and cannot bypass mandatory LIVE_V1 rules",
      async () => {
        const created = await createRequest(operator, fixture());
        assert.equal(created.revision, 1);
        assert.equal(created.approval.status, "PENDING");
        const official = await db.printRequest.findUniqueOrThrow({
          where: { id: created.id },
        });
        assert.equal(official.revision, 0);
        assert.equal(draftSchema.parse(official.draft).items.length, 0);
        const pending = editable(await workingRequest(admin, created.id));
        assert.equal(pending.businessRuleVersion, "LIVE_V1");
        assert.ok(pending.profileVersionId);
        assert.deepEqual(
          pending.items[0].assignments.map((x) => x.templateId),
          ["pb-card", "pb-protocol"],
        );
        assert.equal(pending.items[0].assignments[0].validUntil, "2027-10-01");
        await assert.rejects(
          finalize(
            admin,
            created.id,
            { expectedRevision: created.revision },
            randomUUID(),
          ),
          rejectedCode("DIRECTOR_APPROVAL_REQUIRED"),
        );
        await assert.rejects(
          patchRequest(viewer, created.id, {
            expectedRevision: created.revision,
            draft: pending,
          }),
          rejectedCode("ROLE_DENIED"),
        );
        for (const caller of [admin, operator])
          await assert.rejects(
            decideProposal(caller, created.approval.proposalId, {
              decision: "APPROVE",
              reason: "Попытка обхода",
              expectedProposalHash: created.approval.proposalHash,
            }),
            rejectedCode("DIRECTOR_REQUIRED"),
          );
        await assert.rejects(
          db.proposalDecision.create({
            data: {
              tenantId: a.tenantId,
              proposalId: created.approval.proposalId,
              proposalHash: created.approval.proposalHash,
              decision: "APPROVE",
              comment: "SQL обход",
              decidedBy: admin.userId,
            },
          }),
          /DEMO_DIRECTOR_REQUIRED/,
        );
        await assert.rejects(
          approvalDetail(other, created.approval.proposalId),
          rejectedCode("NOT_FOUND"),
        );
        const detail = await approvalDetail(
          director,
          created.approval.proposalId,
        );
        assert.ok(detail.diff.length > 0);
        const managerDetail = await approvalDetail(
          operator,
          created.approval.proposalId,
        );
        assert.deepEqual(managerDetail.diff, []);
        assert.equal("before" in managerDetail, false);
        await assert.rejects(
          decideProposal(director, created.approval.proposalId, {
            decision: "APPROVE",
            reason: "Устаревшее сравнение",
            expectedProposalHash: "0".repeat(64),
          }),
          rejectedCode("APPROVAL_STALE"),
        );
        await approvals.approve(created.id);
        const approved = await requestDetail(admin, created.id);
        assert.equal(approved.approval?.status, "APPROVED");
        assert.equal(approved.approvedRevision, created.revision);
        assert.equal(
          (await requireApproved(admin, created.id, created.revision)).id,
          created.approval.proposalId,
        );
        const nextDraft = editable(approved);
        nextDraft.title = "Новая рабочая редакция";
        const next = await patchRequest(operator, created.id, {
          expectedRevision: approved.revision,
          draft: nextDraft,
        });
        assert.equal(next.revision, 2);
        assert.equal(
          editable(await workingRequest(admin, created.id)).title,
          nextDraft.title,
        );
        assert.equal(
          draftSchema.parse(
            (
              await db.printRequest.findUniqueOrThrow({
                where: { id: created.id },
              })
            ).draft,
          ).title,
          pending.title,
        );
        await assert.rejects(
          requireApproved(admin, created.id, approved.revision),
          rejectedCode("DIRECTOR_APPROVAL_REQUIRED"),
        );
        await assert.rejects(
          db.printRequest.update({
            where: { id: created.id },
            data: { draft: json(nextDraft) },
          }),
          /DEMO_APPROVAL_REQUIRED/,
        );
        await assert.rejects(
          db.printRequest.update({
            where: { id: created.id },
            data: { status: "FINALIZED" },
          }),
          /DEMO_APPROVAL_REQUIRED/,
        );
        await assert.rejects(
          db.printRequest.update({
            where: { id: created.id },
            data: { archivedAt: new Date() },
          }),
          /DEMO_ARCHIVE_NOT_COMPLETE/,
        );
        await assert.rejects(
          db.printRequest.update({
            where: { id: created.id },
            data: { approvalPolicy: false },
          }),
          /DEMO_APPROVAL_BYPASS/,
        );
        await decideProposal(director, next.approval.proposalId, {
          decision: "REJECT",
          reason: "Требуется исправление",
          expectedProposalHash: next.approval.proposalHash,
        });
        const rejected = await workingRequest(operator, created.id);
        assert.equal(rejected.approval?.status, "REJECTED");
        assert.equal(editable(rejected).title, nextDraft.title);
        assert.equal(rejected.approvedRevision, 1);
        await assert.rejects(
          db.proposalDecision.updateMany({
            where: { proposalId: next.approval.proposalId },
            data: { comment: "Изменение истории" },
          }),
          /DEMO_IMMUTABLE/,
        );
      },
    );
    await t.test(
      "simultaneous autosaves accept one revision and invalidate obsolete approval",
      async () => {
        const created = await createRequest(operator, fixture());
        const changed = editable(await workingRequest(operator, created.id));
        changed.title = "Параллельное изменение";
        const outcomes = await Promise.allSettled(
          [1, 2].map(() =>
            patchRequest(operator, created.id, {
              expectedRevision: created.revision,
              draft: changed,
            }),
          ),
        );
        assert.equal(
          outcomes.filter((x) => x.status === "fulfilled").length,
          1,
        );
        const failure = outcomes.find(
          (x) => x.status === "rejected",
        ) as PromiseRejectedResult;
        rejectedCode("REVISION_CONFLICT")(failure.reason);
        assert.equal(
          (
            await db.requestProposal.findUniqueOrThrow({
              where: { id: created.approval.proposalId },
            })
          ).status,
          "SUPERSEDED",
        );
        await assert.rejects(
          decideProposal(director, created.approval.proposalId, {
            decision: "APPROVE",
            reason: "Старое сравнение",
            expectedProposalHash: created.approval.proposalHash,
          }),
          rejectedCode("APPROVAL_STALE"),
        );
        const latest = await workingRequest(admin, created.id);
        await assert.rejects(
          db.requestProposal.update({
            where: { id: latest.approval!.proposalId },
            data: { payload: json(fixture()) },
          }),
          /DEMO_PROPOSAL_IMMUTABLE/,
        );
      },
    );
    await t.test(
      "reconciled imports, archive requests and history preserve the official version",
      async () => {
        const created = await createRequest(operator, fixture());
        await approvals.approve(created.id);
        const current = await workingRequest(operator, created.id),
          draft = editable(current);
        const batch = await db.importBatch.create({
          data: {
            tenantId: a.tenantId,
            checksum: hash(randomUUID()),
            rows: { rows: [{ sourceRow: 2 }], errors: [] },
          },
        });
        const imported = itemSchema.parse({
          ...draft.items[0],
          id: randomUUID(),
          importId: batch.id,
          sourceRow: 2,
          fullNameRu: "Исправленный получатель",
          employeeCategory: "ITR",
          fullNameEn: "Synthetic Recipient",
        });
        const input = {
          expectedRevision: current.revision,
          importId: batch.id,
          rows: [imported],
          operationKey: randomUUID(),
          fieldMask: ["fullNameRu", "employeeCategory", "fullNameEn"],
        };
        const result = (await applyImportReconciliation(
          operator,
          created.id,
          input,
        )) as { revision: number; approval: { status: string } };
        assert.equal(result.approval.status, "PENDING");
        assert.equal(result.revision, current.revision + 1);
        const official = draftSchema.parse(
          (
            await db.printRequest.findUniqueOrThrow({
              where: { id: created.id },
            })
          ).draft,
        );
        assert.equal(official.items[0].fullNameRu, draft.items[0].fullNameRu);
        const pending = editable(await workingRequest(operator, created.id));
        assert.equal(pending.items[0].employeeCategory, "ITR");
        assert.equal(pending.items[0].assignments[0].validUntil, "2029-10-01");
        assert.deepEqual(
          JSON.parse(
            JSON.stringify(
              await applyImportReconciliation(operator, created.id, input),
            ),
          ),
          JSON.parse(JSON.stringify(result)),
        );
        await audit(db, admin, "INTERNAL_RENDER_DIAGNOSTIC", created.id, {
          hidden: "runtime internals",
        });
        assert.equal(
          (await requestActivity(operator, created.id)).items.some(
            (x) => x.action === "INTERNAL_RENDER_DIAGNOSTIC",
          ),
          false,
        );
        assert.equal(
          (await requestActivity(director, created.id)).items.some(
            (x) => x.action === "INTERNAL_RENDER_DIAGNOSTIC",
          ),
          false,
        );
        const middle = (await requestActivity(admin, created.id)).items.find(
          (x) => x.action === "INTERNAL_RENDER_DIAGNOSTIC",
        );
        assert.ok(middle);
        assert.equal("details" in middle, false);
        await deleteDraft(operator, created.id);
        assert.equal(
          (
            await db.printRequest.findUniqueOrThrow({
              where: { id: created.id },
            })
          ).archivedAt,
          null,
        );
        await approvals.approve(created.id);
        assert.ok(
          (
            await db.printRequest.findUniqueOrThrow({
              where: { id: created.id },
            })
          ).archivedAt,
        );
      },
    );
    await t.test(
      "template signer map, ambiguous director and missing commission fail closed",
      async () => {
        const profile = await db.issuerProfileVersion.findFirstOrThrow({
          where: { tenantId: a.tenantId },
          orderBy: { version: "desc" },
        });
        const policy = await prepareSigningPolicy(db, admin, profile.profile);
        assert.equal(signersFor(policy, "biot-worker-card").length, 3);
        assert.equal(signersFor(policy, "biot-itr-certificate").length, 2);
        assert.equal(signersFor(policy, "ps-card").length, 4);
        assert.equal(signersFor(policy, "ps-protocol").length, 4);
        assert.equal(signersFor(policy, "ptm-card").length, 1);
        assert.equal(connectorUrl("http://example.invalid"), null);
        assert.equal(connectorUrl("https://user:secret@example.invalid"), null);
        assert.equal(connectorUrl("https://example.invalid?secret=x"), null);
        const second = await saveUser(admin, {
          email: `second-director-${suffix}@example.test`,
          password: "Synthetic-approval-password!",
          displayName: "Второй директор",
          role: "DIRECTOR",
        });
        const binding = await db.signatoryBinding.create({
          data: {
            tenantId: a.tenantId,
            userId: second.id,
            kind: "DIRECTOR",
            displayName: second.displayName,
            iin: "000000000009",
            createdBy: admin.userId,
          },
        });
        await assert.rejects(
          prepareSigningPolicy(db, admin, profile.profile),
          rejectedCode("SIGNATORY_AMBIGUOUS"),
        );
        await db.signatoryBinding.update({
          where: { id: binding.id },
          data: { active: false },
        });
        const otherRequest = await createRequest(other, fixture());
        const missing = await prepareSigningPolicy(db, other, {});
        assert.equal(
          signersFor(missing, "pb-protocol").filter((x) => !x.bindingId).length,
          4,
        );
        assert.equal(
          (
            await db.printRequest.findUniqueOrThrow({
              where: { id: otherRequest.id },
            })
          ).archivedAt,
          null,
        );
      },
    );
    await t.test(
      "approved issuance generates real files but unsigned files never archive or export as an official bundle",
      async () => {
        const customer = await db.customerOrganization.create({
          data: {
            tenantId: a.tenantId,
            nameRu: "Фиксированная компания",
            nameKz: "Бекітілген компания",
            bin: "222222222222",
            addressRu: "Адрес при согласовании",
            addressKz: "",
          },
        });
        const draft = fixture();
        draft.customerId = customer.id;
        draft.items[0].workplaceRu = "";
        draft.items[0].workplaceKz = "";
        draft.organizationSnapshots = [
          {
            id: customer.id,
            nameRu: "Поддельное значение клиента",
            nameKz: null,
            bin: null,
            addressRu: null,
            addressKz: null,
          },
        ];
        const created = await createRequest(operator, draft);
        const pending = editable(await workingRequest(operator, created.id));
        assert.equal(
          pending.organizationSnapshots?.[0].nameRu,
          customer.nameRu,
        );
        await approvals.approve(created.id);
        await db.customerOrganization.update({
          where: { id: customer.id },
          data: {
            nameRu: "Изменённая после согласования компания",
            bin: "333333333333",
            addressRu: "Новый адрес после согласования",
            addressKz: "Кейін толтырылған мекенжай",
          },
        });
        const validation = await validateRequest(operator, created.id, {
          expectedRevision: created.revision,
        });
        assert.deepEqual(validation.issues, []);
        const key = randomUUID();
        const issued = (await finalize(
          operator,
          created.id,
          { expectedRevision: created.revision },
          key,
        )) as { issuanceId: string; lifecycle: string };
        assert.equal(issued.lifecycle, "RENDERING");
        const issuance = await db.issuance.findUniqueOrThrow({
          where: { id: issued.issuanceId },
        });
        const frozen = issuance.snapshot as {
          customer: {
            nameRu: string;
            bin: string;
            addressRu: string;
            addressKz: string | null;
          };
        };
        assert.equal(frozen.customer.nameRu, customer.nameRu);
        assert.equal(frozen.customer.bin, customer.bin);
        assert.equal(frozen.customer.addressRu, customer.addressRu);
        assert.equal(frozen.customer.addressKz, "");
        const inputs = await db.renderInputSnapshot.findMany({
          where: {
            tenantId: a.tenantId,
            issuanceId: issued.issuanceId,
            templateVersionId: { not: null },
          },
        });
        assert.ok(
          inputs.some((input) =>
            (
              input.input as {
                items?: { workplaceRu?: string; employerAddressKz?: string }[];
              }
            ).items?.some(
              (item) =>
                item.workplaceRu === customer.nameRu &&
                item.employerAddressKz === "",
            ),
          ),
        );
        assert.deepEqual(
          await finalize(
            operator,
            created.id,
            { expectedRevision: created.revision },
            key,
          ),
          issued,
        );
        let attempts = 0;
        for (;;) {
          const job = await claimJob(db, "approval-test-worker", a.tenantId);
          if (!job) break;
          assert.ok(++attempts < 30);
          const controller = new AbortController();
          const timer = setInterval(() => {
            void heartbeat(db, job, "approval-test-worker")
              .then((ok) => {
                if (!ok) controller.abort();
              })
              .catch(() => controller.abort());
          }, 5000);
          try {
            await executeJob(
              db,
              store,
              job,
              "approval-test-worker",
              AbortSignal.any([controller.signal, AbortSignal.timeout(210000)]),
            );
          } finally {
            clearInterval(timer);
          }
        }
        const state = await signingState(director, created.id);
        assert.equal(state.status, "AWAITING_SIGNATURE");
        assert.equal(state.documents.length, 2);
        assert.ok(state.documents.every((x) => x.artifactId && !x.complete));
        assert.equal(state.archived, false);
        const bundles = await db.artifact.findMany({
          where: {
            tenantId: a.tenantId,
            issuanceId: issued.issuanceId,
            format: { in: ["ZIP", "XLSX"] },
          },
        });
        assert.equal(bundles.length, 2);
        for (const bundle of bundles)
          await assert.rejects(
            readArtifact(admin, bundle.id),
            rejectedCode("ISSUANCE_NOT_COMPLETE"),
          );
        assert.equal(state.providers.NCALAYER.available, false);
        assert.equal(state.providers.EGOV_QR.available, false);
        assert.equal(
          (
            await db.printRequest.findUniqueOrThrow({
              where: { id: created.id },
            })
          ).archivedAt,
          null,
        );
        await assert.rejects(
          registryExport(admin, { format: "ZIP" }, created.id),
          rejectedCode("ISSUANCE_NOT_COMPLETE"),
        );
        const artifact = await readArtifact(
          director,
          state.documents[0].artifactId!,
        );
        await assert.rejects(
          startSigning(director, created.id, {
            provider: "NCALAYER",
            artifactId: artifact.id,
          }),
          rejectedCode("SIGNING_PROVIDER_UNAVAILABLE"),
        );
        const run = promisify(execFile),
          openssl =
            process.env.DEMO_TEST_OPENSSL ||
            "C:\\Program Files\\Git\\usr\\bin\\openssl.exe";
        const folder = await mkdtemp(join(tmpdir(), "demo-test-cms-")),
          file = join(folder, "document.pdf"),
          signatureFile = join(folder, "signature.p7s"),
          cert = join(folder, "test-ca.pem"),
          keyFile = join(folder, "test-key.pem");
        await writeFile(file, artifact.buffer);
        await run(openssl, [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-keyout",
          keyFile,
          "-out",
          cert,
          "-days",
          "1",
          "-sha256",
          "-subj",
          "/CN=Synthetic Test CA/O=DEMO TEST ONLY",
        ]);
        await run(openssl, [
          "cms",
          "-sign",
          "-binary",
          "-in",
          file,
          "-signer",
          cert,
          "-inkey",
          keyFile,
          "-outform",
          "DER",
          "-out",
          signatureFile,
          "-md",
          "sha256",
        ]);
        await run(openssl, [
          "cms",
          "-verify",
          "-binary",
          "-inform",
          "DER",
          "-in",
          signatureFile,
          "-content",
          file,
          "-CAfile",
          cert,
          "-purpose",
          "any",
          "-out",
          join(folder, "verified.pdf"),
        ]);
        assert.deepEqual(
          await readFile(join(folder, "verified.pdf")),
          artifact.buffer,
        );
        await writeFile(
          join(folder, "tampered.pdf"),
          Buffer.concat([artifact.buffer, Buffer.from("tampered")]),
        );
        await assert.rejects(
          run(openssl, [
            "cms",
            "-verify",
            "-binary",
            "-inform",
            "DER",
            "-in",
            signatureFile,
            "-content",
            join(folder, "tampered.pdf"),
            "-CAfile",
            cert,
            "-purpose",
            "any",
            "-out",
            join(folder, "rejected.pdf"),
          ]),
        );
        const cms = await readFile(signatureFile);
        let cryptographicChecks = 0;
        const verifier = createServer((request, response) => {
          void (async () => {
            assert.equal(
              request.headers.authorization,
              "Bearer synthetic-verifier-secret",
            );
            let text = "";
            for await (const part of request) text += part;
            const payload = JSON.parse(text) as {
              documentBase64: string;
              signatureBase64: string;
            };
            const bytes = Buffer.from(payload.documentBase64, "base64");
            await writeFile(join(folder, "incoming.pdf"), bytes);
            await writeFile(
              join(folder, "incoming.p7s"),
              Buffer.from(payload.signatureBase64, "base64"),
            );
            await run(openssl, [
              "cms",
              "-verify",
              "-binary",
              "-inform",
              "DER",
              "-in",
              join(folder, "incoming.p7s"),
              "-content",
              join(folder, "incoming.pdf"),
              "-CAfile",
              cert,
              "-purpose",
              "any",
              "-out",
              join(folder, "incoming-verified.pdf"),
            ]);
            cryptographicChecks++;
            response.writeHead(200, { "content-type": "application/json" });
            response.end(
              JSON.stringify({
                valid: true,
                authority: "TEST_CA",
                chainValid: true,
                revocationStatus: "GOOD",
                revocationCheckedAt: new Date().toISOString(),
                purpose: "SIGNATURE",
                contentSha256: createHash("sha256").update(bytes).digest("hex"),
                signerIin: "000000000001",
                certificateSerial: "TEST",
                certificateFingerprint: hash("test-ca"),
                notBefore: "2020-01-01T00:00:00.000Z",
                notAfter: "2099-01-01T00:00:00.000Z",
              }),
            );
          })().catch((error) => {
            response.writeHead(500);
            response.end(String(error));
          });
        });
        await new Promise<void>((resolve) =>
          verifier.listen(0, "127.0.0.1", resolve),
        );
        const address = verifier.address() as { port: number };
        const original = {
          node: process.env.NODE_ENV,
          url: process.env.DEMO_SIGNATURE_VERIFIER_URL,
          token: process.env.DEMO_SIGNATURE_VERIFIER_TOKEN,
        };
        process.env.NODE_ENV = "test";
        process.env.DEMO_SIGNATURE_VERIFIER_URL = `http://127.0.0.1:${address.port}`;
        process.env.DEMO_SIGNATURE_VERIFIER_TOKEN = "synthetic-verifier-secret";
        try {
          const started = await startSigning(director, created.id, {
            provider: "NCALAYER",
            artifactId: artifact.id,
          });
          assert.equal(started.format, "CMS");
          assert.equal(started.documentSha256, artifact.sha256);
          assert.equal(
            "ncalayerRequest" in started &&
              started.ncalayerRequest.args.signingParams.encapsulate,
            false,
          );
          await assert.rejects(
            completeSigning(director, started.id, {
              signatureBase64: cms.toString("base64"),
            }),
            rejectedCode("SIGNATURE_INVALID"),
          );
          assert.equal(cryptographicChecks, 1);
          assert.equal(
            await db.documentSignature.count({
              where: { tenantId: a.tenantId, issuanceId: issued.issuanceId },
            }),
            0,
          );
          assert.equal(
            (await signingState(director, created.id)).status,
            "AWAITING_SIGNATURE",
          );
          const corrected = await correction(operator, created.id, {
            expectedRevision: created.revision,
            reason: "Синтетическое связанное исправление",
          });
          assert.equal(corrected.approval.status, "PENDING");
          assert.equal(
            await db.issuanceEvent.count({
              where: { issuanceId: issued.issuanceId, kind: "REPLACED" },
            }),
            0,
          );
          await cancelRequest(operator, created.id, {
            expectedRevision: created.revision,
            reason: "Согласованная отмена",
          });
          assert.equal(
            (
              await db.printRequest.findUniqueOrThrow({
                where: { id: created.id },
              })
            ).status,
            "FINALIZED",
          );
          await approvals.approve(created.id);
          const cancelled = await signingState(director, created.id);
          assert.equal(cancelled.status, "FAILED");
          assert.equal(cancelled.archived, false);
          assert.ok(
            cancelled.documents.every((document) =>
              document.requiredSigners.every((signer) => !signer.canSign),
            ),
          );
          await assert.rejects(
            startSigning(director, created.id, {
              provider: "NCALAYER",
              artifactId: artifact.id,
            }),
            rejectedCode("SIGNING_NOT_READY"),
          );
          await assert.rejects(
            completeSigning(director, started.id, {
              signatureBase64: cms.toString("base64"),
            }),
            rejectedCode("SIGNING_TARGET_CANCELLED"),
          );
          assert.equal(cryptographicChecks, 1);
        } finally {
          for (const [name, value] of [
            ["NODE_ENV", original.node],
            ["DEMO_SIGNATURE_VERIFIER_URL", original.url],
            ["DEMO_SIGNATURE_VERIFIER_TOKEN", original.token],
          ])
            if (value === undefined) delete process.env[name!];
            else process.env[name!] = value;
          await new Promise<void>((resolve, reject) =>
            verifier.close((error) => (error ? reject(error) : resolve())),
          );
        }
      },
    );
    await t.test(
      "strict verification rejects hash, identity, expiry, revoke and stale checks",
      () => {
        const sha = hash("document"),
          now = Date.now();
        const value = {
          valid: true,
          authority: "NCA_RK",
          chainValid: true,
          revocationStatus: "GOOD",
          revocationCheckedAt: new Date(now).toISOString(),
          purpose: "SIGNATURE",
          contentSha256: sha,
          signerIin: "000000000001",
          certificateSerial: "UNIT CONTRACT ONLY",
          certificateFingerprint: hash("cert"),
          notBefore: new Date(now - 1000).toISOString(),
          notAfter: new Date(now + 10000).toISOString(),
        };
        const expected = {
          documentSha256: sha,
          iin: value.signerIin,
          bin: null,
        };
        for (const input of [
          { ...value, authority: "TEST_CA" },
          { ...value, chainValid: false },
          { ...value, revocationStatus: "REVOKED" },
          { ...value, purpose: "AUTHENTICATION" },
        ])
          assert.throws(
            () => assertVerification(input, expected),
            rejectedCode("SIGNATURE_INVALID"),
          );
        for (const input of [
          { ...value, contentSha256: hash("tampered") },
          { ...value, signerIin: "000000000002" },
        ])
          assert.throws(
            () => assertVerification(input, expected),
            rejectedCode("SIGNATURE_BINDING_MISMATCH"),
          );
        for (const input of [
          { ...value, notAfter: new Date(now - 1).toISOString() },
          {
            ...value,
            revocationCheckedAt: new Date(now - 360000).toISOString(),
          },
        ])
          assert.throws(
            () => assertVerification(input, expected, now),
            rejectedCode("SIGNATURE_CERTIFICATE_STALE"),
          );
      },
    );
  } finally {
    await approvals.close();
    await db.$disconnect();
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { draftSchema } from "@demo/contracts";
import { db, type Context } from "../../apps/api/src/core";
import {
  createRequest,
  finalize,
  listRequests,
  patchRequest,
  requestDetail,
} from "../../apps/api/src/requests";
import { submitApproval } from "../../apps/api/src/approvals";
import {
  signingState,
  startSigning,
  completeSigning,
} from "../../apps/api/src/signing";
import {
  collectRegistryRows,
  registryExport,
  store,
  readArtifact,
} from "../../apps/api/src/files";
import { saveCustomer } from "../../apps/api/src/settings";
import { saveExportProfile } from "../../apps/api/src/delivery";
import { provision } from "../../scripts/setup";
import { createApprovalFixture } from "./live-approval-fixture";
import { assertTestDatabase } from "./test-database";

const errorCode = (code: string) => (error: unknown) => {
  assert.equal(
    (error as { getResponse(): { code: string } }).getResponse().code,
    code,
  );
  return true;
};

test("immutable stages sign independently, retain exact registry/customer scope and archive only after every stage completes", async (t) => {
  assertTestDatabase();
  const seeded = await provision({
    email: `stage-signing-${randomUUID()}@example.test`,
    password: "Synthetic-Stages-Only-Password!",
    name: "Синтетический центр этапов и подписей",
    sample: true,
  });
  const c: Context = {
    ...seeded,
    role: "ADMIN",
    sessionId: "test",
    csrfHash: "test",
    correlationId: randomUUID(),
  };
  const approvals = await createApprovalFixture(c);
  t.after(async () => {
    await approvals.close();
    await db.$disconnect();
  });
  const folder = await mkdtemp(join(tmpdir(), "demo-batch-signing-"));
  const run = promisify(execFile);
  const openssl =
    process.env.DEMO_TEST_OPENSSL ||
    "C:\\Program Files\\Git\\usr\\bin\\openssl.exe";
  const bindings = await db.signatoryBinding.findMany({
    where: { tenantId: c.tenantId, active: true },
  });
  const identities = new Map<
    string,
    { cert: string; key: string; fingerprint: string; context: Context }
  >();
  for (const binding of bindings) {
    const cert = join(folder, `${binding.id}.pem`);
    const key = join(folder, `${binding.id}.key`);
    await run(openssl, [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "1",
      "-sha256",
      "-subj",
      `/CN=${binding.iin}/O=DEMO TEST CA ONLY`,
    ]);
    const user = await db.user.findUniqueOrThrow({
      where: { id: binding.userId },
    });
    identities.set(binding.iin, {
      cert,
      key,
      fingerprint: createHash("sha256")
        .update(await readFile(cert))
        .digest("hex"),
      context: { ...c, userId: binding.userId, role: user.role },
    });
  }
  const signedContent = new Map<
    string,
    { iin: string; sha256: string; signature: string }
  >();
  let verifiedCms = 0;
  // This isolated adapter verifies real detached CMS against local test CAs.
  // Its trusted-authority response is a synthetic integration contract fixture,
  // not an assertion that these test certificates are NCA RK certificates.
  const verifier = createServer((incoming, response) => {
    void (async () => {
      assert.equal(incoming.url, "/verify/cms-detached");
      assert.equal(
        incoming.headers.authorization,
        "Bearer synthetic-batch-verifier",
      );
      let body = "";
      for await (const part of incoming) body += part;
      const input = JSON.parse(body) as {
        documentBase64: string;
        signatureBase64: string;
        expectedAuthority: string;
        checkRevocation: boolean;
      };
      assert.equal(input.expectedAuthority, "NCA_RK");
      assert.equal(input.checkRevocation, true);
      const cms = signedContent.get(input.signatureBase64);
      assert.ok(cms, "only the generated synthetic CMS fixture is accepted");
      const bytes = Buffer.from(input.documentBase64, "base64");
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        cms.sha256,
      );
      const documentFile = join(folder, `${randomUUID()}.pdf`);
      await writeFile(documentFile, bytes);
      const identity = identities.get(cms.iin)!;
      await run(openssl, [
        "cms",
        "-verify",
        "-binary",
        "-inform",
        "DER",
        "-in",
        cms.signature,
        "-content",
        documentFile,
        "-CAfile",
        identity.cert,
        "-purpose",
        "any",
        "-out",
        documentFile + ".verified",
      ]);
      assert.deepEqual(await readFile(documentFile + ".verified"), bytes);
      verifiedCms++;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          valid: true,
          authority: "NCA_RK",
          chainValid: true,
          revocationStatus: "GOOD",
          revocationCheckedAt: new Date().toISOString(),
          purpose: "SIGNATURE",
          contentSha256: cms.sha256,
          signerIin: cms.iin,
          certificateSerial: `SYNTHETIC-${cms.iin}`,
          certificateFingerprint: identity.fingerprint,
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
  const savedEnvironment = {
    NODE_ENV: process.env.NODE_ENV,
    DEMO_SIGNATURE_VERIFIER_URL: process.env.DEMO_SIGNATURE_VERIFIER_URL,
    DEMO_SIGNATURE_VERIFIER_TOKEN: process.env.DEMO_SIGNATURE_VERIFIER_TOKEN,
  };
  process.env.NODE_ENV = "test";
  process.env.DEMO_SIGNATURE_VERIFIER_URL = `http://127.0.0.1:${(verifier.address() as { port: number }).port}`;
  process.env.DEMO_SIGNATURE_VERIFIER_TOKEN = "synthetic-batch-verifier";
  t.after(async () => {
    for (const [key, value] of Object.entries(savedEnvironment))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    await new Promise<void>((resolve, reject) =>
      verifier.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const companyA = await saveCustomer(c, {
    nameRu: "SYNTHETIC_STAGE_COMPANY_A",
  });
  const companyB = await saveCustomer(c, {
    nameRu: "SYNTHETIC_STAGE_COMPANY_B",
  });
  const profileA = await saveExportProfile(c, {
    name: "Synthetic stage A registry",
    customerId: companyA.id,
    columns: [
      { field: "fullNameRu", title: "ФИО" },
      { field: "documentNumber", title: "Номер" },
      { field: "protocolNumber", title: "Протокол" },
    ],
  });
  const eventId = randomUUID();
  const draft = draftSchema.parse({
    kind: "COMPANY",
    customerId: companyA.id,
    demoMode: true,
    events: [
      {
        id: eventId,
        title: "Synthetic stage program",
        protocolTemplateId: "pb-protocol",
        protocolMode: "GROUP",
        commonFields: {
          documentDate: "2026-10-04",
          protocolDate: "2026-10-04",
          trainingStart: "2026-10-01",
          trainingEnd: "2026-10-03",
        },
      },
    ],
    items: [0, 1, 2].map((index) => ({
      id: `stage-person-${index}`,
      fullNameRu: `SYNTHETIC_STAGE_PERSON_${index}`,
      positionRu: "Синтетический оператор",
      employerId: index === 1 ? companyB.id : companyA.id,
      assignments: [
        {
          id: `stage-course-${index}`,
          templateId: "pb-card",
          protocolMode: "GROUP",
          eventId,
          outcome: { status: "UNKNOWN" },
        },
      ],
    })),
  });
  const created = await createRequest(c, draft);
  async function issue(index: number) {
    const current = await requestDetail(c, created.id);
    const next = draftSchema.parse(current.draft);
    next.items[index].assignments[0].outcome = {
      status: "PASSED",
      source: `Synthetic actual result stage ${index}`,
    };
    next.events![0].commonFields.documentDate = `2026-10-0${4 + index}`;
    next.events![0].commonFields.protocolDate = `2026-10-0${4 + index}`;
    const saved = await patchRequest(c, created.id, {
      expectedRevision: current.revision,
      draft: next,
    });
    const assignments = [
      {
        rowId: next.items[index].id,
        assignmentId: next.items[index].assignments[0].id,
      },
    ];
    await submitApproval(c, created.id, {
      expectedRevision: saved.revision,
      assignments,
    });
    await approvals.approve(created.id);
    return finalize(
      c,
      created.id,
      { expectedRevision: saved.revision, assignments },
      randomUUID(),
    );
  }
  async function persistByteFixtures(
    issuanceId: string,
    requestId = created.id,
  ) {
    // Real API creates the immutable stage/roster/jobs. Opaque saved byte
    // fixtures isolate signing/routing; print layout has separate real renders.
    for (const job of await db.generationJob.findMany({
      where: { tenantId: c.tenantId, issuanceId, kind: { not: "ZIP" } },
    })) {
      const bytes = Buffer.from(
        `Synthetic saved ${job.kind} ${issuanceId} ${job.documentId || "registry"}`,
      );
      const asset = await store.put(bytes, job.kind.toLowerCase());
      const artifact = await db.artifact.create({
        data: {
          tenantId: c.tenantId,
          requestId,
          issuanceId,
          jobId: job.id,
          documentId: job.documentId,
          ...asset,
          format: job.kind,
          mimeType: "application/octet-stream",
          fileName: `synthetic-${job.id}.${job.kind.toLowerCase()}`,
          provenance: "ORIGINAL",
          rendererVersion: "synthetic-byte-fixture",
          inputHash: job.snapshotId,
        },
      });
      await db.generationJob.update({
        where: { id: job.id },
        data: { status: "SUCCEEDED", artifactId: artifact.id },
      });
    }
  }
  async function signStage(issuanceId: string, requestId = created.id) {
    const current = await signingState(
      approvals.directorContext,
      requestId,
      db,
      issuanceId,
    );
    assert.equal(current.status, "AWAITING_SIGNATURE");
    for (const document of current.documents)
      for (const signer of document.requiredSigners) {
        const binding = bindings.find(
          (entry) => entry.id === signer.bindingId,
        )!;
        const identity = identities.get(binding.iin)!;
        const state = await signingState(
          identity.context,
          requestId,
          db,
          issuanceId,
        );
        assert.ok(
          state.documents
            .find((entry) => entry.documentId === document.documentId)!
            .requiredSigners.find((entry) => entry.bindingId === binding.id)!
            .canSign,
        );
        const artifact = await readArtifact(c, document.artifactId!);
        const file = join(folder, `${randomUUID()}.pdf`);
        const signature = file + ".p7s";
        await writeFile(file, artifact.buffer);
        await run(openssl, [
          "cms",
          "-sign",
          "-binary",
          "-in",
          file,
          "-signer",
          identity.cert,
          "-inkey",
          identity.key,
          "-outform",
          "DER",
          "-out",
          signature,
          "-md",
          "sha256",
        ]);
        const cms = (await readFile(signature)).toString("base64");
        signedContent.set(cms, {
          iin: binding.iin,
          sha256: artifact.sha256,
          signature,
        });
        const session = await startSigning(identity.context, requestId, {
          provider: "NCALAYER",
          artifactId: document.artifactId,
          bindingId: binding.id,
        });
        const persisted = await db.signingSession.findUniqueOrThrow({
          where: { id: session.id },
        });
        assert.equal(persisted.issuanceId, issuanceId);
        const result = await completeSigning(identity.context, session.id, {
          signatureBase64: cms,
        });
        assert.equal(result.status, "VERIFIED");
      }
    return signingState(approvals.directorContext, requestId, db, issuanceId);
  }
  const first = await issue(0);
  await persistByteFixtures(first.issuanceId);
  assert.equal((await requestDetail(c, created.id)).status, "DRAFT");
  const history = await listRequests(c, {
    history: "true",
    status: "DRAFT",
    search: created.id,
  });
  assert.equal(history.items.length, 1);
  assert.equal(
    (await listRequests(c, { history: "true", search: "NO_SYNTHETIC_MATCH" }))
      .items.length,
    0,
  );
  const firstState = await signStage(first.issuanceId);
  assert.equal(firstState.status, "ISSUED");
  assert.equal(firstState.archived, false);
  assert.equal((await requestDetail(c, created.id)).archivedAt, null);
  const firstFiles = await db.artifact.findMany({
    where: { issuanceId: first.issuanceId, format: "PDF" },
  });
  const originalHashes = new Map(
    firstFiles.map((file) => [file.id, file.sha256]),
  );
  const second = await issue(1);
  assert.equal(
    (await signingState(c, created.id)).issuanceId,
    second.issuanceId,
  );
  assert.equal(
    (await signingState(c, created.id, db, first.issuanceId)).status,
    "ISSUED",
  );
  await assert.rejects(
    signingState(c, created.id, db, randomUUID()),
    errorCode("NOT_FOUND"),
  );
  const partial = await collectRegistryRows(c, {}, created.id);
  assert.deepEqual(
    partial.rows.map((row) => row.id),
    ["stage-person-0"],
  );
  const firstOnly = await registryExport(
    c,
    {
      format: "TSV",
      profileId: profileA.id,
      artifactIds: firstFiles.map((file) => file.id),
    },
    created.id,
  );
  assert.match(firstOnly.buffer.toString(), /SYNTHETIC_STAGE_PERSON_0/);
  assert.doesNotMatch(
    firstOnly.buffer.toString(),
    /SYNTHETIC_STAGE_PERSON_[12]/,
  );
  const selectedBundle = await registryExport(
    c,
    {
      format: "ZIP",
      profileId: profileA.id,
      artifactIds: firstFiles.map((file) => file.id),
    },
    created.id,
  );
  const zip = JSON.parse(
    execFileSync(
      process.env.DEMO_PYTHON || "python",
      [
        "-I",
        "-c",
        "import sys,io,zipfile,json,hashlib; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); print(json.dumps({'manifest':json.loads(z.read('manifest.json')),'signatures':json.loads(z.read('signatures.json')),'hashes':{n:hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist()}}))",
      ],
      { input: selectedBundle.buffer, encoding: "utf8", windowsHide: true },
    ),
  ) as {
    manifest: {
      complete: boolean;
      files: Array<{ id: string; file: string; sha256: string }>;
    };
    signatures: {
      signatures: Array<{
        artifactId: string;
        fileName: string;
        documentSha256: string;
        signatureSha256: string;
      }>;
    };
    hashes: Record<string, string>;
  };
  assert.equal(zip.manifest.complete, true);
  assert.deepEqual(
    zip.manifest.files.map((file) => file.id).sort(),
    firstFiles.map((file) => file.id).sort(),
    "earlier completed stage exports despite a later pending workflow",
  );
  for (const file of zip.manifest.files)
    assert.equal(zip.hashes[file.file], originalHashes.get(file.id));
  assert.ok(zip.signatures.signatures.length > 0);
  for (const signature of zip.signatures.signatures) {
    assert.equal(
      signature.documentSha256,
      originalHashes.get(signature.artifactId),
    );
    assert.equal(zip.hashes[signature.fileName], signature.signatureSha256);
  }
  await persistByteFixtures(second.issuanceId);
  const third = await issue(2);
  const secondState = await signStage(second.issuanceId);
  assert.equal(secondState.status, "ISSUED");
  assert.equal(
    secondState.archived,
    false,
    "unfinished later stage prevents whole-request archive",
  );
  assert.equal(
    (await signingState(c, created.id)).issuanceId,
    third.issuanceId,
  );
  await persistByteFixtures(third.issuanceId);
  const thirdState = await signStage(third.issuanceId);
  assert.equal(thirdState.status, "ISSUED");
  assert.equal(thirdState.archived, true);
  const all = await collectRegistryRows(c, {}, created.id);
  assert.deepEqual(all.rows.map((row) => row.id).sort(), [
    "stage-person-0",
    "stage-person-1",
    "stage-person-2",
  ]);
  const groupProtocols = await db.issuedDocument.findMany({
    where: { requestId: created.id, ownerKind: "GROUP" },
  });
  assert.equal(
    new Set(groupProtocols.map((document) => document.number)).size,
    3,
  );
  for (const row of all.rows) {
    const ownDocument = await db.issuedDocument.findUniqueOrThrow({
      where: { id: row.documentId! },
    });
    const protocol = groupProtocols.find(
      (document) => document.issuanceId === ownDocument.issuanceId,
    )!;
    assert.equal(row.protocolDocumentId, protocol.id);
    assert.equal(row.protocolNumber, protocol.number);
  }
  const companyRegistry = await registryExport(
    c,
    { format: "TSV", profileId: profileA.id },
    created.id,
  );
  assert.match(companyRegistry.buffer.toString(), /SYNTHETIC_STAGE_PERSON_0/);
  assert.match(companyRegistry.buffer.toString(), /SYNTHETIC_STAGE_PERSON_2/);
  assert.doesNotMatch(
    companyRegistry.buffer.toString(),
    /SYNTHETIC_STAGE_PERSON_1/,
  );
  const oldStageAgain = await registryExport(
    c,
    {
      format: "TSV",
      profileId: profileA.id,
      artifactIds: firstFiles.map((file) => file.id),
    },
    created.id,
  );
  assert.doesNotMatch(
    oldStageAgain.buffer.toString(),
    /SYNTHETIC_STAGE_PERSON_[12]/,
  );
  for (const file of firstFiles) {
    const bytes = await readArtifact(c, file.id);
    assert.equal(
      createHash("sha256").update(bytes.buffer).digest("hex"),
      originalHashes.get(file.id),
    );
  }
  const individual = await createRequest(
    c,
    draftSchema.parse({
      kind: "PERSON",
      demoMode: true,
      items: [
        {
          id: "individual-person",
          fullNameRu: "SYNTHETIC_INDIVIDUAL_PROTOCOL_PERSON",
          positionRu: "Синтетический оператор",
          assignments: [
            {
              id: "individual-credential",
              templateId: "pb-card",
              protocolMode: "INDIVIDUAL",
              documentDate: "2026-10-07",
              protocolDate: "2026-10-07",
              trainingStart: "2026-10-01",
              trainingEnd: "2026-10-03",
              outcome: {
                status: "PASSED",
                source: "Synthetic individual result",
              },
            },
          ],
        },
      ],
    }),
  );
  await approvals.approve(individual.id);
  const individualIssued = await finalize(
    c,
    individual.id,
    { expectedRevision: individual.revision },
    randomUUID(),
  );
  await persistByteFixtures(individualIssued.issuanceId, individual.id);
  await signStage(individualIssued.issuanceId, individual.id);
  const individualRows = await collectRegistryRows(c, {}, individual.id);
  const credentialRow = individualRows.rows.find(
    (row) => row.assignment?.templateId === "pb-card",
  )!;
  const individualProtocol = await db.issuedDocument.findFirstOrThrow({
    where: {
      issuanceId: individualIssued.issuanceId,
      templateId: "pb-protocol",
    },
  });
  const credential = await db.issuedDocument.findUniqueOrThrow({
    where: { id: credentialRow.documentId! },
  });
  assert.notEqual(credential.assignmentId, individualProtocol.assignmentId);
  assert.equal(credentialRow.protocolDocumentId, individualProtocol.id);
  assert.equal(credentialRow.protocolNumber, individualProtocol.number);
  assert.equal(
    verifiedCms,
    await db.documentSignature.count({ where: { tenantId: c.tenantId } }),
  );
  assert.equal((await requestDetail(c, created.id)).issuances.length, 3);
});

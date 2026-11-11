import { randomUUID } from "node:crypto";
import { db, hash, json, type Context } from "../../apps/api/src/core";
import { store } from "../../apps/api/src/files";
// Deliberately structural, not cryptographic: these tests cover orchestration.
// Production CMS trust/content validation is exercised by the existing verifier tests.
export function mockCms() {
  const cms = Buffer.concat([
    Buffer.from("30818006092a864886f70d010702a0", "hex"),
    Buffer.alloc(116),
  ]);
  cms.write(randomUUID(), 40);
  return cms.toString("base64");
}

export async function signingFixture(
  options: {
    foreignTeacher?: boolean;
    demoOnly?: boolean;
    demoMode?: boolean;
    docxBytes?: Buffer;
    templateId?: string;
  } = {},
) {
  const tenant = await db.tenant.create({
    data: {
      name: "SYNTHETIC batch signing regression",
      demoOnly: options.demoOnly ?? true,
    },
  });
  const user = await db.user.create({
    data: {
      tenantId: tenant.id,
      email: `batch-director-${randomUUID()}@example.test`,
      displayName: "Synthetic Director",
      passwordHash: "unused-synthetic-no-login",
      role: "DIRECTOR",
    },
  });
  const other = await db.user.create({
    data: {
      tenantId: tenant.id,
      email: `batch-other-${randomUUID()}@example.test`,
      displayName: "Synthetic Other Signer",
      passwordHash: "unused-synthetic-no-login",
      role: "OPERATOR",
    },
  });
  const c: Context = {
    tenantId: tenant.id,
    userId: user.id,
    role: user.role,
    sessionId: "synthetic-batch-test",
    csrfHash: "synthetic-batch-test",
    correlationId: randomUUID(),
  };
  const profile = await db.issuerProfileVersion.create({
    data: { tenantId: tenant.id, version: 1, profile: {}, createdBy: user.id },
  });
  const template = await db.templateVersion.create({
    data: {
      tenantId: tenant.id,
      templateId: options.templateId || "pb-card",
      version: "synthetic-batch-test",
      checksum: hash("synthetic-template"),
      storageKey: `synthetic/${randomUUID()}`,
      contract: {},
      approved: true,
    },
  });
  const bindings = [];
  for (const kind of ["DIRECTOR", "CHAIR", "TEACHER"] as const) {
    const owner = options.foreignTeacher && kind === "TEACHER" ? other : user;
    bindings.push(
      await db.signatoryBinding.create({
        data: {
          tenantId: tenant.id,
          userId: owner.id,
          iin: owner.id === user.id ? "000000000001" : "000000000002",
          displayName: owner.displayName,
          kind,
          createdBy: user.id,
        },
      }),
    );
  }
  const signers = bindings.map((binding) => ({
    kind: binding.kind,
    bindingId: binding.id,
    userId: binding.userId,
    iin: binding.iin,
    bin: null,
    displayName: binding.displayName,
  }));
  const request = await db.printRequest.create({
    data: {
      tenantId: tenant.id,
      kind: "PERSON",
      title: "SYNTHETIC batch fixture, not a real document",
      status: "FINALIZED",
      demoMode: options.demoMode ?? true,
      draft: {},
      createdBy: user.id,
    },
  });
  const proposal = await db.requestProposal.create({
    data: {
      tenantId: tenant.id,
      requestId: request.id,
      revision: 1,
      baseRevision: 0,
      payload: {},
      before: {},
      diff: {},
      proposalHash: hash("synthetic-proposal"),
      status: "APPROVED",
      submittedBy: user.id,
    },
  });
  async function issuance(documentCount = 2) {
    const inputHash = hash(randomUUID());
    const value = await db.issuance.create({
      data: {
        tenantId: tenant.id,
        requestId: request.id,
        sourceRevision: 1,
        snapshot: {},
        inputHash,
        profileVersionId: profile.id,
        createdBy: user.id,
      },
    });
    await db.issuanceWorkflow.create({
      data: {
        tenantId: tenant.id,
        requestId: request.id,
        issuanceId: value.id,
        proposalId: proposal.id,
        status: "AWAITING_SIGNATURE",
        requiredSigners: json({
          version: 3,
          head: signers[0],
          signers: [signers[0]],
          commission: [signers[1]],
          teacher: signers[2],
        }),
      },
    });
    const artifacts = [];
    for (let index = 0; index < documentCount; index++) {
      const document = await db.issuedDocument.create({
        data: {
          tenantId: tenant.id,
          issuanceId: value.id,
          requestId: request.id,
          rowId: randomUUID(),
          assignmentId: randomUUID(),
          templateVersionId: template.id,
          templateId: template.templateId,
          namespace: "synthetic-batch-test",
          number: randomUUID(),
          documentDate: "2026-11-10",
        },
      });
      const snapshot = await db.renderInputSnapshot.create({
        data: {
          tenantId: tenant.id,
          requestId: request.id,
          issuanceId: value.id,
          revision: 1,
          profileVersionId: profile.id,
          templateVersionId: template.id,
          input: {},
          inputHash,
        },
      });
      const job = await db.generationJob.create({
        data: {
          tenantId: tenant.id,
          requestId: request.id,
          issuanceId: value.id,
          documentId: document.id,
          snapshotId: snapshot.id,
          kind: "PDF",
          status: "SUCCEEDED",
          logicalKey: randomUUID(),
        },
      });
      // Byte preservation matters here; no renderer or PDF parser is involved.
      const bytes = Buffer.from(`%PDF-1.7\nSYNTHETIC ${document.id}\n%%EOF`);
      const stored = await store.put(bytes, "pdf");
      const artifact = await db.artifact.create({
        data: {
          ...stored,
          tenantId: tenant.id,
          requestId: request.id,
          issuanceId: value.id,
          documentId: document.id,
          jobId: job.id,
          format: "PDF",
          mimeType: "application/pdf",
          fileName: `synthetic-${index}.pdf`,
          rendererVersion: "synthetic-batch-test",
          inputHash,
        },
      });
      await db.generationJob.update({
        where: { id: job.id },
        data: { artifactId: artifact.id },
      });
      let docx: typeof artifact | undefined;
      if (options.docxBytes) {
        const docxJob = await db.generationJob.create({
          data: {
            tenantId: tenant.id,
            requestId: request.id,
            issuanceId: value.id,
            documentId: document.id,
            snapshotId: snapshot.id,
            kind: "DOCX",
            status: "SUCCEEDED",
            logicalKey: randomUUID(),
          },
        });
        docx = await db.artifact.create({
          data: {
            ...(await store.put(options.docxBytes, "docx")),
            tenantId: tenant.id,
            requestId: request.id,
            issuanceId: value.id,
            documentId: document.id,
            jobId: docxJob.id,
            format: "DOCX",
            mimeType:
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            fileName: `synthetic-${index}.docx`,
            rendererVersion: "synthetic-batch-test",
            inputHash,
          },
        });
        await db.generationJob.update({
          where: { id: docxJob.id },
          data: { artifactId: docx.id },
        });
      }
      artifacts.push({ ...artifact, bytes, docx });
    }
    return { ...value, artifacts };
  }
  return { c, other, request, bindings, issuance };
}

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { assertTestDatabase } from "./test-database";
import { db, hash, json, type Context } from "../../apps/api/src/core";
import { provision } from "../../scripts/setup";
import {
  draftSchema,
  profileSchema,
  type Draft,
} from "../../packages/contracts/src";
import {
  preview,
  listRequests,
  patchRequest,
} from "../../apps/api/src/requests";
import { retryJob } from "../../apps/api/src/files";
import { ArtifactStore, MIME } from "../../packages/printing/src";

function fixture(): Draft {
  const eventId = randomUUID();
  return draftSchema.parse({
    kind: "PERSON",
    schemaVersion: 2,
    title: "Новая заявка на человека",
    commonFields: { documentDate: "2026-10-05", protocolDate: "2026-10-04" },
    events: [
      {
        id: eventId,
        title: "Синтетическое ПТМ",
        protocolTemplateId: "ptm-protocol",
        protocolMode: "GROUP",
        commonFields: {},
      },
    ],
    items: Array.from({ length: 3 }, (_, index) => ({
      id: `row-${index}`,
      fullNameRu: `Синтетический Участник ${index}`,
      positionRu: "Рабочий",
      assignments: [
        {
          id: "ptm",
          templateId: "ptm-card",
          eventId,
          protocolMode: "GROUP",
          result: "Сдал",
          outcome: { status: "PASSED", source: "Синтетическая ведомость" },
        },
      ],
    })),
  });
}
const code = (expected: string) => (error: unknown) => {
  const response = (
    error as { getResponse(): { code: string; details?: unknown } }
  ).getResponse();
  assert.equal(response.code, expected, JSON.stringify(response));
  return true;
};

test("target preview isolates document fields, retains proposal/group source, reuses jobs and never issues numbers", async () => {
  assertTestDatabase();
  const who = await provision({
    email: `target-preview-${randomUUID()}@example.test`,
    password: "Synthetic-Preview-Only-2026!",
    name: "Синтетическая проверка предпросмотра",
    sample: true,
  });
  const c: Context = {
    ...who,
    role: "DIRECTOR",
    sessionId: "test",
    csrfHash: "test",
    correlationId: randomUUID(),
  };
  const originalProfile = await db.issuerProfileVersion.findFirstOrThrow({
    where: { tenantId: c.tenantId },
  });
  const approvedProfile = await db.issuerProfileVersion.create({
    data: {
      tenantId: c.tenantId,
      version: 2,
      createdBy: c.userId,
      profile: json(
        profileSchema.parse({
          ...(originalProfile.profile as object),
          headName: "Синтетический Директор",
          commission: Array.from({ length: 3 }, (_, index) => ({
            name: `Синтетический Член ${index}`,
            position: "Член комиссии",
          })),
        }),
      ),
    },
  });
  const evidence: Record<string, unknown> = {
    database: new URL(process.env.DATABASE_URL!).pathname.slice(1),
    productionTouched: false,
    checks: [],
  };
  const checks = evidence.checks as string[];
  const make = async (draft: Draft) =>
    db.printRequest.create({
      data: {
        tenantId: c.tenantId,
        createdBy: c.userId,
        kind: draft.kind,
        title: draft.title,
        draft: json(draft),
        revision: 1,
        workingRevision: 1,
        itemCount: draft.items.length,
      },
    });
  try {
    const invalid = fixture();
    invalid.items[0].assignments[0].documentDate = "2026-02-30";
    invalid.items[0].photoAssetId = "foreign-photo-reference";
    invalid.items[1].assignments.push(
      draftSchema.parse({
        kind: "PERSON",
        items: [
          {
            id: "x",
            assignments: [
              {
                id: "unrelated",
                templateId: "pb-card",
                documentDate: "2026-02-30",
              },
            ],
          },
        ],
      }).items[0].assignments[0],
    );
    const record = await make(invalid);
    const target = {
      kind: "ASSIGNMENT" as const,
      rowId: "row-1",
      assignmentId: "ptm",
    };
    const first = await preview(c, record.id, { expectedRevision: 1, target });
    assert.equal(first.jobs.length, 2);
    assert.deepEqual(first.target, target);
    const snapshot = await db.renderInputSnapshot.findUniqueOrThrow({
      where: { id: first.jobs[0].snapshotId },
    });
    assert.equal((snapshot.input as any).items.length, 1);
    assert.equal((snapshot.input as any).items[0].id, "row-1");
    assert.equal((snapshot.input as any).items[0].assignment.id, "ptm");
    await assert.rejects(
      preview(c, record.id, { expectedRevision: 0, target }),
      code("REVISION_CONFLICT"),
    );
    await assert.rejects(
      preview(c, record.id, {
        expectedRevision: 1,
        target: { ...target, assignmentId: "absent" },
      }),
      code("PREVIEW_TARGET_NOT_FOUND"),
    );
    await assert.rejects(
      preview({ ...c, tenantId: randomUUID() }, record.id, {
        expectedRevision: 1,
        target,
      }),
      code("NOT_FOUND"),
    );
    checks.push(
      "valid target ignores invalid unrelated person, reference and form; stale revision and foreign tenant/identity rejected",
    );
    const invalidTarget = { ...target, assignmentId: "unrelated" };
    await assert.rejects(
      preview(c, record.id, { expectedRevision: 1, target: invalidTarget }),
      (error: any) => {
        const response = error.getResponse();
        assert.equal(response.code, "PREVIEW_VALIDATION");
        const dateIssue = response.details.find(
          (issue: any) => issue.code === "DATE_INVALID",
        );
        assert.equal(dateIssue.rowId, "row-1");
        assert.equal(dateIssue.assignmentId, "unrelated");
        assert.equal(dateIssue.path, "items.1.assignments.1.documentDate");
        return true;
      },
    );
    const again = await preview(c, record.id, { expectedRevision: 1, target });
    assert.deepEqual(
      again.jobs.map((job) => job.id).sort(),
      first.jobs.map((job) => job.id).sort(),
    );
    const pdf = first.jobs.find((job) => job.kind === "PDF")!;
    await db.generationJob.update({
      where: { id: pdf.id },
      data: { status: "FAILED", errorCode: "SYNTHETIC_FAILURE" },
    });
    await retryJob(c, pdf.id);
    assert.equal(
      (await db.generationJob.findUniqueOrThrow({ where: { id: pdf.id } }))
        .status,
      "PENDING",
    );
    await db.generationJob.delete({ where: { id: pdf.id } });
    const repaired = await preview(c, record.id, {
      expectedRevision: 1,
      target,
    });
    assert.equal(repaired.jobs.length, 2);
    assert.equal(
      repaired.jobs.find((job) => job.kind === "DOCX")!.id,
      first.jobs.find((job) => job.kind === "DOCX")!.id,
    );
    assert.notEqual(
      repaired.jobs.find((job) => job.kind === "PDF")!.id,
      pdf.id,
    );
    assert.equal(
      repaired.jobs[0].snapshotId,
      repaired.jobs[1].snapshotId,
      "recreated PDF must retain the surviving DOCX snapshot dependency",
    );
    const store = new ArtifactStore();
    const repairedPdf = repaired.jobs.find((job) => job.kind === "PDF")!;
    const syntheticBytes = Buffer.from(
      "%PDF-1.7\nSYNTHETIC_STORAGE_FIXTURE\n%%EOF",
    );
    const publishSynthetic = async () => {
      const blob = await store.put(syntheticBytes, "pdf");
      const artifact = await db.artifact.create({
        data: {
          ...blob,
          tenantId: c.tenantId,
          requestId: record.id,
          jobId: repairedPdf.id,
          format: "PDF",
          mimeType: MIME.PDF,
          fileName: "synthetic-preview-storage.pdf",
          rendererVersion: "synthetic-storage-fixture",
          inputHash: snapshot.inputHash,
          provenance: "PREVIEW",
        },
      });
      await db.generationJob.update({
        where: { id: repairedPdf.id },
        data: { status: "SUCCEEDED", artifactId: artifact.id, progress: 100 },
      });
      return artifact;
    };
    const missingArtifact = await publishSynthetic();
    await unlink(store.path(missingArtifact.storageKey));
    const missingRecovered = await preview(c, record.id, {
      expectedRevision: 1,
      target,
    });
    assert.equal(
      missingRecovered.jobs.find((job) => job.id === repairedPdf.id)?.status,
      "PENDING",
    );
    assert.equal(
      missingRecovered.jobs.find((job) => job.id === repairedPdf.id)
        ?.artifactId,
      null,
    );
    assert.deepEqual(
      await db.artifact.findUniqueOrThrow({
        where: { id: missingArtifact.id },
      }),
      missingArtifact,
    );
    const corruptArtifact = await publishSynthetic();
    await writeFile(
      store.path(corruptArtifact.storageKey),
      Buffer.alloc(syntheticBytes.length, 88),
    );
    const corruptRecovered = await preview(c, record.id, {
      expectedRevision: 1,
      target,
    });
    assert.equal(
      corruptRecovered.jobs.find((job) => job.id === repairedPdf.id)?.status,
      "PENDING",
    );
    assert.deepEqual(
      await db.artifact.findUniqueOrThrow({
        where: { id: corruptArtifact.id },
      }),
      corruptArtifact,
    );
    const intactArtifact = await publishSynthetic();
    const intactPreview = await preview(c, record.id, {
      expectedRevision: 1,
      target,
    });
    assert.equal(
      intactPreview.jobs.find((job) => job.id === repairedPdf.id)?.status,
      "SUCCEEDED",
    );
    assert.equal(
      intactPreview.jobs.find((job) => job.id === repairedPdf.id)?.artifactId,
      intactArtifact.id,
    );
    checks.push(
      "missing file and same-size SHA256 corruption requeue preview only, preserve immutable artifact rows; intact file reused; repaired pair retains DOCX dependency snapshot",
    );
    checks.push(
      "stable identity/date issue paths, idempotent target, existing FAILED retry and missing paired job repair",
    );

    const submitted = fixture();
    const proposalRecord = await make(submitted);
    const allowed = submitted.items.map((row) => ({
      rowId: row.id,
      assignmentId: "ptm",
    }));
    const proposal = await db.requestProposal.create({
      data: {
        tenantId: c.tenantId,
        requestId: proposalRecord.id,
        submittedBy: c.userId,
        operation: "SAVE",
        status: "PENDING",
        revision: 1,
        baseRevision: 0,
        payload: json(submitted),
        before: json(submitted),
        diff: json([]),
        assignments: json(allowed),
        proposalHash: hash(submitted),
        scopeHash: hash(allowed),
      },
    });
    const live = structuredClone(submitted);
    live.items[0].fullNameRu = "Позднее Изменённое Имя";
    live.items[2].assignments.push(
      draftSchema.parse({
        kind: "PERSON",
        items: [
          {
            id: "x",
            assignments: [{ id: "draft-only", templateId: "pb-card" }],
          },
        ],
      }).items[0].assignments[0],
    );
    await patchRequest(c, proposalRecord.id, {
      expectedRevision: 1,
      draft: live,
    });
    const before = hash(
      await db.printRequest.findUniqueOrThrow({
        where: { id: proposalRecord.id },
      }),
    );
    const countersBefore = hash(
      await db.numberSequence.findMany({ where: { tenantId: c.tenantId } }),
    );
    const basis = {
      expectedRevision: 1,
      proposalId: proposal.id,
      expectedProposalHash: proposal.proposalHash,
    };
    const samples = await preview(c, proposalRecord.id, basis);
    assert.equal(samples.jobs.length, 4);
    const sampleTarget = await preview(c, proposalRecord.id, {
      ...basis,
      target: { ...target, rowId: "row-0" },
    });
    assert.ok(
      sampleTarget.jobs.every((job) =>
        samples.jobs.some((sample) => sample.id === job.id),
      ),
    );
    const outsideSample = await preview(c, proposalRecord.id, {
      ...basis,
      target: { ...target, rowId: "row-2" },
    });
    assert.equal(outsideSample.jobs.length, 2);
    const frozen = await db.renderInputSnapshot.findUniqueOrThrow({
      where: { id: sampleTarget.jobs[0].snapshotId },
    });
    assert.equal(
      (frozen.input as any).items[0].fullNameRu,
      submitted.items[0].fullNameRu,
    );
    assert.equal(frozen.revision, 1);
    const group = await preview(c, proposalRecord.id, {
      ...basis,
      target: { kind: "GROUP_PROTOCOL", eventId: submitted.events![0].id },
    });
    assert.ok(
      group.jobs.every((job) =>
        samples.jobs.some((sample) => sample.id === job.id),
      ),
    );
    const groupInput = await db.renderInputSnapshot.findUniqueOrThrow({
      where: { id: group.jobs[0].snapshotId },
    });
    assert.equal((groupInput.input as any).items.length, 3);
    await assert.rejects(
      preview(c, proposalRecord.id, { ...basis, expectedRevision: 2, target }),
      code("APPROVAL_STALE"),
    );
    await assert.rejects(
      preview(c, proposalRecord.id, {
        ...basis,
        expectedProposalHash: "f".repeat(64),
        target,
      }),
      code("APPROVAL_STALE"),
    );
    await assert.rejects(
      preview(c, proposalRecord.id, {
        ...basis,
        target: { ...target, rowId: "row-2", assignmentId: "draft-only" },
      }),
      code("PREVIEW_TARGET_NOT_FOUND"),
    );
    await assert.rejects(
      preview(c, record.id, { ...basis, target }),
      code("APPROVAL_STALE"),
    );
    assert.equal(
      hash(
        await db.printRequest.findUniqueOrThrow({
          where: { id: proposalRecord.id },
        }),
      ),
      before,
    );
    assert.equal(
      hash(
        await db.numberSequence.findMany({ where: { tenantId: c.tenantId } }),
      ),
      countersBefore,
    );
    assert.equal(
      await db.issuance.count({ where: { tenantId: c.tenantId } }),
      0,
    );
    assert.equal(
      await db.issuedDocument.count({ where: { tenantId: c.tenantId } }),
      0,
    );
    checks.push(
      "immutable proposal after live edit; sample/target/group job reuse; non-sample recipient accessible; full group; proposal allowlist/hash/revision; no issuance/numbers/draft mutation",
    );
    const listed = await listRequests(c, {});
    assert.equal(
      listed.items.find((row) => row.id === record.id)?.title,
      invalid.items[0].fullNameRu,
    );
    const historic = await make({
      ...fixture(),
      title: "Историческое ручное название",
    });
    assert.equal(
      (await listRequests(c, {})).items.find((row) => row.id === historic.id)
        ?.title,
      historic.title,
    );
    assert.equal(
      (await db.printRequest.findUniqueOrThrow({ where: { id: record.id } }))
        .title,
      invalid.title,
    );
    checks.push(
      "generic PERSON display title uses person while stored/historical titles remain unchanged",
    );
    const company = await db.customerOrganization.create({
      data: { tenantId: c.tenantId, nameRu: "Синтетическая Компания" },
    });
    const companyRequest = await make({
      ...fixture(),
      kind: "COMPANY",
      title: "Новая заявка организации",
      customerId: company.id,
    });
    await db.printRequest.update({
      where: { id: companyRequest.id },
      data: { customerId: company.id },
    });
    assert.equal(
      (await listRequests(c, {})).items.find(
        (row) => row.id === companyRequest.id,
      )?.title,
      company.nameRu,
    );
    assert.equal(
      (
        await db.printRequest.findUniqueOrThrow({
          where: { id: companyRequest.id },
        })
      ).title,
      "Новая заявка организации",
    );
    checks.push(
      "generic COMPANY display title uses company without rewriting stored title",
    );
    const issuerCases = [
      {
        profile: { approved: false },
        code: "ISSUER_NOT_APPROVED",
        path: "profile",
      },
      {
        profile: { approved: true, nameRu: "X".repeat(81) },
        code: "PRINT_UNBROKEN_VALUE",
        path: "profile.nameRu",
      },
    ];
    for (const [index, issuerCase] of issuerCases.entries()) {
      const pinnedProfile = await db.issuerProfileVersion.create({
        data: {
          tenantId: c.tenantId,
          version: index + 3,
          createdBy: c.userId,
          profile: json(
            profileSchema.parse({
              ...(approvedProfile.profile as object),
              ...issuerCase.profile,
            }),
          ),
        },
      });
      const pinnedDraft = fixture();
      pinnedDraft.profileVersionId = approvedProfile.id;
      pinnedDraft.events![0].profileVersionId = pinnedProfile.id;
      const pinnedRequest = await make(pinnedDraft);
      const beforePinned = hash(pinnedRequest);
      const beforeNumbers = hash(
        await db.numberSequence.findMany({ where: { tenantId: c.tenantId } }),
      );
      await assert.rejects(
        preview(c, pinnedRequest.id, { expectedRevision: 1, target }),
        (error: any) => {
          const response = error.getResponse();
          assert.equal(response.code, "PREVIEW_VALIDATION");
          assert.ok(
            response.details.some(
              (issue: any) =>
                issue.code === issuerCase.code &&
                issue.path ===
                  `events.${pinnedDraft.events![0].id}.${issuerCase.path}`,
            ),
            JSON.stringify(response.details),
          );
          assert.ok(
            response.details.every(
              (issue: any) => issue.code !== "NO_RECIPIENTS",
            ),
          );
          return true;
        },
      );
      assert.equal(
        await db.generationJob.count({ where: { requestId: pinnedRequest.id } }),
        0,
      );
      assert.equal(
        await db.renderInputSnapshot.count({
          where: { requestId: pinnedRequest.id },
        }),
        0,
      );
      assert.equal(
        hash(
          await db.printRequest.findUniqueOrThrow({
            where: { id: pinnedRequest.id },
          }),
        ),
        beforePinned,
      );
      assert.equal(
        hash(
          await db.numberSequence.findMany({ where: { tenantId: c.tenantId } }),
        ),
        beforeNumbers,
      );

      // An invalid issuer of another course is outside this document's scope.
      const otherCourseDraft = fixture();
      otherCourseDraft.profileVersionId = approvedProfile.id;
      otherCourseDraft.events!.push(pinnedDraft.events![0]);
      otherCourseDraft.items[2].assignments[0].eventId =
        pinnedDraft.events![0].id;
      const otherCourse = await make(otherCourseDraft);
      const isolated = await preview(c, otherCourse.id, {
        expectedRevision: 1,
        target,
      });
      assert.equal(isolated.jobs.length, 2);
      const isolatedInput = await db.renderInputSnapshot.findUniqueOrThrow({
        where: { id: isolated.jobs[0].snapshotId },
      });
      assert.equal(isolatedInput.profileVersionId, approvedProfile.id);
      checks.push(
        `selected pinned issuer ${issuerCase.code} blocks without jobs/snapshots/numbers/draft writes; unrelated course issuer remains outside target scope`,
      );
    }
    assert.equal(
      await db.issuance.count({ where: { tenantId: c.tenantId } }),
      0,
    );
    assert.equal(
      await db.issuedDocument.count({ where: { tenantId: c.tenantId } }),
      0,
    );
    evidence.status = "PASS";
  } finally {
    const directory = resolve(
      "docs/evidence/operator-details-ux-20261005/preview",
    );
    await mkdir(directory, { recursive: true });
    await writeFile(
      resolve(directory, "integration.json"),
      JSON.stringify(evidence, null, 2),
    );
    await db.$disconnect();
  }
});

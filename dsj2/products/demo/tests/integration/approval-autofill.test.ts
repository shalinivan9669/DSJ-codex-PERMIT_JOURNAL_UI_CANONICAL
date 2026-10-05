import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { provision } from "../../scripts/setup";
import { db, hash, json, type Context } from "../../apps/api/src/core";
import {
  createRequest,
  patchRequest,
  requestDetail,
  finalize,
  preview,
} from "../../apps/api/src/requests";
import {
  approvalDetail,
  submitApproval,
  decideProposal,
  listApprovals,
  prepareLegacyProposal,
  workingRequest,
  submittedProposalDraft,
} from "../../apps/api/src/approvals";
import {
  draftSchema,
  resolveDraft,
  trainingEventSchema,
  protocolTemplateFor,
  approvalScopeValue,
  selectAssignmentScope,
  hasEnglishDraftValues,
  type Draft,
} from "../../packages/contracts/src";
import { assertTestDatabase } from "./test-database";

const code = (expected: string) => (error: unknown) => {
  assert.equal(
    (error as { getResponse(): { code: string } }).getResponse().code,
    expected,
  );
  return true;
};
const fixture = (): Draft =>
  draftSchema.parse({
    kind: "PERSON",
    schemaVersion: 2,
    demoMode: true,
    commonFields: { documentDate: "2026-10-05" },
    items: [
      {
        id: randomUUID(),
        fullNameRu: "Синтетический Получатель",
        positionRu: "Слесарь",
        assignments: [
          {
            id: randomUUID(),
            templateId: "ptm-card",
            outcome: { status: "PASSED", source: "AUTO" },
          },
        ],
      },
    ],
  });

test("explicit approval freezes effective values; historical pending has one safe preparation path", async (t) => {
  assertTestDatabase();
  const seed = await provision({
    email: `autofill-approval-${randomUUID()}@example.test`,
    password: "Synthetic-autofill-pass!",
    name: "СИНТЕТИЧЕСКИЙ центр автозаполнения",
    sample: true,
  });
  const context: Context = {
    tenantId: seed.tenantId,
    userId: seed.userId,
    role: "ADMIN",
    sessionId: "synthetic",
    csrfHash: "synthetic",
    correlationId: randomUUID(),
  };
  const director = await db.user.create({
    data: {
      tenantId: context.tenantId,
      email: `synthetic-director-${randomUUID()}@example.test`,
      displayName: "Синтетический директор",
      passwordHash: "unusable-synthetic",
      role: "DIRECTOR",
    },
  });
  const directorContext = { ...context, userId: director.id, role: "DIRECTOR" };
  const initialProfile = await db.issuerProfileVersion.findFirstOrThrow({
    where: { tenantId: context.tenantId },
    orderBy: { version: "desc" },
  });
  await db.issuerProfileVersion.create({
    data: {
      tenantId: context.tenantId,
      version: initialProfile.version + 1,
      createdBy: context.userId,
      profile: json({
        ...(initialProfile.profile as object),
        headName: "Синтетический директор",
        commission: [0, 1, 2].map((number) => ({
          name: `Синтетический член ${number}`,
          position: number ? "Член комиссии" : "Председатель",
        })),
      }),
    },
  });
  try {
    await t.test(
      "scoped pending without resolved values stays recoverable outside the director decision queue",
      async () => {
        const saved = await createRequest(context, fixture());
        const raw = draftSchema.parse(saved.draft);
        const assignments = selectAssignmentScope(raw).assignments;
        const staging = await db.requestProposal.findFirstOrThrow({
          where: { requestId: saved.id, status: "DRAFT" },
        });
        const pending = await db.requestProposal.update({
          where: { id: staging.id },
          data: {
            status: "PENDING",
            assignments: json(assignments),
            scopeHash: hash(approvalScopeValue(raw, assignments)),
          },
        });
        assert.equal(
          (await approvalDetail(context, pending.id)).needsPreparation,
          true,
        );
        assert.equal(
          (await listApprovals(context, { status: "PENDING" })).items.some(
            (entry) => entry.id === pending.id,
          ),
          false,
        );
        assert.equal(
          (
            await listApprovals(context, { status: "NEEDS_PREPARATION" })
          ).items.some((entry) => entry.id === pending.id),
          true,
        );
        await prepareLegacyProposal(context, pending.id, {
          expectedRevision: saved.revision,
          expectedProposalHash: pending.proposalHash,
        });
        const working = await workingRequest(context, saved.id);
        const next = await submitApproval(context, saved.id, {
          expectedRevision: working.revision,
        });
        assert.equal(
          (await approvalDetail(context, next.approval.proposalId))
            .needsPreparation,
          false,
        );
        assert.equal(
          hash(
            (
              await db.requestProposal.findUniqueOrThrow({
                where: { id: pending.id },
              })
            ).payload,
          ),
          hash(pending.payload),
        );
      },
    );
    await t.test(
      "new API drafts discard English; historical approved English cannot generate new files before a RU/KZ revision",
      async () => {
        const english = fixture();
        english.englishAppendix = true;
        english.items[0].fullNameEn = "Synthetic English Recipient";
        english.items[0].assignments[0].trainingSubjectEn =
          "Synthetic English programme";
        const created = await createRequest(context, english);
        assert.equal(
          hasEnglishDraftValues(draftSchema.parse(created.draft)),
          false,
        );
        const historical = draftSchema.parse(created.draft);
        delete historical.languagePolicy;
        historical.englishAppendix = true;
        historical.items[0].fullNameEn = "Historical immutable English";
        const record = await db.printRequest.create({
          data: {
            tenantId: context.tenantId,
            createdBy: context.userId,
            kind: "PERSON",
            draft: json(historical),
            revision: 1,
            workingRevision: 1,
          },
        });
        const selection = selectAssignmentScope(historical).assignments;
        const proposal = await db.requestProposal.create({
          data: {
            tenantId: context.tenantId,
            requestId: record.id,
            submittedBy: context.userId,
            operation: "SAVE",
            status: "APPROVED",
            revision: 1,
            baseRevision: 0,
            payload: json(historical),
            before: json(draftSchema.parse({ kind: "PERSON", items: [] })),
            diff: json([]),
            assignments: json(selection),
            scopeHash: hash(approvalScopeValue(historical, selection)),
            proposalHash: hash({ historicalEnglish: record.id }),
          },
        });
        await db.proposalDecision.create({
          data: {
            tenantId: context.tenantId,
            proposalId: proposal.id,
            decidedBy: director.id,
            decision: "APPROVE",
            comment: "Синтетическая историческая редакция",
            proposalHash: proposal.proposalHash,
          },
        });
        await db.printRequest.update({
          where: { id: record.id },
          data: { approvedProposalId: proposal.id },
        });
        assert.equal(
          (await approvalDetail(context, proposal.id)).draft?.englishAppendix,
          true,
        );
        await assert.rejects(
          finalize(context, record.id, { expectedRevision: 1 }, randomUUID()),
          code("DIRECTOR_APPROVAL_REQUIRED"),
        );
        await assert.rejects(
          preview(context, record.id, {
            expectedRevision: 1,
            proposalId: proposal.id,
            expectedProposalHash: proposal.proposalHash,
          }),
          code("PREVIEW_VALIDATION"),
        );
        assert.equal(
          await db.issuance.count({ where: { requestId: record.id } }),
          0,
        );
        assert.equal(
          await db.generationJob.count({ where: { requestId: record.id } }),
          0,
        );
        const next = await patchRequest(context, record.id, {
          expectedRevision: 1,
          draft: historical,
        });
        assert.equal(hasEnglishDraftValues(next.draft), false);
        await submitApproval(context, record.id, {
          expectedRevision: next.revision,
        });
        assert.equal(
          hash(
            (
              await db.requestProposal.findUniqueOrThrow({
                where: { id: proposal.id },
              })
            ).payload,
          ),
          hash(proposal.payload),
        );
      },
    );
    await t.test(
      "frozen effective values survive later organization/profile changes and reach render inputs",
      async () => {
        const company = await db.customerOrganization.create({
          data: {
            tenantId: context.tenantId,
            nameRu: "СИНТЕТИЧЕСКАЯ компания до передачи",
            nameKz: "СИНТЕТИКАЛЫҚ компания",
            bin: "111111111111",
            addressRu: "Синтетический адрес",
          },
        });
        const input = fixture();
        input.kind = "COMPANY";
        input.customerId = company.id;
        const saved = await createRequest(context, input);
        const submitted = await submitApproval(context, saved.id, {
          expectedRevision: saved.revision,
        });
        const proposal = await db.requestProposal.findUniqueOrThrow({
          where: { id: submitted.approval.proposalId },
        });
        const payload = submittedProposalDraft(proposal);
        assert.ok(payload.frozenResolution);
        assert.equal(payload.items[0].fullNameKz, "");
        assert.equal(
          payload.frozenResolution.draft.items[0].fullNameKz,
          payload.items[0].fullNameRu,
        );
        assert.ok(
          payload.frozenResolution.draft.items[0].assignments[0]
            .trainingSubject,
        );
        assert.equal(
          payload.frozenResolution.draft.items[0].workplaceRu,
          company.nameRu,
        );
        assert.deepEqual(
          resolveDraft(payload, {
            trainingSubject: "Новый справочник",
            documentDate: "2027-01-01",
          }).draft,
          payload.frozenResolution.draft,
        );
        const before = await approvalDetail(context, proposal.id);
        await assert.rejects(
          db.requestProposal.update({
            where: { id: proposal.id },
            data: { resolvedSnapshot: json({ tampered: true }) },
          }),
          /DEMO_PROPOSAL_IMMUTABLE/,
        );
        await db.customerOrganization.update({
          where: { id: company.id },
          data: {
            nameRu: "СИНТЕТИЧЕСКАЯ компания после передачи",
            addressRu: "Новый адрес",
          },
        });
        const profile = await db.issuerProfileVersion.findFirstOrThrow({
          where: { tenantId: context.tenantId },
          orderBy: { version: "desc" },
        });
        await db.issuerProfileVersion.create({
          data: {
            tenantId: context.tenantId,
            version: profile.version + 1,
            createdBy: context.userId,
            profile: json({
              ...(profile.profile as object),
              commonFields: {
                documentDate: "2027-01-01",
                trainingSubject: "Новая программа центра",
              },
            }),
          },
        });
        const after = await approvalDetail(context, proposal.id);
        assert.deepEqual(after.review, before.review);
        assert.equal(
          hash(
            (
              await db.requestProposal.findUniqueOrThrow({
                where: { id: proposal.id },
              })
            ).payload,
          ),
          hash(proposal.payload),
        );
        await decideProposal(directorContext, proposal.id, {
          decision: "APPROVE",
          reason: "Синтетическая проверка",
          expectedProposalHash: proposal.proposalHash,
        });
        const issued = (await finalize(
          context,
          saved.id,
          { expectedRevision: saved.revision },
          randomUUID(),
        )) as { issuanceId: string };
        const snapshots = await db.renderInputSnapshot.findMany({
          where: {
            tenantId: context.tenantId,
            issuanceId: issued.issuanceId,
            templateVersionId: { not: null },
          },
        });
        assert.ok(snapshots.length >= 2);
        for (const snapshot of snapshots) {
          const items =
            (snapshot.input as { items?: Array<Record<string, unknown>> })
              .items || [];
          for (const item of items) {
            assert.equal(item.workplaceRu, company.nameRu);
            assert.equal(item.employerAddressRu, company.addressRu);
          }
        }
        assert.ok(
          snapshots.some((snapshot) =>
            JSON.stringify(snapshot.input).includes(
              payload.frozenResolution!.draft.items[0].assignments[0]
                .trainingSubject,
            ),
          ),
        );
      },
    );
    await t.test(
      "old 9-document, 4-course pending is classified by read-only GET; explicit prepare preserves payload and outcomes",
      async () => {
        const raw = fixture();
        raw.items[0].fullNameRu = "";
        raw.items[0].positionRu = "";
        const forms = [
          "biot-worker-card",
          "biot-itr-certificate",
          "ptm-card",
          "pb-card",
          "ps-witness",
        ] as const;
        raw.items[0].assignments = forms.map((templateId, index) => ({
          ...raw.items[0].assignments[0],
          id: `legacy-${index}`,
          templateId,
          outcome: { status: "UNKNOWN", source: "" },
        }));
        const scaffold = await createRequest(context, raw);
        const legacyPayload = draftSchema.parse(scaffold.draft);
        assert.equal(legacyPayload.items[0].assignments.length, 9);
        const eventPrefix = randomUUID();
        const protocolIds = [
          ...new Set(
            legacyPayload.items[0].assignments.map((assignment) =>
              protocolTemplateFor(assignment.templateId),
            ),
          ),
        ];
        legacyPayload.events = protocolIds.map((protocolTemplateId) =>
          trainingEventSchema.parse({
            id: `${eventPrefix}-${protocolTemplateId}`,
            title: `Синтетическое ${protocolTemplateId}`,
            protocolTemplateId,
            protocolMode: "INDIVIDUAL",
            commonFields: { documentDate: "2026-10-05" },
          }),
        );
        for (const assignment of legacyPayload.items[0].assignments)
          assignment.eventId = `${eventPrefix}-${protocolTemplateFor(assignment.templateId)}`;
        assert.equal(legacyPayload.events?.length, 4);
        const empty = draftSchema.parse({
          kind: "PERSON",
          schemaVersion: 2,
          items: [],
        });
        const saved = await db.printRequest.create({
          data: {
            tenantId: context.tenantId,
            createdBy: context.userId,
            kind: "PERSON",
            revision: 0,
            workingRevision: 6,
            draft: json(empty),
          },
        });
        const legacy = await db.requestProposal.create({
          data: {
            tenantId: context.tenantId,
            requestId: saved.id,
            revision: 6,
            baseRevision: 0,
            operation: "SAVE",
            status: "PENDING",
            submittedBy: context.userId,
            payload: json(legacyPayload),
            before: json(empty),
            diff: json([]),
            proposalHash: hash({ syntheticLegacy: randomUUID() }),
          },
        });
        const originalHash = hash(legacy.payload);
        const read = await approvalDetail(context, legacy.id);
        assert.equal(read.needsPreparation, true);
        assert.equal(read.currentRevision, 6);
        assert.equal(
          (await listApprovals(context, { status: "PENDING" })).items.some(
            (row) => row.id === legacy.id,
          ),
          false,
        );
        assert.equal(
          (
            await listApprovals(context, { status: "NEEDS_PREPARATION" })
          ).items.some((row) => row.id === legacy.id),
          true,
        );
        assert.equal(
          hash(
            (
              await db.requestProposal.findUniqueOrThrow({
                where: { id: legacy.id },
              })
            ).payload,
          ),
          originalHash,
        );
        assert.equal(
          (await db.printRequest.findUniqueOrThrow({ where: { id: saved.id } }))
            .revision,
          0,
        );
        await assert.rejects(
          decideProposal(directorContext, legacy.id, {
            decision: "APPROVE",
            reason: "Нельзя согласовать старое автосохранение",
            expectedProposalHash: legacy.proposalHash,
          }),
          code("LEGACY_PREPARATION_REQUIRED"),
        );
        const attempts = await Promise.allSettled(
          [1, 2].map(() =>
            prepareLegacyProposal(context, legacy.id, {
              expectedRevision: 6,
              expectedProposalHash: legacy.proposalHash,
            }),
          ),
        );
        assert.equal(
          attempts.filter((result) => result.status === "fulfilled").length,
          1,
          attempts
            .map((result) =>
              result.status === "rejected" ? String(result.reason) : "ok",
            )
            .join(" | "),
        );
        assert.equal(
          attempts.filter((result) => result.status === "rejected").length,
          1,
        );
        const prepared = await workingRequest(context, saved.id);
        assert.equal(prepared.revision, 7);
        const work = draftSchema.parse(prepared.draft);
        assert.ok(
          work.items[0].assignments.every(
            (assignment) => assignment.outcome?.status === "UNKNOWN",
          ),
        );
        assert.equal(
          (
            await db.requestProposal.findUniqueOrThrow({
              where: { id: legacy.id },
            })
          ).status,
          "SUPERSEDED",
        );
        assert.equal(
          hash(
            (
              await db.requestProposal.findUniqueOrThrow({
                where: { id: legacy.id },
              })
            ).payload,
          ),
          originalHash,
        );
        await assert.rejects(
          submitApproval(context, saved.id, {
            expectedRevision: prepared.revision,
          }),
          code("APPROVAL_DATA_INCOMPLETE"),
        );
        work.items[0].fullNameRu = "Синтетический Подготовленный";
        work.items[0].positionRu = "Слесарь";
        work.items[0].workplaceRu = "Синтетическое предприятие";
        for (const assignment of work.items[0].assignments)
          assignment.outcome = {
            status: "PASSED",
            source: "Явное общее действие менеджера",
          };
        const corrected = await patchRequest(context, saved.id, {
          expectedRevision: prepared.revision,
          draft: work,
        });
        const transferred = await submitApproval(context, saved.id, {
          expectedRevision: corrected.revision,
        }).catch((error) => {
          throw new Error(JSON.stringify(error.getResponse()));
        });
        assert.equal(transferred.approval.status, "PENDING");
        const detail = await approvalDetail(
          context,
          transferred.approval.proposalId,
        );
        assert.equal(detail.needsPreparation, false);
        assert.deepEqual(detail.review?.issues, []);
        assert.equal(
          hash(
            (
              await db.requestProposal.findUniqueOrThrow({
                where: { id: legacy.id },
              })
            ).payload,
          ),
          originalHash,
        );
        const forged = draftSchema.parse(
          (await requestDetail(context, saved.id)).draft,
        );
        forged.frozenResolution = submittedProposalDraft(
          await db.requestProposal.findUniqueOrThrow({
            where: { id: transferred.approval.proposalId },
          }),
        ).frozenResolution;
        forged.items[0].fullNameRu = "";
        const incomplete = await patchRequest(context, saved.id, {
          expectedRevision: corrected.revision,
          draft: forged,
        });
        assert.equal(
          draftSchema.parse(incomplete.draft).frozenResolution,
          undefined,
        );
        await assert.rejects(
          submitApproval(context, saved.id, {
            expectedRevision: incomplete.revision,
          }),
          code("APPROVAL_DATA_INCOMPLETE"),
        );
      },
    );
  } finally {
    await db.$disconnect();
  }
});

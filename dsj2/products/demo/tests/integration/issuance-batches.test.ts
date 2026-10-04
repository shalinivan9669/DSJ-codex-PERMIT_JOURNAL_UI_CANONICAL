import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  draftSchema,
  type Draft,
  type AssignmentIdentity,
} from "../../packages/contracts/src";
import { db, hash, type Context } from "../../apps/api/src/core";
import {
  createRequest,
  patchRequest,
  requestDetail,
  finalize,
  validateRequest,
  correction,
} from "../../apps/api/src/requests";
import {
  submitApproval,
  decideProposal,
  listApprovals,
  approvalDetail,
} from "../../apps/api/src/approvals";
import { provision } from "../../scripts/setup";
import { createApprovalFixture } from "./live-approval-fixture";
import { assertTestDatabase } from "./test-database";
function rejectedCode(code: string) {
  return (e: unknown) => {
    assert.equal(
      (e as { getResponse(): { code: string } }).getResponse().code,
      code,
    );
    return true;
  };
}

test("arbitrary immutable batches in one request: explicit scope review, reload, waiting courses and concurrent retries", async (t) => {
  assertTestDatabase();
  const seeded = await provision({
    email: `batches-${randomUUID()}@example.test`,
    password: "Synthetic-Only-Test-Password!",
    name: "Синтетический центр поэтапной печати",
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
  async function approve(
    id: string,
    revision: number,
    assignments?: AssignmentIdentity[],
  ) {
    const submitted = await submitApproval(c, id, {
      expectedRevision: revision,
      assignments,
    });
    await decideProposal(
      approvals.directorContext,
      submitted.approval.proposalId,
      {
        decision: "APPROVE",
        reason: "Синтетический состав проверен",
        expectedProposalHash: submitted.approval.proposalHash,
      },
    );
    return submitted;
  }
  for (const partitions of [[1], [3], [2, 1, 2], [1, 1, 1, 1]])
    await t.test(
      `actual batches ${partitions.join("+")} with two courses`,
      async () => {
        const count = partitions.reduce((n, value) => n + value, 0),
          pb = randomUUID(),
          ptm = randomUUID();
        const draft = draftSchema.parse({
          kind: "PERSON",
          schemaVersion: 2,
          demoMode: true,
          events: [
            {
              id: pb,
              title: "Промышленная безопасность",
              protocolTemplateId: "pb-protocol",
              protocolMode: "GROUP",
              commonFields: {
                documentDate: "2026-10-04",
                protocolDate: "2026-10-04",
                trainingSubject: "Синтетическая программа ПБ",
                trainingStart: "2026-10-01",
                trainingEnd: "2026-10-03",
              },
            },
            {
              id: ptm,
              title: "ПТМ",
              protocolTemplateId: "ptm-protocol",
              protocolMode: "GROUP",
              commonFields: {
                documentDate: "2026-10-05",
                protocolDate: "2026-10-05",
                trainingSubject: "Синтетическая программа ПТМ",
                trainingStart: "2026-10-01",
                trainingEnd: "2026-10-03",
              },
            },
          ],
          items: Array.from({ length: count }, (_, i) => ({
            id: `row-${i}`,
            employeeCategory: "WORKER",
            fullNameRu: `Синтетический Получатель ${i}`,
            positionRu: "Оператор",
            assignments: [
              {
                id: "pb",
                templateId: "pb-card",
                protocolMode: "GROUP",
                eventId: pb,
                outcome: { status: "UNKNOWN", source: "" },
              },
              {
                id: "ptm",
                templateId: "ptm-card",
                protocolMode: "GROUP",
                eventId: ptm,
                outcome: { status: "UNKNOWN", source: "" },
              },
            ],
          })),
        });
        // Technical row with automatic bundle is never silently mistaken for a person.
        draft.items.push(
          draftSchema.parse({
            kind: "PERSON",
            items: [
              {
                id: "reserve",
                assignments: [
                  {
                    id: "reserve-pb",
                    templateId: "pb-card",
                    protocolMode: "GROUP",
                    eventId: pb,
                  },
                ],
              },
            ],
          }).items[0],
        );
        const request = await createRequest(c, draft);
        assert.equal(request.approval, null);
        const waiting = await validateRequest(c, request.id, {
          expectedRevision: request.revision,
          assignments: [{ rowId: "row-0", assignmentId: "pb" }],
        });
        assert.equal(waiting.valid, false);
        assert.ok(
          waiting.issues.some((issue) => issue.code === "OUTCOME_UNCONFIRMED"),
        );
        await assert.rejects(
          submitApproval(c, request.id, {
            expectedRevision: request.revision,
            assignments: [{ rowId: "row-0", assignmentId: "pb" }],
          }),
          rejectedCode("APPROVAL_DATA_INCOMPLETE"),
        );
        assert.equal(
          (await listApprovals(c, { status: "PENDING" })).items.some(
            (value) => value.requestId === request.id,
          ),
          false,
        );
        let offset = 0;
        const frozen = new Map<string, string>();
        for (const [stage, size] of partitions.entries()) {
          const current = await requestDetail(c, request.id),
            editable = draftSchema.parse(current.draft);
          const batchDate = `2026-10-${String(4 + stage).padStart(2, "0")}`;
          editable.events!.find(
            (event) => event.id === pb,
          )!.commonFields.documentDate = batchDate;
          editable.events!.find(
            (event) => event.id === pb,
          )!.commonFields.protocolDate = batchDate;
          const keys = Array.from({ length: size }, (_, i) => ({
            rowId: `row-${offset + i}`,
            assignmentId: "pb",
          }));
          for (const key of keys)
            editable.items
              .find((i) => i.id === key.rowId)!
              .assignments.find((a) => a.id === key.assignmentId)!.outcome = {
              status: "PASSED",
              source: `Синтетическая ведомость ${offset}`,
            };
          const saved = await patchRequest(c, request.id, {
            expectedRevision: current.revision,
            draft: editable,
          });
          const validated = await validateRequest(c, request.id, {
            expectedRevision: saved.revision,
            assignments: keys,
          });
          assert.deepEqual(validated.issues, []);
          assert.equal(validated.recipientCount, size);
          const submitted = await approve(request.id, saved.revision, keys);
          const detail = await approvalDetail(
            approvals.directorContext,
            submitted.approval.proposalId,
          );
          assert.equal((detail.draft as Draft).items.length, size);
          assert.deepEqual(
            (detail.before as Draft).items.map((row) => row.id).sort(),
            keys.map((key) => key.rowId).sort(),
          );
          const selectedRows = new Set(keys.map((key) => key.rowId));
          const visibleChanges = JSON.stringify(detail.diff);
          for (const waitingRow of editable.items.filter(
            (row) => row.id !== "reserve" && !selectedRows.has(row.id),
          ))
            assert.equal(visibleChanges.includes(waitingRow.fullNameRu), false);
          const auditProposal = await db.requestProposal.findUniqueOrThrow({
            where: { id: submitted.approval.proposalId },
          });
          assert.equal(
            draftSchema.parse(auditProposal.payload).items.length,
            count + 1,
            "the full submitted snapshot remains immutable audit material",
          );
          const result = await Promise.all([
            finalize(
              c,
              request.id,
              { expectedRevision: submitted.revision, assignments: keys },
              randomUUID(),
            ),
            finalize(
              c,
              request.id,
              { expectedRevision: submitted.revision, assignments: keys },
              randomUUID(),
            ),
          ]);
          assert.deepEqual(result[0], result[1]);
          const readback = await requestDetail(c, request.id);
          assert.equal(readback.id, request.id);
          assert.equal(readback.status, "DRAFT");
          assert.equal(readback.issuedAssignments.length, offset + size);
          const snapshots = await db.renderInputSnapshot.findMany({
            where: {
              tenantId: c.tenantId,
              requestId: request.id,
              issuanceId: { not: null },
            },
          });
          for (const snap of snapshots) {
            const digest = hash(snap.input);
            if (frozen.has(snap.id)) assert.equal(digest, frozen.get(snap.id));
            else frozen.set(snap.id, digest);
          }
          const group = await db.issuedDocument.findFirstOrThrow({
            where: {
              tenantId: c.tenantId,
              issuanceId: (result[0] as { issuanceId: string }).issuanceId,
              ownerKind: "GROUP",
            },
          });
          assert.equal(group.documentDate, batchDate);
          if (stage === 0) {
            const issuedChange = draftSchema.parse(readback.draft);
            issuedChange.items[0].assignments.find(
              (assignment) => assignment.id === "pb",
            )!.outcome = { status: "FAILED", source: "Неправомерная правка" };
            await assert.rejects(
              patchRequest(c, request.id, {
                expectedRevision: readback.revision,
                draft: issuedChange,
              }),
              rejectedCode("ISSUED_ASSIGNMENT_IMMUTABLE"),
            );
            const corrected = await correction(c, request.id, {
              expectedRevision: readback.revision,
              issuanceId: group.issuanceId,
              reason: "Явное исправление выбранной первой партии",
            });
            assert.equal(corrected.items.length, size);
            assert.equal(
              corrected.items.every((item) =>
                item.assignments.every(
                  (assignment) => assignment.templateId === "pb-card",
                ),
              ),
              true,
            );
            assert.equal(corrected.correctsIssuanceId, group.issuanceId);
          }
          assert.equal(
            await db.groupDocumentMember.count({
              where: { documentId: group.id },
            }),
            size,
          );
          offset += size;
        }
        const stillOpen = await requestDetail(c, request.id);
        assert.equal(
          stillOpen.items
            .filter((i) => i.id !== "reserve")
            .every(
              (i) =>
                i.assignments.find((a) => a.id === "ptm")?.outcome?.status ===
                "UNKNOWN",
            ),
          true,
        );
        const edit = draftSchema.parse(stillOpen.draft);
        edit.items[0].assignments.find((a) => a.id === "ptm")!.outcome = {
          status: "PASSED",
          source: "Синтетическая сдача второго курса",
        };
        const saved = await patchRequest(c, request.id, {
          expectedRevision: stillOpen.revision,
          draft: edit,
        });
        const keys = [{ rowId: "row-0", assignmentId: "ptm" }];
        await approve(request.id, saved.revision, count === 1 ? undefined : keys);
        // An unselected waiting person's edit must not invalidate the reviewed course.
        const unaffected = draftSchema.parse(
          (await requestDetail(c, request.id)).draft,
        );
        if (count > 1)
          unaffected.items[1].positionRu = "Исправленная должность ожидающего";
        unaffected.title = "Редактирование оставшихся";
        const later = await patchRequest(c, request.id, {
          expectedRevision: saved.revision,
          draft: unaffected,
        });
        const outcome = await finalize(
          c,
          request.id,
          {
            expectedRevision: later.revision,
            ...(count === 1 ? {} : { assignments: keys }),
          },
          randomUUID(),
        );
        const after = await requestDetail(c, request.id);
        assert.equal(after.status, count === 1 ? "FINALIZED" : "DRAFT");
        assert.equal(after.issuances.length, partitions.length + 1);
        assert.equal(after.issuedAssignments.length, count + 1);
        for (const snap of await db.renderInputSnapshot.findMany({
          where: { id: { in: [...frozen.keys()] } },
        }))
          assert.equal(hash(snap.input), frozen.get(snap.id));
        assert.equal(
          new Set(after.documents.map((d) => `${d.namespace}:${d.number}`))
            .size,
          after.documents.length,
        );
        assert.ok(outcome);
      },
    );
  await t.test(
    "selected changed facts invalidate approval and direct tenant/revision bypass fails",
    async () => {
      const request = await createRequest(
        c,
        draftSchema.parse({
          kind: "PERSON",
          demoMode: true,
          items: [
            {
              id: "r",
              fullNameRu: "Синтетический Получатель",
              positionRu: "Оператор",
              assignments: [
                {
                  id: "a",
                  templateId: "pb-card",
                  documentDate: "2026-10-04",
                  protocolDate: "2026-10-04",
                  trainingStart: "2026-10-01",
                  trainingEnd: "2026-10-03",
                  trainingSubject: "Синтетическая программа",
                  outcome: { status: "PASSED", source: "Ведомость" },
                },
              ],
            },
          ],
        }),
      );
      const keys = [{ rowId: "r", assignmentId: "a" }];
      await assert.rejects(
        finalize(
          c,
          request.id,
          {
            expectedRevision: request.revision,
            assignments: keys,
            scopeHash: null,
          },
          randomUUID(),
        ),
        rejectedCode("VALIDATION"),
      );
      await assert.rejects(
        finalize(
          c,
          request.id,
          { expectedRevision: request.revision, assignments: keys },
          randomUUID(),
        ),
        rejectedCode("DIRECTOR_APPROVAL_REQUIRED"),
      );
      await assert.rejects(
        db.issuance.create({
          data: {
            tenantId: c.tenantId,
            requestId: request.id,
            sourceRevision: request.revision,
            scopeHash: hash("unreviewed-new-scope"),
            snapshot: { synthetic: true },
            inputHash: "synthetic",
            profileVersionId: request.profileVersionId!,
            createdBy: c.userId,
          },
        }),
        /DEMO_APPROVAL_REQUIRED/,
      );
      await approve(request.id, request.revision, keys);
      const edit = draftSchema.parse(
        (await requestDetail(c, request.id)).draft,
      );
      edit.items[0].positionRu = "Изменено после решения";
      const saved = await patchRequest(c, request.id, {
        expectedRevision: request.revision,
        draft: edit,
      });
      await assert.rejects(
        finalize(
          c,
          request.id,
          { expectedRevision: saved.revision, assignments: keys },
          randomUUID(),
        ),
        rejectedCode("DIRECTOR_APPROVAL_REQUIRED"),
      );
      await assert.rejects(
        submitApproval(c, request.id, {
          expectedRevision: request.revision,
          assignments: keys,
        }),
        rejectedCode("REVISION_CONFLICT"),
      );
      await assert.rejects(
        submitApproval({ ...c, tenantId: randomUUID() }, request.id, {
          expectedRevision: saved.revision,
          assignments: keys,
        }),
        rejectedCode("NOT_FOUND"),
      );
    },
  );
});

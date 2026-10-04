import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  draftSchema,
  itemSchema,
  profileSchema,
  type Draft,
} from "../../packages/contracts/src";
import { db, type Context } from "../../apps/api/src/core";
import {
  createRequest,
  patchRequest,
  requestDetail,
  validateRequest,
  resolvedRequest,
  preview,
} from "../../apps/api/src/requests";
import { applyImport, importPreview } from "../../apps/api/src/files";
import {
  removeTraining,
  restoreTraining,
  listTrainingRemovals,
} from "../../apps/api/src/training-removals";
import { assertTestDatabase } from "./test-database";
import { restoreTrainingAssignmentField } from "../../apps/web/lib/training-assignment-edit";

const code = (expected: string) => (error: unknown) => {
  assert.ok(error && typeof error === "object" && "getResponse" in error);
  assert.equal(
    (error as { getResponse(): { code: string } }).getResponse().code,
    expected,
  );
  return true;
};
const fixture = (): Draft => {
  const eventId = randomUUID();
  return draftSchema.parse({
    kind: "PERSON",
    schemaVersion: 2,
    commonFields: { documentDate: "2026-10-03" },
    trainingDefaults: [{ direction: "BIOT", eventIds: [eventId] }],
    events: [
      {
        id: eventId,
        title: "Синтетическая исходная группа",
        protocolTemplateId: "biot-protocol",
        protocolMode: "GROUP",
        protocolModeSource: "MANUAL",
        commonFields: {
          trainingSubject: "Синтетическая общая программа",
          documentDate: "2026-10-03",
          hours: "10",
          productionHours: "16",
          biotCategory: "WORKER",
        },
      },
    ],
    items: [1, 2].map((number) => ({
      id: `person-${number}`,
      employeeCategory: "WORKER",
      fullNameRu: `Синтетический ${number}`,
      workplaceRu: "Синтетическое предприятие",
      assignments: [
        {
          id: `biot-${number}`,
          eventId,
          templateId: "biot-worker-card",
          protocolMode: "GROUP",
          documentDate: "2026-10-04",
          fieldOrigins: {
            documentDate: number === 1 ? "IMPORTED" : "MANUAL",
            trainingSubject: "INHERITED",
            hours: "INHERITED",
            productionHours: "INHERITED",
          },
          outcome: {
            status: "PASSED",
            source: "Синтетическая ведомость",
            confirmedBy: "client-forgery",
            confirmedAt: "2000-01-01T00:00:00Z",
          },
        },
      ],
    })),
  });
};

test("operator-flow API integrity: scoped durable restoration, conflicts, metadata and incremental import", async (t) => {
  assertTestDatabase();
  assert.doesNotMatch(
    new URL(process.env.DATABASE_URL!).pathname,
    /browser|first_live_ui/,
    "Mutations require the dedicated integration database",
  );
  const tenant = await db.tenant.create({
    data: { name: "СИНТЕТИЧЕСКИЙ UX domain 20261003", demoOnly: true },
  });
  const user = await db.user.create({
    data: {
      tenantId: tenant.id,
      email: `ux-domain-${randomUUID()}@example.test`,
      displayName: "Синтетический оператор",
      role: "OPERATOR",
      passwordHash: "unused-test-only",
    },
  });
  const c: Context = {
    tenantId: tenant.id,
    userId: user.id,
    role: "OPERATOR",
    sessionId: "synthetic-test",
    csrfHash: "synthetic-test",
    correlationId: randomUUID(),
  };
  const evidence: Record<string, unknown> = {
    database: new URL(process.env.DATABASE_URL!).pathname.slice(1),
    tenantDemoOnly: tenant.demoOnly,
    capturedAt: new Date().toISOString(),
  };
  try {
    await t.test(
      "scoped remove survives reload and unrelated edits; restore preserves exact IDs and server confirmation",
      async () => {
        const created = await createRequest(c, fixture());
        const before = draftSchema.parse(created.draft);
        const fact = structuredClone(before.items[0].assignments[0]);
        assert.equal(fact.outcome?.confirmedBy, c.userId);
        assert.notEqual(fact.outcome?.confirmedAt, "2000-01-01T00:00:00Z");
        const operationId = randomUUID();
        const removed = await removeTraining(c, created.id, {
          expectedRevision: created.revision,
          operationId,
          eventId: before.events![0].id,
          recipientIds: ["person-1"],
        });
        assert.equal(removed.items[0].assignments.length, 0);
        assert.deepEqual(
          removed.items[1].assignments[0],
          before.items[1].assignments[0],
        );
        assert.equal(
          (await listTrainingRemovals(c, created.id)).items.find(
            (entry) => entry.operationId === operationId,
          )?.restored,
          false,
        );
        const reopened = await requestDetail(c, created.id);
        const edited = draftSchema.parse(reopened.draft);
        edited.items[1].positionRu = "Независимая последующая правка";
        const saved = await patchRequest(c, created.id, {
          expectedRevision: reopened.revision,
          draft: edited,
        });
        const restored = await restoreTraining(c, created.id, operationId, {
          expectedRevision: saved.revision,
        });
        assert.deepEqual(restored.items[0].assignments[0], fact);
        assert.equal(
          restored.items[1].positionRu,
          "Независимая последующая правка",
        );
        const repeated = await restoreTraining(c, created.id, operationId, {
          expectedRevision: saved.revision,
        });
        assert.equal(repeated.revision, restored.revision);
        assert.equal(repeated.items[0].assignments.length, 1);
        evidence.scopedRestore = {
          operationId,
          before: fact,
          after: restored.items[0].assignments[0],
          unrelatedPosition: restored.items[1].positionRu,
          removeRevision: removed.revision,
          restoreRevision: restored.revision,
          doubleUndoRevision: repeated.revision,
        };
      },
    );
    await t.test(
      "scoped restoration recovers original form positions and retains later independent forms and their order",
      async () => {
        const input = fixture();
        const sourceEventId = input.events![0].id;
        const independentEventId = randomUUID();
        const laterEventId = randomUUID();
        input.events!.push({
          id: independentEventId,
          title: "Независимое обучение ПБ",
          protocolTemplateId: "pb-protocol",
          protocolMode: "GROUP",
          protocolModeSource: "MANUAL",
          commonFields: {
            documentDate: "2026-10-03",
            trainingSubject: "Независимая программа ПБ",
          },
        });
        input.items[0].assignments.push({
          ...structuredClone(input.items[0].assignments[0]),
          id: "independent-pb-primary",
          templateId: "pb-card",
          eventId: independentEventId,
          protocolMode: "GROUP",
        });
        const created = await createRequest(c, input);
        const before = draftSchema.parse(created.draft);
        assert.deepEqual(
          before.items[0].assignments.map((entry) => entry.id),
          ["biot-1", "independent-pb-primary"],
        );
        const operationId = randomUUID();
        const removed = await removeTraining(c, created.id, {
          expectedRevision: created.revision,
          operationId,
          eventId: sourceEventId,
          recipientIds: ["person-1"],
        });
        const pending = await requestDetail(c, created.id);
        const restored = await restoreTraining(c, created.id, operationId, {
          expectedRevision: pending.revision,
        });
        assert.deepEqual(
          draftSchema.parse(restored.draft).items[0].assignments,
          before.items[0].assignments,
        );
        const secondOperation = randomUUID();
        const removedAgain = await removeTraining(c, created.id, {
          expectedRevision: restored.revision,
          operationId: secondOperation,
          eventId: sourceEventId,
          recipientIds: ["person-1", "person-2"],
          removeDefault: true,
        });
        assert.deepEqual(
          removedAgain.events?.map((event) => event.id),
          [independentEventId],
        );
        const changed = draftSchema.parse(removedAgain.draft);
        changed.items[0].positionRu = "Независимая более поздняя должность";
        changed.items[0].assignments.push({
          ...structuredClone(changed.items[0].assignments[0]),
          id: "later-ptm-primary",
          templateId: "ptm-card",
          eventId: laterEventId,
          protocolMode: "GROUP",
          trainingSubject: "Более поздняя программа ПТМ",
          fieldOrigins: { trainingSubject: "MANUAL" },
        });
        changed.events!.push({
          id: laterEventId,
          title: "Более позднее независимое ПТМ",
          protocolTemplateId: "ptm-protocol",
          protocolMode: "GROUP",
          protocolModeSource: "MANUAL",
          commonFields: {
            trainingSubject: "Более поздняя программа ПТМ",
            documentDate: "2026-10-03",
          },
        });
        const edited = await patchRequest(c, created.id, {
          expectedRevision: removedAgain.revision,
          draft: changed,
        });
        const independentBefore = draftSchema.parse(edited.draft).items[0]
          .assignments;
        const restoredAgain = await restoreTraining(
          c,
          created.id,
          secondOperation,
          { expectedRevision: edited.revision },
        );
        const actual = draftSchema.parse(restoredAgain.draft).items[0];
        assert.deepEqual(
          actual.assignments.map((entry) => entry.id),
          ["biot-1", "independent-pb-primary", "later-ptm-primary"],
        );
        assert.deepEqual(actual.assignments[0], before.items[0].assignments[0]);
        assert.deepEqual(actual.assignments.slice(1), independentBefore);
        assert.equal(actual.positionRu, changed.items[0].positionRu);
        assert.deepEqual(
          restoredAgain.events?.map((event) => event.id),
          [sourceEventId, independentEventId, laterEventId],
        );
        assert.deepEqual(
          draftSchema.parse(restoredAgain.draft).items[1],
          before.items[1],
        );
        evidence.scopedFormOrder = {
          requestId: created.id,
          removedRevision: removed.revision,
          originalOrder: before.items[0].assignments.map((entry) => entry.id),
          restoredOrder: actual.assignments.map((entry) => entry.id),
          restoredEventOrder: restoredAgain.events?.map((event) => event.id),
          exactRemovedFacts: actual.assignments[0],
          independentFormsUnchanged: true,
          laterPosition: actual.positionRu,
        };
      },
    );
    await t.test(
      "all-direction remove clears default and event; durable restore recreates both once",
      async () => {
        const created = await createRequest(c, fixture());
        const operationId = randomUUID();
        const removed = await removeTraining(c, created.id, {
          expectedRevision: created.revision,
          operationId,
          direction: "BIOT",
          recipientIds: ["person-1", "person-2"],
          removeDefault: true,
        });
        assert.equal(removed.events?.length, 0);
        assert.deepEqual(removed.trainingDefaults, []);
        const restored = await restoreTraining(c, created.id, operationId, {
          expectedRevision: removed.revision,
        });
        assert.equal(restored.events?.[0].id, created.events?.[0].id);
        assert.deepEqual(restored.trainingDefaults, [
          { direction: "BIOT", eventIds: [created.events![0].id] },
        ]);
        assert.deepEqual(
          restored.items[0].assignments[0].outcome,
          created.items[0].assignments[0].outcome,
        );
        const duplicate = await removeTraining(c, created.id, {
          expectedRevision: created.revision,
          operationId,
          direction: "BIOT",
          recipientIds: ["person-1", "person-2"],
          removeDefault: true,
        });
        assert.equal(duplicate.revision, restored.revision);
        evidence.allRestore = {
          removedEventCount: removed.events?.length,
          restoredEventIds: restored.events?.map((event) => event.id),
          defaults: restored.trainingDefaults,
          duplicateRevision: duplicate.revision,
        };
      },
    );
    await t.test(
      "affected context and reassignments conflict atomically; journal and both versions remain",
      async () => {
        const created = await createRequest(c, fixture());
        const operationId = randomUUID();
        const removed = await removeTraining(c, created.id, {
          expectedRevision: created.revision,
          operationId,
          eventId: created.events![0].id,
          recipientIds: ["person-1"],
        });
        const edited = draftSchema.parse(removed.draft);
        edited.events![0].commonFields.trainingSubject =
          "Изменённая во второй вкладке программа";
        const saved = await patchRequest(c, created.id, {
          expectedRevision: removed.revision,
          draft: edited,
        });
        await assert.rejects(
          restoreTraining(c, created.id, operationId, {
            expectedRevision: saved.revision,
          }),
          code("TRAINING_RESTORE_CONFLICT"),
        );
        const current = await requestDetail(c, created.id);
        assert.equal(current.revision, saved.revision);
        assert.equal(current.items[0].assignments.length, 0);
        assert.equal(
          current.events?.[0].commonFields.trainingSubject,
          edited.events![0].commonFields.trainingSubject,
        );
        assert.equal(
          (await listTrainingRemovals(c, created.id)).items.find(
            (entry) => entry.operationId === operationId,
          )?.restored,
          false,
        );
        evidence.restoreConflict = {
          operationId,
          revisionUnchanged: current.revision === saved.revision,
          currentProgram: current.events?.[0].commonFields.trainingSubject,
          removedFactsPersistInJournal: true,
        };
        await assert.rejects(
          restoreTraining(
            { ...c, tenantId: randomUUID() },
            created.id,
            operationId,
            { expectedRevision: saved.revision },
          ),
          code("NOT_FOUND"),
        );
      },
    );
    await t.test(
      "protocol reset through an ordinary PATCH survives canonical normalization and follows a changed common date without reconfirming facts",
      async () => {
        const proofs = [];
        for (const origin of ["MANUAL", "IMPORTED", "CLEARED"] as const) {
          const input = fixture();
          input.events![0].protocolMode = "INDIVIDUAL";
          input.events![0].protocolModeSource = "MANUAL";
          input.events![0].commonFields.protocolDate = "2026-10-02";
          const unrelatedEventId = randomUUID();
          input.events!.push({
            ...structuredClone(input.events![0]),
            id: unrelatedEventId,
            title: "Синтетическая независимая группа",
          });
          input.items[1].assignments[0].eventId = unrelatedEventId;
          const primary = input.items[0].assignments[0];
          primary.protocolDate = origin === "CLEARED" ? "" : "2026-09-29";
          primary.fieldOrigins = {
            ...primary.fieldOrigins,
            protocolDate: origin,
          };
          const created = await createRequest(c, input);
          const before = draftSchema.parse(created.draft);
          const protocol = before.items[0].assignments.find(
            (entry) => entry.templateId === "biot-protocol",
          )!;
          assert.ok(protocol);
          assert.equal(protocol.fieldOrigins?.protocolDate, origin);
          assert.equal(protocol.fieldOrigins?.documentDate, origin);
          assert.equal(protocol.documentDate, primary.protocolDate);
          const unrelated = structuredClone(before.items[1]);
          before.items[0] = restoreTrainingAssignmentField(
            before.items[0],
            protocol.id,
            "documentDate",
            true,
          );
          const reset = await patchRequest(c, created.id, {
            expectedRevision: created.revision,
            draft: before,
          });
          const reopened = await requestDetail(c, created.id);
          const reopenedDraft = draftSchema.parse(reopened.draft);
          for (const assignment of reopenedDraft.items[0].assignments) {
            assert.equal(assignment.fieldOrigins?.protocolDate, "INHERITED");
            if (assignment.templateId.endsWith("-protocol"))
              assert.equal(assignment.fieldOrigins?.documentDate, "INHERITED");
            assert.deepEqual(
              assignment.outcome,
              created.items[0].assignments.find(
                (entry) => entry.id === assignment.id,
              )!.outcome,
            );
          }
          assert.deepEqual(reopenedDraft.items[1], unrelated);
          const effective = await resolvedRequest(c, created.id);
          assert.equal(
            effective.draft.items[0].assignments.find(
              (entry) => entry.id === protocol.id,
            )!.documentDate,
            "2026-10-02",
          );
          reopenedDraft.events![0].commonFields.protocolDate = "2026-10-03";
          const changed = await patchRequest(c, created.id, {
            expectedRevision: reopened.revision,
            draft: reopenedDraft,
          });
          const resolved = await resolvedRequest(c, created.id);
          const updated = resolved.draft.items[0].assignments.find(
            (entry) => entry.id === protocol.id,
          )!;
          assert.equal(updated.documentDate, "2026-10-03");
          assert.equal(updated.protocolDate, "2026-10-03");
          assert.equal(
            resolved.provenance[`person-1:${protocol.id}`].protocolDate,
            "EVENT",
          );
          assert.deepEqual(
            draftSchema.parse(changed.draft).items[1],
            unrelated,
          );
          assert.deepEqual(updated.outcome, protocol.outcome);
          proofs.push({
            origin,
            requestId: created.id,
            protocolId: protocol.id,
            explicitDate: protocol.documentDate,
            resetRevision: reset.revision,
            changedRevision: changed.revision,
            updatedDate: updated.documentDate,
            protocolOrigin: changed.items[0].assignments.find(
              (entry) => entry.id === protocol.id,
            )!.fieldOrigins,
            outcome: updated.outcome,
            unrelatedRecipientUnchanged: true,
          });
        }
        evidence.protocolResetAfterPatch = proofs;
      },
    );
    await t.test(
      "an explicit change of factual knowledge result reconfirms the actor while unchanged facts keep their provenance",
      async () => {
        const created = await createRequest(c, fixture());
        const unchanged = draftSchema.parse(created.draft);
        unchanged.items[0].positionRu = "Независимая синтетическая должность";
        const ordinary = await patchRequest(c, created.id, {
          expectedRevision: created.revision,
          draft: unchanged,
        });
        assert.deepEqual(
          ordinary.items[0].assignments[0].outcome,
          created.items[0].assignments[0].outcome,
        );
        const actor = await db.user.create({
          data: {
            tenantId: c.tenantId,
            email: `facts-${randomUUID()}@example.test`,
            displayName: "Синтетический подтверждающий оператор",
            role: "OPERATOR",
            passwordHash: "unused-direct-domain-context",
          },
        });
        const changed = draftSchema.parse(ordinary.draft);
        changed.items[0].assignments[0].biotKnowledgeResult =
          "Новое явное синтетическое значение 85%";
        const reconfirmed = await patchRequest(
          { ...c, userId: actor.id, role: "OPERATOR" },
          created.id,
          { expectedRevision: ordinary.revision, draft: changed },
        );
        assert.equal(
          reconfirmed.items[0].assignments[0].outcome?.confirmedBy,
          actor.id,
        );
        assert.equal(
          reconfirmed.items[0].assignments[0].outcome?.status,
          "PASSED",
        );
        assert.equal(
          reconfirmed.items[0].assignments[0].outcome?.source,
          created.items[0].assignments[0].outcome?.source,
        );
        evidence.explicitFactConfirmation = {
          unchangedActor: ordinary.items[0].assignments[0].outcome?.confirmedBy,
          reconfirmedActor: actor.id,
          knowledge: reconfirmed.items[0].assignments[0].biotKnowledgeResult,
        };
      },
    );
    await t.test(
      "UNKNOWN never receives client-supplied or automatic confirmed metadata",
      async () => {
        const input = fixture();
        input.items[0].assignments[0].outcome = {
          status: "UNKNOWN",
          source: "",
          confirmedBy: "forged",
          confirmedAt: "2000-01-01",
        };
        const created = await createRequest(c, input);
        assert.deepEqual(created.items[0].assignments[0].outcome, {
          status: "UNKNOWN",
          source: "",
        });
        const draft = draftSchema.parse(created.draft);
        draft.items[0].assignments[0].outcome!.confirmedBy = "forged-again";
        const saved = await patchRequest(c, created.id, {
          expectedRevision: created.revision,
          draft,
        });
        assert.deepEqual(saved.items[0].assignments[0].outcome, {
          status: "UNKNOWN",
          source: "",
        });
        evidence.unknown = saved.items[0].assignments[0].outcome;
      },
    );
    await t.test(
      "A then B/C then repeat all is per-source-row idempotent; stale new rows conflict and another request can reuse source",
      async () => {
        const buffer = Buffer.from(
          "fullNameRu\tpersonnelNumber\nСинтетическая Альфа\t00001\nСинтетическая Бета\t00002\nСинтетическая Гамма\t00003",
          "utf8",
        );
        const preview = await importPreview(c, {
          buffer,
          size: buffer.length,
          originalname: "synthetic-partial.tsv",
        } as Express.Multer.File);
        const rows = preview.rows.map((row) =>
          itemSchema.parse({
            id: `source-${row.sourceRow}`,
            importId: preview.importId,
            sourceRow: row.sourceRow,
            fullNameRu: row.values[0],
            personnelNumber: row.values[1],
          }),
        );
        const created = await createRequest(c, {
          kind: "PERSON",
          schemaVersion: 2,
          items: [],
        });
        const first = await applyImport(c, created.id, {
          expectedRevision: created.revision,
          importId: preview.importId,
          rows: [rows[0]],
        });
        await assert.rejects(
          applyImport(c, created.id, {
            expectedRevision: created.revision,
            importId: preview.importId,
            rows: rows.slice(1),
          }),
          code("REVISION_CONFLICT"),
        );
        const [second, retry] = await Promise.all([
          applyImport(c, created.id, {
            expectedRevision: first.revision,
            importId: preview.importId,
            rows: rows.slice(1),
          }),
          applyImport(c, created.id, {
            expectedRevision: first.revision,
            importId: preview.importId,
            rows: rows.slice(1),
          }),
        ]);
        assert.equal(second.items.length, 3);
        assert.equal(retry.items.length, 3);
        assert.equal(second.revision, retry.revision);
        const repeated = await applyImport(c, created.id, {
          expectedRevision: created.revision,
          importId: preview.importId,
          rows,
        });
        assert.equal(repeated.items.length, 3);
        assert.equal(repeated.importResult.applied, 0);
        assert.equal(repeated.importResult.skipped, 3);
        assert.equal(repeated.revision, second.revision);
        assert.deepEqual(repeated.items[0], first.items[0]);
        const another = await createRequest(c, {
          kind: "PERSON",
          schemaVersion: 2,
          items: [],
        });
        const other = await applyImport(c, another.id, {
          expectedRevision: another.revision,
          importId: preview.importId,
          rows,
        });
        assert.equal(other.items.length, 3);
        evidence.partialImport = {
          importId: preview.importId,
          firstResult: first.importResult,
          secondResult: second.importResult,
          retryResult: retry.importResult,
          repeatResult: repeated.importResult,
          rows: repeated.items.map((item) => ({
            id: item.id,
            importId: item.importId,
            sourceRow: item.sourceRow,
            personnelNumber: item.personnelNumber,
          })),
          otherRequestCount: other.items.length,
        };
      },
    );
    await t.test(
      "invalid mapped dates and source parser errors are rejected before a proposal is written",
      async () => {
        const created = await createRequest(c, {
          kind: "PERSON",
          schemaVersion: 2,
          items: [],
        });
        const batch = await db.importBatch.create({
          data: {
            tenantId: c.tenantId,
            checksum: randomUUID(),
            rows: { rows: [{ sourceRow: 2, errors: [] }], errors: [] },
          },
        });
        const row = itemSchema.parse({
          id: "invalid-source-date",
          importId: batch.id,
          sourceRow: 2,
          assignments: [
            {
              id: "invalid-date-card",
              templateId: "ptm-card",
              documentDate: "2026-02-31",
            },
          ],
        });
        await assert.rejects(
          applyImport(c, created.id, {
            expectedRevision: created.revision,
            importId: batch.id,
            rows: [row],
          }),
          code("IMPORT_DATE_INVALID"),
        );
        const badBatch = await db.importBatch.create({
          data: {
            tenantId: c.tenantId,
            checksum: randomUUID(),
            rows: {
              rows: [
                { sourceRow: 2, errors: [{ code: "FORMULA_NOT_ALLOWED" }] },
              ],
              errors: [],
            },
          },
        });
        await assert.rejects(
          applyImport(c, created.id, {
            expectedRevision: created.revision,
            importId: badBatch.id,
            rows: [
              itemSchema.parse({
                id: "bad-parser-row",
                importId: badBatch.id,
                sourceRow: 2,
              }),
            ],
          }),
          code("IMPORT_SOURCE_INVALID"),
        );
        const readback = await requestDetail(c, created.id);
        assert.equal(readback.revision, created.revision);
        assert.deepEqual(readback.items, []);
        evidence.invalidImport = {
          revisionUnchanged: true,
          count: 0,
          rejectedCodes: ["IMPORT_DATE_INVALID", "IMPORT_SOURCE_INVALID"],
        };
      },
    );
    await t.test(
      "excluded formula source row does not block a valid partial import, while selecting it remains rejected",
      async () => {
        const created = await createRequest(c, {
          kind: "PERSON",
          schemaVersion: 2,
          items: [],
        });
        const formula = {
          row: 2,
          column: 1,
          code: "FORMULA_NOT_ALLOWED",
          message: "Formula is not imported",
        };
        const batch = await db.importBatch.create({
          data: {
            tenantId: c.tenantId,
            checksum: randomUUID(),
            rows: {
              rows: [
                { sourceRow: 2, errors: [formula] },
                { sourceRow: 3, errors: [] },
              ],
              errors: [formula],
            },
          },
        });
        const row = (sourceRow: number) =>
          itemSchema.parse({
            id: `formula-selection-${sourceRow}`,
            importId: batch.id,
            sourceRow,
            fullNameRu:
              sourceRow === 3 ? "Valid independent source row" : "Formula row",
          });
        await assert.rejects(
          applyImport(c, created.id, {
            expectedRevision: created.revision,
            importId: batch.id,
            rows: [row(2)],
          }),
          code("IMPORT_SOURCE_INVALID"),
        );
        assert.deepEqual((await requestDetail(c, created.id)).items, []);
        const applied = await applyImport(c, created.id, {
          expectedRevision: created.revision,
          importId: batch.id,
          rows: [row(3)],
        });
        assert.equal(applied.importResult.applied, 1);
        const saved = await requestDetail(c, created.id);
        assert.equal(saved.items.length, 1);
        assert.equal(saved.items[0].sourceRow, 3);
        assert.equal(saved.items[0].fullNameRu, "Valid independent source row");
        await assert.rejects(
          applyImport(c, created.id, {
            expectedRevision: saved.revision,
            importId: batch.id,
            rows: [row(2), row(3)],
          }),
          code("IMPORT_SOURCE_INVALID"),
        );
        assert.equal(
          (await requestDetail(c, created.id)).revision,
          saved.revision,
        );
        evidence.excludedFormula = {
          selectedFormulaCode: "IMPORT_SOURCE_INVALID",
          validSourceRow: 3,
          addedRows: applied.importResult.applied,
          rejectedMixedSelectionPreservedRevision: true,
        };
      },
    );
    await t.test(
      "authoritative scaffold metadata distinguishes an untouched starter from filled then cleared",
      async () => {
        const input = draftSchema.parse({
          kind: "PERSON",
          schemaVersion: 2,
          items: [{ id: "starter", employeeCategory: "WORKER" }],
        });
        const created = await createRequest(c, input);
        assert.equal(created.importScaffoldId, "starter");
        assert.equal(
          (await requestDetail(c, created.id)).importScaffoldId,
          "starter",
        );
        const filled = draftSchema.parse(created.draft);
        filled.items[0].fullNameRu = "Синтетически заполнено";
        const saved = await patchRequest(c, created.id, {
          expectedRevision: created.revision,
          draft: filled,
        });
        filled.items[0].fullNameRu = "";
        const cleared = await patchRequest(c, created.id, {
          expectedRevision: saved.revision,
          draft: filled,
        });
        assert.equal(cleared.importScaffoldId, null);
        assert.equal(
          (await requestDetail(c, created.id)).importScaffoldId,
          null,
        );
        evidence.scaffold = {
          untouched: created.importScaffoldId,
          filledThenCleared: cleared.importScaffoldId,
        };
      },
    );
    await t.test(
      "idempotent copy creation returns exactly one request and rejects reused key with different input",
      async () => {
        const input = {
          kind: "PERSON",
          title: "Синтетическая копия конфликта",
          items: [],
        };
        const key = randomUUID();
        const [first, retry] = await Promise.all([
          createRequest(c, input, key),
          createRequest(c, input, key),
        ]);
        assert.equal(first.id, retry.id);
        await assert.rejects(
          createRequest(c, { ...input, title: "Изменённая копия" }, key),
          code("IDEMPOTENCY_MISMATCH"),
        );
        assert.equal(
          await db.requestProposal.count({
            where: {
              tenantId: c.tenantId,
              operation: "SAVE",
              payload: { path: ["title"], equals: input.title },
            },
          }),
          1,
        );
        evidence.copyIdempotency = {
          requestId: first.id,
          repeatedRequestId: retry.id,
          count: 1,
        };
      },
    );
    await t.test(
      "local employer text uses a symmetric bilingual fallback and invisible-only text inherits the company without rewriting source",
      async () => {
        const customer = await db.customerOrganization.create({
          data: {
            tenantId: c.tenantId,
            nameRu: "Синтетическая компания RU",
            nameKz: "Синтетикалық компания KZ",
          },
        });
        const blank = "\u00a0\u200b\u2060";
        const input = draftSchema.parse({
          kind: "COMPANY",
          customerId: customer.id,
          schemaVersion: 2,
          items: [
            {
              id: "local-ru",
              fullNameRu: "Синтетический 1",
              workplaceRu: "Локальное предприятие RU",
              workplaceKz: blank,
            },
            {
              id: "local-kz",
              fullNameRu: "Синтетический 2",
              workplaceRu: blank,
              workplaceKz: "Жергілікті кәсіпорын KZ",
            },
            {
              id: "inherited",
              fullNameRu: "Синтетический 3",
              workplaceRu: blank,
              workplaceKz: blank,
            },
          ],
        });
        const created = await createRequest(c, input);
        const resolved = await resolvedRequest(c, created.id);
        assert.deepEqual(
          resolved.draft.items.map((item) => [
            item.workplaceRu,
            item.workplaceKz,
          ]),
          [
            ["Локальное предприятие RU", "Локальное предприятие RU"],
            ["Жергілікті кәсіпорын KZ", "Жергілікті кәсіпорын KZ"],
            [customer.nameRu, customer.nameKz],
          ],
        );
        assert.equal(
          (await requestDetail(c, created.id)).items[0].workplaceKz,
          blank,
        );
        evidence.employerFallback = {
          rawInvisiblePreserved: true,
          resolved: resolved.draft.items.map((item) => ({
            id: item.id,
            ru: item.workplaceRu,
            kz: item.workplaceKz,
          })),
        };
      },
    );
    await t.test(
      "group subset validation reports fourth person, never the valid first person",
      async () => {
        const input = fixture();
        input.items = Array.from({ length: 4 }, (_, index) => ({
          ...structuredClone(input.items[0]),
          id: `person-${index + 1}`,
          fullNameRu: index === 3 ? "" : `Синтетический ${index + 1}`,
          assignments: [
            {
              ...structuredClone(input.items[0].assignments[0]),
              id: `biot-${index + 1}`,
            },
          ],
        }));
        const created = await createRequest(c, input);
        const result = await validateRequest(c, created.id, {
          expectedRevision: created.revision,
        });
        const issues = result.issues.filter(
          (issue) => issue.code === "NAME_REQUIRED",
        );
        assert.ok(issues.length);
        assert.ok(
          issues.every(
            (issue) =>
              issue.rowId === "person-4" && issue.path === "items.3.fullNameRu",
          ),
        );
        assert.ok(
          !result.issues.some(
            (issue) =>
              issue.code === "NAME_REQUIRED" && issue.rowId === "person-1",
          ),
        );
        evidence.groupValidation = issues;
      },
    );
    await t.test(
      "current canonical lexical boundary preserves 80 characters and blocks 81 with stable recipient field",
      async () => {
        const input = fixture();
        input.items[0].fullNameRu = "А".repeat(80);
        const created = await createRequest(c, input);
        const atBoundary = await validateRequest(c, created.id, {
          expectedRevision: created.revision,
        });
        assert.equal(
          atBoundary.issues.some(
            (issue) => issue.code === "PRINT_UNBROKEN_VALUE",
          ),
          false,
        );
        input.items[0].fullNameRu = "А".repeat(81);
        const changed = await patchRequest(c, created.id, {
          expectedRevision: created.revision,
          draft: input,
        });
        const rejected = await validateRequest(c, created.id, {
          expectedRevision: changed.revision,
        });
        const issue = rejected.issues.find(
          (value) => value.code === "PRINT_UNBROKEN_VALUE",
        );
        assert.ok(issue);
        assert.equal(issue.recipientId, "person-1");
        assert.equal(issue.path, "items.0.fullNameRu");
        assert.equal(
          (await requestDetail(c, created.id)).items[0].fullNameRu,
          input.items[0].fullNameRu,
        );
        evidence.canonicalLexicalBoundary = {
          allowed: 80,
          blocked: 81,
          issue,
          originalPreserved: true,
        };
      },
    );
    await t.test(
      "impossible saved calendar date reports stable field and never enqueues a preview",
      async () => {
        await db.issuerProfileVersion.create({
          data: {
            tenantId: c.tenantId,
            version: 1,
            profile: profileSchema.parse({
              nameRu: "СИНТЕТИЧЕСКИЙ центр проверки дат",
              commission: [],
            }),
            createdBy: c.userId,
          },
        });
        const input = fixture();
        input.items[0].assignments[0].documentDate = "2026-02-30";
        input.items[0].assignments[0].fieldOrigins!.documentDate = "MANUAL";
        const created = await createRequest(c, input);
        const validated = await validateRequest(c, created.id, {
          expectedRevision: created.revision,
        });
        const dateIssue = validated.issues.find(
          (issue) =>
            issue.code === "DATE_INVALID" && issue.recipientId === "person-1",
        );
        assert.ok(dateIssue);
        assert.equal(dateIssue.path, "items.0.assignments.0.documentDate");
        assert.equal(dateIssue.assignmentId, "biot-1");
        await assert.rejects(
          preview(c, created.id, {
            expectedRevision: created.revision,
          }),
          (error: any) => {
            assert.equal(error.getStatus(), 422);
            assert.equal(error.getResponse().code, "PREVIEW_VALIDATION");
            assert.ok(
              error
                .getResponse()
                .details.some(
                  (issue: any) =>
                    issue.code === "DATE_INVALID" &&
                    issue.assignmentId === "biot-1",
                ),
            );
            return true;
          },
        );
        assert.equal(
          await db.generationJob.count({ where: { requestId: created.id } }),
          0,
        );
        assert.equal(
          await db.issuance.count({ where: { requestId: created.id } }),
          0,
        );
        evidence.impossibleDate = {
          rawSaved: true,
          issue: dateIssue,
          previewStatus: 422,
          jobs: 0,
          issuances: 0,
        };
      },
    );
  } finally {
    const target = resolve(
      "docs/evidence/operator-flow-full-fix-20261003/domain",
    );
    await mkdir(target, { recursive: true });
    await writeFile(
      resolve(target, "api-readback.json"),
      JSON.stringify(evidence, null, 2),
    );
    // Keep the isolated synthetic records: immutable audit/proposal history is
    // part of the proof and must not be disabled or deleted for cleanup.
    await db.$disconnect();
  }
});

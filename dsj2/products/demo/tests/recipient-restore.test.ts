import test from "node:test";
import assert from "node:assert/strict";
import {
  applyBusinessRules,
  draftSchema,
  patchSchema,
  type Draft,
} from "../packages/contracts/src";
import { recipientRestoreBaseline } from "../apps/api/src/recipient-restore";
import { protectOutcomeMetadata } from "../apps/api/src/requests";
import type { Context } from "../apps/api/src/core";

const context: Context = {
  tenantId: "center",
  userId: "current-user",
  role: "OPERATOR",
  sessionId: "test",
  csrfHash: "test",
  correlationId: "test",
};
const outcome = {
  status: "PASSED" as const,
  source: "Синтетическая исходная ведомость",
  confirmedBy: "original-user",
  confirmedAt: "2026-10-01T01:02:03.000Z",
};
function fixture(): Draft {
  return applyBusinessRules(
    draftSchema.parse({
      kind: "COMPANY",
      schemaVersion: 2,
      organizationSnapshots: [],
      commonFields: { documentDate: "2026-10-05" },
      events: [
        {
          id: "legacy-event",
          title: "Синтетический курс",
          protocolTemplateId: "ptm-protocol",
          protocolMode: "GROUP",
          protocolModeSource: "AUTO",
          commonFields: {
            trainingSubject: "Синтетическая программа",
            protocolDate: "2026-10-05",
          },
        },
      ],
      items: [0, 1].map((index) => ({
        id: `legacy-row-${index}`,
        fullNameRu: `Синтетический ${index}`,
        fullNameKz: `Синтетикалық ${index}`,
        positionRu: "Слесарь",
        assignments: [
          {
            id: `legacy-assignment-${index}`,
            eventId: "legacy-event",
            templateId: "ptm-card",
            result: "Сдал",
            resultKz: "Тапсырды",
            outcome,
            fieldOrigins: { result: "MANUAL", trainingSubject: "CLEARED" },
          },
        ],
      })),
    }),
  );
}
function deletion(before = fixture()) {
  const current = applyBusinessRules({
    ...structuredClone(before),
    items: before.items.slice(1),
  });
  const proposal = {
    tenantId: "center",
    requestId: "request",
    revision: 7,
    operation: "SAVE",
    status: "DRAFT",
    before,
    payload: current,
  };
  return {
    tenantId: "center",
    requestId: "request",
    revision: 7,
    rowId: before.items[0].id,
    current,
    incoming: structuredClone(before),
    proposal,
  };
}
const conflict = (error: unknown) => {
  assert.equal(
    (error as { getResponse(): { code: string } }).getResponse().code,
    "RECIPIENT_RESTORE_CONFLICT",
  );
  return true;
};

test("committed recipient restore preserves exact raw facts and original trusted confirmation across AUTO group changes", () => {
  const input = deletion();
  assert.equal(input.proposal.before.events?.[0].protocolMode, "GROUP");
  assert.equal(input.current.events?.[0].protocolMode, "INDIVIDUAL");
  const baseline = recipientRestoreBaseline(input);
  protectOutcomeMetadata(context, input.incoming, baseline);
  assert.deepEqual(input.incoming, input.proposal.before);
  assert.deepEqual(applyBusinessRules(input.incoming), input.proposal.before);
});

test("restore ignores forged confirmation actor and timestamp and retains the server copy", () => {
  const input = deletion();
  for (const row of input.incoming.items)
    for (const assignment of row.assignments) {
      assignment.outcome!.confirmedBy = "attacker";
      assignment.outcome!.confirmedAt = "2099-01-01T00:00:00.000Z";
    }
  protectOutcomeMetadata(
    context,
    input.incoming,
    recipientRestoreBaseline(input),
  );
  assert.deepEqual(input.incoming, input.proposal.before);
});

test("recipient restore rejects mixed result, outcome, identity and context changes", () => {
  const mutations: Array<(draft: Draft) => void> = [
    (d) => {
      d.items[0].assignments[0].result = "Другой результат";
    },
    (d) => {
      d.items[0].assignments[0].outcome!.source = "Другая ведомость";
    },
    (d) => {
      d.items[0].assignments[0].outcome!.status = "FAILED";
    },
    (d) => {
      d.items[0].assignments[0].biotKnowledgeResult = "NO";
    },
    (d) => {
      d.items[0].assignments[0].biotProctoringResult = "NO";
    },
    (d) => {
      d.items[0].assignments[0].eventId = "another-event";
    },
    (d) => {
      d.items[0].assignments[0].id = "another-assignment";
    },
    (d) => {
      d.items[1].positionRu = "Другая должность";
    },
    (d) => {
      d.commonFields!.documentDate = "2026-11-01";
    },
    (d) => {
      d.profileVersionId = "other-profile";
    },
  ];
  for (const mutate of mutations) {
    const input = deletion();
    mutate(input.incoming);
    assert.throws(() => recipientRestoreBaseline(input), conflict);
  }
});

test("restore requires exact same tenant, request, revision and immutable deletion payload", () => {
  for (const change of [
    { tenantId: "other" },
    { requestId: "other" },
    { revision: 6 },
    { operation: "ARCHIVE" },
    { status: "PENDING" },
  ]) {
    const input = deletion();
    Object.assign(input.proposal, change);
    assert.throws(() => recipientRestoreBaseline(input), conflict);
  }
  const absent = deletion();
  assert.throws(
    () => recipientRestoreBaseline({ ...absent, proposal: null }),
    conflict,
  );
  const unrelated = deletion();
  unrelated.current.title = "Изменённый контекст";
  assert.throws(() => recipientRestoreBaseline(unrelated), conflict);
  const mixedDeletion = deletion();
  mixedDeletion.current.items[0].positionRu = "Изменено при удалении";
  assert.throws(() => recipientRestoreBaseline(mixedDeletion), conflict);
});

test("fast restore of a row still on the server preserves metadata without history and rejects mixed edits", () => {
  const current = fixture();
  const input = {
    ...deletion(),
    current,
    incoming: structuredClone(current),
    proposal: null,
  };
  input.incoming.items[0].assignments[0].outcome!.confirmedAt =
    "2099-01-01T00:00:00.000Z";
  protectOutcomeMetadata(
    context,
    input.incoming,
    recipientRestoreBaseline(input),
  );
  assert.deepEqual(input.incoming, current);
  input.incoming.items[1].positionRu = "Другой ввод";
  assert.throws(() => recipientRestoreBaseline(input), conflict);
});

test("ordinary result edits still get a fresh server confirmation and generic patch is unchanged", () => {
  const before = fixture();
  const edited = structuredClone(before);
  edited.items[0].assignments[0].result = "Сдал повторную проверку";
  const started = Date.now();
  protectOutcomeMetadata(context, edited, before);
  const saved = edited.items[0].assignments[0].outcome!;
  assert.equal(saved.confirmedBy, context.userId);
  assert.ok(Date.parse(saved.confirmedAt!) >= started);
  assert.deepEqual(edited.items[1], before.items[1]);
  assert.equal(
    patchSchema.parse({ expectedRevision: 7, draft: before })
      .restoreRecipientId,
    undefined,
  );
  assert.equal(
    patchSchema.parse({
      expectedRevision: 7,
      draft: before,
      restoreRecipientId: "legacy-row-0",
    }).restoreRecipientId,
    "legacy-row-0",
  );
});

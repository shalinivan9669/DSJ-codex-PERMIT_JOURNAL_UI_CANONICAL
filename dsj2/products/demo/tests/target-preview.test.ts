import test from "node:test";
import assert from "node:assert/strict";
import {
  draftSchema,
  finalizeSchema,
  previewSchema,
  profileSchema,
  resolveDraft,
  validateBusinessRules,
} from "../packages/contracts/src";
import {
  previewIssueApplies,
  previewScope,
} from "../apps/api/src/preview-scope";
import { withCustomerIdentity } from "../apps/api/src/request-customer";

test("preview target is an additive strict identity contract and cannot change finalization", () => {
  const basis = { expectedRevision: 7 };
  assert.deepEqual(previewSchema.parse(basis), basis);
  assert.ok(
    previewSchema.safeParse({
      ...basis,
      target: { kind: "ASSIGNMENT", rowId: "row", assignmentId: "assignment" },
    }).success,
  );
  assert.ok(
    previewSchema.safeParse({
      ...basis,
      target: { kind: "GROUP_PROTOCOL", eventId: "event" },
    }).success,
  );
  for (const target of [
    { kind: "ASSIGNMENT", rowId: "row", templateId: "ptm-card" },
    {
      kind: "ASSIGNMENT",
      rowId: "row",
      assignmentId: "assignment",
      tenantId: "foreign",
    },
    { kind: "GROUP_PROTOCOL", eventId: "event", fullNameRu: "Injected" },
  ])
    assert.equal(previewSchema.safeParse({ ...basis, target }).success, false);
  assert.equal(
    previewSchema.safeParse({ ...basis, proposalId: "p" }).success,
    false,
  );
  assert.equal(
    previewSchema.safeParse({ ...basis, expectedProposalHash: "a".repeat(64) })
      .success,
    false,
  );
  assert.equal(
    finalizeSchema.safeParse({
      ...basis,
      target: { kind: "GROUP_PROTOCOL", eventId: "event" },
    }).success,
    false,
  );
});

test("target scope retains selected course dependencies and manual period without hiding an incomplete recipient", () => {
  const source = draftSchema.parse({
    kind: "PERSON",
    schemaVersion: 2,
    items: [
      {
        id: "blank-person",
        assignments: [
          {
            id: "card",
            templateId: "ps-card",
            trainingStart: "2026-09-01",
            trainingEnd: "2026-09-12",
          },
          {
            id: "witness",
            templateId: "ps-witness",
            trainingStart: "2026-09-03",
            trainingEnd: "2026-09-14",
            fieldOrigins: { trainingStart: "MANUAL", trainingEnd: "MANUAL" },
          },
          { id: "protocol", templateId: "ps-protocol" },
          { id: "other-course", templateId: "pb-card" },
        ],
      },
    ],
  });
  const original = structuredClone(source);
  const selected = previewScope(source, {
    kind: "ASSIGNMENT",
    rowId: "blank-person",
    assignmentId: "witness",
  });
  assert.deepEqual(
    selected.items[0].assignments.map((assignment) => assignment.id),
    ["card", "witness", "protocol"],
  );
  const resolved = resolveDraft(selected);
  assert.equal(
    resolved.draft.items[0].assignments[1].trainingStart,
    "2026-09-03",
  );
  assert.equal(
    resolved.draft.items[0].assignments[1].trainingEnd,
    "2026-09-14",
  );
  assert.deepEqual(source, original);
});

test("request identity preserves historical and generic titles for separately computed display names", () => {
  const source = draftSchema.parse({
    kind: "PERSON",
    title: "Ручное историческое название",
    items: [{ id: "person", fullNameRu: "Синтетическое Имя", assignments: [] }],
  });
  assert.equal(withCustomerIdentity(source).title, source.title);
  for (const title of [
    "",
    "Новая заявка",
    "Новая заявка на человека",
    "Новая заявка организации",
  ])
    assert.equal(withCustomerIdentity({ ...source, title }).title, title);
});

test("personal preview keeps selected event issuer validation while excluding other event and group-only fields", () => {
  const draft = draftSchema.parse({
    kind: "PERSON",
    schemaVersion: 2,
    businessRuleVersion: "LIVE_V1",
    englishAppendix: true,
    events: [
      {
        id: "selected-event",
        title: "Selected course",
        protocolTemplateId: "ptm-protocol",
        commonFields: {},
      },
    ],
    items: [
      {
        id: "person",
        assignments: [
          { id: "card", templateId: "ptm-card", eventId: "selected-event" },
        ],
      },
    ],
  });
  // This is the same dependency issue produced for a pinned event profile by
  // requests.validation(), rather than an invented group-field error.
  const issuerIssue = validateBusinessRules(
    { ...draft, items: [] },
    profileSchema.parse({
      nameRu: "Синтетический центр",
      approved: true,
      commission: [],
    }),
  ).find((issue) => issue.code === "ENGLISH_ISSUER_REQUIRED");
  assert.ok(issuerIssue);
  const target = {
    kind: "ASSIGNMENT" as const,
    rowId: "person",
    assignmentId: "card",
  };
  assert.equal(
    previewIssueApplies(draft, target, {
      ...issuerIssue,
      path: `events.selected-event.${issuerIssue.path}`,
    }),
    true,
  );
  assert.equal(
    previewIssueApplies(draft, target, {
      ...issuerIssue,
      path: `events.other-event.${issuerIssue.path}`,
    }),
    false,
  );
  assert.equal(
    previewIssueApplies(draft, target, {
      code: "GROUP_PROTOCOL_REQUIRED",
      path: "events.selected-event.protocolDate",
      message: "Missing group-only field",
    }),
    false,
  );
});

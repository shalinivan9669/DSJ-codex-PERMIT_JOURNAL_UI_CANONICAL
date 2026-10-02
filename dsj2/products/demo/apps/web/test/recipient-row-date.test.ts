import test from "node:test";
import assert from "node:assert/strict";
import { applyBusinessRules, resolveDraft, draftSchema } from "@demo/contracts";
import {
  recipientRowDate,
  editRecipientRowDate,
} from "../lib/recipient-row-date";
import { newAssignment, newRecipient, type Recipient } from "../lib/types";

test("row edits inherited issue date without creating a personal protocol date or replacing results", () => {
  const item = {
    ...newRecipient(),
    assignments: [
      {
        ...newAssignment("ptm-card"),
        id: "card",
        eventId: "training",
        documentDate: "",
        outcome: { status: "PASSED" as const, source: "Synthetic test" },
      },
      {
        ...newAssignment("ptm-protocol"),
        id: "protocol",
        eventId: "training",
        documentDate: "",
      },
    ],
  };
  const draft = draftSchema.parse({
    kind: "PERSON",
    schemaVersion: 2,
    businessRuleVersion: "LIVE_V1",
    commonFields: { documentDate: "2026-10-02" },
    items: [item],
  });
  const resolved = resolveDraft(draft).draft.items[0];
  assert.deepEqual(recipientRowDate(item, resolved), {
    kind: "single",
    value: "2026-10-02",
  });
  const next = editRecipientRowDate(item, resolved, "2026-10-05");
  assert.equal(next.assignments[0].documentDate, "2026-10-05");
  assert.equal(next.assignments[0].fieldOrigins?.documentDate, "MANUAL");
  assert.equal(next.assignments[0].protocolDate, "");
  assert.equal(next.assignments[1].protocolDate, "");
  assert.equal(next.assignments[1].fieldOrigins?.protocolDate, undefined);
  assert.deepEqual(next.assignments[0].outcome, item.assignments[0].outcome);
  assert.equal(item.assignments[0].documentDate, "");
});

for (const origin of ["MANUAL", "IMPORTED"] as const) {
  test(`row issue date preserves an equal ${origin} protocol date after normalization`, () => {
    const item: Recipient = {
      ...newRecipient(),
      assignments: [
        {
          ...newAssignment("ptm-card"),
          id: "card",
          eventId: "training",
          documentDate: "2026-10-02",
          protocolDate: "2026-10-02",
          fieldOrigins: { protocolDate: origin },
        },
        {
          ...newAssignment("ptm-protocol"),
          id: "protocol",
          eventId: "training",
          documentDate: "2026-10-02",
          protocolDate: "2026-10-02",
          fieldOrigins: { documentDate: origin, protocolDate: origin },
        },
      ],
    };
    const next = editRecipientRowDate(item, item, "2026-10-05");
    assert.deepEqual(next.assignments[1], item.assignments[1]);
    const normalized = applyBusinessRules(
      draftSchema.parse({ kind: "PERSON", items: [next] }),
    );
    const card = normalized.items[0].assignments.find(
      (entry) => entry.id === "card",
    )!;
    const protocol = normalized.items[0].assignments.find(
      (entry) => entry.id === "protocol",
    )!;
    assert.equal(card.documentDate, "2026-10-05");
    assert.equal(card.protocolDate, "2026-10-02");
    assert.equal(card.fieldOrigins?.protocolDate, origin);
    assert.equal(protocol.documentDate, "2026-10-02");
    assert.equal(protocol.fieldOrigins?.protocolDate, origin);
    assert.deepEqual(recipientRowDate(next, normalized.items[0]), {
      kind: "single",
      value: "2026-10-05",
    });
  });
}

test("row issue date leaves the common group protocol date and another participant unchanged", () => {
  const item = {
    ...newRecipient(),
    assignments: [
      {
        ...newAssignment("ptm-card"),
        id: "card",
        eventId: "training",
        documentDate: "2026-10-02",
        protocolMode: "GROUP" as const,
      },
    ],
  };
  const other = {
    ...item,
    id: "other",
    assignments: [{ ...item.assignments[0], id: "other-card" }],
  };
  const draft = draftSchema.parse({
    kind: "COMPANY",
    items: [item, other],
    events: [
      {
        id: "training",
        title: "PTM",
        revision: 0,
        protocolTemplateId: "ptm-protocol",
        protocolMode: "GROUP",
        protocolModeSource: "MANUAL",
        commonFields: {
          documentDate: "2026-10-02",
          protocolDate: "2026-10-01",
        },
      },
    ],
  });
  const before = structuredClone(draft);
  const next = editRecipientRowDate(
    draft.items[0],
    resolveDraft(draft).draft.items[0],
    "2026-10-05",
  );
  const normalized = applyBusinessRules({
    ...draft,
    items: [next, draft.items[1]],
  });
  assert.equal(normalized.items[0].assignments[0].documentDate, "2026-10-05");
  assert.equal(normalized.items[1].assignments[0].documentDate, "2026-10-02");
  assert.equal(normalized.events?.[0].commonFields.protocolDate, "2026-10-01");
  assert.deepEqual(draft, before);
});

test("mixed event dates including a missing date cannot be overwritten from the single-date row", () => {
  const item = {
    ...newRecipient(),
    assignments: [
      {
        ...newAssignment("ptm-card"),
        id: "a",
        eventId: "a",
        documentDate: "2026-10-02",
      },
      {
        ...newAssignment("pb-card"),
        id: "b",
        eventId: "b",
        documentDate: "2026-10-03",
      },
    ],
  };
  assert.equal(recipientRowDate(item).kind, "mixed");
  assert.equal(editRecipientRowDate(item, item, "2026-10-05"), item);
  item.assignments[1].documentDate = "";
  assert.equal(recipientRowDate(item).kind, "mixed");
  assert.equal(editRecipientRowDate(item, item, "2026-10-05"), item);
});

test("clearing records explicit clearing, while empty and protocol-only rows stay unchanged", () => {
  const item = {
    ...newRecipient(),
    assignments: [{ ...newAssignment("ptm-card"), documentDate: "2026-10-02" }],
  };
  const next = editRecipientRowDate(item, item, "");
  assert.equal(next.assignments[0].fieldOrigins?.documentDate, "CLEARED");
  for (const assignments of [
    [],
    [{ ...newAssignment("ptm-protocol"), documentDate: "2026-10-02" }],
  ]) {
    const protocolOnlyOrEmpty = { ...item, assignments };
    assert.equal(recipientRowDate(protocolOnlyOrEmpty).kind, "none");
    assert.equal(
      editRecipientRowDate(
        protocolOnlyOrEmpty,
        protocolOnlyOrEmpty,
        "2026-10-05",
      ),
      protocolOnlyOrEmpty,
    );
  }
});

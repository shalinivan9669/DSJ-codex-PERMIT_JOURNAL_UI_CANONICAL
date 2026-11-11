import assert from "node:assert/strict";
import test from "node:test";
import { ownPendingSigningDocuments } from "../lib/signing-batch";
import type { SigningPerson } from "../lib/signing-flow";

type Document = {
  id: string;
  artifactId: string | null;
  complete: boolean;
  paperSignature?: { signedAt: string } | null;
  requiredSigners: SigningPerson[];
};

function signer(overrides: Partial<SigningPerson> = {}): SigningPerson {
  return {
    kind: "DIRECTOR",
    displayName: "Одинаковое имя не даёт полномочий",
    bindingId: "own-director-binding",
    bindingState: "ACTIVE",
    canSign: true,
    signed: false,
    ...overrides,
  };
}

function document(id: string, overrides: Partial<Document> = {}): Document {
  return {
    id,
    artifactId: `pdf-${id}`,
    complete: false,
    requiredSigners: [signer()],
    ...overrides,
  };
}

test("batch offers only own unsigned electronic documents with an available PDF", () => {
  const ownCard = document("own-card");
  const ownProtocol = document("own-protocol", {
    requiredSigners: [
      signer({ canSign: false, bindingId: "other-director" }),
      signer({ kind: "TEACHER", bindingId: "own-teacher" }),
    ],
  });
  const documents = [
    document("other-person", { requiredSigners: [signer({ canSign: false })] }),
    ownCard,
    document("complete", { complete: true }),
    document("paper", { paperSignature: { signedAt: "2026-11-11" } }),
    document("signed", { requiredSigners: [signer({ signed: true })] }),
    document("pdf-pending", { artifactId: null }),
    document("pdf-empty", { artifactId: "" }),
    document("exempt", { requiredSigners: [] }),
    ownProtocol,
  ];
  assert.deepEqual(ownPendingSigningDocuments(documents), [
    ownCard,
    ownProtocol,
  ]);
});

test("missing or revoked bindings cannot make a document eligible despite stale canSign", () => {
  const documents = [
    ...[null, undefined, ""].map((bindingId, i) =>
      document(`missing-id-${i}`, { requiredSigners: [signer({ bindingId })] }),
    ),
    document("missing-binding", {
      requiredSigners: [signer({ bindingState: "MISSING" })],
    }),
    document("revoked-binding", {
      requiredSigners: [signer({ bindingState: "REVOKED" })],
    }),
  ];
  assert.deepEqual(ownPendingSigningDocuments(documents), []);
  const activeSecondCapacity = document("active-second-capacity", {
    requiredSigners: [
      signer({ bindingState: "REVOKED" }),
      signer({ kind: "CHAIR", bindingId: "own-active-chair" }),
    ],
  });
  assert.deepEqual(ownPendingSigningDocuments([activeSecondCapacity]), [
    activeSecondCapacity,
  ]);
});

test("one document remains selectable for another own capacity after the first is signed", () => {
  const remainingCapacity = document("one-person-several-capacities", {
    requiredSigners: [
      signer({ signed: true, canSign: false }),
      signer({ kind: "CHAIR", bindingId: "own-chair" }),
      signer({ kind: "TEACHER", bindingId: "own-teacher" }),
      signer({ kind: "MEMBER", bindingId: "other-member", canSign: false }),
    ],
  });
  const found = ownPendingSigningDocuments([remainingCapacity]);
  assert.equal(
    found.length,
    1,
    "document count is not the number of own roles",
  );
  assert.equal(found[0], remainingCapacity);
  assert.deepEqual(
    found[0].requiredSigners.map((entry) => entry.kind),
    ["DIRECTOR", "CHAIR", "TEACHER", "MEMBER"],
    "selection does not rewrite the frozen signer roster",
  );
  const onlyOthersPending = document("only-others-pending", {
    requiredSigners: [
      signer({ signed: true, canSign: false }),
      signer({ kind: "CHAIR", bindingId: "other-chair", canSign: false }),
    ],
  });
  assert.deepEqual(ownPendingSigningDocuments([onlyOthersPending]), []);
});

test("selection is stable and does not mutate records, including legacy active bindings", () => {
  const first = document("z-first", {
    paperSignature: null,
    requiredSigners: [signer({ bindingState: undefined })],
  });
  const second = document("a-second");
  const source = Object.freeze([first, second]);
  for (const entry of source) {
    entry.requiredSigners.forEach(Object.freeze);
    Object.freeze(entry.requiredSigners);
    Object.freeze(entry);
  }
  const result = ownPendingSigningDocuments(source);
  assert.deepEqual(result, [first, second]);
  assert.notEqual(result, source);
  assert.deepEqual(ownPendingSigningDocuments([]), []);
});

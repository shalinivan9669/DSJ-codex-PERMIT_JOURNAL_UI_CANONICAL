import test from "node:test";
import assert from "node:assert/strict";
import {
  signersFor,
  assertSigningPolicy,
  connectorUrl,
} from "../apps/api/src/signing";
import { proposalDiff } from "../apps/api/src/approvals";

function signer(id: string, kind: "DIRECTOR" | "CHAIR" | "MEMBER") {
  return {
    kind,
    bindingId: id,
    displayName: id,
    userId: id,
    iin: "000000000001",
    bin: null,
  };
}
function policy() {
  const director = signer("director", "DIRECTOR");
  return {
    version: 2 as const,
    signers: [director],
    head: director,
    commission: [
      signer("chair", "CHAIR"),
      signer("member1", "MEMBER"),
      signer("member2", "MEMBER"),
    ],
  };
}
function errorCode(code: string) {
  return (error: unknown) => {
    assert.equal(
      (error as { getResponse: () => { code: string } }).getResponse().code,
      code,
    );
    return true;
  };
}
test("restored forms require the exact source signers plus director policy", () => {
  const selected = policy();
  const expected: Record<string, string[]> = {
    "biot-worker-card": ["director", "chair", "member1"],
    "biot-itr-certificate": ["director", "chair"],
    "pb-card": ["director", "chair"],
    "ps-witness": ["director", "chair"],
    "ptm-card": ["director"],
    "ps-card": ["director", "chair", "member1", "member2"],
  };
  for (const templateId of [
    "biot-protocol",
    "biot-itr-protocol",
    "ptm-protocol",
    "pb-protocol",
    "ps-protocol",
  ])
    expected[templateId] = ["director", "chair", "member1", "member2"];
  for (const [templateId, bindings] of Object.entries(expected)) {
    assert.deepEqual(
      signersFor(selected, templateId).map((value) => value.bindingId),
      bindings,
    );
    assert.doesNotThrow(() => assertSigningPolicy(selected, [{ templateId }]));
  }
  assert.throws(
    () => signersFor(selected, "unknown-card"),
    errorCode("SIGNING_TEMPLATE_UNSUPPORTED"),
  );
});
test("training-specific profile head and commission survive frozen signer selection", () => {
  const selected = {
    ...policy(),
    assignmentEvents: { assignment: "event" },
    eventCommission: {
      event: [
        signer("event-chair", "CHAIR"),
        signer("event-member1", "MEMBER"),
        signer("event-member2", "MEMBER"),
      ],
    },
    eventHead: { event: signer("event-head", "CHAIR") },
  };
  assert.deepEqual(
    signersFor(selected, "pb-card", "assignment").map(
      (value) => value.bindingId,
    ),
    ["director", "event-chair"],
  );
  assert.deepEqual(
    signersFor(selected, "ptm-card", "assignment").map(
      (value) => value.bindingId,
    ),
    ["director", "event-head"],
  );
  assert.deepEqual(
    signersFor(selected, "pb-protocol", null, "event").map(
      (value) => value.bindingId,
    ),
    ["director", "event-chair", "event-member1", "event-member2"],
  );
});
test("a missing or older incomplete signing policy cannot silently omit commission slots", () => {
  const incomplete = {
    version: 1 as const,
    signers: [signer("director", "DIRECTOR")],
    commission: [],
  };
  assert.equal(
    signersFor(incomplete, "pb-protocol").filter((value) => !value.bindingId)
      .length,
    3,
  );
  assert.equal(
    signersFor(incomplete, "biot-worker-card").filter(
      (value) => !value.bindingId,
    ).length,
    2,
  );
  assert.equal(
    signersFor(incomplete, "ptm-card").filter((value) => !value.bindingId)
      .length,
    1,
  );
  assert.throws(
    () => assertSigningPolicy(incomplete, [{ templateId: "pb-protocol" }]),
    errorCode("SIGNATORY_CONFIGURATION_REQUIRED"),
  );
  assert.throws(
    () =>
      assertSigningPolicy({ ...incomplete, signers: [] }, [
        { templateId: "pb-card" },
      ]),
    errorCode("SIGNATORY_CONFIGURATION_REQUIRED"),
  );
});
test("proposal comparison exposes exact field, array and removal changes without ordering noise", () => {
  const before = {
    title: "A",
    items: [{ name: "First", position: "Old" }, { name: "Second" }],
  };
  const after = { items: [{ position: "New", name: "First" }], title: "A" };
  assert.deepEqual(proposalDiff(before, after), [
    { path: "items[0].position", before: "Old", after: "New" },
    { path: "items[1]", before: { name: "Second" }, after: null },
  ]);
  assert.deepEqual(proposalDiff({ a: 1, b: 2 }, { b: 2, a: 1 }), []);
});
test("connector configuration refuses credential-bearing and insecure remote URLs", () => {
  for (const value of [
    "http://remote.example",
    "file:///tmp/test",
    "https://user:secret@example.com",
    "https://example.com?token=x",
    "https://example.com#fragment",
    "invalid",
  ])
    assert.equal(connectorUrl(value), null);
  assert.equal(
    connectorUrl("https://example.com/adapter/"),
    "https://example.com/adapter",
  );
});

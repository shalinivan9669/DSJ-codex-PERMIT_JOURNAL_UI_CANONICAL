import test from "node:test";
import assert from "node:assert/strict";
import type { Prisma } from "@demo/database";
import type { Context } from "../apps/api/src/core";
import {
  prepareSigningPolicy,
  signersFor,
  assertSigningPolicy,
} from "../apps/api/src/signing";

const c = {
  tenantId: "synthetic",
  userId: "director",
  role: "DIRECTOR",
} as Context;
const bindings = [
  {
    id: "director",
    kind: "DIRECTOR",
    displayName: "Директор",
    userId: "director",
    iin: "000000000001",
    bin: null,
  },
  {
    id: "chair",
    kind: "CHAIR",
    displayName: "Председатель",
    userId: "chair",
    iin: "000000000002",
    bin: null,
  },
  {
    id: "teacher",
    kind: "TEACHER",
    displayName: "Преподаватель группы",
    userId: "teacher",
    iin: "000000000003",
    bin: null,
  },
];
const staff = bindings.map((binding) => ({
  id: binding.userId,
  role: binding.kind === "DIRECTOR" ? "DIRECTOR" : "OPERATOR",
}));
const fake = (selected = bindings) =>
  ({
    signatoryBinding: { findMany: async () => selected },
    user: { findMany: async () => staff },
  }) as unknown as Prisma.TransactionClient;
const profile = {
  headName: "Директор",
  commission: [{ name: "Председатель" }],
  people: [{ name: "Преподаватель группы", role: "TEACHER" }],
};
const manualTemplates = [
  "biot-worker-card",
  "biot-itr-certificate",
  "biot-protocol",
  "biot-itr-protocol",
  "pb-card",
  "pb-protocol",
  "ptm-card",
  "ptm-protocol",
];

test("new BIOT, PB and PTM credentials and protocols require explicit director, chair and teacher identities", async () => {
  const policy = await prepareSigningPolicy(fake(), c, profile);
  assert.equal(policy.version, 3);
  for (const templateId of manualTemplates) {
    assert.deepEqual(
      signersFor(policy, templateId).map((signer) => signer.bindingId),
      ["director", "chair", "teacher"],
    );
    assert.doesNotThrow(() => assertSigningPolicy(policy, [{ templateId }]));
  }
  // Older saved policies retain their original source-form interpretation.
  for (const version of [1, 2] as const) {
    const frozenOld = { ...policy, version };
    assert.deepEqual(
      signersFor(frozenOld, "pb-card").map((signer) => signer.bindingId),
      ["director", "chair"],
    );
    assert.deepEqual(
      signersFor(frozenOld, "ptm-card").map((signer) => signer.bindingId),
      ["director"],
    );
    for (const templateId of ["pb-protocol", "ptm-protocol"])
      assert.equal(signersFor(frozenOld, templateId).length, 4);
  }
});

test("one shared protocol uses the group's teacher once, regardless of recipient count", async () => {
  const other = {
    ...bindings[2],
    id: "other-teacher",
    userId: "chair",
    displayName: "Другой преподаватель",
  };
  const policy = await prepareSigningPolicy(
    fake([...bindings, other]),
    c,
    profile,
    [
      {
        id: "group",
        profile: {
          ...profile,
          people: [{ name: other.displayName, role: "TEACHER" }],
        },
      },
    ],
    Array.from({ length: 20 }, (_, index) => ({
      id: `row-${index}`,
      eventId: "group",
      templateId: "pb-card",
    })),
  );
  for (const templateId of manualTemplates) {
    assert.deepEqual(
      signersFor(policy, templateId, null, "group").map(
        (signer) => signer.bindingId,
      ),
      ["director", "chair", "other-teacher"],
    );
    assert.deepEqual(
      signersFor(policy, templateId, "row-19").map(
        (signer) => signer.bindingId,
      ),
      ["director", "chair", "other-teacher"],
    );
  }
});

test("missing or ambiguous teacher never silently substitutes a commission member or blocks preparing a printable policy", async () => {
  for (const selected of [
    bindings.slice(0, 2),
    [...bindings, { ...bindings[2], id: "ambiguous" }],
  ]) {
    const policy = await prepareSigningPolicy(fake(selected), c, profile);
    for (const templateId of manualTemplates) {
      assert.equal(signersFor(policy, templateId)[2].bindingId, null);
      assert.throws(
        () => assertSigningPolicy(policy, [{ templateId }]),
        (error: unknown) => {
          assert.equal(
            (error as { getResponse(): { code: string } }).getResponse().code,
            "SIGNATORY_CONFIGURATION_REQUIRED",
          );
          return true;
        },
      );
    }
  }
});

test("v3 group cards and protocols retain the selected profile head instead of substituting the tenant director", async () => {
  const policy = await prepareSigningPolicy(
    fake(),
    c,
    profile,
    [
      {
        id: "other-group",
        profile: { ...profile, headName: "Другой директор" },
      },
    ],
    [{ id: "row", eventId: "other-group", templateId: "pb-card" }],
  );
  for (const templateId of manualTemplates) {
    for (const signer of [
      signersFor(policy, templateId, "row")[0],
      signersFor(policy, templateId, null, "other-group")[0],
    ]) {
      assert.equal(signer.kind, "DIRECTOR");
      assert.equal(signer.displayName, "Другой директор");
      assert.equal(signer.bindingId, null);
    }
    assert.throws(() =>
      assertSigningPolicy(policy, [
        { templateId, groupEventId: "other-group" },
      ]),
    );
    assert.equal(signersFor(policy, templateId)[0].bindingId, "director");
  }
  const frozenOld = { ...policy, version: 2 as const };
  assert.equal(
    signersFor(frozenOld, "pb-card", "row")[0].bindingId,
    "director",
  );
  assert.equal(
    signersFor(frozenOld, "pb-protocol", null, "other-group")[0].bindingId,
    "director",
  );
});

test("v3 uses a frozen event director binding and cannot promote another signing capacity to director", async () => {
  const policy = await prepareSigningPolicy(fake(), c, profile);
  const eventDirector = {
    ...policy.head!,
    bindingId: "event-director",
    displayName: "Директор выбранного профиля",
  };
  const selected = {
    ...policy,
    assignmentEvents: { row: "group" },
    eventHead: { group: eventDirector },
  };
  assert.equal(signersFor(selected, "pb-card", "row")[0], eventDirector);
  assert.equal(
    signersFor(selected, "pb-protocol", null, "group")[0],
    eventDirector,
  );
  for (const kind of ["CHAIR", "MEMBER", "TEACHER"] as const) {
    const invalid = {
      ...selected,
      eventHead: { group: { ...eventDirector, kind } },
    };
    const required = signersFor(invalid, "pb-card", "row")[0];
    assert.equal(required.kind, "DIRECTOR");
    assert.equal(required.displayName, eventDirector.displayName);
    assert.equal(required.bindingId, null);
  }
});

test("v3 base documents retain their profile head when its director mapping is missing", async () => {
  const policy = await prepareSigningPolicy(fake(), c, {
    ...profile,
    headName: "Неназначенный директор",
  });
  const required = signersFor(policy, "pb-card")[0];
  assert.equal(required.displayName, "Неназначенный директор");
  assert.equal(required.bindingId, null);
});

test("the director and teacher may share a person while preserving both explicit signing capacities", async () => {
  const shared = { ...bindings[2], userId: "director", iin: bindings[0].iin };
  const policy = await prepareSigningPolicy(
    fake([bindings[0], bindings[1], shared]),
    c,
    profile,
  );
  const signers = signersFor(policy, "pb-card");
  assert.equal(signers[0].userId, signers[2].userId);
  assert.notEqual(signers[0].bindingId, signers[2].bindingId);
  assert.equal(signers.length, 3);
});

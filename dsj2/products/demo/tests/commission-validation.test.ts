import test from "node:test";
import assert from "node:assert/strict";
import {
  draftSchema,
  profileSchema,
  validateDraft,
  type IssuerProfile,
} from "../packages/contracts/src";

const profile = profileSchema.parse({
  nameRu: "Синтетический учебный центр",
  approved: true,
  commission: ["Председатель", "Первый член", "Второй член"].map((name) => ({
    name,
    position: "",
  })),
});

function commissionIssues(commission: IssuerProfile["commission"]) {
  const draft = draftSchema.parse({
    kind: "PERSON",
    items: [
      {
        id: "recipient",
        assignments: [
          {
            id: "protocol",
            templateId: "biot-protocol",
            biotCategory: "WORKER",
          },
        ],
      },
    ],
  });
  return validateDraft(draft, { ...profile, commission }).filter(
    (issue) => issue.code === "BIOT_COMMISSION_REQUIRED",
  );
}

test("BiOT protocol requires a named chair and at least two named members", () => {
  for (const size of [0, 1, 2])
    assert.equal(commissionIssues(profile.commission.slice(0, size)).length, 1);
  assert.deepEqual(commissionIssues(profile.commission), []);
  assert.deepEqual(
    commissionIssues([
      ...profile.commission,
      { name: "Третий член", position: "" },
    ]),
    [],
  );
});

test("blank names in stored commissions produce an actionable issue without rewriting the source", () => {
  for (const name of ["", "   ", "\t\n", "\u00a0", "\u200b\u2060"]) {
    for (const index of [0, 1, 2]) {
      const commission = profile.commission.map((member, current) => ({
        ...member,
        name: current === index ? name : member.name,
      }));
      const before = JSON.stringify(commission);
      const [issue] = commissionIssues(commission);
      assert.ok(issue, `Missing issue for blank commission slot ${index}`);
      assert.equal(issue.path, "issuer.commission");
      assert.equal(JSON.stringify(commission), before);
    }
  }
  // Old stored versions remain readable so their data can be repaired in the UI.
  assert.doesNotThrow(() =>
    profileSchema.parse({
      ...profile,
      commission: [{ name: "   ", position: "" }],
    }),
  );
  assert.doesNotThrow(() =>
    profileSchema.parse({ ...profile, commission: [] }),
  );
});

test("commission validation preserves names, positions and existing print-length checks", () => {
  const commission = profile.commission.map((member) => ({
    ...member,
    name: `  ${member.name} Әлібекұлы  `,
  }));
  assert.deepEqual(commissionIssues(commission), []);
  const draft = draftSchema.parse({ kind: "PERSON", items: [] });
  const longProfile = {
    ...profile,
    commission: [{ name: "А".repeat(81), position: "" }],
  };
  const before = JSON.stringify(longProfile);
  assert.ok(
    validateDraft(draft, longProfile).some(
      (issue) =>
        issue.code === "PRINT_UNBROKEN_VALUE" &&
        issue.path === "profile.commission.0.name",
    ),
  );
  assert.equal(JSON.stringify(longProfile), before);
});

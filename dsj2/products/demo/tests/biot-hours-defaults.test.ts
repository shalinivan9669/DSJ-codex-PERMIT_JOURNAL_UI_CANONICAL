import test from "node:test";
import assert from "node:assert/strict";
import {
  applyBusinessRules,
  draftSchema,
  resolveDraft,
} from "../packages/contracts/src";
import {
  newAssignment,
  newRecipient,
  draftPayload,
  type Draft,
} from "../apps/web/lib/types";
import {
  assignTrainingBundle,
  recipientForRequest,
} from "../apps/web/lib/request-bundles";

const emptyHours = { hours: "", productionHours: "" };
const stored = (draft: Draft) =>
  draftSchema.parse(JSON.parse(JSON.stringify(draftPayload(draft))));

for (const kind of ["PERSON", "COMPANY"] as const) {
  for (const category of ["WORKER", "ITR"] as const) {
    test(`${kind} ${category}: new individual BiOT hours survive empty common placeholders and saved reload`, () => {
      const created: Draft = {
        ...applyBusinessRules(
          draftSchema.parse({
            kind,
            schemaVersion: 2,
            commonFields: { ...emptyHours },
            presetFields: { ...emptyHours },
            items: [
              {
                ...newRecipient(),
                employeeCategory: category,
                assignments: [
                  newAssignment(
                    category === "WORKER"
                      ? "biot-worker-card"
                      : "biot-itr-certificate",
                  ),
                ],
              },
            ],
          }),
        ),
        id: "new-request",
        revision: 0,
        status: "DRAFT",
      };
      const saved = stored(created);
      const before = structuredClone(saved);
      const resolved = resolveDraft(saved, emptyHours);
      assert.deepEqual(
        saved,
        before,
        "resolving does not rewrite saved input or result facts",
      );
      for (const assignment of resolved.draft.items[0].assignments) {
        assert.equal(assignment.hours, category === "WORKER" ? "10" : "40");
        assert.equal(
          assignment.productionHours,
          category === "WORKER" ? "16" : undefined,
        );
        assert.equal(
          resolved.provenance[`${saved.items[0].id}:${assignment.id}`].hours,
          "PRESET",
        );
      }
      assert.deepEqual(
        resolveDraft(
          draftSchema.parse(JSON.parse(JSON.stringify(saved))),
          emptyHours,
        ),
        resolved,
      );
      assert.deepEqual(stored(created), saved);
    });
  }

  test(`${kind}: bulk BiOT assignment and subsequent WORKER/ITR recipients retain category hours`, () => {
    const created: Draft = {
      ...draftSchema.parse({
        kind,
        schemaVersion: 2,
        commonFields: { ...emptyHours },
        items: ["WORKER", "WORKER", "ITR", "ITR"].map((category, index) => ({
          ...newRecipient(),
          id: `person-${index}`,
          employeeCategory: category,
          assignments: [],
        })),
      }),
      id: "bulk-request",
      revision: 0,
      status: "DRAFT",
    };
    const assigned = assignTrainingBundle(
      created,
      created.items.map((row) => row.id),
      "BIOT",
      undefined,
      true,
    );
    for (const category of ["WORKER", "ITR"] as const)
      assigned.items.push(
        recipientForRequest(assigned, {
          ...newRecipient(),
          employeeCategory: category,
          assignments: [],
        }),
      );
    const saved = stored({ ...assigned, ...applyBusinessRules(assigned) });
    const before = structuredClone(saved);
    const resolved = resolveDraft(saved, emptyHours);
    assert.deepEqual(saved, before);
    for (const item of resolved.draft.items)
      for (const assignment of item.assignments) {
        assert.equal(
          assignment.hours,
          item.employeeCategory === "WORKER" ? "10" : "40",
        );
        assert.equal(
          assignment.productionHours,
          item.employeeCategory === "WORKER" ? "16" : undefined,
        );
      }
    assert.deepEqual(
      resolveDraft(
        draftSchema.parse(JSON.parse(JSON.stringify(saved))),
        emptyHours,
      ),
      resolved,
    );
  });
}

test("manual/imported/cleared common hours remain authoritative, while unprotected blank origins are placeholders", () => {
  const draft = applyBusinessRules(
    draftSchema.parse({
      kind: "PERSON",
      schemaVersion: 2,
      items: [{ ...newRecipient(), assignments: [newAssignment()] }],
    }),
  );
  for (const origin of ["MANUAL", "IMPORTED", "CLEARED"] as const) {
    const resolved = resolveDraft(draft, {
      ...emptyHours,
      fieldOrigins: { hours: origin, productionHours: origin },
    });
    for (const assignment of resolved.draft.items[0].assignments) {
      assert.equal(assignment.hours, "");
      assert.equal(assignment.productionHours, "");
    }
  }
  for (const origin of ["AUTO", "INHERITED"] as const) {
    const resolved = resolveDraft(draft, {
      ...emptyHours,
      fieldOrigins: { hours: origin, productionHours: origin },
    });
    assert.equal(resolved.draft.items[0].assignments[0].hours, "10");
    assert.equal(resolved.draft.items[0].assignments[0].productionHours, "16");
  }
  const configured = resolveDraft(draft, {
    hours: "12",
    productionHours: "20",
  });
  assert.equal(configured.draft.items[0].assignments[0].hours, "12");
  assert.equal(configured.draft.items[0].assignments[0].productionHours, "20");
});

test("individual manual/source hours and legacy manual markers survive category-common overrides and reload", () => {
  for (const origin of ["MANUAL", "IMPORTED", "CLEARED"] as const) {
    const draft = draftSchema.parse({
      kind: "PERSON",
      items: [
        {
          ...newRecipient(),
          assignments: [
            {
              ...newAssignment(),
              hours: origin === "CLEARED" ? "" : "13",
              productionHours: origin === "CLEARED" ? "" : "21",
              fieldOrigins: { hours: origin, productionHours: origin },
            },
          ],
        },
      ],
    });
    const resolved = resolveDraft(
      draftSchema.parse(JSON.parse(JSON.stringify(draft))),
      { hours: "40", productionHours: "30" },
    ).draft.items[0].assignments[0];
    assert.equal(resolved.hours, draft.items[0].assignments[0].hours);
    assert.equal(
      resolved.productionHours,
      draft.items[0].assignments[0].productionHours,
    );
  }
  const legacy = draftSchema.parse({
    kind: "PERSON",
    items: [
      {
        ...newRecipient(),
        assignments: [
          {
            ...newAssignment(),
            hours: "10",
            productionHours: "",
            biotManualFields: ["hours", "productionHours"],
          },
        ],
      },
    ],
  });
  const result = resolveDraft(legacy, { hours: "40", productionHours: "30" })
    .draft.items[0].assignments[0];
  assert.equal(
    result.hours,
    "10",
    "manual value equal to the old default is still manual",
  );
  assert.equal(
    result.productionHours,
    "",
    "legacy explicit blank is not refilled",
  );
});

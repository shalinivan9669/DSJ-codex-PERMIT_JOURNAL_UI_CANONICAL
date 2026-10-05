import assert from "node:assert/strict";
import test from "node:test";
import {
  assignmentTemplateKey,
  registeredTemplateKey,
} from "../apps/api/src/template-selection";

test("ordinary and special ITR cannot select each other's latest template", () => {
  const id = "biot-itr-certificate";
  const neutral = { templateId: id, contract: {}, version: "19" };
  const special = {
    templateId: id,
    contract: { program: "SPECIAL" },
    version: "special-14-1",
  };
  for (const records of [
    [neutral, special],
    [special, neutral],
  ]) {
    const selected = new Map(
      records.map((entry) => [registeredTemplateKey(entry), entry]),
    );
    assert.equal(
      selected.get(
        assignmentTemplateKey({ templateId: id, biotCategory: "ITR_STANDARD" }),
      ),
      neutral,
    );
    for (const biotCategory of [
      "OHS_SPECIALIST_SPECIAL",
      "INSPECTOR_SPECIAL",
      "COUNCIL_SPECIAL",
    ] as const)
      assert.equal(
        selected.get(assignmentTemplateKey({ templateId: id, biotCategory })),
        special,
      );
  }
});

test("special individual and group selection fails closed when its approved form is absent", () => {
  const ordinaryOnly = new Map([["biot-itr-protocol", { version: "6" }]]);
  assert.equal(
    ordinaryOnly.get(
      assignmentTemplateKey(
        {
          templateId: "biot-itr-certificate",
          biotCategory: "OHS_SPECIALIST_SPECIAL",
        },
        "biot-itr-protocol",
      ),
    ),
    undefined,
  );
});

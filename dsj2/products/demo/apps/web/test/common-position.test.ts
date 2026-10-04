import assert from "node:assert/strict";
import test from "node:test";
import { supplementPosition } from "../lib/common-position";
import { newRecipient } from "../lib/types";
test("one group position fills empty people and supplements only a matching bilingual occupation", () => {
  const blank = newRecipient();
  assert.equal(
    supplementPosition(blank, "Электрик", "Электрик").positionRu,
    "Электрик",
  );
  const known = { ...blank, positionRu: "Электрик" };
  assert.equal(
    supplementPosition(known, " Электрик ", "Электрик").positionKz,
    "Электрик",
  );
  assert.equal(supplementPosition(known, "Инженер", "Инженер"), known);
  assert.equal(supplementPosition(known, "", "Инженер"), known);
  const kz = { ...blank, positionKz: "Другая профессия" };
  assert.equal(supplementPosition(kz, "Инженер", "Инженер"), kz);
});

import test from "node:test";
import assert from "node:assert/strict";
import { BIOT_CATEGORIES, biotCategoryIds } from "@demo/contracts";
import {
  biotCategoryDescription,
  liveValidityDescription,
} from "../lib/validity-display";
import { measuredValidityRows } from "./validity-policy-fixture";
test("R4 all available categories and primary/companion/group forms expose the actual LIVE expiry with AUTO origin", () => {
  for (const origin of [
    "MANUAL",
    "IMPORTED",
    "INHERITED",
    "CLEARED",
  ] as const) {
    const rows = measuredValidityRows(origin);
    assert.equal(rows.length, 60);
    for (const row of rows) {
      assert.equal(
        row.displayedUntil,
        row.resolvedUntil,
        row.selectedCategory + " " + row.templateId,
      );
      assert.equal(
        row.resolvedUntil,
        row.expectedUntil,
        row.selectedCategory + " " + row.templateId + " " + row.scope,
      );
      assert.equal(row.savedOrigin, "AUTO");
      assert.equal(row.resolvedOrigin, "AUTO");
      assert.equal(row.legalApproval, false);
      assert.equal(
        row.hint.includes("Введённая вручную дата сохраняется"),
        false,
      );
      assert.equal(
        row.validityMode,
        row.direction === "PS" ? "UNLIMITED" : "FIXED",
      );
    }
    assert.deepEqual(
      new Set(
        rows
          .filter((row) => row.direction === "BIOT")
          .map((row) => row.selectedCategory),
      ),
      new Set(biotCategoryIds),
    );
  }
});
test("R4 inspector/council preset discrepancy is explicit without changing hours, ECS or normative preset data", () => {
  for (const category of [
    "INSPECTOR_SPECIAL",
    "COUNCIL_GENERAL",
    "COUNCIL_SPECIAL",
  ] as const) {
    assert.match(biotCategoryDescription(category, true), /Расхождение/);
    assert.match(biotCategoryDescription(category, true), /3 года/);
    assert.equal(
      biotCategoryDescription(category, false),
      BIOT_CATEGORIES[category].hint,
    );
  }
  assert.match(
    liveValidityDescription(
      { employeeCategory: "ITR", assignments: [] },
      { templateId: "ptm-card" },
    ),
    /3 года/,
  );
  assert.match(
    liveValidityDescription(
      { employeeCategory: "WORKER", assignments: [] },
      { templateId: "ps-witness" },
    ),
    /бессрочно/,
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { applyBusinessRules, draftSchema } from "@demo/contracts";
import {
  archiveImportTemplates,
  mapImportRow,
  recognizedImportMapping,
  type ArchiveImport,
} from "../lib/imports";

test("archive recipients and their protocols have the imported fields and a pending assessment", () => {
  for (const [course, card] of Object.entries(archiveImportTemplates)) {
    const field =
      course === "PS"
        ? "psQualificationRu"
        : course === "PB"
          ? "trainingSubject"
          : "workplaceRu";
    const archive: ArchiveImport = {
      course: course as ArchiveImport["course"],
      fields: ["fullNameRu", field],
    };
    const columns = ["ФИО", "Поле архивного бланка"];
    const row = { sourceRow: 2, values: ["Учебный А.", "Учебные данные"] };
    const preview = {
      importId: "test",
      total: 1,
      rows: [row],
      columns,
      archive,
    };
    const recognized = recognizedImportMapping(columns, [], archive);
    assert.equal(recognized.needsReview, false);
    const item = mapImportRow(preview, row, recognized.mapping, card);
    assert.equal(item.fullNameRu, row.values[0]);
    const draft = applyBusinessRules(
      draftSchema.parse({
        kind: "COMPANY",
        schemaVersion: 2,
        businessRuleVersion: "LIVE_V1",
        items: [item],
      }),
    );
    for (const assignment of draft.items[0].assignments) {
      assert.equal(assignment.outcome?.status, "UNKNOWN");
      assert.equal(assignment.result, "");
      assert.equal(assignment.externalBasisNumber, "");
    }
    assert.equal(
      field === "workplaceRu" ? item.workplaceRu : item.assignments[0][field],
      row.values[1],
    );
  }
});

test("a manually mapped arbitrary grade in an archive row cannot create a positive outcome", () => {
  const row = { sourceRow: 2, values: ["Учебный А.", "3"] };
  const preview = {
    archive: {
      course: "PS" as const,
      fields: ["fullNameRu", "psQualificationRu"],
    },
    importId: "archive-grade",
    columns: ["ФИО", "Поле"],
    rows: [row],
    total: 1,
  };
  const item = mapImportRow(preview, row, ["fullNameRu", "result"], "ps-card");
  assert.equal(item.assignments[0].result, "3");
  assert.equal(item.assignments[0].outcome?.status, "UNKNOWN");
});

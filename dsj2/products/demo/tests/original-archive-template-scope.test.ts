import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  archiveCardCandidateChecksum,
  sampleSnapshot,
} from "../apps/api/src/template-management";

test("only individual archive cards can request exact-source verification", () => {
  const upload = Buffer.from("synthetic SOL source");
  const sha256 = createHash("sha256").update(upload).digest("hex");
  const base = {
    id: "pb-card",
    renderPolicy: "USER_ARCHIVE_20261109_V1",
    // Past registered templates may derive from the other archive variant.
    sourceSha256: createHash("sha256").update("plain source").digest("hex"),
  };
  for (const id of ["biot-worker-card", "ptm-card", "pb-card", "ps-card"]) {
    assert.equal(archiveCardCandidateChecksum({ ...base, id }, upload), sha256);
  }
  for (const override of [
    { ownerKind: "GROUP" },
    { program: "SPECIAL" },
    { id: "ps-protocol" },
    { id: "biot-itr-certificate" },
    { renderPolicy: "NEUTRAL_FORMS_V1" },
  ]) {
    assert.equal(
      archiveCardCandidateChecksum({ ...base, ...override }, upload),
      undefined,
    );
  }
});

test("the marked archive-card sample illustrates passing without asserting an exam in other previews", () => {
  const base = {
    templateId: "pb-card",
    version: "preview",
    storageKey: "private",
    checksum: "abc",
  };
  const original = sampleSnapshot({
    ...base,
    contract: { renderPolicy: "ORIGINAL_ARCHIVE_20261117" },
  });
  assert.equal(original.demoMode, true);
  assert.deepEqual(original.items[0].assignment.outcome, {
    status: "PASSED",
    source: "SYNTHETIC_FORM_PREVIEW_ONLY",
  });
  assert.equal(
    sampleSnapshot({ ...base, contract: {} }).items[0].assignment.outcome,
    undefined,
  );
});

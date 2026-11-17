import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  archiveCandidateChecksum,
  sampleSnapshot,
} from "../apps/api/src/template-management";

test("exact-source verification covers archive protocols in either scope and individual cards and witnesses", () => {
  const upload = Buffer.from("synthetic SOL source");
  const sha256 = createHash("sha256").update(upload).digest("hex");
  const base = {
    id: "pb-card",
    renderPolicy: "USER_ARCHIVE_20261109_V1",
    // Past registered templates may derive from the other archive variant.
    sourceSha256: createHash("sha256").update("plain source").digest("hex"),
  };
  for (const id of ["biot-worker-card", "ptm-card", "pb-card", "ps-card"]) {
    assert.equal(archiveCandidateChecksum({ ...base, id }, upload), sha256);
  }
  for (const id of [
    "biot-protocol",
    "ptm-protocol",
    "pb-protocol",
    "ps-protocol",
  ]) {
    for (const ownerKind of ["INDIVIDUAL", "GROUP"]) {
      assert.equal(
        archiveCandidateChecksum({ ...base, id, ownerKind }, upload),
        sha256,
      );
      assert.equal(
        archiveCandidateChecksum(
          { ...base, id, ownerKind, program: "SPECIAL" },
          upload,
        ),
        undefined,
      );
    }
  }
  const witness = { id: "ps-witness", renderPolicy: "NEUTRAL_FORMS_V1" };
  assert.equal(archiveCandidateChecksum(witness, upload), sha256);
  assert.equal(
    archiveCandidateChecksum(
      { ...witness, id: "biot-itr-certificate" },
      upload,
    ),
    sha256,
  );
  assert.equal(
    archiveCandidateChecksum(
      { ...witness, id: "biot-itr-certificate", program: "SPECIAL" },
      upload,
    ),
    undefined,
  );
  assert.equal(
    archiveCandidateChecksum({ ...witness, ownerKind: "GROUP" }, upload),
    undefined,
  );
  for (const override of [
    { ownerKind: "GROUP" },
    { program: "SPECIAL" },
    { id: "lms-protocol" },
    { id: "biot-itr-protocol" },
    { id: "biot-itr-certificate" },
    { renderPolicy: "NEUTRAL_FORMS_V1" },
  ]) {
    assert.equal(
      archiveCandidateChecksum({ ...base, ...override }, upload),
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

test("profession protocols freeze both private source references in the group sample", () => {
  const primary = {
    templateId: "ps-protocol",
    version: "1",
    storageKey: "private/ru",
    checksum: "0".repeat(64),
  };
  const originalKazakhSource = {
    storageKey: "private/kz",
    sha256: "1".repeat(64),
  };
  const contract = {
    renderPolicy: "ORIGINAL_ARCHIVE_20261117",
    ownerKind: "GROUP",
  };
  const preview = sampleSnapshot({
    ...primary,
    contract: { ...contract, originalKazakhSource },
  });
  assert.deepEqual(preview.originalKazakhSource, originalKazakhSource);
  assert.equal(preview.templateStorageKey, primary.storageKey);
  assert.equal(preview.templateChecksum, primary.checksum);
  assert.ok(preview.groupEvent);
  assert.throws(() => sampleSnapshot({ ...primary, contract }));
  assert.equal(
    sampleSnapshot({ ...primary, contract: { originalKazakhSource } })
      .originalKazakhSource,
    undefined,
  );
});

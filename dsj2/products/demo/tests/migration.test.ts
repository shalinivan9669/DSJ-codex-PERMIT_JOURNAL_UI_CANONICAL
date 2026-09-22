import { test } from "node:test";
import assert from "node:assert/strict";
import {
  seal,
  verifyEnvelope,
  checksum,
} from "../scripts/migration/import-legacy";
const base = {
  version: 1,
  sourceSystem: "DSJ",
  sourceCompanyId: "source-company",
  requests: [
    {
      id: "request-1",
      items: [{ id: "item-1", fullName: "Иванов", fullNameKz: "Иванов Қ" }],
    },
  ],
  audit: [],
  counts: { requests: 1, items: 1, audit: 0 },
  originalFiles: "NOT_EXPORTED_LEGACY_DID_NOT_PERSIST_ORIGINALS",
  coverage: "Synthetic fixture only",
};
test("legacy checksum is deterministic and tampering is rejected", () => {
  const envelope = seal(base);
  verifyEnvelope(envelope);
  assert.equal(checksum({ a: 1, b: 2 }), checksum({ b: 2, a: 1 }));
  assert.throws(
    () => verifyEnvelope({ ...envelope, requests: [] }),
    /CHECKSUM/,
  );
});
test("legacy counts and duplicate source ids never silently reconcile", () => {
  assert.throws(
    () =>
      verifyEnvelope(
        seal({ ...base, counts: { requests: 2, items: 1, audit: 0 } }),
      ),
    /COUNTS/,
  );
  assert.throws(
    () =>
      verifyEnvelope(
        seal({
          ...base,
          requests: [base.requests[0], base.requests[0]],
          counts: { requests: 2, items: 2, audit: 0 },
        }),
      ),
    /DUPLICATE/,
  );
});
test("legacy duplicate audit and global item identifiers are rejected", () => {
  const audit = { id: "audit-1", action: "biot_card.generated" };
  assert.throws(
    () =>
      verifyEnvelope(
        seal({
          ...base,
          audit: [audit, audit],
          counts: { ...base.counts, audit: 2 },
        }),
      ),
    /DUPLICATE/,
  );
  assert.throws(
    () =>
      verifyEnvelope(
        seal({
          ...base,
          requests: [
            base.requests[0],
            { ...base.requests[0], id: "request-2" },
          ],
          counts: { requests: 2, items: 2, audit: 0 },
        }),
      ),
    /DUPLICATE/,
  );
});

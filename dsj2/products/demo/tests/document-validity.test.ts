import { test } from "node:test";
import assert from "node:assert/strict";
import {
  issuedDocumentValidity,
  publicDocumentStatus,
} from "../apps/api/src/document-validity";

test("issued validity outranks changed renewal data and is inclusive of its last day", () => {
  const snapshot = {
    draft: {
      items: [
        { id: "person", assignments: [{ id: "a", validUntil: "2026-10-19" }] },
      ],
    },
  };
  const validUntil = issuedDocumentValidity(
    snapshot,
    { rowId: "person", assignmentId: "a", groupEventId: null },
    "2030-01-01",
  );
  assert.equal(validUntil, "2026-10-19");
  assert.equal(
    publicDocumentStatus({
      replaced: false,
      revoked: false,
      validUntil,
      today: "2026-10-19",
    }),
    "ACTIVE_RECORD",
  );
  assert.equal(
    publicDocumentStatus({
      replaced: false,
      revoked: false,
      validUntil,
      today: "2026-10-20",
    }),
    "EXPIRED",
  );
});
test("unlimited, unknown and invalid dates do not fabricate expiry; group fields are frozen", () => {
  const document = { rowId: null, assignmentId: null, groupEventId: "g" };
  const snapshot = {
    draft: {
      events: [
        {
          id: "g",
          commonFields: { validityMode: "UNLIMITED", validUntil: "2020-01-01" },
        },
      ],
    },
  };
  assert.equal(issuedDocumentValidity(snapshot, document, "2020-01-01"), null);
  assert.equal(issuedDocumentValidity({}, document, null), null);
  assert.equal(issuedDocumentValidity({}, document, "2026-02-30"), null);
  assert.equal(
    issuedDocumentValidity(
      {
        draft: {
          events: [{ id: "g", commonFields: { validUntil: "2027-02-28" } }],
        },
      },
      document,
      null,
    ),
    "2027-02-28",
  );
});
test("revocation and replacement keep precedence over elapsed document validity", () => {
  assert.equal(
    publicDocumentStatus({
      replaced: false,
      revoked: true,
      validUntil: "2020-01-01",
      today: "2026-10-19",
    }),
    "REVOKED",
  );
  assert.equal(
    publicDocumentStatus({
      replaced: true,
      revoked: true,
      validUntil: "2020-01-01",
      today: "2026-10-19",
    }),
    "REPLACED",
  );
});

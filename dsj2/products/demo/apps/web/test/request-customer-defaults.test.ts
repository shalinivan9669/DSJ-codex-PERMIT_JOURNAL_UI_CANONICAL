import assert from "node:assert/strict";
import test from "node:test";
import {
  soleGroupEmployer,
  uniqueCustomerProfile,
} from "../lib/request-customer-defaults";

test("a company order can inherit one actual employer across all its rows", () => {
  const company = { kind: "COMPANY" as const, customerId: "a" };
  assert.equal(
    soleGroupEmployer({ ...company, items: [{}, { employerId: "a" }] }),
    "a",
  );
  assert.equal(
    soleGroupEmployer({ ...company, items: [{ employerId: "b" }] }),
    "b",
  );
  assert.equal(
    soleGroupEmployer({ ...company, items: [{}, { employerId: "b" }] }),
    undefined,
  );
  assert.equal(
    soleGroupEmployer({ kind: "COMPANY", items: [{ employerId: "a" }, {}] }),
    undefined,
  );
  assert.equal(
    soleGroupEmployer({ kind: "PERSON", items: [{ employerId: "a" }] }),
    undefined,
  );
});

test("only one stored profile belonging to the selected customer is automatic", () => {
  const other = { id: "b", profile: { customerId: "b" } };
  const personal = { id: "general", profile: {} };
  const first = { id: "a1", data: { customerId: "a" } };
  const rows = [other, personal, first];
  assert.equal(uniqueCustomerProfile(rows, "a")?.id, first.id);
  assert.equal(uniqueCustomerProfile(rows, ""), undefined);
  assert.equal(
    uniqueCustomerProfile(
      [...rows, { id: "a2", profile: { customerId: "a" } }],
      "a",
    ),
    undefined,
  );
  assert.equal(
    uniqueCustomerProfile([{ id: "empty", customerId: "a" }], "a"),
    undefined,
  );
});

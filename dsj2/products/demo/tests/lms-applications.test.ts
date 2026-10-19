import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { applicationInput } from "../apps/api/src/lms/applications";
import { paymentSummary } from "../apps/api/src/lms/application-workflow";

test("applications bound payloads and reject client tenant/role injection", () => {
  const valid = {
    kind: "B2C",
    courseVersionId: randomUUID(),
    idempotencyKey: randomUUID(),
  };
  assert.equal(applicationInput.parse(valid).quantity, 1);
  for (const patch of [
    { tenantId: randomUUID() },
    { role: "DIRECTOR" },
    { quantity: 10001 },
    { comment: "x".repeat(2001) },
    { organization: "x".repeat(301) },
  ])
    assert.equal(
      applicationInput.safeParse({ ...valid, ...patch }).success,
      false,
    );
});
test("commercial status keeps unknown distinct and refunds reduce recorded amount", () => {
  assert.equal(
    paymentSummary({}, [{ amountMinor: "900", reconciliationRequired: false }])
      .state,
    "UNKNOWN",
  );
  assert.equal(
    paymentSummary({ totalMinor: "1000" }, [
      { amountMinor: "900", reconciliationRequired: false },
    ]).state,
    "PARTIAL",
  );
  assert.equal(
    paymentSummary({ totalMinor: "1000" }, [
      { amountMinor: "1000", reconciliationRequired: false },
    ]).state,
    "PAID",
  );
  assert.equal(
    paymentSummary({ totalMinor: "1000" }, [
      { amountMinor: "1000", reconciliationRequired: false },
      { amountMinor: "-100", reconciliationRequired: false },
    ]).state,
    "PARTIAL",
  );
  assert.equal(
    paymentSummary({ totalMinor: "0" }, [
      { amountMinor: "0", reconciliationRequired: true },
    ]).state,
    "UNKNOWN",
  );
});

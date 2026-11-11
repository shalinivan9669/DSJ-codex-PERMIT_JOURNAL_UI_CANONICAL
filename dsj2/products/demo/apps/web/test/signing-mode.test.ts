import assert from "node:assert/strict";
import test from "node:test";
import { isTestSigning } from "../lib/signing-mode";

test("hosted receipts are shown as tests in both signing and print evidence", () => {
  assert.equal(
    isTestSigning({
      localMock: false,
      testMode: true,
      mockMode: "HOSTED_TEST_MOCK",
    }),
    true,
  );
  assert.equal(isTestSigning({ mockMode: "HOSTED_TEST_MOCK" }), true);
  assert.equal(isTestSigning({ localTest: true }), true);
});

test("legacy local receipts keep their test label after client upgrade", () => {
  assert.equal(isTestSigning({ localMock: true }), true);
  assert.equal(isTestSigning({ mockMode: "LOCAL_TEST_MOCK" }), true);
});

test("ordinary signature states do not enable a test label", () => {
  for (const value of [
    undefined,
    null,
    {},
    { localMock: false, testMode: false, mockMode: null },
  ])
    assert.equal(isTestSigning(value), false);
});

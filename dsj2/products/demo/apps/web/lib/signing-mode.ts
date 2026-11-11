export type SigningTestContext = {
  localMock?: boolean;
  localTest?: boolean;
  testMode?: boolean;
  mockMode?: "LOCAL_TEST_MOCK" | "HOSTED_TEST_MOCK" | null;
};

/** Old local receipts and hosted rehearsals must never be labelled verified. */
export function isTestSigning(value?: SigningTestContext | null): boolean {
  return (
    value?.testMode === true ||
    value?.localMock === true ||
    value?.localTest === true ||
    value?.mockMode === "LOCAL_TEST_MOCK" ||
    value?.mockMode === "HOSTED_TEST_MOCK"
  );
}

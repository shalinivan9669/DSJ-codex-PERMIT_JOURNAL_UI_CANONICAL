import { defineConfig } from "@playwright/test";
import path from "node:path";
const evidence = process.env.DEMO_E2E_EVIDENCE
  ? path.resolve(process.env.DEMO_E2E_EVIDENCE)
  : "../../docs/evidence/browser";
// A test-only local certificate pin is scoped to Playwright's temporary browser
// profile. Never install a CA in the operator's Windows certificate store.
const certificatePin = process.env.DEMO_E2E_CERT_SPKI;
if (certificatePin && !/^[A-Za-z0-9+/]{43}=$/.test(certificatePin)) {
  throw new Error("DEMO_E2E_CERT_SPKI must be a SHA-256 SPKI base64 digest");
}
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 240000,
  expect: { timeout: 15000 },
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(evidence, "results.json") }],
  ],
  outputDir: path.join(evidence, "test-results"),
  use: {
    baseURL: process.env.DEMO_ORIGIN || "http://localhost:3100",
    channel: process.env.DEMO_E2E_CHANNEL,
    launchOptions: certificatePin
      ? { args: [`--ignore-certificate-errors-spki-list=${certificatePin}`] }
      : undefined,
    actionTimeout: 20000,
    viewport: { width: 1366, height: 768 },
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});

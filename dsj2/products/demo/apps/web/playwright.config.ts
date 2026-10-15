import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fullSuiteRunId } from "./e2e/operator-full-suite";
const evidence = process.env.DEMO_E2E_EVIDENCE
  ? path.resolve(process.env.DEMO_E2E_EVIDENCE)
  : "../../docs/evidence/browser";
// A test-only local certificate pin is scoped to Playwright's temporary browser
// profile. Never install a CA in the operator's Windows certificate store.
const certificatePin = process.env.DEMO_E2E_CERT_SPKI;
const fullRun = fullSuiteRunId();
const commonProducer = /operator-common-history-live\.spec\.ts$/;
const commonConsumers = [
  /operator-common-resume-live\.spec\.ts$/,
  /final-repeat-basis-live\.spec\.ts$/,
];
const g1Producer = /operator-g1-keyboard-live\.spec\.ts$/;
const g1Consumers = [
  /operator-g1-complete\.spec\.ts$/,
  /operator-g1-resume-live\.spec\.ts$/,
  /operator-g1-keyboard-resume-live\.spec\.ts$/,
];
const portalProducer = /final-portal-three-live\.spec\.ts$/;
const portalConsumer = /final-portal-390-live\.spec\.ts$/;
const printPackScale = /remaining-print-pack-scale-live\.spec\.ts$/;
const manualProducer = /operator-minimal-manual-live\.spec\.ts$/;
const manualResume = /operator-minimal-manual-resume-live\.spec\.ts$/;
const manualConsumers = [
  /operator-minimal-manual-files-live\.spec\.ts$/,
  /operator-minimal-review-layout-live\.spec\.ts$/,
];
const domainProducer = /operator-role-full-fix-live\.spec\.ts$/;
const domainConsumer = /operator-domain-acceptance-live\.spec\.ts$/;
if (fullRun) {
  if (!process.env.DEMO_E2E_EVIDENCE)
    throw new Error("FULL_SUITE_EVIDENCE_DIRECTORY_REQUIRED");
  process.env.DEMO_E2E_G1_PREPARED_DIR = path.join(evidence, "g1-prepared");
  process.env.DEMO_E2E_COMMON_PREPARED_DIR = path.join(
    evidence,
    "common-prepared",
  );
  process.env.DEMO_E2E_REPEAT_SOURCE = process.env.DEMO_E2E_COMMON_PREPARED_DIR;
  process.env.DEMO_E2E_PORTAL_FRESH_SOURCE = path.join(
    evidence,
    "portal-fresh.json",
  );
  process.env.DEMO_E2E_DOMAIN_IMMUTABLE_SOURCE = path.join(
    evidence,
    "role-lifecycle-readback.json",
  );
}
if (certificatePin && !/^[A-Za-z0-9+/]{43}=$/.test(certificatePin)) {
  throw new Error("DEMO_E2E_CERT_SPKI must be a SHA-256 SPKI base64 digest");
}
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  // Preserve every test exactly once; dependencies prepare current-run data
  // before consumers, regardless of lexical file order or worker scheduling.
  projects: fullRun
    ? [
        { name: "common-producer", testMatch: commonProducer },
        {
          name: "common-consumers",
          testMatch: commonConsumers,
          dependencies: ["common-producer"],
        },
        { name: "g1-producer", testMatch: g1Producer },
        {
          name: "g1-consumers",
          testMatch: g1Consumers,
          dependencies: ["g1-producer"],
        },
        { name: "portal-producer", testMatch: portalProducer },
        {
          name: "portal-consumer",
          testMatch: portalConsumer,
          dependencies: ["portal-producer"],
        },
        { name: "manual-producer", testMatch: manualProducer },
        {
          name: "manual-resume",
          testMatch: manualResume,
          dependencies: ["manual-producer"],
        },
        {
          name: "manual-consumers",
          testMatch: manualConsumers,
          dependencies: ["manual-resume"],
        },
        { name: "domain-producer", testMatch: domainProducer },
        {
          name: "domain-consumer",
          testMatch: domainConsumer,
          dependencies: ["domain-producer"],
        },
        {
          name: "remaining",
          testIgnore: [
            commonProducer,
            ...commonConsumers,
            g1Producer,
            ...g1Consumers,
            portalProducer,
            portalConsumer,
            printPackScale,
            manualProducer,
            manualResume,
            ...manualConsumers,
            domainProducer,
            domainConsumer,
          ],
          dependencies: ["common-producer", "g1-producer", "portal-producer"],
        },
        {
          name: "print-pack-scale",
          testMatch: printPackScale,
          dependencies: [
            "common-consumers",
            "g1-consumers",
            "portal-consumer",
            "remaining",
            "manual-consumers",
            "domain-consumer",
          ],
        },
      ]
    : undefined,
  timeout: 240000,
  expect: { timeout: 15000 },
  reporter: [
    ["list"],
    ["./e2e/acceptance-failure-reporter.ts"],
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
    trace: process.env.DEMO_E2E_TRACE === "off" ? "off" : "retain-on-failure",
    screenshot: "only-on-failure",
  },
});

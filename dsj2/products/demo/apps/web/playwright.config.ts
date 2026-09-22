import { defineConfig } from "@playwright/test";
import path from "node:path";
const evidence = process.env.DEMO_E2E_EVIDENCE
  ? path.resolve(process.env.DEMO_E2E_EVIDENCE)
  : "../../docs/evidence/browser";
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
    actionTimeout: 20000,
    viewport: { width: 1366, height: 768 },
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});

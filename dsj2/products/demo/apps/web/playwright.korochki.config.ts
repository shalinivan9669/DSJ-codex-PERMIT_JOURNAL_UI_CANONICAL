import { defineConfig } from "@playwright/test";
import shared from "./playwright.config";

// Opt-in local acceptance owns its disposable browser DB and private sessions.
// These files deliberately do not match the normal *.spec.ts discovery.
export default defineConfig({
  ...shared,
  projects: undefined,
  testMatch: /korochki-excel-(?:photos|resume)-live\.acceptance\.ts$/,
});

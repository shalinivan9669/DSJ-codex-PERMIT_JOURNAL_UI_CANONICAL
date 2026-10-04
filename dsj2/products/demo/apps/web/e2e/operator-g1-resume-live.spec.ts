import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { fullSuiteApiCooldown, fullSuiteRunId } from "./operator-full-suite";
import { loginIsolated } from "./operator-full-fix-session";
import { readCommon } from "./operator-common-history-helpers";
import {
  g1Evidence,
  loadG1Checkpoint,
  verifyG1Files,
  orderedG1Documents,
} from "./operator-g1-helpers";

test.use({ trace: "off" });
test("G1 resume: explicitly selected fresh checkpoint retains the original 100 people, 101 documents and all 204 bytes after reload", async ({
  page,
  browser,
}) => {
  test.setTimeout(1800000);
  const started = Date.now(),
    evidence = g1Evidence("resume");
  const { checkpoint, directory } = await loadG1Checkpoint();
  expect(checkpoint.status).toBe("FILES_VERIFIED");
  let businessMutations = 0;
  page.on("request", (request) => {
    if (
      request.url().includes("/api/") &&
      !request.url().includes("/auth/") &&
      !["GET", "HEAD", "OPTIONS"].includes(request.method())
    )
      businessMutations++;
  });
  await loginIsolated(page);
  await page.goto(checkpoint.requestPath);
  await expect(page.locator(".files-panel")).toContainText("Готово 204 из 204");
  const { issued, files } = await verifyG1Files(page, checkpoint, evidence);
  await page.reload();
  const reloaded = await readCommon(page, checkpoint.requestId);
  expect(reloaded.items).toEqual(issued.items);
  expect(orderedG1Documents(reloaded.documents)).toEqual(
    orderedG1Documents(issued.documents),
  );
  expect(reloaded.issuances).toEqual(issued.issuances);
  expect(businessMutations).toBe(0);
  await page.screenshot({
    path: path.join(evidence, "g1-resumed-issued-reload.png"),
    fullPage: true,
  });
  await fs.writeFile(
    path.join(evidence, "g1-result.json"),
    JSON.stringify(
      {
        status: "PASS",
        suiteRunId: fullSuiteRunId(),
        preparationEvidence: directory,
        requestId: checkpoint.requestId,
        continuationBusinessMutations: businessMutations,
        noRepeatIssueOrRender: true,
        recipients: 100,
        photos: 100,
        documentCount: 101,
        artifacts: 204,
        allFilesHashVerified: true,
        resumedBrowserVerificationMs: Date.now() - started,
        humanOperatorMs: null,
        browser: browser.version(),
        files,
      },
      null,
      2,
    ),
  );
  await fullSuiteApiCooldown(evidence, "g1-resume-after-file-readback");
});

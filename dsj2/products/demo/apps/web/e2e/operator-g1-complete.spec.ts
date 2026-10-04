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
test("G1 complete: fresh keyboard preparation has 100 original people and embedded photos, one common PB event and 101 real documents", async ({
  page,
  browser,
}) => {
  test.setTimeout(1800000);
  const started = Date.now(),
    evidence = g1Evidence("complete");
  const { checkpoint, directory } = await loadG1Checkpoint();
  expect(checkpoint.status).toBe("FILES_VERIFIED");
  expect(checkpoint.files).toHaveLength(204);
  const originalMetrics = JSON.parse(
    await fs.readFile(path.join(directory, "keyboard-metrics.json"), "utf8"),
  );
  expect(originalMetrics.status).toBe("passed");
  expect(originalMetrics.mouseClicks).toBe(0);
  expect(originalMetrics.apiMutationsForUiShortcuts).toBe(0);
  expect(originalMetrics.dialogTrapChecks).toBe(1);
  expect(originalMetrics.enterNoFinalizeChecks).toBe(1);
  const headers = await loginIsolated(page);
  await page.goto(checkpoint.requestPath);
  await expect(page.locator(".operator-grid tbody tr")).toHaveCount(100);
  await expect(page.locator(".files-panel")).toContainText("Готово 204 из 204");
  const { issued, files, group } = await verifyG1Files(
    page,
    checkpoint,
    evidence,
  );
  expect(issued.events).toHaveLength(1);
  expect(issued.events![0].protocolTemplateId).toBe("pb-protocol");
  expect(issued.events![0].protocolMode).toBe("GROUP");
  const response = await page.request.post(
    `/api/print-requests/${checkpoint.requestId}/export`,
    { headers, data: { format: "XLSX" } },
  );
  expect(response.status()).toBe(409);
  expect((await response.json()).code).toBe("ISSUANCE_NOT_COMPLETE");
  await page.reload();
  const reloaded = await readCommon(page, checkpoint.requestId);
  expect(reloaded.items).toEqual(checkpoint.items);
  expect(orderedG1Documents(reloaded.documents)).toEqual(
    orderedG1Documents(issued.documents),
  );
  await page.screenshot({
    path: path.join(evidence, "g1-complete-issued-reload.png"),
    fullPage: true,
  });
  await fs.writeFile(
    path.join(evidence, "g1-result.json"),
    JSON.stringify(
      {
        status: "PASS",
        suiteRunId: fullSuiteRunId(),
        preparationEvidence: directory,
        reusedFreshIssuance: true,
        requestId: checkpoint.requestId,
        recipients: 100,
        photos: 100,
        individualPanelsOpened: 0,
        sourceRowsPreserved: true,
        documentCount: 101,
        groupProtocolCount: 1,
        groupNumber: group.number,
        allFilesHashVerified: true,
        originalKeyboardMetrics: originalMetrics,
        verificationMs: Date.now() - started,
        humanOperatorMs: null,
        physicalPrint: "NOT_RUN",
        legalAcceptance: "NOT_RUN",
        browser: browser.version(),
        files,
      },
      null,
      2,
    ),
  );
  await fullSuiteApiCooldown(evidence, "g1-complete-after-file-readback");
});

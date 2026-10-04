import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { fullSuiteApiCooldown, fullSuiteRunId } from "./operator-full-suite";
import { readCommon } from "./operator-common-history-helpers";
import {
  g1Evidence,
  loadG1Checkpoint,
  verifyG1Files,
  g1KeyboardSession,
  orderedG1Documents,
} from "./operator-g1-helpers";
import {
  keyboardActivate,
  keyboardEnter,
  keyboardMetrics,
  keyboardReopen,
  saveKeyboardMetrics,
} from "./operator-keyboard-helpers";

test.use({ trace: "off" });
test("G1 keyboard resume: reopen and download the same 101 issued documents, verify 204 hashes and immutable snapshot with no business write", async ({
  page,
  browser,
}) => {
  test.setTimeout(1800000);
  const started = Date.now(),
    evidence = g1Evidence("keyboard-resume");
  const { checkpoint, directory } = await loadG1Checkpoint();
  expect(checkpoint.status).toBe("FILES_VERIFIED");
  const preparedMetrics = JSON.parse(
    await fs.readFile(path.join(directory, "keyboard-metrics.json"), "utf8"),
  );
  expect(preparedMetrics.status).toBe("passed");
  expect(preparedMetrics.enterNoFinalizeChecks).toBe(1);
  expect(preparedMetrics.dialogTrapChecks).toBe(1);
  expect(preparedMetrics.mouseClicks).toBe(0);
  let businessMutations = 0,
    mouseClicks = 0;
  await page.exposeFunction("g1ResumeMouseClick", () => mouseClicks++);
  await page.addInitScript(() => {
    document.addEventListener(
      "click",
      (event) => {
        if (event.detail > 0)
          (
            window as unknown as { g1ResumeMouseClick: () => void }
          ).g1ResumeMouseClick();
      },
      true,
    );
  });
  page.on("request", (request) => {
    if (
      request.url().includes("/api/") &&
      !request.url().includes("/auth/") &&
      !["GET", "HEAD", "OPTIONS"].includes(request.method())
    )
      businessMutations++;
  });
  await g1KeyboardSession(page);
  await keyboardEnter(
    page,
    page.getByLabel("Поиск по заявкам", { exact: true }),
    checkpoint.title,
  );
  await keyboardActivate(
    page,
    page.getByRole("link", { name: checkpoint.title, exact: true }),
  );
  await expect(page.locator(".files-panel")).toContainText("Готово 204 из 204");
  const ready = page.waitForEvent("download");
  await keyboardActivate(
    page,
    page
      .locator(".files-panel article")
      .filter({
        has: page.locator(".file-type").getByText("PDF", { exact: true }),
      })
      .first()
      .getByRole("link", { name: "Скачать", exact: true }),
  );
  await fs.mkdir(evidence, { recursive: true });
  await (await ready).saveAs(path.join(evidence, "keyboard-download.pdf"));
  keyboardMetrics.artifactDownloads++;
  const { issued, files } = await verifyG1Files(page, checkpoint, evidence);
  await keyboardReopen(page);
  const reloaded = await readCommon(page, checkpoint.requestId);
  expect(reloaded.items).toEqual(issued.items);
  expect(orderedG1Documents(reloaded.documents)).toEqual(
    orderedG1Documents(issued.documents),
  );
  expect(reloaded.issuances).toEqual(issued.issuances);
  expect(businessMutations).toBe(0);
  expect(mouseClicks).toBe(0);
  await page.screenshot({
    path: path.join(evidence, "g1-keyboard-resumed-issued.png"),
    fullPage: true,
  });
  await saveKeyboardMetrics(evidence, "PASS");
  await fs.writeFile(
    path.join(evidence, "g1-result.json"),
    JSON.stringify(
      {
        status: "PASS",
        suiteRunId: fullSuiteRunId(),
        preparationEvidence: directory,
        requestId: checkpoint.requestId,
        keyboardOnlyInApp: true,
        actualMouseClicks: mouseClicks,
        continuationBusinessMutations: businessMutations,
        noRepeatIssueOrRender: true,
        preparedKeyboardMetrics: preparedMetrics,
        keyboardMetrics,
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
  await fullSuiteApiCooldown(evidence, "g1-keyboard-resume-after-file-readback");
});

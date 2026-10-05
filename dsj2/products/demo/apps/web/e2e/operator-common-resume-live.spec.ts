import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import {
  fullSuiteApiCooldown,
  fullSuiteRunId,
  preparedCheckpointDirectory,
  requireFullCheckpointIdentity,
} from "./operator-full-suite";
import { loginIsolated } from "./operator-full-fix-session";
import {
  readCommon,
  commonEvidence,
  verifyCommonFiles,
  type CommonCheckpoint,
} from "./operator-common-history-helpers";

test.use({ trace: "off" });
const evidence = commonEvidence("resume");
test("resume the fresh 100-recipient checkpoint, read real saved files and preserve employer history without repeating issue or copying prior assignments", async ({
  page,
}) => {
  test.setTimeout(3600000);
  const preparationDirectory = preparedCheckpointDirectory("common");
  if (!preparationDirectory)
    throw new Error("FRESH_COMMON_CHECKPOINT_DIRECTORY_REQUIRED");
  const checkpoint: CommonCheckpoint = JSON.parse(
    await fs.readFile(
      path.join(preparationDirectory, "checkpoint.json"),
      "utf8",
    ),
  );
  expect(checkpoint.version).toBe(2);
  requireFullCheckpointIdentity(checkpoint);
  if (fullSuiteRunId()) {
    const result = JSON.parse(
      await fs.readFile(
        path.join(preparationDirectory, "common-history-result.json"),
        "utf8",
      ),
    );
    requireFullCheckpointIdentity(result);
    expect(result.status).toBe("PASS");
    expect(result.requestId).toBe(checkpoint.requestId);
    expect(checkpoint.status).toBe("FILES_AND_HISTORY_VERIFIED");
  }
  expect(checkpoint.synthetic).toBe(true);
  expect(["ISSUED_WAITING_FILES", "FILES_AND_HISTORY_VERIFIED"]).toContain(
    checkpoint.status,
  );
  await fs.mkdir(evidence, { recursive: true });
  await loginIsolated(page);
  const started = performance.now(),
    before = await readCommon(page, checkpoint.requestId);
  await page.goto(`/requests/${checkpoint.requestId}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const verified = await verifyCommonFiles(page, checkpoint, evidence);
  expect(verified.issued.issuances).toEqual(before.issuances);
  expect(verified.issued.items[0].employerId).toBe(checkpoint.companies[0].id);
  expect(verified.issued.items[0].positionRu).toBe("Должность A до выпуска");
  if (checkpoint.files)
    expect(verified.files.map(({ id, sha256 }) => ({ id, sha256 }))).toEqual(
      checkpoint.files.map(({ id, sha256 }) => ({ id, sha256 })),
    );
  const historyResponse = await page.request.get(
    `/api/recipients/${checkpoint.personId}`,
  );
  expect(historyResponse.ok()).toBe(true);
  const history = await historyResponse.json();
  expect(history.employment).toHaveLength(
    checkpoint.status === "FILES_AND_HISTORY_VERIFIED" ? 2 : 1,
  );
  if (checkpoint.nextId) {
    const next = await readCommon(page, checkpoint.nextId);
    expect(next.items[0].recipientId).toBe(checkpoint.personId);
    expect(next.items[0].employerId).toBe(checkpoint.companies[1].id);
    expect(next.items[0].assignments).toHaveLength(0);
    expect(next.events).toHaveLength(0);
    expect(next.documents).toHaveLength(0);
    await page.goto(`/requests/${checkpoint.nextId}/edit`);
    await expect(
      page.locator('input[data-field-path="items.0.fullNameRu"]'),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Детали получателя 1", exact: true }),
    ).toBeVisible();
  }
  await page.screenshot({
    path: path.join(evidence, "fresh-checkpoint-history-reopened.png"),
    fullPage: true,
  });
  await fs.writeFile(
    path.join(evidence, "common-resume-result.json"),
    JSON.stringify(
      {
        status: "PASS",
        suiteRunId: fullSuiteRunId(),
        preparationDirectory,
        requestId: checkpoint.requestId,
        personId: checkpoint.personId,
        nextId: checkpoint.nextId,
        actualRecipients: 100,
        actualDocuments: verified.issued.documents.length,
        actualDocumentFiles: verified.files.length,
        actualJobs: verified.jobs.length,
        oldSnapshotAndAllFileHashesPreserved: true,
        historyPeriods: history.employment.length,
        resumeDoesNotIssueOrRenderAgain: true,
        reusedPersonHasNoOldAssignmentsDatesOrResults: !!checkpoint.nextId,
        elapsedMs: performance.now() - started,
        humanActiveMs: null,
        files: verified.files,
      },
      null,
      2,
    ),
  );
  await fullSuiteApiCooldown(evidence, "common-resume-after-file-readback");
});

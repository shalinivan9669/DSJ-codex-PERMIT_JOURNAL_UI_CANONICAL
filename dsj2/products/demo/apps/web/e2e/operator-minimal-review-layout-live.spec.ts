import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import { loginRole } from "./operator-role-fixture";

test("approved manual twenty stays readable with accurate common-field exception summary", async ({
  page,
}, testInfo) => {
  const proposalId = process.env.DEMO_REVIEW_PROPOSAL_ID;
  test.skip(
    !proposalId,
    "Requires the existing synthetic manual-twenty proposal ID",
  );
  expect(new URL(process.env.DEMO_ORIGIN!).hostname).toBe("127.0.0.1");
  await loginRole(page, "DIRECTOR");
  await page.goto(`/approvals?proposal=${proposalId}`);
  const summary = page.getByRole("region", {
    name: "Подготовленные данные редакции",
  });
  await expect(summary).toContainText("20 человек · 5 обучений");
  await expect(summary).toContainText("без индивидуальных исключений");
  const table = summary.locator(".approval-course-summary");
  const bounds = await table.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.height).toBeLessThan(1000);
  const cells = await table
    .locator("thead th")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().width),
    );
  expect(Math.max(...cells) / Math.min(...cells)).toBeLessThan(1.2);
  await page.screenshot({
    path: testInfo.outputPath("director-summary-final.png"),
    fullPage: true,
  });
  await fs.writeFile(
    testInfo.outputPath("director-summary-layout.json"),
    JSON.stringify(
      {
        readOnly: true,
        proposalId,
        table: bounds,
        columnWidths: cells,
        summary: await summary.innerText(),
      },
      null,
      2,
    ),
  );
});

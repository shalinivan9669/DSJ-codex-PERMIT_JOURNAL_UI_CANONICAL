import { expect, test, type Download } from "@playwright/test";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import type { Artifact, Draft, Job } from "../lib/types";

test.use({ trace: "off" });

test("real operator validates, previews, explicitly issues, downloads and reopens the same immutable document set", async ({
  page,
}, testInfo) => {
  test.setTimeout(360000);
  const credentialsPath = process.env.DEMO_E2E_PRINT_CREDENTIALS;
  const requestId = process.env.DEMO_E2E_PRINT_REQUEST_ID;
  if (
    !credentialsPath ||
    !requestId ||
    process.env.DEMO_E2E_ISOLATED_TENANT !== "1"
  ) {
    throw new Error(
      "Explicit isolated print fixture and private credentials path are required",
    );
  }
  const credentials = JSON.parse(await fs.readFile(credentialsPath, "utf8"));
  await page.routeWebSocket(/\/_next\/webpack-hmr/, (socket) => socket.close());
  await page.goto("/login");
  await page
    .getByLabel("Электронная почта", { exact: true })
    .fill(credentials.email);
  await page.getByLabel("Пароль", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Заявки на печать", exact: true }),
  ).toBeVisible();
  type Detail = Draft & {
    documents: Array<{ id: string; number: string; templateId: string }>;
    artifacts: Artifact[];
  };
  const read = async () => {
    const response = await page.request.get(`/api/print-requests/${requestId}`);
    expect(response.ok()).toBe(true);
    return (await response.json()) as Detail;
  };
  const before = await read();
  expect(before.status, "Use a fresh, explicitly approved draft fixture").toBe(
    "DRAFT",
  );
  expect(before.documents).toHaveLength(0);
  await page.goto(`/requests/${requestId}/edit`);
  await expect(page.locator(".operator-grid tbody tr")).toHaveCount(
    before.items.length,
  );
  await page.getByRole("button", { name: "Проверить", exact: true }).click();
  await expect(
    page.getByText("Данные прошли проверку", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("print-validation.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Предпросмотр", exact: true }).click();
  const finalize = page.getByRole("button", {
    name: "Оформить комплект",
    exact: true,
  });
  await expect(finalize).toHaveClass(/primary/, { timeout: 240000 });
  const previewDetail = await read();
  expect(previewDetail.status).toBe("DRAFT");
  expect(previewDetail.documents).toHaveLength(0);
  const previewPdf = previewDetail.artifacts.find(
    (artifact) =>
      artifact.provenance === "PREVIEW" &&
      artifact.format?.toUpperCase() === "PDF",
  );
  expect(previewPdf).toBeTruthy();
  const previewCard = page.locator(".artifact-list article").filter({
    has: page.locator(`a[href="/api/artifacts/${previewPdf!.id}"]`),
  });
  const previewResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/artifacts/${previewPdf!.id}?inline=1`),
  );
  await previewCard
    .getByRole("button", { name: "Посмотреть", exact: true })
    .click();
  expect((await previewResponse).ok()).toBe(true);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("print-preview-dialog.png"),
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Закрыть диалог", exact: true })
    .click();
  await finalize.click();
  const confirmation = page.getByRole("dialog", {
    name: "Оформить комплект документов?",
    exact: true,
  });
  await expect(confirmation).toContainText("Сервер назначит номера");
  expect((await read()).status).toBe("DRAFT");
  await page.screenshot({
    path: testInfo.outputPath("print-issuance-confirmation.png"),
  });
  await confirmation
    .getByRole("button", { name: "Оформить", exact: true })
    .click();
  await expect(confirmation).toHaveCount(0);
  await expect.poll(async () => (await read()).status).toBe("FINALIZED");
  await expect(finalize).toHaveCount(0);
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `/api/jobs?requestId=${requestId}`,
        );
        expect(response.ok()).toBe(true);
        const jobs = (await response.json()).items as Job[];
        const issued = jobs.filter((job) => job.issuanceId);
        return (
          issued.length > 0 &&
          issued.every((job) => job.status === "SUCCEEDED" && !!job.artifactId)
        );
      },
      { timeout: 240000, intervals: [1000, 2500] },
    )
    .toBe(true);
  await page
    .locator(".files-panel")
    .getByRole("button", { name: "Обновить", exact: true })
    .click();
  const issued = await read();
  expect(issued.documents.length).toBeGreaterThan(0);
  expect(issued.items).toEqual(before.items);
  const numbers = issued.documents.map((document) => document.number);
  expect(numbers.every(Boolean)).toBe(true);
  expect(new Set(numbers).size).toBe(numbers.length);
  const downloads: Array<{
    kind: string;
    fileName: string;
    size: number;
    sha256: string;
  }> = [];
  async function keep(download: Download, kind: string) {
    expect(await download.failure()).toBeNull();
    const file = testInfo.outputPath(`${kind}-${download.suggestedFilename()}`);
    await download.saveAs(file);
    const bytes = await fs.readFile(file);
    expect(bytes.length).toBeGreaterThan(100);
    downloads.push({
      kind,
      fileName: download.suggestedFilename(),
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    return bytes;
  }
  for (const kind of ["PDF", "DOCX"] as const) {
    const artifact = issued.artifacts.find(
      (file) => !!file.issuanceId && file.format?.toUpperCase() === kind,
    );
    expect(artifact).toBeTruthy();
    const event = page.waitForEvent("download");
    await page
      .locator(`.artifact-list a[href="/api/artifacts/${artifact!.id}"]`)
      .click();
    const bytes = await keep(await event, kind);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      artifact!.sha256,
    );
    expect(bytes.subarray(0, kind === "PDF" ? 5 : 2).toString()).toBe(
      kind === "PDF" ? "%PDF-" : "PK",
    );
  }
  for (const [kind, label] of [
    ["XLSX", "Реестр XLSX"],
    ["ZIP", "Скачать ZIP"],
  ]) {
    const event = page.waitForEvent("download");
    await page
      .locator(".files-panel")
      .getByRole("button", { name: label, exact: true })
      .click();
    const bytes = await keep(await event, kind);
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
  }
  await page.screenshot({
    path: testInfo.outputPath("print-issued-files.png"),
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator(".operator-grid tbody tr")).toHaveCount(
    before.items.length,
  );
  await expect(
    page.getByRole("button", { name: "Получатель", exact: true }),
  ).toHaveCount(0);
  const reopened = await read();
  expect(reopened.documents).toEqual(issued.documents);
  expect(reopened.artifacts).toEqual(expect.arrayContaining(issued.artifacts));
  expect(reopened.items).toEqual(before.items);
  await fs.writeFile(
    testInfo.outputPath("ui-print-lifecycle-result.json"),
    JSON.stringify(
      {
        status: "PASS",
        requestId,
        requestUrl: page.url(),
        recipients: before.items.length,
        documents: issued.documents,
        downloads,
        validationViaUi: true,
        previewBeforeIssuance: true,
        explicitIssuanceConfirmation: true,
        allInputPreserved: true,
        reopenedImmutableDocumentAndArtifactMetadata: true,
        contentInspection:
          "Separate renderer evidence verifies document contents; this scenario verifies actual UI path and downloaded bytes",
        synthetic: true,
      },
      null,
      2,
    ),
  );
});

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const product = path.resolve(__dirname, "../../..");
const output = path.join(
  product,
  "docs/evidence/functional-completion-20261019/run-01/operations/public-verification",
);
test.use({ trace: "off", screenshot: "only-on-failure", video: "off" });
test.skip(
  process.env.DEMO_FUNCTIONAL_OPERATIONS !== "1",
  "Explicit functional runtime required",
);
test("F21 public exact number and issuer search matches real PDF QR without learner data", async ({
  page,
}) => {
  test.setTimeout(120000);
  expect(process.env.DEMO_ORIGIN).toBe("http://127.0.0.1:3349");
  await mkdir(output, { recursive: true });
  const inspection = JSON.parse(
    readFileSync(
      path.join(
        product,
        "docs/evidence/functional-completion-20261019/run-01/documents/file-inspection.json",
      ),
      "utf8",
    ),
  );
  const qrUrl: string = inspection.find(
    (file: { qrCodes?: string[] }) => file.qrCodes?.length,
  )?.qrCodes[0];
  expect(qrUrl).toMatch(/^http:\/\/127\.0\.0\.1:3349\/verify\/[a-f0-9]{64}$/);
  const qrResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/verification/") &&
      response.request().method() === "GET",
  );
  await page.goto(qrUrl);
  const response = await qrResponse;
  expect(response.ok()).toBe(true);
  const qrRecord = await response.json();
  await expect(
    page.locator("dd").filter({ hasText: qrRecord.document.number }),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(output, "qr-record.png"),
    fullPage: true,
  });
  await page.goto("/login");
  await page
    .getByRole("link", { name: "Проверить документ", exact: true })
    .click();
  await expect(page).toHaveURL(/\/verify$/);
  await page
    .getByLabel("Номер документа", { exact: true })
    .fill(qrRecord.document.number);
  await page
    .getByLabel("Точное название эмитента", { exact: true })
    .fill("Неизвестный учебный центр");
  const unavailable = page.waitForResponse((r) =>
    r.url().endsWith("/api/verification/search"),
  );
  await page
    .getByRole("button", { name: "Проверить документ", exact: true })
    .click();
  expect((await unavailable).status()).toBe(404);
  await expect(page.locator("dl")).toHaveCount(0);
  await page
    .getByLabel("Точное название эмитента", { exact: true })
    .fill(qrRecord.issuer.nameRu);
  const lookup = page.waitForResponse((r) =>
    r.url().endsWith("/api/verification/search"),
  );
  await page
    .getByRole("button", { name: "Проверить документ", exact: true })
    .click();
  const found = await lookup;
  expect(found.ok(), await found.text()).toBe(true);
  const searched = await found.json();
  expect(searched.document).toEqual(qrRecord.document);
  expect(searched.status).toBe(qrRecord.status);
  expect(Object.keys(searched).sort()).toEqual(
    [
      "document",
      "issuer",
      "learningDocument",
      "limitation",
      "replacement",
      "status",
    ].sort(),
  );
  expect(JSON.stringify(searched)).not.toMatch(
    /recipientId|fullName|iin|tenantId|artifactId|tokenHash|email|phone/,
  );
  expect(await page.getByRole("link", { name: /Скачать/ }).count()).toBe(0);
  expect(
    await page
      .getByText("Сообщить об ошибке в документе", { exact: true })
      .count(),
  ).toBe(0);
  await page.screenshot({
    path: path.join(output, "number-record.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "KZ", exact: true }).click();
  await expect(
    page.getByLabel("Құжат берген ұйымның нақты атауы", { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.screenshot({
    path: path.join(output, "number-record-kz-390.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "RU", exact: true }).click();
  await page
    .getByLabel("Номер документа", { exact: true })
    .fill("UNPUBLISHED-NOT-FOUND");
  const missing = page.waitForResponse((r) =>
    r.url().endsWith("/api/verification/search"),
  );
  await page
    .getByRole("button", { name: "Проверить документ", exact: true })
    .click();
  expect((await missing).status()).toBe(404);
  await expect(page.locator("dl")).toHaveCount(0);
  await writeFile(
    path.join(output, "F21-number-qr.json"),
    JSON.stringify(
      {
        status: "PASS",
        issuer: searched.issuer,
        document: searched.document,
        recordStatus: searched.status,
        wrongIssuerUnavailable: true,
        missingNumberUnavailable: true,
        noPersonalData: true,
        noFileLinks: true,
        publicSearchHasNoTokenCorrection: true,
        kz390NoOverflow: true,
        qrFromActualIssuedPdf: true,
      },
      null,
      2,
    ),
  );
});

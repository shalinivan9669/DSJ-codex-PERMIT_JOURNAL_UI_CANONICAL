import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const product = path.resolve(__dirname, "../../..");
const enabled = process.env.DEMO_FUNCTIONAL_OPERATIONS === "1";
const output = path.join(
  product,
  "docs/evidence/functional-completion-20261019/run-01/operations/browser",
);
const state = () =>
  JSON.parse(
    readFileSync(
      path.join(
        product,
        ".runtime/functional-completion-20261019/run-01/onboarding-result.private.json",
      ),
      "utf8",
    ),
  );
test.use({ trace: "off", screenshot: "off", video: "off" });
test.describe.configure({ mode: "serial" });
test.skip(!enabled, "Explicit isolated functional clean runtime required");
test.beforeEach(async () => {
  expect(process.env.DEMO_ORIGIN).toBe("http://127.0.0.1:3350");
  await mkdir(output, { recursive: true });
});
async function login(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByRole("button", { name: "RU", exact: true }).click();
  await page.getByLabel("Электронная почта", { exact: true }).fill(user.email);
  await page.getByLabel("Пароль", { exact: true }).fill(user.password);
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/auth/login") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  expect((await response).status()).toBe(201);
  await expect(page).not.toHaveURL(/\/login/);
}
async function save(name: string, value: unknown) {
  await writeFile(path.join(output, name), JSON.stringify(value, null, 2));
}

test("F15 forms UI: upload ordinary and LMS DOCX, actual previews, approval and reload", async ({
  page,
}) => {
  test.setTimeout(480000);
  await login(page, state().users.superAdmin);
  await page.goto("/settings?tab=templates");
  const initial = await page.request
    .get("/api/settings/templates")
    .then((r) => r.json());
  const results = [];
  for (const templateId of ["ptm-card", "lms-certificate"]) {
    const source = initial.items.find(
      (item: any) => item.templateId === templateId,
    );
    expect(source).toBeTruthy();
    const version = `functional-${Date.now()}`;
    const editor = page.locator("details").filter({
      has: page.locator("summary", {
        hasText: /^Добавить форму или новую версию$/,
      }),
    });
    if ((await editor.getAttribute("open")) === null)
      await editor.locator("summary").click();
    await page
      .getByRole("combobox", { name: "Исходная форма", exact: true })
      .selectOption(source.id);
    const sourceDownload = page.waitForEvent("download");
    await editor
      .getByRole("link", { name: "Скачать исходный DOCX", exact: true })
      .click();
    await (
      await sourceDownload
    ).saveAs(path.join(output, `${templateId}-source.docx`));
    await editor.getByLabel("Новая версия", { exact: true }).fill(version);
    await editor
      .getByLabel("Форма DOCX", { exact: true })
      .setInputFiles(path.join(output, `${templateId}-source.docx`));
    const uploaded = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/settings/templates/upload") &&
        r.request().method() === "POST",
      { timeout: 150000 },
    );
    await editor
      .getByRole("button", {
        name: "Проверить и сохранить версию",
        exact: true,
      })
      .click();
    const result = await uploaded;
    expect(result.ok(), await result.text()).toBe(true);
    const form = await result.json();
    expect(form.approved).toBe(false);
    expect(form.contract.preview.sampleOnly).toBe(true);
    const samples = page.locator("details").filter({
      has: page.locator("summary", { hasText: /^Образцы и исходные файлы$/ }),
    });
    if ((await samples.getAttribute("open")) === null)
      await samples.locator(":scope > summary").click();
    const row = samples.locator("li").filter({ hasText: version });
    for (const ext of ["DOCX", "PDF"]) {
      const download = page.waitForEvent("download");
      await row
        .getByRole("link", { name: `Образец ${ext}`, exact: true })
        .click();
      const file = await download;
      const destination = path.join(
        output,
        `${templateId}-preview.${ext.toLowerCase()}`,
      );
      await file.saveAs(destination);
      const bytes = readFileSync(destination);
      expect(bytes.subarray(0, ext === "PDF" ? 4 : 2).toString()).toBe(
        ext === "PDF" ? "%PDF" : "PK",
      );
    }
    const card = page
      .locator(".template-list article")
      .filter({ hasText: version });
    await card
      .getByRole("button", { name: "Подтвердить форму", exact: true })
      .click();
    await expect(card.getByText("Подтверждена", { exact: true })).toBeVisible();
    await page.reload();
    await expect(
      page
        .locator(".template-list article")
        .filter({ hasText: version })
        .getByText("Подтверждена", { exact: true }),
    ).toBeVisible();
    results.push({
      templateId,
      id: form.id,
      version,
      checksum: form.checksum,
      sampleOnly: true,
      approved: true,
      reload: true,
    });
  }
  await page.screenshot({
    path: path.join(output, "forms-approved.png"),
    fullPage: true,
  });
  await save("F15-forms-ui.json", {
    result: "PASS",
    actions: "UI upload, preview downloads, approval, reload",
    results,
  });
});

test("F18 reports UI: organizations with zero learning, real CSV and viewer read-only", async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  const setup = state();
  await login(page, setup.users.superAdmin);
  await page.goto("/lms/reports");
  await page
    .getByRole("combobox", { name: "Вид отчёта", exact: true })
    .selectOption("ORGANIZATION_DIRECTORY");
  await page
    .getByLabel("Поиск организации / БИН", { exact: true })
    .fill(setup.organizations[1].nameRu);
  const rows = page.getByRole("region", { name: "Строки отчёта", exact: true });
  await expect(rows).toContainText(setup.organizations[1].nameRu);
  const row = rows
    .getByRole("row")
    .filter({ hasText: setup.organizations[1].nameRu });
  expect(await row.getByRole("cell").allTextContents()).toEqual(
    expect.arrayContaining(["0"]),
  );
  await page
    .getByRole("combobox", { name: "Формат", exact: true })
    .selectOption("CSV");
  await page
    .getByRole("button", { name: "Сформировать отчёт", exact: true })
    .click();
  await expect(page.getByText("Отчёт готов", { exact: true })).toBeVisible({
    timeout: 90000,
  });
  const download = page.waitForEvent("download");
  await page
    .getByRole("region", { name: "Подготовка отчёта", exact: true })
    .getByRole("button", { name: "Скачать", exact: true })
    .click();
  const filePath = path.join(output, "organizations-zero.csv");
  await (await download).saveAs(filePath);
  expect(readFileSync(filePath, "utf8")).toContain(
    setup.organizations[1].nameRu,
  );
  await page.screenshot({
    path: path.join(output, "organizations-zero.png"),
    fullPage: true,
  });
  const session = await browser.newContext();
  const viewer = await session.newPage();
  try {
    await login(viewer, setup.users.viewer);
    await viewer.goto("/lms/reports");
    await viewer
      .getByRole("combobox", { name: "Вид отчёта", exact: true })
      .selectOption("ORGANIZATION_DIRECTORY");
    await expect(
      viewer.getByRole("region", { name: "Строки отчёта", exact: true }),
    ).toContainText(setup.organizations[1].nameRu);
    await expect(
      viewer.getByRole("button", { name: "Сформировать отчёт", exact: true }),
    ).toHaveCount(0);
    await expect(viewer.getByRole("alert")).toHaveText("");
    await viewer.reload();
    await expect(
      viewer.getByRole("region", { name: "Строки отчёта", exact: true }),
    ).toContainText(setup.organizations[1].nameRu);
    await viewer.screenshot({
      path: path.join(output, "viewer-reports.png"),
      fullPage: true,
    });
  } finally {
    await session.close();
  }
  await save("F18-reports-ui.json", {
    result: "PASS",
    organizationId: setup.organizations[1].id,
    includesZero: true,
    csvDownloaded: true,
    viewerReadOnly: true,
    reload: true,
  });
});

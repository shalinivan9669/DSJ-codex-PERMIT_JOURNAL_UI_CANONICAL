import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { trainingDirection } from "@demo/contracts";
import type { Draft } from "../lib/types";
import { loginRole } from "./operator-role-fixture";

async function readDraft(page: Page, id: string) {
  const response = await page.request.get(`/api/print-requests/${id}`);
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as Draft;
}

test("one actual 400-row Excel upload, common courses and one director decision preserve the whole company request", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(600_000);
  const origin = new URL(process.env.DEMO_ORIGIN || "http://127.0.0.1:3135");
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(origin.hostname);
  expect(process.env.DEMO_E2E_ISOLATED_TENANT).toBe("1");
  const operator = await loginRole(page, "OPERATOR");
  const directorContext = await browser.newContext({ baseURL: origin.origin });
  const actions: string[] = [];
  const network: {
    path: string;
    method: string;
    status?: number;
    error?: string;
  }[] = [];
  page.on("requestfailed", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/"))
      network.push({
        path: pathname,
        method: request.method(),
        error: request.failure()?.errorText,
      });
  });
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (pathname.includes("/imports/") || response.status() >= 400)
      network.push({
        path: pathname,
        method: response.request().method(),
        status: response.status(),
      });
  });
  const started = Date.now();
  const resumedId = process.env.DEMO_E2E_SCALE_REQUEST_ID;
  if (resumedId) expect(resumedId).toMatch(/^[a-f0-9-]{36}$/);
  const company = `СИНТЕТИЧЕСКИЙ Excel 400 ${randomUUID().slice(0, 8)}`;
  const workbook = testInfo.outputPath("synthetic-400.xlsx");
  const productRoot = path.resolve(__dirname, "../../..");
  // Chromium file uploads on Windows must receive a path below MAX_PATH.
  // Keep the exact workbook in evidence too, without uploading its long path.
  const uploadWorkbook = path.join(
    productRoot,
    ".runtime",
    `excel-400-${randomUUID()}.xlsx`,
  );
  if (!resumedId)
    execFileSync(
      process.env.DEMO_PYTHON ||
        path.join(productRoot, ".runtime/venv/Scripts/python.exe"),
      [
        path.join(
          productRoot,
          "scripts/verification/generate-import-scale-fixture.py",
        ),
        uploadWorkbook,
        "400",
        company,
      ],
      { windowsHide: true, stdio: "pipe" },
    );
  if (!resumedId) await fs.copyFile(uploadWorkbook, workbook);
  try {
    const directorPage = await directorContext.newPage();
    const director = await loginRole(directorPage, "DIRECTOR");
    expect(director.session.tenant.id).toBe(operator.session.tenant.id);
    let id = resumedId || "";
    let imported: Draft;
    if (resumedId) {
      await page.goto(`/requests/${resumedId}/edit`);
      imported = await readDraft(page, resumedId);
      expect(imported.items).toHaveLength(400);
      actions.push(
        "Продолжить через UI ранее импортированную настоящим XLSX заявку после исправления preflight",
      );
    } else {
      await page.goto("/requests/new");
      await page
        .getByRole("radio", { name: "Организация", exact: true })
        .check();
      await page.getByRole("button", { name: "Далее", exact: true }).click();
      actions.push("Выбрать организацию и создать одну заявку");
      await expect(page).toHaveURL(/\/requests\/[a-f0-9-]+\/edit$/);
      id = /\/requests\/([a-f0-9-]+)\/edit$/.exec(page.url())![1];
      await page.getByLabel("Название компании", { exact: true }).fill(company);
      // Normal save/import flush persists the company, without another required
      // directory-creation confirmation or an API-injected customer.
      actions.push("Ввести неизвестное название компании один раз");
      await page.getByRole("button", { name: "Импорт", exact: true }).click();
      const dialog = page.getByRole("dialog", {
        name: "Импорт получателей",
        exact: true,
      });
      await dialog.locator('input[type="file"]').setInputFiles(uploadWorkbook);
      actions.push(
        "Выбрать настоящий XLSX с 400 людьми; автоматическое чтение и сопоставление",
      );
      await expect(
        dialog.getByText("Прочитано: 400", { exact: true }),
      ).toBeVisible();
      await expect(dialog).toContainText(
        "Повторно выбирать поля не требуется.",
      );
      await expect(
        dialog.getByRole("combobox", { name: /^Поле для колонки/ }),
      ).toHaveCount(0);
      await expect(dialog.locator(".import-preview tbody tr")).toHaveCount(50);
      await expect(dialog).toContainText(
        "В импорт входят все 400 выбранных строк",
      );
      await dialog
        .getByRole("button", {
          name: "Добавить 400 строк в черновик",
          exact: true,
        })
        .click();
      actions.push("Подтвердить весь состав одним действием");
      await expect(dialog).toHaveCount(0);
      await expect
        .poll(async () => (await readDraft(page, id)).items.length)
        .toBe(400);
      imported = await readDraft(page, id);
    }
    expect(imported.kind).toBe("COMPANY");
    expect(imported.customerId).toBeTruthy();
    expect(imported.items[399].personnelNumber).toBe("000400");
    expect(imported.items[399].sourceRow).toBe(401);
    expect(new Set(imported.items.map((row) => row.id)).size).toBe(400);
    expect(new Set(imported.items.map((row) => row.importId)).size).toBe(1);
    for (const course of resumedId ? [] : ["БиОТ", "ПТМ", "ПБ"]) {
      await page
        .getByRole("button", {
          name: `${course}: добавить всем в заявке (400)`,
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("button", {
          name: `${course}: снять у этой группы (400)`,
          exact: true,
        }),
      ).toHaveAttribute("aria-pressed", "true");
      actions.push(`Назначить ${course} один раз всему составу`);
    }
    const coursesWithRequiredHours: string[] = [];
    for (const course of resumedId ? [] : ["ПТМ", "ПБ"]) {
      const hours = page.getByLabel(`${course} · Часы программы`, {
        exact: true,
      });
      if (!(await hours.count())) continue;
      await hours.fill("16");
      coursesWithRequiredHours.push(course === "ПТМ" ? "PTM" : "PB");
      actions.push(
        `Ввести синтетические 16 часов для ${course} один раз всему составу: фактические часы неизвестны и не выводятся из названия курса`,
      );
    }
    await expect
      .poll(async () => {
        const saved = await readDraft(page, id);
        return (
          coursesWithRequiredHours.every((direction) =>
            saved.events?.some(
              (event) =>
                trainingDirection(event.protocolTemplateId) === direction &&
                String(event.commonFields.hours) === "16",
            ),
          ) &&
          saved.items.every(
            (row) =>
              new Set(
                row.assignments.map((assignment) =>
                  trainingDirection(assignment.templateId),
                ),
              ).size === 3 &&
              row.assignments.every(
                (assignment) => assignment.outcome?.status === "PASSED",
              ),
          )
        );
      })
      .toBe(true);
    await page.reload();
    const saved = await readDraft(page, id);
    expect(saved.items).toHaveLength(400);
    expect(saved.approval?.status).not.toBe("PENDING");
    expect(
      saved.items.map((row) => [row.id, row.sourceRow, row.personnelNumber]),
    ).toEqual(
      imported.items.map((row) => [row.id, row.sourceRow, row.personnelNumber]),
    );
    await fs.writeFile(
      testInfo.outputPath("excel-400-saved.json"),
      JSON.stringify(
        {
          requestId: id,
          resumedRequest: !!resumedId,
          sourceWorkbook: resumedId
            ? "previous real XLSX upload"
            : "synthetic-400.xlsx",
          people: saved.items.length,
          assignments: saved.items.reduce(
            (sum, row) => sum + row.assignments.length,
            0,
          ),
          sources: saved.items.map((row) => ({
            id: row.id,
            sourceRow: row.sourceRow,
            personnelNumber: row.personnelNumber,
          })),
          events: saved.events,
          actions,
        },
        null,
        2,
      ),
    );
    const readiness = page.getByRole("region", {
      name: "Готовность и состав следующего выпуска",
    });
    const submit = readiness.getByRole("button", {
      name: /^Проверить и передать директору.*400 человек/,
    });
    await readiness
      .getByLabel(/^Все подтверждённые ещё не оформленные курсы/)
      .check();
    const validated = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/print-requests/${id}/approval/submit`),
      { timeout: 220_000 },
    );
    const validationStarted = Date.now();
    await submit.click();
    actions.push(
      "Проверить готовый состав и передать директору одной командой",
    );
    const validationResponse = await validated;
    const validationElapsedMs = Date.now() - validationStarted;
    expect(validationResponse.ok(), await validationResponse.text()).toBe(true);
    const validation = await validationResponse.json();
    expect(validation.approval.status).toBe("PENDING");
    expect(validation.approval.assignments).toHaveLength(
      saved.items.reduce((total, row) => total + row.assignments.length, 0),
    );
    await expect(
      page.getByRole("region", { name: "Проверка заполнения", exact: true }),
    ).toContainText("1203 документов");
    await expect
      .poll(async () => (await readDraft(page, id)).approval?.status, {
        timeout: 210_000,
      })
      .toBe("PENDING");
    const submitted = await readDraft(page, id);
    await directorPage.goto(
      `/approvals?proposal=${submitted.approval!.proposalId}`,
    );
    await expect(
      directorPage.getByRole("button", {
        name: "Согласовать эту редакцию",
        exact: true,
      }),
    ).toBeEnabled();
    await directorPage.screenshot({
      path: testInfo.outputPath("director-400-ready.png"),
      fullPage: true,
    });
    await directorPage
      .getByRole("button", { name: "Согласовать эту редакцию", exact: true })
      .click();
    actions.push(
      "Директор: открыть готовую редакцию, просмотреть, согласовать одной командой",
    );
    await expect
      .poll(async () => (await readDraft(page, id)).approval?.status)
      .toBe("APPROVED");
    const approved = await readDraft(page, id);
    expect(approved.items).toEqual(submitted.items);
    expect(approved.events).toEqual(submitted.events);
    await fs.writeFile(
      testInfo.outputPath("excel-400-readback.json"),
      JSON.stringify(
        {
          synthetic: true,
          realWorkbook: true,
          createdThroughUi: !resumedId,
          importedThroughUi: !resumedId,
          resumedRequest: !!resumedId,
          apiFixtureInjection: false,
          requestId: id,
          people: approved.items.length,
          approvedRevision: approved.approvedRevision,
          customerId: approved.customerId,
          importedSources: approved.items.map((row) => ({
            id: row.id,
            sourceRow: row.sourceRow,
            personnelNumber: row.personnelNumber,
          })),
          validation,
          validationElapsedMs,
          actions,
          elapsedMs: Date.now() - started,
          repeatedCommonInputs: 0,
          perPersonDialogs: 0,
          manualFileSplits: 0,
          directorDecisions: 1,
        },
        null,
        2,
      ),
    );
  } finally {
    await fs.writeFile(
      testInfo.outputPath("network-status.json"),
      JSON.stringify(network, null, 2),
    );
    await directorContext.close();
  }
});

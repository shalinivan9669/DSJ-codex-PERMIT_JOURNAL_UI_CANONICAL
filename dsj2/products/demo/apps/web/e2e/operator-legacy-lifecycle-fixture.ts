import { expect, type Browser, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { draftPayload } from "../lib/types";
import {
  assertUnsignedDelivery,
  knownPrintInput,
  readPrintDetail,
  realApprovalRoles,
  waitOriginalJobs,
  write,
} from "./operator-role-fixture";

export async function legacyPrintFixture(
  page: Page,
  browser: Browser,
  options: Parameters<typeof knownPrintInput>[1] & {
    count?: number;
    renderTimeout?: number;
  } = {},
) {
  const roles = await realApprovalRoles(browser, page);
  await roles.configureSignatories();
  let customerId = options.customerId;
  if (options.kind === "COMPANY" && !customerId)
    customerId = (
      await write(page, roles.operator.headers, "/customers", {
        nameRu: "Тест Альфа",
        nameKz: "Тест Альфа",
      })
    ).id;
  const created = await write(
    page,
    roles.operator.headers,
    "/print-requests",
    knownPrintInput(options.count || 1, { ...options, customerId }),
  );
  const id = created.id as string;
  const read = () => readPrintDetail(page, id);
  await page.goto(`/requests/${id}/edit`);
  return {
    roles,
    id,
    read,
    async patch(change: (draft: Awaited<ReturnType<typeof read>>) => void) {
      const current = await read();
      change(current);
      await write(
        page,
        roles.operator.headers,
        `/print-requests/${id}`,
        { expectedRevision: current.revision, draft: draftPayload(current) },
        "PATCH",
      );
      await page.reload();
    },
    async issue() {
      await page
        .getByRole("button", { name: "Проверить данные", exact: true })
        .click();
      await expect(
        page.getByText("Данные прошли проверку", { exact: true }),
      ).toBeVisible({ timeout: 180000 });
      await roles.approve(id);
      await page.reload();
      await page
        .getByRole("button", { name: "Сформировать документы", exact: true })
        .click();
      await expect.poll(async () => (await read()).status).toBe("FINALIZED");
      await waitOriginalJobs(page, id, options.renderTimeout);
      await page
        .locator(".files-panel")
        .getByRole("button", { name: "Обновить", exact: true })
        .click();
      await assertUnsignedDelivery(page, id, roles.operator.headers);
      return read();
    },
  };
}

export async function openLegacyPersonal(page: Page, row = 1) {
  await page
    .getByRole("button", { name: `Детали получателя ${row}`, exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: `Настройки строки ${row}`,
    exact: true,
  });
  await dialog.getByRole("tab", { name: "Личные данные", exact: true }).click();
  return dialog;
}
export async function setLegacyKz(page: Page, value: string, row = 1) {
  const dialog = await openLegacyPersonal(page, row);
  await dialog.locator("summary", { hasText: "Казахский вариант" }).click();
  await dialog.getByLabel("ФИО · KZ", { exact: true }).fill(value);
  await dialog
    .getByRole("button", { name: "Вернуться к списку", exact: true })
    .click();
}
export async function savedLegacyDraft(page: Page) {
  await page.getByLabel("ФИО, строка 1", { exact: true }).blur();
  await expect(page.locator(".save-indicator")).toContainText(/сохранена/i);
}
export async function keepLegacyOriginals(
  page: Page,
  id: string,
  folder: string,
) {
  await fs.mkdir(folder, { recursive: true });
  const detail = await readPrintDetail(page, id);
  const files = [];
  for (const artifact of detail.artifacts.filter(
    (a) =>
      a.provenance === "ORIGINAL" && ["PDF", "DOCX"].includes(a.format || ""),
  )) {
    const response = await page.request.get(`/api/artifacts/${artifact.id}`);
    expect(response.ok(), await response.text()).toBe(true);
    const bytes = await response.body();
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      artifact.sha256,
    );
    const filename = `${artifact.id}.${artifact.format!.toLowerCase()}`;
    await fs.writeFile(path.join(folder, filename), bytes);
    files.push({
      id: artifact.id,
      sha256: artifact.sha256,
      format: artifact.format,
      filename,
      bytes,
    });
  }
  return files;
}

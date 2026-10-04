import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { draftSchema, isTechnicalBlankRow } from "@demo/contracts";
import {
  newAssignment,
  newRecipient,
  type Draft,
  type Customer,
} from "../lib/types";
import { loginIsolated } from "./operator-full-fix-session";

async function readDraft(page: Page, id: string) {
  const response = await page.request.get(`/api/print-requests/${id}`);
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as Draft;
}

test("actual operator saves quick Excel paste and Undo, preserves blank versus partial people, and applies a staged company once after reload", async ({
  page,
}, testInfo) => {
  const headers = await loginIsolated(page);
  const suffix = randomUUID().slice(0, 8);
  const input = draftSchema.parse({
    kind: "COMPANY",
    demoMode: true,
    title: `Синтетический сквозной ввод ${suffix}`,
    businessRuleVersion: "LIVE_V1",
    schemaVersion: 2,
    commonFields: { documentDate: "2026-10-04" },
    items: [0, 1].map(() => ({
      ...newRecipient(),
      assignments: [newAssignment("ptm-card")],
    })),
  });
  const create = await page.request.post("/api/print-requests", {
    headers: {
      ...headers,
      "idempotency-key": `remaining-input-${randomUUID()}`,
    },
    data: input,
  });
  expect(create.ok(), await create.text()).toBe(true);
  const created = (await create.json()) as Draft;
  const id = created.id;
  const starting = await readDraft(page, id);
  const rowIds = starting.items.map((item) => item.id);
  expect(starting.items.every(isTechnicalBlankRow)).toBe(true);
  await page.goto(`/requests/${id}/edit`);
  await expect(page.getByLabel("ФИО, строка 1", { exact: true })).toBeVisible();
  await page
    .getByLabel("ФИО, строка 1", { exact: true })
    .evaluate((element) => {
      const clipboard = new DataTransfer();
      clipboard.setData(
        "text/plain",
        "Синтетический Первый\tСлесарь\tСлесарь\nСинтетический Второй\tМастер\tШебер",
      );
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: clipboard,
        }),
      );
    });
  await expect(
    page.getByRole("dialog", { name: "Вставка диапазона в заявку" }),
  ).toHaveCount(0);
  await expect
    .poll(async () =>
      (await readDraft(page, id)).items.map((item) => item.fullNameRu),
    )
    .toEqual(["Синтетический Первый", "Синтетический Второй"]);
  const pasted = await readDraft(page, id);
  expect(pasted.items.map((item) => item.id)).toEqual(rowIds);
  expect(pasted.items.map((item) => item.positionKz)).toEqual([
    "Слесарь",
    "Шебер",
  ]);
  expect(pasted.revision).toBeGreaterThan(starting.revision);
  await page
    .getByRole("button", { name: "Отменить массовое изменение", exact: true })
    .click();
  await expect
    .poll(async () =>
      (await readDraft(page, id)).items.every(isTechnicalBlankRow),
    )
    .toBe(true);
  const undone = await readDraft(page, id);
  expect(undone.items.map((item) => item.id)).toEqual(rowIds);
  await page.reload();
  await expect(page.getByLabel("ФИО, строка 2", { exact: true })).toHaveValue(
    "",
  );
  await page
    .getByRole("button", { name: "Удалить получателя 2", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Убрать получателя из заявки?" }),
  ).toHaveCount(0);
  await expect
    .poll(async () => (await readDraft(page, id)).items.length)
    .toBe(1);
  await page
    .getByRole("button", { name: "Восстановить получателя", exact: true })
    .click();
  await expect
    .poll(async () => (await readDraft(page, id)).items.length)
    .toBe(2);
  await page
    .getByLabel("Должность · RU, строка 2", { exact: true })
    .fill("Синтетический незавершённый человек");
  await expect
    .poll(async () => (await readDraft(page, id)).items[1].positionRu)
    .toBe("Синтетический незавершённый человек");
  expect(isTechnicalBlankRow((await readDraft(page, id)).items[1])).toBe(false);
  await page
    .getByRole("button", { name: "Удалить получателя 2", exact: true })
    .click();
  const removal = page.getByRole("dialog", {
    name: "Убрать получателя из заявки?",
  });
  await expect(removal).toBeVisible();
  await removal.getByRole("button", { name: "Оставить", exact: true }).click();
  const ownName = `«Синтетическая компания ${suffix}»`;
  await page.getByLabel("Название компании", { exact: true }).fill(ownName);
  await page
    .getByRole("combobox", { name: "Форма компании", exact: true })
    .selectOption("IP");
  const listCompanies = async () => {
    const response = await page.request.get(
      `/api/customers?search=${encodeURIComponent(suffix)}`,
    );
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()) as { items: Customer[] };
  };
  expect(
    (await listCompanies()).items.filter((company) =>
      company.nameRu.includes(suffix),
    ),
  ).toHaveLength(0);
  await page.reload();
  await expect(
    page.getByLabel("Название компании", { exact: true }),
  ).toHaveValue(ownName);
  await expect(
    page.getByRole("combobox", { name: "Форма компании", exact: true }),
  ).toHaveValue("IP");
  expect(
    (await listCompanies()).items.filter((company) =>
      company.nameRu.includes(suffix),
    ),
  ).toHaveLength(0);
  await page
    .getByRole("button", { name: "Проверить данные", exact: true })
    .first()
    .click();
  await expect
    .poll(async () => (await readDraft(page, id)).customerId)
    .not.toBeNull();
  const applied = await readDraft(page, id);
  const companyResponse = await page.request.get(
    `/api/customers/${applied.customerId}`,
  );
  expect(companyResponse.ok(), await companyResponse.text()).toBe(true);
  const company = (await companyResponse.json()) as Customer;
  expect(company.legalForm).toBe("IP");
  expect(company.ownNameRu).toBe(ownName);
  expect(company.nameRu).toBe(`ИП ${ownName}`);
  await page
    .getByRole("button", { name: "Проверить данные", exact: true })
    .first()
    .click();
  await expect
    .poll(async () => (await readDraft(page, id)).customerId)
    .toBe(company.id);
  expect(
    (await listCompanies()).items.filter((entry) =>
      entry.nameRu.includes(suffix),
    ),
  ).toHaveLength(1);
  await page.reload();
  await expect(
    page.getByText(company.nameRu, { exact: true }).first(),
  ).toBeVisible();
  const final = await readDraft(page, id);
  expect(final.items.map((item) => item.id)).toEqual(rowIds);
  expect(final.items[1].positionRu).toBe("Синтетический незавершённый человек");
  expect(final.status).toBe("DRAFT");
  await page.screenshot({
    path: testInfo.outputPath("actual-input-company-readback.png"),
    fullPage: true,
  });
  await fs.writeFile(
    testInfo.outputPath("actual-input-readback.json"),
    JSON.stringify(
      {
        synthetic: true,
        mockedApi: false,
        requestId: id,
        revisions: {
          starting: starting.revision,
          pasted: pasted.revision,
          undone: undone.revision,
          final: final.revision,
        },
        rowIds,
        savedPartial: final.items[1].positionRu,
        customer: {
          id: company.id,
          legalForm: company.legalForm,
          nameRu: company.nameRu,
          ownNameRu: company.ownNameRu,
        },
        matchingCards: 1,
        status: final.status,
      },
      null,
      2,
    ),
  );
});

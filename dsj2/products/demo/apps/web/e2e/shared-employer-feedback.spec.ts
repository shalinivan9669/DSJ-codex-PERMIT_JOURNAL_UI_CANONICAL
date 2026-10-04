import { test, expect, type Page } from "@playwright/test";
import { applyBusinessRules, resolveDraft } from "@demo/contracts";
import { openRecipientExtraTools } from "./operator-keyboard-helpers";
import {
  newAssignment,
  newRecipient,
  type Customer,
  type Draft,
} from "../lib/types";

const requestId = "shared-employer-feedback";
const payer: Customer = {
  id: "payer-customer",
  nameRu: "ТОО Заказчик заявки",
  nameKz: "Заказчик заявки ЖШС",
  bin: "111111111111",
  addressRu: "Адрес заказчика",
  addressKz: "Тапсырыс берушінің мекенжайы",
  archived: false,
};
const employer: Customer = {
  id: "chosen-employer",
  nameRu: "ТОО Общий работодатель",
  nameKz: "Общий работодатель ЖШС",
  bin: "222222222222",
  addressRu: "Адрес работодателя",
  addressKz: "Жұмыс берушінің мекенжайы",
  archived: false,
};

async function fixture(page: Page) {
  page.on("pageerror", (error) =>
    console.error("Shared employer page error:", error.stack),
  );
  await page.routeWebSocket(/\/_next\/webpack-hmr/, (socket) => socket.close());
  let draft: Draft = {
    id: requestId,
    revision: 0,
    status: "DRAFT",
    kind: "PERSON",
    title: "Синтетическая проверка общего работодателя",
    customerId: payer.id,
    demoMode: true,
    schemaVersion: 2,
    commonFields: { documentDate: "2026-09-29" },
    items: Array.from({ length: 3 }, (_, index) => ({
      ...newRecipient(),
      id: `person-${index}`,
      fullNameRu: `Синтетический получатель ${index + 1}`,
      fullNameKz: `Тест қатысушысы ${index + 1}`,
      positionRu: "Инженер",
      positionKz: "Инженер",
      ...(index > 0
        ? {
            employerId: `existing-employer-${index}`,
            workplaceRu: `ТОО Существующий работодатель ${index}`,
            workplaceKz: `Существующий работодатель ${index} ЖШС`,
            employerBin: `33333333333${index}`,
            employerAddressRu: `Прежний адрес ${index}`,
            employerAddressKz: `Алдыңғы мекенжай ${index}`,
          }
        : {}),
      assignments: [
        {
          ...newAssignment("ptm-card"),
          id: `manual-document-${index}`,
          documentDate: `2026-08-1${index}`,
          trainingStart: "2026-08-01",
          trainingEnd: "2026-08-08",
          result: "Ранее подтверждённый результат",
          hours: "24",
          fieldOrigins: {
            documentDate: "MANUAL" as const,
            hours: "IMPORTED" as const,
          },
        },
      ],
    })),
  };
  // The current API returns canonical LIVE documents. Keep this mock baseline
  // equally canonical so the employer operation must preserve every document,
  // including the manually entered date and imported hours, byte for byte.
  // Match the real JSON response boundary: undefined optional keys are absent.
  draft = JSON.parse(JSON.stringify(applyBusinessRules(draft))) as Draft;
  const initial = structuredClone(draft);
  initial.items.forEach((item, index) => {
    expect(
      item.assignments.find(
        (assignment) => assignment.id === `manual-document-${index}`,
      ),
    ).toMatchObject({
      documentDate: `2026-08-1${index}`,
      hours: "24",
      fieldOrigins: { documentDate: "MANUAL", hours: "IMPORTED" },
    });
  });
  const customers: Customer[] = [
    payer,
    employer,
    ...initial.items.slice(1).map((item) => ({
      id: item.employerId!,
      nameRu: item.workplaceRu,
      nameKz: item.workplaceKz,
      bin: item.employerBin ?? "",
      addressRu: item.employerAddressRu ?? "",
      addressKz: item.employerAddressKz ?? "",
      archived: false,
    })),
  ];
  let rejectNextSave = false;
  const accepted: Draft[] = [];
  let attempts = 0;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.slice(4);
    const method = route.request().method();
    let value: unknown = { items: [], total: 0 };
    if (path === "/auth/session")
      value = { csrfToken: "synthetic-shared-employer" };
    else if (path === "/context")
      value = {
        user: {
          id: "operator",
          displayName: "Оператор",
          role: "OPERATOR",
          email: "operator@example.invalid",
        },
        tenant: {
          id: "synthetic",
          name: "Синтетический центр",
          timezone: "Asia/Almaty",
          demoOnly: true,
        },
        profile: {
          nameRu: "Синтетический центр",
          nameKz: "Тест",
          addressRu: "",
          addressKz: "",
          cityRu: "",
          cityKz: "",
          approvalBasis: "",
          commission: [],
          approved: true,
        },
        templates: [],
        numbering: {},
      };
    else if (path === `/print-requests/${requestId}/resolved`)
      value = resolveDraft(draft);
    else if (path === `/print-requests/${requestId}`) {
      if (method === "PATCH") {
        attempts++;
        if (rejectNextSave) {
          rejectNextSave = false;
          await route.fulfill({
            status: 500,
            json: { message: "Синтетический отказ сохранения" },
          });
          return;
        }
        const body = route.request().postDataJSON();
        if (body.expectedRevision !== draft.revision) {
          await route.fulfill({
            status: 409,
            json: { message: "Конфликт редакций" },
          });
          return;
        }
        draft = { ...draft, ...body.draft, revision: draft.revision + 1 };
        accepted.push(structuredClone(draft));
        value = { revision: draft.revision };
      } else value = draft;
    } else if (path === "/customers") {
      if (method === "POST") {
        const created = {
          ...route.request().postDataJSON(),
          id: "created-employer",
          archived: false,
        } as Customer;
        customers.push(created);
        value = created;
      } else value = { items: customers, total: customers.length };
    } else if (path.startsWith("/customers/")) {
      value = customers.find(
        (customer) => path === `/customers/${customer.id}`,
      );
      if (!value) {
        await route.fulfill({
          status: 404,
          json: { message: "Организация не найдена" },
        });
        return;
      }
    }
    await route.fulfill({ json: value });
  });
  return {
    initial,
    customers,
    accepted,
    current: () => draft,
    attempts: () => attempts,
    rejectNext: () => {
      rejectNextSave = true;
    },
  };
}

async function openEditor(page: Page) {
  await page.goto(`/requests/${requestId}/edit`);
  await expect(page.getByLabel("ФИО, строка 1", { exact: true })).toBeVisible();
  // This personal legacy request retains its payer in saved data; employer
  // selection below must never change that identity.
}

function sharedDialog(page: Page) {
  return page.getByRole("dialog", {
    name: "Общая организация для людей",
    exact: true,
  });
}

async function recipientEmployerDetails(page: Page, row: number) {
  await page.getByLabel(`ФИО, строка ${row}`, { exact: true }).focus();
  await page
    .getByRole("button", { name: `Детали получателя ${row}`, exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: /^Личные данные/ }).click();
  const employerDetails = dialog.locator("details.employer-document-wording");
  if (
    !(await employerDetails.evaluate(
      (element) => (element as HTMLDetailsElement).open,
    ))
  )
    await employerDetails.locator(":scope > summary").click();
  return dialog;
}

async function chooseEmployer(page: Page) {
  await openRecipientExtraTools(page);
  await page
    .getByRole("button", { name: "Указать место работы", exact: true })
    .click();
  await sharedDialog(page)
    .getByRole("button", { name: "Выбрать организацию", exact: true })
    .click();
  const picker = page.getByRole("dialog", {
    name: "Найти заказчика",
    exact: true,
  });
  await picker
    .getByRole("row")
    .filter({ hasText: employer.nameRu })
    .getByRole("button", { name: "Выбрать", exact: true })
    .click();
  await expect(sharedDialog(page)).toContainText(employer.nameRu);
  await expect(sharedDialog(page)).toContainText(employer.nameKz);
}

function expectPreservedDocuments(before: Draft, after: Draft) {
  expect(after.customerId).toBe(payer.id);
  expect(after.commonFields).toEqual(before.commonFields);
  expect(after.items.map((item) => item.assignments)).toEqual(
    before.items.map((item) => item.assignments),
  );
  expect(
    after.items.map((item) => [
      item.id,
      item.fullNameRu,
      item.fullNameKz,
      item.positionRu,
      item.positionKz,
    ]),
  ).toEqual(
    before.items.map((item) => [
      item.id,
      item.fullNameRu,
      item.fullNameKz,
      item.positionRu,
      item.positionKz,
    ]),
  );
}

function expectEmployer(draft: Draft, index: number) {
  expect(draft.items[index]).toMatchObject({
    employerId: employer.id,
    workplaceRu: employer.nameRu,
    workplaceKz: employer.nameKz,
    employerBin: employer.bin,
    employerAddressRu: employer.addressRu,
    employerAddressKz: employer.addressKz,
  });
}

test("shared employer defaults to empty people and preserves filled employers, payer and manual documents", async ({
  page,
}) => {
  const state = await fixture(page);
  await openEditor(page);
  await chooseEmployer(page);
  const dialog = sharedDialog(page);
  await expect(
    dialog.getByRole("radio", {
      name: "Только людям без места работы",
      exact: true,
    }),
  ).toBeChecked();
  await expect(dialog.getByRole("status")).toContainText("Будет изменено: 1");
  await expect(dialog.getByRole("status")).toContainText(
    "Сохранят своё место работы: 2",
  );
  await dialog
    .getByRole("button", { name: "Применить для 1", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => state.accepted.length).toBe(1);
  expectEmployer(state.current(), 0);
  expect(state.current().items.slice(1)).toEqual(state.initial.items.slice(1));
  expectPreservedDocuments(state.initial, state.current());
  await page.reload();
  const person = await recipientEmployerDetails(page, 1);
  await expect(
    person.locator('[data-field-path="items.0.workplaceRu"]'),
  ).toHaveValue(employer.nameRu);
  await expect(
    person.locator('[data-field-path="items.0.workplaceKz"]'),
  ).toHaveValue(employer.nameKz);
  await expect(state.current().items[1].workplaceKz).toBe(
    state.initial.items[1].workplaceKz,
  );
});

test("explicit replacement targets selected IDs only and changes both language names without changing the payer", async ({
  page,
}) => {
  const state = await fixture(page);
  await openEditor(page);
  await page.getByLabel("Выбрать строку 1", { exact: true }).check();
  await page.getByLabel("Выбрать строку 2", { exact: true }).check();
  await chooseEmployer(page);
  const dialog = sharedDialog(page);
  await dialog
    .getByRole("radio", {
      name: "Всем 2 выбранным, заменив текущее место работы",
      exact: true,
    })
    .check();
  await expect(dialog.getByRole("status")).toContainText("Будет изменено: 2");
  await page.screenshot({
    path: test.info().outputPath("shared-employer-selected-replacement.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Применить для 2", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => state.accepted.length).toBe(1);
  expectEmployer(state.current(), 0);
  expectEmployer(state.current(), 1);
  expect(state.current().items[2]).toEqual(state.initial.items[2]);
  expectPreservedDocuments(state.initial, state.current());
});

test("a failed save retains the shared employer dialog and original recipient data", async ({
  page,
}) => {
  const state = await fixture(page);
  await openEditor(page);
  await chooseEmployer(page);
  const dialog = sharedDialog(page);
  state.rejectNext();
  await dialog
    .getByRole("button", { name: "Применить для 1", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Не удалось сохранить организацию. Повторите попытку.",
  );
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Применить для 1", exact: true }),
  ).toBeEnabled();
  expect(state.attempts()).toBe(1);
  expect(state.accepted).toHaveLength(0);
  expect(state.current()).toEqual(state.initial);
  await page.screenshot({
    path: test.info().outputPath("shared-employer-save-error.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  for (const row of [1, 2]) {
    const person = await recipientEmployerDetails(page, row);
    await expect(
      person.locator(`[data-field-path="items.${row - 1}.workplaceRu"]`),
    ).toHaveValue(state.initial.items[row - 1].workplaceRu);
    await person
      .getByRole("button", { name: "Вернуться к списку", exact: true })
      .click();
    await expect(person).toHaveCount(0);
    await expect(
      page.getByLabel(`ФИО, строка ${row}`, { exact: true }),
    ).toBeFocused();
  }
  expect(state.current()).toEqual(state.initial);
  expect(state.current().customerId).toBe(payer.id);
});

test("shared employer remains within a 390px viewport while the recipient table scrolls independently", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page);
  await openEditor(page);
  await chooseEmployer(page);
  const dialog = sharedDialog(page);
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("radio", {
      name: "Только людям без места работы",
      exact: true,
    }),
  ).toBeChecked();
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(391);
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("shared-employer-mobile-390.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Применить для 1", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => state.accepted.length).toBe(1);
  expectEmployer(state.current(), 0);
  expectPreservedDocuments(state.initial, state.current());
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(391);
});

test("a newly created employer becomes available without reload and does not replace the payer", async ({
  page,
}) => {
  const state = await fixture(page);
  const customerCountBefore = state.customers.length;
  await openEditor(page);
  await openRecipientExtraTools(page);
  await page
    .getByRole("button", { name: "Указать место работы", exact: true })
    .click();
  await sharedDialog(page)
    .getByRole("button", { name: "Новая организация", exact: true })
    .click();
  const createDialog = page.getByRole("dialog", {
    name: "Новая организация",
    exact: true,
  });
  await createDialog
    .getByRole("combobox", { name: "Форма организации", exact: true })
    .selectOption("TOO");
  await createDialog
    .getByRole("textbox", { name: /^Собственное наименование/ })
    .fill("Новый работодатель");
  await createDialog
    .getByRole("button", { name: "Сохранить", exact: true })
    .click();
  await expect(sharedDialog(page)).toContainText("ТОО Новый работодатель");
  await expect(sharedDialog(page)).toContainText("Новый работодатель ЖШС");
  expect(state.current()).toEqual(state.initial);
  await sharedDialog(page)
    .getByRole("button", { name: "Применить для 1", exact: true })
    .click();
  await expect(sharedDialog(page)).toHaveCount(0);
  await expect.poll(() => state.accepted.length).toBe(1);
  expect(state.current().customerId).toBe(payer.id);
  expect(
    state.customers.find((value) => value.id === "created-employer")?.nameRu,
  ).toBe("ТОО Новый работодатель");
  expect(state.customers).toHaveLength(customerCountBefore + 1);
  expect(
    state.customers.filter((value) => value.id === "created-employer"),
  ).toHaveLength(1);
  expect(state.current().items[0]).toMatchObject({
    employerId: "created-employer",
    workplaceRu: "ТОО Новый работодатель",
    workplaceKz: "Новый работодатель ЖШС",
  });
  expect(state.current().items.slice(1)).toEqual(state.initial.items.slice(1));
  expectPreservedDocuments(state.initial, state.current());
});

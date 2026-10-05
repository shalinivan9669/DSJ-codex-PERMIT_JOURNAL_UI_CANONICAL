import { test, expect, type Page } from "@playwright/test";
import { applyBusinessRules, resolveDraft } from "@demo/contracts";
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
    kind: "COMPANY",
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
  // The bulk company workspace retains its payer in saved data; explicit
  // recipient employers must never change that separate identity.
}

async function recipientEmployerDetails(page: Page, row: number) {
  const dialog = page.getByRole("dialog", {
    name: `Настройки строки ${row}`,
    exact: true,
  });
  if (!(await dialog.isVisible())) {
    await page.getByLabel(`ФИО, строка ${row}`, { exact: true }).focus();
    await page
      .getByRole("button", { name: `Детали получателя ${row}`, exact: true })
      .click();
  }
  await dialog.getByRole("tab", { name: /^Личные данные/ }).click();
  const details = dialog.locator("details.employer-document-wording");
  if (
    !(await details.evaluate((element) => (element as HTMLDetailsElement).open))
  )
    await details.locator(":scope > summary").click();
  return dialog;
}

async function employerPicker(page: Page, row: number) {
  const dialog = await recipientEmployerDetails(page, row);
  await dialog
    .getByRole("button", { name: "Выбрать работодателя", exact: true })
    .click();
  const picker = page.getByRole("dialog", {
    name: "Найти заказчика",
    exact: true,
  });
  await expect(picker).toBeVisible();
  return picker;
}

async function chooseEmployer(page: Page, row: number) {
  const picker = await employerPicker(page, row);
  await picker
    .getByRole("row")
    .filter({ hasText: employer.nameRu })
    .getByRole("button", { name: "Выбрать", exact: true })
    .click();
  await expect(picker).toHaveCount(0);
  return page.getByRole("dialog", {
    name: `Настройки строки ${row}`,
    exact: true,
  });
}

async function closeDetails(page: Page, row: number) {
  await page
    .getByRole("dialog", { name: `Настройки строки ${row}`, exact: true })
    .getByRole("button", { name: "Вернуться к списку", exact: true })
    .click();
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

test("company inheritance and an explicit person employer preserve other exceptions, payer and manual documents", async ({
  page,
}) => {
  const state = await fixture(page);
  await openEditor(page);
  const initialDetails = await recipientEmployerDetails(page, 1);
  await expect(initialDetails).toContainText(
    `Работодатель заявки: ${payer.nameRu}`,
  );
  await expect(
    initialDetails.locator('[data-field-path="items.0.workplaceRu"]'),
  ).toHaveValue("");
  expect(state.current()).toEqual(state.initial);
  expect(state.accepted).toHaveLength(0);
  const dialog = await chooseEmployer(page, 1);
  await expect.poll(() => state.accepted.length).toBe(1);
  await expect(
    dialog.locator('[data-field-path="items.0.workplaceRu"]'),
  ).toHaveValue(employer.nameRu);
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
  expect(state.current().items[1].workplaceKz).toBe(
    state.initial.items[1].workplaceKz,
  );
});

test("explicit employer exceptions target two stable person IDs and preserve the third person and payer", async ({
  page,
}) => {
  const state = await fixture(page);
  await openEditor(page);
  const targets = state.initial.items.slice(0, 2).map((item) => item.id);
  for (const row of [1, 2]) {
    await chooseEmployer(page, row);
    await expect.poll(() => state.accepted.length).toBe(row);
    await closeDetails(page, row);
  }
  expect(
    state
      .current()
      .items.filter((item) => item.employerId === employer.id)
      .map((item) => item.id),
  ).toEqual(targets);
  expectEmployer(state.current(), 0);
  expectEmployer(state.current(), 1);
  expect(state.current().items[2]).toEqual(state.initial.items[2]);
  expectPreservedDocuments(state.initial, state.current());
  await page.screenshot({
    path: test.info().outputPath("person-employer-two-exceptions.png"),
    fullPage: true,
  });
});

test("cancelled employer selection leaves data intact and a failed exception save retains input until explicit retry", async ({
  page,
}) => {
  const state = await fixture(page);
  await openEditor(page);
  const picker = await employerPicker(page, 1);
  await picker
    .getByRole("button", { name: "Закрыть диалог", exact: true })
    .click();
  expect(state.current()).toEqual(state.initial);
  expect(state.accepted).toHaveLength(0);
  state.rejectNext();
  const dialog = await chooseEmployer(page, 1);
  await expect(page.locator(".save-indicator")).toContainText("Не сохранено");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.locator('[data-field-path="items.0.workplaceRu"]'),
  ).toHaveValue(employer.nameRu);
  expect(state.attempts()).toBe(1);
  expect(state.accepted).toHaveLength(0);
  expect(state.current()).toEqual(state.initial);
  await page.screenshot({
    path: test.info().outputPath("person-employer-save-error.png"),
    fullPage: true,
  });
  await closeDetails(page, 1);
  expect(state.current()).toEqual(state.initial);
  await page
    .getByRole("button", { name: "Повторить сохранение", exact: true })
    .click();
  await expect.poll(() => state.accepted.length).toBe(1);
  expectEmployer(state.current(), 0);
  expect(state.current().items.slice(1)).toEqual(state.initial.items.slice(1));
  expectPreservedDocuments(state.initial, state.current());
});

test("company employer exceptions stay within a 390px details dialog while the person table scrolls independently", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page);
  await openEditor(page);
  const dialog = await recipientEmployerDetails(page, 1);
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
  await chooseEmployer(page, 1);
  await expect.poll(() => state.accepted.length).toBe(1);
  expectEmployer(state.current(), 0);
  expect(state.current().items.slice(1)).toEqual(state.initial.items.slice(1));
  expectPreservedDocuments(state.initial, state.current());
  await page.screenshot({
    path: test.info().outputPath("person-employer-mobile-390.png"),
    fullPage: true,
  });
  await closeDetails(page, 1);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(391);
});

test("a newly created person employer is saved once without reload and does not replace the company payer", async ({
  page,
}) => {
  const state = await fixture(page);
  const customerCountBefore = state.customers.length;
  await openEditor(page);
  const person = await recipientEmployerDetails(page, 1);
  await person
    .getByRole("button", {
      name: "Добавить организацию работодателя",
      exact: true,
    })
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
  expect(state.current()).toEqual(state.initial);
  await createDialog
    .getByRole("button", { name: "Сохранить", exact: true })
    .click();
  await expect(createDialog).toHaveCount(0);
  await expect.poll(() => state.accepted.length).toBe(1);
  await expect(person).toContainText("ТОО Новый работодатель");
  await expect(person).toContainText("Новый работодатель ЖШС");
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

import { test, expect, type Page } from "@playwright/test";
import { resolveDraft } from "@demo/contracts";
import {
  newAssignment,
  newRecipient,
  type Customer,
  type Draft,
} from "../lib/types";

const requestId = "anik-feedback";
const manualDocument = {
  ...newAssignment("ptm-card"),
  id: "existing-manual-document",
  documentDate: "2026-08-15",
  trainingStart: "2026-08-01",
  fieldOrigins: {
    documentDate: "MANUAL" as const,
    trainingStart: "MANUAL" as const,
  },
};

async function fixture(
  page: Page,
  validationErrors: { path: string; itemId: string; message: string }[] = [],
) {
  await page.routeWebSocket(/\/_next\/webpack-hmr/, (socket) => socket.close());
  let draft: Draft = {
    id: requestId,
    revision: 0,
    status: "DRAFT",
    kind: "PERSON",
    title: "Синтетическая проверка удобства заявки",
    customerId: null,
    demoMode: true,
    schemaVersion: 2,
    commonFields: { documentDate: "2026-09-29" },
    items: Array.from({ length: 3 }, (_, index) => ({
      ...newRecipient(),
      id: `person-${index}`,
      fullNameRu: `Синтетический слушатель ${index + 1}`,
      positionRu: "Монтажник",
      assignments: index === 0 ? [structuredClone(manualDocument)] : [],
    })),
  };
  const created: Draft[] = [];
  const customers: Customer[] = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.slice(4);
    const method = route.request().method();
    let value: unknown = { items: [], total: 0 };
    if (path === "/auth/session") value = { csrfToken: "synthetic-fixture" };
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
    else if (path === "/print-requests" && method === "POST") {
      draft = {
        ...route.request().postDataJSON(),
        id: requestId,
        revision: 0,
        status: "DRAFT",
      };
      created.push(structuredClone(draft));
      value = draft;
    } else if (path === `/print-requests/${requestId}/resolved`)
      value = resolveDraft(draft);
    else if (path === `/print-requests/${requestId}/validate`)
      value = { valid: false, errors: validationErrors };
    else if (path === `/print-requests/${requestId}`) {
      if (method === "PATCH") {
        const body = route.request().postDataJSON();
        if (body.expectedRevision !== draft.revision) {
          await route.fulfill({
            status: 409,
            json: { message: "Конфликт редакций" },
          });
          return;
        }
        draft = { ...draft, ...body.draft, revision: draft.revision + 1 };
        value = { revision: draft.revision };
      } else value = draft;
    } else if (path === "/customers") {
      if (method === "POST") {
        const customer = {
          ...route.request().postDataJSON(),
          id: "new-customer",
          archived: false,
        } as Customer;
        customers.push(customer);
        value = customer;
      } else value = { items: customers, total: customers.length };
    } else if (path === "/customers/new-customer") value = customers[0];
    await route.fulfill({ json: value });
  });
  return { current: () => draft, created, customers };
}

async function openEditor(page: Page) {
  await page.goto(`/requests/${requestId}/edit`);
  await expect(
    page.getByLabel("ФИО RU, строка 1", { exact: true }),
  ).toBeVisible();
}

for (const [kind, label] of [
  ["PERSON", "Физическое лицо"],
  ["COMPANY", "Организация"],
] as const) {
  test(`new ${kind} request uses customer radios and starts without assigned documents`, async ({
    page,
  }) => {
    const state = await fixture(page);
    await page.goto("/requests/new");
    await page.getByRole("radio", { name: new RegExp(`^${label}`) }).check();
    await expect(
      page.getByRole("radio", { name: new RegExp(`^${label}`) }),
    ).toBeChecked();
    await page
      .getByRole("button", {
        name: "Перейти к людям и документам",
        exact: true,
      })
      .click();
    await expect(
      page.getByLabel("ФИО RU, строка 1", { exact: true }),
    ).toBeVisible();
    expect(state.created).toHaveLength(1);
    expect(state.created[0].kind).toBe(kind);
    expect(state.created[0].items).toHaveLength(1);
    expect(state.created[0].items[0].assignments).toEqual([]);
    expect(state.created[0].events || []).toEqual([]);
    expect(state.created[0].commonFields?.documentDate).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
    await expect(
      page.getByText("Документы не выбраны", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Заказчик", exact: true }),
    ).toHaveCount(kind === "COMPANY" ? 1 : 0);
  });
}

test("optional worker bundle keeps one shared protocol when a recipient is added", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/requests/new");
  await page.getByRole("radio", { name: /^Организация/ }).check();
  await page
    .getByText("Начать с готового комплекта БиОТ", { exact: true })
    .click();
  await page.getByRole("radio", { name: /^Рабочие —/ }).check();
  await page
    .getByRole("button", { name: "Перейти к людям и документам", exact: true })
    .click();
  await expect(
    page.getByLabel("ФИО RU, строка 1", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Получатель", exact: true }).click();
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect.poll(() => state.current().items.length).toBe(2);
  const draft = state.current();
  expect(draft.kind).toBe("COMPANY");
  expect(draft.events).toHaveLength(1);
  expect(draft.events![0].protocolTemplateId).toBe("biot-protocol");
  for (const person of draft.items) {
    expect(person.assignments).toHaveLength(1);
    expect(person.assignments[0]).toMatchObject({
      templateId: "biot-worker-card",
      protocolMode: "GROUP",
      eventId: draft.events![0].id,
      outcome: { status: "UNKNOWN" },
    });
  }
  await page
    .getByRole("button", {
      name: "Выбрать документы получателя 1",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Выбрать документы",
    exact: true,
  });
  await dialog
    .getByText("Протоколы и дополнительные формы", { exact: true })
    .click();
  await expect(
    dialog.getByRole("checkbox", {
      name: /^БиОТ рабочих — отдельный протокол/,
    }),
  ).toBeChecked();
  await expect(
    dialog.getByRole("checkbox", {
      name: /^БиОТ рабочих — отдельный протокол/,
    }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  expect(state.current().events).toHaveLength(1);
});

test("row and bulk document choices add only missing forms and retain manual dates", async ({
  page,
}) => {
  const state = await fixture(page);
  await openEditor(page);
  await page
    .getByRole("button", {
      name: "Выбрать документы получателя 1",
      exact: true,
    })
    .click();
  let dialog = page.getByRole("dialog", {
    name: "Выбрать документы",
    exact: true,
  });
  await expect(
    dialog.getByRole("checkbox", { name: /^ПТМ — удостоверение/ }),
  ).toBeChecked();
  await expect(
    dialog.getByRole("checkbox", { name: /^ПТМ — удостоверение/ }),
  ).toBeDisabled();
  await dialog.getByRole("checkbox", { name: /^ПБ — удостоверение/ }).check();
  await dialog.getByRole("checkbox", { name: /^ПС — удостоверение/ }).check();
  await page.screenshot({
    path: test.info().outputPath("document-selection.png"),
    fullPage: false,
  });
  await dialog
    .getByRole("button", { name: "Добавить выбранные документы", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => state.current().items[0].assignments.length).toBe(3);
  expect(state.current().items[0].assignments[0]).toEqual(manualDocument);
  expect(state.current().items[1].assignments).toEqual([]);

  await page.getByLabel("Выбрать строку 1", { exact: true }).check();
  await page.getByLabel("Выбрать строку 2", { exact: true }).check();
  await page
    .getByRole("button", { name: "Документы выбранным (2)", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Выбрать документы", exact: true });
  await dialog.getByRole("checkbox", { name: /^ПТМ — удостоверение/ }).check();
  await dialog.getByRole("checkbox", { name: /^ПБ — удостоверение/ }).check();
  await dialog
    .getByRole("button", { name: "Добавить выбранные документы", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => state.current().items[1].assignments.length).toBe(2);
  expect(state.current().items[0].assignments).toHaveLength(3);
  expect(state.current().items[0].assignments[0]).toEqual(manualDocument);
  expect(state.current().items[2].assignments).toEqual([]);

  await page
    .getByRole("button", { name: "Документы выбранным (2)", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Выбрать документы", exact: true });
  for (const label of [/^ПТМ — удостоверение/, /^ПБ — удостоверение/]) {
    await expect(dialog.getByRole("checkbox", { name: label })).toBeChecked();
    await expect(dialog.getByRole("checkbox", { name: label })).toBeDisabled();
  }
  await expect(
    dialog.getByRole("button", {
      name: "Добавить выбранные документы",
      exact: true,
    }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  await page.reload();
  await expect(
    page.getByLabel("ФИО RU, строка 1", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Документы и даты получателя 1", exact: true })
    .click();
  await expect(
    page.getByLabel("Дата документа", { exact: true }).first(),
  ).toHaveValue("2026-08-15");
  expect(state.current().items[0].assignments[0]).toEqual(manualDocument);
});

test("validation opens the hidden date section and focuses its required field", async ({
  page,
}) => {
  await fixture(page, [
    {
      path: "items.0.assignments.0.trainingStart",
      itemId: "person-0",
      message: "Укажите начало обучения первого слушателя",
    },
  ]);
  await openEditor(page);
  await page
    .getByRole("button", { name: "Документы и даты получателя 1", exact: true })
    .click();
  const field = page.locator(
    '[data-field-path="items.0.assignments.0.trainingStart"]',
  );
  await expect(field).toBeHidden();
  await page
    .getByRole("button", { name: "Вернуться к таблице", exact: true })
    .click();
  await page.getByRole("button", { name: "Проверить", exact: true }).click();
  await page
    .getByRole("button", {
      name: /Укажите начало обучения первого слушателя/,
    })
    .click();
  await expect(field).toBeVisible();
  await expect(field).toBeFocused();
});

test("a customer saves with one own name while extra requisites remain optional", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/customers");
  await page
    .getByRole("button", { name: "Добавить заказчика", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Новая организация",
    exact: true,
  });
  await expect(dialog.getByLabel("БИН", { exact: true })).toBeHidden();
  await expect(
    dialog.getByLabel("Адрес на русском", { exact: true }),
  ).toBeHidden();
  await dialog
    .getByRole("combobox", { name: "Форма организации", exact: true })
    .selectOption("TOO");
  await dialog
    .getByRole("textbox", { name: /^Собственное наименование/ })
    .fill("Пример Строй");
  await expect(
    dialog.getByLabel("Полные названия для документов"),
  ).toContainText("ТОО Пример Строй");
  await expect(
    dialog.getByLabel("Полные названия для документов"),
  ).toContainText("Пример Строй ЖШС");
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.customers).toHaveLength(1);
  expect(state.customers[0]).toMatchObject({
    legalForm: "TOO",
    ownNameRu: "Пример Строй",
    ownNameKz: "",
    nameRu: "ТОО Пример Строй",
    nameKz: "Пример Строй ЖШС",
    bin: "",
    addressRu: "",
    addressKz: "",
  });
});

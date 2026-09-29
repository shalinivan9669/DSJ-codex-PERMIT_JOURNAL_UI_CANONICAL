import { openRecipientExtraTools } from "./operator-keyboard-helpers";
import { test, expect, type Page } from "@playwright/test";
import { newAssignment, newRecipient, type Draft } from "../lib/types";

async function mockWorkspace(page: Page) {
  let draft: Draft = {
    id: "ui-contract",
    revision: 0,
    status: "DRAFT",
    kind: "PERSON",
    title: "Синтетическая проверка UI",
    customerId: null,
    demoMode: true,
    items: [
      {
        ...newRecipient(),
        id: "one",
        fullNameRu: "Первый Получатель",
        assignments: [
          { ...newAssignment("pb-card"), id: "pb-one" },
          { ...newAssignment("ptm-card"), id: "ptm-one" },
        ],
      },
      {
        ...newRecipient(),
        id: "two",
        fullNameRu: "Второй Получатель",
        assignments: [
          {
            ...newAssignment("pb-card"),
            id: "pb-two",
            documentDate: "2026-01-01",
          },
        ],
      },
    ],
  };
  const saves: unknown[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.slice(4);
    let result: unknown = {};
    if (path === "/auth/session") result = { csrfToken: "test-csrf" };
    else if (path === "/context")
      result = {
        user: {
          id: "user",
          displayName: "Тестовый оператор",
          email: "synthetic@test.invalid",
          role: "OPERATOR",
        },
        tenant: {
          id: "synthetic",
          name: "Синтетический центр",
          timezone: "Asia/Almaty",
          demoOnly: true,
        },
        profile: {
          nameRu: "Тестовый центр",
          nameKz: "Тест",
          addressRu: "",
          addressKz: "",
          cityRu: "",
          cityKz: "",
          approvalBasis: "Тест",
          commission: [],
          approved: true,
        },
        templates: [],
        numbering: {},
      };
    else if (
      path === "/print-requests/ui-contract" &&
      route.request().method() === "PATCH"
    ) {
      const input = route.request().postDataJSON();
      if (input.expectedRevision !== draft.revision) {
        await route.fulfill({
          status: 409,
          json: { message: "Редакция изменилась" },
        });
        return;
      }
      saves.push(input);
      draft = { ...draft, ...input.draft, revision: draft.revision + 1 };
      result = { revision: draft.revision };
    } else if (path === "/print-requests/ui-contract")
      result = { ...draft, artifacts: [], issuances: [], issuanceEvents: [] };
    else if (
      path === "/customers" ||
      path === "/jobs" ||
      path === "/settings/profiles" ||
      path === "/service-rules"
    )
      result = { items: [], total: 0 };
    else if (/^\/recipients\/saved-\d+$/.test(path))
      result = { employment: [], requests: [] };
    else if (path === "/recipients") {
      const pageNumber = Number(url.searchParams.get("page"));
      result = {
        total: 101,
        page: pageNumber,
        pageSize: 20,
        items: [
          {
            id: `saved-${pageNumber}`,
            data: {
              ...newRecipient(),
              fullNameRu:
                pageNumber === 6
                  ? "Сто первый получатель"
                  : `Сохранённый ${pageNumber}`,
              personnelNumber: pageNumber === 6 ? "00101" : String(pageNumber),
              assignments: [
                {
                  ...newAssignment("pb-card"),
                  documentDate: "2020-01-01",
                  result: "Старый результат",
                },
              ],
            },
          },
        ],
      };
    }
    await route.fulfill({ json: result });
  });
  await page.goto("/requests/ui-contract/edit");
  await expect(page.getByLabel("ФИО RU, строка 1")).toBeVisible();
  await page.getByRole("button", { name: "RU + KZ", exact: true }).click();
  return {
    getDraft: () => draft,
    saves,
    foreignSave: () => {
      draft = {
        ...draft,
        title: "Чужое сохранение",
        revision: draft.revision + 1,
      };
    },
  };
}

test("rectangular paste is one undo operation and conflict preserves another operator save", async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  await page.getByLabel("ФИО RU, строка 1").evaluate((element) => {
    const data = new DataTransfer();
    data.setData("text/plain", "Новый RU\tЖаңа KZ");
    element.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true }),
    );
  });
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Режим вставки").selectOption("REPLACE");
  await dialog
    .getByLabel("Подтверждаю замену значений показанного диапазона")
    .check();
  await dialog.getByRole("button", { name: "Применить диапазон" }).click();
  await expect(dialog).not.toBeVisible();
  expect(state.getDraft().items[0].fullNameRu).toBe("Новый RU");
  expect(state.getDraft().items[0].assignments[1].templateId).toBe("ptm-card");
  state.foreignSave();
  await page
    .getByRole("button", { name: "Отменить массовое изменение" })
    .click();
  await expect(
    page.getByText("Редакция изменилась", { exact: true }),
  ).toBeVisible();
  expect(state.getDraft().title).toBe("Чужое сохранение");
  expect(state.getDraft().items[0].fullNameRu).toBe("Новый RU");
});

test("event set and confirmed outcomes are separate single undo operations", async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  await page.getByLabel("Выбрать видимых получателей").check();
  await page.getByRole("button", { name: "Настроить даты и протоколы" }).click();
  await page
    .getByRole("button", { name: "Добавить событие", exact: true })
    .click();
  await expect(
    page.getByLabel("Название события", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Назначить набор выбранным (2)" })
    .click();
  await expect
    .poll(
      () =>
        state
          .getDraft()
          .items.filter((i) =>
            i.assignments.some((a) => a.protocolMode === "GROUP"),
          ).length,
    )
    .toBe(2);
  const assignmentIds = state
    .getDraft()
    .items.map((item) => item.assignments.map((assignment) => assignment.id));
  await page
    .getByRole("button", { name: "Назначить набор выбранным (2)" })
    .click();
  await expect(
    page.getByRole("button", { name: "Назначить набор выбранным (2)" }),
  ).toBeEnabled();
  expect(
    state
      .getDraft()
      .items.map((item) => item.assignments.map((assignment) => assignment.id)),
  ).toEqual(assignmentIds);
  await page
    .getByRole("button", { name: "Отменить массовое изменение" })
    .click();
  await expect
    .poll(
      () =>
        state
          .getDraft()
          .items.filter((i) =>
            i.assignments.some((a) => a.protocolMode === "GROUP"),
          ).length,
    )
    .toBe(0);
  await page
    .getByRole("button", { name: "Назначить набор выбранным (2)" })
    .click();
  await expect
    .poll(
      () =>
        state
          .getDraft()
          .items.filter((i) =>
            i.assignments.some((a) => a.protocolMode === "GROUP"),
          ).length,
    )
    .toBe(2);
  await page
    .getByText("Подтвердить фактические результаты события", { exact: true })
    .click();
  await page
    .getByLabel("Известный результат", { exact: true })
    .selectOption("PASSED");
  await page
    .getByLabel("Источник подтверждения", { exact: true })
    .fill("Синтетическая ведомость");
  await page
    .getByRole("button", { name: "Проверить применение результатов" })
    .click();
  await page
    .getByRole("button", { name: "Подтвердить результаты", exact: true })
    .click();
  await expect
    .poll(
      () =>
        state
          .getDraft()
          .items[0].assignments.find((a) => a.protocolMode === "GROUP")?.outcome
          ?.status,
    )
    .toBe("PASSED");
  await page
    .getByRole("button", { name: "Отменить массовое изменение" })
    .click();
  await expect
    .poll(
      () =>
        state
          .getDraft()
          .items[0].assignments.find((a) => a.protocolMode === "GROUP")?.outcome
          ?.status,
    )
    .toBe("UNKNOWN");
  expect(
    state
      .getDraft()
      .items[0].assignments.find((a) => a.templateId === "ptm-card")?.result,
  ).toBe("");
});
test("keyboard edits preserve focus order and event common fields undo as one saved operation", async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  const ru = page.getByLabel("ФИО RU, строка 1");
  const kz = page.getByLabel("ФИО KZ, строка 1");
  await ru.focus();
  await page.keyboard.press("Tab");
  await expect(kz).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(ru).toBeFocused();
  await page.keyboard.press("Enter");
  expect(state.getDraft().status).toBe("DRAFT");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Настроить даты и протоколы" }).click();
  await page
    .getByRole("button", { name: "Добавить событие", exact: true })
    .click();
  const before = structuredClone(state.getDraft().events);
  await page
    .getByLabel("Название события", { exact: true })
    .fill("Общий контекст после изменения");
  await page
    .getByRole("textbox", { name: "Название заявки", exact: true })
    .focus();
  const undo = page.getByRole("button", {
    name: "Отменить массовое изменение",
  });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect.poll(() => state.getDraft().events).toEqual(before);
});

test("operator bulk preview applies only selected PB empty dates and supports revision-safe undo", async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  await page.getByLabel("Выбрать видимых получателей").check();
  await page.getByLabel("Поиск в заявке").fill("Первый");
  await expect(page.getByText(/из них скрыто поиском: 1/)).toBeVisible();
  await openRecipientExtraTools(page);
  await page.getByRole("button", { name: "Изменить данные выбранных (2)" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Направление", exact: true })
    .selectOption("pb");
  await dialog
    .getByRole("checkbox", { name: "Дата документа", exact: true })
    .check();
  await dialog
    .getByLabel("Общее значение: Дата документа", { exact: true })
    .fill("2026-09-24");
  await dialog.getByRole("button", { name: "Показать изменения" }).click();
  await expect(
    dialog.getByText("1 человек · 1 назначений · 1 изменений"),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Применить 1 изменений" }).click();
  await expect(dialog).not.toBeVisible();
  expect(state.getDraft().items[0].assignments[0].documentDate).toBe(
    "2026-09-24",
  );
  expect(state.getDraft().items[0].assignments[1].documentDate).toBe("");
  expect(state.getDraft().items[1].assignments[0].documentDate).toBe(
    "2026-01-01",
  );
  await page
    .getByRole("button", { name: "Отменить массовое изменение" })
    .click();
  await expect
    .poll(() => state.getDraft().items[0].assignments[0].documentDate)
    .toBe("");
  expect(state.saves).toHaveLength(2);
});
test("recipient lookup pages beyond first hundred and never reuses historical result or event date", async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  await openRecipientExtraTools(page);
  await page
    .getByRole("button", { name: "Найти человека", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  for (let n = 0; n < 5; n++) {
    await dialog.getByRole("button", { name: "Далее", exact: true }).click();
    await expect(
      dialog.getByText(`Найдено: 101 · страница ${n + 2}`),
    ).toBeVisible();
  }
  await expect(dialog.getByText("Сто первый получатель")).toBeVisible();
  await dialog.getByRole("button", { name: "Выбрать", exact: true }).click();
  await expect(page.getByLabel("ФИО RU, строка 3")).toHaveValue(
    "Сто первый получатель",
  );
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  const reused = state.getDraft().items[2];
  expect(reused.recipientId).toBe("saved-6");
  expect(reused.personnelNumber).toBe("00101");
  // The operator explicitly chooses new documents after reusing personal data.
  expect(reused.assignments).toEqual([]);
});

test("mixed customer output selects employer B, binds its profile and requires explicit partial ZIP with server filename", async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  state.getDraft().customerId = "company-a";
  state.getDraft().status = "FINALIZED";
  state.getDraft().items[0].employerId = "company-a";
  state.getDraft().items[1].employerId = "company-b";
  const profile = (customerId: string, name: string) => ({
    name,
    customerId,
    contact: `Контакт ${name}`,
    columns: [{ field: "fullNameRu", title: "ФИО", type: "TEXT" }],
    rowMode: "PER_ASSIGNMENT",
    sort: "NAME",
    dateFormat: "DD.MM.YYYY",
    language: "ru",
    files: {
      grouping: "BY_PERSON",
      nameFields: ["fullNameRu"],
      includeRegistry: true,
      includeInventory: true,
      includeCoverText: true,
    },
  });
  const profiles = [
    {
      id: "profile-a",
      name: "Профиль А",
      customerId: "company-a",
      profile: profile("company-a", "Профиль А"),
    },
    {
      id: "profile-b",
      name: "Профиль Б",
      customerId: "company-b",
      profile: profile("company-b", "Профиль Б"),
    },
  ];
  let savedProfile: Record<string, unknown> | undefined;
  const exports: {
    customerId: string;
    profile: { customerId: string };
    allowPartial: boolean;
  }[] = [];
  await page.route("**/api/customers/*", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop();
    await route.fulfill({
      json: { id, nameRu: id === "company-a" ? "Компания А" : "Компания Б" },
    });
  });
  await page.route("**/api/customer-export-profiles", async (route) => {
    if (route.request().method() === "POST") {
      savedProfile = route.request().postDataJSON();
      await route.fulfill({ json: { id: "saved-profile" } });
    } else await route.fulfill({ json: { items: profiles } });
  });
  const serverName = "Компания Б — НЕПОЛНЫЙ.zip";
  await page.route(
    "**/api/print-requests/ui-contract/export",
    async (route) => {
      const input = route.request().postDataJSON();
      exports.push(input);
      if (!input.allowPartial)
        await route.fulfill({
          status: 409,
          json: {
            message:
              "Смешанный протокол не включён. Подтвердите частичный комплект.",
          },
        });
      else
        await route.fulfill({
          status: 200,
          body: Buffer.from("PK-synthetic-scoped-bundle"),
          headers: {
            "content-type": "application/zip",
            "content-disposition": `attachment; filename="partial.zip"; filename*=UTF-8''${encodeURIComponent(serverName)}`,
          },
        });
    },
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Настроить выдачу", exact: true })
    .click();
  const company = page.getByRole("combobox", {
    name: "Заказчик этого комплекта",
    exact: true,
  });
  await expect(company).toHaveValue("company-a");
  await expect(company).toContainText("Компания Б");
  await page
    .getByLabel("Контакт получателя комплекта", { exact: true })
    .fill("Чужой контакт А");
  await company.selectOption("company-b");
  await expect(
    page.getByLabel("Контакт получателя комплекта", { exact: true }),
  ).toHaveValue("");
  const stored = page.getByRole("combobox", {
    name: "Сохранённый профиль",
    exact: true,
  });
  await expect(
    stored.getByRole("option", { name: "Профиль А", exact: true }),
  ).toHaveCount(0);
  await stored.selectOption("profile-b");
  await expect(
    page.getByLabel("Контакт получателя комплекта", { exact: true }),
  ).toHaveValue("Контакт Профиль Б");
  await page
    .getByRole("button", { name: "Сохранить профиль", exact: true })
    .click();
  await expect.poll(() => savedProfile?.customerId).toBe("company-b");
  const zip = page.getByRole("button", { name: "Комплект ZIP", exact: true });
  await zip.click();
  await expect(
    page.getByText(
      "Смешанный протокол не включён. Подтвердите частичный комплект.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(exports[0].customerId).toBe("company-b");
  expect(exports[0].profile.customerId).toBe("company-b");
  expect(exports[0].allowPartial).toBe(false);
  await page.getByRole("checkbox", { name: /Разрешить частичный ZIP/ }).check();
  const downloadPromise = page.waitForEvent("download");
  await zip.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(serverName);
  expect(exports[1].allowPartial).toBe(true);
  expect(exports[1].customerId).toBe("company-b");
  expect(state.getDraft().customerId).toBe("company-a");
  await company.selectOption("");
  await expect(zip).toBeDisabled();
});

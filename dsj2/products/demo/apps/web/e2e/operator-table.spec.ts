import { test, expect, type Page } from "@playwright/test";
import { resolveDraft } from "@demo/contracts";
import { newRecipient, type Draft } from "../lib/types";

async function workspace(page: Page, count = 150) {
  page.on("pageerror", (error) =>
    process.stderr.write(`Mock editor page error: ${error.stack}\n`),
  );
  let draft: Draft = {
    id: "operator-table",
    revision: 0,
    status: "DRAFT",
    kind: "COMPANY",
    title: "Проверка ввода списка",
    customerId: null,
    demoMode: true,
    schemaVersion: 2,
    commonFields: {},
    items: Array.from({ length: count }, (_, index) => ({
      ...newRecipient(),
      id: `row-${index}`,
      fullNameRu: `Слушатель ${String(index + 1).padStart(3, "0")}`,
      positionRu: index % 2 ? "Мастер" : "Инженер",
      workplaceRu: "Тестовая организация",
    })),
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.slice(4);
    let value: unknown = { items: [], total: 0 };
    if (path === "/auth/session") value = { csrfToken: "fixture" };
    else if (path === "/print-requests/operator-table/signing")
      value = {
        status: null,
        archived: false,
        providers: {
          EGOV_QR: { available: false, reason: "Synthetic UI fixture" },
          NCALAYER: { available: false },
        },
        documents: [],
        missingBindings: [],
      };
    else if (path === "/context")
      value = {
        user: {
          id: "operator",
          displayName: "Оператор",
          role: "OPERATOR",
          email: "test@example.invalid",
        },
        tenant: {
          id: "test",
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
          approvalBasis: "",
          commission: [],
          approved: true,
        },
        templates: [],
        numbering: {},
      };
    else if (path === "/print-requests/operator-table/resolved")
      value = resolveDraft(draft);
    else if (path === "/print-requests/operator-table/validate")
      value = {
        valid: false,
        errors: [0, 1].map((index) => ({
          path: `items.${index}.positionRu`,
          itemId: `row-${index}`,
          message: `Уточните должность в строке ${index + 1}`,
        })),
      };
    else if (path === "/print-requests/operator-table") {
      if (route.request().method() === "PATCH") {
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
    }
    await route.fulfill({ json: value });
  });
  await page.goto("/requests/operator-table/edit");
  await expect(page.getByLabel("ФИО, строка 1", { exact: true })).toBeVisible();
  const tools = page.locator(".operator-list-tools");
  if (
    !(await tools.evaluate((element) => (element as HTMLDetailsElement).open))
  )
    await tools.locator(":scope > summary").click();
  return () => draft;
}

async function paste(page: Page, label: string, text: string) {
  await page.getByLabel(label, { exact: true }).evaluate((element, content) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", content);
    element.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, clipboardData }),
    );
  }, text);
}

test("150 rows: keyboard entry, search selection, explicit card and new-row focus", async ({
  page,
}) => {
  const current = await workspace(page);
  const first = page.getByLabel("ФИО, строка 1", { exact: true });
  await first.fill("Иванов Иван");
  await first.press("Enter");
  await expect(page.getByLabel("ФИО, строка 2", { exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Enter");
  await expect(first).toBeFocused();
  await first.press("Tab");
  await expect(
    page.getByLabel("Должность · RU, строка 1", { exact: true }),
  ).toBeFocused();
  await page.getByLabel("Поиск в заявке").fill("Мастер");
  await page.getByLabel("Выбрать видимых получателей").check();
  await expect(page.getByText(/Выбрано: 75/)).toBeVisible();
  await page
    .getByRole("button", { name: "Сбросить фильтры", exact: true })
    .click();
  await expect(
    page.getByLabel("Выбрать строку 1", { exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByLabel("Выбрать строку 2", { exact: true }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "Детали получателя 2", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Редактор получателя" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Вернуться к списку", exact: true })
    .click();
  await expect(first).toHaveValue("Иванов Иван");
  await page
    .getByRole("button", { name: "Добавить сотрудника", exact: true })
    .click();
  await expect(
    page.getByLabel("ФИО, строка 151", { exact: true }),
  ).toBeFocused();
  await expect(page.locator(".save-indicator")).toContainText(/сохранена/i);
  await expect.poll(() => current().items.length).toBe(151);
  await page.reload();
  await expect(first).toHaveValue("Иванов Иван");
});

test("visible-column paste is previewed, filtered paste is blocked, removal can be undone", async ({
  page,
}) => {
  const current = await workspace(page, 2);
  await paste(page, "ФИО, строка 1", "Новое имя\tНовая должность\tНовое место");
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Режим вставки").selectOption("REPLACE");
  await modal
    .getByLabel("Подтверждаю замену значений показанного диапазона")
    .check();
  await modal
    .getByRole("button", { name: "Применить диапазон", exact: true })
    .click();
  await expect
    .poll(() => current().items[0].positionRu)
    .toBe("Новая должность");
  expect(current().items[0].positionKz).toBe("Новое место");
  expect(current().items[0].workplaceRu).toBe("Тестовая организация");
  expect(current().items[0].fullNameKz).toBe("");
  await page.getByLabel("Поиск в заявке").fill("Новое имя");
  await paste(page, "ФИО, строка 1", "Скрытая замена\nОпасная замена");
  await expect(
    page.getByText(/Перед вставкой диапазона сбросьте поиск/),
  ).toBeVisible();
  await expect(modal).toHaveCount(0);
  await page
    .getByRole("button", { name: "Сбросить фильтры", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Удалить получателя 1", exact: true })
    .click();
  await expect(modal).toBeVisible();
  expect(current().items).toHaveLength(2);
  await modal
    .getByRole("button", { name: "Убрать из заявки", exact: true })
    .click();
  await expect.poll(() => current().items.length).toBe(1);
  await page
    .getByRole("button", { name: "Восстановить получателя", exact: true })
    .click();
  await expect.poll(() => current().items.length).toBe(2);
  expect(current().items[0].positionRu).toBe("Новая должность");
  await expect(page.getByLabel("ФИО, строка 1", { exact: true })).toBeFocused();
});

test("error queue survives editing and shared fields use the same autosave", async ({
  page,
}) => {
  const current = await workspace(page, 3);
  await page
    .getByRole("button", { name: "Проверить данные", exact: true })
    .click();
  await expect(
    page.getByText("Исправьте данные перед оформлением", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Показать строки").selectOption("errors");
  await page
    .getByLabel("Должность · RU, строка 1", { exact: true })
    .fill("Исправлено");
  await expect(
    page.getByLabel("Должность · RU, строка 2", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Данные изменены после проверки", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Уточните должность в строке 2$/ })
    .click();
  await expect(
    page.locator('.operator-grid [data-field-path="items.1.positionRu"]'),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Дополнительные действия", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Общие даты и протоколы", exact: true })
    .click();
  await page
    .getByLabel("Программа / тема для заявки", { exact: true })
    .fill("Общая программа");
  await expect(page.locator(".save-indicator")).toContainText(/сохранена/i);
  await expect
    .poll(() => current().commonFields?.trainingSubject)
    .toBe("Общая программа");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Закрыть диалог", exact: true })
    .click();
  await page.reload();
  await expect.poll(() => current().items[0].positionRu).toBe("Исправлено");
});

test("a search result stays available while its name is corrected; readonly documents remain accessible", async ({
  page,
}) => {
  const current = await workspace(page, 3);
  await page.getByLabel("Поиск в заявке").fill("Слушатель 002");
  const name = page.getByLabel("ФИО, строка 2", { exact: true });
  await name.fill("Исправленное имя");
  await expect(name).toBeVisible();
  await name.press("End");
  await name.pressSequentially(" полностью");
  await expect(page.locator(".save-indicator")).toContainText(/сохранена/i);
  await expect
    .poll(() => current().items[1].fullNameRu)
    .toBe("Исправленное имя полностью");
  await page.getByLabel("Поиск в заявке").fill("Слушатель 003");
  await expect(name).toHaveCount(0);
  current().status = "FINALIZED";
  await page.reload();
  await page
    .getByRole("button", { name: "Детали получателя 2", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Редактор получателя" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Добавить сотрудника", exact: true }),
  ).toHaveCount(0);
});

test("250 rows stay within a scroll region at desktop and narrow widths", async ({
  page,
}, testInfo) => {
  await workspace(page, 250);
  await expect(page.locator(".operator-grid tbody tr")).toHaveCount(250);
  await expect(
    page.getByRole("button", { name: "Добавить сотрудника", exact: true }),
  ).toBeEnabled();
  await page.locator(".operator-grid").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("table-desktop.png") });
  const width = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  expect(width.page).toBeLessThanOrEqual(width.viewport);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("table-mobile.png") });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.getByLabel("Поиск в заявке").fill("Слушатель 250");
  await expect(
    page.getByLabel("ФИО, строка 250", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Добавить сотрудника", exact: true })
    .click();
  await expect(
    page.getByLabel("ФИО, строка 251", { exact: true }),
  ).toBeFocused();
});

test("a new empty person request starts at the name field without scrolling through settings", async ({
  page,
}) => {
  const current = await workspace(page, 1);
  current().kind = "PERSON";
  current().items[0].fullNameRu = "";
  await page.reload();
  const name = page.getByLabel("ФИО", { exact: true });
  await expect(name).toBeFocused();
  const rect = await name.boundingBox();
  expect(rect!.y).toBeGreaterThanOrEqual(0);
  expect(rect!.y + rect!.height).toBeLessThan(690);
});

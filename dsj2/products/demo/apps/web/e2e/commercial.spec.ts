import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const evidence = process.env.DEMO_E2E_EVIDENCE
  ? path.resolve(process.env.DEMO_E2E_EVIDENCE)
  : path.resolve(__dirname, "../../../docs/evidence/browser");
const email = process.env.DEMO_E2E_EMAIL || "admin@demo.local";
const password = process.env.DEMO_E2E_PASSWORD || "Local-Demo-2026-Print!";
async function login(page: Page, user = email, secret = password) {
  await page.goto("/login");
  await page.getByLabel("Электронная почта", { exact: true }).fill(user);
  await page.getByLabel("Пароль", { exact: true }).fill(secret);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Заявки на печать" }),
  ).toBeVisible();
}
async function person(page: Page) {
  await page.getByRole("link", { name: "Новая заявка", exact: true }).click();
  await page.getByRole("button", { name: /Человек Документы/ }).click();
  await expect(page.getByLabel("ФИО RU, строка 1")).toBeVisible();
}
async function save(page: Page) {
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.locator(".save-indicator")).toContainText("Сохранено");
}
async function validPerson(page: Page) {
  await person(page);
  await page
    .getByLabel("ФИО RU, строка 1")
    .fill("Приёмочный Синтетический Получатель");
  await page.getByLabel("ФИО KZ, строка 1").fill("Ә Ғ Қ Ң Ө Ұ Ү Һ І");
  await page.getByLabel("Дата документа", { exact: true }).fill("2028-02-29");
  await page
    .getByLabel("Программа / тема обучения", { exact: true })
    .fill("Контрольная программа");
  await page
    .getByLabel("Подтверждённый результат / оценка")
    .fill("Контрольный результат");
}
function requestId(page: Page) {
  return /requests\/([^/]+)/.exec(page.url())![1];
}
test.beforeAll(() => fs.mkdir(evidence, { recursive: true }));

test("XLSX formulas are excluded with an actionable row error and no silent loss", async ({
  page,
}) => {
  await login(page);
  await person(page);
  await page.getByRole("button", { name: "Удалить получателя 1" }).click();
  await page
    .getByRole("button", { name: "Импорт / вставка", exact: true })
    .click();
  await page
    .getByLabel("Табличный файл")
    .setInputFiles(path.join(__dirname, "fixtures/import-formula.xlsx"));
  await page.getByRole("button", { name: "Перейти к сопоставлению" }).click();
  await page.getByLabel("Лист таблицы").selectOption("Получатели");
  await expect(page.getByText("Прочитано: 2", { exact: true })).toBeVisible();
  await expect(page.getByText("Исключено: 1", { exact: true })).toBeVisible();
  await expect(
    page.getByLabel("Импортировать исходную строку 2"),
  ).toBeDisabled();
  await expect(
    page.getByText(
      "Формула не импортируется. Замените её обычным значением в исходном файле.",
    ),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(evidence, "xlsx-formula-rejected.png"),
    fullPage: true,
  });
  await page
    .getByLabel("Поле для колонки Сотрудник")
    .selectOption("fullNameRu");
  await page
    .getByRole("button", { name: "Добавить 1 строк в черновик" })
    .click();
  await expect(page.getByLabel("ФИО RU, строка 1")).toHaveValue(
    "Неполная строка",
  );
  await expect(page.getByLabel("ФИО RU, строка 2")).toHaveCount(0);
});

test("oldest file survives 55 newer drafts, page three, history search and complete XLSX export", async ({
  page,
  context,
}) => {
  test.setTimeout(360000);
  await login(page);
  await validPerson(page);
  const prefix = `Поиск-${Date.now()}`;
  await page.getByLabel("Название заявки").fill(`${prefix}-000`);
  await page
    .getByRole("button", { name: "Оформить комплект", exact: true })
    .click();
  await page.getByRole("button", { name: "Оформить", exact: true }).click();
  await expect(page.locator(".files-panel")).toContainText("Готово 4 из 4", {
    timeout: 240000,
  });
  const id = requestId(page);
  const originalHref = await page
    .locator(".artifact-list a[download]")
    .first()
    .getAttribute("href");
  const original = await page.request.get(originalHref!);
  const originalHash = createHash("sha256")
    .update(await original.body())
    .digest("hex");
  const csrf = (await context.cookies()).find(
    (cookie) => cookie.name === "demo_csrf",
  )!.value;
  for (let index = 1; index <= 55; index++) {
    const created = await page.request.post("/api/print-requests", {
      headers: {
        origin: process.env.DEMO_ORIGIN || "http://localhost:3100",
        "x-csrf-token": csrf,
      },
      data: {
        kind: "PERSON",
        title: `${prefix}-${String(index).padStart(3, "0")}`,
        demoMode: true,
        items: [
          {
            id: `history-row-${index}`,
            fullNameRu: `Синтетический ${prefix} ${index}`,
            assignments: [],
          },
        ],
      },
    });
    expect(created.ok()).toBe(true);
  }
  await page.getByRole("link", { name: "Все заявки", exact: false }).click();
  await page.getByLabel("Поиск по заявкам").fill(prefix);
  await expect(page.getByText("Всего: 56", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(
    page.getByText("Страница 2 из 3", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(
    page.getByText("Страница 3 из 3", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: `${prefix}-000`, exact: true }).click();
  await expect(page.locator(".title-with-status .status")).toHaveText(
    "Оформлено",
  );
  const repeated = await page.request.get(originalHref!);
  expect(
    createHash("sha256")
      .update(await repeated.body())
      .digest("hex"),
  ).toBe(originalHash);
  await page
    .getByRole("navigation", { name: "Основная навигация" })
    .getByRole("link", { name: "История", exact: true })
    .click();
  await page.getByLabel("Поиск по заявкам").fill(prefix);
  await page.getByLabel("Статус").selectOption("");
  await expect(page.getByText("Всего: 1", { exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Реестр XLSX", exact: true }).click();
  await (await download).saveAs(path.join(evidence, "history-after-55.xlsx"));
  await page.screenshot({
    path: path.join(evidence, "history-after-55.png"),
    fullPage: true,
  });
  await fs.writeFile(
    path.join(evidence, "history-after-55.json"),
    JSON.stringify(
      {
        requestId: id,
        prefix,
        total: 56,
        historyTotal: 1,
        page: 3,
        originalSha256: originalHash,
        repeatedSha256: originalHash,
      },
      null,
      2,
    ),
  );
});

test("validation errors identify the field, focus the missing date and offline retains unsaved input", async ({
  page,
  context,
}) => {
  await login(page);
  await person(page);
  await page.getByRole("button", { name: "Проверить", exact: true }).click();
  await expect(page.locator(".validation-result")).toBeFocused();
  await expect(page.getByLabel("ФИО RU, строка 1")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(
    page.getByLabel("Дата документа", { exact: true }),
  ).toHaveAttribute("aria-invalid", "true");
  await page
    .getByRole("button", {
      name: "Введите действительную календарную дату",
      exact: true,
    })
    .click();
  await expect(
    page.getByLabel("Дата документа", { exact: true }),
  ).toBeFocused();
  await page.screenshot({
    path: path.join(evidence, "field-errors-and-focus.png"),
    fullPage: true,
  });
  await context.setOffline(true);
  await page
    .getByLabel("ФИО RU, строка 1")
    .fill("Работа без сети сохраняет ввод");
  await expect(page.locator(".save-indicator")).toContainText("Не сохранено");
  await expect(page.getByLabel("ФИО RU, строка 1")).toHaveValue(
    "Работа без сети сохраняет ввод",
  );
  await context.setOffline(false);
  await page
    .getByRole("button", { name: "Повторить сохранение", exact: true })
    .click();
  await expect(page.locator(".save-indicator")).toContainText("Сохранено");
  await page.reload();
  await expect(page.getByLabel("ФИО RU, строка 1")).toHaveValue(
    "Работа без сети сохраняет ввод",
  );
});

test("expired session: real cookie revocation, in-page reauthentication and unsaved bilingual data survive", async ({
  page,
  context,
}) => {
  await login(page);
  await person(page);
  await page.getByLabel("ФИО RU, строка 1").fill("Сохранённый получатель");
  await save(page);
  await context.clearCookies({ name: "demo_session" });
  await page
    .getByLabel("ФИО RU, строка 1")
    .fill("Последний ввод до восстановления сессии");
  await page.getByLabel("ФИО KZ, строка 1").fill("Сақталатын соңғы әріп І");
  const dialog = page.getByRole("dialog", { name: "Восстановить сессию" });
  await expect(dialog).toBeVisible();
  await expect(page.locator(".save-indicator")).toContainText("Не сохранено");
  await page.screenshot({
    path: path.join(evidence, "expired-session.png"),
    fullPage: true,
  });
  await dialog.getByLabel("Пароль", { exact: true }).fill(password);
  await dialog.getByRole("button", { name: "Войти и продолжить" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel("ФИО RU, строка 1")).toHaveValue(
    "Последний ввод до восстановления сессии",
  );
  await page.getByRole("button", { name: "Повторить сохранение" }).click();
  await expect(page.locator(".save-indicator")).toContainText("Сохранено");
  await page.reload();
  await expect(page.getByLabel("ФИО KZ, строка 1")).toHaveValue(
    "Сақталатын соңғы әріп І",
  );
  const url = page.url();
  await page
    .getByLabel("ФИО RU, строка 1")
    .fill("Последний ввод перед выходом");
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Войти в DEMO" }),
  ).toBeVisible();
  await login(page);
  await page.goto(url);
  await expect(page.getByLabel("ФИО RU, строка 1")).toHaveValue(
    "Последний ввод перед выходом",
  );
});

test("finalize response lost after commit: retry and double click reuse the issuance and final typed text", async ({
  page,
}) => {
  await login(page);
  await validPerson(page);
  const id = requestId(page);
  const keys: string[] = [];
  await page.route(`**/api/print-requests/${id}/finalize`, async (route) => {
    keys.push(route.request().headers()["idempotency-key"]);
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    if (keys.length === 1) {
      await route.fulfill({
        status: 504,
        contentType: "application/json",
        body: JSON.stringify({
          message:
            "Контрольная потеря ответа после регистрации. Повторите оформление.",
        }),
      });
    } else await route.fulfill({ response });
  });
  await page.getByLabel("ФИО RU, строка 1").fill("Последние символы — Ө І");
  await page
    .getByRole("button", { name: "Оформить комплект", exact: true })
    .click();
  await page.getByRole("button", { name: "Оформить", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Контрольная потеря ответа после регистрации",
  );
  await expect(page.locator(".title-with-status .status")).toHaveText(
    "Черновик",
  );
  await page.screenshot({
    path: path.join(evidence, "finalize-response-lost.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Оформить", exact: true }).dblclick();
  await expect(page.locator(".title-with-status .status")).toHaveText(
    "Оформлено",
  );
  expect(keys.length).toBeGreaterThanOrEqual(2);
  expect(new Set(keys).size).toBe(1);
  const result = await (
    await page.request.get(`/api/print-requests/${id}`)
  ).json();
  expect(result.issuances).toHaveLength(1);
  expect(result.documents).toHaveLength(1);
  expect(result.issuances[0].snapshot.draft.items[0].fullNameRu).toBe(
    "Последние символы — Ө І",
  );
  expect(
    result.issuances[0].snapshot.draft.items[0].assignments[0].documentDate,
  ).toBe("2028-02-29");
  await page
    .getByRole("button", { name: "Отменить выпуск", exact: true })
    .click();
  await page
    .getByLabel("Причина", { exact: true })
    .fill("Синтетическая проверка аннулирования");
  await page.getByRole("button", { name: "Зафиксировать отмену" }).click();
  await expect(page.locator(".title-with-status .status")).toHaveText(
    "Отменено",
  );
  const cancelled = await (
    await page.request.get(`/api/print-requests/${id}`)
  ).json();
  expect(cancelled.documents.map((d: { number: string }) => d.number)).toEqual(
    result.documents.map((d: { number: string }) => d.number),
  );
  await fs.writeFile(
    path.join(evidence, "timeout-idempotency.json"),
    JSON.stringify(
      {
        requestId: id,
        requests: keys.length,
        distinctKeys: new Set(keys).size,
        issuanceCount: result.issuances.length,
        cancelled: cancelled.status,
        dates: ["2028-02-29"],
        finalCharacters: true,
      },
      null,
      2,
    ),
  );
});

test("administrator settings and independent operator conflict preserve both drafts", async ({
  page,
  browser,
}) => {
  await login(page);
  await page
    .getByRole("navigation", { name: "Основная навигация" })
    .getByRole("link", { name: "Настройки" })
    .click();
  await page
    .getByLabel("Юридическое название · RU")
    .fill("Синтетический центр операторской приёмки");
  await page
    .getByLabel("Юридическое название · KZ")
    .fill("Операторлық тексеру оқу орталығы");
  await page.getByLabel("Город · KZ").fill("Қызылорда");
  await page
    .getByLabel("ФИО", { exact: true })
    .first()
    .fill("Синтетический Председатель Әли");
  await page
    .getByLabel("Роль в комиссии / должность", { exact: true })
    .first()
    .fill("Председатель контрольной комиссии");
  await page
    .getByRole("textbox", {
      name: "Основание утверждения / полномочий",
      exact: true,
    })
    .fill(
      "Синтетическая операторская приёмка — не юридическое утверждение формы",
    );
  await page.getByRole("button", { name: "Сохранить новую версию" }).click();
  await expect(page.getByText(/Создана новая версия реквизитов/)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("ФИО", { exact: true }).first()).toHaveValue(
    "Синтетический Председатель Әли",
  );
  await expect(
    page.getByLabel("Роль в комиссии / должность", { exact: true }).first(),
  ).toHaveValue("Председатель контрольной комиссии");
  await page.screenshot({
    path: path.join(evidence, "settings-issuer-commission.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Формы", exact: true }).click();
  await expect(page.locator(".template-list article").first()).toBeVisible();
  expect(
    new Set(await page.locator(".template-list article h3").allTextContents())
      .size,
  ).toBe(10);
  await page.screenshot({
    path: path.join(evidence, "settings-10-templates.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Нумерация", exact: true }).click();
  await page
    .getByLabel("Префикс PTM:PROTOCOL", { exact: true })
    .fill("TEST-PTM-");
  await page
    .getByLabel("Префикс PTM:PROTOCOL", { exact: true })
    .locator("xpath=ancestor::tr")
    .getByRole("button", { name: "Сохранить" })
    .click();
  await expect(
    page.getByText(/Правило сохранено. Счётчик не сброшен/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Пользователи", exact: true }).click();
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  const operatorEmail = `operator-${Date.now()}@demo.local`;
  await page
    .getByRole("dialog")
    .getByLabel("Имя", { exact: true })
    .fill("Синтетический второй оператор");
  await page
    .getByRole("dialog")
    .getByLabel("Электронная почта", { exact: true })
    .fill(operatorEmail);
  await page.getByLabel("Первоначальный пароль").fill(password);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Сохранить", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Основная навигация" })
    .getByRole("link", { name: "Заявки", exact: true })
    .click();
  await person(page);
  await page.getByLabel("ФИО RU, строка 1").fill("Исходная версия");
  await save(page);
  const originalId = requestId(page);
  const otherContext = await browser.newContext({
    baseURL: process.env.DEMO_ORIGIN || "http://localhost:3100",
  });
  const other = await otherContext.newPage();
  await login(other, operatorEmail);
  await other.goto(page.url());
  await expect(other.getByLabel("ФИО RU, строка 1")).toHaveValue(
    "Исходная версия",
  );
  await page.getByLabel("ФИО RU, строка 1").fill("Версия администратора");
  await save(page);
  await other.getByLabel("ФИО RU, строка 1").fill("Версия второго оператора");
  await expect(
    other.getByRole("dialog", { name: "Заявка изменена в другом окне" }),
  ).toBeVisible();
  await other.screenshot({
    path: path.join(evidence, "two-operators-conflict.png"),
    fullPage: true,
  });
  await other
    .getByRole("button", { name: "Сохранить мой ввод в копию" })
    .click();
  await expect(other.getByLabel("Название заявки")).toHaveValue(
    /копия изменений/,
  );
  await expect(other.getByLabel("ФИО RU, строка 1")).toHaveValue(
    "Версия второго оператора",
  );
  const original = await (
    await page.request.get(`/api/print-requests/${originalId}`)
  ).json();
  expect(original.items[0].fullNameRu).toBe("Версия администратора");
  await otherContext.close();
});

test("CSV formula text and optional PTM/PB semantic fields survive import and refresh", async ({
  page,
}) => {
  await login(page);
  await person(page);
  await page.getByRole("button", { name: "Удалить получателя 1" }).click();
  await page
    .getByRole("button", { name: "Импорт / вставка", exact: true })
    .click();
  await page.getByLabel("Табличный файл").setInputFiles({
    name: "synthetic.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      'ФИО RU;ФИО KZ;Внешний номер основания;Причина проверки знаний;Образование\r\n"Тест CSV";"Ә Ғ Қ Ң Ө Ұ Ү Һ І";"00123";"Первичная проверка";"=1+1"\r\n',
    ),
  });
  await page.getByRole("button", { name: "Перейти к сопоставлению" }).click();
  await page
    .getByLabel("Документ для импортируемых строк")
    .selectOption("ptm-protocol");
  await expect(
    page.getByLabel("Поле для колонки Причина проверки знаний"),
  ).toHaveValue("reason");
  await expect(page.getByLabel("Поле для колонки Образование")).toHaveValue(
    "education",
  );
  await page
    .getByRole("button", { name: "Добавить 1 строк в черновик" })
    .click();
  await expect(page.getByLabel("Причина проверки знаний")).toHaveValue(
    "Первичная проверка",
  );
  await expect(page.getByLabel("Внешний номер основания")).toHaveValue("00123");
  await page
    .getByLabel("Форма документа", { exact: true })
    .selectOption("pb-protocol");
  await expect(page.getByLabel("Образование", { exact: true })).toHaveValue(
    "=1+1",
  );
  await save(page);
  await page.reload();
  await expect(page.getByLabel("Образование", { exact: true })).toHaveValue(
    "=1+1",
  );
  await expect(page.getByLabel("ФИО KZ, строка 1")).toHaveValue(
    "Ә Ғ Қ Ң Ө Ұ Ү Һ І",
  );
});

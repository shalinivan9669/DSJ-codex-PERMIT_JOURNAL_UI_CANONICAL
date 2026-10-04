import { assertTechnicalBlankRemoval, createRequestWithWorkerDocument } from "./operator-keyboard-helpers";
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { loginIsolated } from "./operator-full-fix-session";
import {
  legacyPrintFixture,
  openLegacyPersonal,
  savedLegacyDraft,
} from "./operator-legacy-lifecycle-fixture";
import {
  realApprovalRoles,
  write,
  waitOriginalJobs,
  readPrintDetail,
} from "./operator-role-fixture";
import { randomUUID } from "node:crypto";
test.use({ trace: "off" });

const evidence = process.env.DEMO_E2E_EVIDENCE
  ? path.resolve(process.env.DEMO_E2E_EVIDENCE)
  : path.resolve(__dirname, "../../../docs/evidence/browser");
const email = process.env.DEMO_E2E_EMAIL || "admin@demo.local";
const password = process.env.DEMO_E2E_PASSWORD || "Local-Demo-2026-Print!";
test.beforeEach(async ({ context }) => {
  await context.routeWebSocket("**/_next/webpack-hmr", (socket) =>
    socket.close(),
  );
});
async function login(page: Page, user = email, secret = password) {
  if (
    user === process.env.DEMO_E2E_EMAIL &&
    secret === process.env.DEMO_E2E_PASSWORD
  ) {
    await loginIsolated(page);
    return;
  }
  await page.goto("/login");
  await page.getByLabel("Электронная почта", { exact: true }).fill(user);
  await page.getByLabel("Пароль", { exact: true }).fill(secret);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  try {
    await expect(
      page.getByRole("heading", { name: "Заявки на печать" }),
    ).toBeVisible();
  } catch (error) {
    const passwordInput = page.getByLabel("Пароль", { exact: true });
    if (await passwordInput.isVisible()) await passwordInput.fill("");
    throw error;
  }
}
async function person(page: Page) {
  await page.getByRole("link", { name: "Новая заявка", exact: true }).click();
  await createRequestWithWorkerDocument(page, "PERSON");
  await expect(page.getByLabel("ФИО, строка 1", { exact: true })).toBeVisible();
}
async function save(page: Page) {
  await page.getByLabel("ФИО, строка 1", { exact: true }).blur();
  await expect(page.locator(".save-indicator")).toContainText(/сохранена/i);
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
  await assertTechnicalBlankRemoval(page);
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
  await expect(page.getByLabel("ФИО, строка 1", { exact: true })).toHaveValue(
    "Неполная строка",
  );
  await expect(page.getByLabel("ФИО, строка 2", { exact: true })).toHaveCount(
    0,
  );
});

test("oldest saved originals survive 55 newer drafts, page three and archive excludes the unsigned official set", async ({
  page,
  browser,
}) => {
  test.setTimeout(360000);
  const prefix = `Поиск-${Date.now()}`;
  const f = await legacyPrintFixture(page, browser, { title: `${prefix}-000` });
  try {
    await f.patch((draft) => { draft.items[0].fullNameRu = `${prefix}-000`; });
    const issued = await f.issue();
    const file = issued.artifacts.find(
      (a) => a.provenance === "ORIGINAL" && a.format === "PDF",
    )!;
    const bytes = await (
      await page.request.get(`/api/artifacts/${file.id}`)
    ).body();
    const originalHash = createHash("sha256").update(bytes).digest("hex");
    expect(originalHash).toBe(file.sha256);
    for (let index = 1; index <= 55; index++)
      await write(page, f.roles.operator.headers, "/print-requests", {
        kind: "PERSON",
        schemaVersion: 2,
        title: `${prefix}-${String(index).padStart(3, "0")}`,
        demoMode: true,
        items: [
          {
            id: randomUUID(),
            fullNameRu: `${prefix}-${String(index).padStart(3, "0")}`,
            assignments: [],
          },
        ],
      });
    await page.goto("/requests");
    await page.getByLabel("Поиск по заявкам", { exact: true }).fill(prefix);
    await expect(page.getByText("Всего: 56", { exact: true })).toBeVisible();
    for (const n of [2, 3]) {
      await page.getByRole("button", { name: "Далее", exact: true }).click();
      await expect(
        page.getByText(`Страница ${n} из 3`, { exact: true }),
      ).toBeVisible();
    }
    await page
      .getByRole("link", { name: `${prefix}-000`, exact: true })
      .click();
    expect((await f.read()).status).toBe("FINALIZED");
    expect(
      createHash("sha256")
        .update(
          await (await page.request.get(`/api/artifacts/${file.id}`)).body(),
        )
        .digest("hex"),
    ).toBe(originalHash);
    const archived = await (
      await page.request.get(
        `/api/print-requests?search=${encodeURIComponent(prefix)}&archive=true`,
      )
    ).json();
    expect(archived.total).toBe(0);
    await page.goto("/history");
    await page.getByLabel("Поиск по заявкам", { exact: true }).fill(prefix);
    await expect(page.getByText("Всего: 0", { exact: true })).toBeVisible();
    const pending = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Реестр XLSX", exact: true })
      .click();
    await (
      await pending
    ).saveAs(path.join(evidence, "unsigned-archive-after-55.xlsx"));
    await page.screenshot({
      path: path.join(evidence, "history-after-55.png"),
      fullPage: true,
    });
    await fs.writeFile(
      path.join(evidence, "history-after-55.json"),
      JSON.stringify(
        {
          status: "PASS",
          requestId: f.id,
          prefix,
          total: 56,
          unsignedArchiveTotal: 0,
          page: 3,
          originalSha256: originalHash,
          repeatedSha256: originalHash,
          officialUnsignedDelivery: "blocked409",
          exportMeaning:
            "Empty official archive; original PDF remains available for content review",
        },
        null,
        2,
      ),
    );
  } finally {
    await f.roles.close();
  }
});
test("validation errors identify the field, focus the missing date and offline retains unsaved input", async ({
  page,
  context,
}) => {
  await login(page);
  await person(page);
  const cleared = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().endsWith(`/print-requests/${requestId(page)}`));
  await page.getByLabel("Дата выдачи, строка 1", { exact: true }).fill("");
  expect((await cleared).ok()).toBe(true);
  await page
    .getByRole("button", { name: "Проверить данные", exact: true })
    .click();
  await page.locator(".review-issue-group").getByRole("button", { name: "Введите ФИО на русском", exact: true }).click();
  await expect(page.getByLabel("ФИО, строка 1", { exact: true })).toBeFocused();
  await expect(
    page.getByLabel("ФИО, строка 1", { exact: true }),
  ).toHaveAttribute("aria-invalid", "true");
  const issues = await (
    await page.request.post(`/api/print-requests/${requestId(page)}/validate`, {
      headers: {
        origin: process.env.DEMO_ORIGIN!,
        "x-csrf-token": (await context.cookies()).find(
          (c) => c.name === "demo_csrf",
        )!.value,
      },
      data: {
        expectedRevision: (await readPrintDetail(page, requestId(page)))
          .revision,
      },
    })
  ).json();
  expect(
    issues.issues.some(
      (e: { code: string; recipientId?: string; field?: string }) =>
        e.code === "DATE_INVALID" &&
        !!e.recipientId &&
        e.field === "documentDate",
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: /Введите действительную календарную дату/ })
    .first()
    .click();
  expect(
    await page.evaluate(
      () =>
        document.activeElement instanceof HTMLInputElement &&
        document.activeElement.type === "date",
    ),
  ).toBe(true);
  if (await page.getByRole("dialog").isVisible())
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Вернуться к списку", exact: true })
      .click();
  await page.screenshot({
    path: path.join(evidence, "field-errors-and-focus.png"),
    fullPage: true,
  });
  await context.setOffline(true);
  await page
    .getByLabel("ФИО, строка 1", { exact: true })
    .fill("Работа без сети сохраняет ввод");
  await expect(page.locator(".save-indicator")).toContainText("Не сохранено");
  await expect(page.getByLabel("ФИО, строка 1", { exact: true })).toHaveValue(
    "Работа без сети сохраняет ввод",
  );
  await context.setOffline(false);
  await page
    .getByRole("button", { name: "Повторить сохранение", exact: true })
    .click();
  await save(page);
  await page.reload();
  await expect(page.getByLabel("ФИО, строка 1", { exact: true })).toHaveValue(
    "Работа без сети сохраняет ввод",
  );
});
test("expired session: real cookie revocation, in-page reauthentication and unsaved bilingual data survive", async ({
  page,
  context,
}) => {
  await login(page);
  await person(page);
  await page
    .getByLabel("ФИО, строка 1", { exact: true })
    .fill("Сохранённый получатель");
  await save(page);
  const personal = await openLegacyPersonal(page);
  await personal.locator("summary", { hasText: "Казахский вариант" }).click();
  await context.setOffline(true);
  await context.clearCookies({ name: "demo_session" });
  await personal
    .getByLabel("ФИО", { exact: true })
    .fill("Последний ввод до восстановления сессии");
  await personal
    .getByLabel("ФИО · KZ", { exact: true })
    .fill("Сақталатын соңғы әріп І");
  await personal
    .getByRole("button", { name: "Вернуться к списку", exact: true })
    .click();
  await expect(page.locator(".save-indicator")).toContainText("Не сохранено");
  await context.setOffline(false);
  await page
    .getByRole("button", { name: "Повторить сохранение", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Восстановить сессию",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await page.screenshot({
    path: path.join(evidence, "expired-session.png"),
    fullPage: true,
  });
  await dialog.getByLabel("Пароль", { exact: true }).fill(password);
  await dialog
    .getByRole("button", { name: "Войти и продолжить", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel("ФИО, строка 1", { exact: true })).toHaveValue(
    "Последний ввод до восстановления сессии",
  );
  if (
    await page
      .getByRole("button", { name: "Повторить сохранение", exact: true })
      .isVisible()
  )
    await page
      .getByRole("button", { name: "Повторить сохранение", exact: true })
      .click();
  await save(page);
  const id = requestId(page);
  await expect
    .poll(async () => (await readPrintDetail(page, id)).items[0].fullNameKz)
    .toBe("Сақталатын соңғы әріп І");
  await page.reload();
  expect((await readPrintDetail(page, id)).items[0].fullNameKz).toBe(
    "Сақталатын соңғы әріп І",
  );
  await page
    .getByLabel("ФИО, строка 1", { exact: true })
    .fill("Последний ввод перед выходом");
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Войти в DEMO", exact: true }),
  ).toBeVisible();
  await login(page);
  await page.goto(`/requests/${id}/edit`);
  await expect(page.getByLabel("ФИО, строка 1", { exact: true })).toHaveValue(
    "Последний ввод перед выходом",
  );
});
test("finalize response lost after commit: retry and double activation reuse one issuance and the exact approved final text", async ({
  page,
  browser,
}) => {
  test.setTimeout(360000);
  const f = await legacyPrintFixture(page, browser);
  try {
    await page
      .getByLabel("ФИО, строка 1", { exact: true })
      .fill("Последние символы Ө І");
    await savedLegacyDraft(page);
    await expect
      .poll(async () => (await f.read()).items[0].fullNameRu)
      .toBe("Последние символы Ө І");
    await f.roles.approve(f.id);
    await page.reload();
    const keys: string[] = [];
    await page.route(
      `**/api/print-requests/${f.id}/finalize`,
      async (route) => {
        keys.push(route.request().headers()["idempotency-key"]);
        const response = await route.fetch();
        expect(response.ok(), await response.text()).toBe(true);
        if (keys.length === 1)
          await route.fulfill({
            status: 504,
            contentType: "application/json",
            body: JSON.stringify({
              message:
                "Контрольная потеря ответа после регистрации. Повторите оформление.",
            }),
          });
        else await route.fulfill({ response });
      },
    );
    const generate = page.getByRole("button", {
      name: "Сформировать документы",
      exact: true,
    });
    await generate.click();
    await expect(
      page.getByText(/Контрольная потеря ответа после регистрации/),
    ).toBeVisible();
    expect((await f.read()).status).toBe("FINALIZED");
    await page.screenshot({
      path: path.join(evidence, "finalize-response-lost.png"),
      fullPage: true,
    });
    await generate.evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect.poll(async () => await generate.count()).toBe(0);
    expect(keys.length).toBeGreaterThanOrEqual(2);
    expect(new Set(keys).size).toBe(1);
    const issued = await f.read();
    expect(issued.issuances).toHaveLength(1);
    expect(issued.documents).toHaveLength(2);
    expect(issued.issuances[0].snapshot.draft.items[0].fullNameRu).toBe(
      "Последние символы Ө І",
    );
    await waitOriginalJobs(page, f.id);
    await page
      .locator(".files-panel")
      .getByRole("button", { name: "Обновить", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Отменить выпуск", exact: true })
      .click();
    const cancel = page.getByRole("dialog", {
      name: "Отменить выпуск",
      exact: true,
    });
    await cancel
      .getByLabel("Причина", { exact: true })
      .fill("СИНТЕТИЧЕСКАЯ проверка аннулирования через директора");
    await cancel
      .getByRole("button", { name: "Зафиксировать отмену", exact: true })
      .click();
    expect((await f.read()).status).toBe("FINALIZED");
    await f.roles.approve(f.id);
    await page.reload();
    const cancelled = await f.read();
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.documents).toEqual(issued.documents);
    await fs.writeFile(
      path.join(evidence, "timeout-idempotency.json"),
      JSON.stringify(
        {
          status: "PASS",
          requestId: f.id,
          requests: keys.length,
          distinctKeys: new Set(keys).size,
          issuanceCount: issued.issuances.length,
          cancelled: cancelled.status,
          realDirectorCancel: true,
          finalCharacters: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await f.roles.close();
  }
});
test("administrator settings and an independent operator conflict preserve both drafts", async ({
  page,
  browser,
}) => {
  const roles = await realApprovalRoles(browser, page);
  const admin = roles.adminPage;
  try {
    await admin.goto("/settings");
    await admin
      .getByLabel("Юридическое название · RU", { exact: true })
      .fill("Тест Центр");
    await admin
      .getByLabel("Юридическое название · KZ", { exact: true })
      .fill("Тест Центр");
    await admin.getByLabel("Город · KZ", { exact: true }).fill("Қызылорда");
    await admin
      .getByRole("textbox", {
        name: "Основание утверждения / полномочий",
        exact: true,
      })
      .fill(
        "СИНТЕТИЧЕСКАЯ операторская приёмка; не юридическое утверждение формы",
      );
    await admin
      .getByRole("button", { name: "Сохранить новую версию", exact: true })
      .click();
    await expect(
      admin.getByText(/Создана новая версия реквизитов/),
    ).toBeVisible();
    await admin.reload();
    await expect(
      admin.getByLabel("Юридическое название · KZ", { exact: true }),
    ).toHaveValue("Тест Центр");
    await admin.getByRole("button", { name: "Формы", exact: true }).click();
    await expect(admin.locator(".template-list article").first()).toBeVisible();
    expect(
      new Set(
        await admin.locator(".template-list article h3").allTextContents(),
      ).size,
    ).toBe(16);
    await admin.getByRole("button", { name: "Нумерация", exact: true }).click();
    await admin
      .getByLabel("Префикс PTM:PROTOCOL", { exact: true })
      .fill("TEST-PTM-");
    await admin
      .getByLabel("Префикс PTM:PROTOCOL", { exact: true })
      .locator("xpath=ancestor::tr")
      .getByRole("button", { name: "Сохранить", exact: true })
      .click();
    await expect(
      admin.getByText(/Правило сохранено. Счётчик не сброшен/),
    ).toBeVisible();
    await admin
      .getByRole("button", { name: "Пользователи", exact: true })
      .click();
    await admin.getByRole("button", { name: "Добавить", exact: true }).click();
    const operatorEmail = `operator-${randomUUID()}@example.test`,
      operatorPassword = `Synthetic-${randomUUID()}!`;
    const dialog = admin.getByRole("dialog");
    await dialog
      .getByLabel("Имя", { exact: true })
      .fill("Тестовый второй оператор");
    await dialog
      .getByLabel("Электронная почта", { exact: true })
      .fill(operatorEmail);
    await dialog
      .getByLabel("Первоначальный пароль", { exact: true })
      .fill(operatorPassword);
    await dialog
      .getByRole("button", { name: "Сохранить", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await person(page);
    await page
      .getByLabel("ФИО, строка 1", { exact: true })
      .fill("Исходная версия");
    await save(page);
    const id = requestId(page);
    const otherContext = await browser.newContext({
      baseURL: process.env.DEMO_ORIGIN,
    });
    try {
      const other = await otherContext.newPage();
      await login(other, operatorEmail, operatorPassword);
      await other.goto(page.url());
      await expect(
        other.getByLabel("ФИО, строка 1", { exact: true }),
      ).toHaveValue("Исходная версия");
      await page
        .getByLabel("ФИО, строка 1", { exact: true })
        .fill("Версия первого оператора");
      await save(page);
      await other
        .getByLabel("ФИО, строка 1", { exact: true })
        .fill("Версия второго оператора");
      const conflict = other.getByRole("dialog", {
        name: "Заявка изменена в другом окне",
        exact: true,
      });
      await expect(conflict).toBeVisible();
      await other.screenshot({
        path: path.join(evidence, "two-operators-conflict.png"),
        fullPage: true,
      });
      await conflict
        .getByRole("button", {
          name: "Сохранить мой ввод в копию",
          exact: true,
        })
        .click();
      await expect(other).not.toHaveURL(new RegExp(`/requests/${id}`));
      await expect(
        other.getByLabel("ФИО, строка 1", { exact: true }),
      ).toHaveValue("Версия второго оператора");
      expect((await readPrintDetail(page, id)).items[0].fullNameRu).toBe(
        "Версия первого оператора",
      );
    } finally {
      await otherContext.close();
    }
  } finally {
    await roles.close();
  }
});
test("CSV formula text and optional PTM/PB semantic fields survive import and refresh", async ({
  page,
}) => {
  await login(page);
  const saved: unknown[] = [];
  for (const template of ["ptm-protocol", "pb-protocol"]) {
    await page.goto("/requests");
    await person(page);
    await page.getByRole("button", { name: "Удалить получателя 1" }).click();
    await assertTechnicalBlankRemoval(page);
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
      .getByRole("combobox", {
        name: "Документ для импортируемых строк",
        exact: true,
      })
      .selectOption(template);
    await expect(
      page.getByLabel("Поле для колонки Причина проверки знаний"),
    ).toHaveValue("reason");
    await expect(page.getByLabel("Поле для колонки Образование")).toHaveValue(
      "education",
    );
    await page
      .getByRole("button", { name: "Добавить 1 строк в черновик" })
      .click();
    const id = requestId(page);
    await page
      .getByRole("button", { name: "Детали получателя 1", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("tab", { name: /Обучение и результат/ }).click();
    if (template === "ptm-protocol")
      await expect(
        dialog.getByLabel("Причина проверки знаний", { exact: true }),
      ).toHaveValue("Первичная проверка");
    if (template === "pb-protocol")
      await expect(
        dialog.getByLabel("Образование", { exact: true }),
      ).toHaveValue("=1+1");
    await dialog.getByRole("tab", { name: /^Настройки/ }).click();
    await expect(
      dialog
        .locator(".assignment-list > details")
        .first()
        .getByLabel("Внешний номер основания", { exact: true }),
    ).toHaveValue("00123");
    await dialog
      .getByRole("button", { name: "Вернуться к списку", exact: true })
      .click();
    await save(page);
    await page.reload();
    const data = await (
      await page.request.get(`/api/print-requests/${id}`)
    ).json();
    const assignment = data.items[0].assignments.find(
      (entry: { templateId: string }) => entry.templateId === template,
    );
    expect(assignment.externalBasisNumber).toBe("00123");
    expect(assignment.reason).toBe("Первичная проверка");
    expect(assignment.education).toBe("=1+1");
    expect(assignment.outcome?.status || "UNKNOWN").toBe("UNKNOWN");
    await page
      .getByRole("button", { name: "Детали получателя 1", exact: true })
      .click();
    await dialog.getByRole("tab", { name: /^Личные данные/ }).click();
    await dialog.getByText(/^Казахский вариант/).click();
    await expect(dialog.getByLabel("ФИО · KZ", { exact: true })).toHaveValue(
      "Ә Ғ Қ Ң Ө Ұ Ү Һ І",
    );
    await dialog
      .getByRole("button", { name: "Вернуться к списку", exact: true })
      .click();
    saved.push(data);
  }
  await fs.writeFile(
    path.join(evidence, "csv-ptm-pb-semantic-readback.json"),
    JSON.stringify(saved, null, 2),
  );
});

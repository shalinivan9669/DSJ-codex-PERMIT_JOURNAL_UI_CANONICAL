import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    "../../docs/evidence/final-completion/operator/customer",
);
async function save(page: Page) {
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.locator(".save-indicator")).toContainText("Сохранено");
}
test("real customer clarification can be scoped, reduced, edited and copied; employer change preserves periods and clean reuse", async ({
  page,
  context,
}) => {
  test.setTimeout(360000);
  await fs.mkdir(evidence, { recursive: true });
  await page.routeWebSocket(/\/_next\/webpack-hmr/, (socket) => socket.close());
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/login");
  await page
    .getByLabel("Электронная почта", { exact: true })
    .fill(process.env.DEMO_E2E_EMAIL!);
  await page
    .getByLabel("Пароль", { exact: true })
    .fill(process.env.DEMO_E2E_PASSWORD!);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Заявки на печать" }),
  ).toBeVisible();
  const companies = [];
  const stamp = Date.now();
  for (const [index, suffix] of ["A", "B"].entries()) {
    await page.goto("/customers");
    await page
      .getByRole("button", { name: "Добавить заказчика", exact: true })
      .click();
    const name = `Работодатель ${suffix} ${stamp}`;
    await page.getByLabel("Название на русском", { exact: true }).fill(name);
    await page
      .getByLabel("Название на казахском", { exact: true })
      .fill(`Жұмыс беруші ${suffix}`);
    await page
      .getByLabel("БИН", { exact: true })
      .fill(`00000000000${index + 1}`);
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/customers") && r.request().method() === "POST",
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Сохранить", exact: true })
      .click();
    const result = await response;
    expect(result.ok()).toBe(true);
    companies.push({ ...(await result.json()), nameRu: name });
  }
  await page.goto("/requests");
  await page.getByRole("link", { name: "Новая заявка", exact: true }).click();
  await page.getByRole("button", { name: /Человек Документы/ }).click();
  await page
    .getByLabel("Название заявки", { exact: true })
    .fill(`Уточнения и история ${stamp}`);
  await page
    .getByRole("button", { name: "Удалить получателя 1", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Импорт / вставка", exact: true })
    .click();
  await page
    .getByLabel("Или вставьте таблицу с заголовками")
    .fill(
      `externalId\tpersonnelNumber\temployerId\tФИО RU\tФИО KZ\nA-${stamp}\t000001\t${companies[0].id}\tСинтетический Однофамилец\tӘ Ғ Қ Ң Ө Ұ Ү Һ І\nB-${stamp}\t000002\t${companies[1].id}\tСинтетический Однофамилец\tJohn Smith`,
    );
  await page
    .getByRole("button", { name: "Перейти к сопоставлению", exact: true })
    .click();
  await page
    .getByRole("combobox", {
      name: "Документ для импортируемых строк",
      exact: true,
    })
    .selectOption("pb-card");
  await page
    .getByRole("button", { name: "Добавить 2 строк в черновик", exact: true })
    .click();
  await page.getByLabel("ФИО RU, строка 1", { exact: true }).fill("");
  await page.getByLabel("ФИО RU, строка 2", { exact: true }).fill("");
  await save(page);
  const requestId = /requests\/([^/]+)/.exec(page.url())![1];
  const originalPath = new URL(page.url()).pathname;
  const read = async () =>
    (await page.request.get(`/api/print-requests/${requestId}`)).json();
  await page
    .getByRole("button", { name: "Открыть согласование", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Подготовить запрос уточнений", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Копировать запрос уточнений",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByRole("combobox", {
      name: "Организация для запроса уточнений",
      exact: true,
    })
    .selectOption(companies[0].id);
  await page
    .getByRole("button", { name: "Подготовить запрос уточнений", exact: true })
    .click();
  const text = page.getByRole("textbox", {
    name: "Текст запроса уточнений",
    exact: true,
  });
  await expect(text).toHaveValue(/000001/);
  expect(await text.inputValue()).not.toContain("000002");
  expect(await text.inputValue()).not.toMatch(
    /CORRELATION|SECRET|PHOTO_REQUIRED|RESULT_REQUIRED|пароль/i,
  );
  const issues = page.locator(".clarification-editor input[type=checkbox]");
  expect(await issues.count()).toBeGreaterThan(0);
  await issues.first().uncheck();
  const edited = `Здравствуйте! Проверенное обращение компании A ${stamp}. Уточните только фотографию указанного сотрудника.`;
  await text.fill(edited);
  let mutations = 0;
  const countMutation = (request: { method(): string; url(): string }) => {
    if (
      ["POST", "PATCH", "PUT", "DELETE"].includes(request.method()) &&
      request.url().includes("/api/")
    )
      mutations++;
  };
  page.on("request", countMutation);
  await page
    .getByRole("button", { name: "Копировать запрос уточнений", exact: true })
    .click();
  await expect(
    page.getByText("Проверенный текст скопирован. Сообщение не отправлялось."),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    edited,
  );
  expect(mutations).toBe(0);
  page.off("request", countMutation);
  await page.screenshot({
    path: path.join(evidence, "scoped-edited-clarification.png"),
    fullPage: true,
  });
  await page
    .getByLabel("ФИО RU, строка 1", { exact: true })
    .fill("Синтетический Однофамилец");
  await page
    .getByLabel("ФИО RU, строка 2", { exact: true })
    .fill("Синтетический Однофамилец");
  await save(page);
  await page
    .getByRole("button", { name: "Настроить выдачу", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Заказчик этого комплекта", exact: true })
    .selectOption(companies[0].id);
  const profileName = `Предпочтения компании A ${stamp}`;
  await page.getByLabel("Название профиля", { exact: true }).fill(profileName);
  await page
    .getByLabel("Контакт получателя комплекта", { exact: true })
    .fill("Синтетический контакт только компании A");
  await page
    .getByRole("combobox", {
      name: "Язык сопроводительных сведений",
      exact: true,
    })
    .selectOption("kz");
  await page
    .getByRole("button", { name: "Сохранить профиль", exact: true })
    .click();
  await expect(
    page.getByText("Профиль сохранён для следующих заказов.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Документы и даты получателя 1", exact: true })
    .click();
  await page.getByRole("tab", { name: "Личные данные", exact: true }).click();
  await page
    .getByText("Постоянная запись, работодатель и история", { exact: true })
    .click();
  await page
    .getByLabel("Должность · RU", { exact: true })
    .fill("Должность компании A");
  await page
    .getByLabel("Период работы / основание актуальности", { exact: true })
    .fill("2025 — компания A");
  await page
    .getByLabel(
      "Подтверждаю актуальность сведений для постоянной записи человека",
    )
    .check();
  await page
    .getByRole("button", {
      name: "Сохранить человека в справочник",
      exact: true,
    })
    .click();
  await expect(
    page.getByText(
      "Текущие сведения человека сохранены в справочнике. Оформленные документы остаются неизменными.",
    ),
  ).toBeVisible();
  await save(page);
  const first = (await read()).items[0];
  expect(first.recipientId).toBeTruthy();
  await page
    .getByRole("button", { name: "Выбрать работодателя", exact: true })
    .click();
  await page
    .getByLabel("Поиск по справочнику", { exact: true })
    .fill(companies[1].nameRu);
  await page
    .getByRole("dialog")
    .getByRole("row")
    .filter({ hasText: companies[1].nameRu })
    .getByRole("button", { name: "Выбрать", exact: true })
    .click();
  await expect(
    page.getByLabel("Место работы · RU", { exact: true }),
  ).toHaveValue(companies[1].nameRu);
  await page
    .getByLabel("Должность · RU", { exact: true })
    .fill("Должность компании B");
  await page
    .getByLabel("Период работы / основание актуальности", { exact: true })
    .fill("2026 — компания B");
  await page
    .getByLabel(
      "Подтверждаю актуальность сведений для постоянной записи человека",
    )
    .check();
  await page
    .getByRole("button", {
      name: "Обновить текущие сведения человека",
      exact: true,
    })
    .click();
  await expect(
    page.getByText(
      `${companies[0].nameRu} · Должность компании A · табельный 000001 · 2025 — компания A`,
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      `${companies[1].nameRu} · Должность компании B · табельный 000001 · 2026 — компания B`,
      { exact: true },
    ),
  ).toBeVisible();
  await save(page);
  const after = await read();
  expect(after.items[0].recipientId).toBe(first.recipientId);
  expect(after.items[0].employerId).toBe(companies[1].id);
  expect(after.items[0].employerBin).toBe(companies[1].bin);
  const history = await (
    await page.request.get(`/api/recipients/${first.recipientId}`)
  ).json();
  expect(history.employment).toHaveLength(2);
  await page.goto("/requests");
  await page.getByRole("link", { name: "Новая заявка", exact: true }).click();
  await page.getByRole("button", { name: /Человек Документы/ }).click();
  await page
    .getByRole("button", { name: "Найти человека", exact: true })
    .click();
  await page
    .getByLabel("Поиск по справочнику", { exact: true })
    .fill(`A-${stamp}`);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Выбрать", exact: true })
    .click();
  await save(page);
  const nextId = /requests\/([^/]+)/.exec(page.url())![1];
  const next = await (
    await page.request.get(`/api/print-requests/${nextId}`)
  ).json();
  expect(next.items).toHaveLength(1);
  expect(next.items[0].recipientId).toBe(first.recipientId);
  expect(next.items[0].employerId).toBe(companies[1].id);
  expect(next.items[0].assignments).toHaveLength(1);
  expect(next.items[0].assignments[0].result).toBe("");
  expect(next.items[0].assignments[0].trainingStart).toBe("");
  expect(next.items[0].assignments[0].eventId).toBeUndefined();
  expect(next.documents).toHaveLength(0);
  await page.goto("/requests");
  await page.getByRole("link", { name: "Новая заявка", exact: true }).click();
  await page.getByRole("button", { name: /Организация Заказчик/ }).click();
  await page
    .getByRole("combobox", { name: "Заказчик", exact: true })
    .selectOption(companies[0].id);
  await save(page);
  await page.reload();
  await page
    .getByRole("button", { name: "Настроить выдачу", exact: true })
    .click();
  await expect(
    page.getByText(`Для заказчика сохранён профиль «${profileName}».`, {
      exact: false,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Применить сохранённые настройки",
      exact: true,
    })
    .click();
  await expect(
    page.getByLabel("Контакт получателя комплекта", { exact: true }),
  ).toHaveValue("Синтетический контакт только компании A");
  await expect(
    page.getByRole("combobox", {
      name: "Язык сопроводительных сведений",
      exact: true,
    }),
  ).toHaveValue("kz");
  await page
    .getByRole("button", { name: "Найти заказчика комплекта", exact: true })
    .click();
  await page
    .getByLabel("Поиск по справочнику", { exact: true })
    .fill(companies[1].nameRu);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Выбрать", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", {
      name: "Заказчик этого комплекта",
      exact: true,
    }),
  ).toHaveValue(companies[1].id);
  await expect(
    page.getByLabel("Контакт получателя комплекта", { exact: true }),
  ).toHaveValue("");
  await expect(
    page
      .getByRole("combobox", { name: "Сохранённый профиль", exact: true })
      .getByRole("option", { name: profileName, exact: true }),
  ).toHaveCount(0);
  await page.goto(originalPath);
  await expect(page.locator(".recipient-table tbody tr")).toHaveCount(2);
  expect((await read()).items[1].recipientId).toBeFalsy();
  // Same name and personnel number in different employers are two explicit permanent people.
  const sameName = `Совпадающее ФИО ${stamp}`;
  await page.goto("/requests");
  await page.getByRole("link", { name: "Новая заявка", exact: true }).click();
  await page.getByRole("button", { name: /Человек Документы/ }).click();
  await page
    .getByRole("button", { name: "Удалить получателя 1", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Импорт / вставка", exact: true })
    .click();
  await page
    .getByLabel("Или вставьте таблицу с заголовками")
    .fill(
      `externalId\tpersonnelNumber\temployerId\tfullNameRu\nSCOPED-A-${stamp}\t000101\t${companies[0].id}\t${sameName}\nSCOPED-B-${stamp}\t000101\t${companies[1].id}\t${sameName}`,
    );
  await page
    .getByRole("button", { name: "Перейти к сопоставлению", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Добавить 2 строк в черновик", exact: true })
    .click();
  for (const row of [1, 2]) {
    await page
      .getByRole("button", {
        name: `Документы и даты получателя ${row}`,
        exact: true,
      })
      .click();
    await page.getByRole("tab", { name: "Личные данные", exact: true }).click();
    const record = page.locator("details").filter({
      has: page.getByText("Постоянная запись, работодатель и история", {
        exact: true,
      }),
    });
    if ((await record.getAttribute("open")) === null)
      await page
        .getByText("Постоянная запись, работодатель и история", { exact: true })
        .click();
    await page
      .getByLabel(
        "Подтверждаю актуальность сведений для постоянной записи человека",
      )
      .check();
    await page
      .getByRole("button", {
        name: "Сохранить человека в справочник",
        exact: true,
      })
      .click();
    await expect(
      page.getByText(
        "Текущие сведения человека сохранены в справочнике. Оформленные документы остаются неизменными.",
      ),
    ).toBeVisible();
    await save(page);
  }
  await page.reload();
  const sameNameSearch = await (
    await page.request.get(
      `/api/recipients?search=${encodeURIComponent(sameName)}`,
    )
  ).json();
  expect(sameNameSearch.total).toBe(2);
  expect(
    new Set(sameNameSearch.items.map((item: { id: string }) => item.id)).size,
  ).toBe(2);
  expect(
    new Set(
      sameNameSearch.items.map(
        (item: { data: { employerId: string } }) => item.data.employerId,
      ),
    ),
  ).toEqual(new Set(companies.map((company) => company.id)));
  expect(
    sameNameSearch.items.every(
      (item: { data: { personnelNumber: string } }) =>
        item.data.personnelNumber === "000101",
    ),
  ).toBe(true);
  await fs.writeFile(
    path.join(evidence, "customer-result.json"),
    JSON.stringify(
      {
        status: "PASS",
        requestId,
        nextId,
        recipientId: first.recipientId,
        noNameMerge: true,
        sameNameAndPersonnelAcrossEmployersRemainDistinct:
          sameNameSearch.items.map((item: { id: string }) => item.id),
        twoEmployers: companies.map((c) => c.id),
        employerPeriods: 2,
        scopedClarification: "Company A only",
        editableAndOmittable: true,
        clipboardEqualsEditedText: true,
        copyMutations: mutations,
        newAssignmentsNoOldOutcomeOrEvent: true,
        employerSelectionUpdatesCurrentRequisites: true,
        savedCustomerProfileOfferedAfterNewRequestReload: true,
        anotherCustomerProfileAndContactExcluded: true,
        noMocks: true,
      },
      null,
      2,
    ),
  );
});

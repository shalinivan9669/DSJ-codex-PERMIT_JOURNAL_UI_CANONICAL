import { loginIsolated } from "./operator-full-fix-session";
import { openRecipientExtraTools } from "./operator-keyboard-helpers";
import type { Customer } from "../lib/types";
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

test.use({ trace: "off" });
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    "../../docs/evidence/final-completion/operator/customer",
);
async function save(page: Page) {
  await expect(page.locator(".save-indicator").first()).toContainText(
    /сохранена/i,
  );
}
async function createEmpty(page: Page, kind: "PERSON" | "COMPANY") {
  await page
    .getByRole("radio", {
      name: kind === "PERSON" ? /^Физическое лицо/ : /^Организация/,
    })
    .check();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(page.getByLabel("ФИО, строка 1", { exact: true })).toBeVisible();
}
async function panel(page: Page, name: string) {
  await page
    .getByRole("button", { name: "Дополнительные действия", exact: true })
    .click();
  await page.getByRole("button", { name, exact: true }).click();
}
async function closePanel(page: Page) {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Закрыть диалог", exact: true })
    .click();
}
async function employerDetails(page: Page) {
  const employer = page.locator(".employer-document-wording");
  if (!(await employer.evaluate((node) => (node as HTMLDetailsElement).open)))
    await employer.locator(":scope > summary").click();
  const record = page.locator(".recipient-details .outcome-entry");
  if (!(await record.evaluate((node) => (node as HTMLDetailsElement).open)))
    await record.locator(":scope > summary").click();
}
test("real customer clarification can be scoped, reduced, edited and copied; employer change preserves periods and clean reuse", async ({
  page,
  context,
}) => {
  test.setTimeout(360000);
  await fs.mkdir(evidence, { recursive: true });
  await page.routeWebSocket(/\/_next\/webpack-hmr/, (socket) => socket.close());
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await loginIsolated(page);
  const companies: Customer[] = [];
  const stamp = Date.now();
  for (const [index, suffix] of ["A", "B"].entries()) {
    await page.goto("/customers");
    await page
      .getByRole("button", { name: "Добавить заказчика", exact: true })
      .click();
    const name = `Работодатель ${suffix} ${stamp}`;
    await page
      .getByRole("textbox", { name: /^Собственное наименование(?:\s|$)/ })
      .first()
      .fill(name);
    await page
      .getByText("Другое наименование на казахском", { exact: true })
      .click();
    await page
      .getByLabel("Собственное наименование на казахском отличается", {
        exact: true,
      })
      .check();
    await page
      .getByLabel("Собственное наименование · KZ", { exact: true })
      .fill(`Жұмыс беруші ${suffix}`);
    await page.getByText("Дополнительные реквизиты", { exact: true }).click();
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
  await createEmpty(page, "PERSON");
  await page
    .getByRole("button", { name: "Удалить получателя 1", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Убрать из заявки", exact: true })
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
  await page.getByLabel("ФИО, строка 1", { exact: true }).fill("");
  await page.getByLabel("ФИО, строка 2", { exact: true }).fill("");
  for (const row of [1, 2]) {
    await page
      .getByRole("button", { name: `Детали получателя ${row}`, exact: true })
      .click();
    const personal = page.getByRole("dialog");
    await personal.getByRole("tab", { name: /^Личные данные/ }).click();
    const kzName = personal.getByLabel("ФИО · KZ", { exact: true });
    if (!(await kzName.isVisible()))
      await personal.getByText(/^Казахский вариант/).click();
    await kzName.fill("");
    await closePanel(page);
  }
  await save(page);
  const requestId = /requests\/([^/]+)/.exec(page.url())![1];
  const originalPath = new URL(page.url()).pathname;
  const read = async () =>
    (await page.request.get(`/api/print-requests/${requestId}`)).json();
  await panel(page, "Согласование и передача");
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
  await closePanel(page);
  await page
    .getByLabel("ФИО, строка 1", { exact: true })
    .fill("Синтетический Однофамилец");
  await page
    .getByLabel("ФИО, строка 2", { exact: true })
    .fill("Синтетический Однофамилец");
  await save(page);
  await panel(page, "Комплект для заказчика");
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
  await closePanel(page);
  await page
    .getByRole("button", { name: "Детали получателя 1", exact: true })
    .click();
  await page.getByRole("tab", { name: "Личные данные", exact: true }).click();
  await employerDetails(page);
  await page
    .getByLabel("Должность / профессия", { exact: true })
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
    .getByLabel("Должность / профессия", { exact: true })
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
  await page
    .getByRole("button", { name: "Вернуться к списку", exact: true })
    .click();
  await page.goto("/requests");
  await page.getByRole("link", { name: "Новая заявка", exact: true }).click();
  await createEmpty(page, "PERSON");
  await openRecipientExtraTools(page);
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
  // Reuse copies identity only; no past document, date, result or group is assigned.
  expect(next.items[0].assignments).toEqual([]);
  expect(next.documents).toHaveLength(0);
  await page.goto("/requests");
  await page.getByRole("link", { name: "Новая заявка", exact: true }).click();
  await createEmpty(page, "COMPANY");
  await page
    .getByRole("button", { name: "Из справочника", exact: true })
    .click();
  const companyRequestId = /requests\/([^/]+)/.exec(page.url())![1];
  await save(page);
  const companyBeforeResponse = await page.request.get(
    `/api/print-requests/${companyRequestId}`,
  );
  expect(companyBeforeResponse.ok()).toBe(true);
  const companyBefore = await companyBeforeResponse.json();
  const initialNativeCompanyOptionCount = await page
    .getByRole("combobox", { name: "Компания", exact: true })
    .locator(`option[value="${companies[0].id}"]`)
    .count();
  await page
    .getByRole("button", { name: "Найти в справочнике", exact: true })
    .click();
  const companyPicker = page.getByRole("dialog", {
    name: "Найти заказчика",
    exact: true,
  });
  const companySearchResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === "GET" &&
      url.pathname === "/api/customers" &&
      url.searchParams.get("search") === companies[0].nameRu &&
      url.searchParams.get("page") === "1"
    );
  });
  await companyPicker
    .getByLabel("Поиск по справочнику", { exact: true })
    .fill(companies[0].nameRu);
  const searchedCompanyResponse = await companySearchResponse;
  expect(searchedCompanyResponse.ok()).toBe(true);
  const searchedCompany = await searchedCompanyResponse.json();
  expect(
    searchedCompany.items.map((company: { id: string }) => company.id),
  ).toEqual([companies[0].id]);
  const companyRow = companyPicker.locator("tbody tr").filter({
    has: page.getByText(companies[0].nameRu, { exact: true }),
  });
  await expect(companyRow).toHaveCount(1);
  const companyPatchResponse = page.waitForResponse((response) =>
    response.request().method() === "PATCH" &&
    new URL(response.url()).pathname ===
      `/api/print-requests/${companyRequestId}` &&
    response.request().postDataJSON()?.draft?.customerId === companies[0].id,
  );
  await companyRow
    .getByRole("button", { name: "Выбрать", exact: true })
    .click();
  await expect(companyPicker).toHaveCount(0);
  const selectedCompanyPatch = await companyPatchResponse;
  expect(selectedCompanyPatch.ok()).toBe(true);
  const companySaved = await selectedCompanyPatch.json();
  expect(companySaved.customerId).toBe(companies[0].id);
  expect(companySaved.items).toEqual(companyBefore.items);
  expect(companySaved.events).toEqual(companyBefore.events);
  await save(page);
  await page.reload();
  const companyReloadResponse = await page.request.get(
    `/api/print-requests/${companyRequestId}`,
  );
  expect(companyReloadResponse.ok()).toBe(true);
  const companyReloaded = await companyReloadResponse.json();
  expect(companyReloaded.customerId).toBe(companies[0].id);
  expect(companyReloaded.revision).toBe(companySaved.revision);
  expect(companyReloaded.items).toEqual(companyBefore.items);
  expect(companyReloaded.events).toEqual(companyBefore.events);
  expect(companyReloaded.documents).toEqual(companyBefore.documents);
  await panel(page, "Комплект для заказчика");
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
  await expect(page.locator(".operator-grid tbody tr")).toHaveCount(2);
  expect((await read()).items[1].recipientId).toBeFalsy();
  // Same name and personnel number in different employers are two explicit permanent people.
  const sameName = `Совпадающее ФИО ${stamp}`;
  await page.goto("/requests");
  await page.getByRole("link", { name: "Новая заявка", exact: true }).click();
  await createEmpty(page, "PERSON");
  await page
    .getByRole("button", { name: "Удалить получателя 1", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Убрать из заявки", exact: true })
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
        name: `Детали получателя ${row}`,
        exact: true,
      })
      .click();
    await page.getByRole("tab", { name: "Личные данные", exact: true }).click();
    await employerDetails(page);
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
    await page
      .getByRole("button", { name: "Вернуться к списку", exact: true })
      .click();
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
        companyDirectorySelection: {
          companyRequestId,
          initialNativeOptionCount: initialNativeCompanyOptionCount,
          searchedName: companies[0].nameRu,
          exactSearchResultIds: searchedCompany.items.map(
            (company: { id: string }) => company.id,
          ),
          selectedId: companySaved.customerId,
          patchRevision: companySaved.revision,
          reloadedRevision: companyReloaded.revision,
          before: companyBefore,
          after: companyReloaded,
        },
        anotherCustomerProfileAndContactExcluded: true,
        noMocks: true,
      },
      null,
      2,
    ),
  );
});

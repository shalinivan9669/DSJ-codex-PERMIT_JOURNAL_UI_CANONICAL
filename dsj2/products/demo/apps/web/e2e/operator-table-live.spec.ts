import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { newAssignment, newRecipient, type Draft } from "../lib/types";

const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    path.join(__dirname, "../../../.runtime/operator-ux-20260929/live-browser"),
);

async function login(page: Page) {
  if (
    !process.env.DEMO_E2E_EMAIL ||
    !process.env.DEMO_E2E_PASSWORD ||
    process.env.DEMO_E2E_ISOLATED_TENANT !== "1"
  )
    throw new Error("An explicitly isolated synthetic tenant is required");
  await page.routeWebSocket(/\/_next\/webpack-hmr/, (socket) => socket.close());
  await page.goto("/login");
  await page
    .getByLabel("Электронная почта", { exact: true })
    .fill(process.env.DEMO_E2E_EMAIL);
  await page
    .getByLabel("Пароль", { exact: true })
    .fill(process.env.DEMO_E2E_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Заявки на печать", exact: true }),
  ).toBeVisible();
  const response = await page.request.get("/api/auth/session");
  expect(response.ok()).toBe(true);
  return (await response.json()).csrfToken as string;
}

async function readDraft(page: Page, requestId: string) {
  const response = await page.request.get(`/api/print-requests/${requestId}`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as Draft & { documents: unknown[] };
}

async function createFixture(page: Page, csrfToken: string, count: number) {
  const draft = {
    kind: "PERSON",
    title: `Синтетический аудит оператора · ${count} получателей · ${Date.now()}`,
    customerId: null,
    demoMode: true,
    schemaVersion: 2,
    commonFields: { documentDate: "2026-09-29" },
    items: Array.from({ length: count }, (_, index) => ({
      ...newRecipient(),
      fullNameRu: `${index % 3 ? "Иванов Иван Сергеевич" : "Иванова Александра Константиновна"} ${String(index + 1).padStart(3, "0")}`,
      fullNameKz: `Әбдірахманов Нұрсұлтан Мұхамеджанұлы ${String(index + 1).padStart(3, "0")}`,
      positionRu: index % 2 ? "Мастер" : "Инженер",
      positionKz: index % 2 ? "Шебер" : "Инженер",
      workplaceRu:
        index % 7
          ? "Синтетическая организация Альфа"
          : "Синтетическая организация Бета, производственный участок № 2",
      workplaceKz: "Синтетикалық ұйым",
      assignments: [newAssignment("pb-card")],
    })),
  };
  const response = await page.request.post("/api/print-requests", {
    headers: {
      origin: new URL(page.url()).origin,
      "x-csrf-token": csrfToken,
    },
    data: draft,
  });
  expect(response.status(), await response.text()).toBe(201);
  const created = (await response.json()) as Draft;
  await page.goto(`/requests/${created.id}/edit`);
  await expect(page.locator(".operator-grid tbody tr")).toHaveCount(count);
  return readDraft(page, created.id);
}

for (const count of [100, 150, 250]) {
  test(`${count} real recipients: keyboard editing, scoped selection, bilingual fields, autosave and reload`, async ({
    page,
  }) => {
    test.setTimeout(360000);
    await fs.mkdir(evidence, { recursive: true });
    const csrfToken = await login(page);
    const before = await createFixture(page, csrfToken, count);
    const expectedItems = structuredClone(before.items);
    const requestId = before.id;
    const fixtureUrl = page.url();
    await fs.writeFile(
      path.join(evidence, `fixture-${count}.json`),
      JSON.stringify(
        { requestId, url: fixtureUrl, count, synthetic: true, issued: false },
        null,
        2,
      ),
    );

    const firstName = page.getByLabel("ФИО RU, строка 1", { exact: true });
    const firstPosition = page.getByLabel("Должность RU, строка 1", {
      exact: true,
    });
    expectedItems[0].fullNameRu = `Первый Оператор ${count}`;
    await firstName.fill(expectedItems[0].fullNameRu);
    await firstName.press("Enter");
    await expect(
      page.getByLabel("ФИО RU, строка 2", { exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Shift+Enter");
    await expect(firstName).toBeFocused();
    await firstName.press("Tab");
    await expect(firstPosition).toBeFocused();

    await page.getByLabel("Поиск в заявке", { exact: true }).fill("Мастер");
    await expect(page.locator(".operator-grid tbody tr")).toHaveCount(
      count / 2,
    );
    await page
      .getByLabel("Выбрать видимых получателей", { exact: true })
      .check();
    await expect(page.locator(".selection-toolbar")).toContainText(
      `Выбрано: ${count / 2}`,
    );
    await page
      .getByRole("button", { name: "Сбросить фильтры", exact: true })
      .click();
    await expect(
      page.getByLabel("Выбрать строку 1", { exact: true }),
    ).not.toBeChecked();
    await expect(
      page.getByLabel("Выбрать строку 2", { exact: true }),
    ).toBeChecked();
    await expect(
      page.getByLabel(`Выбрать строку ${count}`, { exact: true }),
    ).toBeChecked();
    await page
      .getByRole("button", { name: "Снять выбор", exact: true })
      .click();

    expectedItems[count - 1].fullNameRu = `Последний Оператор ${count}`;
    expectedItems[count - 1].positionRu = `Старший мастер ${count}`;
    const lastName = page.getByLabel(`ФИО RU, строка ${count}`, {
      exact: true,
    });
    const lastPosition = page.getByLabel(`Должность RU, строка ${count}`, {
      exact: true,
    });
    await lastName.fill(expectedItems[count - 1].fullNameRu);
    await lastName.press("Tab");
    await expect(lastPosition).toBeFocused();
    await lastPosition.fill(expectedItems[count - 1].positionRu!);
    await page.getByRole("button", { name: "RU + KZ", exact: true }).click();
    expectedItems[count - 1].fullNameKz = `Соңғы Оператор ${count}`;
    expectedItems[count - 1].positionKz = `Аға шебер ${count}`;
    await page
      .getByLabel(`ФИО KZ, строка ${count}`, { exact: true })
      .fill(expectedItems[count - 1].fullNameKz!);
    await page
      .getByLabel(`Должность KZ, строка ${count}`, { exact: true })
      .fill(expectedItems[count - 1].positionKz!);
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(page.locator(".save-indicator")).toContainText("Сохранено");
    const afterSave = await readDraft(page, requestId);
    expect(afterSave.items).toEqual(expectedItems);
    expect(afterSave.revision).toBeGreaterThan(before.revision);

    await page
      .getByRole("button", { name: "Настроить даты и протоколы", exact: true })
      .click();
    await expect(
      page.getByText("Даты и программа для всей заявки", { exact: true }),
    ).toBeVisible();
    const sharedValue = `Общая программа для ${count} получателей`;
    const savedCommon = page.waitForResponse((response) => {
      if (
        response.request().method() !== "PATCH" ||
        !response.url().endsWith(`/api/print-requests/${requestId}`)
      )
        return false;
      return (
        response.request().postDataJSON()?.draft?.commonFields
          ?.trainingSubject === sharedValue
      );
    });
    await page
      .getByLabel("Программа / тема для заявки", { exact: true })
      .fill(sharedValue);
    expect((await savedCommon).ok()).toBe(true);
    await expect(page.locator(".save-indicator")).toContainText("Сохранено");
    const afterAutosave = await readDraft(page, requestId);
    expect(afterAutosave.commonFields?.trainingSubject).toBe(sharedValue);
    expect(afterAutosave.items).toEqual(expectedItems);
    expect(afterAutosave.revision).toBeGreaterThan(afterSave.revision);

    await page.reload();
    await expect(page.locator(".operator-grid tbody tr")).toHaveCount(count);
    await expect(lastName).toHaveValue(expectedItems[count - 1].fullNameRu);
    await expect(lastPosition).toHaveValue(
      expectedItems[count - 1].positionRu!,
    );
    await page.getByRole("button", { name: "RU + KZ", exact: true }).click();
    await expect(
      page.getByLabel(`ФИО KZ, строка ${count}`, { exact: true }),
    ).toHaveValue(expectedItems[count - 1].fullNameKz!);
    await expect(
      page.getByLabel(`Должность KZ, строка ${count}`, { exact: true }),
    ).toHaveValue(expectedItems[count - 1].positionKz!);
    await page
      .getByRole("button", { name: "Настроить даты и протоколы", exact: true })
      .click();
    await expect(
      page.getByText("Даты и программа для всей заявки", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Программа / тема для заявки", { exact: true }),
    ).toHaveValue(sharedValue);
    await page.getByRole("button", { name: "Свернуть", exact: true }).click();
    await page.getByRole("button", { name: "RU", exact: true }).click();
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.locator(".operator-grid").scrollIntoViewIfNeeded();
    const desktopWidth = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      viewport: innerWidth,
    }));
    expect(desktopWidth.page).toBeLessThanOrEqual(desktopWidth.viewport);
    await page.screenshot({
      path: path.join(evidence, `table-${count}-desktop.png`),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".operator-grid").scrollIntoViewIfNeeded();
    const narrowWidth = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      viewport: innerWidth,
    }));
    expect(narrowWidth.page).toBeLessThanOrEqual(narrowWidth.viewport);
    await page.screenshot({
      path: path.join(evidence, `table-${count}-narrow.png`),
    });
    await page
      .getByLabel("Поиск в заявке", { exact: true })
      .fill(expectedItems[count - 1].fullNameRu);
    await expect(page.locator(".operator-grid tbody tr")).toHaveCount(1);
    await expect(lastName).toHaveValue(expectedItems[count - 1].fullNameRu);
    await page.screenshot({
      path: path.join(evidence, `table-${count}-narrow-search.png`),
    });

    const final = await readDraft(page, requestId);
    expect(final.items).toEqual(expectedItems);
    expect(final.commonFields?.trainingSubject).toBe(sharedValue);
    expect(final.status).toBe("DRAFT");
    expect(final.documents).toHaveLength(0);
    await fs.writeFile(
      path.join(evidence, `live-${count}-result.json`),
      JSON.stringify(
        {
          status: "PASS",
          checkedAt: new Date().toISOString(),
          requestId,
          url: fixtureUrl,
          rows: count,
          keyboard: ["Enter", "Shift+Enter", "Tab"],
          filteredSelection: count / 2,
          bilingualLastRowSaved: true,
          allRecipientFieldsMatchAfterReload: true,
          commonFieldsAutosavedWithoutSaveClick: true,
          revisions: [
            before.revision,
            afterSave.revision,
            afterAutosave.revision,
          ],
          desktopWidth,
          narrowWidth,
          draftOnly: true,
          issuedDocuments: final.documents.length,
        },
        null,
        2,
      ),
    );
  });
}

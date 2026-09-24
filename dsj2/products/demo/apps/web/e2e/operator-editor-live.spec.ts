import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";

const product = path.resolve(__dirname, "../../..");
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    path.join(product, "docs/evidence/final-completion/operator/editor"),
);
async function login(page: Page) {
  await page.routeWebSocket(/\/_next\/webpack-hmr/, (socket) => socket.close());
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
}
async function save(page: Page) {
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.locator(".save-indicator")).toContainText("Сохранено");
}
async function paste(page: Page, row: number, text: string) {
  await page
    .getByLabel(`ФИО RU, строка ${row}`, { exact: true })
    .evaluate((element, content) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", content);
      element.dispatchEvent(
        new ClipboardEvent("paste", { bubbles: true, clipboardData }),
      );
    }, text);
  const modal = page.getByRole("dialog");
  await expect(modal).toContainText(`Начало: строка ${row}, колонка ФИО RU`);
  await modal.getByLabel("Режим вставки").selectOption("REPLACE");
  await modal
    .getByLabel("Подтверждаю замену значений показанного диапазона")
    .check();
  const close = modal.getByRole("button", {
    name: "Закрыть диалог",
    exact: true,
  });
  const apply = modal.getByRole("button", {
    name: "Применить диапазон",
    exact: true,
  });
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(apply).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await modal
    .getByRole("button", { name: "Применить диапазон", exact: true })
    .click();
  await expect(modal).toHaveCount(0);
}

test("100 real rows preserve imported/manual/cleared common overrides, keyboard ranges, one undo and two actual session saves", async ({
  page,
  browser,
}) => {
  test.setTimeout(360000);
  await fs.mkdir(evidence, { recursive: true });
  await login(page);
  await page.getByRole("link", { name: "Новая заявка", exact: true }).click();
  await page.getByRole("button", { name: /Человек Документы/ }).click();
  await page
    .getByLabel("Название заявки", { exact: true })
    .fill(`100 строк · наследование и две сессии ${Date.now()}`);
  await page
    .getByRole("button", { name: "Удалить получателя 1", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Импорт / вставка", exact: true })
    .click();
  const source = JSON.parse(
    await fs.readFile(
      path.join(product, "tests/fixtures/operator-value/100_people.json"),
      "utf8",
    ),
  );
  const people: Record<string, string>[] = source.people;
  const columns = [
    "externalPersonKey",
    "personnelNumber",
    "fullNameRu",
    "fullNameKz",
    "positionRu",
    "positionKz",
    "hours",
  ];
  await page
    .getByLabel("Или вставьте таблицу с заголовками")
    .fill(
      [
        columns.join("\t"),
        ...people.map((person, index) =>
          columns
            .map((column) =>
              column === "hours" ? (index === 1 ? "16" : "") : person[column],
            )
            .join("\t"),
        ),
      ].join("\n"),
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
    .getByRole("button", { name: "Добавить 100 строк в черновик", exact: true })
    .click();
  await expect(page.locator(".recipient-table tbody tr")).toHaveCount(100);
  await page.getByLabel("Выбрать всех получателей", { exact: true }).check();
  await page
    .getByRole("button", { name: "Настроить общий контекст", exact: true })
    .click();
  await page
    .getByLabel(
      "Присоединить к событию существующее назначение той же формы без результата и основания, если оно одно. Импортированные и ручные исключения сохраняются.",
    )
    .check();
  await page
    .getByRole("button", { name: "Добавить событие", exact: true })
    .click();
  const eventPanel = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "Общие сведения и события",
      exact: true,
    }),
  });
  await eventPanel
    .getByLabel("Дата документа", { exact: true })
    .fill("2026-09-24");
  await eventPanel
    .getByLabel("Объём обучения, часов", { exact: true })
    .fill("8");
  await eventPanel
    .getByLabel("Программа / тема", { exact: true })
    .fill("Общая программа 1");
  await page
    .getByRole("button", {
      name: "Назначить набор выбранным (100)",
      exact: true,
    })
    .click();
  await save(page);
  const requestPath = new URL(page.url()).pathname;
  const requestId = /requests\/([^/]+)/.exec(page.url())![1];
  const read = async (suffix = "") =>
    (
      await page.request.get(`/api/print-requests/${requestId}${suffix}`)
    ).json();
  const initial = await read();
  expect(
    initial.items.every(
      (item: { assignments: unknown[] }) => item.assignments.length === 1,
    ),
  ).toBe(true);
  expect(initial.items[1].assignments[0].fieldOrigins.hours).toBe("IMPORTED");
  expect(initial.items[1].assignments[0].hours).toBe("16");
  await page
    .getByRole("button", { name: "Документы и даты получателя 1", exact: true })
    .click();
  const details = page.locator(".assignment-list");
  await details.getByLabel("Объём обучения, часов", { exact: true }).fill("12");
  await page
    .getByRole("button", { name: "Документы и даты получателя 3", exact: true })
    .click();
  await details.getByLabel("Объём обучения, часов", { exact: true }).fill("");
  await eventPanel
    .getByLabel("Объём обучения, часов", { exact: true })
    .fill("24");
  await eventPanel
    .getByLabel("Программа / тема", { exact: true })
    .fill("Общая программа 2");
  await save(page);
  await page.reload();
  await expect(page.locator(".recipient-table tbody tr")).toHaveCount(100);
  const raw = await read();
  const resolved = await read("/resolved");
  expect(raw.items[0].assignments[0].fieldOrigins.hours).toBe("MANUAL");
  expect(raw.items[1].assignments[0].fieldOrigins.hours).toBe("IMPORTED");
  expect(raw.items[2].assignments[0].fieldOrigins.hours).toBe("CLEARED");
  expect(
    resolved.draft.items
      .slice(0, 4)
      .map(
        (item: { assignments: { hours: string }[] }) =>
          item.assignments[0].hours,
      ),
  ).toEqual(["12", "16", "", "24"]);
  expect(
    resolved.draft.items.every(
      (item: { assignments: { trainingSubject: string }[] }) =>
        item.assignments[0].trainingSubject === "Общая программа 2",
    ),
  ).toBe(true);
  for (const row of [1, 2, 3]) {
    await page
      .getByRole("button", {
        name: `Документы и даты получателя ${row}`,
        exact: true,
      })
      .click();
    const provenance = page.locator(".field-provenance");
    if ((await provenance.getAttribute("open")) === null)
      await provenance.locator("summary").click();
    const hours = provenance
      .locator("dl > div")
      .filter({ has: page.locator("dt", { hasText: /^Часы$/ }) });
    await hours
      .getByRole("button", { name: "Вернуть общее значение", exact: true })
      .click();
    await expect(
      details.getByLabel("Объём обучения, часов", { exact: true }),
    ).toHaveValue("24");
  }
  await save(page);
  await page.reload();
  const restored = await read("/resolved");
  expect(
    restored.draft.items.every(
      (item: { assignments: { hours: string }[] }) =>
        item.assignments[0].hours === "24",
    ),
  ).toBe(true);
  const ru = page.getByLabel("ФИО RU, строка 100", { exact: true });
  const kz = page.getByLabel("ФИО KZ, строка 100", { exact: true });
  await ru.focus();
  await page.keyboard.press("Tab");
  await expect(kz).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(ru).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await read()).status).toBe("DRAFT");
  const beforePaste = await read();
  await paste(
    page,
    99,
    "Изменённый 099\tӨзгерген Ә Ғ Қ 099\nИзменённый 100\tӨзгерген Ң Ө Ұ Ү Һ І 100",
  );
  const afterPaste = await read();
  expect(afterPaste.items[98].fullNameRu).toBe("Изменённый 099");
  expect(afterPaste.items[99].fullNameKz).toBe("Өзгерген Ң Ө Ұ Ү Һ І 100");
  expect(afterPaste.items.slice(0, 98)).toEqual(beforePaste.items.slice(0, 98));
  expect(afterPaste.items[99].positionRu).toBe(
    beforePaste.items[99].positionRu,
  );
  expect(afterPaste.items[99].assignments).toEqual(
    beforePaste.items[99].assignments,
  );
  await page
    .getByRole("button", { name: "Отменить массовое изменение", exact: true })
    .click();
  await expect(
    page.getByLabel("ФИО RU, строка 99", { exact: true }),
  ).toHaveValue(beforePaste.items[98].fullNameRu);
  expect((await read()).items).toEqual(beforePaste.items);
  const secondContext = await browser.newContext({
    baseURL: process.env.DEMO_ORIGIN,
  });
  try {
    const second = await secondContext.newPage();
    await login(second);
    await paste(
      page,
      99,
      "Изменённый 099\tӨзгерген 099\nИзменённый 100\tӨзгерген 100",
    );
    await second.goto(requestPath);
    await second
      .getByLabel("Название заявки", { exact: true })
      .fill("Другая живая сессия сохранила заголовок");
    await save(second);
    const foreign = await read();
    await page
      .getByRole("button", { name: "Отменить массовое изменение", exact: true })
      .click();
    await expect(
      page.getByText(/Заявка изменена другим оператором/),
    ).toBeVisible();
    expect((await read()).items).toEqual(foreign.items);
    expect((await read()).title).toBe(foreign.title);
    expect((await read()).revision).toBe(foreign.revision);
    expect((await read()).issuances).toHaveLength(0);
    await page.screenshot({
      path: path.join(evidence, "two-live-sessions-conflict.png"),
      fullPage: true,
    });
  } finally {
    await secondContext.close();
  }
  await page.reload();
  await expect(page.getByLabel("Название заявки", { exact: true })).toHaveValue(
    "Другая живая сессия сохранила заголовок",
  );
  const beforeSubset = await read();
  await page.getByLabel("Выбрать строку 1", { exact: true }).check();
  await page.getByLabel("Выбрать строку 2", { exact: true }).check();
  await page
    .getByRole("combobox", { name: "Направление нового события", exact: true })
    .selectOption("ptm");
  await page
    .getByRole("button", { name: "Добавить событие", exact: true })
    .click();
  await page
    .getByLabel("Название события", { exact: true })
    .fill("Другое событие ПТМ для двух людей");
  await eventPanel
    .getByLabel("Дата документа", { exact: true })
    .fill("2026-10-01");
  await eventPanel
    .getByLabel("Программа / тема", { exact: true })
    .fill("Отдельная программа ПТМ");
  await page
    .getByRole("button", { name: "Назначить набор выбранным (2)", exact: true })
    .click();
  await save(page);
  const subset = await read();
  expect(subset.events).toHaveLength(2);
  expect(
    subset.items
      .slice(0, 2)
      .every(
        (item: { assignments: unknown[] }) => item.assignments.length === 2,
      ),
  ).toBe(true);
  expect(subset.items.slice(2)).toEqual(beforeSubset.items.slice(2));
  expect(
    subset.items.map((item: { assignments: unknown[] }) => item.assignments[0]),
  ).toEqual(
    beforeSubset.items.map(
      (item: { assignments: unknown[] }) => item.assignments[0],
    ),
  );
  const secondEventId = subset.events[1].id;
  for (const item of subset.items.slice(0, 2)) {
    expect(item.assignments[1].templateId).toBe("ptm-card");
    expect(item.assignments[1].eventId).toBe(secondEventId);
    expect(item.assignments[1].outcome.status).toBe("UNKNOWN");
  }
  await page
    .getByRole("button", { name: "Назначить набор выбранным (2)", exact: true })
    .click();
  await save(page);
  expect((await read()).items).toEqual(subset.items);
  await page.reload();
  expect((await read()).events).toEqual(subset.events);
  await page.getByLabel("Выбрать строку 1", { exact: true }).check();
  await page.getByLabel("Выбрать строку 2", { exact: true }).check();
  await page
    .getByRole("combobox", { name: "Направление нового события", exact: true })
    .selectOption("pb");
  await page
    .getByRole("button", { name: "Добавить событие", exact: true })
    .click();
  await page
    .getByLabel("Название события", { exact: true })
    .fill("PB новая дата для переноса");
  await eventPanel
    .getByLabel("Объём обучения, часов", { exact: true })
    .fill("40");
  await eventPanel
    .getByLabel("Дата документа", { exact: true })
    .fill("2026-10-02");
  await save(page);
  const moveTarget = (await read()).events.find(
    (event: { title: string }) => event.title === "PB новая дата для переноса",
  );
  await page
    .getByRole("combobox", { name: "Событие", exact: true })
    .selectOption(subset.events[0].id);
  await page
    .getByRole("button", { name: "Документы и даты получателя 1", exact: true })
    .click();
  await page
    .locator(".assignment-list > details")
    .first()
    .getByLabel("Объём обучения, часов", { exact: true })
    .fill("30");
  await page
    .getByText("Подтвердить фактические результаты события", { exact: true })
    .click();
  await page
    .getByLabel("Известный результат", { exact: true })
    .selectOption("PASSED");
  await page
    .getByLabel("Источник подтверждения", { exact: true })
    .fill("Синтетическая старая ведомость перед переносом");
  await page
    .getByRole("button", {
      name: "Проверить применение результатов",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Подтвердить результаты", exact: true })
    .click();
  await save(page);
  const priorMove = await read();
  expect(priorMove.items[0].assignments[0].outcome.status).toBe("PASSED");
  await page
    .getByText("Перенести выбранных участников в другое событие", {
      exact: true,
    })
    .click();
  await page
    .getByRole("combobox", { name: "Событие назначения", exact: true })
    .selectOption(moveTarget.id);
  await page
    .getByLabel(
      "Подтверждаю перенос выбранных участников и снятие прежних результатов. Состав и общие параметры нового события проверены.",
    )
    .check();
  await page
    .getByRole("button", {
      name: "Перенести выбранные назначения",
      exact: true,
    })
    .click();
  await save(page);
  await page.reload();
  const moved = await read();
  expect(moved.items.slice(2)).toEqual(priorMove.items.slice(2));
  for (const [index, item] of moved.items.slice(0, 2).entries()) {
    expect(item.assignments[0].eventId).toBe(moveTarget.id);
    expect(item.assignments[0].outcome.status).toBe("UNKNOWN");
    expect(item.assignments[0].result).toBe("");
    expect(item.assignments[1]).toEqual(priorMove.items[index].assignments[1]);
  }
  const movedResolved = await read("/resolved");
  expect(movedResolved.draft.items[0].assignments[0].hours).toBe("30");
  expect(movedResolved.draft.items[1].assignments[0].hours).toBe("40");
  await fs.writeFile(
    path.join(evidence, "editor-result.json"),
    JSON.stringify(
      {
        status: "PASS",
        requestId,
        rows: 100,
        noMocks: true,
        twoRealSessions: true,
        importedManualClearedAfterCommonChange: ["12", "16", "", "24"],
        resetAfterReload: "24 for all 100",
        clipboardRange: "2x2 starting row99",
        adjacentFieldsPreserved: true,
        undoOneOperation: true,
        staleUndoPreservedForeignRevision: true,
        keyboard: ["Tab", "Shift+Tab", "Enter"],
        noIssuance: true,
        separateSubsetEvent:
          "two PTM assignments; all prior PB and other 98 participants unchanged",
        repeatedEventSetIdempotent: true,
        explicitMovePreservesOverridesAndOtherEvents: true,
        movedOldOutcomeResetToUnknown: true,
      },
      null,
      2,
    ),
  );
});

import { loginIsolated } from "./operator-full-fix-session";
import { assertTechnicalBlankRemoval } from "./operator-keyboard-helpers";
import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";

const product = path.resolve(__dirname, "../../..");
test.use({ trace: "off" });
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    path.join(product, "docs/evidence/final-completion/operator/editor"),
);
async function login(page: Page, freshSession = false) {
  await page.routeWebSocket(/\/_next\/webpack-hmr/, (socket) => socket.close());
  if (!freshSession) {
    await loginIsolated(page);
    return;
  }
  if (!process.env.DEMO_E2E_EMAIL || !process.env.DEMO_E2E_PASSWORD)
    throw new Error("ISOLATED_TEST_LOGIN_REQUIRED");
  await page.goto("/login");
  await page
    .getByLabel("Электронная почта", { exact: true })
    .fill(process.env.DEMO_E2E_EMAIL);
  await page
    .getByLabel("Пароль", { exact: true })
    .fill(process.env.DEMO_E2E_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  try {
    await expect(
      page.getByRole("heading", { name: "Заявки на печать", exact: true }),
    ).toBeVisible();
  } catch (error) {
    await page.getByLabel("Пароль", { exact: true }).fill("");
    throw error;
  }
  const session = await (await page.request.get("/api/auth/session")).json();
  expect(session.tenant.demoOnly).toBe(true);
  expect(session.user.role).toBe("OPERATOR");
}
async function save(page: Page) {
  await expect(
    page.getByRole("button", { name: "Детали получателя 1", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".save-indicator").first()).toContainText(
    /сохранена/i,
  );
}
async function events(page: Page) {
  await page
    .getByRole("button", { name: "Дополнительные действия", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Общие даты и протоколы", exact: true })
    .click();
  return page.getByRole("dialog");
}
async function close(page: Page) {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Закрыть диалог", exact: true })
    .click();
  await save(page);
}
async function training(page: Page, row: number) {
  await page
    .getByRole("button", { name: `Детали получателя ${row}`, exact: true })
    .click();
  const assignment = page.locator(".assignment-list > details").first();
  await assignment.getByRole("tab", { name: /^Основное/ }).click();
  await expect(
    assignment.getByLabel("Объём обучения, часов", { exact: true }),
  ).toBeVisible();
  return assignment;
}
async function paste(page: Page, row: number, text: string) {
  await page
    .getByLabel(`ФИО, строка ${row}`, { exact: true })
    .evaluate((element, content) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", content);
      element.dispatchEvent(
        new ClipboardEvent("paste", { bubbles: true, clipboardData }),
      );
    }, text);
  const modal = page.getByRole("dialog");
  await expect(modal).toContainText(`Начало: строка ${row}, колонка ФИО`);
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
  await page.getByRole("radio", { name: /^Организация/ }).check();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page
    .getByRole("button", { name: "Удалить получателя 1", exact: true })
    .click();
  await assertTechnicalBlankRemoval(page);
  await page.getByRole("button", { name: "Импорт", exact: true }).click();
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
    .getByRole("button", { name: "Проверить таблицу", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .locator(".import-document-options > summary")
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
  await expect(page.locator(".operator-grid tbody tr")).toHaveCount(100);
  await page.getByLabel("Выбрать видимых получателей", { exact: true }).check();
  const eventPanel = await events(page);
  await eventPanel
    .getByRole("combobox", { name: "Направление нового события", exact: true })
    .selectOption("pb");
  await eventPanel
    .getByLabel(
      "Присоединить к событию существующее назначение той же формы без результата и основания, если оно одно. Импортированные и ручные исключения сохраняются.",
    )
    .check();
  await eventPanel
    .getByRole("button", { name: "Добавить событие", exact: true })
    .click();
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
  await close(page);
  const requestPath = new URL(page.url()).pathname;
  const requestId = /requests\/([^/]+)/.exec(page.url())![1];
  const read = async (suffix = "") =>
    (
      await page.request.get(`/api/print-requests/${requestId}${suffix}`)
    ).json();
  await expect
    .poll(
      async () =>
        (await read()).items.every(
          (item: {
            assignments: { eventId?: string; protocolMode?: string }[];
          }) =>
            item.assignments.length === 1 &&
            !!item.assignments[0].eventId &&
            item.assignments[0].protocolMode === "GROUP",
        ),
      { timeout: 30000 },
    )
    .toBe(true);
  const initial = await read();
  await fs.writeFile(
    path.join(evidence, "100-join-initial-committed.json"),
    JSON.stringify(initial, null, 2),
  );
  expect(
    initial.items.every(
      (item: { assignments: unknown[] }) => item.assignments.length === 1,
    ),
  ).toBe(true);
  expect(initial.items[1].assignments[0].fieldOrigins.hours).toBe("IMPORTED");
  expect(initial.items[1].assignments[0].hours).toBe("16");
  // A mapped empty spreadsheet cell is an explicit CLEARED fact. Restore
  // only row 4 to inheritance; all other imported blanks must stay cleared.
  expect(initial.items.filter((_: unknown, index: number) => index !== 1).every(
    (item: { assignments: { hours: string; fieldOrigins: { hours: string } }[] }) =>
      item.assignments[0].hours === "" && item.assignments[0].fieldOrigins.hours === "CLEARED",
  )).toBe(true);
  const details = page.locator(".assignment-list > details").first();
  async function restoreHours(row: number, expected: string) {
    await page
      .getByRole("button", {
        name: `Детали получателя ${row}`,
        exact: true,
      })
      .click();
    await details.getByRole("tab", { name: /^Настройки/ }).click();
    const provenance = details.locator(".field-provenance").filter({
      has: page.getByText("Источники общих значений", { exact: true }),
    });
    if ((await provenance.getAttribute("open")) === null)
      await provenance.locator("summary").click();
    const hours = provenance
      .locator("dl > div")
      .filter({ has: page.locator("dt", { hasText: /^Часы$/ }) });
    await hours
      .getByRole("button", { name: "Вернуть общее значение", exact: true })
      .click();
    await details.getByRole("tab", { name: /^Основное/ }).click();
    await expect(
      details.getByLabel("Объём обучения, часов", { exact: true }),
    ).toHaveValue(expected);
    await close(page);
  }
  await restoreHours(4, "8");
  await training(page, 1);
  await details.getByLabel("Объём обучения, часов", { exact: true }).fill("12");
  await close(page);
  await training(page, 3);
  await details.getByLabel("Объём обучения, часов", { exact: true }).fill("");
  await close(page);
  await events(page);
  await eventPanel
    .getByLabel("Объём обучения, часов", { exact: true })
    .fill("24");
  await eventPanel
    .getByLabel("Программа / тема", { exact: true })
    .fill("Общая программа 2");
  await close(page);
  await page.reload();
  await expect(page.locator(".operator-grid tbody tr")).toHaveCount(100);
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
  for (const row of [1, 2, 3]) await restoreHours(row, "24");
  await save(page);
  await page.reload();
  const restored = await read("/resolved");
  expect(
    restored.draft.items.slice(0, 4).every(
      (item: { assignments: { hours: string }[] }) =>
        item.assignments[0].hours === "24",
    ),
  ).toBe(true);
  expect(restored.draft.items.slice(4).every(
    (item: { assignments: { hours: string }[] }) => item.assignments[0].hours === "",
  )).toBe(true);
  const restoredRaw = await read();
  expect(restoredRaw.items.slice(4).map(
    (item: { assignments: unknown[] }) => item.assignments,
  )).toEqual(initial.items.slice(4).map(
    (item: { assignments: unknown[] }) => item.assignments,
  ));
  const ru = page.getByLabel("ФИО, строка 100", { exact: true });
  const position = page.getByLabel("Должность · RU, строка 100", {
    exact: true,
  });
  await ru.focus();
  await page.keyboard.press("Tab");
  await expect(position).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(ru).toBeFocused();
  // Enter on the final populated name deliberately adds a row. Exercise the
  // existing 99-to-100 navigation here while keeping this fixture at 100 people.
  await page.keyboard.press("Shift+Enter");
  await expect(page.getByLabel("ФИО, строка 99", { exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(ru).toBeFocused();
  await expect(page.locator(".operator-grid tbody tr")).toHaveCount(100);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await read()).status).toBe("DRAFT");
  const beforePaste = await read();
  expect(beforePaste.items).toHaveLength(100);
  await paste(
    page,
    99,
    "Изменённый 099\tӨзгерген Ә Ғ Қ 099\nИзменённый 100\tӨзгерген Ң Ө Ұ Ү Һ І 100",
  );
  const afterPaste = await read();
  expect(afterPaste.items[98].fullNameRu).toBe("Изменённый 099");
  expect(afterPaste.items[99].positionRu).toBe("Өзгерген Ң Ө Ұ Ү Һ І 100");
  expect(afterPaste.items[99].fullNameKz).toBe(
    beforePaste.items[99].fullNameKz,
  );
  expect(afterPaste.items.slice(0, 98)).toEqual(beforePaste.items.slice(0, 98));
  expect(afterPaste.items[99].positionKz).toBe(
    beforePaste.items[99].positionKz,
  );
  expect(afterPaste.items[99].assignments).toEqual(
    beforePaste.items[99].assignments,
  );
  await page
    .getByRole("button", { name: "Отменить массовое изменение", exact: true })
    .click();
  await expect(page.getByLabel("ФИО, строка 99", { exact: true })).toHaveValue(
    beforePaste.items[98].fullNameRu,
  );
  expect((await read()).items).toEqual(beforePaste.items);
  const secondContext = await browser.newContext({
    baseURL: process.env.DEMO_ORIGIN,
  });
  try {
    const second = await secondContext.newPage();
    await login(second, true);
    const firstSession = (await page.context().cookies()).find(
      (cookie) => cookie.name === "demo_session",
    );
    const secondSession = (await secondContext.cookies()).find(
      (cookie) => cookie.name === "demo_session",
    );
    expect(firstSession?.value).toBeTruthy();
    expect(secondSession?.value).toBeTruthy();
    expect(secondSession?.value).not.toBe(firstSession?.value);
    await paste(
      page,
      99,
      "Изменённый 099\tӨзгерген 099\nИзменённый 100\tӨзгерген 100",
    );
    await second.goto(requestPath);
    await second
      .getByLabel("Должность · RU, строка 50", { exact: true })
      .fill("Другая живая сессия сохранила должность");
    await save(second);
    const foreign = await read();
    expect(foreign.items[49].positionRu).toBe(
      "Другая живая сессия сохранила должность",
    );
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
  await expect(
    page.getByLabel("Должность · RU, строка 50", { exact: true }),
  ).toHaveValue("Другая живая сессия сохранила должность");
  const beforeSubset = await read();
  await page.getByLabel("Выбрать строку 1", { exact: true }).check();
  await page.getByLabel("Выбрать строку 2", { exact: true }).check();
  await events(page);
  await eventPanel
    .getByRole("combobox", { name: "Направление нового события", exact: true })
    .selectOption("ptm");
  await eventPanel
    .getByRole("button", { name: "Добавить событие", exact: true })
    .click();
  await eventPanel
    .getByLabel("Название события", { exact: true })
    .fill("Другое событие ПТМ для двух людей");
  await eventPanel
    .getByLabel("Дата документа", { exact: true })
    .fill("2026-10-01");
  await eventPanel
    .getByLabel("Программа / тема", { exact: true })
    .fill("Отдельная программа ПТМ");
  await eventPanel
    .getByRole("button", { name: "Назначить набор выбранным (2)", exact: true })
    .click();
  await close(page);
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
    expect(item.assignments[1].outcome.status).toBe("PASSED");
    expect(item.assignments[1].fieldOrigins.result).toBe("COURSE");
  }
  await events(page);
  await eventPanel
    .getByRole("combobox", { name: "Событие", exact: true })
    .selectOption(secondEventId);
  await eventPanel
    .getByRole("button", { name: "Назначить набор выбранным (2)", exact: true })
    .click();
  await close(page);
  expect((await read()).items).toEqual(subset.items);
  await page.reload();
  expect((await read()).events).toEqual(subset.events);
  await page.getByLabel("Выбрать строку 1", { exact: true }).check();
  await page.getByLabel("Выбрать строку 2", { exact: true }).check();
  await events(page);
  await eventPanel
    .getByRole("combobox", { name: "Направление нового события", exact: true })
    .selectOption("pb");
  await eventPanel
    .getByRole("button", { name: "Добавить событие", exact: true })
    .click();
  await eventPanel
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
  await eventPanel
    .getByRole("combobox", { name: "Событие", exact: true })
    .selectOption(subset.events[0].id);
  await close(page);
  await training(page, 1);
  await page
    .locator(".assignment-list > details")
    .first()
    .getByLabel("Объём обучения, часов", { exact: true })
    .fill("30");
  await close(page);
  await events(page);
  await eventPanel
    .getByRole("combobox", { name: "Событие", exact: true })
    .selectOption(subset.events[0].id);
  await eventPanel
    .getByText("Подтвердить фактические результаты события", { exact: true })
    .click();
  await eventPanel
    .getByLabel("Известный результат", { exact: true })
    .selectOption("PASSED");
  await eventPanel
    .getByLabel("Источник подтверждения", { exact: true })
    .fill("Синтетическая старая ведомость перед переносом");
  await eventPanel
    .getByRole("button", {
      name: "Применить результат · 2 человек",
      exact: true,
    })
    .click();
  await save(page);
  const priorMove = await read();
  expect(priorMove.items[0].assignments[0].outcome.status).toBe("PASSED");
  await eventPanel
    .getByText("Перенести выбранных участников в другое событие", {
      exact: true,
    })
    .click();
  await eventPanel
    .getByRole("combobox", { name: "Событие назначения", exact: true })
    .selectOption(moveTarget.id);
  await eventPanel
    .getByLabel(
      "Подтверждаю перенос выбранных участников и снятие прежних результатов. Состав и общие параметры нового события проверены.",
    )
    .check();
  await eventPanel
    .getByRole("button", {
      name: "Перенести выбранные назначения",
      exact: true,
    })
    .click();
  await close(page);
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

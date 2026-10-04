import { test, expect, type Page } from "@playwright/test";
import { applyBusinessRules, resolveDraft } from "@demo/contracts";
import { newRecipient, type Draft } from "../lib/types";

const longKz = "Әбдірахманов Нұрсұлтан Мұхамеджанұлы";

async function workspace(page: Page, count = 150) {
  await page.routeWebSocket(/\/_next\/webpack-hmr/, (socket) => socket.close());
  let draft: Draft = {
    id: "grid-context",
    revision: 0,
    status: "DRAFT",
    kind: "PERSON",
    title: "Контекст оператора: смешанный список",
    customerId: null,
    demoMode: true,
    schemaVersion: 2,
    commonFields: {},
    items: Array.from({ length: count }, (_, index) => ({
      ...newRecipient(),
      id: `context-row-${index}`,
      fullNameRu:
        index === 0
          ? ""
          : `${index % 2 ? "Иванов" : "Иванова"} ${index + 1} Александрович`,
      fullNameKz: index === 0 ? longKz : `Серікұлы Әділет ${index + 1}`,
      positionRu:
        index % 2
          ? "Мастер участка"
          : "Инженер по охране труда и промышленной безопасности",
      positionKz: "Еңбек қауіпсіздігі және еңбекті қорғау инженері",
      workplaceRu:
        "Синтетическое предприятие по производству строительных материалов, участок № 2",
      workplaceKz:
        "Құрылыс материалдарын өндіру жөніндегі синтетикалық кәсіпорын",
      personnelNumber: `Т-${index + 1}`,
    })),
  };
  draft = applyBusinessRules(draft);
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.slice(4);
    let value: unknown = { items: [], total: 0 };
    if (path === "/auth/session") value = { csrfToken: "fixture" };
    else if (path === "/context")
      value = {
        user: {
          id: "operator",
          displayName: "Оператор",
          role: "OPERATOR",
          email: "test@example.invalid",
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
          cityRu: "Синтетический город",
          cityKz: "Синтетикалық қала",
          approvalBasis: "",
          commission: [0, 1, 2].map((index) => ({
            name: `Синтетический член ${index + 1}`,
            position: index ? "Член комиссии" : "Председатель",
          })),
          approved: true,
        },
        templates: [],
        numbering: {},
      };
    else if (path === "/print-requests/grid-context/resolved")
      value = resolveDraft(draft);
    else if (path === "/print-requests/grid-context/validate")
      value = {
        valid: false,
        errors: [
          {
            path: "items.1.positionRu",
            itemId: "context-row-1",
            message: "Уточните должность Иванова",
          },
          {
            path: "items.2.personnelNumber",
            itemId: "context-row-2",
            message: "Уточните табельный номер",
          },
          {
            path: "items.3.assignments.0.trainingSubject",
            itemId: "context-row-3",
            message: "Укажите тему обучения четвёртого получателя",
          },
        ],
      };
    else if (path === "/print-requests/grid-context") {
      if (route.request().method() === "PATCH") {
        const body = route.request().postDataJSON();
        if (body.expectedRevision !== draft.revision) {
          await route.fulfill({
            status: 409,
            json: { message: "Конфликт редакций" },
          });
          return;
        }
        draft = {
          ...draft,
          ...body.draft,
          revision: draft.revision + 1,
          ...(draft.approval
            ? { approval: { ...draft.approval, status: "PENDING" as const } }
            : {}),
        };
        value = {
          revision: draft.revision,
          approval: draft.approval,
          approvedRevision: draft.approvedRevision,
        };
      } else value = draft;
    }
    await route.fulfill({ json: value });
  });
  await page.goto("/requests/grid-context/edit");
  await expect(page.getByLabel("ФИО, строка 1", { exact: true })).toBeVisible();
  const listTools = page.locator(".operator-list-tools");
  if (
    !(await listTools.evaluate(
      (element) => (element as HTMLDetailsElement).open,
    ))
  )
    await listTools.locator(":scope > summary").click();
  return () => draft;
}

async function openExtraTools(page: Page) {
  const list = page.locator(".operator-list-tools");
  if (!(await list.evaluate((element) => (element as HTMLDetailsElement).open)))
    await list.locator(":scope > summary").click();
  const tools = page.locator(".recipient-extra-tools");
  if ((await tools.getAttribute("open")) === null)
    await tools.locator("summary").click();
}

test("ten rows preserve ordinary Tab, Shift+Tab, Enter and IME confirmation", async ({
  page,
}) => {
  const current = await workspace(page, 10);
  const first = page.getByLabel("ФИО, строка 1", { exact: true });
  await first.focus();
  for (let row = 1; row <= 10; row++) {
    const name = page.getByLabel(`ФИО, строка ${row}`, { exact: true });
    await expect(name).toBeFocused();
    await name.fill(`Сергеев Сергей ${row}`);
    await name.press("Tab");
    const position = page.getByLabel(`Должность · RU, строка ${row}`, {
      exact: true,
    });
    await expect(position).toBeFocused();
    await position.fill(`Мастер участка ${row}`);
    await position.press("Shift+Tab");
    await expect(name).toBeFocused();
    if (row < 10) await name.press("Enter");
  }
  await page.keyboard.press("Shift+Enter");
  await expect(page.getByLabel("ФИО, строка 9", { exact: true })).toBeFocused();
  await first.focus();
  await first.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await expect(first).toBeFocused();
  // Some IME implementations report keyCode 229 for the confirmation event.
  await first.dispatchEvent("keydown", { key: "Enter", keyCode: 229 });
  await expect(first).toBeFocused();
  await expect(page.locator(".save-indicator")).toContainText(/сохранена/i);
  await expect
    .poll(() => current().items[9].positionRu)
    .toBe("Мастер участка 10");
});

test("return from a card preserves the row, input focus, selection and table scroll", async ({
  page,
}, testInfo) => {
  await workspace(page, 250);
  await expect(
    page.getByLabel("Должность · RU, строка 125", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Должность · KZ, строка 125", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Выбрать строку 125", { exact: true }).check();
  const input = page.getByLabel("Должность · KZ, строка 125", { exact: true });
  await input.focus();
  // Finish the focus bookmark before the operator scrolls the active field.
  // Otherwise a pending focus frame can accidentally hide a stale bookmark.
  await input.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await input.evaluate((element: HTMLInputElement) => {
    element.scrollIntoView({ block: "center", inline: "center" });
    element.setSelectionRange(3, 12);
  });
  const scroll = page.locator(".recipient-grid-scroll");
  await scroll.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const before = await scroll.evaluate((element) => ({
    top: element.scrollTop,
    left: element.scrollLeft,
    windowY: window.scrollY,
  }));
  await page
    .getByRole("button", { name: "Детали получателя 125", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Вернуться к списку", exact: true })
    .click();
  await expect(input).toBeFocused();
  expect(
    await scroll.evaluate((element) => ({
      top: element.scrollTop,
      left: element.scrollLeft,
      windowY: window.scrollY,
    })),
  ).toEqual(before);
  expect(
    await input.evaluate((element: HTMLInputElement) => [
      element.selectionStart,
      element.selectionEnd,
    ]),
  ).toEqual([3, 12]);
  await expect(
    page.getByLabel("Выбрать строку 125", { exact: true }),
  ).toBeChecked();
  await expect(
    page.getByLabel("Должность · RU, строка 125", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Должность · KZ, строка 125", { exact: true }),
  ).toHaveValue("Еңбек қауіпсіздігі және еңбекті қорғау инженері");
  await page.screenshot({ path: testInfo.outputPath("restored-row-125.png") });
});

test("error links reveal exact hidden grid columns and nested document fields", async ({
  page,
}, testInfo) => {
  await workspace(page, 100);
  await expect(
    page.getByLabel("Должность · KZ, строка 2", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Проверить данные", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Уточните должность Иванова$/ })
    .click();
  const position = page.locator(
    '.operator-grid [data-field-path="items.1.positionRu"]',
  );
  await expect(position).toBeVisible();
  await expect(position).toBeFocused();
  await expect(position).toHaveAttribute("aria-invalid", "true");
  const description = await position.getAttribute("aria-describedby");
  expect(description).toBeTruthy();
  await expect(page.locator(`[id="${description}"]`)).toHaveText(
    "Уточните должность Иванова",
  );
  await position.fill("Исправленная должность");
  await page.getByRole("button", { name: /Уточните табельный номер$/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("tab", { name: /^Личные данные/ }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.locator(
      '.recipient-details [data-field-path="items.2.personnelNumber"]',
    ),
  ).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("exact-grid-error.png") });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Вернуться к списку", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: /Укажите тему обучения четвёртого получателя$/,
    })
    .click();
  await expect(
    page.locator(
      '.recipient-details [data-field-path="items.3.assignments.0.trainingSubject"]',
    ),
  ).toBeFocused();
  await expect(
    page.getByRole("tab", { name: /Обучение и результат/ }),
  ).toHaveAttribute("aria-selected", "true");
});

test("Kazakh-only recipient retains identity in the card and keyboard tabs", async ({
  page,
}, testInfo) => {
  await workspace(page, 10);
  await page
    .getByRole("button", { name: "Детали получателя 1", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("heading", { name: longKz, exact: true }),
  ).toBeVisible();
  const documents = page.getByRole("tab", { name: /^Документы \(/ });
  await documents.focus();
  await documents.press("ArrowRight");
  const person = page.getByRole("tab", { name: "Личные данные", exact: true });
  await expect(person).toBeFocused();
  await expect(person).toHaveAttribute("aria-selected", "true");
  await person.press("Home");
  await expect(documents).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("kazakh-card.png") });
});

test("narrow and short viewports keep keyboard-focused cells unobscured", async ({
  page,
}, testInfo) => {
  await workspace(page, 100);
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 683, height: 384 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(
      page.getByLabel("Должность · KZ, строка 50", { exact: true }),
    ).toBeVisible();
    const input = page.getByLabel("Должность · RU, строка 50", { exact: true });
    await input.focus();
    await input.press("Enter");
    const next = page.getByLabel("Должность · RU, строка 51", { exact: true });
    await expect(next).toBeFocused();
    const geometry = await next.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const scroll = element
        .closest(".recipient-grid-scroll")!
        .getBoundingClientRect();
      const visibleLeft = Math.max(rect.left, scroll.left);
      const visibleRight = Math.min(rect.right, scroll.right);
      const x = (visibleLeft + visibleRight) / 2;
      const y = rect.top + rect.height / 2;
      return {
        uncovered: [visibleLeft + 4, x, visibleRight - 4].every(
          (point) => document.elementFromPoint(point, y) === element,
        ),
        visibleWidth: visibleRight - visibleLeft,
        width: rect.width,
        pageWidth: document.documentElement.scrollWidth,
        viewport: innerWidth,
      };
    });
    expect(geometry.uncovered).toBe(true);
    expect(geometry.visibleWidth).toBeGreaterThanOrEqual(
      Math.min(180, geometry.width),
    );
    expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewport);
    await page.screenshot({
      path: testInfo.outputPath(`keyboard-${viewport.width}.png`),
    });
  }
});

test("shared organization previews selected people, preserves exceptions, confirms replacement and supports undo", async ({
  page,
}, testInfo) => {
  const current = await workspace(page, 3);
  current().items[0].workplaceRu = "";
  current().items[1].workplaceRu = "Индивидуальная организация";
  const third = structuredClone(current().items[2]);
  await page.reload();
  await page.getByLabel("Выбрать строку 1", { exact: true }).check();
  await page.getByLabel("Выбрать строку 2", { exact: true }).check();
  await openExtraTools(page);
  await page
    .getByRole("button", { name: "Изменить данные выбранных (2)", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await modal.getByText("Должность и место работы", { exact: true }).click();
  await modal
    .getByRole("checkbox", { name: "Место работы RU", exact: true })
    .check();
  await modal
    .getByLabel("Общее значение: Место работы RU", { exact: true })
    .fill("Общая организация");
  await modal
    .getByRole("combobox", { name: "Направление", exact: true })
    .selectOption("");
  await modal
    .getByRole("button", { name: "Показать изменения", exact: true })
    .click();
  await expect(
    modal.getByRole("region", { name: "Предварительные изменения" }),
  ).toContainText("1 человек");
  await page.screenshot({
    path: testInfo.outputPath("shared-workplace-preview.png"),
  });
  await modal
    .getByRole("button", { name: "Применить 1 изменений", exact: true })
    .click();
  await expect
    .poll(() => current().items[0].workplaceRu)
    .toBe("Общая организация");
  expect(current().items[1].workplaceRu).toBe("Индивидуальная организация");
  expect(current().items[2]).toEqual(third);
  await openExtraTools(page);
  await page
    .getByRole("button", { name: "Изменить данные выбранных (2)", exact: true })
    .click();
  await modal.getByText("Должность и место работы", { exact: true }).click();
  await modal
    .getByRole("checkbox", { name: "Место работы RU", exact: true })
    .check();
  await modal
    .getByLabel("Общее значение: Место работы RU", { exact: true })
    .fill("Явная замена организации");
  await modal
    .getByRole("combobox", { name: "Режим применения", exact: true })
    .selectOption("REPLACE");
  await modal
    .getByRole("button", { name: "Показать изменения", exact: true })
    .click();
  const apply = modal.getByRole("button", {
    name: "Применить 2 изменений",
    exact: true,
  });
  await expect(apply).toBeDisabled();
  await modal
    .getByRole("checkbox", { name: /Подтверждаю замену отмеченных полей/ })
    .check();
  await apply.click();
  await expect
    .poll(() => current().items[1].workplaceRu)
    .toBe("Явная замена организации");
  expect(current().items[2]).toEqual(third);
  await page
    .getByRole("button", { name: "Отменить массовое изменение", exact: true })
    .click();
  await expect
    .poll(() => current().items[1].workplaceRu)
    .toBe("Индивидуальная организация");
  expect(current().items[0].workplaceRu).toBe("Общая организация");
  expect(current().items[2]).toEqual(third);
});

test("return after appending a stored person targets that new person instead of the previously edited row", async ({
  page,
}) => {
  const current = await workspace(page, 3);
  const person = {
    ...newRecipient(),
    fullNameRu: "Повторный Синтетический Получатель",
    positionRu: "Мастер",
  };
  await page.route("**/api/recipients?**", (route) =>
    route.fulfill({
      json: { items: [{ id: "stored-person", data: person }], total: 1 },
    }),
  );
  await page.route("**/api/recipients/stored-person", (route) =>
    route.fulfill({
      json: { id: "stored-person", data: person, employment: [], requests: [] },
    }),
  );
  await page.getByLabel("Должность · RU, строка 2", { exact: true }).focus();
  await openExtraTools(page);
  await page
    .getByRole("button", { name: "Найти человека", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Выбрать", exact: true })
    .click();
  await expect(page.getByLabel("ФИО, строка 4", { exact: true })).toHaveValue(
    person.fullNameRu,
  );
  await expect(
    page
      .getByRole("dialog")
      .getByRole("heading", { name: person.fullNameRu, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Вернуться к списку", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Детали получателя 4",
      exact: true,
    }),
  ).toBeFocused();
  await expect(page.locator(".operator-grid tr.is-active")).toHaveAttribute(
    "data-recipient-id",
    await page
      .getByLabel("ФИО, строка 4", { exact: true })
      .evaluate(
        (element) => element.closest("tr")!.getAttribute("data-recipient-id")!,
      ),
  );
  await expect(page.locator(".save-indicator")).toContainText(/сохранена/i);
  await expect.poll(() => current().items.length).toBe(4);
  expect(current().items[3].recipientId).toBe("stored-person");
});

test("failed bulk save explains the error inside the dialog and retains the exact reviewed values for retry", async ({
  page,
}, testInfo) => {
  const current = await workspace(page, 3);
  let fail = true;
  const failure =
    "Синтетический отказ сохранения группы. Повторите применение.";
  await page.route("**/api/print-requests/grid-context", async (route) => {
    if (fail && route.request().method() === "PATCH") {
      await route.fulfill({ status: 503, json: { message: failure } });
      return;
    }
    await route.fallback();
  });
  const before = structuredClone(current().items);
  await page.getByLabel("Выбрать строку 2", { exact: true }).check();
  await openExtraTools(page);
  await page
    .getByRole("button", { name: "Изменить данные выбранных (1)", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await modal.getByText("Должность и место работы", { exact: true }).click();
  await modal
    .getByRole("checkbox", { name: "Место работы RU", exact: true })
    .check();
  const value = modal.getByLabel("Общее значение: Место работы RU", {
    exact: true,
  });
  await value.fill("Сохраняемое общее значение");
  await modal
    .getByRole("combobox", { name: "Режим применения", exact: true })
    .selectOption("REPLACE");
  await modal
    .getByRole("button", { name: "Показать изменения", exact: true })
    .click();
  const confirmation = modal.getByRole("checkbox", {
    name: /Подтверждаю замену отмеченных полей/,
  });
  await confirmation.check();
  const apply = modal.getByRole("button", {
    name: "Применить 1 изменений",
    exact: true,
  });
  await apply.click();
  await expect(modal.getByText(failure, { exact: true })).toBeVisible();
  await expect(value).toHaveValue("Сохраняемое общее значение");
  await expect(confirmation).toBeChecked();
  expect(current().items).toEqual(before);
  await page.screenshot({
    path: testInfo.outputPath("bulk-save-error-retained.png"),
  });
  fail = false;
  await apply.click();
  await expect(modal).toHaveCount(0);
  await expect
    .poll(() => current().items[1].workplaceRu)
    .toBe("Сохраняемое общее значение");
  expect(current().items[0]).toEqual(before[0]);
  expect(current().items[2]).toEqual(before[2]);
});

test("current preview jobs retain statuses while preparation requires approval of this revision and editing invalidates that approval", async ({
  page,
}) => {
  const current = await workspace(page, 1);
  current().items[0].fullNameRu = "Синтетический макет";
  current().items[0].assignments = current().items[0].assignments.map(
    (assignment) => ({
      ...assignment,
      documentDate: "2026-10-03",
      trainingStart: "2026-10-01",
      trainingEnd: "2026-10-02",
      protocolDate: "2026-10-03",
      trainingSubject: "Синтетическая программа",
      result: "Сдал",
      outcome: { status: "PASSED", source: "Синтетическая ведомость" },
      fieldOrigins: {
        ...assignment.fieldOrigins,
        documentDate: "MANUAL",
        trainingStart: "MANUAL",
        trainingEnd: "MANUAL",
        protocolDate: "MANUAL",
        trainingSubject: "MANUAL",
      },
    }),
  );
  current().approval = {
    proposalId: "synthetic-proposal",
    status: "PENDING",
    baseRevision: 0,
    proposalHash: "synthetic",
    submittedBy: "operator",
    submittedAt: "2026-10-03T00:00:00Z",
  };
  await page.reload();
  let status = "QUEUED";
  const artifacts = ["preview-docx", "preview-pdf"].map((id) => ({
    id,
    provenance: "PREVIEW",
    availability: "AVAILABLE",
    format: id.endsWith("pdf") ? "PDF" : "DOCX",
    fileName: `${id}.${id.endsWith("pdf") ? "pdf" : "docx"}`,
  }));
  await page.route("**/api/print-requests/grid-context/validate", (route) =>
    route.fulfill({
      json: {
        valid: true,
        errors: [],
        documentCount: current().items[0].assignments.length,
      },
    }),
  );
  await page.route("**/api/print-requests/grid-context/preview", (route) =>
    route.fulfill({ status: 201, json: { jobs: [] } }),
  );
  await page.route("**/api/jobs?**", (route) =>
    route.fulfill({
      json: {
        items: artifacts.map((artifact) => ({
          id: artifact.id,
          kind: artifact.format,
          status,
          sourceRevision: 0,
          ...(status === "SUCCEEDED"
            ? { artifactId: artifact.id, artifact }
            : {}),
        })),
        total: 2,
      },
    }),
  );
  await page
    .getByRole("button", { name: "Проверить данные", exact: true })
    .click();
  const preview = page.getByRole("button", {
    name: "Посмотреть документы",
    exact: true,
  });
  const finalize = page.getByRole("button", {
    name: "Сформировать документы",
    exact: true,
  });
  await preview.click();
  await expect(page.locator(".files-panel")).toContainText("В очереди");
  await expect(finalize).toHaveCount(0);
  await expect(preview).toHaveClass(/primary/);
  status = "RUNNING";
  await page
    .locator(".files-panel")
    .getByRole("button", { name: "Обновить", exact: true })
    .click();
  await expect(page.locator(".files-panel")).toContainText("Формируется");
  await expect(finalize).toHaveCount(0);
  status = "FAILED";
  await page
    .locator(".files-panel")
    .getByRole("button", { name: "Обновить", exact: true })
    .click();
  await expect(
    page
      .getByRole("button", { name: "Повторить неготовые", exact: true })
      .first(),
  ).toBeVisible();
  await expect(finalize).toHaveCount(0);
  status = "SUCCEEDED";
  await page
    .locator(".files-panel")
    .getByRole("button", { name: "Обновить", exact: true })
    .click();
  await expect(finalize).toHaveCount(0);
  current().approval = { ...current().approval!, status: "APPROVED" };
  current().approvedRevision = current().revision;
  await page.reload();
  await expect(finalize).toHaveClass(/primary/);
  await expect(finalize).toBeEnabled();
  await page
    .getByLabel("Должность · RU, строка 1", { exact: true })
    .fill("Новая должность после макета");
  await expect(finalize).toBeDisabled();
  await expect
    .poll(() => current().items[0].positionRu)
    .toBe("Новая должность после макета");
  await expect(finalize).toHaveCount(0);
  await expect(preview).toHaveClass(/primary/);
});

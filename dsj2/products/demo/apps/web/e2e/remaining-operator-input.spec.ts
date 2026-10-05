import { test, expect, type Page } from "@playwright/test";
import { resolveDraft, applyBusinessRules } from "@demo/contracts";
import {
  newRecipient,
  newAssignment,
  type Draft,
  type Customer,
} from "../lib/types";

async function workspace(
  page: Page,
  kind: "PERSON" | "COMPANY" = "COMPANY",
  topics = false,
  professions = false,
) {
  let draft: Draft = {
    id: "remaining-input",
    revision: 0,
    status: "DRAFT",
    kind,
    customerId: null,
    demoMode: true,
    title: "Синтетическая проверка ввода",
    businessRuleVersion: "LIVE_V1",
    schemaVersion: 2,
    commonFields: { documentDate: "2026-10-04" },
    items: [
      {
        ...newRecipient(),
        id: "first",
        fullNameRu: "Первый Тест",
        positionRu: "Мастер",
        positionKz: "Ручной перевод",
        assignments: [
          {
            ...newAssignment("ptm-card"),
            id: "ptm",
            eventId: "ptm",
            documentDate: "2026-10-04",
            protocolDate: "2026-10-03",
            outcome: { status: "UNKNOWN", source: "" },
            fieldOrigins: { documentDate: "MANUAL", protocolDate: "IMPORTED" },
          },
          {
            ...newAssignment("pb-card"),
            id: "pb",
            eventId: "pb",
            documentDate: "2026-10-05",
            outcome: { status: "UNKNOWN", source: "" },
            fieldOrigins: { documentDate: "MANUAL" },
          },
        ],
      },
      { ...newRecipient(), id: "spare", assignments: [] },
    ],
  };
  if (topics) {
    draft.events = [
      {
        id: "ptm",
        title: "ПТМ",
        protocolTemplateId: "ptm-protocol",
        revision: 0,
        commonFields: {
          trainingSubject: "Текущая программа ПТМ",
          trainingSubjectKz: "Қазіргі ПТМ",
        },
      },
      {
        id: "pb",
        title: "ПБ",
        protocolTemplateId: "pb-protocol",
        revision: 0,
        commonFields: {
          trainingSubject: "Текущая программа ПБ",
          trainingSubjectKz: "Қазіргі ПБ",
        },
      },
    ];
    draft.items[0].assignments[0].trainingSubject =
      "Личная ручная программа ПТМ";
    draft.items[0].assignments[0].fieldOrigins = {
      ...draft.items[0].assignments[0].fieldOrigins,
      trainingSubject: "MANUAL",
    };
  }
  if (professions) {
    draft.items[0].assignments = [
      draft.items[0].assignments[1],
      ...(["ps-card", "ps-witness", "ps-protocol"] as const).map(
        (templateId) => ({
          ...newAssignment(templateId),
          id: templateId,
          eventId: "ps",
          outcome: { status: "UNKNOWN" as const, source: "" },
        }),
      ),
    ];
  }
  const customers: Customer[] = [];
  let translation: (
    source: string,
  ) => Promise<{ text?: string; failure?: boolean }> = async () => ({
    text: "Шебер",
  });
  let creations = 0;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(4);
    let result: unknown = { items: [], total: 0 };
    if (path === "/auth/session")
      result = {
        csrfToken: "synthetic",
        user: { id: "operator", role: "OPERATOR" },
        tenant: { id: "synthetic", demoOnly: true },
      };
    else if (path === "/context")
      result = {
        user: {
          id: "operator",
          displayName: "Тестовый оператор",
          email: "test@example.invalid",
          role: "OPERATOR",
        },
        tenant: {
          id: "synthetic",
          name: "Синтетический центр",
          timezone: "Asia/Qyzylorda",
          demoOnly: true,
        },
        profile: {
          nameRu: "Тестовый центр",
          nameKz: "Тест",
          approved: true,
          commission: [],
        },
        templates: [],
        numbering: {},
      };
    else if (path === "/training-topics") {
      const direction = new URL(request.url()).searchParams.get("direction");
      result = {
        items: [
          {
            id: "standard",
            origin: "COURSE",
            trainingSubject: `Типовая программа ${direction}`,
            trainingSubjectKz: `Типтік ${direction}`,
          },
          {
            id: "saved",
            origin: "SAVED",
            trainingSubject: `Сохранённая программа ${direction}`,
            trainingSubjectKz: `Сақталған ${direction}`,
          },
        ],
      };
    } else if (path === `/print-requests/${draft.id}/resolved`)
      result = resolveDraft(draft);
    else if (path === `/print-requests/${draft.id}`) {
      if (request.method() === "PATCH") {
        const body = request.postDataJSON();
        if (body.expectedRevision !== draft.revision) {
          await route.fulfill({
            status: 409,
            json: { message: "Конфликт редакций" },
          });
          return;
        }
        draft = {
          ...draft,
          ...applyBusinessRules(body.draft),
          revision: draft.revision + 1,
        };
        result = { revision: draft.revision };
      } else result = draft;
    } else if (path === `/print-requests/${draft.id}/validate`)
      result = { valid: true, errors: [] };
    else if (path === `/print-requests/${draft.id}/signing`)
      result = {
        status: null,
        archived: false,
        providers: {
          EGOV_QR: { available: false },
          NCALAYER: { available: false },
        },
        documents: [],
        missingBindings: [],
      };
    else if (path === "/customers") {
      if (request.method() === "POST") {
        creations++;
        const customer = {
          ...request.postDataJSON(),
          id: "saved-company",
          bin: "",
          addressRu: "",
          addressKz: "",
          archived: false,
        };
        customers.push(customer);
        result = customer;
      } else result = { items: customers, total: customers.length };
    } else if (path.startsWith("/customers/"))
      result = customers.find((customer) => path.endsWith(customer.id));
    else if (path === "/translations/suggest") {
      const proposal = await translation(request.postDataJSON().texts[0].text);
      if (proposal.failure) {
        await route.fulfill({
          status: 503,
          json: { message: "Синтетический отказ перевода" },
        });
        return;
      }
      result = {
        items: [{ translation: proposal.text || "" }],
        providerConfigured: true,
      };
    }
    await route.fulfill({ json: result });
  });
  await page.goto("/requests/remaining-input/edit");
  await expect(page.getByLabel("ФИО, строка 1", { exact: true })).toBeVisible();
  return {
    current: () => draft,
    creations: () => creations,
    errors,
    translate: (handler: typeof translation) => {
      translation = handler;
    },
  };
}

test("actual course selection and compact dates show the current kit and preserve independent exceptions after reload", async ({
  page,
}, testInfo) => {
  const state = await workspace(page);
  await page
    .getByRole("button", { name: /Настройки обучения получателя 1/ })
    .click();
  const dialog = page.getByRole("dialog", { name: "Назначить обучение" });
  await expect(
    dialog.getByRole("checkbox", { name: /Пожарно-технический минимум/ }),
  ).toBeChecked();
  await expect(
    dialog.getByRole("checkbox", { name: /Промышленная безопасность/ }),
  ).toBeChecked();
  await expect(
    dialog.getByRole("checkbox", { name: /Безопасность и охрана труда/ }),
  ).not.toBeChecked();
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  await page.getByLabel("Выбрать видимых получателей", { exact: true }).check();
  await expect(
    page.getByRole("button", { name: /ПТМ: добавить остальным/ }),
  ).toHaveAttribute("aria-pressed", "mixed");
  await expect(
    page.getByRole("button", { name: /ПТМ: добавить остальным/ }),
  ).toContainText("1/2");
  await expect(
    page.getByRole("button", { name: /БиОТ: добавить отмеченным/ }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: /ПТМ: добавить остальным/ }).click();
  await expect(
    page.getByRole("button", { name: /ПТМ: снять у этой группы/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Даты курсов, строка 1", { exact: true }).click();
  const coursePanels = page.locator(".recipient-grid-course-dates fieldset");
  await expect(coursePanels).toHaveCount(2);
  const firstCourse = await coursePanels.nth(0).boundingBox();
  const secondCourse = await coursePanels.nth(1).boundingBox();
  expect(firstCourse).not.toBeNull();
  expect(secondCourse).not.toBeNull();
  expect(Math.abs(firstCourse!.y - secondCourse!.y)).toBeLessThan(6);
  expect(firstCourse!.width).toBeGreaterThan(320);
  expect(firstCourse!.height).toBeLessThan(300);
  await expect(
    page.getByLabel("ПТМ: протокол, строка 1", { exact: true }),
  ).toHaveValue("2026-10-03");
  await page
    .getByLabel("ПТМ: выдача, строка 1", { exact: true })
    .fill("2026-10-06");
  await expect
    .poll(
      () =>
        state.current().items[0].assignments.find((a) => a.id === "ptm")
          ?.documentDate,
    )
    .toBe("2026-10-06");
  expect(
    state.current().items[0].assignments.find((a) => a.id === "pb")
      ?.documentDate,
  ).toBe("2026-10-05");
  expect(
    state.current().items[0].assignments.find((a) => a.id === "ptm")
      ?.protocolDate,
  ).toBe("2026-10-03");
  await page.reload();
  await page.getByLabel("Даты курсов, строка 1", { exact: true }).click();
  await expect(
    page.getByLabel("ПТМ: выдача, строка 1", { exact: true }),
  ).toHaveValue("2026-10-06");
  await page.screenshot({
    path: testInfo.outputPath("compact-course-dates.png"),
    fullPage: true,
  });
  expect(state.errors).toEqual([]);
});

test("standard and saved topic choices are scoped to the active course, require reviewed replacement and preserve personal exceptions after reload", async ({
  page,
}, testInfo) => {
  const state = await workspace(page, "COMPANY", true);
  await page
    .getByText("Параметры обучения и документов", { exact: true })
    .click();
  await page
    .getByLabel("Обучение для общих данных и результатов", { exact: true })
    .selectOption("ptm");
  const section = page.locator(".training-primary-context");
  await section
    .getByText("Выбрать типовую или сохранённую программу", { exact: true })
    .click();
  const choice = section.getByLabel("Типовая или сохранённая программа", {
    exact: true,
  });
  await expect(
    choice.getByRole("option", {
      name: "Типовая: Типовая программа PTM",
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(
    choice.getByRole("option", {
      name: "Сохранённая: Сохранённая программа PTM",
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(choice.getByRole("option", { name: /PB/ })).toHaveCount(0);
  await choice.selectOption("saved");
  expect(state.current().events![0].commonFields.trainingSubject).toBe(
    "Текущая программа ПТМ",
  );
  await section
    .getByRole("button", { name: "Проверить замену программы", exact: true })
    .click();
  expect(state.current().events![0].commonFields.trainingSubject).toBe(
    "Текущая программа ПТМ",
  );
  await section
    .getByRole("button", { name: "Применить выбранную программу", exact: true })
    .click();
  await expect
    .poll(() => state.current().events![0].commonFields.trainingSubject)
    .toBe("Сохранённая программа PTM");
  expect(state.current().events![0].commonFields.trainingSubjectKz).toBe(
    "Сақталған PTM",
  );
  expect(state.current().items[0].assignments[0].trainingSubject).toBe(
    "Личная ручная программа ПТМ",
  );
  expect(
    state.current().items[0].assignments[0].fieldOrigins?.trainingSubject,
  ).toBe("MANUAL");
  expect(state.current().items[0].assignments[0].outcome?.status).toBe(
    "UNKNOWN",
  );
  expect(state.current().items[0].assignments[0].protocolDate).toBe(
    "2026-10-03",
  );
  await page
    .getByLabel("Обучение для общих данных и результатов", { exact: true })
    .selectOption("pb");
  await expect(
    choice.getByRole("option", {
      name: "Типовая: Типовая программа PB",
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(choice.getByRole("option", { name: /PTM/ })).toHaveCount(0);
  await choice.selectOption("standard");
  await section
    .getByRole("button", { name: "Проверить замену программы", exact: true })
    .click();
  await section
    .getByRole("button", { name: "Применить выбранную программу", exact: true })
    .click();
  await expect
    .poll(() => state.current().events![1].commonFields.trainingSubject)
    .toBe("Типовая программа PB");
  expect(state.current().events![0].commonFields.trainingSubject).toBe(
    "Сохранённая программа PTM",
  );
  await page.reload();
  await page
    .getByText("Параметры обучения и документов", { exact: true })
    .click();
  await page
    .getByLabel("Обучение для общих данных и результатов", { exact: true })
    .selectOption("ptm");
  await expect(
    section.getByLabel("Программа / тема", { exact: true }),
  ).toHaveValue("Сохранённая программа PTM");
  await page.screenshot({
    path: testInfo.outputPath("scoped-standard-saved-topics.png"),
    fullPage: true,
  });
  expect(state.errors).toEqual([]);
});

test("mixed courses distinguish the common position from optional PS profession and qualification and preserve linked forms after reload", async ({
  page,
}, testInfo) => {
  const state = await workspace(page, "COMPANY", false, true);
  await expect(
    page.getByLabel("Должность / профессия / квалификация · RU, строка 1", {
      exact: true,
    }),
  ).toHaveValue("Мастер");
  await page
    .getByRole("button", { name: "Детали получателя 1", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Настройки строки 1",
    exact: true,
  });
  const card = dialog.locator('details[data-assignment-id="ps-card"]');
  await card.locator(":scope > summary").click();
  await card
    .getByRole("tab", { name: "Обучение и результат", exact: true })
    .click();
  await card
    .getByText("Профессия и квалификация ПС · исключения для этого курса", {
      exact: true,
    })
    .click();
  await card
    .getByRole("textbox", { name: /^Профессия для ПС · RU/ })
    .fill("Электрогазосварщик");
  await card
    .getByRole("textbox", { name: /^Профессия для ПС · KZ/ })
    .fill("Электргазбен дәнекерлеуші");
  await card
    .getByRole("textbox", {
      name: /^Присвоенная квалификация ПС · RU/,
    })
    .fill("Электрогазосварщик 5 разряда");
  await card
    .getByRole("textbox", {
      name: /^Присвоенная квалификация ПС · KZ/,
    })
    .fill("5 разрядты электргазбен дәнекерлеуші");
  await expect
    .poll(() =>
      state
        .current()
        .items[0].assignments.filter((assignment) =>
          assignment.templateId.startsWith("ps-"),
        )
        .map((assignment) => assignment.psQualificationRu),
    )
    .toEqual(Array(3).fill("Электрогазосварщик 5 разряда"));
  expect(state.current().items[0].positionRu).toBe("Мастер");
  expect(state.current().items[0].assignments[0].professionRu).toBeUndefined();
  await dialog
    .getByRole("button", { name: "Закрыть диалог", exact: true })
    .click();
  await page.reload();
  await page
    .getByRole("button", { name: "Детали получателя 1", exact: true })
    .click();
  await card.locator(":scope > summary").click();
  await card
    .getByRole("tab", { name: "Обучение и результат", exact: true })
    .click();
  await card
    .getByText("Профессия и квалификация ПС · исключения для этого курса", {
      exact: true,
    })
    .click();
  await expect(
    card.getByRole("textbox", { name: /^Профессия для ПС · RU/ }),
  ).toHaveValue("Электрогазосварщик");
  await expect(
    card.getByRole("textbox", {
      name: /^Присвоенная квалификация ПС · RU/,
    }),
  ).toHaveValue("Электрогазосварщик 5 разряда");
  await page.screenshot({
    path: testInfo.outputPath("mixed-profession-qualification.png"),
    fullPage: true,
  });
  const professionLabel = card
    .getByRole("textbox", { name: /^Профессия для ПС · RU/ })
    .locator("..");
  await professionLabel
    .getByRole("button", { name: "Вернуть общий ввод", exact: true })
    .click();
  await expect
    .poll(() =>
      state
        .current()
        .items[0].assignments.filter((assignment) =>
          assignment.templateId.startsWith("ps-"),
        )
        .map((assignment) => assignment.fieldOrigins?.professionRu),
    )
    .toEqual(Array(3).fill("INHERITED"));
  expect(state.current().items[0].positionRu).toBe("Мастер");
  await dialog
    .getByRole("button", { name: "Закрыть диалог", exact: true })
    .click();
  const savedAssignments = structuredClone(
    state.current().items[0].assignments,
  );
  state.current().issuedAssignments = [
    { rowId: "first", assignmentId: "pb", issuanceId: "issued-pb-stage" },
  ];
  await page.reload();
  const issuedRowRemoval = page.getByRole("button", {
    name: "Удалить получателя 1",
    exact: true,
  });
  await expect(issuedRowRemoval).toBeDisabled();
  await expect(issuedRowRemoval).toHaveAccessibleDescription(
    "Получателя с выпущенными документами нельзя удалить. Продолжайте оставшиеся обучения в этой строке.",
  );
  await expect(
    page.getByRole("button", { name: "Удалить получателя 2", exact: true }),
  ).toBeEnabled();
  expect(state.current().items[0].assignments).toEqual(savedAssignments);
  expect(state.current().items).toHaveLength(2);
  expect(state.errors).toEqual([]);
});

test("empty Excel range pastes immediately with saved Undo; blank spare deletion skips confirmation while partial deletion keeps it", async ({
  page,
}, testInfo) => {
  const state = await workspace(page);
  const input = page.getByLabel("ФИО, строка 2", { exact: true });
  await input.evaluate((element) => {
    const clipboard = new DataTransfer();
    clipboard.setData(
      "text/plain",
      "Новый Тест\tСлесарь\tСлесарь\nЕщё Тест\tМастер\tШебер",
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: clipboard,
      }),
    );
  });
  await expect(
    page.getByRole("dialog", { name: "Вставка диапазона в заявку" }),
  ).toHaveCount(0);
  await expect.poll(() => state.current().items.length).toBe(3);
  await expect(page.getByLabel("ФИО, строка 3", { exact: true })).toHaveValue(
    "Ещё Тест",
  );
  await page
    .getByRole("button", { name: "Отменить массовое изменение", exact: true })
    .click();
  await expect.poll(() => state.current().items.length).toBe(2);
  await expect(page.getByLabel("ФИО, строка 2", { exact: true })).toHaveValue(
    "",
  );
  await page
    .getByRole("button", { name: "Удалить получателя 2", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Убрать получателя из заявки?" }),
  ).toHaveCount(0);
  await expect.poll(() => state.current().items.length).toBe(1);
  await page
    .getByRole("button", { name: "Восстановить получателя", exact: true })
    .click();
  await page
    .getByLabel("Должность · RU, строка 2", { exact: true })
    .fill("Незавершённый человек");
  await expect
    .poll(() => state.current().items[1].positionRu)
    .toBe("Незавершённый человек");
  await page
    .getByRole("button", { name: "Удалить получателя 2", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Убрать получателя из заявки?" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("partial-row-confirmation.png"),
    fullPage: true,
  });
  expect(state.errors).toEqual([]);
});

test("inline KZ translation requires confirmation, handles failure/retry/cancel and rejects stale source or destination", async ({
  page,
}, testInfo) => {
  const state = await workspace(page);
  await expect(
    page.getByText(
      "KZ необязателен: пустой вариант использует введённый текст без автоматического перевода.",
      { exact: true },
    ),
  ).toBeVisible();
  state.translate(async () => ({ failure: true }));
  await page
    .getByRole("button", { name: "Перевести на KZ", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Проверка перевода" });
  await expect(
    dialog.getByText("Синтетический отказ перевода", { exact: true }),
  ).toBeVisible();
  state.translate(async () => ({ text: "Шебер" }));
  await dialog
    .getByRole("button", { name: "Повторить перевод", exact: true })
    .click();
  await expect(
    dialog.getByRole("textbox", { name: "Проверенный перевод", exact: true }),
  ).toHaveValue("Шебер");
  expect(state.current().items[0].positionKz).toBe("Ручной перевод");
  await page
    .getByLabel("Должность · KZ, строка 1", { exact: true })
    .evaluate((element) => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(element, "Новый ручной перевод");
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  await expect(
    dialog.getByRole("button", { name: "Применить проверенный текст" }),
  ).toBeDisabled();
  await expect(
    dialog.getByText(/Исходный текст или языковой вариант изменился/),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect
    .poll(() => state.current().items[0].positionKz)
    .toBe("Новый ручной перевод");
  let release: (() => void) | undefined;
  state.translate(
    () =>
      new Promise((resolve) => {
        release = () => resolve({ text: "Старое предложение" });
      }),
  );
  await page
    .getByRole("button", { name: "Перевести на KZ", exact: true })
    .first()
    .click();
  await expect(
    dialog.getByText("Получаем предложение…", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  release?.();
  await expect(dialog).toHaveCount(0);
  expect(state.current().items[0].positionKz).toBe("Новый ручной перевод");
  state.translate(async () => ({ text: "Шебер" }));
  await page
    .getByRole("button", { name: "Перевести на KZ", exact: true })
    .first()
    .click();
  await expect(
    dialog.getByRole("textbox", { name: "Проверенный перевод", exact: true }),
  ).toHaveValue("Шебер");
  await page
    .getByLabel("Должность · RU, строка 1", { exact: true })
    .evaluate((element) => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(element, "Новая должность");
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  await expect(
    dialog.getByRole("button", { name: "Применить проверенный текст" }),
  ).toBeDisabled();
  await dialog
    .getByRole("button", { name: "Повторить перевод", exact: true })
    .click();
  await expect(
    dialog.getByRole("textbox", { name: "Проверенный перевод", exact: true }),
  ).toHaveValue("Шебер");
  await dialog
    .getByRole("button", { name: "Применить проверенный текст" })
    .click();
  await expect.poll(() => state.current().items[0].positionKz).toBe("Шебер");
  await page.screenshot({
    path: testInfo.outputPath("inline-translation-applied.png"),
    fullPage: true,
  });
  expect(state.errors).toEqual([]);
});

test("staged company reloads without a directory card and naturally applies on validation exactly once", async ({
  page,
}, testInfo) => {
  const state = await workspace(page, "COMPANY");
  await page
    .getByLabel("Название компании", { exact: true })
    .fill("«Новая компания»");
  await page
    .getByRole("combobox", { name: "Форма компании", exact: true })
    .selectOption("IP");
  expect(state.creations()).toBe(0);
  await page.reload();
  await expect(
    page.getByLabel("Название компании", { exact: true }),
  ).toHaveValue("«Новая компания»");
  await expect(
    page.getByRole("combobox", { name: "Форма компании", exact: true }),
  ).toHaveValue("IP");
  expect(state.creations()).toBe(0);
  await page
    .getByRole("button", { name: "Проверить данные", exact: true })
    .first()
    .click();
  await expect.poll(() => state.current().customerId).toBe("saved-company");
  expect(state.creations()).toBe(1);
  await page
    .getByRole("button", { name: "Проверить данные", exact: true })
    .first()
    .click();
  expect(state.creations()).toBe(1);
  await page.reload();
  await expect(
    page.getByText("ИП «Новая компания»", { exact: true }).first(),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("company-natural-continuation.png"),
    fullPage: true,
  });
  expect(state.errors).toEqual([]);
});

test("stable row identity in director issue links restores the exact field after reordering and narrow screens keep the main flow accessible", async ({
  page,
}, testInfo) => {
  const state = await workspace(page);
  await page.goto(
    "/requests/remaining-input/edit?check=1&issuePath=items.0.positionRu&issueField=positionRu&issueRow=spare",
  );
  await expect(
    page.getByLabel("Должность · RU, строка 2", { exact: true }),
  ).toBeFocused();
  for (const width of [1440, 1280, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page
        .getByRole("button", { name: "Проверить данные", exact: true })
        .first(),
    ).toBeVisible();
    await expect(
      page
        .getByRole("button", { name: "Перевести на KZ", exact: true })
        .first(),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`input-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  expect(state.errors).toEqual([]);
});

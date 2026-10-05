import { expect, test, type Page } from "@playwright/test";
import {
  applyBusinessRules,
  KZ_TRAINING_CALENDAR_VERSION,
  resolveDraft,
  trainingDirection,
} from "@demo/contracts";
import { newAssignment, newRecipient, type Draft } from "../lib/types";
import { pdfObjects, pdfStream } from "../../../tests/fixtures/pdf";

async function workspace(
  page: Page,
  options: {
    legacy?: boolean;
    company?: boolean;
    group?: boolean;
    companyName?: string;
    unboundCompany?: boolean;
    scheduled?: boolean;
    pendingApproval?: boolean;
  } = {},
) {
  const names = options.legacy
    ? ["Первый Синтетический Человек", "Второй Синтетический Человек"]
    : [""];
  let draft: Draft = {
    id: "person-flow",
    revision: 0,
    status: "DRAFT",
    kind: options.company ? "COMPANY" : "PERSON",
    title: options.companyName
      ? "Новая заявка организации"
      : "Синтетическая проверка деталей",
    customerId: options.company && !options.unboundCompany ? "company" : null,
    demoMode: true,
    schemaVersion: 2,
    businessRuleVersion: "LIVE_V1",
    commonFields: {
      documentDate: "2026-10-05",
      ...(options.scheduled
        ? {
            trainingDateRule: {
              hoursPerDay: 8,
              hoursSource: "THEORY" as const,
              calendar: "KZ_FIVE_DAY" as const,
              calendarVersion: KZ_TRAINING_CALENDAR_VERSION,
              anchor: "DOCUMENT_AFTER_TRAINING" as const,
              protocolDate: "DOCUMENT_DATE" as const,
              source: "СИНТЕТИЧЕСКИЙ график проверки доступных названий",
            },
          }
        : {}),
    },
    items: names.map((name, index) => ({
      ...newRecipient(),
      id: `person-${index}`,
      fullNameRu: name,
      fullNameKz: options.legacy ? `Сохранённый вариант ${index}` : "",
      positionRu: name ? "Электромонтёр" : "",
      positionKz: options.legacy ? "Электрмонтер" : "",
      assignments: options.legacy
        ? [
            {
              ...newAssignment("ps-card"),
              id: `card-${index}`,
              eventId: "ps",
              documentDate: "2026-10-05",
              protocolDate: "2026-10-04",
              trainingStart: "2026-09-01",
              trainingEnd: "2026-09-30",
              fieldOrigins: {
                trainingStart: "MANUAL",
                trainingEnd: "IMPORTED",
              },
            },
          ]
        : [],
    })),
    events: options.legacy
      ? [
          {
            id: "ps",
            title: "ПС",
            protocolTemplateId: "ps-protocol",
            revision: 0,
            commonFields: {
              documentDate: "2026-10-05",
              protocolDate: "2026-10-04",
            },
          },
        ]
      : [],
  };
  if (options.legacy) draft = applyBusinessRules(draft);
  if (options.group) {
    draft.items = draft.items.map((item) => ({
      ...item,
      assignments: item.assignments
        .filter((assignment) => !assignment.templateId.endsWith("-protocol"))
        .map((assignment) => ({
          ...assignment,
          protocolMode: "GROUP",
          trainingSubject: "",
          fieldOrigins: {
            ...assignment.fieldOrigins,
            trainingSubject: "INHERITED",
          },
        })),
    }));
    draft = applyBusinessRules(draft);
  }
  if (options.pendingApproval) {
    draft.revision = 7;
    draft.approval = {
      proposalId: "synthetic-proposal",
      proposalHash: "synthetic-hash-7",
      status: "PENDING",
      baseRevision: 7,
      submittedBy: "operator",
      submittedAt: "2026-10-05T10:00:00.000Z",
    };
  }
  const reads = { approval: 0, detail: 0, patches: 0 };
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.slice(4);
    let value: unknown = { items: [], total: 0 };
    if (path === "/auth/session") value = { csrfToken: "synthetic" };
    else if (path === "/context")
      value = {
        user: {
          id: "operator",
          displayName: "Оператор",
          email: "operator@example.invalid",
          role: "OPERATOR",
        },
        tenant: {
          id: "synthetic-person-flow",
          name: "Синтетический центр",
          timezone: "Asia/Qyzylorda",
          demoOnly: true,
        },
        profile: {
          nameRu: "Тестовый центр",
          nameKz: "Тест",
          addressRu: "",
          addressKz: "",
          cityRu: "Тест",
          cityKz: "Тест",
          approvalBasis: "",
          commission: [],
          approved: true,
        },
        templates: [],
        numbering: {},
      };
    else if (path === "/customers")
      value = {
        items: options.company
          ? [
              {
                id: "company",
                nameRu: options.companyName || "ТОО Синтетический работодатель",
                nameKz: "Синтетикалық жұмыс беруші",
                bin: "123456789012",
                addressRu: "Тестовый адрес",
                addressKz: "Тест",
                archived: false,
              },
            ]
          : [],
        total: options.company ? 1 : 0,
      };
    else if (path === "/print-requests/person-flow/approval") {
      reads.approval++;
      value = {
        revision: draft.revision,
        requestStatus: draft.status,
        approval: draft.approval,
      };
    } else if (path === "/print-requests/person-flow/resolved")
      value = resolveDraft(draft);
    else if (path === "/print-requests/person-flow/signing")
      value = {
        status: null,
        archived: false,
        providers: {
          EGOV_QR: { available: false },
          NCALAYER: { available: false },
        },
        documents: [],
        missingBindings: [],
      };
    else if (path === "/print-requests/person-flow") {
      if (route.request().method() === "PATCH") {
        reads.patches++;
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
      } else {
        reads.detail++;
        value = draft;
      }
    }
    await route.fulfill({ json: value });
  });
  await page.goto("/requests/person-flow/edit");
  await expect(
    page.locator(options.company ? ".operator-grid" : ".person-editor"),
  ).toBeVisible();
  return {
    read: () => draft,
    failures,
    reads,
    approveNextRevision: () => {
      if (!draft.approval) throw new Error("PENDING_APPROVAL_FIXTURE_REQUIRED");
      draft = {
        ...draft,
        revision: draft.revision + 1,
        approval: { ...draft.approval, status: "APPROVED" },
      };
    },
  };
}

test("PERSON: keyboard follows three steps, preserves back/reload, and resumes at the compact card", async ({
  page,
}, info) => {
  const model = await workspace(page);
  const person = page.locator(".person-editor");
  await page.screenshot({
    path: info.outputPath("person-step-1.png"),
    fullPage: true,
  });
  for (const label of [
    "Импорт",
    "Вставить список",
    "Добавить сотрудника",
    "Добавить строку",
  ])
    await expect(
      page.getByRole("button", { name: label, exact: true }),
    ).toHaveCount(0);
  await expect(page.locator(".operator-grid")).toHaveCount(0);
  await person.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(person.getByLabel("ФИО", { exact: true })).toBeFocused();
  await expect(person.getByText("Укажите ФИО", { exact: true })).toBeVisible();
  await expect(person.getByText("Выберите хотя бы один курс")).toHaveCount(0);
  await person
    .getByLabel("ФИО", { exact: true })
    .fill("Синтетический Иван Иванов");
  await page.keyboard.press("Tab");
  await expect(person.getByLabel("Должность", { exact: true })).toBeFocused();
  await page.keyboard.type("Электромонтер");
  await page.keyboard.press("Enter");
  await expect(person.locator('[data-person-stage="category"]')).toBeVisible();
  await page.screenshot({
    path: info.outputPath("person-step-2.png"),
    fullPage: true,
  });
  await person.getByRole("button", { name: "ИТР", exact: true }).click();
  await expect(
    person.getByRole("button", { name: "ИТР", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await person.getByRole("button", { name: "Назад", exact: true }).click();
  await expect(person.getByLabel("ФИО", { exact: true })).toHaveValue(
    "Синтетический Иван Иванов",
  );
  await person.getByRole("button", { name: "Далее", exact: true }).click();
  await person.getByRole("button", { name: "Далее", exact: true }).click();
  await person.getByRole("button", { name: "Готово", exact: true }).click();
  await expect(person.getByText("Выберите хотя бы один курс")).toBeVisible();
  await person.getByRole("button", { name: "ПС", exact: true }).click();
  await expect(person.getByText("Выберите хотя бы один курс")).toHaveCount(0);
  await expect(person.getByLabel("Обучение с", { exact: true })).toBeVisible();
  await expect(person.getByLabel("по", { exact: true })).toHaveCount(1);
  await person.getByLabel("Обучение с", { exact: true }).fill("2026-09-01");
  await person.getByLabel("по", { exact: true }).fill("2026-09-30");
  await page.screenshot({
    path: info.outputPath("person-step-3-ps.png"),
    fullPage: true,
  });
  await person.getByRole("button", { name: "Готово", exact: true }).click();
  await expect(person.locator('[data-person-stage="summary"]')).toBeVisible();
  await expect
    .poll(
      () =>
        model
          .read()
          .items[0].assignments.filter(
            (assignment) => trainingDirection(assignment.templateId) === "PS",
          ).length,
    )
    .toBe(3);
  const before = structuredClone(model.read().items);
  await page.reload();
  await expect(person.locator('[data-person-stage="summary"]')).toBeVisible();
  await expect(
    person.getByRole("button", { name: /^Предпросмотр:/ }),
  ).toHaveCount(3);
  expect(model.read().items).toEqual(before);
  const release = page.getByRole("region", {
    name: "Готовность и состав следующего выпуска",
    exact: true,
  });
  await expect(
    release.getByText(
      /Все сданные ещё не оформленные курсы выбраны автоматически/,
    ),
  ).toHaveCount(0);
  await expect(
    page.getByText("Рабочий черновик сохраняется", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      /После предпросмотра или оформления здесь появятся задания и файлы/,
    ),
  ).toHaveCount(0);
  await expect(release.getByText(/подтверждена сдача 1/)).toBeVisible();
  const allReady = release.getByLabel(
    "Все подтверждённые ещё не оформленные курсы (1)",
    { exact: true },
  );
  const submit = release.getByRole("button", {
    name: /^Проверить и передать директору/,
  });
  await expect(allReady).toBeChecked();
  await expect(submit).toBeEnabled();
  await allReady.uncheck();
  await expect(submit).toBeDisabled();
  await allReady.check();
  await expect(submit).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Посмотреть документы", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Проверить данные", exact: true }),
  ).toBeVisible();
  for (const width of [1440, 1280, 768, 390]) {
    await page.setViewportSize({ width, height: width === 1280 ? 720 : 900 });
    await expect(
      person.getByRole("button", { name: "Изменить курсы", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: info.outputPath(`person-summary-${width}.png`),
      fullPage: true,
    });
  }
  expect(model.failures).toEqual([]);
});

test("legacy multi PERSON: direct edits keep every identity, independent KZ and linked PS dates", async ({
  page,
}) => {
  const model = await workspace(page, { legacy: true });
  const before = structuredClone(model.read());
  const person = page.locator(".person-editor");
  await expect(page.locator(".operator-grid")).toHaveCount(0);
  await expect(
    person.getByLabel("Человек в заявке", { exact: true }),
  ).toHaveValue("person-0");
  await person
    .getByLabel("Человек в заявке", { exact: true })
    .selectOption("person-1");
  await expect(
    person.getByRole("heading", {
      name: "Второй Синтетический Человек",
      exact: true,
    }),
  ).toBeVisible();
  await person
    .getByRole("button", { name: "Изменить ФИО и должность", exact: true })
    .click();
  await person
    .getByLabel("ФИО", { exact: true })
    .fill("Второй Человек после правки");
  await person.getByRole("button", { name: "Готово", exact: true }).click();
  await person
    .getByRole("button", { name: "Изменить курсы", exact: true })
    .click();
  await expect(person.getByLabel("Обучение с", { exact: true })).toHaveValue(
    "2026-09-01",
  );
  await person.getByLabel("Часы программы", { exact: true }).fill("72");
  await person.getByLabel("по", { exact: true }).fill("2026-08-01");
  await expect(
    person.getByText("Окончание обучения не может быть раньше начала", {
      exact: true,
    }),
  ).toBeVisible();
  await person.getByRole("button", { name: "Готово", exact: true }).click();
  await expect(person.getByLabel("по", { exact: true })).toBeFocused();
  await person.getByLabel("по", { exact: true }).fill("2026-09-30");
  await expect(
    person.getByText("Окончание обучения не может быть раньше начала", {
      exact: true,
    }),
  ).toHaveCount(0);
  await person.getByRole("button", { name: "Готово", exact: true }).click();
  await expect(person.locator('[data-person-stage="summary"]')).toBeVisible();
  await expect
    .poll(() => model.read().items[1].fullNameRu)
    .toBe("Второй Человек после правки");
  expect(model.read().items[0]).toEqual(before.items[0]);
  expect(model.read().items[1].fullNameKz).toBe(before.items[1].fullNameKz);
  expect(model.read().items[1].positionKz).toBe(before.items[1].positionKz);
  expect(
    model.read().items[1].assignments.map((assignment) => assignment.id),
  ).toEqual(before.items[1].assignments.map((assignment) => assignment.id));
  for (const assignment of model.read().items[1].assignments) {
    expect(assignment.trainingStart).toBe("2026-09-01");
    expect(assignment.trainingEnd).toBe("2026-09-30");
    expect(assignment.protocolDate).toBe("2026-10-04");
    if (!assignment.templateId.endsWith("-protocol"))
      expect(assignment.documentDate).toBe("2026-10-05");
  }
  expect(model.failures).toEqual([]);
});

test("PERSON addressed field navigation selects a legacy person and exposes the true personal or document field", async ({
  page,
}) => {
  await workspace(page, { legacy: true });
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("demo:focus-issue", {
        detail: {
          path: "items.1.fullNameKz",
          rowId: "person-1",
          message: "Уточните казахское написание",
        },
      }),
    ),
  );
  await expect(
    page.locator('.person-editor [data-field-path="items.1.fullNameKz"]'),
  ).toBeFocused();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("demo:focus-issue", {
        detail: {
          path: "items.1.assignments.0.trainingSubject",
          rowId: "person-1",
          assignmentId: "card-1",
          message: "Уточните программу",
        },
      }),
    ),
  );
  const modal = page.getByRole("dialog", {
    name: "Параметры документа",
    exact: true,
  });
  await expect(
    modal.locator('[data-field-path="items.1.assignments.0.trainingSubject"]'),
  ).toBeFocused();
  await modal.getByRole("button", { name: "Готово", exact: true }).click();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("demo:focus-issue", {
        detail: {
          path: "events.0.commonFields.trainingStart",
          message: "Уточните начало обучения",
        },
      }),
    ),
  );
  await expect(
    page.locator(
      '.person-editor [data-field-path="items.0.assignments.0.trainingStart"]',
    ),
  ).toBeFocused();
  await expect(
    page.locator('.person-editor [data-person-stage="courses"]'),
  ).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("demo:focus-issue", {
        detail: {
          path: "commonFields.documentDate",
          message: "Уточните дату документа",
        },
      }),
    ),
  );
  await expect(
    page.locator(
      '.person-editor [data-field-path="items.0.assignments.0.documentDate"]',
    ),
  ).toBeFocused();
  await expect(page.locator(".operator-grid")).toHaveCount(0);
});

test("COMPANY PS period belongs to one course and preserves each personal exception", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 788, height: 900 });
  const companyName = `ТОО Синтетическая производственная организация с длинным наименованием ${"А".repeat(60)}`;
  const model = await workspace(page, {
    legacy: true,
    company: true,
    companyName,
  });
  await expect(page.locator(".operator-heading h1")).toHaveText(companyName);
  const headingGeometry = await page
    .locator(".operator-heading")
    .evaluate((heading) => {
      const button = heading.querySelector<HTMLButtonElement>(
        ".operator-heading-actions > button",
      )!;
      const bounds = button.getBoundingClientRect();
      return {
        viewport: document.documentElement.clientWidth,
        pageWidth: document.documentElement.scrollWidth,
        actionLeft: bounds.left,
        actionRight: bounds.right,
      };
    });
  expect(headingGeometry.pageWidth).toBeLessThanOrEqual(
    headingGeometry.viewport,
  );
  expect(headingGeometry.actionLeft).toBeGreaterThanOrEqual(0);
  expect(headingGeometry.actionRight).toBeLessThanOrEqual(
    headingGeometry.viewport,
  );
  await page.screenshot({
    path: info.outputPath("company-long-title-788.png"),
    fullPage: true,
  });
  const course = page.locator(".course-shared-fields");
  await expect(course.getByLabel("Обучение с", { exact: true })).toHaveCount(1);
  await expect(course.getByLabel("Обучение с", { exact: true })).toBeVisible();
  await course.getByLabel("Обучение с", { exact: true }).fill("2026-07-01");
  await course.getByLabel("по", { exact: true }).fill("2026-07-31");
  await expect
    .poll(() => model.read().events?.[0].commonFields.trainingEnd)
    .toBe("2026-07-31");
  const resolved = resolveDraft(model.read()).draft;
  for (const person of resolved.items)
    for (const assignment of person.assignments) {
      expect(assignment.trainingStart).toBe("2026-09-01");
      expect(assignment.trainingEnd).toBe("2026-09-30");
    }
  await expect(
    page.getByLabel("Общая должность / профессия · RU", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Использовать эту компанию",
      exact: true,
    }),
  ).toHaveCount(0);
});

test("legacy PERSON GROUP repairs inherited event fields while manual personal dates remain personal", async ({
  page,
}) => {
  const model = await workspace(page, { legacy: true, group: true });
  const before = structuredClone(model.read().items);
  await expect(page.locator(".operator-grid")).toHaveCount(0);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("demo:focus-issue", {
        detail: {
          path: "items.1.assignments.0.trainingSubject",
          rowId: "person-1",
          assignmentId: "card-1",
          message: "Уточните общую программу",
        },
      }),
    ),
  );
  const program = page.locator(
    '.training-primary-context [data-field-path="events.0.commonFields.trainingSubject"]',
  );
  await expect(program).toBeFocused();
  await expect(
    page.getByLabel("Человек в заявке", { exact: true }),
  ).toHaveValue("person-1");
  await program.fill("Сохранённая общая программа ПС");
  await expect
    .poll(() => model.read().events?.[0].commonFields.trainingSubject)
    .toBe("Сохранённая общая программа ПС");
  expect(model.read().items).toEqual(before);
  expect(model.read().events?.[0].id).toBe("ps");
  await expect(
    page.getByText("Создать отдельную группу обучения", { exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("demo:focus-issue", {
        detail: {
          path: "items.1.assignments.0.trainingStart",
          rowId: "person-1",
          assignmentId: "card-1",
          message: "Уточните личную дату",
        },
      }),
    ),
  );
  await expect(
    page.locator(
      '.person-editor [data-field-path="items.1.assignments.0.trainingStart"]',
    ),
  ).toBeFocused();
  expect(model.read().items).toEqual(before);
  expect(model.failures).toEqual([]);
});

test("two company tabs retain newer input across a late create response, stale retry and reload", async ({
  page,
  context,
}) => {
  const firstModel = await workspace(page, { company: true });
  await page
    .getByRole("button", { name: "Сменить компанию", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Новая компания", exact: true })
    .click();
  await page
    .getByLabel("Название компании", { exact: true })
    .fill("Первая подготовленная компания");
  const second = await context.newPage();
  await workspace(second, { company: true });
  await expect(
    second.getByLabel("Название компании", { exact: true }),
  ).toHaveValue("Первая подготовленная компания");
  let companyPosts = 0;
  let releaseResponse = () => {};
  const delayedResponse = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  await page.route("**/api/customers", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    companyPosts++;
    await delayedResponse;
    await route.fulfill({
      status: 201,
      json: {
        id: "created-from-first-tab",
        ...route.request().postDataJSON(),
        bin: "",
        addressRu: "",
        addressKz: "",
        archived: false,
      },
    });
  });
  await page
    .getByRole("button", { name: "Дополнительные действия", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Сохранить изменения", exact: true })
    .click();
  await expect.poll(() => companyPosts).toBe(1);
  try {
    await second
      .getByLabel("Название компании", { exact: true })
      .fill("Новый ввод второй вкладки");
  } finally {
    releaseResponse();
  }
  await expect(
    page.getByRole("button", {
      name: "Загрузить сохранённый ввод компании",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(
    page.getByLabel("Название компании", { exact: true }),
  ).toHaveValue("Первая подготовленная компания");
  expect(firstModel.read().customerId).toBe("company");
  await page
    .getByRole("button", { name: "Дополнительные действия", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Сохранить изменения", exact: true })
    .click();
  await expect(
    page.getByText(/Ввод компании изменён в другой вкладке/).first(),
  ).toBeVisible();
  expect(companyPosts).toBe(1);
  await second.reload();
  await expect(
    second.getByLabel("Название компании", { exact: true }),
  ).toHaveValue("Новый ввод второй вкладки");
  await page
    .getByRole("button", {
      name: "Загрузить сохранённый ввод компании",
      exact: true,
    })
    .click();
  await expect(
    page.getByLabel("Название компании", { exact: true }),
  ).toHaveValue("Новый ввод второй вкладки");
  await expect(
    page.getByRole("button", {
      name: "Загрузить сохранённый ввод компании",
      exact: true,
    }),
  ).toHaveCount(0);
  await second.close();
});

test("PERSON course and employer names remain stable while validation descriptions are visible", async ({
  page,
}) => {
  const model = await workspace(page, { scheduled: true });
  const person = page.locator(".person-editor");
  await person
    .getByLabel("ФИО", { exact: true })
    .fill("Синтетический Получатель Названий");
  await person.getByLabel("Должность", { exact: true }).fill("Электромонтёр");
  await person.getByRole("button", { name: "Далее", exact: true }).click();
  await person.getByRole("button", { name: "Рабочий", exact: true }).click();
  await person.getByRole("button", { name: "Далее", exact: true }).click();
  await person.getByRole("button", { name: "БиОТ", exact: true }).click();
  await person.getByRole("button", { name: "ПС", exact: true }).click();
  const hours = person
    .getByRole("region", { name: "Параметры ПС", exact: true })
    .getByLabel("Часы программы", { exact: true });
  const employer = person.getByLabel("Место работы", { exact: true });
  for (const [control, message] of [
    [hours, /положительное число часов/],
    [employer, /наименование предприятия/],
  ] as const) {
    await expect(control).toBeVisible();
    await expect(control).toHaveAccessibleDescription(message);
    await expect(control).toHaveAttribute("aria-describedby", /.+/);
  }
  await hours.fill("16");
  await employer.fill("СИНТЕТИЧЕСКОЕ предприятие доступных названий");
  await expect(hours).toHaveValue("16");
  await expect(employer).toHaveValue(
    "СИНТЕТИЧЕСКОЕ предприятие доступных названий",
  );
  await expect
    .poll(() => model.read().items[0].workplaceRu)
    .toBe("СИНТЕТИЧЕСКОЕ предприятие доступных названий");
  expect(model.failures).toEqual([]);
});

test("the first linked order attaches the company created by that action's flush", async ({
  page,
}) => {
  const model = await workspace(page, { company: true, unboundCompany: true });
  let companyPosts = 0;
  const orders: Array<{
    title: string;
    customerId: string | null;
    requestIds: string[];
  }> = [];
  await page.route("**/api/customers", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    companyPosts++;
    await route.fulfill({
      status: 201,
      json: {
        id: "created-for-first-order",
        ...route.request().postDataJSON(),
        nameRu: "Синтетическая компания первого заказа",
        nameKz: "Синтетикалық компания",
        bin: "",
        addressRu: "",
        addressKz: "",
        archived: false,
      },
    });
  });
  await page.route("**/api/orders", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    orders.push(route.request().postDataJSON());
    await route.fulfill({ status: 201, json: { id: "linked-order" } });
  });
  await page
    .getByLabel("Название компании", { exact: true })
    .fill("Синтетическая компания первого заказа");
  expect(model.read().customerId).toBeNull();
  expect(companyPosts).toBe(0);
  await page
    .getByRole("button", { name: "Дополнительные действия", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Связанные действия", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Создать связанный заказ", exact: true })
    .click();
  await expect.poll(() => orders.length).toBe(1);
  expect(companyPosts).toBe(1);
  expect(model.read().customerId).toBe("created-for-first-order");
  expect(orders[0]).toEqual({
    title: model.read().title,
    customerId: "created-for-first-order",
    requestIds: [model.read().id],
  });
  expect(model.failures).toEqual([]);
});

test("COMPANY and legacy multi PERSON keep existing release guidance and eligibility controls", async ({
  page,
}) => {
  for (const company of [true, false]) {
    const model = await workspace(page, { legacy: true, company });
    const before = structuredClone(model.read().items);
    const release = page.getByRole("region", {
      name: "Готовность и состав следующего выпуска",
      exact: true,
    });
    await expect(
      release.getByText(
        /Все сданные ещё не оформленные курсы выбраны автоматически/,
      ),
    ).toBeVisible();
    await expect(
      page.getByText("Рабочий черновик сохраняется", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        /После предпросмотра или оформления здесь появятся задания и файлы/,
      ),
    ).toBeVisible();
    await expect(
      release.getByLabel(/Все подтверждённые ещё не оформленные курсы/),
    ).toBeVisible();
    await expect(
      release.getByRole("button", { name: /Проверить и передать директору/ }),
    ).toBeVisible();
    expect(model.read().items).toEqual(before);
    expect(model.failures).toEqual([]);
  }
});

test("authoritative approval refresh closes the full Editor's old preview before reopening at the new revision", async ({
  page,
}) => {
  const model = await workspace(page, { legacy: true, pendingApproval: true });
  const before = structuredClone(model.read().items);
  const previewRequests: Array<{ expectedRevision: number; target: unknown }> =
    [];
  const artifactReads: string[] = [];
  const previewJobs: Array<{
    id: string;
    kind: "PDF";
    status: "SUCCEEDED";
    artifactId: string;
    sourceRevision: number;
  }> = [];
  await page.route("**/api/jobs?**", async (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get("requestId") !== "person-flow") return route.fallback();
    await route.fulfill({
      json: { items: previewJobs, total: previewJobs.length },
    });
  });
  const content = pdfObjects([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R >>",
    pdfStream(Buffer.from("0 0.7 0.2 rg 0 0 100 100 re f\n")),
  ]);
  await page.route("**/api/artifacts/**", async (route) => {
    artifactReads.push(new URL(route.request().url()).pathname);
    await route.fulfill({ contentType: "application/pdf", body: content });
  });
  await page.route(
    "**/api/print-requests/person-flow/preview",
    async (route) => {
      const body = route.request().postDataJSON();
      previewRequests.push(body);
      expect(body.expectedRevision).toBe(model.read().revision);
      const job = {
        id: "job-" + body.expectedRevision,
        kind: "PDF" as const,
        status: "SUCCEEDED" as const,
        artifactId: "preview-" + body.expectedRevision,
        sourceRevision: body.expectedRevision,
      };
      previewJobs.push(job);
      await route.fulfill({ json: { jobs: [job] } });
    },
  );
  const launch = page.getByRole("button", {
    name: "Предпросмотр любого документа",
    exact: true,
  });
  const modal = page.getByRole("dialog", {
    name: "Предпросмотр документа",
    exact: true,
  });
  const generate = modal.getByRole("button", {
    name: "Создать предпросмотр",
    exact: true,
  });
  await launch.click();
  await generate.click();
  await expect(
    modal.getByRole("img", { name: "Страница 1 из 1", exact: true }),
  ).toBeVisible();
  await expect(
    modal.getByRole("link", { name: "Открыть PDF", exact: true }),
  ).toHaveAttribute("href", "/api/artifacts/preview-7?inline=1");
  const detailReads = model.reads.detail;
  model.approveNextRevision();
  // Exercise the real ApprovalBanner -> onRefresh -> reload -> initialize path.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => model.reads.detail).toBeGreaterThan(detailReads);
  await expect(
    page.getByText("Редакция согласована директором", { exact: true }),
  ).toBeVisible();
  await expect(modal).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Открыть PDF", exact: true }),
  ).toHaveCount(0);
  await launch.click();
  await expect(modal).toBeVisible();
  await expect(modal.getByRole("img")).toHaveCount(0);
  await expect(
    modal.getByRole("link", { name: "Открыть PDF", exact: true }),
  ).toHaveCount(0);
  expect(previewRequests).toHaveLength(1);
  await generate.click();
  await expect(
    modal.getByRole("img", { name: "Страница 1 из 1", exact: true }),
  ).toBeVisible();
  await expect(
    modal.getByRole("link", { name: "Открыть PDF", exact: true }),
  ).toHaveAttribute("href", "/api/artifacts/preview-8?inline=1");
  expect(previewRequests.map((value) => value.expectedRevision)).toEqual([
    7, 8,
  ]);
  expect(previewRequests[1].target).toEqual(previewRequests[0].target);
  expect(artifactReads).toEqual([
    "/api/artifacts/preview-7",
    "/api/artifacts/preview-8",
  ]);
  expect(model.reads.approval).toBeGreaterThan(0);
  expect(model.reads.patches).toBe(0);
  expect(model.read().items).toEqual(before);
  expect(model.failures).toEqual([]);
});

import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { loginIsolated } from "./operator-full-fix-session";
import {
  commonSettings,
  expandCommon,
} from "./operator-common-history-helpers";
import type { Draft } from "../lib/types";
const product = path.resolve(__dirname, "../../..");
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    path.join(product, "docs/evidence/final-completion/operator/v03"),
  "v03",
);
async function save(page: Page) {
  await expect(page.locator(".save-indicator")).toContainText(
    "Рабочая версия сохранена",
  );
}
async function extraSettings(page: Page) {
  await page
    .getByRole("button", { name: "Дополнительные действия", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Прочее", exact: true })
    .getByRole("button", { name: "Общие даты и протоколы", exact: true })
    .click();
  return page.getByRole("dialog", {
    name: "Общие даты и протоколы",
    exact: true,
  });
}
test.use({ trace: "off" });
test("V03 exact three source people and two services preserve the individual position and resume unknown outcomes; one person takes two complete kits", async ({
  page,
}) => {
  test.setTimeout(300000);
  const started = Date.now();
  let mutations = 0;
  page.on("request", (request) => {
    if (
      request.url().includes("/api/") &&
      !["GET", "HEAD", "OPTIONS"].includes(request.method())
    )
      mutations++;
  });
  await fs.mkdir(evidence, { recursive: true });
  await loginIsolated(page);
  await page.getByRole("link", { name: "Новая заявка", exact: true }).click();
  await page.getByRole("radio", { name: /^Физическое лицо/ }).check();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page
    .getByLabel("ФИО", { exact: true })
    .fill("Один Синтетический Человек");
  await page.getByLabel("Должность", { exact: true }).fill("Рабочий");
  await expandCommon(
    page.locator(".person-editor details.person-additional").first(),
  );
  await page
    .locator(".person-editor")
    .locator('[data-field-path="items.0.fullNameKz"]')
    .fill("Бір Синтетикалық Адам");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.getByRole("button", { name: "Рабочий", exact: true }).click();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.getByRole("button", { name: "БиОТ", exact: true }).click();
  await page
    .getByRole("region", { name: "Параметры БиОТ", exact: true })
    .getByRole("button", { name: "Параметры", exact: true })
    .first()
    .click();
  const modal = page.getByRole("dialog", {
    name: "Параметры документа",
    exact: true,
  });
  await modal
    .getByRole("tab", { name: "Обучение и результат", exact: true })
    .click();
  await modal
    .getByLabel("Подтверждённый результат / оценка", { exact: true })
    .fill("Подтверждён только первый результат");
  await modal.getByRole("button", { name: "Готово", exact: true }).click();
  await page.getByRole("button", { name: "ПБ", exact: true }).click();
  await page.getByRole("button", { name: "Готово", exact: true }).click();
  const singleCommon = await extraSettings(page);
  await singleCommon
    .getByLabel("Программа / тема для заявки", { exact: true })
    .fill("Общий источник для двух обучений");
  await singleCommon
    .getByRole("button", { name: "Закрыть диалог", exact: true })
    .click();
  await save(page);
  const singleId = /requests\/([^/]+)/.exec(page.url())![1];
  await page.reload();
  const single = await (
    await page.request.get(`/api/print-requests/${singleId}/resolved`)
  ).json();
  expect(single.draft.items).toHaveLength(1);
  expect(single.draft.kind).toBe("PERSON");
  expect(single.draft.items[0].fullNameKz).toBe("Бір Синтетикалық Адам");
  expect(single.draft.items[0].assignments).toHaveLength(4);
  expect(
    single.draft.items[0].assignments.every(
      (assignment: { trainingSubject: string }) =>
        assignment.trainingSubject === "Общий источник для двух обучений",
    ),
  ).toBe(true);
  expect(
    single.draft.items[0].assignments
      .filter((assignment: { templateId: string }) =>
        assignment.templateId.startsWith("biot-"),
      )
      .map((assignment: { result: string }) => assignment.result),
  ).toEqual([
    "Подтверждён только первый результат",
    "Подтверждён только первый результат",
  ]);
  for (const assignment of single.draft.items[0].assignments.filter(
    (entry: { templateId: string }) => entry.templateId.startsWith("pb-"),
  )) {
    expect(assignment.result).not.toBe("Подтверждён только первый результат");
    expect(assignment.result).not.toBe("");
    expect(assignment.outcome.status).toBe("PASSED");
    expect(assignment.fieldOrigins.result).toBe("COURSE");
  }

  const source = JSON.parse(
    await fs.readFile(
      path.join(product, "tests/fixtures/operator-value/DAILY_WORKFLOWS.json"),
      "utf8",
    ),
  );
  const scenario = source.cases.V03;
  const people: Record<string, string>[] = scenario.personKeys.map(
    (key: string) =>
      source.people.find(
        (person: { externalPersonKey: string }) =>
          person.externalPersonKey === key,
      ),
  );
  expect(people).toHaveLength(3);
  expect(scenario.sharedProgramCount).toBe(2);
  await page.goto("/requests/new");
  // The bulk-import scenario is a company request; the first scenario above
  // remains a true individual flow with no company or repeated identity.
  await page.getByRole("radio", { name: /^Организация/ }).check();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Форма компании", exact: true })
    .selectOption("NONE");
  await page
    .getByLabel("Название компании", { exact: true })
    .fill(people[0].workplaceRu);
  await page.getByRole("button", { name: "Импорт", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Импорт получателей", exact: true })
    .getByRole("button", { name: "Закрыть диалог", exact: true })
    .click();
  await expandCommon(
    page.locator(".request-organization-selected-compact details"),
  );
  await page
    .getByRole("button", {
      name: "Изменить общую карточку организации",
      exact: true,
    })
    .click();
  const company = page.getByRole("dialog", {
    name: "Реквизиты организации",
    exact: true,
  });
  await expandCommon(company.locator("details.organization-extra-name"));
  await company
    .getByRole("checkbox", {
      name: "Собственное наименование на казахском отличается",
      exact: true,
    })
    .check();
  await company
    .getByLabel("Собственное наименование · KZ", { exact: true })
    .fill(people[0].workplaceKz);
  await company.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(company).toHaveCount(0);
  await page.getByRole("button", { name: "Импорт", exact: true }).click();
  const columns = [
    "externalPersonKey",
    "personnelNumber",
    "fullNameRu",
    "fullNameKz",
    "positionRu",
    "positionKz",
    "workplaceRu",
    "workplaceKz",
    "departmentRu",
    "departmentKz",
  ];
  await page
    .getByLabel("Или вставьте таблицу с заголовками")
    .fill(
      [
        columns.join("\t"),
        ...people.map((person) =>
          columns.map((column) => person[column]).join("\t"),
        ),
      ].join("\n"),
    );
  await page
    .getByRole("button", { name: "Проверить таблицу", exact: true })
    .click();
  await expandCommon(page.locator("details.import-document-options"));
  await page
    .getByRole("combobox", {
      name: "Документ для импортируемых строк",
      exact: true,
    })
    .selectOption("pb-card");
  await page
    .getByRole("button", { name: "Добавить 3 строк в черновик", exact: true })
    .click();
  await expect(page.locator(".operator-grid tbody tr")).toHaveCount(3);
  await page.getByLabel("Выбрать видимых получателей", { exact: true }).check();
  const panel = await extraSettings(page);
  await panel
    .getByLabel(
      "Присоединить к событию существующее назначение той же формы без результата и основания, если оно одно. Импортированные и ручные исключения сохраняются.",
    )
    .check();
  for (const direction of ["pb", "ptm"]) {
    await panel
      .getByRole("combobox", {
        name: "Направление нового события",
        exact: true,
      })
      .selectOption(direction);
    await panel
      .getByRole("button", { name: "Добавить событие", exact: true })
      .click();
    await panel
      .getByLabel("Название события", { exact: true })
      .fill(`V03 ${direction}`);
    await panel
      .getByLabel("Программа / тема", { exact: true })
      .fill(`Общая программа ${direction}`);
    await panel.getByLabel("Объём обучения, часов", { exact: true }).fill("16");
    await panel
      .getByRole("button", {
        name: "Назначить набор выбранным (3)",
        exact: true,
      })
      .click();
    await expandCommon(
      panel.locator(
        'details.outcome-entry:has(> summary[data-training-field="outcomes"])',
      ),
    );
    await panel
      .getByLabel("Известный результат", { exact: true })
      .selectOption("UNKNOWN");
    await panel
      .getByLabel("Источник подтверждения", { exact: true })
      .fill(`V03 ${direction}: результат явно ещё не подтверждён`);
    await panel
      .getByRole("button", {
        name: "Применить результат · 3 человек",
        exact: true,
      })
      .click();
  }
  await panel
    .getByRole("button", { name: "Закрыть диалог", exact: true })
    .click();
  const common = await commonSettings(page);
  for (const [label, value] of [
    ["Дата документа для заявки", "2026-10-03"],
    ["Начало обучения для заявки", "2026-10-01"],
    ["Окончание обучения для заявки", "2026-10-02"],
    ["Дата проверки / протокола для заявки", "2026-10-02"],
  ])
    await common.getByLabel(label, { exact: true }).fill(value);
  await page
    .getByLabel("Должность · RU, строка 3", { exact: true })
    .fill(scenario.individualOverride.value);
  await save(page);
  const requestId = /requests\/([^/]+)/.exec(page.url())![1];
  const read = async (suffix = "") =>
    (
      await page.request.get(`/api/print-requests/${requestId}${suffix}`)
    ).json();
  const prior = (await read()) as Draft;
  const pbEvent = prior.events!.find((event) => event.title === "V03 pb")!;
  await expandCommon(page.locator("#request-training"));
  const currentPanel = page.locator(".training-primary-context");
  await currentPanel
    .getByRole("combobox", {
      name: "Обучение для общих данных и результатов",
      exact: true,
    })
    .selectOption(pbEvent.id);
  await currentPanel
    .getByLabel("Программа / тема", { exact: true })
    .fill("Общая программа PB после изменения");
  await save(page);
  await page.reload();
  const persisted = await read(),
    resolved = await read("/resolved");
  expect(persisted.items).toHaveLength(3);
  expect(persisted.kind).toBe("COMPANY");
  expect(
    persisted.items.map((item: { externalId: string }) => item.externalId),
  ).toEqual(scenario.personKeys);
  expect(persisted.items[2].positionRu).toBe(scenario.individualOverride.value);
  expect(
    persisted.items
      .slice(0, 2)
      .map((item: { positionRu: string }) => item.positionRu),
  ).toEqual(people.slice(0, 2).map((person) => person.positionRu));
  expect(persisted.events).toHaveLength(2);
  for (const item of resolved.draft.items) {
    expect(item.assignments).toHaveLength(2);
    expect(
      item.assignments.find(
        (assignment: { templateId: string }) =>
          assignment.templateId === "pb-card",
      ).trainingSubject,
    ).toBe("Общая программа PB после изменения");
    expect(
      item.assignments.find(
        (assignment: { templateId: string }) =>
          assignment.templateId === "ptm-card",
      ).trainingSubject,
    ).toBe("Общая программа ptm");
    expect(
      item.assignments.every(
        (assignment: {
          outcome: {
            status: string;
            source: string;
            confirmedBy?: string;
            confirmedAt?: string;
          };
          fieldOrigins: { outcome?: string };
        }) =>
          assignment.outcome.status === "UNKNOWN" &&
          assignment.outcome.source === "" &&
          !assignment.outcome.confirmedBy &&
          !assignment.outcome.confirmedAt &&
          assignment.fieldOrigins.outcome === "MANUAL",
      ),
    ).toBe(true);
  }
  const validationResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/print-requests/${requestId}/validate`) &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Проверить данные", exact: true })
    .click();
  const validation = await (await validationResponse).json();
  expect(validation.valid).toBe(false);
  expect([
    ...new Set(validation.issues.map((issue: { code: string }) => issue.code)),
  ]).toEqual(["OUTCOME_UNCONFIRMED"]);
  await expect(
    page.getByText("Исправьте данные перед оформлением", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      /Не подтверждены 6 результатов по обучениям у 3 получателей/,
    ),
  ).toBeVisible();
  await page.reload();
  await expandCommon(page.locator("#request-training"));
  await expandCommon(
    page.locator(
      'details.outcome-entry:has(> summary[data-training-field="outcomes"])',
    ),
  );
  await expect(
    page.getByLabel("Известный результат", { exact: true }),
  ).toHaveValue("UNKNOWN");
  await expect(
    page.getByLabel("Должность · RU, строка 3", { exact: true }),
  ).toHaveValue(scenario.individualOverride.value);
  expect((await read()).documents).toHaveLength(0);
  await page.screenshot({
    path: path.join(evidence, "v03-resumed.png"),
    fullPage: true,
  });
  await fs.writeFile(
    path.join(evidence, "v03-result.json"),
    JSON.stringify(
      {
        status: "PASS",
        source: "tests/fixtures/operator-value/DAILY_WORKFLOWS.json#cases.V03",
        requestId,
        singleId,
        people: 3,
        services: 2,
        sourcePeople: scenario.personKeys,
        individualPositionPreserved: scenario.individualOverride,
        commonChangeAppliedToAllThree: true,
        otherProgramPreserved: true,
        reloadRetainsUnknownAndWorkRemaining: true,
        validationBlocksOnlyUnknownOutcomes: true,
        noIssuance: true,
        singlePersonTwoKitsNoRepeatedIdentity: true,
        singlePersonResultNotCopiedToOtherTraining: true,
        apiMutations: mutations,
        automatedWallMs: Date.now() - started,
        humanOperatorMs: null,
        baselineMs: null,
        noMocks: true,
      },
      null,
      2,
    ),
  );
});

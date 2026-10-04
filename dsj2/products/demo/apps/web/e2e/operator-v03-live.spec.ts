import { createRequestWithWorkerDocument } from "./operator-keyboard-helpers";
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
async function addTraining(page: Page, row: number, name: RegExp) {
  await page
    .getByRole("button", {
      name: new RegExp(`^Настройки обучения получателя ${row}:`),
    })
    .click();
  const modal = page.getByRole("dialog", {
    name: "Назначить обучение",
    exact: true,
  });
  await modal.getByRole("checkbox", { name }).check();
  await modal
    .getByRole("button", { name: "Добавить обучение и комплект", exact: true })
    .click();
  await expect(modal).toHaveCount(0);
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
  await createRequestWithWorkerDocument(page, "PERSON");
  await page
    .getByLabel("ФИО, строка 1", { exact: true })
    .fill("Один Синтетический Человек");
  await page
    .getByRole("button", { name: "Детали получателя 1", exact: true })
    .click();
  let modal = page.getByRole("dialog");
  await modal.getByRole("tab", { name: "Личные данные", exact: true }).click();
  await expandCommon(modal.locator("details.person-fields-wide").first());
  await modal
    .locator('[data-field-path="items.0.fullNameKz"]')
    .fill("Бір Синтетикалық Адам");
  await modal.getByRole("tab", { name: /^Документы/ }).click();
  const first = modal.locator(".assignment-list > details").first();
  await expandCommon(first);
  await first
    .getByRole("tab", { name: "Обучение и результат", exact: true })
    .click();
  await first
    .getByLabel("Подтверждённый результат / оценка", { exact: true })
    .fill("Подтверждён только первый результат");
  await modal
    .getByRole("button", { name: "Вернуться к списку", exact: true })
    .click();
  await addTraining(page, 1, /^Промышленная безопасность/);
  const singleCommon = await commonSettings(page);
  await singleCommon
    .getByLabel("Программа / тема для заявки", { exact: true })
    .fill("Общий источник для двух обучений");
  await save(page);
  const singleId = /requests\/([^/]+)/.exec(page.url())![1];
  await page.reload();
  const single = await (
    await page.request.get(`/api/print-requests/${singleId}/resolved`)
  ).json();
  expect(single.draft.items).toHaveLength(1);
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
  expect(
    single.draft.items[0].assignments
      .filter((assignment: { templateId: string }) =>
        assignment.templateId.startsWith("pb-"),
      )
      .every((assignment: { result: string }) => assignment.result === ""),
  ).toBe(true);

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
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page
    .getByRole("button", { name: "Импорт / вставка", exact: true })
    .click();
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
    .getByRole("button", { name: "Перейти к сопоставлению", exact: true })
    .click();
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
    .getByRole("button", { name: "Детали получателя 3", exact: true })
    .click();
  modal = page.getByRole("dialog");
  await modal.getByRole("tab", { name: "Личные данные", exact: true }).click();
  await modal
    .getByLabel("Должность / профессия", { exact: true })
    .fill(scenario.individualOverride.value);
  await modal
    .getByRole("button", { name: "Вернуться к списку", exact: true })
    .click();
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
        (assignment: { outcome: { status: string } }) =>
          assignment.outcome.status === "UNKNOWN",
      ),
    ).toBe(true);
  }
  await page
    .getByRole("button", { name: "Проверить данные", exact: true })
    .click();
  await expect(
    page.getByText("Данные прошли проверку", { exact: true }),
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
  await page
    .getByRole("button", { name: "Детали получателя 3", exact: true })
    .click();
  await page.getByRole("tab", { name: "Личные данные", exact: true }).click();
  await expect(
    page.getByLabel("Должность / профессия", { exact: true }),
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

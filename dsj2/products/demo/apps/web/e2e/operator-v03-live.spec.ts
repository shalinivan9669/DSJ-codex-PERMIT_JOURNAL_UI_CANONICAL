import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
const product = path.resolve(__dirname, "../../..");
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    path.join(product, "docs/evidence/final-completion/operator/v03"),
);
async function save(page: Page) {
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.locator(".save-indicator")).toContainText("Сохранено");
}
test("V03 exact three source people and two services preserve the individual position and resume missing outcomes; V01 one person takes two forms", async ({
  page,
}) => {
  test.setTimeout(240000);
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
  await page.getByRole("link", { name: "Новая заявка", exact: true }).click();
  await page.getByRole("button", { name: /Человек Документы/ }).click();
  await page
    .getByLabel("ФИО RU, строка 1", { exact: true })
    .fill("Один Синтетический Человек");
  await page
    .getByLabel("ФИО KZ, строка 1", { exact: true })
    .fill("Бір Синтетикалық Адам");
  await page
    .getByLabel("Подтверждённый результат / оценка", { exact: true })
    .fill("Подтверждён только первый результат");
  await page
    .getByRole("button", { name: "Добавить документ", exact: true })
    .click();
  await page
    .locator(".assignment-list > details")
    .last()
    .locator("summary")
    .first()
    .click();
  await page
    .getByLabel("Форма документа", { exact: true })
    .last()
    .selectOption("pb-card");
  await page
    .getByRole("button", { name: "Настроить общий контекст", exact: true })
    .click();
  await page.getByText("Общие значения заявки", { exact: true }).click();
  await page
    .getByLabel("Программа / тема для заявки", { exact: true })
    .fill("Общий источник для двух форм");
  await page
    .getByRole("button", {
      name: "Сохранить общие значения заявки",
      exact: true,
    })
    .click();
  await save(page);
  const singleId = /requests\/([^/]+)/.exec(page.url())![1];
  await page.reload();
  const single = await (
    await page.request.get(`/api/print-requests/${singleId}/resolved`)
  ).json();
  expect(single.draft.items).toHaveLength(1);
  expect(single.draft.items[0].assignments).toHaveLength(2);
  expect(
    single.draft.items[0].assignments.map(
      (assignment: { trainingSubject: string }) => assignment.trainingSubject,
    ),
  ).toEqual(["Общий источник для двух форм", "Общий источник для двух форм"]);
  expect(
    single.draft.items[0].assignments.map(
      (assignment: { result: string }) => assignment.result,
    ),
  ).toEqual(["Подтверждён только первый результат", ""]);

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
  await page.goto("/requests");
  await page.getByRole("link", { name: "Новая заявка", exact: true }).click();
  await page.getByRole("button", { name: /Человек Документы/ }).click();
  await page
    .getByLabel("Название заявки", { exact: true })
    .fill(`V03 · три человека и две услуги ${Date.now()}`);
  await page
    .getByRole("button", { name: "Удалить получателя 1", exact: true })
    .click();
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
  await page.getByLabel("Выбрать всех получателей", { exact: true }).check();
  await page
    .getByRole("button", { name: "Настроить общий контекст", exact: true })
    .click();
  await page
    .getByLabel(
      "Присоединить к событию существующее назначение той же формы без результата и основания, если оно одно. Импортированные и ручные исключения сохраняются.",
    )
    .check();
  const panel = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "Общие сведения и события",
      exact: true,
    }),
  });
  for (const direction of ["pb", "ptm"]) {
    await page
      .getByRole("combobox", {
        name: "Направление нового события",
        exact: true,
      })
      .selectOption(direction);
    await page
      .getByRole("button", { name: "Добавить событие", exact: true })
      .click();
    await page
      .getByLabel("Название события", { exact: true })
      .fill(`V03 ${direction}`);
    await panel
      .getByLabel("Программа / тема", { exact: true })
      .fill(`Общая программа ${direction}`);
    await panel.getByLabel("Объём обучения, часов", { exact: true }).fill("16");
    await page
      .getByRole("button", {
        name: "Назначить набор выбранным (3)",
        exact: true,
      })
      .click();
  }
  await page
    .getByRole("button", { name: "Документы и даты получателя 3", exact: true })
    .click();
  await page.getByRole("tab", { name: "Личные данные", exact: true }).click();
  await page
    .getByLabel("Должность · RU", { exact: true })
    .fill(scenario.individualOverride.value);
  await save(page);
  const requestId = /requests\/([^/]+)/.exec(page.url())![1];
  const read = async (suffix = "") =>
    (
      await page.request.get(`/api/print-requests/${requestId}${suffix}`)
    ).json();
  const prior = await read();
  const pbEvent = prior.events.find(
    (event: { title: string }) => event.title === "V03 pb",
  );
  await page
    .getByRole("combobox", { name: "Событие", exact: true })
    .selectOption(pbEvent.id);
  await panel
    .getByLabel("Программа / тема", { exact: true })
    .fill("Общая программа PB после изменения");
  await save(page);
  await page.reload();
  const persisted = await read();
  const resolved = await read("/resolved");
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
  await page.getByRole("button", { name: "Проверить", exact: true }).click();
  await expect(
    page.getByText("Данные прошли проверку", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Не подтверждены результаты: 3/)).toBeVisible();
  await page.reload();
  await page
    .getByText("Подтвердить фактические результаты события", { exact: true })
    .click();
  await expect(
    page.getByLabel("Известный результат", { exact: true }),
  ).toHaveValue("UNKNOWN");
  await page
    .getByRole("button", { name: "Документы и даты получателя 3", exact: true })
    .click();
  await page.getByRole("tab", { name: "Личные данные", exact: true }).click();
  await expect(page.getByLabel("Должность · RU", { exact: true })).toHaveValue(
    scenario.individualOverride.value,
  );
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
        singlePersonTwoFormsNoRepeatedIdentity: true,
        singlePersonResultNotCopied: true,
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

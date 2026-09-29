import {
  createRequestWithWorkerDocument,
  openRecipientExtraTools,
} from "./operator-keyboard-helpers";
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const product = path.resolve(__dirname, "../../..");
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    path.join(
      product,
      "docs/evidence/final-completion/operator/common-history",
    ),
);
async function save(page: Page) {
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.locator(".save-indicator")).toContainText("Сохранено");
}
async function pickEmployer(page: Page, name: string) {
  await page
    .getByRole("button", { name: "Выбрать работодателя", exact: true })
    .click();
  await page.getByLabel("Поиск по справочнику", { exact: true }).fill(name);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Выбрать", exact: true })
    .click();
}

test("100 common assignments and two overrides render consistently, then employer history preserves the actual issued snapshot", async ({
  page,
}) => {
  test.setTimeout(3600000);
  await fs.mkdir(path.join(evidence, "files"), { recursive: true });
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
  const stamp = Date.now();
  const companies: { id: string; nameRu: string; bin: string }[] = [];
  for (const suffix of ["A", "B"]) {
    await page.goto("/customers");
    await page
      .getByRole("button", { name: "Добавить заказчика", exact: true })
      .click();
    await page
      .getByLabel("Название на русском", { exact: true })
      .fill(`Исторический работодатель ${suffix} ${stamp}`);
    await page
      .getByLabel("Название на казахском", { exact: true })
      .fill(`Тарихи жұмыс беруші ${suffix}`);
    await page
      .getByLabel("БИН", { exact: true })
      .fill(suffix === "A" ? "000000000031" : "000000000032");
    const pending = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/customers") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Сохранить", exact: true })
      .click();
    const response = await pending;
    expect(response.ok()).toBe(true);
    companies.push(await response.json());
  }
  const source = JSON.parse(
    await fs.readFile(
      path.join(product, "tests/fixtures/operator-value/100_people.json"),
      "utf8",
    ),
  );
  const people: Record<string, string>[] = source.people;
  const importedSubject = "Индивидуальная импортированная программа Б";
  const manualSubject = "Индивидуальная ручная программа А";
  const commonSubject = "Общая подтверждённая программа В";
  await page.goto("/requests");
  await page.getByRole("link", { name: "Новая заявка", exact: true }).click();
  await createRequestWithWorkerDocument(page, "PERSON");
  await page
    .getByLabel("Название заявки", { exact: true })
    .fill(`100 общих значений и история ${stamp}`);
  await page
    .getByRole("button", { name: "Удалить получателя 1", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Импорт / вставка", exact: true })
    .click();
  const columns = [
    "externalId",
    "personnelNumber",
    "employerId",
    "fullNameRu",
    "fullNameKz",
    "positionRu",
    "positionKz",
    "trainingSubject",
    "result",
  ];
  await page
    .getByLabel("Или вставьте таблицу с заголовками")
    .fill(
      [
        columns.join("\t"),
        ...people.map((person, index) =>
          columns
            .map((column) =>
              column === "externalId"
                ? `${stamp}-${person.externalPersonKey}`
                : column === "employerId"
                  ? companies[0].id
                  : column === "trainingSubject"
                    ? index === 1
                      ? importedSubject
                      : ""
                    : column === "result"
                      ? "Сдано по синтетической ведомости 2026"
                      : person[column],
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
    .selectOption("biot-worker-card");
  await page
    .getByRole("button", { name: "Добавить 100 строк в черновик", exact: true })
    .click();
  await save(page);
  const requestId = /requests\/([^/]+)/.exec(page.url())![1];
  const requestPath = new URL(page.url()).pathname;
  const read = async (suffix = "") => {
    const response = await page.request.get(
      `/api/print-requests/${requestId}${suffix}`,
    );
    expect(response.ok()).toBe(true);
    return response.json();
  };
  const initial = await read();
  const centerToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Almaty",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  expect(initial.commonFields.documentDate).toBe(centerToday);
  expect(
    initial.items.every(
      (item: {
        assignments: { trainingStart: string; trainingEnd: string }[];
      }) =>
        !item.assignments[0].trainingStart && !item.assignments[0].trainingEnd,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Настроить даты и протоколы", exact: true })
    .click();
  await expect(
    page.getByText("Даты и программа для всей заявки", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Программа / тема для заявки", { exact: true })
    .fill("Исходная общая программа");
  await page
    .getByLabel("Начало обучения для заявки", { exact: true })
    .fill("2026-09-20");
  await page
    .getByLabel("Окончание обучения для заявки", { exact: true })
    .fill("2026-09-22");
  await page
    .getByRole("button", {
      name: "Сохранить общие значения заявки",
      exact: true,
    })
    .click();
  await expect(page.locator(".save-indicator")).toContainText("Сохранено");
  await page
    .getByRole("button", { name: "Документы и даты получателя 1", exact: true })
    .click();
  await page
    .locator(".assignment-list")
    .getByLabel("Программа / тема обучения", { exact: true })
    .fill(manualSubject);
  await save(page);
  await page
    .getByLabel("Программа / тема для заявки", { exact: true })
    .fill(commonSubject);
  await page
    .getByRole("button", {
      name: "Сохранить общие значения заявки",
      exact: true,
    })
    .click();
  await expect(page.locator(".save-indicator")).toContainText("Сохранено");
  await page.reload();
  const beforeIssue = await read();
  const resolved = await read("/resolved");
  expect(beforeIssue.items[0].assignments[0].fieldOrigins.trainingSubject).toBe(
    "MANUAL",
  );
  expect(beforeIssue.items[1].assignments[0].fieldOrigins.trainingSubject).toBe(
    "IMPORTED",
  );
  const expected = resolved.draft.items.map(
    (
      item: {
        id: string;
        fullNameRu: string;
        fullNameKz: string;
        personnelNumber: string;
        assignments: {
          trainingSubject: string;
          trainingStart: string;
          trainingEnd: string;
          documentDate: string;
        }[];
      },
      index: number,
    ) => {
      const assignment = item.assignments[0];
      expect(assignment.trainingSubject).toBe(
        index === 0
          ? manualSubject
          : index === 1
            ? importedSubject
            : commonSubject,
      );
      expect(assignment.trainingStart).toBe("2026-09-20");
      expect(assignment.trainingEnd).toBe("2026-09-22");
      expect(assignment.documentDate).toBe(centerToday);
      return {
        rowId: item.id,
        fullNameRu: item.fullNameRu,
        fullNameKz: item.fullNameKz,
        personnelNumber: item.personnelNumber,
        ...assignment,
      };
    },
  );
  for (const row of [1, 2, 100]) {
    await page
      .getByRole("button", {
        name: `Документы и даты получателя ${row}`,
        exact: true,
      })
      .click();
    await expect(
      page
        .locator(".assignment-list")
        .getByLabel("Программа / тема обучения", { exact: true }),
    ).toHaveValue(expected[row - 1].trainingSubject);
  }
  await page
    .getByRole("button", { name: "Документы и даты получателя 1", exact: true })
    .click();
  await page.getByRole("tab", { name: "Личные данные", exact: true }).click();
  await page
    .getByText("Постоянная запись, работодатель и история", { exact: true })
    .click();
  await pickEmployer(page, companies[0].nameRu);
  await page
    .getByLabel("Должность · RU", { exact: true })
    .fill("Должность A до выпуска");
  await page
    .getByLabel("Период работы / основание актуальности", { exact: true })
    .fill("2025-2026 · синтетический период A");
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
  const personId = (await read()).items[0].recipientId;
  expect(personId).toBeTruthy();
  await page.getByRole("button", { name: "Проверить", exact: true }).click();
  await expect(
    page.getByText("Данные прошли проверку", { exact: true }),
  ).toBeVisible({ timeout: 180000 });
  await page
    .getByRole("button", { name: "Оформить комплект", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("100");
  await page.getByRole("button", { name: "Оформить", exact: true }).click();
  await expect(page.locator(".title-with-status .status")).toHaveText(
    "Оформлено",
  );
  await fs.writeFile(
    path.join(evidence, "checkpoint.json"),
    JSON.stringify(
      { status: "ISSUED_WAITING_FILES", requestId, personId, expected },
      null,
      2,
    ),
  );
  await expect(page.locator(".files-panel")).toContainText(
    "Готово 202 из 202",
    { timeout: 3000000 },
  );
  const issued = await read();
  expect(issued.documents).toHaveLength(100);
  const files = [];
  for (const artifact of issued.artifacts) {
    const response = await page.request.get(`/api/artifacts/${artifact.id}`);
    expect(response.ok()).toBe(true);
    const bytes = await response.body();
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      artifact.sha256,
    );
    const document = issued.documents.find(
      (item: { id: string }) => item.id === artifact.documentId,
    );
    const file = `files/${artifact.id}.${artifact.format.toLowerCase()}`;
    await fs.writeFile(path.join(evidence, file), bytes);
    files.push({ ...artifact, rowId: document?.rowId, path: file });
  }
  await page
    .getByRole("button", { name: "Настроить выдачу", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Заказчик этого комплекта", exact: true })
    .selectOption(companies[0].id);
  for (const field of [
    "trainingSubject",
    "trainingStart",
    "trainingEnd",
    "hours",
  ])
    await page
      .getByRole("combobox", { name: "Добавить колонку", exact: true })
      .selectOption(field);
  const download = page.waitForEvent("download");
  await page
    .locator("section")
    .filter({
      has: page.getByRole("combobox", {
        name: "Заказчик этого комплекта",
        exact: true,
      }),
    })
    .getByRole("button", { name: "Реестр XLSX", exact: true })
    .click();
  await (await download).saveAs(path.join(evidence, "common-values.xlsx"));
  await fs.writeFile(
    path.join(evidence, "files-checkpoint.json"),
    JSON.stringify({ requestId, personId, expected, files }, null, 2),
  );
  await page.goto("/requests");
  await page.getByRole("link", { name: "Новая заявка", exact: true }).click();
  await createRequestWithWorkerDocument(page, "PERSON");
  await openRecipientExtraTools(page);
  await page
    .getByRole("button", { name: "Найти человека", exact: true })
    .click();
  await page
    .getByLabel("Поиск по справочнику", { exact: true })
    .fill(`${stamp}-${people[0].externalPersonKey}`);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Выбрать", exact: true })
    .click();
  await save(page);
  const nextId = /requests\/([^/]+)/.exec(page.url())![1];
  const next = await (
    await page.request.get(`/api/print-requests/${nextId}`)
  ).json();
  expect(next.items[0].recipientId).toBe(personId);
  expect(next.items[0].assignments).toHaveLength(1);
  expect(next.items[0].assignments[0].result).toBe("");
  expect(next.items[0].assignments[0].trainingStart).toBe("");
  expect(next.items[0].assignments[0].eventId).toBeUndefined();
  expect(next.documents).toHaveLength(0);
  await page
    .getByRole("button", { name: "Документы и даты получателя 1", exact: true })
    .click();
  await page.getByRole("tab", { name: "Личные данные", exact: true }).click();
  await page
    .getByText("Постоянная запись, работодатель и история", { exact: true })
    .click();
  await pickEmployer(page, companies[1].nameRu);
  await page
    .getByLabel("Должность · RU", { exact: true })
    .fill("Должность B после выпуска");
  await page
    .getByLabel("Период работы / основание актуальности", { exact: true })
    .fill("2027 · синтетический период B");
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
  await save(page);
  const history = await (
    await page.request.get(`/api/recipients/${personId}`)
  ).json();
  expect(history.employment).toHaveLength(2);
  const now = await (
    await page.request.get(`/api/print-requests/${nextId}`)
  ).json();
  expect(now.items[0].employerId).toBe(companies[1].id);
  expect(now.items[0].employerBin).toBe(companies[1].bin);
  const preserved = await read();
  expect(preserved.issuances).toEqual(issued.issuances);
  expect(preserved.items[0].employerId).toBe(companies[0].id);
  expect(preserved.items[0].positionRu).toBe("Должность A до выпуска");
  for (const file of files.filter(
    (file) => file.rowId === issued.items[0].id,
  )) {
    const bytes = await (
      await page.request.get(`/api/artifacts/${file.id}`)
    ).body();
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.sha256);
  }
  await page.goto(requestPath);
  await expect(
    page.getByRole("button", { name: "Сохранить", exact: true }),
  ).toBeHidden();
  await expect(
    page.getByLabel("Название заявки", { exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: path.join(evidence, "historical-issued-unchanged.png"),
    fullPage: true,
  });
  await fs.writeFile(
    path.join(evidence, "common-history-result.json"),
    JSON.stringify(
      {
        status: "PASS",
        requestId,
        nextId,
        personId,
        companies: companies.map((company) => company.id),
        actualDocuments: 100,
        actualFiles: 202,
        uiAndResolvedAgree: true,
        twoOverrides: ["MANUAL", "IMPORTED"],
        currentEmployerChanged: true,
        historicalSnapshotAndFileHashesUnchanged: true,
        reusedPersonHasNoOldAssignmentsOrDatesOrResult: true,
        noMocks: true,
        expected,
        files,
      },
      null,
      2,
    ),
  );
});

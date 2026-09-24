import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import {
  keyboardMetrics,
  keyboardFocus,
  keyboardActivate,
  keyboardEnter,
  keyboardCheck,
  keyboardSelect,
  keyboardReopen,
  saveKeyboardMetrics,
} from "./operator-keyboard-helpers";
const product = path.resolve(__dirname, "../../..");
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    path.join(product, "docs/evidence/final-completion/operator/g1"),
);
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
function zipText(bytes: Buffer, wanted: string) {
  let end = bytes.length - 22;
  while (end >= 0 && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("ZIP directory missing");
  let cursor = bytes.readUInt32LE(end + 16);
  for (let index = 0; index < bytes.readUInt16LE(end + 10); index++) {
    const length = bytes.readUInt16LE(cursor + 28);
    const name = bytes.subarray(cursor + 46, cursor + 46 + length).toString();
    if (name === wanted) {
      const local = bytes.readUInt32LE(cursor + 42);
      const start =
        local +
        30 +
        bytes.readUInt16LE(local + 26) +
        bytes.readUInt16LE(local + 28);
      const compressed = bytes.subarray(
        start,
        start + bytes.readUInt32LE(cursor + 20),
      );
      return (
        bytes.readUInt16LE(cursor + 10) === 8
          ? inflateRawSync(compressed)
          : compressed
      ).toString("utf8");
    }
    cursor +=
      46 +
      length +
      bytes.readUInt16LE(cursor + 30) +
      bytes.readUInt16LE(cursor + 32);
  }
  throw new Error(`ZIP entry missing: ${wanted}`);
}
async function save(page: Page) {
  await keyboardActivate(
    page,
    page.getByRole("button", { name: "Сохранить", exact: true }),
  );
  await expect(page.locator(".save-indicator")).toContainText("Сохранено");
}
test.afterEach(async ({ page }, testInfo) => {
  await saveKeyboardMetrics(
    evidence,
    testInfo.status || (page.isClosed() ? "CLOSED" : "UNKNOWN"),
  );
});

test("G1 keyboard only: 100 people, visible focus, errors and explicit issuance of 101 actual documents", async ({
  page,
  browser,
}) => {
  test.setTimeout(3600000);
  // This test runs against the production build with actual API and worker.

  expect(process.env.DEMO_E2E_ISOLATED_TENANT).toBe("1");
  await fs.mkdir(evidence, { recursive: true });
  const peopleSource = JSON.parse(
    await fs.readFile(
      path.join(product, "tests/fixtures/operator-value/100_people.json"),
      "utf8",
    ),
  );
  const eventsSource = JSON.parse(
    await fs.readFile(
      path.join(product, "tests/fixtures/operator-value/training_events.json"),
      "utf8",
    ),
  );
  const resultsSource = JSON.parse(
    await fs.readFile(
      path.join(product, "tests/fixtures/operator-value/results_G1.json"),
      "utf8",
    ),
  );
  const sourceEvent = eventsSource.events.find(
    (event: { id: string }) => event.id === "PB-G1",
  );
  const people: Record<string, string>[] = peopleSource.people;
  expect(people).toHaveLength(100);
  expect(resultsSource.rows).toHaveLength(100);
  expect(
    new Set(resultsSource.rows.map((row: { outcome: string }) => row.outcome)),
  ).toEqual(new Set(["PASSED"]));
  const started = Date.now();
  let mutations = 0;
  let individualPanelsOpened = 0;
  page.on("request", (request) => {
    if (
      request.url().includes("/api/") &&
      !["GET", "HEAD", "OPTIONS"].includes(request.method())
    )
      mutations++;
  });
  await page.goto("/login");
  await keyboardEnter(
    page,
    page.getByLabel("Электронная почта", { exact: true }),
    process.env.DEMO_E2E_EMAIL!,
  );
  await keyboardEnter(
    page,
    page.getByLabel("Пароль", { exact: true }),
    process.env.DEMO_E2E_PASSWORD!,
  );
  await keyboardActivate(
    page,
    page.getByRole("button", { name: "Войти", exact: true }),
  );
  await expect(
    page.getByRole("heading", { name: "Заявки на печать" }),
  ).toBeVisible();
  await keyboardActivate(
    page,
    page.getByRole("link", {
      name: "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438",
      exact: true,
    }),
  );
  await expect(page.getByLabel("Юридическое название · RU")).toBeVisible();
  while ((await page.locator(".commission-row").count()) < 3)
    await keyboardActivate(
      page,
      page.getByRole("button", { name: "Добавить", exact: true }),
    );
  for (let index = 0; index < 3; index++) {
    const member = page.locator(".commission-row").nth(index);
    await keyboardEnter(
      page,
      member.getByLabel("ФИО", { exact: true }),
      `G1 Синтетический член комиссии ${index + 1}`,
    );
    await keyboardEnter(
      page,
      member.getByLabel("Роль в комиссии / должность", { exact: true }),
      index ? "Член комиссии" : "Председатель",
    );
  }
  await keyboardCheck(
    page,
    page.getByLabel(
      "Реквизиты и состав комиссии проверены уполномоченным сотрудником центра",
    ),
  );
  await keyboardActivate(
    page,
    page.getByRole("button", { name: "Сохранить новую версию", exact: true }),
  );
  await expect(page.getByText(/Создана новая версия реквизитов/)).toBeVisible();
  await keyboardActivate(
    page,
    page.getByRole("link", {
      name: "\u0417\u0430\u044F\u0432\u043A\u0438",
      exact: true,
    }),
  );
  await keyboardActivate(
    page,
    page.getByRole("link", { name: "Новая заявка", exact: true }),
  );
  await keyboardActivate(
    page,
    page.getByRole("button", { name: /Организация Заказчик/ }),
  );
  await keyboardEnter(
    page,
    page.getByLabel("Название заявки", { exact: true }),
    `G1 · полный UI путь 100 человек ${Date.now()}`,
  );
  await keyboardActivate(
    page,
    page.getByRole("button", { name: "Добавить заказчика", exact: true }),
  );
  await keyboardEnter(
    page,
    page.getByLabel("Название на русском", { exact: true }),
    people[0].workplaceRu,
  );
  await keyboardEnter(
    page,
    page.getByLabel("Название на казахском", { exact: true }),
    people[0].workplaceKz,
  );
  await keyboardEnter(
    page,
    page.getByLabel("БИН", { exact: true }),
    "000000000001",
  );
  await keyboardActivate(
    page,
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Сохранить", exact: true }),
  );
  await keyboardActivate(
    page,
    page.getByRole("button", { name: "Удалить получателя 1", exact: true }),
  );
  await keyboardActivate(
    page,
    page.getByRole("button", { name: "Импорт / вставка", exact: true }),
  );
  const columns: string[] = peopleSource.columns;
  await keyboardEnter(
    page,
    page.getByLabel("Или вставьте таблицу с заголовками"),
    [
      columns.join("\t"),
      ...people.map((person) =>
        columns.map((column) => person[column]).join("\t"),
      ),
    ].join("\n"),
  );
  await keyboardActivate(
    page,
    page.getByRole("button", { name: "Перейти к сопоставлению", exact: true }),
  );
  await expect(page.getByText("Прочитано: 100", { exact: true })).toBeVisible();
  await keyboardSelect(
    page,
    page.getByRole("combobox", {
      name: "Документ для импортируемых строк",
      exact: true,
    }),
    "pb-card",
  );
  await keyboardActivate(
    page,
    page.getByRole("button", {
      name: "Добавить 100 строк в черновик",
      exact: true,
    }),
  );
  await expect(page.locator(".recipient-table tbody tr")).toHaveCount(100);
  await page.exposeFunction(
    "noteIndividualPanel",
    () => individualPanelsOpened++,
  );
  await page.evaluate(() => {
    document.addEventListener(
      "click",
      (event) => {
        const target = (event.target as Element).closest("button");
        if (
          target
            ?.getAttribute("aria-label")
            ?.startsWith("Документы и даты получателя")
        )
          (
            window as unknown as {
              noteIndividualPanel: () => void;
            }
          ).noteIndividualPanel();
      },
      true,
    );
  });
  await keyboardActivate(
    page,
    page.getByRole("button", { name: "Сопоставить фото", exact: true }),
  );
  const photoBytes = await fs.readFile(
    path.join(product, "tests/fixtures/source-photo.png"),
  );
  await page.getByLabel("Фотографии PNG/JPEG", { exact: true }).setInputFiles(
    people.map((person) => ({
      name: `${person.externalPersonKey}.png`,
      mimeType: "image/png",
      buffer: photoBytes,
    })),
  );
  keyboardMetrics.nativeFileSelections++;
  await saveKeyboardMetrics(evidence, "RUNNING_PHOTOS_MATCHED");
  await expect(page.getByRole("dialog")).toContainText(
    "Совпало: 100. Неоднозначных файлов: 0",
  );
  await keyboardCheck(
    page,
    page.getByLabel(
      "Проверены однозначные совпадения: применить 100 фото. Остальные строки сохранить.",
    ),
  );
  await keyboardActivate(
    page,
    page.getByRole("button", { name: "Применить 100 фото", exact: true }),
  );
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 240000 });
  await saveKeyboardMetrics(evidence, "RUNNING_CHECK_DATA");
  await keyboardActivate(
    page,
    page.getByRole("button", { name: "Проверить", exact: true }),
  );
  await expect(page.locator(".validation-result")).toContainText(
    "Исправьте данные перед оформлением",
  );
  await expect(page.locator(".validation-result")).toBeFocused();
  await page.screenshot({
    path: path.join(evidence, "keyboard-validation-focus.png"),
  });
  await keyboardFocus(
    page,
    page.getByLabel("ФИО RU, строка 100", { exact: true }),
  );
  const enteredName = await page
    .getByLabel("ФИО RU, строка 100", { exact: true })
    .inputValue();
  await page.keyboard.press("Enter");
  keyboardMetrics.enterNoFinalizeChecks++;
  await expect(
    page.getByLabel("ФИО RU, строка 100", { exact: true }),
  ).toHaveValue(enteredName);
  await expect(page.locator(".title-with-status .status")).toHaveText(
    "Черновик",
  );
  await keyboardCheck(
    page,
    page.getByLabel("Выбрать всех получателей", { exact: true }),
  );
  await keyboardActivate(
    page,
    page.getByRole("button", { name: "Настроить общий контекст", exact: true }),
  );
  await keyboardCheck(
    page,
    page.getByLabel(
      "При назначении набора убрать пустые начальные назначения других направлений у выбранных людей. Введённые и импортированные сведения сохраняются.",
    ),
  );
  await keyboardActivate(
    page,
    page.getByRole("button", { name: "Добавить событие", exact: true }),
  );
  await keyboardEnter(
    page,
    page.getByLabel("Название события", { exact: true }),
    "PB-G1 · исходный синтетический сценарий",
  );
  const eventPanel = page.locator(".common-context");
  for (const [label, field] of [
    ["Дата документа", "documentDate"],
    ["Начало обучения", "trainingStart"],
    ["Окончание обучения", "trainingEnd"],
    ["Дата проверки / протокола", "protocolDate"],
    ["Программа / тема", "trainingSubject"],
    ["Объём обучения, часов", "hours"],
  ])
    await keyboardEnter(
      page,
      eventPanel.getByLabel(label, { exact: true }),
      sourceEvent[field],
    );
  await keyboardActivate(
    page,
    page.getByRole("button", {
      name: "Назначить набор выбранным (100)",
      exact: true,
    }),
  );
  await expect(
    page.getByText("100 назначений · 1 общий протокол при оформлении"),
  ).toBeVisible();
  await save(page);
  const requestId = /requests\/([^/]+)/.exec(page.url())![1];
  const requestPath = new URL(page.url()).pathname;
  const getRecord = async () => {
    const response = await page.request.get(`/api/print-requests/${requestId}`);
    expect(response.ok()).toBe(true);
    return response.json();
  };
  const before = await getRecord();
  expect(before.items).toHaveLength(100);
  for (const [index, item] of before.items.entries()) {
    expect(item.externalId).toBe(people[index].externalPersonKey);
    expect(item.personnelNumber).toBe(people[index].personnelNumber);
    expect(item.sourceRow).toBe(index + 2);
    expect(item.fullNameKz).toBe(people[index].fullNameKz);
    expect(item.photoAssetId).toBeTruthy();
    expect(item.assignments).toHaveLength(1);
    expect(item.assignments[0].templateId).toBe("pb-card");
    expect(item.assignments[0].outcome.status).toBe("UNKNOWN");
    expect(item.assignments[0].result).toBe("");
  }
  expect(before.documents).toHaveLength(0);
  await keyboardActivate(
    page,
    page.getByRole("button", {
      name: "Назначить набор выбранным (100)",
      exact: true,
    }),
  );
  await save(page);
  const repeated = await getRecord();
  expect(
    repeated.items.map((item: { assignments: unknown }) => item.assignments),
  ).toEqual(
    before.items.map((item: { assignments: unknown }) => item.assignments),
  );
  await keyboardActivate(
    page,
    page.getByText("Подтвердить фактические результаты события", {
      exact: true,
    }),
  );
  await keyboardSelect(
    page,
    page.getByLabel("Известный результат", { exact: true }),
    "PASSED",
  );
  const resultSource = `${resultsSource.rows[0].evidenceKey}; ${resultsSource.rows[0].confirmedBy}; ${resultsSource.rows[0].confirmedAt}`;
  await keyboardEnter(
    page,
    page.getByLabel("Источник подтверждения", { exact: true }),
    resultSource,
  );
  await keyboardActivate(
    page,
    page.getByRole("button", {
      name: "Проверить применение результатов",
      exact: true,
    }),
  );
  await expect(
    page.getByText(/Будет заменён результат у 100 участников события/),
  ).toBeVisible();
  await keyboardActivate(
    page,
    page.getByRole("button", { name: "Подтвердить результаты", exact: true }),
  );
  await save(page);
  await keyboardReopen(page);
  await expect(
    page.getByLabel("Название события", { exact: true }),
  ).toHaveValue("PB-G1 · исходный синтетический сценарий");
  await expect(page.locator(".recipient-table tbody tr")).toHaveCount(100);
  await saveKeyboardMetrics(evidence, "RUNNING_CHECK_DATA");
  await keyboardActivate(
    page,
    page.getByRole("button", { name: "Проверить", exact: true }),
  );
  await expect(
    page.getByText("Данные прошли проверку", { exact: true }),
  ).toBeVisible({ timeout: 180000 });
  await page.screenshot({
    path: path.join(evidence, "g1-ready.png"),
    fullPage: true,
  });
  const prepareWallMs = Date.now() - started;
  expect(individualPanelsOpened).toBe(0);
  await fs.writeFile(
    path.join(evidence, "g1-checkpoint.json"),
    JSON.stringify(
      {
        status: "READY",
        requestId,
        requestPath,
        prepareWallMs,
        individualPanelsOpened,
        browser: browser.version(),
        mutations,
        syntheticOnly: true,
        keyboardOnlyInApp: true,
        keyboardMetrics,
      },
      null,
      2,
    ),
  );
  await keyboardActivate(
    page,
    page.getByRole("button", { name: "Оформить комплект", exact: true }),
  );
  await expect(page.getByRole("dialog")).toContainText("101");
  const dialogClose = page
    .getByRole("dialog")
    .getByRole("button", { name: "Закрыть диалог", exact: true });
  const dialogIssue = page
    .getByRole("dialog")
    .getByRole("button", { name: "Оформить", exact: true });
  await keyboardFocus(page, dialogClose);
  await page.keyboard.press("Shift+Tab");
  keyboardMetrics.shiftTabs++;
  await expect(dialogIssue).toBeFocused();
  await page.keyboard.press("Tab");
  keyboardMetrics.tabs++;
  await expect(dialogClose).toBeFocused();
  keyboardMetrics.dialogTrapChecks++;
  await page.screenshot({
    path: path.join(evidence, "keyboard-final-confirmation.png"),
  });
  await saveKeyboardMetrics(evidence, "RUNNING_READY_TO_ISSUE");
  const renderStarted = Date.now();
  await keyboardActivate(
    page,
    page.getByRole("button", { name: "Оформить", exact: true }),
  );
  await expect(page.locator(".title-with-status .status")).toHaveText(
    "Оформлено",
  );
  await saveKeyboardMetrics(evidence, "RUNNING_FILES_WAIT");
  await expect(page.locator(".files-panel")).toContainText(
    "Готово 204 из 204",
    { timeout: 1800000 },
  );
  const renderWallMs = Date.now() - renderStarted;
  const downloadReady = page.waitForEvent("download");
  await keyboardActivate(
    page,
    page
      .locator(".files-panel article")
      .filter({
        has: page.locator(".file-type").getByText("PDF", { exact: true }),
      })
      .first()
      .getByRole("link", { name: "Скачать", exact: true }),
  );
  const keyboardDownload = await downloadReady;
  await keyboardDownload.saveAs(path.join(evidence, "keyboard-download.pdf"));
  keyboardMetrics.artifactDownloads++;
  const issued = await getRecord();
  expect(issued.documents).toHaveLength(101);
  expect(issued.issuances).toHaveLength(1);
  expect(issued.artifacts).toHaveLength(204);
  expect(
    issued.documents.filter(
      (document: { ownerKind: string }) => document.ownerKind === "GROUP",
    ),
  ).toHaveLength(1);
  const group = issued.documents.find(
    (document: { ownerKind: string }) => document.ownerKind === "GROUP",
  );
  const numbers = issued.documents.map(
    (document: { number: string }) => document.number,
  );
  expect(new Set(numbers).size).toBe(101);
  const fileDir = path.join(evidence, "files");
  await fs.mkdir(fileDir, { recursive: true });
  const files = [];
  for (const artifact of issued.artifacts) {
    const response = await page.request.get(`/api/artifacts/${artifact.id}`);
    expect(response.ok()).toBe(true);
    const bytes = await response.body();
    expect(hash(bytes)).toBe(artifact.sha256);
    const document = issued.documents.find(
      (item: { id: string }) => item.id === artifact.documentId,
    );
    if (artifact.format === "DOCX") {
      const xml = zipText(bytes, "word/document.xml");
      const text = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)]
        .map((match) => match[1])
        .join(" ");
      if (document.ownerKind === "GROUP") {
        // The approved PB protocol maps HOURS and PROTOCOL_DATE; SUBJECT is a card-only field.
        expect(text).toContain(`${sourceEvent.hours}-часовой`);
        expect(text).toContain(
          sourceEvent.protocolDate.split("-").reverse().join("."),
        );
        for (const person of people) {
          expect(text).toContain(person.fullNameRu);
          expect(text).toContain(person.fullNameKz);
        }
        expect([...text.matchAll(/(?:^|\s)Сдал(?=\s|$)/g)]).toHaveLength(100);
        expect(text).toContain(group.number);
      } else {
        expect(text).toContain(sourceEvent.trainingSubject);
        const person = issued.items.find(
          (item: { id: string }) => item.id === document.rowId,
        );
        expect(text).toContain(person.fullNameRu);
        expect(text).toContain(person.fullNameKz);
        expect(text).toContain(group.number);
        for (const other of people.filter(
          (item) => item.fullNameRu !== person.fullNameRu,
        ))
          expect(text).not.toContain(other.fullNameRu);
      }
    }
    const file = `${artifact.id}.${artifact.format.toLowerCase()}`;
    await fs.writeFile(path.join(fileDir, file), bytes);
    files.push({
      id: artifact.id,
      documentId: artifact.documentId,
      ownerKind: document?.ownerKind,
      rowId: document?.rowId,
      number: document?.number,
      externalId: issued.items.find(
        (item: { id: string }) => item.id === document?.rowId,
      )?.externalId,
      format: artifact.format,
      sha256: artifact.sha256,
      bytes: bytes.length,
      path: `files/${file}`,
    });
  }
  await keyboardReopen(page);
  await expect(page.locator(".files-panel")).toContainText("Готово 204 из 204");
  const reloaded = await getRecord();
  expect(
    reloaded.documents.map((document: { number: string }) => document.number),
  ).toEqual(numbers);
  expect(reloaded.issuances[0].snapshot).toEqual(issued.issuances[0].snapshot);
  await page.screenshot({
    path: path.join(evidence, "g1-issued.png"),
    fullPage: true,
  });
  await fs.writeFile(
    path.join(evidence, "g1-result.json"),
    JSON.stringify(
      {
        status: "PASS",
        syntheticOnly: true,
        keyboardOnlyInApp: true,
        keyboardMetrics,
        requestId,
        requestPath,
        recipients: 100,
        sourceRowsPreserved: true,
        photos: 100,
        individualPanelsOpened,
        documentCount: 101,
        groupProtocolCount: 1,
        allFilesHashVerified: true,
        groupNumber: group.number,
        prepareWallMs,
        renderWallMs,
        automatedWallMs: Date.now() - started,
        apiMutations: mutations,
        humanOperatorMs: null,
        baselineMs: null,
        legalAcceptance: "NOT_RUN",
        physicalPrint: "NOT_RUN",
        browser: browser.version(),
        files,
      },
      null,
      2,
    ),
  );
});

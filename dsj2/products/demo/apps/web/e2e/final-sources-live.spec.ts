import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    "../../docs/evidence/final-completion/sources",
);
test.use({ trace: "off" });
async function start(page: Page, context: BrowserContext) {
  await context.routeWebSocket("**/_next/webpack-hmr", (socket) =>
    socket.close(),
  );
  await fs.mkdir(evidence, { recursive: true });
  const auth = JSON.parse(
    await fs.readFile(
      path.resolve("../../.runtime/invites-ui-auth.json"),
      "utf8",
    ),
  );
  await page.goto("/login");
  await page.getByLabel("Электронная почта", { exact: true }).fill(auth.email);
  await page.getByLabel("Пароль", { exact: true }).fill(auth.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Заявки на печать" }),
  ).toBeVisible();
  const csrf = (await context.cookies()).find(
    (c) => c.name === "demo_csrf",
  )!.value;
  const headers = { origin: process.env.DEMO_ORIGIN!, "x-csrf-token": csrf };
  const post = async (
    endpoint: string,
    data: unknown,
    extra: Record<string, string> = {},
  ) => {
    const r = await page.request.post(`/api${endpoint}`, {
      headers: { ...headers, ...extra },
      data,
    });
    expect(r.status(), await r.text()).toBe(201);
    return r.json();
  };
  const get = async (endpoint: string) => {
    const r = await page.request.get(`/api${endpoint}`);
    expect(r.status(), await r.text()).toBe(200);
    return r.json();
  };
  const library = async (section: string) => {
    await page.goto("/workbench");
    await page
      .getByRole("tab", { name: "Источники и правила", exact: true })
      .click();
    await page.getByRole("tab", { name: section, exact: true }).click();
  };
  return { post, get, library, auth };
}
function zipEntries(bytes: Buffer) {
  let end = bytes.length - 22;
  while (end >= 0 && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("ZIP directory missing");
  let cursor = bytes.readUInt32LE(end + 16);
  const entries: Record<string, Buffer> = {};
  for (let i = 0; i < bytes.readUInt16LE(end + 10); i++) {
    const nameLength = bytes.readUInt16LE(cursor + 28),
      extra = bytes.readUInt16LE(cursor + 30),
      comment = bytes.readUInt16LE(cursor + 32);
    const name = bytes
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString();
    const local = bytes.readUInt32LE(cursor + 42),
      start =
        local +
        30 +
        bytes.readUInt16LE(local + 26) +
        bytes.readUInt16LE(local + 28);
    const compressed = bytes.subarray(
      start,
      start + bytes.readUInt32LE(cursor + 20),
    );
    entries[name] =
      bytes.readUInt16LE(cursor + 10) === 8
        ? inflateRawSync(compressed)
        : compressed;
    cursor += 46 + nameLength + extra + comment;
  }
  return entries;
}

test("live service passport versions preserve issued history, optional obligations and distinct renewal dates/contact history", async ({
  page,
  context,
}) => {
  test.setTimeout(240000);
  const { post, get, library } = await start(page, context);
  const suffix = Date.now(),
    title = `Паспорт полного источника ${suffix}`,
    serviceKey = `source_${suffix}`;
  await library("Паспорта услуг");
  await page
    .getByRole("button", { name: "Добавить запись с источником", exact: true })
    .click();
  for (const [label, value] of [
    ["Название", title],
    [
      "Источник документа / требования",
      "Синтетический проверенный договор и регламент",
    ],
    ["Версия программы / документа", "1"],
    ["Применимость", "Синтетический ПБ, только указанные формы"],
    ["Постоянный код услуги", serviceKey],
    ["Дата проверки источника", "2026-09-24"],
    ["Применяется с", "2026-09-01"],
    ["Применяется до", "2027-09-30"],
    ["Основное требование", "Подтверждённый результат проверки"],
    ["Ограничения применимости", "Не является допуском к работе"],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  await page
    .getByRole("combobox", { name: "Состояние новой версии", exact: true })
    .selectOption("APPROVED");
  await page
    .getByRole("combobox", { name: "Применимая форма", exact: true })
    .selectOption("pb-card");
  await page
    .getByRole("group", {
      name: "Дополнительные совместимые формы",
      exact: true,
    })
    .getByRole("checkbox", {
      name: "ПБ — индивидуальный протокол",
      exact: true,
    })
    .check();
  await page
    .getByRole("combobox", { name: "Этап основного требования", exact: true })
    .selectOption("RESULTS");
  await page
    .getByRole("combobox", { name: "Источник требования", exact: true })
    .selectOption("NORMATIVE");
  for (const [label, source, stage] of [
    ["Подписанная ведомость", "CONTRACT", "EVIDENCE"],
    ["Выдать дополнительные материалы", "RECOMMENDATION", "TRANSFER"],
  ]) {
    await page
      .getByRole("button", {
        name: "Добавить требование к услуге",
        exact: true,
      })
      .click();
    const fieldset = page
      .locator("fieldset")
      .filter({ has: page.getByText(/Дополнительное требование \d+/) })
      .last();
    await fieldset
      .getByLabel("Содержание требования", { exact: true })
      .fill(label);
    await fieldset
      .getByRole("combobox", { name: "Основание требования", exact: true })
      .selectOption(source);
    await fieldset
      .getByRole("combobox", { name: "Этап требования", exact: true })
      .selectOption(stage);
  }
  await page
    .getByRole("button", {
      name: "Сохранить запись как утверждённую версию",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("Запись сохранена.", { exact: true }),
  ).toBeVisible();
  const oldRule = (await get("/service-rules")).items.find(
    (v: { serviceKey: string }) => v.serviceKey === serviceKey,
  );
  expect(oldRule.definition.requirements).toHaveLength(3);
  const ruleRow = page.getByRole("row").filter({ hasText: title });
  await ruleRow
    .getByText("Состав паспорта и применимость", { exact: true })
    .click();
  await expect(ruleRow).toContainText("Нормативное");
  await expect(ruleRow).toContainText("Договорное");
  await expect(ruleRow).toContainText("Рекомендованное");
  await expect(ruleRow).toContainText(
    "Проверка источника: 2026-09-24 · Администратор",
  );
  await ruleRow
    .getByText("Версии форм, поля и выходные документы", { exact: true })
    .click();
  await expect(ruleRow).toContainText(
    "Категория: Без ограничения категории получателя",
  );
  await expect(ruleRow).toContainText("Версия формы:");
  await expect(ruleRow).toContainText("Выходные файлы: DOCX, PDF");
  await expect(ruleRow).toContainText("Назначение: Общий протокол события");
  await expect(ruleRow).toContainText("Назначение: Индивидуальный протокол");
  await expect(ruleRow).toContainText("ФИО получателя");
  await expect(ruleRow).toContainText("Фактический результат проверки знаний");
  await page.screenshot({
    path: path.join(evidence, "passport-form-fields-versions.png"),
    fullPage: true,
  });
  const customer = await post("/customers", {
    nameRu: `Заказчик политики ${suffix}`,
  });
  const person = await post("/recipients", {
    id: randomUUID(),
    fullNameRu: `Получатель политики ${suffix}`,
    positionRu: "Мастер",
    employerId: customer.id,
    assignments: [],
  });
  const eventId = randomUUID(),
    rowId = randomUUID(),
    assignmentId = randomUUID();
  const draft = (ruleId: string, targetEvent: string) => ({
    schemaVersion: 2,
    kind: "COMPANY",
    customerId: customer.id,
    title: `История паспорта ${suffix}`,
    demoMode: true,
    events: [
      {
        id: targetEvent,
        title: "ПБ по сохранённому паспорту",
        protocolTemplateId: "pb-protocol",
        serviceRuleVersionId: ruleId,
        commonFields: {
          documentDate: "2026-09-24",
          protocolDate: "2026-09-24",
          trainingStart: "2026-09-23",
          trainingEnd: "2026-09-24",
          trainingSubject: "Синтетическая промышленная безопасность",
        },
      },
    ],
    items: [
      {
        id: rowId,
        recipientId: person.id,
        fullNameRu: person.data.fullNameRu,
        fullNameKz: "Әділ Өмір Қанатұлы",
        positionRu: "Мастер",
        employerId: customer.id,
        assignments: [
          {
            id: assignmentId,
            templateId: "pb-card",
            protocolMode: "GROUP",
            eventId: targetEvent,
            result: "Сдал",
            outcome: {
              status: "PASSED",
              source: "Синтетическая ведомость результата",
            },
            validUntil: "2027-09-24",
          },
        ],
      },
    ],
  });
  const request = await post("/print-requests", draft(oldRule.id, eventId));
  const order = await post("/orders", {
    title: `Незавершённые основания ${suffix}`,
    customerId: customer.id,
    requestIds: [request.id],
  });
  expect((await get(`/orders/${order.id}`)).milestones).toHaveLength(3);
  const validation = await post(`/print-requests/${request.id}/validate`, {
    expectedRevision: 0,
  });
  expect(validation.issues).toEqual([]);
  await post(
    `/print-requests/${request.id}/finalize`,
    { expectedRevision: 0 },
    { "idempotency-key": randomUUID() },
  );
  const saved = await get(`/print-requests/${request.id}`);
  const oldSnapshot = JSON.stringify(saved.issuances[0].snapshot);
  const oldNumbers = saved.documents.map(
    (d: { id: string; number: string }) => ({ id: d.id, number: d.number }),
  );
  await ruleRow
    .getByRole("button", { name: "Создать следующую версию", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Состояние новой версии", exact: true }),
  ).toHaveValue("DRAFT");
  await expect(
    page.getByLabel("Дата проверки источника", { exact: true }),
  ).toHaveValue("");
  while (
    await page.getByRole("button", { name: /Удалить требование \d+/ }).count()
  )
    await page
      .getByRole("button", { name: /Удалить требование \d+/ })
      .last()
      .click();
  await page
    .getByLabel("Версия программы / документа", { exact: true })
    .fill("2");
  await page
    .getByRole("combobox", { name: "Состояние новой версии", exact: true })
    .selectOption("APPROVED");
  await page
    .getByLabel("Дата проверки источника", { exact: true })
    .fill("2026-09-24");
  await page
    .getByLabel("Источник документа / требования", { exact: true })
    .fill("Новый проверенный источник: дополнительные выходы не требуются");
  await page
    .getByRole("button", {
      name: "Сохранить запись как утверждённую версию",
      exact: true,
    })
    .click();
  const versions = (await get("/service-rules")).items.filter(
    (v: { serviceKey: string }) => v.serviceKey === serviceKey,
  );
  expect(versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
  expect(versions[0].definition.requirements).toEqual([]);
  expect(versions[1].definition).toEqual(oldRule.definition);
  const after = await get(`/print-requests/${request.id}`);
  expect(JSON.stringify(after.issuances[0].snapshot)).toBe(oldSnapshot);
  expect(
    after.documents.map((d: { id: string; number: string }) => ({
      id: d.id,
      number: d.number,
    })),
  ).toEqual(oldNumbers);
  const nextRequest = await post(
    "/print-requests",
    draft(versions[0].id, randomUUID()),
  );
  const smallOrder = await post("/orders", {
    title: `Простой заказ ${suffix}`,
    customerId: customer.id,
    requestIds: [nextRequest.id],
  });
  expect((await get(`/orders/${smallOrder.id}`)).milestones).toEqual([]);
  expect((await get(`/orders/${order.id}`)).milestones).toHaveLength(3);
  await page.goto("/workbench");
  await page.getByRole("button", { name: order.title, exact: true }).click();
  await expect(
    page
      .locator("article.milestone")
      .filter({ hasText: "Подписанная ведомость" }),
  ).toContainText("Ожидает действия");
  await page.screenshot({
    path: path.join(evidence, "explicit-missing-obligations.png"),
    fullPage: true,
  });
  await page
    .getByRole("tab", { name: "Повторные обращения", exact: true })
    .click();
  await page
    .getByText("Подготовить очередь по проверенному правилу", { exact: true })
    .click();
  await page
    .getByRole("radio", { name: new RegExp(`${title} · версия 1`) })
    .check();
  await page
    .getByLabel(
      "Проверена применимость выбранной версии правила к сохранённым документам",
    )
    .check();
  await page
    .getByRole("button", {
      name: "Подготовить обращения для проверки",
      exact: true,
    })
    .click();
  const renewalRow = page
    .getByRole("row")
    .filter({ hasText: person.data.fullNameRu });
  await expect(renewalRow).toContainText("Срок документа: 2027-09-24");
  await expect(renewalRow).toContainText(
    "Следующая проверка знаний: Не подтверждена",
  );
  await expect(renewalRow).toContainText("Обращение: 2027-08-25");
  await expect(
    page.getByRole("rowheader", { name: new RegExp(customer.nameRu) }),
  ).toBeVisible();
  await renewalRow
    .getByRole("button", { name: "Записать результат контакта", exact: true })
    .click();
  await page.getByLabel("Дата контакта", { exact: true }).fill("2026-09-24");
  await page
    .getByRole("combobox", { name: "Ответ заказчика", exact: true })
    .selectOption("DEFERRED");
  await page
    .getByLabel("Следующее обращение", { exact: true })
    .fill("2026-10-15");
  await page
    .getByLabel("Подтверждённые сведения / причина", { exact: true })
    .fill("Сотрудник в отпуске; согласован новый контакт");
  await page
    .getByRole("button", { name: "Сохранить контакт", exact: true })
    .click();
  await expect(renewalRow).toContainText("Отложено");
  await expect(renewalRow).toContainText("Обращение: 2026-10-15");
  await renewalRow.getByText("История контактов (1)", { exact: true }).click();
  await expect(renewalRow).toContainText(
    "Сотрудник в отпуске; согласован новый контакт",
  );
  await renewalRow
    .getByRole("button", { name: "Записать результат контакта", exact: true })
    .click();
  await page.getByLabel("Дата контакта", { exact: true }).fill("2026-09-24");
  await page
    .getByRole("combobox", { name: "Ответ заказчика", exact: true })
    .selectOption("IRRELEVANT");
  await page
    .getByLabel("Подтверждённые сведения / причина", { exact: true })
    .fill("Работодатель подтвердил увольнение");
  await page
    .getByRole("button", { name: "Сохранить контакт", exact: true })
    .click();
  await expect(renewalRow).toHaveCount(0);
  await page
    .getByLabel("Показывать завершённые и неактуальные потребности", {
      exact: true,
    })
    .check();
  await expect(renewalRow).toContainText("Неактуально");
  await expect(renewalRow).toContainText("Работодатель подтвердил увольнение");
  await page
    .getByRole("button", {
      name: "Подготовить обращения для проверки",
      exact: true,
    })
    .click();
  const needs = (await get("/renewals")).items.filter(
    (v: { sourceRequestId: string }) => v.sourceRequestId === request.id,
  );
  expect(needs).toHaveLength(1);
  expect(needs[0].state).toBe("IRRELEVANT");
  expect(needs[0].contacts).toHaveLength(2);
  await page.screenshot({
    path: path.join(evidence, "renewal-date-provenance-history.png"),
    fullPage: true,
  });
  await fs.writeFile(
    path.join(evidence, "passport-renewal-summary.json"),
    JSON.stringify(
      {
        status: "PASS",
        realApi: true,
        ruleId: oldRule.id,
        version2Id: versions[0].id,
        issuedRequestId: request.id,
        issuedSnapshotUnchanged: true,
        numberHistoryUnchanged: true,
        optionalRequirementsRemovedOnlyInNewVersion: true,
        templateVersionsFieldsAndExportsDisplayed: true,
        oldOrderMilestonesPreserved: true,
        threeDatesSeparated: true,
        policyScanUi: true,
        unknownNextCheckNotInvented: true,
        companyGrouping: true,
        contactHistory: 2,
        closedNeedNotReopenedByRepeatScan: true,
      },
      null,
      2,
    ),
  );
});

test("live external evidence state distinctions and private qualified dossier exclusion", async ({
  page,
  context,
}) => {
  test.setTimeout(180000);
  const { post, get, library } = await start(page, context);
  const suffix = Date.now(),
    title = `Матрица статусов ${suffix}`;
  const customer = await post("/customers", {
    nameRu: `Компания матрицы ${suffix}`,
  });
  const rule = await post("/service-rules", {
    serviceKey: `matrix_${suffix}`,
    title,
    status: "APPROVED",
    source: "Синтетический подтверждённый профиль направлений",
    applicability: "Только заказчик проверки",
    checkedOn: "2026-09-24",
    definition: {
      programVersion: "1",
      category: "",
      compatibleTemplateIds: ["pb-card", "pb-protocol"],
      requirements: [],
      limitation: "Не устанавливает допуск к работе",
    },
  });
  const date = (offset: number) =>
    new Date(Date.now() + 5 * 3600_000 + offset * 86400_000)
      .toISOString()
      .slice(0, 10);
  const people = [];
  for (const state of [
    "UNKNOWN",
    "UNVERIFIED",
    "APPROACHING",
    "VERIFIED_NO_EXPIRY",
    "VERIFIED",
    "SUPERSEDED",
  ]) {
    const person = await post("/recipients", {
      id: randomUUID(),
      fullNameRu: `${state} ${suffix}`,
      employerId: customer.id,
      assignments: [],
    });
    people.push({ state, id: person.id, name: person.data.fullNameRu });
    if (state !== "UNKNOWN")
      await post("/evidence", {
        customerId: customer.id,
        recipientId: person.id,
        program: title,
        issuer: "Фактический синтетический поставщик",
        originalNumber: `EXT-${state}-${suffix}`,
        documentDate: date(-10),
        validUntil:
          state === "VERIFIED_NO_EXPIRY"
            ? null
            : date(state === "APPROACHING" ? 10 : 100),
        source: "Синтетический исходник для ручной проверки",
      });
  }
  await library("Внешние документы");
  for (const person of people.filter(
    (v) => !["UNKNOWN", "UNVERIFIED"].includes(v.state),
  )) {
    const row = page
      .getByRole("row")
      .filter({ hasText: `EXT-${person.state}-${suffix}` });
    await row
      .getByRole("combobox", { name: "Результат проверки", exact: true })
      .selectOption(person.state === "SUPERSEDED" ? "SUPERSEDED" : "VERIFIED");
    await row
      .getByLabel("Основание проверки", { exact: true })
      .fill(
        `Ручное решение ${person.state}; синтетический источник просмотрен`,
      );
    await row
      .getByRole("button", {
        name:
          person.state === "SUPERSEDED"
            ? "Сохранить состояние источника"
            : "Подтвердить проверку",
        exact: true,
      })
      .click();
    await expect(row).toContainText(`Ручное решение ${person.state}`);
    await expect(row).toContainText("Администратор");
    await expect(
      row.getByLabel("Основание проверки", { exact: true }),
    ).toHaveValue("");
  }
  await page
    .getByText("Матрица сведений: люди и программы", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Выбрать заказчика для матрицы", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Поиск по справочнику")
    .fill(customer.nameRu);
  await page
    .getByRole("dialog")
    .getByRole("row")
    .filter({ hasText: customer.nameRu })
    .getByRole("button", { name: "Выбрать", exact: true })
    .click();
  await page.getByRole("checkbox", { name: new RegExp(title) }).check();
  await page
    .getByRole("button", { name: "Показать матрицу", exact: true })
    .click();
  const labels: Record<string, string> = {
    UNKNOWN: "Сведений нет",
    UNVERIFIED: "Источник не проверен",
    APPROACHING: "Срок приближается",
    VERIFIED_NO_EXPIRY: "Источник проверен, срок не указан",
    VERIFIED: "Источник проверен",
    SUPERSEDED: "Документ заменён",
  };
  for (const person of people)
    await expect(
      page.getByRole("row").filter({
        has: page.getByRole("cell", { name: person.name, exact: true }),
      }),
    ).toContainText(labels[person.state]);
  await expect(
    page.getByText(
      /Срок документа не равен дате следующей проверки знаний и не устанавливает допуск к работе/,
    ),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(evidence, "six-distinct-matrix-states.png"),
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Досье центра", exact: true }).click();
  const categories = [
    {
      category: "PROGRAM",
      title: `Разрешённая программа ${suffix}`,
      visible: true,
    },
    {
      category: "QUALIFICATION",
      title: `Личная квалификация ${suffix}`,
      visible: false,
    },
  ];
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 80;
    const c = canvas.getContext("2d")!;
    c.fillStyle = "white";
    c.fillRect(0, 0, 240, 80);
    c.fillStyle = "black";
    c.fillText("SYNTHETIC SOURCE", 15, 30);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  for (const record of categories) {
    await page
      .getByRole("button", {
        name: "Добавить запись с источником",
        exact: true,
      })
      .click();
    for (const [label, value] of [
      ["Название", record.title],
      ["Источник документа / требования", "Синтетический источник досье"],
      ["Версия программы / документа", "1"],
      ["Применимость", "Локальная проверка"],
      ["Контрольный срок", date(5)],
    ])
      await page.getByLabel(label, { exact: true }).fill(value);
    await page
      .getByRole("combobox", { name: "Категория", exact: true })
      .selectOption(record.category);
    const visible = page.getByLabel(
      "Разрешить включение в комплект заказчика",
      { exact: true },
    );
    if (record.visible) await visible.check();
    else await expect(visible).toBeDisabled();
    await page
      .getByRole("button", { name: "Сохранить запись", exact: true })
      .click();
    const row = page.getByRole("row").filter({ hasText: record.title });
    await expect(row).toContainText("Ответственный: Администратор");
    await row.getByText("Файлы источника (0)", { exact: true }).click();
    await row
      .getByLabel("Источник вложения", { exact: true })
      .fill("Подтверждённая синтетическая копия");
    await row
      .getByLabel("PDF, PNG или JPEG до 1 МБ", { exact: true })
      .setInputFiles({
        name: `${record.category}.png`,
        mimeType: "image/png",
        buffer: Buffer.from(png, "base64"),
      });
    if (record.visible)
      await row
        .getByLabel("Разрешить это вложение в выбранном пакете заказчика", {
          exact: true,
        })
        .check();
    else
      await expect(
        row.getByLabel("Разрешить это вложение в выбранном пакете заказчика", {
          exact: true,
        }),
      ).toHaveCount(0);
    await row
      .getByRole("button", { name: "Сохранить файл источника", exact: true })
      .click();
    await expect(
      row.getByText("Файлы источника (1)", { exact: true }),
    ).toBeVisible();
  }
  await page
    .getByText("Выбранное досье для заказчика и контроль сроков", {
      exact: true,
    })
    .click();
  await page.getByLabel(categories[0].title, { exact: true }).check();
  await expect(
    page.getByLabel(categories[1].title, { exact: true }),
  ).toHaveCount(0);
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Скачать выбранное досье ZIP", exact: true })
    .click();
  const file = path.join(evidence, "public-dossier-only.zip");
  await (await downloaded).saveAs(file);
  const files = zipEntries(await fs.readFile(file));
  expect(Object.keys(files).some((v) => v.endsWith("PROGRAM.png"))).toBe(true);
  expect(Object.keys(files).some((v) => v.includes("QUALIFICATION"))).toBe(
    false,
  );
  const inventory = Object.entries(files)
    .find(([name]) => name.endsWith("Состав досье.json"))![1]
    .toString();
  expect(inventory).toContain(categories[0].title);
  expect(inventory).not.toContain(categories[1].title);
  const actual = Object.entries(files).find(([name]) =>
    name.endsWith("PROGRAM.png"),
  )![1];
  expect(createHash("sha256").update(actual).digest("hex")).toBe(
    createHash("sha256").update(Buffer.from(png, "base64")).digest("hex"),
  );
  await page.getByLabel("Дата проверки сроков", { exact: true }).fill(date(0));
  await page
    .getByRole("button", {
      name: "Показать сроки на ближайшие 30 дней",
      exact: true,
    })
    .click();
  await expect(
    page.getByText(
      /Не является выводом о прекращении полномочий или государственной аккредитации/,
    ),
  ).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: path.join(evidence, "dossier-private-boundary-mobile.png"),
    fullPage: true,
  });
  const actualMatrix = await post("/evidence/matrix", {
    customerId: customer.id,
    ruleVersionIds: [rule.id],
  });
  expect(
    actualMatrix.rows
      .map((r: { cells: { state: string }[] }) => r.cells[0].state)
      .sort(),
  ).toEqual(Object.keys(labels).sort());
  const records = (await get("/dossier")).items.filter((v: { title: string }) =>
    categories.some((c) => c.title === v.title),
  );
  expect(
    records.every(
      (r: { ownerName: string }) => r.ownerName === "Администратор",
    ),
  ).toBe(true);
  await fs.writeFile(
    path.join(evidence, "matrix-dossier-summary.json"),
    JSON.stringify(
      {
        status: "PASS",
        realApi: true,
        ruleId: rule.id,
        customerId: customer.id,
        sixStates: Object.keys(labels),
        reviewActorDateReasonDisplayed: true,
        qualificationVisibilityDisabled: true,
        selectedPackageExcludesPrivateSource: true,
        downloadedBytesUnchanged: true,
        reminderNotLegalConclusion: true,
        mobile375NoOverflow: true,
      },
      null,
      2,
    ),
  );
});

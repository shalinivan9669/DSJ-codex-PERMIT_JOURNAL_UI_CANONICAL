import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    "../../docs/evidence/final-completion/service",
);
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
test.beforeAll(() => {
  const product = path.resolve("../..");
  execFileSync(
    process.execPath,
    [
      path.join(product, "node_modules/tsx/dist/cli.mjs"),
      "--tsconfig",
      path.join(product, "tsconfig.base.json"),
      path.join(product, "scripts/verification/provision-final-service-ui.ts"),
    ],
    { cwd: product, env: process.env, windowsHide: true, stdio: "pipe" },
  );
});
test.beforeEach(async ({ context }) => {
  // Source edits in another task must not reload the real UI midway through a test.
  // Only the development hot-reload socket is closed; business HTTP is untouched.
  await context.routeWebSocket("**/_next/webpack-hmr", (socket) =>
    socket.close(),
  );
});
async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Электронная почта", { exact: true }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
}
test("real service UI: evidence, ownership, exact payment, portal changes and confirmed clean renewal", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(300000);
  await fs.mkdir(evidence, { recursive: true });
  const auth = JSON.parse(
    await fs.readFile(
      path.resolve("../../.runtime/final-service-ui-auth.json"),
      "utf8",
    ),
  );
  await login(page, auth.email, auth.password);
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
    const response = await page.request.post(`/api${endpoint}`, {
      headers: { ...headers, ...extra },
      data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const get = async (endpoint: string) => {
    const r = await page.request.get(`/api${endpoint}`);
    expect(r.ok(), await r.text()).toBe(true);
    return r.json();
  };
  const suffix = Date.now();
  const customer = await post("/customers", {
    nameRu: `Заказчик полного цикла ${suffix}`,
  });
  const person = await post("/recipients", {
    id: randomUUID(),
    fullNameRu: `Синтетический Получатель ${suffix}`,
    fullNameKz: "Әділбек Өмірсерік Қанатұлы",
    positionRu: "Инженер",
    employerId: customer.id,
    assignments: [],
  });
  const eventId = randomUUID(),
    rowId = randomUUID(),
    assignmentId = randomUUID();
  const request = await post("/print-requests", {
    schemaVersion: 2,
    kind: "COMPANY",
    customerId: customer.id,
    title: `Состав заказчика ${suffix}`,
    demoMode: true,
    events: [
      {
        id: eventId,
        title: "Событие с внешним основанием",
        protocolTemplateId: "pb-protocol",
        commonFields: {
          documentDate: "2026-09-24",
          protocolDate: "2026-09-24",
          trainingStart: "2026-09-23",
          trainingEnd: "2026-09-24",
          trainingSubject: "Синтетическая программа",
        },
      },
    ],
    items: [
      {
        id: rowId,
        recipientId: person.id,
        employerId: customer.id,
        fullNameRu: person.data.fullNameRu,
        fullNameKz: "Әділбек Өмірсерік Қанатұлы",
        positionRu: "Инженер",
        assignments: [
          {
            id: assignmentId,
            templateId: "pb-card",
            eventId,
            protocolMode: "GROUP",
            outcome: { status: "FAILED", source: "Синтетическая ведомость" },
          },
        ],
      },
    ],
  });
  const order = await post("/orders", {
    title: `Проверка полного исполнения ${suffix}`,
    customerId: customer.id,
    requestIds: [request.id],
  });
  const colleague = await post("/users", {
    email: `colleague-${suffix}@example.test`,
    password: `Synthetic-${randomUUID()}!`,
    displayName: "Коллега для передачи",
    role: "OPERATOR",
  });
  const milestone = await post(`/orders/${order.id}/milestones`, {
    label: "Подтвердить передачу",
    category: "TRANSFER",
    source: "CONTRACT",
    sourceReference: "Синтетический договор",
  });
  await page.goto("/workbench");
  await expect(
    page.getByRole("heading", { name: "Работа центра", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: order.title, exact: true }).click();
  await page
    .getByText("Ответственный, срок и завершение заказа", { exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Ответственный", exact: true })
    .selectOption(colleague.id);
  await page
    .getByLabel("Согласованный срок", { exact: true })
    .fill("2026-10-05");
  await page
    .getByLabel("Контакт / передача работы", { exact: true })
    .fill("Передано коллеге, синтетическая проверка");
  await page
    .getByRole("button", {
      name: "Сохранить ответственность и срок",
      exact: true,
    })
    .click();
  await expect
    .poll(async () => (await get(`/orders/${order.id}`)).ownerId)
    .toBe(colleague.id);
  await page
    .getByLabel("Основание завершения / отмены", { exact: true })
    .fill("Попытка закрыть до передачи");
  await page
    .getByRole("button", { name: "Завершить исполнение заказа", exact: true })
    .click();
  await expect
    .poll(async () => (await get(`/orders/${order.id}`)).status)
    .not.toBe("COMPLETED");
  await expect(page.getByText(/обязательств/i).last()).toBeVisible();
  await page
    .getByText("Расчёты и финансовые основания", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Добавить согласованную услугу", exact: true })
    .click();
  await page
    .getByLabel("Услуга 1", { exact: true })
    .fill("Согласованное обучение");
  await page.getByLabel("Количество услуги 1", { exact: true }).fill("3");
  await page.getByLabel("Цена услуги 1", { exact: true }).fill("10000,00");
  await page
    .getByRole("button", {
      name: "Сохранить согласованный расчёт",
      exact: true,
    })
    .click();
  await expect(
    page.getByText(
      /Стоимость услуг до налога: 30000,00 KZT · Налог: требует уточнения/,
    ),
  ).toBeVisible();
  let unconfigured = (await get(`/orders/${order.id}`)).commercial;
  expect(unconfigured.subtotalMinor).toBe("3000000");
  expect(unconfigured.totalMinor).toBeNull();
  await page.getByLabel("Количество услуги 1", { exact: true }).fill("2");
  await page
    .getByRole("button", {
      name: "Сохранить согласованный расчёт",
      exact: true,
    })
    .click();
  await expect(
    page.getByText(
      /Стоимость услуг до налога: 20000,00 KZT · Налог: требует уточнения/,
    ),
  ).toBeVisible();
  unconfigured = (await get(`/orders/${order.id}`)).commercial;
  expect(unconfigured.subtotalMinor).toBe("2000000");
  expect(unconfigured.taxRateBasisPoints).toBeNull();
  await page.getByLabel("Количество услуги 1", { exact: true }).fill("3");
  await page.getByLabel("Цена услуги 1", { exact: true }).fill("12345,67");
  await page
    .getByRole("combobox", { name: "Налоговая ставка", exact: true })
    .selectOption("0");
  await page
    .getByLabel("Основание налогового расчёта", { exact: true })
    .fill("Синтетические условия, явно 0%");
  await page
    .getByRole("button", {
      name: "Сохранить согласованный расчёт",
      exact: true,
    })
    .click();
  await expect(page.getByText(/Согласовано: 37037,01 KZT/)).toBeVisible();
  await page
    .getByText("Реквизиты договора, счёта или акта", { exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Вид документа", exact: true })
    .selectOption("INVOICE");
  await page.getByLabel("Номер", { exact: true }).fill(`TEST-000012-${suffix}`);
  await page.getByLabel("Дата", { exact: true }).fill("2026-09-24");
  await page
    .getByLabel("Источник / реквизиты", { exact: true })
    .fill("Синтетический счёт");
  await page
    .getByRole("button", { name: "Сохранить реквизиты", exact: true })
    .click();
  await expect
    .poll(
      async () => (await get(`/orders/${order.id}`)).financialDocuments.length,
    )
    .toBe(1);
  await page
    .getByRole("button", { name: "Сохранить реквизиты", exact: true })
    .click();
  await expect(
    page.getByText(/Документ такого вида с этим номером уже сохранён/),
  ).toBeVisible();
  expect((await get(`/orders/${order.id}`)).financialDocuments.length).toBe(1);
  await page
    .getByText("Зафиксировать подтверждённый платёж", { exact: true })
    .click();
  await page.getByLabel("Сумма, KZT", { exact: true }).fill("10000,01");
  await page.getByLabel("Дата платежа", { exact: true }).fill("2026-09-24");
  await page
    .getByLabel("Источник подтверждения платежа", { exact: true })
    .fill("Синтетическая выписка TEST-PAY-1");
  await page
    .getByRole("button", { name: "Зафиксировать платёж", exact: true })
    .click();
  await expect(page.getByText(/Оплачено: 10000,01 KZT/)).toBeVisible();
  await page
    .getByText("Дело заказа и сохранённые основания", { exact: true })
    .click();
  await page
    .getByRole("combobox", {
      name: "К какому событию относится основание",
      exact: true,
    })
    .selectOption(eventId);
  await page
    .getByLabel("Источник и назначение", { exact: true })
    .fill("Синтетическая подписанная ведомость");
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAABgAAAAQCAIAAACDRijCAAAAI0lEQVR4nGPUzlzHQA3ARBVTGEYNIgaMBjZhMBpGhMHgCyMACAMBYhOlUtgAAAAASUVORK5CYII=",
    "base64",
  );
  await page
    .getByLabel("Файл PDF, PNG или JPEG", { exact: true })
    .setInputFiles({
      name: "synthetic-evidence.png",
      mimeType: "image/png",
      buffer: bytes,
    });
  await page
    .getByRole("button", { name: "Сохранить основание", exact: true })
    .click();
  await expect(
    page.getByText(
      "Основание сохранено отдельно от оригиналов выданных документов.",
      { exact: true },
    ),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "synthetic-evidence.png", exact: true })
    .click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(hash(await fs.readFile(downloadPath!))).toBe(hash(bytes));
  await page.reload();
  await page.getByRole("button", { name: order.title, exact: true }).click();
  const persisted = await get(`/orders/${order.id}`);
  expect(persisted.commercial.totalMinor).toBe("3703701");
  expect(persisted.commercial.paidMinor).toBe("1000001");
  expect(persisted.attachments[0].eventId).toBe(eventId);
  await page
    .getByLabel("Подтверждение выполнения", { exact: true })
    .fill("Синтетическая передача подтверждена");
  await page
    .getByRole("button", { name: "Зафиксировать выполнение", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await get(`/orders/${order.id}`)).milestones.find(
          (m: { id: string }) => m.id === milestone.id,
        ).status,
    )
    .toBe("DONE");

  const employerEmail = `service-employer-${suffix}@example.test`,
    employerPassword = `Synthetic-${randomUUID()}!`;
  const employerUser = await post("/users", {
    email: employerEmail,
    password: employerPassword,
    displayName: "Представитель",
    role: "EMPLOYER",
  });
  await post("/employer-memberships", {
    customerId: customer.id,
    userId: employerUser.id,
    permissions: ["READ", "PROPOSE", "APPROVE_DATA", "DOWNLOAD"],
    recipientIds: [person.id],
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  const ec = await browser.newContext({ baseURL: process.env.DEMO_ORIGIN });
  await ec.routeWebSocket("**/_next/webpack-hmr", (socket) => socket.close());
  try {
    const employer = await ec.newPage();
    await login(employer, employerEmail, employerPassword);
    await expect(
      employer.getByRole("heading", { name: "Кабинет заказчика" }),
    ).toBeVisible();
    await employer
      .getByRole("button", { name: new RegExp(request.title) })
      .click();
    await employer
      .getByLabel("Должность RU, получатель 1", { exact: true })
      .fill("Старший инженер");
    await employer
      .getByLabel("Сообщение учебному центру", { exact: true })
      .fill("Синтетическое согласование должности");
    await employer
      .getByRole("button", {
        name: "Отправить изменения на проверку",
        exact: true,
      })
      .click();
    await expect(
      employer.getByText(
        "Ответ передан учебному центру. Статус рассмотрения появится в истории обращения.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(
      (await get(`/print-requests/${request.id}`)).items[0].positionRu,
    ).toBe("Инженер");
    await page.reload();
    await page.getByRole("button", { name: order.title, exact: true }).click();
    await page
      .getByLabel("Решение центра и основание", { exact: true })
      .fill("Проверено синтетическое согласование");
    await page
      .getByRole("button", {
        name: "Принять и применить согласованные изменения",
        exact: true,
      })
      .click();
    await expect
      .poll(
        async () =>
          (await get(`/print-requests/${request.id}`)).items[0].positionRu,
      )
      .toBe("Старший инженер");
    await employer.reload();
    await employer
      .getByText("Ответы и рассмотрение (1)", { exact: true })
      .click();
    await expect(
      employer.getByText(/Принято: Проверено синтетическое согласование/),
    ).toBeVisible();
    await employer.screenshot({
      path: path.join(evidence, "employer-reviewed.png"),
      fullPage: true,
    });
  } finally {
    await ec.close();
  }
  const revision = (await get(`/print-requests/${request.id}`)).revision;
  await post(
    `/print-requests/${request.id}/finalize`,
    { expectedRevision: revision },
    { "Idempotency-Key": randomUUID() },
  );
  const frozen = await get(`/print-requests/${request.id}`);
  const need = await post("/renewals", {
    customerId: customer.id,
    recipientId: person.id,
    sourceRequestId: request.id,
    sourceRowId: rowId,
    assignmentId,
    policySource: "Синтетическое согласование повторной попытки",
    policyVersion: "TEST-1",
    basisDate: "2026-09-24",
    contactAfter: "2026-09-24",
    confirmed: false,
  });
  await page.reload();
  await page
    .getByRole("tab", { name: "Повторные обращения", exact: true })
    .click();
  const renewalRow = page
    .getByRole("row")
    .filter({ hasText: person.data.fullNameRu });
  await expect(
    renewalRow.getByRole("button", {
      name: "Создать повторную заявку",
      exact: true,
    }),
  ).toHaveCount(0);
  await renewalRow
    .getByRole("button", { name: "Записать результат контакта", exact: true })
    .click();
  await page.getByLabel("Дата контакта", { exact: true }).fill("2026-09-24");
  await page
    .getByRole("combobox", { name: "Ответ заказчика", exact: true })
    .selectOption("CONFIRMED");
  await page
    .getByLabel("Подтверждённые сведения / причина", { exact: true })
    .fill(
      "Синтетически подтверждена актуальность человека и повторная попытка",
    );
  await page
    .getByRole("button", { name: "Сохранить контакт", exact: true })
    .click();
  await expect(renewalRow).toContainText("Подтверждено");
  await renewalRow
    .getByRole("button", { name: "Создать повторную заявку", exact: true })
    .click();
  await expect(page).toHaveURL(/\/requests\//);
  const repeatId = new URL(page.url()).pathname.split("/").pop()!;
  const repeat = await get(`/print-requests/${repeatId}`);
  expect(repeat.items[0].recipientId).toBe(person.id);
  expect(repeat.items[0].positionRu).toBe("Старший инженер");
  expect(repeat.items[0].assignments[0].outcome?.status ?? "UNKNOWN").toBe(
    "UNKNOWN",
  );
  expect(repeat.items[0].assignments[0].result).toBe("");
  expect(repeat.items[0].assignments[0].documentDate).toBe("");
  expect(repeat.items[0].assignments[0].trainingStart).toBe("");
  expect(
    (await get(`/print-requests/${request.id}`)).issuances[0].snapshot,
  ).toEqual(frozen.issuances[0].snapshot);
  await page.screenshot({
    path: path.join(evidence, "confirmed-clean-repeat.png"),
    fullPage: true,
  });
  await page.goto(`/requests/${request.id}`);
  await page
    .getByText("Ссылка и QR для проверки записи", { exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Выданный документ", exact: true })
    .selectOption({ index: 1 });
  await page
    .getByLabel("Разрешаю публичную проверку выбранной записи эмитента", {
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Создать ссылку и QR", exact: true })
    .click();
  const publicLink = page.getByRole("link", {
    name: "Открыть публичную проверку",
    exact: true,
  });
  await expect(publicLink).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: "QR для проверки записи эмитента",
      exact: true,
    }),
  ).toBeVisible();
  const publicPath = await publicLink.getAttribute("href");
  const publicContext = await browser.newContext({
    baseURL: process.env.DEMO_ORIGIN,
  });
  await publicContext.routeWebSocket("**/_next/webpack-hmr", (socket) =>
    socket.close(),
  );
  try {
    const publicPage = await publicContext.newPage();
    await publicPage.goto(publicPath!);
    await expect(
      publicPage.getByText("Действующая запись", { exact: true }),
    ).toBeVisible();
    await expect(
      publicPage.getByText(person.data.fullNameRu, { exact: false }),
    ).toHaveCount(0);
    await expect(
      publicPage.getByRole("link", { name: /скачать/i }),
    ).toHaveCount(0);
    await publicPage
      .getByText("Сообщить об ошибке в документе", { exact: true })
      .click();
    await publicPage
      .getByLabel("Что требуется проверить", { exact: true })
      .fill("Синтетическая проверка маршрута уточнения");
    await publicPage
      .getByRole("button", { name: "Передать обращение эмитенту", exact: true })
      .click();
    await expect(
      publicPage.getByText("Обращение принято для проверки эмитентом.", {
        exact: true,
      }),
    ).toBeVisible();
    await publicPage.screenshot({
      path: path.join(evidence, "public-minimal-record.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Отозвать публичную ссылку", exact: true })
      .click();
    await expect(
      page.getByText("Ссылка отозвана. Публичная проверка по ней недоступна.", {
        exact: true,
      }),
    ).toBeVisible();
    await publicPage.reload();
    await expect(
      publicPage.getByText(
        "Запись недоступна. Проверьте ссылку или обратитесь к эмитенту документа.",
        { exact: true },
      ),
    ).toBeVisible();
  } finally {
    await publicContext.close();
  }
  await page.goto("/workbench");
  await page.getByRole("button", { name: order.title, exact: true }).click();
  await page
    .getByText("Ответственный, срок и завершение заказа", { exact: true })
    .click();
  await page
    .getByLabel("Основание завершения / отмены", { exact: true })
    .fill("Синтетический заказ передан: обязательства и обращения рассмотрены");
  await page
    .getByRole("button", { name: "Завершить исполнение заказа", exact: true })
    .click();
  await expect
    .poll(async () => (await get(`/orders/${order.id}`)).status)
    .toBe("COMPLETED");
  await page.reload();
  await page.getByRole("button", { name: order.title, exact: true }).click();
  await expect(
    page.getByText("Исполнение завершено", { exact: true }),
  ).toBeVisible();
  await fs.writeFile(
    path.join(evidence, "service-ui-verification.json"),
    JSON.stringify(
      {
        status: "PASS",
        tenantId: auth.tenantId,
        requestId: request.id,
        orderId: order.id,
        renewalId: need.id,
        repeatId,
        realBrowser: true,
        mockedResponses: false,
        checks: [
          "ownership and date persisted",
          "unfinished obligation blocks completion",
          "KZT exact invoice/payment persisted",
          "event-specific attachment downloaded byte-identically",
          "employer proposal does not mutate source until center accepts",
          "center decision visible to employer after reload",
          "unconfirmed renewal has no repeat action",
          "confirmed contact creates clean linked draft",
          "historical snapshot unchanged",
          "public QR record has no person or file access, correction accepted and link revoked",
          "duplicate invoice returns actionable conflict without another record",
          "three then two services calculate 30000 then 20000 KZT while unknown tax remains unknown",
          "order completes only after actual prerequisites and persists after reload",
        ],
      },
      null,
      2,
    ),
  );
});

test("one shared group serves two customer orders and an existing order accepts another date without copying history", async ({
  page,
  context,
}) => {
  test.setTimeout(180000);
  const auth = JSON.parse(
    await fs.readFile(
      path.resolve("../../.runtime/final-service-ui-auth.json"),
      "utf8",
    ),
  );
  await login(page, auth.email, auth.password);
  await expect(
    page.getByRole("heading", { name: "Заявки на печать" }),
  ).toBeVisible();
  const csrf = (await context.cookies()).find(
    (c) => c.name === "demo_csrf",
  )!.value;
  const post = async (
    endpoint: string,
    data: unknown,
    extra: Record<string, string> = {},
  ) => {
    const response = await page.request.post(`/api${endpoint}`, {
      headers: {
        origin: process.env.DEMO_ORIGIN!,
        "x-csrf-token": csrf,
        ...extra,
      },
      data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const get = async (endpoint: string) => {
    const response = await page.request.get(`/api${endpoint}`);
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const suffix = Date.now();
  const a = await post("/customers", { nameRu: `Заказчик групп А ${suffix}` }),
    b = await post("/customers", { nameRu: `Заказчик групп Б ${suffix}` });
  const people = await Promise.all(
    [a, b].map((customer, index) =>
      post("/recipients", {
        id: randomUUID(),
        employerId: customer.id,
        fullNameRu: `Синтетический участник ${index + 1} ${suffix}`,
        assignments: [],
      }),
    ),
  );
  async function fixture(title: string, mixed: boolean, day: string) {
    const event = randomUUID();
    return post("/print-requests", {
      schemaVersion: 2,
      kind: "COMPANY",
      title,
      demoMode: true,
      customerId: a.id,
      events: [
        {
          id: event,
          title,
          protocolTemplateId: "pb-protocol",
          commonFields: {
            documentDate: day,
            protocolDate: day,
            trainingStart: day,
            trainingEnd: day,
            trainingSubject: "Синтетическое событие",
          },
        },
      ],
      items: people.slice(0, mixed ? 2 : 1).map((person, index) => ({
        id: randomUUID(),
        recipientId: person.id,
        employerId: index ? b.id : a.id,
        fullNameRu: person.data.fullNameRu,
        positionRu: "Инженер",
        assignments: [
          {
            id: randomUUID(),
            templateId: "pb-card",
            eventId: event,
            protocolMode: "GROUP",
            outcome: { status: "FAILED", source: "Синтетическая ведомость" },
          },
        ],
      })),
    });
  }
  const shared = await fixture(`Общая группа ${suffix}`, true, "2026-09-24");
  const second = await fixture(`Другая дата ${suffix}`, false, "2026-10-05");
  await post(
    `/print-requests/${shared.id}/finalize`,
    { expectedRevision: shared.revision },
    { "Idempotency-Key": randomUUID() },
  );
  const frozen = await get(`/print-requests/${shared.id}`);
  await page.goto(`/requests/${shared.id}`);
  await page
    .getByRole("button", { name: "Открыть действия", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Создать связанный заказ", exact: true })
    .click();
  await expect(
    page.getByText("Создан заказ со связанной заявкой.", { exact: false }),
  ).toBeVisible();
  const orderA = (await get("/orders")).items.find(
    (order: { title: string }) => order.title === shared.title,
  );
  await page
    .getByText("Связать группу с заказом или другим работодателем", {
      exact: true,
    })
    .click();
  await page
    .getByText("Создать отдельный заказ работодателя из этой группы", {
      exact: true,
    })
    .click();
  const titleB = `Отдельный заказ Б ${suffix}`;
  await page
    .getByLabel("Название отдельного заказа", { exact: true })
    .fill(titleB);
  await page
    .getByRole("button", {
      name: "Выбрать работодателя для заказа",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Поиск по справочнику", { exact: true })
    .fill(b.nameRu);
  await dialog
    .getByRole("row")
    .filter({ hasText: b.nameRu })
    .getByRole("button", { name: "Выбрать", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Создать заказ работодателя", exact: true })
    .click();
  await expect(
    page.getByText(
      "Создан заказ выбранного работодателя, связанный с этой группой.",
      { exact: false },
    ),
  ).toBeVisible();
  const orderB = (await get("/orders")).items.find(
    (order: { title: string }) => order.title === titleB,
  );
  expect(orderB.customerId).toBe(b.id);
  expect(orderB.requests[0].requestId).toBe(shared.id);
  expect(orderB.requests[0].itemCount).toBe(1);
  await page.goto("/workbench");
  await page.getByRole("button", { name: orderA.title, exact: true }).click();
  await page.getByText("Группы и заявки заказа", { exact: true }).click();
  await page
    .getByLabel("Найти заявку для связи", { exact: true })
    .fill(second.title);
  await page
    .getByRole("row")
    .filter({ hasText: second.title })
    .getByRole("button", { name: "Выбрать заявку", exact: true })
    .click();
  await page
    .getByLabel("Подтверждаю связь группы с этим заказом", { exact: true })
    .check();
  await page
    .getByRole("button", { name: "Связать выбранную заявку", exact: true })
    .click();
  await expect(
    page.getByText(
      "Заявка связана с заказом. Люди, события и выданные файлы не копировались.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect
    .poll(async () => (await get(`/orders/${orderA.id}`)).requests.length)
    .toBe(2);
  await page.goto(`/requests/${second.id}`);
  await page
    .getByRole("button", { name: "Открыть действия", exact: true })
    .click();
  await page
    .getByText("Связать группу с заказом или другим работодателем", {
      exact: true,
    })
    .click();
  await page
    .getByLabel("Поиск существующего заказа", { exact: true })
    .fill(orderA.title);
  await page
    .getByRole("combobox", { name: "Существующий заказ", exact: true })
    .selectOption(orderA.id);
  await page
    .getByLabel("Подтверждаю добавление этой группы в выбранный заказ", {
      exact: true,
    })
    .check();
  await page
    .getByRole("button", {
      name: "Добавить группу в существующий заказ",
      exact: true,
    })
    .click();
  await expect(
    page.getByText(
      "Группа связана с существующим заказом без копирования заявки.",
      { exact: false },
    ),
  ).toBeVisible();
  expect((await get(`/orders/${orderA.id}`)).requests.length).toBe(2);
  expect(
    (await get(`/print-requests/${shared.id}`)).issuances[0].snapshot,
  ).toEqual(frozen.issuances[0].snapshot);
  await page.reload();
  await page
    .getByRole("button", { name: "Открыть действия", exact: true })
    .click();
  await page
    .getByText("Связать группу с заказом или другим работодателем", {
      exact: true,
    })
    .click();
  await page
    .getByLabel("Поиск существующего заказа", { exact: true })
    .fill(orderB.title);
  await page
    .getByRole("combobox", { name: "Существующий заказ", exact: true })
    .selectOption(orderB.id);
  await page
    .getByLabel("Подтверждаю добавление этой группы в выбранный заказ", {
      exact: true,
    })
    .check();
  await page
    .getByRole("button", {
      name: "Добавить группу в существующий заказ",
      exact: true,
    })
    .click();
  await expect(
    page.getByText(/В заявке нет участников выбранного заказчика/),
  ).toBeVisible();
  expect((await get(`/orders/${orderB.id}`)).requests.length).toBe(1);
  await page.screenshot({
    path: path.join(evidence, "order-link-customer-boundary.png"),
    fullPage: true,
  });
  await fs.writeFile(
    path.join(evidence, "order-links-result.json"),
    JSON.stringify(
      {
        status: "PASS",
        tenantId: auth.tenantId,
        orderA: orderA.id,
        orderB: orderB.id,
        sharedRequestId: shared.id,
        secondRequestId: second.id,
        checks: [
          "same issued group linked to A and B without copy",
          "B order counts own participant only",
          "A linked second group/date through UI",
          "replay does not duplicate links",
          "wrong-customer group denied",
          "issued snapshot unchanged",
        ],
      },
      null,
      2,
    ),
  );
});

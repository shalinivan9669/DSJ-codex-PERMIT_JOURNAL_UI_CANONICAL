import { createRequestWithWorkerDocument } from "./operator-keyboard-helpers";
import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const product = path.resolve(__dirname, "../../..");
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    path.join(product, "docs/evidence/final-completion/renewal-onboarding"),
);
function fixture(mode: string, key?: string, id?: string) {
  const output = execFileSync(
    process.execPath,
    [
      path.join(product, "node_modules/tsx/dist/cli.mjs"),
      "--tsconfig",
      path.join(product, "tsconfig.base.json"),
      path.join(
        product,
        "scripts/verification/final-renewal-onboarding-fixture.ts",
      ),
      mode,
      ...(key ? [key] : []),
      ...(id ? [id] : []),
    ],
    {
      cwd: product,
      env: process.env,
      windowsHide: true,
      encoding: "utf8",
      timeout: 270000,
    },
  );
  return JSON.parse(output.trim().split(/\r?\n/).at(-1)!);
}
test.use({ trace: "off" });
test.beforeAll(async () => {
  await fs.mkdir(evidence, { recursive: true });
  fixture("provision");
});
test.beforeEach(async ({ context }) => {
  await context.routeWebSocket("**/_next/webpack-hmr", (socket) =>
    socket.close(),
  );
});
async function login(page: Page, key: string) {
  const all = JSON.parse(
    await fs.readFile(
      path.join(product, ".runtime/final-renewal-onboarding-auth.json"),
      "utf8",
    ),
  );
  const auth = all[key];
  await page.goto("/login");
  await page.getByLabel("Электронная почта", { exact: true }).fill(auth.email);
  await page.getByLabel("Пароль", { exact: true }).fill(auth.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Заявки на печать" }),
  ).toBeVisible();
  return auth;
}
async function get(page: Page, endpoint: string) {
  const response = await page.request.get(`/api${endpoint}`);
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function queue(page: Page) {
  await page.goto("/workbench");
  await page
    .getByRole("tab", { name: "Повторные обращения", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Потребности из подтверждённой истории",
    }),
  ).toBeVisible();
}

test("V06 exact five states: only two confirmed needs create clean linked repeats, closed and unknown states survive reload", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(300000);
  const started = Date.now();
  const auth = await login(page, "V06");
  const old = await get(page, `/print-requests/${auth.historyId}`);
  const oldSnapshot = old.issuances[0].snapshot;
  const oldNumbers = old.documents.map((d: { number: string }) => d.number);
  const baseline = fixture("state", "V06");
  const steps: Record<string, unknown>[] = [];
  const record = async (action: string, proof: Record<string, unknown>) => {
    steps.push({ action, elapsedMs: Date.now() - started, ...proof });
    await fs.writeFile(
      path.join(evidence, "v06-checkpoint.json"),
      JSON.stringify(
        { status: "RUNNING", tenantId: auth.tenantId, steps },
        null,
        2,
      ),
    );
  };
  const csrf = (await context.cookies()).find(
    (c) => c.name === "demo_csrf",
  )!.value;
  const headers = { origin: process.env.DEMO_ORIGIN!, "x-csrf-token": csrf };
  const row = (index: number) =>
    page.getByRole("row").filter({ hasText: auth.needs[index].fullNameRu });
  await queue(page);
  for (let i = 0; i < 5; i++) {
    await expect(row(i)).toContainText("Нужно проверить актуальность");
    await expect(row(i)).toContainText(
      "Следующая проверка знаний: Не подтверждена",
    );
    await expect(
      row(i).getByRole("link", { name: "Исходная заявка", exact: true }),
    ).toHaveAttribute("href", `/requests/${auth.historyId}`);
  }
  await expect(
    page.getByRole("button", { name: "Создать повторную заявку", exact: true }),
  ).toHaveCount(0);
  await record(
    "five-history-backed-cases-no-invented-next-check-or-confirmation",
    {
      people: 5,
      confirmed: 0,
      nextCheckDates: (await get(page, "/renewals")).items.map(
        (n: { nextCheckDate: string | null }) => n.nextCheckDate,
      ),
    },
  );
  const notes = [
    "EXPLICIT_CUSTOMER_REQUEST: P001 — синтетический заказчик подтвердил сотрудника и услугу",
    "EXPLICIT_CUSTOMER_REQUEST: P002 — синтетический заказчик подтвердил сотрудника и услугу",
    "",
    `SATISFIED_EXTERNALLY: проверенный внешний документ ${auth.externalEvidenceId}`,
    "CONFIRMED_EMPLOYMENT_END: заказчик явно подтвердил увольнение P005",
  ];
  for (const i of [0, 1, 3, 4]) {
    await row(i)
      .getByRole("button", { name: "Записать результат контакта", exact: true })
      .click();
    await page.getByLabel("Дата контакта", { exact: true }).fill("2026-09-24");
    await page
      .getByRole("combobox", { name: "Ответ заказчика", exact: true })
      .selectOption(i < 2 ? "CONFIRMED" : "IRRELEVANT");
    await page
      .getByLabel("Подтверждённые сведения / причина", { exact: true })
      .fill(notes[i]);
    const pending = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/renewals/${auth.needs[i].needId}/contacts`) &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Сохранить контакт", exact: true })
      .click();
    expect((await pending).ok()).toBe(true);
    if (i < 2) await expect(row(i)).toContainText("Подтверждено");
    else await expect(row(i)).toHaveCount(0);
  }
  await page.reload();
  await page
    .getByRole("tab", { name: "Повторные обращения", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Создать повторную заявку", exact: true }),
  ).toHaveCount(2);
  await expect(row(2)).toContainText("Нужно проверить актуальность");
  await expect(row(3)).toHaveCount(0);
  await expect(row(4)).toHaveCount(0);
  await page
    .getByLabel("Показывать завершённые и неактуальные потребности", {
      exact: true,
    })
    .check();
  for (const i of [0, 1, 3, 4]) {
    await row(i).getByText("История контактов (1)", { exact: true }).click();
    await expect(row(i)).toContainText(notes[i]);
  }
  const states = (await get(page, "/renewals")).items;
  expect(states).toHaveLength(5);
  expect(
    states.filter((n: { state: string }) => n.state === "CONFIRMED"),
  ).toHaveLength(2);
  expect(
    states.every(
      (n: { nextCheckDate: string | null }) => n.nextCheckDate === null,
    ),
  ).toBe(true);
  await page.screenshot({
    path: path.join(evidence, "v06-five-states-and-reasons.png"),
    fullPage: true,
  });
  await record("four-explicit-customer-responses-through-ui-reloaded", {
    confirmedKeys: ["DEMO-P001", "DEMO-P002"],
    unknownKey: "DEMO-P003",
    externalKey: "DEMO-P004",
    employmentEndedKey: "DEMO-P005",
    contacts: states.flatMap((n: { contacts: unknown[] }) => n.contacts).length,
    reenteredIdentityFields: 0,
  });
  const newIds: string[] = [];
  for (const i of [0, 1]) {
    await queue(page);
    const pending = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/renewals/${auth.needs[i].needId}/repeat`) &&
        r.request().method() === "POST",
    );
    await row(i)
      .getByRole("button", { name: "Создать повторную заявку", exact: true })
      .click();
    const response = await pending;
    // The successful UI action performs a full navigation, so Chromium may
    // discard that response body. Read the saved request from the destination.
    expect(response.ok()).toBe(true);
    await expect(page).toHaveURL(/\/requests\/[a-f0-9-]{36}$/);
    const result = { id: /requests\/([^/]+)/.exec(page.url())![1] };
    newIds.push(result.id);
    await expect(page).toHaveURL(new RegExp(`/requests/${result.id}$`));
    const fresh = await get(page, `/print-requests/${result.id}`);
    expect(fresh.items).toHaveLength(1);
    expect(fresh.items[0].recipientId).toBe(auth.needs[i].recipientId);
    expect(fresh.items[0].externalId).toBe(auth.needs[i].key);
    expect(fresh.documents).toHaveLength(0);
    expect(fresh.issuances).toHaveLength(0);
    for (const a of fresh.items[0].assignments) {
      expect(a.result).toBe("");
      expect(a.documentDate).toBe("");
      expect(a.trainingStart).toBe("");
      expect(a.trainingEnd).toBe("");
      expect(a.outcome?.status || "UNKNOWN").toBe("UNKNOWN");
    }
    const repeats = await Promise.all(
      [0, 1].map(() =>
        page.request.post(`/api/renewals/${auth.needs[i].needId}/repeat`, {
          headers,
          data: { confirmedCurrent: true },
        }),
      ),
    );
    for (const retry of repeats) {
      expect(retry.ok(), await retry.text()).toBe(true);
      expect((await retry.json()).id).toBe(result.id);
    }
    await record("confirmed-repeat-ui-and-two-concurrent-http-retries", {
      key: auth.needs[i].key,
      requestId: result.id,
      recipientId: fresh.items[0].recipientId,
      retryCount: 2,
      reenteredIdentityFields: 0,
      oldResultsCopied: false,
    });
  }
  for (const i of [2, 3, 4]) {
    const denied = await page.request.post(
      `/api/renewals/${auth.needs[i].needId}/repeat`,
      { headers, data: { confirmedCurrent: true } },
    );
    expect(denied.status()).toBe(409);
    expect((await denied.json()).code).toBe("CURRENTNESS_REQUIRED");
  }
  await queue(page);
  await expect(row(2)).toContainText("Нужно проверить актуальность");
  for (const i of [0, 1, 3, 4]) await expect(row(i)).toHaveCount(0);
  await page.reload();
  await page
    .getByRole("tab", { name: "Повторные обращения", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Создать повторную заявку", exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("Показывать завершённые и неактуальные потребности", {
      exact: true,
    })
    .check();
  for (const i of [0, 1])
    await expect(row(i)).toContainText("Создана новая заявка");
  const final = fixture("state", "V06");
  expect(final.requests).toBe(baseline.requests + 2);
  expect(final.recipients).toBe(baseline.recipients);
  expect(final.reservations).toBe(baseline.reservations);
  expect(final.issuances).toBe(baseline.issuances);
  expect(final.contacts).toBe(4);
  expect(final.orders).toBe(0);
  const preserved = await get(page, `/print-requests/${auth.historyId}`);
  expect(preserved.issuances[0].snapshot).toEqual(oldSnapshot);
  expect(preserved.documents.map((d: { number: string }) => d.number)).toEqual(
    oldNumbers,
  );
  await page.screenshot({
    path: path.join(evidence, "v06-closed-repeat-history.png"),
    fullPage: true,
  });
  await record(
    "reload-no-reopening-no-extra-requests-no-old-history-mutation",
    { newRequestIds: newIds, baseline, final, originalSnapshotUnchanged: true },
  );
  await fs.writeFile(
    path.join(evidence, "v06-summary.json"),
    JSON.stringify(
      {
        status: "PASS",
        syntheticDataOnly: true,
        tenantId: auth.tenantId,
        browser: browser.version(),
        scenario: "V06",
        baseline,
        final,
        steps,
        automatedWallMs: Date.now() - started,
        reenteredIdentityFields: 0,
        externalManualActionsDuringBrowserJourney: 0,
        activeHumanMs: null,
        customerWaitingMs: null,
        humanBaselineMs: null,
        limitation:
          "Five real finalized synthetic historical rows and verified external evidence prepared as preconditions. Four contact decisions and two repeat creations use the real UI. Concurrent retries/three denials are independent real HTTP assertions. Automated duration is not human time or revenue.",
      },
      null,
      2,
    ),
  );
});

test("V10 fresh supported synthetic center obtains its first actual UI PDF with no company, finance, portal or dossier dependency", async ({
  page,
  browser,
}) => {
  test.setTimeout(420000);
  const started = Date.now();
  const auth = await login(page, "V10");
  const baseline = fixture("state", "V10");
  expect(baseline).toEqual(auth.initialCounts);
  expect(baseline.requests).toBe(0);
  const initialContext = await get(page, "/context");
  expect(initialContext.tenant.demoOnly).toBe(true);
  expect(
    initialContext.templates.some(
      (t: { templateId: string; approved: boolean }) =>
        t.templateId === "biot-worker-card" && t.approved,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "Новая заявка", exact: true }).click();
  await createRequestWithWorkerDocument(page, "PERSON");
  await page
    .getByLabel("Название заявки", { exact: true })
    .fill("V10 — первый синтетический документ нового центра");
  await page
    .getByLabel("ФИО RU, строка 1")
    .fill("Демонстрационный Слушатель 001");
  await page
    .getByLabel("ФИО KZ, строка 1")
    .fill("Демонстрациялық Тыңдаушы 001");
  await page
    .getByLabel("Форма документа", { exact: true })
    .selectOption("biot-worker-card");
  await page.getByLabel("Дата документа", { exact: true }).fill("2026-09-24");
  await page
    .getByLabel("Программа / тема обучения", { exact: true })
    .fill("V10 синтетическая проверка одиночной услуги БиОТ");
  await page.getByRole("button", { name: "Проверить", exact: true }).click();
  await expect(
    page.getByText("Исправьте данные перед оформлением", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Подтверждённый результат / оценка", { exact: true }),
  ).toHaveValue("");
  expect(fixture("state", "V10").reservations).toBe(0);
  await page
    .getByLabel("Подтверждённый результат / оценка", { exact: true })
    .fill("Сдано — явный синтетический результат");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.locator(".save-indicator")).toContainText("Сохранено");
  await page.reload();
  await expect(page.getByLabel("ФИО KZ, строка 1")).toHaveValue(
    "Демонстрациялық Тыңдаушы 001",
  );
  await page.getByRole("button", { name: "Проверить", exact: true }).click();
  await expect(
    page.getByText("Данные прошли проверку", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(evidence, "v10-first-document-ready.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Оформить комплект", exact: true })
    .click();
  const pending = page.waitForResponse(
    (r) => r.url().endsWith("/finalize") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Оформить", exact: true }).click();
  const response = await pending;
  expect(response.ok(), await response.text()).toBe(true);
  const requestId = /requests\/([^/]+)/.exec(page.url())![1];
  const render = fixture("drain", "V10", requestId);
  await page.reload();
  await expect(page.locator(".files-panel")).toContainText("Готово 4 из 4", {
    timeout: 60000,
  });
  const issued = await get(page, `/print-requests/${requestId}`);
  expect(issued.customerId).toBeNull();
  expect(issued.items).toHaveLength(1);
  expect(issued.documents).toHaveLength(1);
  expect(issued.issuances).toHaveLength(1);
  const pdf = issued.artifacts.find(
    (a: { format: string }) => a.format === "PDF",
  );
  expect(pdf).toBeTruthy();
  const pendingDownload = page.waitForEvent("download");
  await page
    .locator(`.artifact-list a[href="/api/artifacts/${pdf.id}"]`)
    .click();
  await (
    await pendingDownload
  ).saveAs(path.join(evidence, "v10-first-original.pdf"));
  const bytes = await fs.readFile(
    path.join(evidence, "v10-first-original.pdf"),
  );
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  expect(sha256).toBe(pdf.sha256);
  const final = fixture("state", "V10");
  for (const name of [
    "customers",
    "orders",
    "memberships",
    "serviceRules",
    "dossierRecords",
  ])
    expect(final[name]).toBe(0);
  expect(final.requests).toBe(1);
  expect(final.issuances).toBe(1);
  expect(final.reservations).toBe(1);
  await page.screenshot({
    path: path.join(evidence, "v10-first-document-issued.png"),
    fullPage: true,
  });
  await fs.writeFile(
    path.join(evidence, "v10-summary.json"),
    JSON.stringify(
      {
        status: "PASS",
        scenario: "V10",
        syntheticDataOnly: true,
        tenantId: auth.tenantId,
        browser: browser.version(),
        setupPath: auth.setupPath,
        setupScope:
          "Fresh disposable demoOnly center with explicitly synthetic approved profile and supported installed templates. No real customer's profile was replaced or guessed.",
        baseline,
        final,
        requestId,
        documentNumber: issued.documents[0].number,
        file: "v10-first-original.pdf",
        sha256,
        form: "biot-worker-card",
        automatedWallMs: Date.now() - started,
        render,
        activeHumanMs: null,
        customerWaitingMs: null,
        humanBaselineMs: null,
        limitation:
          "Supported provisioning is a recorded setup command; first draft, validation failure/correction, reload, form choice, issuance and original PDF download are real UI. This proves isolated synthetic onboarding, not production configuration/legal approval or a paid pilot.",
      },
      null,
      2,
    ),
  );
});

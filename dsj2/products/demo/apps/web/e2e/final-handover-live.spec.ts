import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { loginRole } from "./operator-role-fixture";
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE
    ? path.join(process.env.DEMO_E2E_EVIDENCE, "handover")
    : "../../docs/evidence/final-completion/handover",
);
test.use({ trace: "off" });
async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Электронная почта", { exact: true }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Заявки на печать" }),
  ).toBeVisible();
}
test("V05 exact live handover: eight people, two events, unknown result and untransferred material survive colleague handover", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(180000);
  await context.routeWebSocket("**/_next/webpack-hmr", (socket) =>
    socket.close(),
  );
  await fs.mkdir(evidence, { recursive: true });
  await loginRole(page, "ADMIN");
  const csrf = (await context.cookies()).find(
    (c) => c.name === "demo_csrf",
  )!.value;
  const headers = { origin: process.env.DEMO_ORIGIN!, "x-csrf-token": csrf };
  const post = async (endpoint: string, data: unknown) => {
    const r = await page.request.post(`/api${endpoint}`, { headers, data });
    expect(r.ok(), await r.text()).toBe(true);
    return r.json();
  };
  const suffix = Date.now();
  const operators = [];
  for (const key of ["A", "B"]) {
    const password = `Synthetic-Handover-${randomUUID()}!`;
    const email = `handover-${key}-${suffix}@example.test`;
    const user = await post("/users", {
      email,
      password,
      displayName: `SYNTHETIC_OPERATOR_${key} ${suffix}`,
      role: "OPERATOR",
    });
    operators.push({ ...user, email, password });
  }
  const customer = await post("/customers", {
    nameRu: `V05 восемь человек ${suffix}`,
  });
  const people = [];
  for (let i = 1; i <= 8; i++)
    people.push(
      await post("/recipients", {
        id: randomUUID(),
        fullNameRu: `DEMO-P${String(i).padStart(3, "0")} ${suffix}`,
        employerId: customer.id,
        assignments: [],
      }),
    );
  const eventIds = [randomUUID(), randomUUID()];
  const request = await post("/print-requests", {
    schemaVersion: 2,
    kind: "COMPANY",
    customerId: customer.id,
    title: `V05 состав ${suffix}`,
    demoMode: true,
    events: eventIds.map((id, i) => ({
      id,
      title: `V05 событие ${i + 1}`,
      protocolTemplateId: "pb-protocol",
      commonFields: {
        trainingSubject: `Синтетическая программа ${i + 1}`,
        documentDate: i === 0 ? "2026-09-24" : "",
        ...(i === 1 ? { fieldOrigins: { documentDate: "CLEARED" } } : {}),
        protocolDate: "2026-09-24",
        trainingStart: "2026-09-23",
        trainingEnd: "2026-09-24",
      },
    })),
    items: people.map((person, i) => ({
      id: randomUUID(),
      recipientId: person.id,
      employerId: customer.id,
      fullNameRu: person.data.fullNameRu,
      assignments: [
        {
          id: randomUUID(),
          templateId: "pb-card",
          protocolMode: "GROUP",
          eventId: eventIds[i < 4 ? 0 : 1],
          result: i === 7 ? "" : "Сдал",
          outcome: {
            status: i === 7 ? "UNKNOWN" : "PASSED",
            source:
              i === 7
                ? ""
                : "Синтетическая ведомость семи подтверждённых результатов",
          },
        },
      ],
    })),
  });
  const order = await post("/orders", {
    title: `V05 передача коллеге ${suffix}`,
    customerId: customer.id,
    requestIds: [request.id],
    ownerId: operators[0].id,
  });
  const material = await post(`/orders/${order.id}/milestones`, {
    label: "Согласованные материалы не переданы",
    category: "TRANSFER",
    source: "CONTRACT",
    sourceReference: "Синтетический согласованный объём V05",
  });
  const a = await browser.newContext({ baseURL: process.env.DEMO_ORIGIN });
  const b = await browser.newContext({ baseURL: process.env.DEMO_ORIGIN });
  try {
    await a.routeWebSocket("**/_next/webpack-hmr", (socket) => socket.close());
    await b.routeWebSocket("**/_next/webpack-hmr", (socket) => socket.close());
    const first = await a.newPage();
    await login(first, operators[0].email, operators[0].password);
    await first.goto("/workbench");
    await first.getByRole("button", { name: order.title, exact: true }).click();
    await expect(
      first.getByText(/Состав заказа: 8 чел\. · 2 событий · 8 услуг/),
    ).toBeVisible();
    await expect(
      first.locator("article.milestone").filter({ hasText: "DEMO-P008" }),
    ).toHaveCount(2);
    await expect(
      first
        .locator("article.milestone")
        .filter({ hasText: "Получить фактический результат" }),
    ).toContainText("DEMO-P008");
    await expect(
      first
        .locator("article.milestone")
        .filter({ hasText: "Уточнить данные" })
        .filter({ hasText: "Дата оформления" }),
    ).toHaveCount(4);
    await expect(
      first.locator("article.milestone").filter({ hasText: material.label }),
    ).toContainText("Ожидает действия");
    await first
      .getByText("Ответственный, срок и завершение заказа", { exact: true })
      .click();
    await first
      .getByRole("combobox", { name: "Ответственный", exact: true })
      .selectOption(operators[1].id);
    await first
      .getByLabel("Согласованный срок", { exact: true })
      .fill("2026-10-02");
    await first
      .getByLabel("Контакт / передача работы", { exact: true })
      .fill("Коллеге B: уточнить DEMO-P008 и передать согласованные материалы");
    const saved = first.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/orders/${order.id}`) &&
        r.request().method() === "PATCH",
    );
    await first
      .getByRole("button", {
        name: "Сохранить ответственность и срок",
        exact: true,
      })
      .click();
    expect((await saved).ok()).toBe(true);
    const second = await b.newPage();
    await login(second, operators[1].email, operators[1].password);
    await second.goto("/workbench");
    await second
      .getByRole("button", { name: order.title, exact: true })
      .click();
    await expect(
      second.getByText(/Состав заказа: 8 чел\. · 2 событий · 8 услуг/),
    ).toBeVisible();
    await expect(
      second
        .locator("article.milestone")
        .filter({ hasText: "Получить фактический результат" }),
    ).toContainText("Получить фактический результат");
    await expect(
      second
        .locator("article.milestone")
        .filter({ hasText: "Уточнить данные" })
        .filter({ hasText: "Дата оформления" }),
    ).toHaveCount(4);
    await second
      .getByText("Ответственный, срок и завершение заказа", { exact: true })
      .click();
    await expect(
      second.getByRole("combobox", { name: "Ответственный", exact: true }),
    ).toHaveValue(operators[1].id);
    await expect(
      second.getByLabel("Контакт / передача работы", { exact: true }),
    ).toHaveValue(
      "Коллеге B: уточнить DEMO-P008 и передать согласованные материалы",
    );
    await expect(
      second.getByLabel("Согласованный срок", { exact: true }),
    ).toHaveValue("2026-10-02");
    await second.screenshot({
      path: path.join(evidence, "colleague-eight-people-two-events.png"),
      fullPage: true,
    });
    const materialRow = second
      .locator("article.milestone")
      .filter({ hasText: material.label });
    await materialRow
      .getByLabel("Подтверждение выполнения", { exact: true })
      .fill(
        "Коллега B: передано представителю, синтетическое подтверждение V05",
      );
    await materialRow
      .getByRole("button", { name: "Зафиксировать выполнение", exact: true })
      .click();
    await expect(materialRow).toContainText("Выполнено");
    await expect(
      second.getByText("Результаты обучения: требуют подтверждения", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      second.getByText("Передача: подтверждена", { exact: true }),
    ).toBeVisible();
    const detailed = await (
      await second.request.get(`/api/orders/${order.id}`)
    ).json();
    const actual = await (
      await second.request.get(`/api/print-requests/${request.id}`)
    ).json();
    expect(detailed.summary).toEqual({
      people: 8,
      events: 2,
      personEventServices: 8,
      legacyAssignments: 0,
    });
    expect(detailed.ownerId).toBe(operators[1].id);
    expect(detailed.completion.training).toBe(false);
    expect(detailed.completion.transfer).toBe(true);
    expect(actual.draft.items).toHaveLength(8);
    expect(actual.draft.events).toHaveLength(2);
    expect(actual.draft.items[7].assignments[0].outcome.status).toBe("UNKNOWN");
    expect(actual.issuances).toHaveLength(0);
    await second.setViewportSize({ width: 375, height: 812 });
    await expect(
      second.getByText(/Состав заказа: 8 чел\. · 2 событий · 8 услуг/),
    ).toBeVisible();
    expect(
      await second.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await second.screenshot({
      path: path.join(evidence, "handover-mobile-results-independent.png"),
      fullPage: true,
    });
    await fs.writeFile(
      path.join(evidence, "summary.json"),
      JSON.stringify(
        {
          status: "PASS",
          scenario: "V05",
          realApi: true,
          realBrowserOperators: 2,
          orderId: order.id,
          requestId: request.id,
          preconditions: {
            people: 8,
            events: 2,
            unknownResults: 1,
            untransferredMaterials: 1,
          },
          handoverUi: true,
          colleagueSeesExactRemainingActions: true,
          ownerAndDueDatePersisted: true,
          materialsConfirmedBySecondOperatorUi: true,
          unknownNeverAutoPassed: true,
          concreteMissingDataOnOrder: true,
          summary: detailed.summary,
          mobileWidth: 375,
        },
        null,
        2,
      ),
    );
  } finally {
    await a.close();
    await b.close();
  }
});

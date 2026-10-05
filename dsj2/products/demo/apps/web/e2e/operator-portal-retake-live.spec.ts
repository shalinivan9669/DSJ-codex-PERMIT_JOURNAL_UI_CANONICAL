import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { realApprovalRoles } from "./operator-role-fixture";
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    "../../docs/evidence/operator-value/portal-retake-browser",
);
async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Электронная почта", { exact: true }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
}
test("live failed attempt gets linked clean retake; scoped employer evidence stays unverified", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(180000);
  await fs.mkdir(evidence, { recursive: true });
  const suffix = Date.now();
  const approvalRoles = await realApprovalRoles(browser, page);
  await approvalRoles.configureSignatories();
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
    const administrative = [
      "/users",
      "/employer-memberships",
      "/service-rules",
    ].includes(endpoint);
    const response = await (
      administrative ? approvalRoles.adminPage : page
    ).request.post(`/api${endpoint}`, {
      headers: {
        ...(administrative ? approvalRoles.admin.headers : headers),
        ...extra,
      },
      data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const customer = await post("/customers", {
    nameRu: `Заказчик пересдачи ${suffix}`,
  });
  const person = await post("/recipients", {
    id: crypto.randomUUID(),
    fullNameRu: `Участник пересдачи ${suffix}`,
    employerId: customer.id,
    positionRu: "Инженер",
    assignments: [],
  });
  const rule = await post("/service-rules", {
    serviceKey: `portal_${suffix}`,
    title: `Программа заказчика ${suffix}`,
    status: "APPROVED",
    checkedOn: "2026-09-24",
    source: "Синтетический источник",
    applicability: "Только тестовый заказчик",
    definition: {
      programVersion: "1",
      category: "",
      compatibleTemplateIds: ["pb-card", "pb-protocol"],
      requirements: [],
      limitation: "Синтетическая проверка",
    },
  });
  const eventId = crypto.randomUUID();
  const rowId = crypto.randomUUID();
  const assignmentId = crypto.randomUUID();
  const request = await post("/print-requests", {
    schemaVersion: 2,
    kind: "COMPANY",
    customerId: customer.id,
    title: `Неуспешная попытка ${suffix}`,
    demoMode: true,
    events: [
      {
        id: eventId,
        title: "Первая проверка",
        protocolTemplateId: "pb-protocol",
        serviceRuleVersionId: rule.id,
        commonFields: {
          documentDate: "2026-09-25",
          protocolDate: "2026-09-25",
          trainingStart: "2026-09-23",
          trainingEnd: "2026-09-24",
          trainingSubject: "Синтетическая программа",
          hours: "16",
        },
      },
    ],
    items: [
      {
        id: rowId,
        recipientId: person.id,
        employerId: customer.id,
        fullNameRu: person.data.fullNameRu,
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
  const checked = await post(`/print-requests/${request.id}/validate`, {
    expectedRevision: request.revision,
  });
  expect(checked.issues).toEqual([]);
  await approvalRoles.approve(request.id);
  const approved = await (
    await page.request.get(`/api/print-requests/${request.id}`)
  ).json();
  await post(
    `/print-requests/${request.id}/finalize`,
    { expectedRevision: approved.revision },
    { "Idempotency-Key": crypto.randomUUID() },
  );
  const original = await (
    await page.request.get(`/api/print-requests/${request.id}`)
  ).json();
  await page.goto(`/requests/${request.id}`);
  await page.getByLabel("ФИО, строка 1", { exact: true }).click();
  await page
    .getByRole("button", { name: "Дополнительные действия", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Прочее", exact: true })
    .getByRole("button", { name: "Связанные действия", exact: true })
    .click();
  await page
    .getByText(`Создать пересдачу по получателю «${person.data.fullNameRu}»`, {
      exact: true,
    })
    .click();
  await page
    .getByRole("combobox", { name: "Предыдущая попытка", exact: true })
    .selectOption(assignmentId);
  await page
    .getByLabel("Основание пересдачи", { exact: true })
    .fill("Синтетическое согласование повторной попытки");
  await page
    .getByRole("button", { name: "Создать отдельную попытку", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Открыть пересдачу", exact: true })
    .click();
  await expect(page.locator(".title-with-status .status")).toHaveText(
    "Черновик",
  );
  const retakeId = /requests\/([^/]+)/.exec(page.url())![1];
  const retake = await (
    await page.request.get(`/api/print-requests/${retakeId}`)
  ).json();
  expect(retake.items[0].assignments[0].retakeOf.requestId).toBe(request.id);
  expect(retake.items[0].assignments[0].outcome.status).toBe("UNKNOWN");
  expect(retake.items[0].assignments[0].documentDate).toBe("");
  expect(retake.items[0].assignments[0].result).toBe("");
  expect(retake.events[0].id).not.toBe(eventId);
  const reread = await (
    await page.request.get(`/api/print-requests/${request.id}`)
  ).json();
  expect(reread.issuances[0].snapshot).toEqual(original.issuances[0].snapshot);
  await page.screenshot({
    path: path.join(evidence, "retake-clean-draft.png"),
    fullPage: true,
  });
  const order = await post("/orders", {
    title: `Заказ портала ${suffix}`,
    customerId: customer.id,
    requestIds: [request.id],
  });
  const employerEmail = `portal-ui-${suffix}@example.test`;
  const employerPassword = `Synthetic-Portal-${crypto.randomUUID()}!`;
  const user = await post("/users", {
    email: employerEmail,
    password: employerPassword,
    displayName: "Синтетический представитель",
    role: "EMPLOYER",
  });
  await post("/employer-memberships", {
    customerId: customer.id,
    userId: user.id,
    permissions: ["READ", "PROPOSE", "DOWNLOAD"],
    recipientIds: [person.id],
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  const employerContext = await browser.newContext({
    baseURL: process.env.DEMO_ORIGIN,
  });
  try {
    const employer = await employerContext.newPage();
    await login(employer, employerEmail, employerPassword);
    await expect(
      employer.getByRole("heading", { name: "Кабинет заказчика" }),
    ).toBeVisible();
    await employer
      .getByRole("button", { name: "Открыть сведения и матрицу", exact: true })
      .click();
    await expect(
      employer.getByRole("heading", { name: "Люди и согласованные программы" }),
    ).toBeVisible();
    await employer
      .getByText("Передать сведения для проверки центром", { exact: true })
      .click();
    await employer
      .getByRole("combobox", { name: "Человек", exact: true })
      .selectOption(person.id);
    await employer
      .getByRole("combobox", { name: "Программа", exact: true })
      .selectOption(rule.serviceKey);
    for (const [label, value] of [
      ["Кем выдан документ", "Другой синтетический поставщик"],
      ["Номер внешнего документа", `EXTERNAL-00${suffix}`],
      ["Дата внешнего документа", "2026-09-20"],
      ["Откуда получены сведения", "Синтетическая копия от заказчика"],
    ])
      await employer.getByLabel(label, { exact: true }).fill(value);
    await employer
      .getByRole("button", {
        name: "Передать внешний документ на проверку",
        exact: true,
      })
      .click();
    await expect(
      employer.getByText(
        "Сведения переданы со статусом «Ожидает проверки центра».",
        { exact: true },
      ),
    ).toBeVisible();
    await employer.reload();
    await employer
      .getByRole("button", { name: "Открыть сведения и матрицу", exact: true })
      .click();
    await expect(
      employer.getByText(new RegExp(`EXTERNAL-00${suffix}`)),
    ).toBeVisible();
    await expect(
      employer.getByRole("button", {
        name: "Подтвердить проверку",
        exact: true,
      }),
    ).toHaveCount(0);
    await employer
      .getByRole("button", { name: "Приложить копию источника", exact: true })
      .click();
    await employer
      .getByLabel("Источник копии", { exact: true })
      .fill("Синтетический источник представителя заказчика");
    const sourcePng = await employer.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 100;
      const drawing = canvas.getContext("2d")!;
      drawing.fillStyle = "white";
      drawing.fillRect(0, 0, 320, 100);
      drawing.fillStyle = "black";
      drawing.font = "18px sans-serif";
      drawing.fillText("SYNTHETIC EMPLOYER SOURCE", 10, 50);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    await employer
      .getByLabel("PDF, PNG или JPEG до 1 МБ", { exact: true })
      .setInputFiles({
        name: "synthetic-employer-source.png",
        mimeType: "image/png",
        buffer: Buffer.from(sourcePng, "base64"),
      });
    await employer
      .getByRole("button", { name: "Сохранить копию источника", exact: true })
      .click();
    await expect(
      employer.getByRole("link", {
        name: "synthetic-employer-source.png",
        exact: true,
      }),
    ).toBeVisible();
    await employer.reload();
    await employer
      .getByRole("button", { name: "Открыть сведения и матрицу", exact: true })
      .click();
    const downloadedSource = employer.waitForEvent("download");
    await employer
      .getByRole("link", { name: "synthetic-employer-source.png", exact: true })
      .click();
    const sourcePath = path.join(evidence, "portal-source-copy.png");
    await (await downloadedSource).saveAs(sourcePath);
    expect((await fs.readFile(sourcePath)).toString("base64")).toBe(sourcePng);
    await employer.screenshot({
      path: path.join(evidence, "portal-external-evidence.png"),
      fullPage: true,
    });
    await employer.setViewportSize({ width: 390, height: 844 });
    expect(
      await employer.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await employer.screenshot({
      path: path.join(evidence, "portal-mobile.png"),
      fullPage: true,
    });
    const response = await employer.request.get(
      `/api/portal/evidence?customerId=${customer.id}`,
    );
    const data = await response.json();
    expect(data.items).toHaveLength(1);
    expect(data.items[0].status).toBe("UNVERIFIED");
    expect(data.recipients.map((p: { id: string }) => p.id)).toEqual([
      person.id,
    ]);
    await fs.writeFile(
      path.join(evidence, "portal-retake-result.json"),
      JSON.stringify(
        {
          status: "PASS",
          syntheticDataOnly: true,
          sourceRequestId: request.id,
          retakeRequestId: retakeId,
          originalSnapshotUnchanged: true,
          retakeOutcome: "UNKNOWN",
          employerOrderId: order.id,
          externalEvidenceStatus: "UNVERIFIED",
          reload: true,
          customerScoped: true,
          attachmentDownloadedBytesMatch: true,
          mobile390NoDocumentOverflow: true,
          limitation:
            "Setup uses actual API fixtures. Retake command and employer submission/reload are exercised through actual UI; this test does not claim complete portal security coverage.",
        },
        null,
        2,
      ),
    );
  } finally {
    await employerContext.close();
    await approvalRoles.close();
  }
});

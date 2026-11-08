import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { draftSchema } from "@demo/contracts";
import { provision } from "../../../scripts/setup";
import { db, type Context } from "../../../apps/api/src/core";
import {
  bootstrapSuperAdmin,
  saveProfile,
  saveUser,
} from "../../../apps/api/src/settings";
import {
  createRequest,
  finalize,
  requestDetail,
} from "../../../apps/api/src/requests";
import { signingState } from "../../../apps/api/src/signing";
import { store } from "../../../apps/api/src/files";
import {
  claimJob,
  executeJob,
  heartbeat,
  settleFailure,
  DeferredJob,
} from "../../../apps/render-worker/src/queue";
import { assertTestDatabase } from "../../../tests/integration/test-database";

// These scenarios intentionally progress the two separately attested documents
// of one real, locally rendered synthetic issuance. No digital signature is faked.
test.describe.configure({ mode: "serial" });
test.use({ trace: "off" });
test.beforeEach(async ({ page }) => {
  await page.routeWebSocket(/\/_next\/webpack-hmr/, (socket) => socket.close());
});
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    "../../../.runtime/commission-flow/evidence/signing-flow",
);
const combinedName = "Синтетический Совмещённый Подписант";
const teacherName = "Синтетический Преподаватель";
const signerRoles = ["Директор", "Председатель комиссии", "Преподаватель"];
const paperNames = [combinedName, combinedName, teacherName];
let seeded: Awaited<ReturnType<typeof fixture>>;

async function fixture(http: APIRequestContext) {
  assertTestDatabase();
  expect(["127.0.0.1", "localhost"]).toContain(
    new URL(process.env.DATABASE_URL!).hostname,
  );
  const suffix = randomUUID(),
    password = `Synthetic-signing-${suffix}!`;
  const email = `signing-${suffix}@example.test`;
  const owner = await provision({
    email,
    password,
    name: "Синтетическое браузерное подписание",
    sample: true,
  });
  const context: Context = {
    ...owner,
    role: "DIRECTOR",
    sessionId: "test",
    csrfHash: "test",
    correlationId: suffix,
  };
  await bootstrapSuperAdmin(context, {
    currentPassword: password,
    confirm: true,
  });
  context.role = "SUPER_ADMIN";
  const accounts = {
    SUPER_ADMIN: { email, password, id: owner.userId },
  } as Record<
    "SUPER_ADMIN" | "DIRECTOR" | "OPERATOR" | "VIEWER",
    { email: string; password: string; id: string }
  >;
  for (const role of ["DIRECTOR", "OPERATOR", "VIEWER"] as const) {
    const user = await saveUser(context, {
      email: `signing-${role.toLowerCase()}-${suffix}@example.test`,
      password,
      role,
      displayName: `Синтетический пользователь ${role}`,
    });
    accounts[role] = { email: user.email, password, id: user.id };
  }
  const source = await db.issuerProfileVersion.findFirstOrThrow({
    where: { tenantId: owner.tenantId },
  });
  await saveProfile(context, {
    ...(source.profile as object),
    headName: combinedName,
    commission: [
      { name: combinedName, position: "Начальник УМО" },
      { name: teacherName, position: "Преподаватель" },
      { name: "Синтетический Член Комиссии", position: "Инженер" },
    ],
    people: [{ name: teacherName, position: "Преподаватель", role: "TEACHER" }],
    approved: true,
  });
  const request = await createRequest(
    context,
    draftSchema.parse({
      kind: "PERSON",
      schemaVersion: 2,
      demoMode: true,
      title: "Синтетическая проверка бумажного подписания",
      items: [
        {
          id: randomUUID(),
          fullNameRu: "Синтетический Получатель",
          fullNameKz: "Синтетикалық Алушы",
          positionRu: "Рабочий",
          workplaceRu: "Синтетическое предприятие",
          employeeCategory: "WORKER",
          assignments: [
            {
              id: randomUUID(),
              templateId: "biot-protocol",
              documentDate: "2026-11-08",
              protocolDate: "2026-11-08",
              trainingStart: "2026-11-01",
              trainingEnd: "2026-11-07",
              trainingSubject: "Синтетическая программа",
              hours: "10",
              productionHours: "16",
              biotCategory: "WORKER",
              biotCheckType: "PERIODIC",
              result: "Сдал",
              outcome: {
                status: "PASSED",
                source: "Синтетическая ведомость",
              },
            },
          ],
        },
      ],
    }),
  );
  const loggedIn = await http.post("/api/auth/login", {
    headers: { origin: process.env.DEMO_ORIGIN! },
    data: { email: accounts.DIRECTOR.email, password },
  });
  expect(loggedIn.ok(), `Fixture login HTTP ${loggedIn.status()}`).toBe(true);
  const session = await loggedIn.json();
  const headers = {
    origin: process.env.DEMO_ORIGIN!,
    "x-csrf-token": session.csrfToken,
  };
  const submitted = await http.post(
    `/api/print-requests/${request.id}/approval/submit`,
    { headers, data: { expectedRevision: request.revision } },
  );
  expect(submitted.ok(), await submitted.text()).toBe(true);
  const proposalId = (await submitted.json()).approval.proposalId;
  const proposal = await http.get(`/api/approvals/${proposalId}`);
  expect(proposal.ok(), await proposal.text()).toBe(true);
  const decision = await http.post(`/api/approvals/${proposalId}/decision`, {
    headers,
    data: {
      decision: "APPROVE",
      reason: "Синтетическая проверка согласования",
      expectedProposalHash: (await proposal.json()).proposalHash,
    },
  });
  expect(decision.ok(), await decision.text()).toBe(true);
  const current = await requestDetail(context, request.id);
  const issued = await finalize(
    context,
    request.id,
    { expectedRevision: current.revision },
    randomUUID(),
  );
  if (
    !issued ||
    typeof issued !== "object" ||
    !("issuanceId" in issued) ||
    typeof issued.issuanceId !== "string" ||
    !issued.issuanceId
  )
    throw new Error("Synthetic finalization must create an immutable issuance");
  const issuanceId = issued.issuanceId;
  const worker = `signing-browser-${suffix}`;
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    if (
      !(await db.generationJob.count({
        where: {
          tenantId: owner.tenantId,
          issuanceId: issued.issuanceId,
          status: { not: "SUCCEEDED" },
        },
      }))
    )
      break;
    const job = await claimJob(db, worker, owner.tenantId);
    if (!job) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      continue;
    }
    const beat = setInterval(() => void heartbeat(db, job, worker), 5000);
    try {
      await executeJob(db, store, job, worker, AbortSignal.timeout(210_000));
    } catch (error) {
      await settleFailure(db, job, worker, error);
      if (!(error instanceof DeferredJob)) throw error;
    } finally {
      clearInterval(beat);
    }
  }
  expect(
    await db.generationJob.count({
      where: { tenantId: owner.tenantId, status: { not: "SUCCEEDED" } },
    }),
  ).toBe(0);
  const state = await signingState(context, request.id);
  expect(state.status).toBe("AWAITING_SIGNATURE");
  expect(state.documents).toHaveLength(2);
  expect(
    state.documents.every(
      (document) => document.artifactId && document.canAttestPaper,
    ),
  ).toBe(true);
  const workflow = await db.issuanceWorkflow.findFirstOrThrow({
    where: { tenantId: owner.tenantId, issuanceId: issued.issuanceId },
  });
  return {
    context,
    accounts,
    request,
    issued: { ...issued, issuanceId },
    state,
    policy: workflow.requiredSigners,
  };
}

async function login(page: Page, account: { email: string; password: string }) {
  await page.goto("/login");
  await page
    .getByLabel("Электронная почта", { exact: true })
    .fill(account.email);
  await page.getByLabel("Пароль", { exact: true }).fill(account.password);
  for (let attempt = 0; attempt < 3; attempt++) {
    const loggingIn = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/auth/login") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    const response = await loggingIn;
    if (response.status() === 429) {
      await page.waitForTimeout(31_000);
      continue;
    }
    expect(response.ok(), `Login HTTP ${response.status()}`).toBe(true);
    const body = await response.json();
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
    return {
      origin: process.env.DEMO_ORIGIN!,
      "x-csrf-token": body.csrfToken as string,
    };
  }
  throw new Error("Synthetic browser login remained rate-limited");
}
async function open(page: Page) {
  await page.goto(`/requests/${seeded.request.id}/edit`);
  const details = page
    .locator("details")
    .filter({ has: page.locator(".signing-panel") })
    .first();
  if (!(await details.evaluate((node) => (node as HTMLDetailsElement).open)))
    await details.locator(":scope > summary").click();
  return page.locator(".signing-panel");
}
function article(page: Page, index: number) {
  return page.locator(".signing-document").filter({
    has: page
      .locator("h3")
      .filter({ hasText: `№ ${seeded.state.documents[index].number}` }),
  });
}
async function paperForm(page: Page, index: number) {
  const form = article(page, index).locator(".paper-document-signature");
  await form.locator(":scope > summary").click();
  for (let slot = 0; slot < 3; slot++)
    await expect(
      form.getByLabel(`${signerRoles[slot]} — ФИО на оригинале`, {
        exact: true,
      }),
    ).toHaveValue(paperNames[slot]);
  return form;
}
async function state(page: Page) {
  const response = await page.request.get(
    `/api/print-requests/${seeded.request.id}/signing?issuanceId=${seeded.issued.issuanceId}`,
  );
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function paperCount(index: number) {
  return db.auditEvent.count({
    where: {
      tenantId: seeded.context.tenantId,
      entityId: seeded.state.documents[index].documentId,
      action: "PRINT_PAPER_SIGNATURE_ATTESTED",
    },
  });
}
async function screenshot(page: Page, filename: string) {
  await page.locator(".signing-panel").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(evidence, `${filename}.png`),
    fullPage: false,
  });
  await page
    .locator(".signing-panel")
    .screenshot({ path: path.join(evidence, `${filename}-panel.png`) });
}
test.beforeAll(async ({ request }) => {
  test.setTimeout(420_000);
  await fs.mkdir(evidence, { recursive: true });
  seeded = await fixture(request);
});
test.afterAll(async () => {
  await db.$disconnect();
});

test("a failed real PDF download remains actionable after successful file refresh and retries without altering the original", async ({
  page,
}) => {
  await login(page, seeded.accounts.DIRECTOR);
  await open(page);
  const files = page.locator("#request-files");
  for (const details of await page
    .locator("details")
    .filter({ has: files })
    .all())
    if (!(await details.evaluate((node) => (node as HTMLDetailsElement).open)))
      await details.locator(":scope > summary").click();
  const download = files
    .getByRole("link", { name: "Скачать", exact: true })
    .first();
  const href = await download.getAttribute("href");
  if (!href) throw new Error("Original download link missing");
  let failDownload = true;
  await page.route(`**${href}`, async (route) => {
    if (failDownload)
      await route.fulfill({
        status: 500,
        json: {
          code: "SYNTHETIC_DOWNLOAD_FAILURE",
          message: "Синтетический отказ скачивания",
        },
      });
    else await route.continue();
  });
  await download.click();
  await expect(files).toContainText("Синтетический отказ скачивания");
  const refreshed = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/print-requests/${seeded.request.id}`) &&
      r.request().method() === "GET",
  );
  await files.getByRole("button", { name: "Обновить", exact: true }).click();
  expect((await refreshed).status()).toBe(200);
  await expect(files).toContainText("Синтетический отказ скачивания");
  failDownload = false;
  const received = page.waitForEvent("download");
  await download.click();
  const original = await received;
  const target = path.join(evidence, "recovered-original-download.pdf");
  await original.saveAs(target);
  const artifactId = href.split("/").at(-1)!;
  const stored = await db.artifact.findUniqueOrThrow({
    where: { id: artifactId },
  });
  expect(
    createHash("sha256")
      .update(await fs.readFile(target))
      .digest("hex"),
  ).toBe(stored.sha256);
  await expect(files).not.toContainText("Синтетический отказ скачивания");
});

test("real final PDFs keep EDS unavailable and expose role-specific setup without changing a frozen issuance", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, seeded.accounts.SUPER_ADMIN);
  let panel = await open(page);
  await expect(panel).toContainText(
    "ЭЦП недоступна. Подключение настраивает администратор.",
  );
  await expect(panel).toContainText(
    "Можно оформить документы с подписями на бумаге",
  );
  for (const role of signerRoles)
    await expect(
      article(page, 0)
        .locator("li")
        .filter({ hasText: `${role}:` }),
    ).toHaveCount(1);
  await expect(
    article(page, 0).locator("li").filter({ hasText: combinedName }),
  ).toHaveCount(2);
  await expect(
    panel
      .getByRole("button", { name: /^Подписать через/ })
      .and(page.locator(":enabled")),
  ).toHaveCount(0);
  expect((await state(page)).providers).toMatchObject({
    NCALAYER: { available: false },
    EGOV_QR: { available: false },
  });
  const downloadPromise = page.waitForEvent("download");
  await article(page, 0)
    .getByRole("button", { name: "Скачать PDF", exact: true })
    .click();
  const download = await downloadPromise;
  const pdfPath = path.join(evidence, "synthetic-original.pdf");
  await download.saveAs(pdfPath);
  const bytes = await fs.readFile(pdfPath);
  expect(bytes.subarray(0, 4).toString("ascii")).toBe("%PDF");
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    seeded.state.documents[0].documentSha256,
  );
  await panel
    .locator("summary")
    .filter({ hasText: "ЭЦП: доступность и подписанты" })
    .click();
  await expect(panel).toContainText(
    "Настройки подписантов действуют только для новых выпусков.",
  );
  await panel
    .getByRole("link", { name: "Настроить подписантов ЭЦП", exact: true })
    .click();
  await expect(page).toHaveURL(/\/settings\?.*tab=signatories/);
  await page
    .getByRole("combobox", { name: "Пользователь", exact: true })
    .selectOption(seeded.accounts.DIRECTOR.id);
  await page
    .getByLabel("ФИО в документах / комиссии", { exact: true })
    .fill(combinedName);
  await page
    .getByLabel("ИИН владельца ЭЦП", { exact: true })
    .fill("000000000123");
  await page
    .getByRole("button", { name: "Сохранить привязку", exact: true })
    .click();
  await expect(
    page.getByText("Новая привязка подписанта сохранена.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Вернуться к заявке", exact: true })
    .click();
  panel = page.locator(".signing-panel");
  await expect(panel).toBeVisible();
  const frozen = await state(page);
  expect(
    frozen.documents.every(
      (document: { requiredSigners: { bindingId: string | null }[] }) =>
        document.requiredSigners.every((person) => person.bindingId === null),
    ),
  ).toBe(true);
  expect(
    (
      await db.issuanceWorkflow.findFirstOrThrow({
        where: { issuanceId: seeded.issued.issuanceId },
      })
    ).requiredSigners,
  ).toEqual(seeded.policy);
  expect(
    await db.documentSignature.count({
      where: { tenantId: seeded.context.tenantId },
    }),
  ).toBe(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await screenshot(page, "signing-unavailable-role-guidance-390");
  await page.getByRole("button", { name: "KZ", exact: true }).click();
  await expect(panel).toContainText(
    "ЭЦҚ қолжетімсіз. Қосылуды әкімші баптайды.",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await screenshot(page, "signing-unavailable-kz-390");
  await page.getByRole("button", { name: "RU", exact: true }).click();
  await page.setViewportSize({ width: 1366, height: 900 });
  await screenshot(page, "signing-unavailable-role-guidance-desktop");
});

for (const role of ["OPERATOR", "VIEWER"] as const) {
  test(`${role} can inspect originals but cannot configure EDS or attest paper signatures`, async ({
    page,
  }) => {
    const headers = await login(page, seeded.accounts[role]);
    const panel = await open(page);
    await expect(panel).toContainText(
      "передайте оригиналы директору для подтверждения",
    );
    await expect(panel.locator(".paper-document-signature")).toHaveCount(0);
    await panel
      .locator("summary")
      .filter({ hasText: "ЭЦП: доступность и подписанты" })
      .click();
    await expect(
      panel.getByRole("link", {
        name: "Настроить подписантов ЭЦП",
        exact: true,
      }),
    ).toHaveCount(0);
    const response = await page.request.post(
      `/api/print-requests/${seeded.request.id}/paper-signatures`,
      {
        headers,
        data: {
          documentIds: [seeded.state.documents[0].documentId],
          signedAt: "2026-11-08",
          signerNames: paperNames,
          reason: "Синтетическая проверка запрета роли",
          allRequiredSignaturesPresent: true,
        },
      },
    );
    expect(response.status()).toBe(403);
    expect(await paperCount(0)).toBe(0);
  });
}

test("failed signing state load recovers without retaining a stale error or inventing completion", async ({
  page,
}) => {
  await login(page, seeded.accounts.DIRECTOR);
  let unavailable = true;
  await page.route(
    `**/api/print-requests/${seeded.request.id}/signing*`,
    async (route) => {
      if (unavailable && route.request().method() === "GET")
        await route.abort("failed");
      else await route.continue();
    },
  );
  const panel = await open(page);
  await expect(panel.getByText(/Нет связи с сервером/)).toBeVisible();
  unavailable = false;
  await panel.getByRole("button", { name: "Обновить", exact: true }).click();
  await expect(panel.locator(".signing-document")).toHaveCount(2);
  await expect(panel.getByText(/Нет связи с сервером/)).toHaveCount(0);
  await expect(panel).not.toContainText("Выпуск оформлен");
  expect((await state(page)).status).toBe("AWAITING_SIGNATURE");
});

test("director explicitly attests the first original and recovers a failed refresh without another mutation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, seeded.accounts.DIRECTOR);
  const panel = await open(page);
  const form = await paperForm(page, 0);
  let posts = 0,
    rejectRefresh = false;
  await page.route(
    `**/api/print-requests/${seeded.request.id}/signing*`,
    async (route) => {
      if (rejectRefresh && route.request().method() === "GET") {
        rejectRefresh = false;
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await page.route(
    `**/api/print-requests/${seeded.request.id}/paper-signatures`,
    async (route) => {
      posts++;
      const response = await route.fetch();
      expect(response.ok(), await response.text()).toBe(true);
      rejectRefresh = true;
      await route.fulfill({ response });
    },
  );
  await expect(form.getByLabel("Дата подписания", { exact: true })).toHaveValue(
    "",
  );
  await expect(
    form.getByLabel("Проверены все обязательные подписи на бумажном оригинале"),
  ).not.toBeChecked();
  await screenshot(page, "paper-form-awaits-explicit-attestation-390");
  await form
    .getByRole("button", {
      name: "Зафиксировать бумажные подписи",
      exact: true,
    })
    .click();
  expect(posts).toBe(0);
  await form.getByLabel("Дата подписания", { exact: true }).fill("2026-11-08");
  await form
    .getByLabel("Основание проверки оригинала", { exact: true })
    .fill(
      "Синтетическая проверка подписанного бумажного оригинала, локальный тест",
    );
  await form
    .getByRole("button", {
      name: "Зафиксировать бумажные подписи",
      exact: true,
    })
    .click();
  expect(posts).toBe(0);
  await form
    .getByLabel("Проверены все обязательные подписи на бумажном оригинале")
    .check();
  await form
    .getByRole("button", {
      name: "Зафиксировать бумажные подписи",
      exact: true,
    })
    .click();
  await expect(form).toContainText(
    "Бумажные подписи сохранены. Обновите сведения о выпуске.",
  );
  await expect(
    form.getByRole("button", { name: "Обновить сведения", exact: true }),
  ).toBeVisible();
  await expect(
    form.getByLabel("Дата подписания", { exact: true }),
  ).toBeDisabled();
  await expect.poll(() => paperCount(0)).toBe(1);
  await form
    .getByRole("button", { name: "Обновить сведения", exact: true })
    .click();
  await expect(article(page, 0)).toContainText(
    "Бумажные подписи подтверждены руководителем",
  );
  await expect(article(page, 0).getByText(/Нет связи с сервером/)).toHaveCount(
    0,
  );
  expect(posts).toBe(1);
  const current = await state(page);
  expect(current.status).toBe("AWAITING_SIGNATURE");
  expect(
    current.documents.filter(
      (document: { complete: boolean }) => document.complete,
    ),
  ).toHaveLength(1);
  expect(current.archived).toBe(false);
  await expect(panel.getByText("ЭЦП проверена", { exact: false })).toHaveCount(
    0,
  );
  await screenshot(page, "paper-first-original-complete-390");
});

test("lost accepted paper response retries exactly the same attestation and completes only the real selected issuance", async ({
  page,
}) => {
  const latestProfile = await db.issuerProfileVersion.findFirstOrThrow({
    where: { tenantId: seeded.context.tenantId },
    orderBy: { version: "desc" },
  });
  await saveProfile(seeded.context, {
    ...(latestProfile.profile as object),
    headName: "Новый Синтетический Руководитель",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, seeded.accounts.DIRECTOR);
  const panel = await open(page);
  const form = await paperForm(page, 1);
  const bodies: string[] = [];
  let blockReads = false;
  await page.route(
    `**/api/print-requests/${seeded.request.id}/signing*`,
    async (route) => {
      if (blockReads && route.request().method() === "GET")
        await route.abort("failed");
      else await route.continue();
    },
  );
  await page.route(
    `**/api/print-requests/${seeded.request.id}/paper-signatures`,
    async (route) => {
      bodies.push(route.request().postData()!);
      const response = await route.fetch();
      expect(response.ok(), await response.text()).toBe(true);
      if (bodies.length === 1) {
        blockReads = true;
        await route.abort("failed");
      } else {
        blockReads = false;
        await route.fulfill({ response });
      }
    },
  );
  await form.getByLabel("Дата подписания", { exact: true }).fill("2026-11-08");
  await form
    .getByLabel("Основание проверки оригинала", { exact: true })
    .fill("Синтетическая проверка второго бумажного оригинала, локальный тест");
  await form
    .getByLabel("Проверены все обязательные подписи на бумажном оригинале")
    .check();
  await form
    .getByRole("button", {
      name: "Зафиксировать бумажные подписи",
      exact: true,
    })
    .click();
  await expect(form).toContainText("Ответ сервера не получен");
  await expect(
    form.getByLabel("Директор — ФИО на оригинале", { exact: true }),
  ).toBeDisabled();
  await expect(
    form.getByLabel("Дата подписания", { exact: true }),
  ).toBeDisabled();
  await expect.poll(() => paperCount(1)).toBe(1);
  await screenshot(page, "paper-unknown-response-390");
  await form
    .getByRole("button", { name: "Проверить сохранение", exact: true })
    .click();
  await expect(panel).toContainText("Выпуск оформлен");
  await expect(
    panel.getByText(/Ответ сервера не получен|Нет связи с сервером/),
  ).toHaveCount(0);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  expect(await paperCount(1)).toBe(1);
  const current = await state(page);
  expect(current.status).toBe("ISSUED");
  expect(
    current.documents.every(
      (document: { complete: boolean; paperSignature: unknown }) =>
        document.complete && document.paperSignature,
    ),
  ).toBe(true);
  expect(current.archived).toBe(true);
  expect(
    await db.documentSignature.count({
      where: { tenantId: seeded.context.tenantId },
    }),
  ).toBe(0);
  expect(
    (
      await db.issuanceWorkflow.findFirstOrThrow({
        where: { issuanceId: seeded.issued.issuanceId },
      })
    ).requiredSigners,
  ).toEqual(seeded.policy);
  for (const document of seeded.state.documents)
    expect(
      (
        await db.artifact.findUniqueOrThrow({
          where: { id: document.artifactId! },
        })
      ).sha256,
    ).toBe(document.documentSha256);
  await expect(panel.getByText("ЭЦП проверена", { exact: false })).toHaveCount(
    0,
  );
  await screenshot(page, "paper-issued-without-false-eds-390");
  await fs.writeFile(
    path.join(evidence, "paper-issued-state.json"),
    JSON.stringify(
      {
        requestId: seeded.request.id,
        issuanceId: seeded.issued.issuanceId,
        status: current.status,
        archived: current.archived,
        allPaperComplete: true,
        digitalSignatures: 0,
        lastAttestationPosts: bodies.length,
        sameAttestationBodyOnRetry: bodies[0] === bodies[1],
        unchangedOriginalHashes: true,
        syntheticOnly: true,
      },
      null,
      2,
    ),
  );
  const files = page.locator("#request-files");
  for (const details of await page
    .locator("details")
    .filter({ has: files })
    .all())
    if (!(await details.evaluate((node) => (node as HTMLDetailsElement).open)))
      await details.locator(":scope > summary").click();
  let failExport = true;
  await page.route(
    `**/api/print-requests/${seeded.request.id}/export`,
    async (route) => {
      if (failExport)
        await route.fulfill({
          status: 500,
          json: {
            code: "SYNTHETIC_EXPORT_FAILURE",
            message: "Синтетический отказ экспорта",
          },
        });
      else await route.continue();
    },
  );
  for (const button of ["Реестр XLSX", "Скачать ZIP"]) {
    failExport = true;
    await files.getByRole("button", { name: button, exact: true }).click();
    await expect(files).toContainText("Синтетический отказ экспорта");
    failExport = false;
    const received = page.waitForEvent("download");
    await files.getByRole("button", { name: button, exact: true }).click();
    const download = await received;
    const target = path.join(
      evidence,
      button === "Реестр XLSX"
        ? "recovered-issued-registry.xlsx"
        : "recovered-issued-bundle.zip",
    );
    await download.saveAs(target);
    expect((await fs.readFile(target)).subarray(0, 2).toString("ascii")).toBe(
      "PK",
    );
    await expect(files).not.toContainText("Синтетический отказ экспорта");
  }
  await fs.writeFile(
    path.join(evidence, "issued-export-recovery.json"),
    JSON.stringify(
      {
        requestId: seeded.request.id,
        issuanceId: seeded.issued.issuanceId,
        completedSigningUnlocksExportsWithoutManualRefresh: true,
        failedThenSuccessfulExports: ["XLSX", "ZIP"],
        successfulRetryClearsActionError: true,
        paperRoutine: {
          typedFields: 2,
          explicitAttestationCheckboxes: 1,
          saveClicks: 1,
          repeatedSignerNames: 0,
        },
      },
      null,
      2,
    ),
  );
});

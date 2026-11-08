import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { draftSchema } from "@demo/contracts";
import { provision } from "../../../scripts/setup";
import { db, type Context } from "../../../apps/api/src/core";
import {
  bootstrapSuperAdmin,
  saveProfile,
  saveUser,
  saveCustomer,
} from "../../../apps/api/src/settings";
import {
  createRequest,
  finalize,
  requestDetail,
} from "../../../apps/api/src/requests";
import { store } from "../../../apps/api/src/files";
import {
  claimJob,
  executeJob,
  heartbeat,
  settleFailure,
  DeferredJob,
} from "../../../apps/render-worker/src/queue";
import { assertTestDatabase } from "../../../tests/integration/test-database";

test.describe.configure({ mode: "serial" });
test.use({ trace: "off" });
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    "../../../.runtime/commission-flow/evidence/employer-person",
);
let seeded: Awaited<ReturnType<typeof fixture>>;
let uiIpRequestId: string;
let uiIpEmployerId: string;
const ipOwnRu = "«Синтетический Оператор»";
const ipOwnKz = "«Синтетикалық Оператор»";
const ipNameRu = `ИП ${ipOwnRu}`;
const ipNameKz = `${ipOwnKz} ЖК`;

function source(
  employerId?: string,
  names: { workplaceRu?: string; workplaceKz?: string } = {},
) {
  return draftSchema.parse({
    kind: "PERSON",
    schemaVersion: 2,
    demoMode: true,
    title: "Синтетическая проверка работодателя ИП и ТОО",
    items: [
      {
        id: randomUUID(),
        fullNameRu: "Синтетический Получатель",
        fullNameKz: "Синтетикалық Алушы",
        positionRu: "Рабочий",
        positionKz: "Жұмысшы",
        employeeCategory: "WORKER",
        employerId,
        ...names,
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
              source: "Синтетическая ведомость для локальной проверки",
            },
          },
        ],
      },
    ],
  });
}

async function fixture() {
  assertTestDatabase();
  expect(["127.0.0.1", "localhost"]).toContain(
    new URL(process.env.DATABASE_URL!).hostname,
  );
  const suffix = randomUUID(),
    password = `Synthetic-employer-${suffix}!`;
  const owner = await provision({
    email: `employer-${suffix}@example.test`,
    password,
    name: "Синтетический центр работодателей",
    sample: true,
  });
  const context: Context = {
    ...owner,
    role: "DIRECTOR",
    sessionId: "synthetic",
    csrfHash: "synthetic",
    correlationId: suffix,
  };
  await bootstrapSuperAdmin(context, {
    currentPassword: password,
    confirm: true,
  });
  context.role = "SUPER_ADMIN";
  const director = await saveUser(context, {
    email: `employer-director-${suffix}@example.test`,
    password,
    role: "DIRECTOR",
    displayName: "Синтетический директор",
  });
  const previous = await db.issuerProfileVersion.findFirstOrThrow({
    where: { tenantId: owner.tenantId },
    orderBy: { version: "desc" },
  });
  await saveProfile(context, {
    ...(previous.profile as object),
    headName: "Синтетический директор",
    commission: [
      { name: "Синтетический председатель", position: "Начальник УМО" },
      { name: "Синтетический директор", position: "Директор" },
      { name: "Синтетический преподаватель", position: "Преподаватель" },
    ],
    approved: true,
  });
  const known = await saveCustomer(context, {
    legalForm: "TOO",
    ownNameRu: "«Синтетический Берег»",
    ownNameKz: "«Синтетикалық Жаға»",
    bin: "000000000125",
    addressRu: "Синтетический адрес RU",
    addressKz: "Синтетикалық мекенжай KZ",
  });
  const ip = await saveCustomer(context, {
    legalForm: "IP",
    ownNameRu: "«Синтетический Мастер»",
    ownNameKz: "«Синтетикалық Шебер»",
    bin: "000000000126",
    addressRu: "Синтетический адрес ИП",
    addressKz: "Синтетикалық ЖК мекенжайы",
  });
  const foreignOwner = await provision({
    email: `employer-foreign-${suffix}@example.test`,
    password,
    name: "Другой синтетический центр",
    sample: true,
  });
  const foreignContext: Context = {
    ...foreignOwner,
    role: "DIRECTOR",
    sessionId: "synthetic",
    csrfHash: "synthetic",
    correlationId: suffix,
  };
  const foreign = await saveCustomer(foreignContext, {
    legalForm: "IP",
    ownNameRu: "Чужой синтетический работодатель",
    bin: "000000000127",
  });
  return {
    context,
    admin: { email: owner.email, password },
    director: { email: director.email, password },
    known,
    ip,
    foreign,
  };
}

async function login(page: Page) {
  await page.goto("/login");
  await page
    .getByLabel("Электронная почта", { exact: true })
    .fill(seeded.admin.email);
  await page.getByLabel("Пароль", { exact: true }).fill(seeded.admin.password);
  const response = page.waitForResponse(
    (value) =>
      value.url().endsWith("/api/auth/login") &&
      value.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  const result = await response;
  expect(result.ok(), `Synthetic login HTTP ${result.status()}`).toBe(true);
  const session = await result.json();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
  return {
    origin: process.env.DEMO_ORIGIN!,
    "x-csrf-token": session.csrfToken as string,
  };
}

async function open(page: Page, requestId: string) {
  await page.goto(`/requests/${requestId}/edit`);
  await page
    .getByRole("button", { name: "Изменить курсы", exact: true })
    .click();
  const section = page.getByRole("region", {
    name: "Работодатель для документов",
    exact: true,
  });
  await expect(section).toBeVisible();
  return section;
}

async function renderIssued(http: APIRequestContext, requestId: string) {
  const loggedIn = await http.post("/api/auth/login", {
    headers: { origin: process.env.DEMO_ORIGIN! },
    data: seeded.director,
  });
  expect(loggedIn.ok(), `Director login HTTP ${loggedIn.status()}`).toBe(true);
  const headers = {
    origin: process.env.DEMO_ORIGIN!,
    "x-csrf-token": (await loggedIn.json()).csrfToken as string,
  };
  const before = await requestDetail(seeded.context, requestId);
  const submitted = await http.post(
    `/api/print-requests/${requestId}/approval/submit`,
    { headers, data: { expectedRevision: before.revision } },
  );
  expect(submitted.ok(), await submitted.text()).toBe(true);
  const proposalId = (await submitted.json()).approval.proposalId;
  const proposal = await http.get(`/api/approvals/${proposalId}`);
  expect(proposal.ok()).toBe(true);
  const approved = await http.post(`/api/approvals/${proposalId}/decision`, {
    headers,
    data: {
      decision: "APPROVE",
      reason: "Синтетическая проверка двуязычного работодателя",
      expectedProposalHash: (await proposal.json()).proposalHash,
    },
  });
  expect(approved.ok(), await approved.text()).toBe(true);
  const current = await requestDetail(seeded.context, requestId);
  const issued = await finalize(
    seeded.context,
    requestId,
    { expectedRevision: current.revision },
    randomUUID(),
  );
  if (
    !issued ||
    typeof issued !== "object" ||
    !("issuanceId" in issued) ||
    typeof issued.issuanceId !== "string"
  )
    throw new Error("Expected synthetic immutable issuance");
  const issuanceId = issued.issuanceId;
  const worker = `employer-browser-${randomUUID()}`;
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    if (
      !(await db.generationJob.count({
        where: {
          tenantId: seeded.context.tenantId,
          issuanceId,
          status: { not: "SUCCEEDED" },
        },
      }))
    )
      break;
    const job = await claimJob(db, worker, seeded.context.tenantId);
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
      where: {
        tenantId: seeded.context.tenantId,
        issuanceId,
        status: { not: "SUCCEEDED" },
      },
    }),
  ).toBe(0);
  const artifacts = await db.artifact.findMany({
    where: { tenantId: seeded.context.tenantId, issuanceId, format: "PDF" },
  });
  expect(artifacts).toHaveLength(2);
  const issuance = await db.issuance.findUniqueOrThrow({
    where: { id: issuanceId },
  });
  return { artifacts, issuance };
}

test.beforeAll(async () => {
  await fs.mkdir(evidence, { recursive: true });
  seeded = await fixture();
});
test.afterAll(async () => {
  await db.$disconnect();
});
test.beforeEach(async ({ page }) => {
  await page.routeWebSocket(/\/_next\/webpack-hmr/, (socket) => socket.close());
});

test("a PERSONAL request keeps custom bilingual wording and refuses a foreign employer identity", async ({
  page,
}) => {
  const headers = await login(page);
  const created = await createRequest(
    seeded.context,
    source(seeded.known.id, {
      workplaceRu: "Особое собственное название",
      workplaceKz: "Арнайы атауы",
    }),
  );
  const resolved = await page.request.get(
    `/api/print-requests/${created.id}/resolved`,
  );
  expect(resolved.ok()).toBe(true);
  expect((await resolved.json()).draft.items[0]).toMatchObject({
    employerId: seeded.known.id,
    workplaceRu: "Особое собственное название",
    workplaceKz: "Арнайы атауы",
    employerBin: seeded.known.bin,
  });
  const foreign = await page.request.post("/api/print-requests", {
    headers,
    data: source(seeded.foreign.id),
  });
  expect(foreign.status()).toBe(404);
  expect(
    (await page.request.get(`/api/customers/${seeded.foreign.id}`)).status(),
  ).toBe(404);
  const single = await createRequest(
    seeded.context,
    source(seeded.known.id, { workplaceRu: "Только своё наименование" }),
  );
  const singleResolved = await page.request.get(
    `/api/print-requests/${single.id}/resolved`,
  );
  expect(singleResolved.ok()).toBe(true);
  expect((await singleResolved.json()).draft.items[0]).toMatchObject({
    workplaceRu: "Только своё наименование",
    workplaceKz: "Только своё наименование",
  });
});

test("PERSON employer form immediately shows IP and TOO in both languages and creates a prefilled directory entry", async ({
  page,
}) => {
  await login(page);
  const created = await createRequest(seeded.context, source());
  uiIpRequestId = created.id;
  await page.setViewportSize({ width: 390, height: 844 });
  let section = await open(page, created.id);
  const form = section.getByRole("combobox", {
    name: "Форма работодателя",
    exact: true,
  });
  await form.selectOption("IP");
  await section
    .getByLabel("Название работодателя · RU", { exact: true })
    .fill(ipOwnRu);
  await section
    .getByLabel("Название работодателя · KZ", { exact: true })
    .fill(ipOwnKz);
  const preview = section.locator(".organization-name-preview");
  await expect(preview).toContainText(ipNameRu);
  await expect(preview).toContainText(ipNameKz);
  await form.selectOption("TOO");
  await expect(preview).toContainText(`ТОО ${ipOwnRu}`);
  await expect(preview).toContainText(`${ipOwnKz} ЖШС`);
  await expect
    .poll(
      async () => (await requestDetail(seeded.context, created.id)).items?.[0],
    )
    .toMatchObject({
      workplaceRu: `ТОО ${ipOwnRu}`,
      workplaceKz: `${ipOwnKz} ЖШС`,
      workplaceNaming: { legalForm: "TOO" },
    });
  await page.reload();
  await page
    .getByRole("button", { name: "Изменить курсы", exact: true })
    .click();
  section = page.getByRole("region", {
    name: "Работодатель для документов",
    exact: true,
  });
  await expect(
    section.getByRole("combobox", { name: "Форма работодателя", exact: true }),
  ).toHaveValue("TOO");
  await expect(
    section.getByLabel("Название работодателя · KZ", { exact: true }),
  ).toHaveValue(ipOwnKz);
  await section
    .getByRole("combobox", { name: "Форма работодателя", exact: true })
    .selectOption("IP");
  await expect
    .poll(
      async () => (await requestDetail(seeded.context, created.id)).items?.[0],
    )
    .toMatchObject({
      workplaceRu: ipNameRu,
      workplaceKz: ipNameKz,
      workplaceNaming: { legalForm: "IP" },
    });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await section.screenshot({
    path: path.join(evidence, "employer-ip-immediate-ru-390.png"),
  });
  await page.getByRole("button", { name: "KZ", exact: true }).click();
  await expect(section.locator(".organization-name-preview")).toContainText(
    ipNameKz,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await section.screenshot({
    path: path.join(evidence, "employer-ip-immediate-kz-390.png"),
  });
  await page.getByRole("button", { name: "RU", exact: true }).click();
  await section
    .getByRole("button", {
      name: "Сохранить работодателя в справочник",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Новая организация",
    exact: true,
  });
  await expect(dialog.locator(".organization-name-preview")).toContainText(
    ipNameRu,
  );
  await expect(dialog.locator(".organization-name-preview")).toContainText(
    ipNameKz,
  );
  const creationAttempts: { body: string; key: string; id: string }[] = [];
  await page.route("**/api/customers", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    expect(response.ok(), await response.text()).toBe(true);
    creationAttempts.push({
      body: route.request().postData()!,
      key: route.request().headers()["idempotency-key"],
      id: (await response.json()).id,
    });
    if (creationAttempts.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Проверить сохранение", exact: true }),
  ).toBeVisible();
  await expect(dialog.locator("input").first()).toBeDisabled();
  await expect(dialog.locator(".organization-name-preview")).toContainText(
    ipNameRu,
  );
  await expect(dialog.locator(".organization-name-preview")).toContainText(
    ipNameKz,
  );
  await dialog
    .getByRole("button", { name: "Проверить сохранение", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(creationAttempts).toHaveLength(2);
  expect(creationAttempts[0].key).toMatch(/^[a-zA-Z0-9_-]{16,128}$/);
  expect(creationAttempts[1]).toEqual(creationAttempts[0]);
  expect(
    await db.customerOrganization.count({
      where: { tenantId: seeded.context.tenantId, nameRu: ipNameRu },
    }),
  ).toBe(1);
  await expect
    .poll(
      async () =>
        (await requestDetail(seeded.context, created.id)).items?.[0].employerId,
    )
    .toBeTruthy();
  const current = await requestDetail(seeded.context, created.id);
  uiIpEmployerId = current.items![0].employerId!;
  expect(current.items![0]).toMatchObject({
    workplaceRu: ipNameRu,
    workplaceKz: ipNameKz,
  });
  const saved = await db.customerOrganization.findUniqueOrThrow({
    where: { id: uiIpEmployerId },
  });
  expect(saved).toMatchObject({
    nameRu: ipNameRu,
    nameKz: ipNameKz,
    legalForm: "IP",
    ownNameRu: ipOwnRu,
    ownNameKz: ipOwnKz,
  });
  await expect(
    section.getByRole("combobox", { name: "Форма работодателя", exact: true }),
  ).toHaveValue("IP");
  await page
    .locator(".person-editor")
    .getByRole("button", { name: "Готово", exact: true })
    .click();
  await expect(page.locator(".person-summary-employer")).toContainText(
    ipNameRu,
  );
  await expect(page.locator(".person-summary-employer")).toContainText(
    ipNameKz,
  );
  await page
    .getByRole("button", { name: "Изменить работодателя", exact: true })
    .click();
  await expect(
    section.getByLabel("Название работодателя · RU", { exact: true }),
  ).toBeFocused();
  await page.reload();
  await page
    .getByRole("button", { name: "Изменить работодателя", exact: true })
    .click();
  await expect(
    section.getByRole("combobox", { name: "Форма работодателя", exact: true }),
  ).toHaveValue("IP");
  await expect(
    section.getByLabel("Название работодателя · KZ", { exact: true }),
  ).toHaveValue(ipOwnKz);
  await page.setViewportSize({ width: 1366, height: 900 });
  await section.screenshot({
    path: path.join(evidence, "employer-ip-linked-desktop.png"),
  });
});

test("selecting an existing employer fills both languages once and local changes and unlinking preserve document wording", async ({
  page,
}) => {
  await login(page);
  const created = await createRequest(seeded.context, source());
  let section = await open(page, created.id);
  await section
    .getByRole("button", { name: "Выбрать работодателя", exact: true })
    .click();
  const picker = page.getByRole("dialog", {
    name: "Найти заказчика",
    exact: true,
  });
  await picker
    .getByRole("row")
    .filter({ hasText: seeded.known.nameRu })
    .getByRole("button", { name: "Выбрать", exact: true })
    .click();
  await expect(picker).toHaveCount(0);
  await expect
    .poll(
      async () => (await requestDetail(seeded.context, created.id)).items?.[0],
    )
    .toMatchObject({
      employerId: seeded.known.id,
      workplaceRu: seeded.known.nameRu,
      workplaceKz: seeded.known.nameKz,
      employerBin: seeded.known.bin,
      employerAddressRu: seeded.known.addressRu,
      employerAddressKz: seeded.known.addressKz,
    });
  await expect(
    section.getByRole("combobox", { name: "Форма работодателя", exact: true }),
  ).toHaveValue("TOO");
  await section
    .getByLabel("Название работодателя · RU", { exact: true })
    .fill("«Особый отдел»");
  await section
    .getByLabel("Название работодателя · KZ", { exact: true })
    .fill("«Арнайы бөлім»");
  const expected = {
    employerId: seeded.known.id,
    workplaceRu: "ТОО «Особый отдел»",
    workplaceKz: "«Арнайы бөлім» ЖШС",
  };
  await expect
    .poll(
      async () => (await requestDetail(seeded.context, created.id)).items?.[0],
    )
    .toMatchObject(expected);
  await page.reload();
  await page
    .getByRole("button", { name: "Изменить курсы", exact: true })
    .click();
  section = page.getByRole("region", {
    name: "Работодатель для документов",
    exact: true,
  });
  await expect(
    section.getByLabel("Название работодателя · RU", { exact: true }),
  ).toHaveValue("«Особый отдел»");
  await expect(
    section.getByLabel("Название работодателя · KZ", { exact: true }),
  ).toHaveValue("«Арнайы бөлім»");
  expect(
    await db.customerOrganization.findUniqueOrThrow({
      where: { id: seeded.known.id },
    }),
  ).toMatchObject({ nameRu: seeded.known.nameRu, nameKz: seeded.known.nameKz });
  await section
    .getByRole("button", { name: "Убрать связь со справочником", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await requestDetail(seeded.context, created.id)).items?.[0]
          .employerId || null,
    )
    .toBe(null);
  expect(
    (await requestDetail(seeded.context, created.id)).items?.[0],
  ).toMatchObject({
    workplaceRu: expected.workplaceRu,
    workplaceKz: expected.workplaceKz,
    employerBin: seeded.known.bin,
    employerAddressRu: seeded.known.addressRu,
    employerAddressKz: seeded.known.addressKz,
  });
});

test("a linked employer hydrates genuinely empty wording while an imported custom single-language name remains untouched", async ({
  page,
}) => {
  await login(page);
  const empty = await createRequest(seeded.context, source(seeded.known.id));
  await open(page, empty.id);
  await expect
    .poll(
      async () => (await requestDetail(seeded.context, empty.id)).items?.[0],
    )
    .toMatchObject({
      employerId: seeded.known.id,
      workplaceRu: seeded.known.nameRu,
      workplaceKz: seeded.known.nameKz,
    });
  const custom = await createRequest(
    seeded.context,
    source(seeded.known.id, {
      workplaceRu: "Авторское название без изменения",
    }),
  );
  const section = await open(page, custom.id);
  await expect(
    section.getByLabel("Название работодателя · RU", { exact: true }),
  ).toHaveValue("Авторское название без изменения");
  await expect(
    section.getByLabel("Название работодателя · KZ", { exact: true }),
  ).toHaveValue("");
  await expect(
    section.getByRole("combobox", { name: "Форма работодателя", exact: true }),
  ).toHaveValue("");
  await page.reload();
  await page
    .getByRole("button", { name: "Изменить курсы", exact: true })
    .click();
  await expect(
    section.getByLabel("Название работодателя · RU", { exact: true }),
  ).toHaveValue("Авторское название без изменения");
  await expect(
    section.getByLabel("Название работодателя · KZ", { exact: true }),
  ).toHaveValue("");
  expect(
    (await requestDetail(seeded.context, custom.id)).items?.[0],
  ).toMatchObject({
    workplaceRu: "Авторское название без изменения",
    workplaceKz: "",
  });
});

test("failed and delayed employer lookups preserve newer locally entered RU and KZ names", async ({
  page,
}) => {
  await login(page);
  const pattern = `**/api/customers/${seeded.known.id}`;
  const existing = await createRequest(
    seeded.context,
    source(seeded.known.id, {
      workplaceRu: "Сохранённый вариант RU",
      workplaceKz: "Сақталған нұсқа KZ",
    }),
  );
  let failed = true;
  await page.route(pattern, async (route) => {
    if (failed) await route.abort("failed");
    else await route.continue();
  });
  let section = await open(page, existing.id);
  await expect(section).toContainText(
    "Не удалось загрузить карточку работодателя",
  );
  await expect(
    section.getByLabel("Название работодателя · RU", { exact: true }),
  ).toHaveValue("Сохранённый вариант RU");
  await expect(
    section.getByLabel("Название работодателя · KZ", { exact: true }),
  ).toHaveValue("Сақталған нұсқа KZ");
  await section
    .getByLabel("Название работодателя · RU", { exact: true })
    .fill("Новый локальный вариант RU");
  failed = false;
  await section
    .getByRole("button", { name: "Повторить загрузку", exact: true })
    .click();
  await expect(section).not.toContainText(
    "Не удалось загрузить карточку работодателя",
  );
  await expect(section).toContainText(seeded.known.nameRu);
  await expect(
    section.getByLabel("Название работодателя · RU", { exact: true }),
  ).toHaveValue("Новый локальный вариант RU");
  await expect
    .poll(
      async () => (await requestDetail(seeded.context, existing.id)).items?.[0],
    )
    .toMatchObject({
      workplaceRu: "Новый локальный вариант RU",
      workplaceKz: "Сақталған нұсқа KZ",
    });
  await page.unroute(pattern);
  const empty = await createRequest(seeded.context, source(seeded.known.id));
  await page.goto(`/requests/${empty.id}/edit`);
  await expect(
    page.getByRole("button", { name: "Изменить курсы", exact: true }),
  ).toBeVisible();
  let held = 0,
    completed = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(pattern, async (route) => {
    held++;
    await gate;
    await route.continue();
    completed++;
  });
  await page
    .getByRole("button", { name: "Изменить курсы", exact: true })
    .click();
  section = page.getByRole("region", {
    name: "Работодатель для документов",
    exact: true,
  });
  await expect.poll(() => held).toBeGreaterThan(0);
  await section
    .getByLabel("Название работодателя · RU", { exact: true })
    .fill("Ручной ввод до ответа справочника");
  await section
    .getByLabel("Название работодателя · KZ", { exact: true })
    .fill("Анықтамалық жауабына дейінгі атау");
  release();
  await expect.poll(() => completed).toBeGreaterThan(0);
  await expect(section).toContainText(seeded.known.nameRu);
  await expect(
    section.getByLabel("Название работодателя · RU", { exact: true }),
  ).toHaveValue("Ручной ввод до ответа справочника");
  await expect(
    section.getByLabel("Название работодателя · KZ", { exact: true }),
  ).toHaveValue("Анықтамалық жауабына дейінгі атау");
  await expect
    .poll(
      async () => (await requestDetail(seeded.context, empty.id)).items?.[0],
    )
    .toMatchObject({
      workplaceRu: "Ручной ввод до ответа справочника",
      workplaceKz: "Анықтамалық жауабына дейінгі атау",
    });
  await page.unroute(pattern);
  const cleared = await createRequest(seeded.context, source(seeded.known.id));
  await page.goto(`/requests/${cleared.id}/edit`);
  await expect(
    page.getByRole("button", { name: "Изменить курсы", exact: true }),
  ).toBeVisible();
  let blankLookupHeld = false,
    blankLookupCompleted = false;
  let releaseBlank!: () => void;
  const blankGate = new Promise<void>((resolve) => {
    releaseBlank = resolve;
  });
  await page.route(pattern, async (route) => {
    blankLookupHeld = true;
    await blankGate;
    await route.continue();
    blankLookupCompleted = true;
  });
  await page
    .getByRole("button", { name: "Изменить курсы", exact: true })
    .click();
  await expect.poll(() => blankLookupHeld).toBe(true);
  await section
    .getByRole("combobox", { name: "Форма работодателя", exact: true })
    .selectOption("IP");
  await section
    .getByLabel("Название работодателя · RU", { exact: true })
    .fill("Временный ввод");
  await section
    .getByLabel("Название работодателя · RU", { exact: true })
    .fill("");
  releaseBlank();
  await expect.poll(() => blankLookupCompleted).toBe(true);
  await expect(section).toContainText(seeded.known.nameRu);
  await expect(
    section.getByRole("combobox", { name: "Форма работодателя", exact: true }),
  ).toHaveValue("IP");
  await expect(
    section.getByLabel("Название работодателя · RU", { exact: true }),
  ).toHaveValue("");
  await expect(
    section.getByLabel("Название работодателя · KZ", { exact: true }),
  ).toHaveValue("");
  await expect
    .poll(
      async () => (await requestDetail(seeded.context, cleared.id)).items?.[0],
    )
    .toMatchObject({
      workplaceRu: "",
      workplaceKz: "",
      workplaceNaming: { legalForm: "IP" },
    });
});

test("the real bilingual PDF prints the UI-entered IP employer and an issued original never follows later directory changes", async ({
  request,
}) => {
  test.setTimeout(420_000);
  expect(uiIpRequestId).toBeTruthy();
  const rendered = await renderIssued(request, uiIpRequestId);
  const manifest: {
    filename: string;
    sha256: string;
    textHasBothNames: boolean;
  }[] = [];
  const python = process.env.DEMO_E2E_PDF_PYTHON;
  if (!python)
    throw new Error(
      "DEMO_E2E_PDF_PYTHON is required for actual PDF text verification",
    );
  for (const artifact of rendered.artifacts) {
    const buffer = await store.read(artifact.storageKey, artifact.sha256);
    expect(createHash("sha256").update(buffer).digest("hex")).toBe(
      artifact.sha256,
    );
    const filename = `employer-ip-${artifact.id}.pdf`;
    const target = path.join(evidence, filename);
    await fs.writeFile(target, buffer);
    const text = execFileSync(
      python,
      [
        "-c",
        "from pypdf import PdfReader; import sys; print(' '.join(' '.join((page.extract_text() or '').split()) for page in PdfReader(sys.argv[1]).pages))",
        target,
      ],
      { encoding: "utf8", env: { ...process.env, PYTHONUTF8: "1" } },
    );
    expect(text).toContain(ipNameRu);
    expect(text).toContain(ipNameKz);
    expect(text).not.toContain(`ТОО ${ipNameRu}`);
    expect(text).not.toContain(`${ipNameKz} ЖШС`);
    await fs.writeFile(`${target}.txt`, text, "utf8");
    manifest.push({
      filename,
      sha256: artifact.sha256,
      textHasBothNames: true,
    });
  }
  await saveCustomer(
    seeded.context,
    {
      nameRu: "Новое название в справочнике",
      nameKz: "Анықтамалықтағы жаңа атауы",
      bin: "",
      addressRu: "",
      addressKz: "",
    },
    uiIpEmployerId,
  );
  expect(
    (
      await db.issuance.findUniqueOrThrow({
        where: { id: rendered.issuance.id },
      })
    ).snapshot,
  ).toEqual(rendered.issuance.snapshot);
  for (const artifact of rendered.artifacts) {
    expect(
      (await db.artifact.findUniqueOrThrow({ where: { id: artifact.id } }))
        .sha256,
    ).toBe(artifact.sha256);
    expect(
      createHash("sha256")
        .update(await store.read(artifact.storageKey, artifact.sha256))
        .digest("hex"),
    ).toBe(artifact.sha256);
  }
  await fs.writeFile(
    path.join(evidence, "bilingual-pdf-manifest.json"),
    JSON.stringify(
      {
        requestId: uiIpRequestId,
        issuanceId: rendered.issuance.id,
        employerRu: ipNameRu,
        employerKz: ipNameKz,
        artifacts: manifest,
        originalUnchangedAfterDirectoryEdit: true,
      },
      null,
      2,
    ),
  );
});

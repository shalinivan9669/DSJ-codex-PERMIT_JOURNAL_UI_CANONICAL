import { validateRequestFromMenu } from "./request-validation";
import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import {
  draftSchema,
  mandatoryTemplates,
  type TrainingDirection,
} from "@demo/contracts";
import { provision } from "../../../scripts/setup";
import { db, type Context } from "../../../apps/api/src/core";
import {
  bootstrapSuperAdmin,
  saveProfile,
  saveCustomer,
  saveUser,
} from "../../../apps/api/src/settings";
import { createRequest } from "../../../apps/api/src/requests";
import { uploadPhoto, store } from "../../../apps/api/src/files";
import { signingState } from "../../../apps/api/src/signing";
import {
  claimJob,
  executeJob,
  heartbeat,
  settleFailure,
  DeferredJob,
} from "../../../apps/render-worker/src/queue";
import { assertTestDatabase } from "../../../tests/integration/test-database";

test.use({ trace: "off" });
const sharp = createRequire(path.resolve(__dirname, "../../api/package.json"))(
  "sharp",
);
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    "../../../.runtime/commission-flow/evidence/person-director-transfer",
);

async function fixture(company = false) {
  assertTestDatabase();
  expect(["127.0.0.1", "localhost"]).toContain(
    new URL(process.env.DATABASE_URL!).hostname,
  );
  const suffix = randomUUID(),
    password = `Synthetic-transfer-${suffix}!`;
  const owner = await provision({
    email: `transfer-${suffix}@example.test`,
    password,
    name: "Синтетическая передача физлица директору",
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
  const operator = await saveUser(context, {
    email: `transfer-operator-${suffix}@example.test`,
    password,
    displayName: "Синтетический оператор",
    role: "OPERATOR",
  });
  const director = await saveUser(context, {
    email: `transfer-director-${suffix}@example.test`,
    password,
    displayName: "Синтетический директор",
    role: "DIRECTOR",
  });
  const previous = await db.issuerProfileVersion.findFirstOrThrow({
    where: { tenantId: owner.tenantId },
    orderBy: { version: "desc" },
  });
  await saveProfile(context, {
    ...(previous.profile as object),
    headName: "Синтетический директор",
    approved: true,
    commission: [
      { name: "Синтетический председатель", position: "Начальник УМО" },
      { name: "Синтетический директор", position: "Директор" },
      { name: "Синтетический преподаватель", position: "Преподаватель" },
    ],
  });
  const buffer = await sharp({
    create: {
      width: 360,
      height: 480,
      channels: 3,
      background: { r: 205, g: 215, b: 225 },
    },
  })
    .png()
    .toBuffer();
  const photo = await uploadPhoto(
    context,
    {
      buffer,
      mimetype: "image/png",
      originalname: "synthetic-placeholder.png",
      size: buffer.length,
    } as Express.Multer.File,
    {},
  );
  const source = draftSchema.parse({
    kind: company ? "COMPANY" : "PERSON",
    customerId: company
      ? (
          await saveCustomer(context, {
            nameRu: "Синтетическое ТОО для возврата директором",
            nameKz: "Директор қайтаруына арналған синтетикалық ЖШС",
            bin: "000000000129",
            addressRu: "Синтетический адрес",
            addressKz: "Синтетикалық мекенжай",
          })
        ).id
      : undefined,
    schemaVersion: 2,
    demoMode: true,
    title: "Синтетическое физлицо: БиОТ ИТР, ПТМ, ПБ",
    items: [
      {
        id: randomUUID(),
        fullNameRu: "Синтетический Получатель",
        fullNameKz: "Синтетикалық Алушы",
        positionRu: "Инженер",
        positionKz: "Инженер",
        employeeCategory: "ITR",
        photoAssetId: photo.id,
        workplaceRu: "ИП «Синтетическая Компания»",
        workplaceKz: "«Синтетикалық Компания» ЖК",
        employerBin: "000000000128",
        employerAddressRu: "Синтетический адрес",
        employerAddressKz: "Синтетикалық мекенжай",
        assignments: (["BIOT", "PTM", "PB"] as TrainingDirection[]).map(
          (direction) => ({
            id: randomUUID(),
            templateId: mandatoryTemplates(direction, "ITR")[0],
            documentDate: "2026-11-08",
            protocolDate: "2026-11-08",
            trainingStart: "2026-11-01",
            trainingEnd: "2026-11-07",
            trainingSubject: `Синтетическая программа ${direction}`,
            hours: direction === "BIOT" ? "40" : "16",
            biotCategory: direction === "BIOT" ? "ITR_STANDARD" : undefined,
            biotCheckType: direction === "BIOT" ? "PERIODIC" : undefined,
            result: "Сдал",
            outcome: {
              status: "PASSED",
              source: "Синтетическая ведомость для локального теста",
            },
          }),
        ),
      },
    ],
  });
  const request = await createRequest(
    { ...context, userId: operator.id, role: "OPERATOR" },
    source,
  );
  expect(request.items?.[0].assignments).toHaveLength(6);
  return {
    context,
    request,
    operator: { id: operator.id, email: operator.email, password },
    director: { email: director.email, password },
  };
}

async function login(page: Page, account: { email: string; password: string }) {
  await page.goto("/login");
  await page
    .getByLabel("Электронная почта", { exact: true })
    .fill(account.email);
  await page.getByLabel("Пароль", { exact: true }).fill(account.password);
  const pending = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/auth/login") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  const response = await pending;
  expect(response.ok(), `Login HTTP ${response.status()}`).toBe(true);
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
}

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket(/\/_next\/webpack-hmr/, (socket) => socket.close());
});
test.afterAll(async () => {
  await db.$disconnect();
});

test("failed current-request result preparation blocks transfer, preserves input and explicitly recovers before another PERSON request", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await fs.mkdir(evidence, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const seeded = await fixture();
  const person = seeded.request.items?.[0];
  if (!person) throw new Error("SYNTHETIC_RECIPIENT_MISSING");
  const assignment = person.assignments.find(
    (row) => row.templateId === "ptm-card",
  );
  if (!assignment) throw new Error("SYNTHETIC_COURSE_MISSING");
  const customer = await saveCustomer(seeded.context, {
    nameRu: "Синтетическая компания сохранения результата",
    nameKz: "Синтетикалық нәтиже компаниясы",
    bin: "000000000129",
    addressRu: "Синтетический адрес",
    addressKz: "Синтетикалық мекенжай",
  });
  const eventId = randomUUID();
  const company = await createRequest(
    { ...seeded.context, userId: seeded.operator.id, role: "OPERATOR" },
    draftSchema.parse({
      kind: "COMPANY",
      schemaVersion: 2,
      demoMode: true,
      customerId: customer.id,
      title: "Синтетическая проверка сохранения результата",
      commonFields: { documentDate: "2026-11-08" },
      events: [
        {
          id: eventId,
          title: "Синтетическое обучение ПТМ",
          protocolTemplateId: "ptm-protocol",
          protocolMode: "GROUP",
          commonFields: {
            documentDate: assignment.documentDate,
            protocolDate: assignment.protocolDate,
            trainingStart: assignment.trainingStart,
            trainingEnd: assignment.trainingEnd,
            trainingSubject: assignment.trainingSubject,
            hours: assignment.hours,
          },
        },
      ],
      items: [
        {
          ...person,
          id: randomUUID(),
          assignments: [
            { ...assignment, id: randomUUID(), eventId, protocolMode: "GROUP" },
          ],
        },
      ],
    }),
  );
  await login(page, seeded.operator);
  await page.goto(`/requests/${company.id}/edit`);
  const checked = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/print-requests/${company.id}/validate`) &&
      response.request().method() === "POST",
  );
  await validateRequestFromMenu(page);
  const validated = await checked;
  expect((await validated.json()).valid).toBe(true);
  await expect(page.locator(".validation-result")).toContainText(
    "Данные прошли проверку",
  );
  const training = page.locator("#request-training");
  if (!(await training.evaluate((node) => (node as HTMLDetailsElement).open)))
    await training.locator(":scope > summary").click();
  const outcome = training.locator(
    '.training-primary-context details.outcome-entry:has(> summary[data-training-field="outcomes"])',
  );
  if (!(await outcome.evaluate((node) => (node as HTMLDetailsElement).open)))
    await outcome.locator(":scope > summary").click();
  const source = outcome.getByLabel("Источник подтверждения", { exact: true });
  const marker = "Синтетическая подготовка, ещё не применённая к результатам";
  await page.evaluate(
    ({ requestId }) => {
      const original = Storage.prototype.setItem;
      const scope = window as unknown as {
        restorePreparationStorage: () => void;
        preparationWriteAttempts: number;
      };
      scope.preparationWriteAttempts = 0;
      scope.restorePreparationStorage = () => {
        Storage.prototype.setItem = original;
      };
      Storage.prototype.setItem = function (key, value) {
        if (
          key.startsWith("demo:preparation:v1:") &&
          key.includes(`:${requestId}:outcome:`)
        ) {
          scope.preparationWriteAttempts++;
          throw new DOMException(
            "Синтетический отказ хранилища подготовки",
            "QuotaExceededError",
          );
        }
        return original.call(this, key, value);
      };
    },
    { requestId: company.id },
  );
  await source.fill(marker);
  await expect(outcome).toContainText(
    "Синтетический отказ хранилища подготовки",
  );
  await outcome.locator(":scope > summary").click();
  const submissions: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/approval/submit")
    )
      submissions.push(request.url());
  });
  const panel = page.getByRole("region", {
    name: "Готовность и состав следующего выпуска",
    exact: true,
  });
  await panel
    .getByRole("button", { name: /^Проверить и передать директору/ })
    .click();
  await expect(panel).toContainText("Не удалось сохранить изменения");
  await expect(panel).toContainText(
    "Сохраните или отмените подготовку результата",
  );
  expect(submissions).toEqual([]);
  await expect(source).toHaveValue(marker);
  await panel.screenshot({
    path: path.join(
      evidence,
      "current-preparation-failure-blocks-transfer.png",
    ),
  });
  await panel
    .getByRole("button", { name: "Исправить первое замечание", exact: true })
    .click();
  const retryPreparation = outcome.getByRole("button", {
    name: "Повторить сохранение подготовки",
    exact: true,
  });
  await expect(retryPreparation).toBeFocused();
  await expect(source).toBeVisible();
  await outcome.screenshot({
    path: path.join(evidence, "addressed-preparation-repair-390.png"),
  });
  await page
    .getByRole("button", { name: "Дополнительные действия", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Прочее", exact: true })
    .getByRole("button", { name: "Общие даты и протоколы", exact: true })
    .click();
  const dates = page.getByRole("dialog", {
    name: "Общие даты и протоколы",
    exact: true,
  });
  const modalPreparation = dates.locator(
    `[data-preparation-target="${eventId}"][data-preparation-kind="outcome"]`,
  );
  await expect(
    page.locator(
      `[data-preparation-target="${eventId}"][data-preparation-kind="outcome"]`,
    ),
  ).toHaveCount(1);
  if (
    !(await modalPreparation.evaluate(
      (node) => (node as HTMLDetailsElement).open,
    ))
  )
    await modalPreparation.locator(":scope > summary").click();
  await expect(
    modalPreparation.getByLabel("Источник подтверждения", { exact: true }),
  ).toHaveValue(marker);
  await dates
    .getByRole("button", { name: "Закрыть диалог", exact: true })
    .click();
  await expect(dates).toHaveCount(0);
  if (!(await outcome.evaluate((node) => (node as HTMLDetailsElement).open)))
    await outcome.locator(":scope > summary").click();
  await expect(source).toHaveValue(marker);
  await expect(
    page.locator(
      `[data-preparation-target="${eventId}"][data-preparation-kind="outcome"]`,
    ),
  ).toHaveCount(1);
  await page.evaluate(() =>
    (
      window as unknown as { restorePreparationStorage: () => void }
    ).restorePreparationStorage(),
  );
  await retryPreparation.click();
  await expect(outcome.locator(".preparation-status")).toContainText(
    "сохранена в этом браузере, не применена",
  );
  await expect(source).toHaveValue(marker);
  const sent = page.waitForResponse(
    (response) =>
      response
        .url()
        .endsWith(`/print-requests/${company.id}/approval/submit`) &&
      response.request().method() === "POST",
  );
  await panel
    .getByRole("button", { name: "Проверить и передать повторно", exact: true })
    .click();
  expect((await sent).status()).toBe(201);
  await expect(panel).toContainText("Выбранный состав на согласовании");
  const after = await (
    await page.request.get(`/api/print-requests/${company.id}`)
  ).json();
  expect(
    after.items[0].assignments.every(
      (row: { outcome?: { source?: string } }) =>
        row.outcome?.source !== marker,
    ),
  ).toBe(true);

  // Ordinary client navigation must retain the recovered draft without affecting another request.
  await page.locator('main a[href="/requests"]').click();
  await expect(page).toHaveURL(/\/requests$/);
  await page
    .locator(
      `a[href="/requests/${seeded.request.id}/edit"], a[href="/requests/${seeded.request.id}"]`,
    )
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(seeded.request.id));
  const personPanel = page.getByRole("region", {
    name: "Готовность и состав следующего выпуска",
    exact: true,
  });
  await expect(personPanel).toContainText("Готовы к передаче: 3 из 3 курсов.");
  const personSent = page.waitForResponse(
    (response) =>
      response
        .url()
        .endsWith(`/print-requests/${seeded.request.id}/approval/submit`) &&
      response.request().method() === "POST",
  );
  await personPanel
    .getByRole("button", { name: /^Проверить и передать директору/ })
    .click();
  expect((await personSent).status()).toBe(201);
  await expect(personPanel).toContainText("Выбранный состав на согласовании");
  await fs.writeFile(
    path.join(evidence, "preparation-recovery-acceptance.json"),
    JSON.stringify(
      {
        companyRequestId: company.id,
        personRequestId: seeded.request.id,
        validBeforeStorageFailure: true,
        blockedBeforeAnySubmit: true,
        explicitRetryPreservedUnappliedInput: true,
        repairActionOpenedAndFocusedExactPreparation: true,
        modalRoundTripPreservedSinglePreparationOwner: true,
        noImplicitOutcomeApply: true,
        bothRequestsTransferred: submissions.length === 2,
      },
      null,
      2,
    ),
  );
});

for (const kind of ["PERSON", "COMPANY"] as const)
  test(`completed ${kind} ITR BIOT, PTM and PB transfers six exact documents through director approval to real signing readiness`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(600_000);
    await fs.mkdir(evidence, { recursive: true });
    const seeded = await fixture(kind === "COMPANY");
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, seeded.operator);
    await page.goto(`/requests/${seeded.request.id}/edit`);
    const checked = page.waitForResponse(
      (response) =>
        response
          .url()
          .endsWith(`/print-requests/${seeded.request.id}/validate`) &&
        response.request().method() === "POST",
    );
    await validateRequestFromMenu(page);
    const validation = await checked;
    const validationBody = await validation.json();
    await fs.writeFile(
      path.join(evidence, "initial-validation.json"),
      JSON.stringify(
        { status: validation.status(), ...validationBody },
        null,
        2,
      ),
    );
    await expect(page.locator(".validation-result")).toContainText(
      "Данные прошли проверку",
    );
    const panel = page.getByRole("region", {
      name: "Готовность и состав следующего выпуска",
      exact: true,
    });
    await expect(panel).toContainText("Готовы к передаче: 3 из 3 курсов.");
    await panel.screenshot({
      path: path.join(evidence, "person-six-documents-before-transfer-390.png"),
    });
    const submitting = page.waitForResponse(
      (response) =>
        response
          .url()
          .endsWith(`/print-requests/${seeded.request.id}/approval/submit`) &&
        response.request().method() === "POST",
    );
    await panel
      .getByRole("button", { name: /^Проверить и передать директору/ })
      .click();
    const response = await submitting;
    const body = await response.json();
    await fs.writeFile(
      path.join(evidence, "initial-transfer-result.json"),
      JSON.stringify(
        {
          status: response.status(),
          body,
          visiblePanel: await panel.innerText(),
          requestId: seeded.request.id,
        },
        null,
        2,
      ),
    );
    expect(response.ok(), JSON.stringify(body)).toBe(true);
    await expect(panel).toContainText("Выбранный состав на согласовании");
    const detail = await page.request.get(
      `/api/print-requests/${seeded.request.id}`,
    );
    expect(detail.ok()).toBe(true);
    let after = await detail.json();
    expect(after.approval.status).toBe("PENDING");
    expect(after.approval.assignments).toHaveLength(6);
    const expectedIds = seeded.request
      .items![0].assignments.map((assignment) => assignment.id)
      .sort();
    expect(
      after.approval.assignments
        .map((assignment: { assignmentId: string }) => assignment.assignmentId)
        .sort(),
    ).toEqual(expectedIds);
    await panel.screenshot({
      path: path.join(evidence, "person-six-documents-pending-390.png"),
    });
    const directorContext = await browser.newContext({
      baseURL: process.env.DEMO_ORIGIN,
      viewport: { width: 1366, height: 900 },
    });
    try {
      const director = await directorContext.newPage();
      await director.routeWebSocket(/\/_next\/webpack-hmr/, (socket) =>
        socket.close(),
      );
      await login(director, seeded.director);
      await director.goto(`/approvals?proposal=${after.approval.proposalId}`);
      const review = director.getByRole("region", {
        name: "Подготовленные данные редакции",
        exact: true,
      });
      await expect(review).toContainText("1 человек · 3 обучений");
      await expect(
        review.locator(".approval-course-summary tbody tr"),
      ).toHaveCount(3);
      const proposalResponse = await director.request.get(
        `/api/approvals/${after.approval.proposalId}`,
      );
      expect(proposalResponse.ok()).toBe(true);
      const proposal = await proposalResponse.json();
      expect(
        proposal.assignments
          .map(
            (assignment: { assignmentId: string }) => assignment.assignmentId,
          )
          .sort(),
      ).toEqual(expectedIds);
      expect(proposal.draft.items).toHaveLength(1);
      expect(proposal.draft.items[0].assignments).toHaveLength(6);
      if (kind === "COMPANY") {
        const returnedProposalId = after.approval.proposalId;
        const reason = "Уточните ФИО: Синтетический Исправленный Получатель";
        await director
          .getByLabel("Комментарий к решению", { exact: true })
          .fill(reason);
        const rejected = director.waitForResponse(
          (r) =>
            r.url().endsWith(`/approvals/${returnedProposalId}/decision`) &&
            r.request().method() === "POST",
        );
        await director
          .getByRole("button", { name: "Вернуть на доработку", exact: true })
          .click();
        expect((await rejected).status()).toBe(201);
        await page.reload();
        await expect(page.locator(".approval-banner")).toContainText(reason);
        const name = page.locator(
          '.operator-grid [data-field-path="items.0.fullNameRu"]',
        );
        await name.fill("Синтетический Исправленный Получатель");
        await name.blur();
        const resend = page.waitForResponse(
          (r) =>
            r
              .url()
              .endsWith(
                `/print-requests/${seeded.request.id}/approval/submit`,
              ) && r.request().method() === "POST",
        );
        await panel
          .getByRole("button", { name: /^Проверить и передать директору/ })
          .click();
        expect((await resend).status()).toBe(201);
        after = await (
          await page.request.get(`/api/print-requests/${seeded.request.id}`)
        ).json();
        expect(after.approval.proposalId).not.toBe(returnedProposalId);
        expect(after.items[0].fullNameRu).toBe(
          "Синтетический Исправленный Получатель",
        );
        expect(
          after.approval.assignments
            .map((a: { assignmentId: string }) => a.assignmentId)
            .sort(),
        ).toEqual(expectedIds);
        await director.goto(`/approvals?proposal=${after.approval.proposalId}`);
        await review
          .locator("summary")
          .filter({ hasText: "Предпросмотр данных всех людей и документов" })
          .click();
        await expect(review).toContainText(
          "Синтетический Исправленный Получатель",
        );
        const returned = await (
          await director.request.get(`/api/approvals/${returnedProposalId}`)
        ).json();
        expect(returned.status).toBe("REJECTED");
        expect(returned.draft.items[0].fullNameRu).toBe(
          "Синтетический Получатель",
        );
        await page.screenshot({
          path: path.join(evidence, "company-corrected-resubmission.png"),
          fullPage: true,
        });
      }
      await review.screenshot({
        path: path.join(
          evidence,
          "director-reviews-exact-three-courses-six-documents.png",
        ),
      });
      await director
        .getByLabel("Комментарий к решению", { exact: true })
        .fill(
          "Синтетическое согласование точного выбранного состава; локальная проверка",
        );
      const decision = director.waitForResponse(
        (value) =>
          value
            .url()
            .endsWith(`/approvals/${after.approval.proposalId}/decision`) &&
          value.request().method() === "POST",
      );
      await director
        .getByRole("button", { name: "Согласовать эту редакцию", exact: true })
        .click();
      const approved = await decision;
      expect(approved.status(), await approved.text()).toBe(201);
    } finally {
      await directorContext.close();
    }
    await page.reload();
    const prepare = page.getByRole("button", {
      name: "Сформировать документы",
      exact: true,
    });
    await expect(prepare).toBeEnabled();
    const finalizing = page.waitForResponse(
      (value) =>
        value.url().endsWith(`/print-requests/${seeded.request.id}/finalize`) &&
        value.request().method() === "POST",
    );
    await prepare.click();
    const finalized = await finalizing;
    expect(finalized.ok(), await finalized.text()).toBe(true);
    const issuanceId = (await finalized.json()).issuanceId as string;
    expect(issuanceId).toBeTruthy();
    const worker = `person-director-browser-${randomUUID()}`;
    const deadline = Date.now() + 420_000;
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
    const signing = await signingState(
      seeded.context,
      seeded.request.id,
      db,
      issuanceId,
    );
    expect(signing.status).toBe("AWAITING_SIGNATURE");
    expect(signing.documents).toHaveLength(6);
    expect(
      signing.documents.every(
        (document) => document.artifactId && !document.complete,
      ),
    ).toBe(true);
    expect(
      await db.documentSignature.count({
        where: { tenantId: seeded.context.tenantId },
      }),
    ).toBe(0);
    expect(
      await db.auditEvent.count({
        where: {
          tenantId: seeded.context.tenantId,
          action: "PRINT_PAPER_SIGNATURE_ATTESTED",
        },
      }),
    ).toBe(0);
    await page.reload();
    const signingDetails = page
      .locator("details")
      .filter({ has: page.locator(".signing-panel") })
      .first();
    if (
      !(await signingDetails.evaluate(
        (node) => (node as HTMLDetailsElement).open,
      ))
    )
      await signingDetails.locator(":scope > summary").click();
    await expect(page.locator(".signing-panel .signing-document")).toHaveCount(
      6,
    );
    await page.locator(".signing-panel").screenshot({
      path: path.join(
        evidence,
        "operator-six-originals-ready-for-signing-390.png",
      ),
    });
    await fs.writeFile(
      path.join(
        evidence,
        `${kind.toLowerCase()}-full-transfer-acceptance.json`,
      ),
      JSON.stringify(
        {
          requestId: seeded.request.id,
          kind,
          rejectionCorrected: kind === "COMPANY",
          proposalId: after.approval.proposalId,
          issuanceId,
          courseCount: 3,
          documentCount: 6,
          exactAssignmentIds: expectedIds,
          status: signing.status,
          noFabricatedSignatures: true,
        },
        null,
        2,
      ),
    );
  });

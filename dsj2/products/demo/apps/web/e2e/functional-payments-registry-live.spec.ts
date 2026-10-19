import { test, expect, type Page } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
const product = path.resolve(__dirname, "../../..");
const output = path.join(
  product,
  "docs/evidence/functional-completion-20261019/run-01/operations/payments-registry",
);
const progressPath = path.join(
  product,
  ".runtime/functional-completion-20261019/run-01/operations-payment.private.json",
);
async function login(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Электронная почта", { exact: true }).fill(user.email);
  await page.getByLabel("Пароль", { exact: true }).fill(user.password);
  const result = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/auth/login") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  const r = await result;
  expect(r.ok(), await r.text()).toBe(true);
  await expect(page).not.toHaveURL(/\/login/);
}
test.use({ trace: "off", screenshot: "only-on-failure", video: "off" });
test.skip(
  process.env.DEMO_FUNCTIONAL_OPERATIONS !== "1",
  "Requires isolated clean runtime",
);
test.describe.configure({ mode: "serial" });
test.beforeEach(async () => {
  expect(process.env.DEMO_ORIGIN).toBe("http://127.0.0.1:3350");
  await mkdir(output, { recursive: true });
});
test("F24 catalogue application, accepted enrollment, order pricing, manual payment and refund history", async ({
  page,
  browser,
}) => {
  test.setTimeout(360000);
  const setup = JSON.parse(
    readFileSync(
      path.join(
        product,
        ".runtime/functional-completion-20261019/run-01/onboarding-result.private.json",
      ),
      "utf8",
    ),
  );
  const course = JSON.parse(
    readFileSync(
      path.join(
        product,
        ".runtime/functional-completion-20261019/run-01/learning-course.private.json",
      ),
      "utf8",
    ),
  );
  const progress: any = existsSync(progressPath)
    ? JSON.parse(readFileSync(progressPath, "utf8"))
    : {
        learner: {
          displayName: "Учебный Покупатель Курса",
          email: `functional-buyer-${Date.now()}@example.test`,
          password: `Local-${randomBytes(18).toString("base64url")}!`,
        },
      };
  const save = () => writeFile(progressPath, JSON.stringify(progress, null, 2));
  await save();
  await login(page, setup.users.admin);
  const learnerContext = await browser.newContext({
    baseURL: process.env.DEMO_ORIGIN,
  });
  const learner = await learnerContext.newPage();
  try {
    if (!progress.learner.id) {
      await learner.goto("/learn/register");
      await learner
        .getByLabel("ФИО", { exact: true })
        .fill(progress.learner.displayName);
      await learner
        .getByLabel("Электронная почта", { exact: true })
        .fill(progress.learner.email);
      await learner
        .getByLabel("Придумайте пароль", { exact: true })
        .fill(progress.learner.password);
      await learner.getByRole("checkbox").check();
      await learner
        .getByRole("button", { name: "Создать личный кабинет", exact: true })
        .click();
      await expect(learner).toHaveURL(/\/learn$/);
      progress.learner.id = (
        await learner.request.get("/api/context").then((r) => r.json())
      ).user.id;
      await save();
    } else await login(learner, progress.learner);
    if (!progress.applicationId) {
      const catalog = await learner.request
        .get(`/api/lms/catalogue?versionId=${course.versionId}`)
        .then((r) => r.json());
      if (!catalog.items?.length) {
        await page.goto("/lms");
        const card = page
          .locator("li")
          .filter({
            has: page.locator(`a[href="/lms/courses/${course.courseId}"]`),
          })
          .first();
        await card.locator("summary", { hasText: /^Открытый набор$/ }).click();
        await card
          .getByLabel("Показывать в открытом каталоге", { exact: true })
          .check();
        await expect(card.getByRole("status")).toHaveText("Сохранено");
      }
      await learner.goto(`/catalogue?courseVersionId=${course.versionId}`);
      await learner
        .getByLabel("Комментарий", { exact: true })
        .fill(
          "Учебная заявка: проверка локального пользовательского пути оплаты и назначения, без банковской транзакции.",
        );
      const submitted = learner.waitForResponse(
        (r) =>
          r.url().endsWith("/api/lms/applications") &&
          r.request().method() === "POST",
      );
      await learner
        .getByRole("button", { name: "Отправить заявку", exact: true })
        .click();
      const receipt = await submitted;
      expect(receipt.ok(), await receipt.text()).toBe(true);
      progress.applicationId = (await receipt.json()).id;
      await save();
      await expect(
        learner.getByRole("heading", { name: "Заявка сохранена", exact: true }),
      ).toBeVisible();
      await learner.screenshot({
        path: path.join(output, "catalogue-application.png"),
        fullPage: true,
      });
    }
    await page.goto(`/lms/applications?id=${progress.applicationId}`);
    const applications = async () =>
      page.request
        .get(`/api/lms/applications?id=${progress.applicationId}`)
        .then((r) => r.json());
    let application = (await applications()).items[0];
    if (application.state !== "ACCEPTED") {
      await page
        .getByRole("button", {
          name: "Принять и назначить обучение",
          exact: true,
        })
        .click();
      await expect
        .poll(async () => (await applications()).items[0].state)
        .toBe("ACCEPTED");
      application = (await applications()).items[0];
    }
    expect(application.enrollmentId).toBeTruthy();
    expect(application.orderId).toBeTruthy();
    progress.orderId = application.orderId;
    progress.enrollmentId = application.enrollmentId;
    await save();
    await page
      .getByRole("link", { name: "Заказ, документы и оплата", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(progress.orderId));
    const order = async () => {
      const response = await page.request.get(
        `/api/orders/${progress.orderId}`,
      );
      expect(response.ok(), await response.text()).toBe(true);
      return response.json();
    };
    let details = await order();
    await page
      .locator("summary", { hasText: /^Расчёты и финансовые основания$/ })
      .click();
    if (details.commercial.totalMinor !== "1000000") {
      await page
        .getByRole("button", {
          name: "Добавить согласованную услугу",
          exact: true,
        })
        .click();
      await page
        .getByLabel("Услуга 1", { exact: true })
        .fill("Учебная договорённость: участие в программе");
      await page.getByLabel("Цена услуги 1", { exact: true }).fill("10000");
      await page
        .getByRole("combobox", { name: "Налоговая ставка", exact: true })
        .selectOption("0");
      await page
        .getByLabel("Основание налогового расчёта", { exact: true })
        .fill(
          "Учебный пример расчёта; не налоговая квалификация реальной сделки",
        );
      await page
        .getByRole("button", {
          name: "Сохранить согласованный расчёт",
          exact: true,
        })
        .click();
      await expect
        .poll(async () => (await order()).commercial.totalMinor)
        .toBe("1000000");
    }
    const operations = [
      {
        amount: "10000",
        minor: "1000000",
        source:
          "Учебный ручной платёж: LOCAL-PAY-01. Внешний банк не подключён.",
      },
      {
        amount: "-2500",
        minor: "-250000",
        source:
          "Учебный ручной возврат: LOCAL-REFUND-01, уточнение учебного расчёта.",
      },
      {
        amount: "2500",
        minor: "250000",
        source:
          "Учебный доплатёж после уточнения: LOCAL-PAY-02. Внешний банк не подключён.",
      },
    ];
    for (const payment of operations) {
      details = await order();
      if (
        details.commercial.payments.some(
          (p: any) => p.source === payment.source,
        )
      )
        continue;
      const summary = page.locator("summary", {
        hasText: /^Зафиксировать подтверждённый платёж$/,
      });
      if ((await summary.locator("..").getAttribute("open")) === null)
        await summary.click();
      await page.getByLabel("Сумма, KZT", { exact: true }).fill(payment.amount);
      await page.getByLabel("Дата платежа", { exact: true }).fill("2026-10-19");
      await page
        .getByLabel("Источник подтверждения платежа", { exact: true })
        .fill(payment.source);
      const posted = page.waitForResponse(
        (r) =>
          r.url().endsWith(`/api/orders/${progress.orderId}/payments`) &&
          r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Зафиксировать платёж", exact: true })
        .click();
      const response = await posted;
      expect(response.ok(), await response.text()).toBe(true);
      const entry = await response.json();
      if (!progress.replayChecked) {
        const request = response.request();
        const replay = await page.request.post(
          `/api/orders/${progress.orderId}/payments`,
          { data: request.postDataJSON(), headers: await request.allHeaders() },
        );
        expect(replay.ok(), await replay.text()).toBe(true);
        expect((await replay.json()).id).toBe(entry.id);
        progress.replayChecked = true;
        await save();
      }
      await expect
        .poll(async () =>
          (await order()).commercial.payments.some(
            (p: any) => p.source === payment.source,
          ),
        )
        .toBe(true);
    }
    await page.reload();
    await page
      .locator("summary", { hasText: /^Расчёты и финансовые основания$/ })
      .click();
    await page
      .locator("summary", { hasText: /^История платежей и возвратов$/ })
      .click();
    for (const entry of operations)
      await expect(page.getByText(entry.source, { exact: true })).toBeVisible();
    details = await order();
    expect(details.commercial.paidMinor).toBe("1000000");
    expect(details.commercial.paymentState).toBe("PAID");
    expect(details.commercial.payments).toHaveLength(3);
    await page.screenshot({
      path: path.join(output, "payment-refund-history.png"),
      fullPage: true,
    });
    await learner.goto(`/learn/applications?id=${progress.applicationId}`);
    await expect(learner.getByText("Принята", { exact: true })).toBeVisible();
    await learner
      .getByRole("link", { name: "Начать / продолжить", exact: true })
      .click();
    await expect(learner).toHaveURL(new RegExp(progress.enrollmentId));
    await expect(
      learner.getByRole("button", { name: "Материалы и задания", exact: true }),
    ).toBeVisible();
    await learner.screenshot({
      path: path.join(output, "accepted-course-access.png"),
      fullPage: true,
    });
    const summary = await page.request
      .get(`/api/lms/applications/${progress.applicationId}/order`)
      .then((r) => r.json());
    expect(summary.assigned).toBe(1);
    expect(summary.payment.state).toBe("PAID");
    await writeFile(
      path.join(output, "F24-application-payment.json"),
      JSON.stringify(
        {
          status: "PASS",
          synthetic: true,
          applicationId: progress.applicationId,
          orderId: progress.orderId,
          enrollmentId: progress.enrollmentId,
          applicationState: application.state,
          assigned: summary.assigned,
          payment: summary.payment,
          payments: details.commercial.payments.map((p: any) => ({
            id: p.id,
            amountMinor: p.amountMinor,
            source: p.source,
            occurredOn: p.occurredOn,
          })),
          idempotentReplay: progress.replayChecked,
          bankIntegrationClaimed: false,
        },
        null,
        2,
      ),
    );
  } finally {
    await learnerContext.close();
  }
});

test("F18 common registry contains ordinary issued documents and real exports; employee with no LMS has zero counts", async ({
  page,
}) => {
  test.setTimeout(300000);
  const setup = JSON.parse(
    readFileSync(
      path.join(
        product,
        ".runtime/functional-completion-20261019/run-01/onboarding-result.private.json",
      ),
      "utf8",
    ),
  );
  const issued = JSON.parse(
    readFileSync(
      path.join(
        product,
        "docs/evidence/functional-completion-20261019/run-01/operations/printing/F16-printing.json",
      ),
      "utf8",
    ),
  );
  await login(page, setup.users.admin);
  await page.goto(
    `/lms/reports?kind=DOCUMENT_REGISTRY&sourceRequestId=${issued.requestId}`,
  );
  const rows = page.getByRole("region", { name: "Строки отчёта", exact: true });
  for (const number of issued.numbers) await expect(rows).toContainText(number);
  await expect(rows.getByText("Обычная печать", { exact: true })).toHaveCount(
    2,
  );
  await expect(rows).toContainText("Синтетический Печатный Сотрудник");
  await expect(rows.locator("tbody tr")).toHaveCount(2);
  const visible = await rows.locator("tbody tr").allTextContents();
  const exports = [];
  for (const format of ["CSV", "XLSX", "PDF"]) {
    await page
      .getByRole("combobox", { name: "Формат", exact: true })
      .selectOption(format);
    const created = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/lms/reports") && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Сформировать отчёт", exact: true })
      .click();
    const response = await created;
    expect(response.ok(), await response.text()).toBe(true);
    const job = await response.json();
    await expect(
      page
        .getByRole("region", { name: "Подготовка отчёта", exact: true })
        .getByText("Отчёт готов", { exact: true }),
    ).toBeVisible({ timeout: 90000 });
    const ready = await page.request
      .get(`/api/lms/reports/${job.id}`)
      .then((r) => r.json());
    expect(ready.totalRows).toBe(2);
    expect(ready.items.map((i: any) => i.payload.number).sort()).toEqual(
      [...issued.numbers].sort(),
    );
    const download = page.waitForEvent("download");
    await page
      .getByRole("region", { name: "Подготовка отчёта", exact: true })
      .getByRole("button", { name: "Скачать", exact: true })
      .click();
    await (
      await download
    ).saveAs(path.join(output, `ordinary-registry.${format.toLowerCase()}`));
    exports.push({ format, jobId: job.id, totalRows: ready.totalRows });
  }
  await page.screenshot({
    path: path.join(output, "ordinary-registry.png"),
    fullPage: true,
  });
  await writeFile(
    path.join(output, "F19-common-registry.json"),
    JSON.stringify(
      {
        status: "PASS",
        requestId: issued.requestId,
        origin: "PRINTING",
        issuedDocuments: issued.issuedDocumentIds,
        numbers: issued.numbers,
        visible,
        formats: exports,
      },
      null,
      2,
    ),
  );
  const progress = JSON.parse(readFileSync(progressPath, "utf8"));
  const zeroName = "Учебный сотрудник без назначения";
  if (!progress.zeroApplicationId) {
    const course = JSON.parse(
      readFileSync(
        path.join(
          product,
          ".runtime/functional-completion-20261019/run-01/learning-course.private.json",
        ),
        "utf8",
      ),
    );
    await page.goto("/lms/applications?new=1");
    await page
      .getByRole("combobox", { name: "Заказчик", exact: true })
      .selectOption("B2C");
    await page
      .getByRole("combobox", { name: "Программа", exact: true })
      .selectOption(course.versionId);
    await page
      .getByLabel("Создать карточку нового человека", { exact: true })
      .check();
    await page.getByLabel("ФИО", { exact: true }).fill(zeroName);
    await page
      .getByLabel("E-mail", { exact: true })
      .fill("unassigned-employee@example.test");
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/lms/applications/operator") &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Создать заявку", exact: true })
      .click();
    const created = await response;
    expect(created.ok(), await created.text()).toBe(true);
    progress.zeroApplicationId = (await created.json()).id;
    await writeFile(progressPath, JSON.stringify(progress, null, 2));
  }
  await page.goto(
    `/lms/reports?kind=EMPLOYEE_DIRECTORY&search=${encodeURIComponent(zeroName)}`,
  );
  await expect(rows).toContainText(zeroName);
  const people = rows.locator("tbody tr");
  expect(await people.count()).toBeGreaterThan(0);
  const cells = await people.first().getByRole("cell").allTextContents();
  expect(cells.filter((c) => c === "0").length).toBeGreaterThanOrEqual(2);
  await page.screenshot({
    path: path.join(output, "employee-zero.png"),
    fullPage: true,
  });
  await writeFile(
    path.join(output, "F25-employee-zero.json"),
    JSON.stringify(
      {
        status: "PASS",
        zeroApplicationId: progress.zeroApplicationId,
        employeeWithoutLearning: true,
        zeroCells: cells.filter((c) => c === "0").length,
      },
      null,
      2,
    ),
  );
});

test("F25 full directories preserve zero rows in all formats and report read scopes; F28 compact layouts", async ({
  page,
  browser,
}) => {
  test.setTimeout(360000);
  const setup = JSON.parse(
    readFileSync(
      path.join(
        product,
        ".runtime/functional-completion-20261019/run-01/onboarding-result.private.json",
      ),
      "utf8",
    ),
  );
  const progress = JSON.parse(readFileSync(progressPath, "utf8"));
  await login(page, setup.users.admin);
  const exports = [];
  const measurements = [];
  for (const item of [
    {
      kind: "ORGANIZATION_DIRECTORY",
      search: setup.organizations[1].nameRu,
      name: "organization-zero",
      key: "organization",
    },
    {
      kind: "EMPLOYEE_DIRECTORY",
      search: "Учебный сотрудник без назначения",
      name: "employee-zero",
      key: "name",
    },
  ]) {
    await page.goto(
      `/lms/reports?kind=${item.kind}&search=${encodeURIComponent(item.search)}`,
    );
    const rows = page.getByRole("region", {
      name: "Строки отчёта",
      exact: true,
    });
    await expect(rows).toContainText(item.search);
    const visible = await rows.locator("tbody tr").allTextContents();
    expect(visible).toHaveLength(1);
    for (const format of ["CSV", "XLSX", "PDF"]) {
      await page
        .getByRole("combobox", { name: "Формат", exact: true })
        .selectOption(format);
      const created = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/lms/reports") &&
          r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Сформировать отчёт", exact: true })
        .click();
      const response = await created;
      expect(response.ok(), await response.text()).toBe(true);
      const job = await response.json();
      await expect(
        page
          .getByRole("region", { name: "Подготовка отчёта", exact: true })
          .getByText("Отчёт готов", { exact: true }),
      ).toBeVisible({ timeout: 90000 });
      const ready = await page.request
        .get(`/api/lms/reports/${job.id}`)
        .then((r) => r.json());
      expect(ready.totalRows).toBe(1);
      expect(ready.items[0].payload[item.key]).toBe(item.search);
      expect(ready.items[0].payload.assignments).toBe(0);
      expect(ready.items[0].payload.active).toBe(0);
      expect(ready.items[0].payload.completed).toBe(0);
      const download = page.waitForEvent("download");
      await page
        .getByRole("region", { name: "Подготовка отчёта", exact: true })
        .getByRole("button", { name: "Скачать", exact: true })
        .click();
      await (
        await download
      ).saveAs(path.join(output, `${item.name}.${format.toLowerCase()}`));
      exports.push({
        kind: item.kind,
        format,
        jobId: job.id,
        payload: ready.items[0].payload,
        visible,
      });
    }
  }
  for (const url of [
    "/settings?tab=templates",
    "/lms/reports?kind=ORGANIZATION_DIRECTORY",
    `/workbench?orderId=${progress.orderId}`,
  ]) {
    await page.goto(url);
    await expect(page.locator("main")).toBeVisible();
    for (const width of [360, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(150);
      const bodyWidth = await page.evaluate(
        () => document.documentElement.scrollWidth,
      );
      expect(bodyWidth, `${url} at ${width}`).toBeLessThanOrEqual(width + 1);
      measurements.push({ url, width, bodyWidth });
    }
    await page.setViewportSize({ width: 390, height: 900 });
    await page.screenshot({
      path: path.join(
        output,
        url.includes("settings")
          ? "forms-390.png"
          : url.includes("reports")
            ? "reports-390.png"
            : "payments-390.png",
      ),
      fullPage: true,
    });
  }
  const readonlyContext = await browser.newContext({
    baseURL: process.env.DEMO_ORIGIN,
  });
  const viewer = await readonlyContext.newPage();
  try {
    await login(viewer, setup.users.viewer);
    await viewer.goto("/lms/reports?kind=ORGANIZATION_DIRECTORY");
    await expect(
      viewer.getByRole("region", { name: "Строки отчёта", exact: true }),
    ).toContainText(setup.organizations[1].nameRu);
    expect(
      (
        await viewer.request.get(`/api/lms/reports/${exports[0].jobId}/file`)
      ).status(),
    ).toBe(403);
    await expect(
      viewer.getByRole("button", { name: "Сформировать отчёт", exact: true }),
    ).toHaveCount(0);
  } finally {
    await readonlyContext.close();
  }
  const employerContext = await browser.newContext({
    baseURL: process.env.DEMO_ORIGIN,
  });
  const employer = await employerContext.newPage();
  try {
    await login(employer, setup.employer);
    await employer.goto("/lms/reports?kind=ORGANIZATION_DIRECTORY");
    await employer.getByRole("button", { name: "RU", exact: true }).click();
    const rows = employer.getByRole("region", {
      name: "Строки отчёта",
      exact: true,
    });
    await expect(rows).toContainText(setup.organizations[0].nameRu);
    await expect(rows).not.toContainText(setup.organizations[1].nameRu);
    await employer.goto("/lms/reports?kind=DOCUMENT_REGISTRY");
    await expect(
      employer
        .getByRole("region", { name: "Строки отчёта", exact: true })
        .locator("tbody tr"),
    ).toHaveCount(0);
  } finally {
    await employerContext.close();
  }
  await writeFile(
    path.join(output, "F25-exports-scopes-F28-layouts.json"),
    JSON.stringify(
      {
        status: "PASS",
        exports,
        viewerFileDenied: true,
        employerOnlyOwnOrganization: true,
        unrelatedOrdinaryRegistryDenied: true,
        measurements,
      },
      null,
      2,
    ),
  );
});

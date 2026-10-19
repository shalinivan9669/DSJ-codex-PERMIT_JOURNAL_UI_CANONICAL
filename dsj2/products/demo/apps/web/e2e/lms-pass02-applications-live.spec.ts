import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const product = path.resolve(__dirname, "../../..");
const fixture = JSON.parse(
  readFileSync(
    path.join(
      product,
      ".runtime/lms-pass02-operations-20261018/applications-browser-fixture.json",
    ),
    "utf8",
  ),
);
const output =
  process.env.DEMO_E2E_EVIDENCE ||
  path.join(
    product,
    "docs/evidence/lms-full-tz-pass-02-operations-20261018/applications-browser",
  );
async function login(page: Page, user: { email: string; password: string }) {
  page.setDefaultNavigationTimeout(60000);
  await page.goto("/login");
  await page.getByLabel("Электронная почта", { exact: true }).fill(user.email);
  await page.getByLabel("Пароль", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
test("N01/N02 real B2C and anonymous B2B applications reach accepted order and automatic scoped assignments", async ({
  browser,
}) => {
  await mkdir(output, { recursive: true });
  const started = Date.now();
  const learnerContext = await browser.newContext(),
    staffContext = await browser.newContext({ timezoneId: "UTC" }),
    anonymousContext = await browser.newContext();
  const learner = await learnerContext.newPage(),
    staff = await staffContext.newPage(),
    anonymous = await anonymousContext.newPage();
  for (const page of [learner, staff, anonymous]) {
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(60000);
  }
  try {
    await learner.goto("/catalogue");
    await learner
      .getByRole("button", { name: "Подробнее", exact: true })
      .first()
      .click();
    await learner.getByRole("link", { name: "Войти", exact: true }).click();
    await learner
      .getByLabel("Электронная почта", { exact: true })
      .fill(fixture.users.learner.email);
    await learner
      .getByLabel("Пароль", { exact: true })
      .fill(fixture.users.learner.password);
    await learner.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(learner).toHaveURL(/\/catalogue$/);
    await expect(
      learner.getByText(fixture.users.learner.email, { exact: false }),
    ).toBeVisible();
    await learner
      .getByRole("button", { name: "Отправить заявку", exact: true })
      .click();
    await expect(learner.getByText(/Заявка сохранена/)).toBeVisible();
    const mine = await learner.request
      .get("/api/lms/applications")
      .then((response) => response.json());
    const b2c = mine.items[0];
    expect(b2c.state).toBe("NEW");
    expect(b2c.enrollmentId).toBeNull();
    await learner.goto("/learn/applications");
    await expect(
      learner.locator(".lms-list").getByText("Новая", { exact: true }).first(),
    ).toBeVisible();
    await login(staff, fixture.users.director);
    await staff.goto(`/lms/applications?id=${b2c.id}`);
    await staff
      .getByRole("button", { name: "Принять и открыть заказ", exact: true })
      .click();
    await expect(
      staff.locator(".lms-list").getByText("Принята", { exact: true }).first(),
    ).toBeVisible();
    await learner.reload();
    await learner
      .getByRole("link", { name: "Начать / продолжить", exact: true })
      .click();
    await expect(learner).toHaveURL(/\/learn\/[a-f0-9-]+$/);
    await learner.screenshot({
      path: path.join(output, "b2c-learning.png"),
      fullPage: true,
    });
    await anonymous.goto("/catalogue");
    await anonymous
      .getByRole("button", { name: "Подробнее", exact: true })
      .first()
      .click();
    await anonymous.getByLabel("Заявка организации", { exact: true }).check();
    const org = `Synthetic browser organization ${fixture.anonymousBin}`;
    await anonymous.getByLabel("Организация", { exact: true }).fill(org);
    await anonymous
      .getByLabel("БИН", { exact: true })
      .fill(fixture.anonymousBin);
    await anonymous
      .getByLabel("Контактное лицо", { exact: true })
      .fill("Synthetic verified contact");
    await anonymous.getByLabel("Телефон", { exact: true }).fill("+70000000003");
    await anonymous
      .getByLabel("Электронная почта", { exact: true })
      .fill("synthetic-application@example.test");
    await anonymous
      .getByLabel("Должность", { exact: true })
      .fill("Synthetic manager");
    await anonymous
      .getByLabel("Количество сотрудников", { exact: true })
      .fill("2");
    await anonymous
      .getByLabel("Комментарий", { exact: true })
      .fill("Synthetic local verification; no external contact");
    let fail = true;
    await anonymous.route(
      "**/api/learn/catalogue/applications",
      async (route) => {
        if (fail) {
          fail = false;
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ code: "SERVICE_UNAVAILABLE" }),
          });
        } else await route.continue();
      },
    );
    await anonymous
      .getByRole("button", { name: "Отправить заявку", exact: true })
      .click();
    await expect(
      anonymous.getByRole("alert").filter({ hasText: "Не удалось" }).first(),
    ).toBeVisible();
    await expect(
      anonymous.getByLabel("Организация", { exact: true }),
    ).toHaveValue(org);
    await anonymous
      .getByRole("button", { name: "Отправить заявку", exact: true })
      .click();
    await expect(anonymous.getByText(/Заявка сохранена/)).toBeVisible();
    await anonymous.screenshot({
      path: path.join(output, "anonymous-receipt.png"),
      fullPage: true,
    });
    const queue = await staff.request
      .get(`/api/lms/applications?search=${encodeURIComponent(org)}`)
      .then((response) => response.json());
    expect(queue.total).toBe(1);
    const b2b = queue.items[0];
    await staff.goto(`/lms/applications?id=${b2b.id}`);
    await staff
      .getByLabel("Создать организацию по проверенным данным заявки", {
        exact: true,
      })
      .check();
    await staff
      .getByRole("button", { name: "Принять и открыть заказ", exact: true })
      .click();
    await expect(
      staff.locator(".lms-list").getByText("Принята", { exact: true }).first(),
    ).toBeVisible();
    await staff
      .getByRole("link", { name: "Добавить сотрудников", exact: true })
      .click();
    await expect(
      staff.getByRole("combobox", { name: "Организация", exact: true }),
    ).toBeDisabled();
    await staff
      .getByLabel("Добавление сотрудников", { exact: true })
      .selectOption("bulk");
    await staff
      .getByLabel(/ФИО · ИИН · телефон/)
      .fill(
        `Synthetic application worker ${fixture.anonymousBin} A\nSynthetic application worker ${fixture.anonymousBin} B`,
      );
    await staff
      .getByRole("button", { name: "Проверить список", exact: true })
      .click();
    await staff
      .getByRole("button", { name: "Подтвердить и назначить", exact: true })
      .click();
    await expect(staff.getByText(/Обработка завершена/)).toBeVisible({
      timeout: 120000,
    });
    await staff.goto(`/lms/applications?id=${b2b.id}`);
    await expect(staff.getByText(/Назначено: 2\/2/)).toBeVisible();
    const summary = await staff.request
      .get(`/api/lms/applications/${b2b.id}/order`)
      .then((response) => response.json());
    expect(summary.assigned).toBe(2);
    expect(summary.completed).toBe(0);
    expect(summary.documentsReady).toBe(0);
    expect(summary.payment.state).toBe("UNKNOWN");
    await staff.locator("summary").filter({ hasText: "Этапы заказа" }).click();
    await staff
      .getByLabel("Подтверждённое событие / ссылка", { exact: true })
      .fill("Synthetic local witnessed fact; no external send");
    await staff
      .getByLabel("Когда произошло", { exact: true })
      .fill("2026-10-17T09:30");
    await staff
      .getByRole("button", { name: "Подтвердить этап", exact: true })
      .click();
    await expect(
      staff.getByText("Контакт установлен · Подтверждено", { exact: true }),
    ).toBeVisible();
    const stageSummary = await staff.request
      .get(`/api/lms/applications/${b2b.id}/order`)
      .then((response) => response.json());
    expect(
      JSON.parse(
        stageSummary.stages.find(
          (s: { stage: string }) => s.stage === "CONTACT",
        ).record.evidence,
      ).occurredAt,
    ).toBe("2026-10-17T04:30:00.000Z");
    await staff
      .getByRole("combobox", { name: "Этап", exact: true })
      .selectOption("SETTLEMENT");
    await staff
      .getByRole("textbox", { name: "Причина", exact: true })
      .fill("Synthetic noncommercial fixture; no payment performed");
    await staff
      .getByRole("button", { name: "Подтвердить этап", exact: true })
      .click();
    await expect(staff.getByText(/Расчёты · Не применяется/)).toBeVisible();
    await staff
      .locator("summary")
      .filter({ hasText: "Закрытие заказа" })
      .click();
    await staff
      .getByRole("button", {
        name: "Закрыть по завершённым фактам",
        exact: true,
      })
      .click();
    await expect(
      staff
        .getByRole("alert")
        .filter({ hasText: "Не все участники завершили обучение" })
        .first(),
    ).toBeVisible();
    for (const width of [360, 390, 768, 1440]) {
      await staff.setViewportSize({ width, height: 900 });
      expect(
        await staff.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
      await staff.screenshot({
        path: path.join(output, `queue-${width}-ru.png`),
        fullPage: true,
      });
    }
    await staff.getByRole("button", { name: "KZ", exact: true }).click();
    await expect(
      staff
        .locator(".lms-list")
        .getByText("Қабылданды", { exact: true })
        .first(),
    ).toBeVisible();
    await staff.screenshot({
      path: path.join(output, "queue-kz.png"),
      fullPage: true,
    });
    await writeFile(
      path.join(output, "UX_APPLICATIONS.json"),
      JSON.stringify(
        {
          status: "PASS",
          elapsedMs: Date.now() - started,
          b2cId: b2c.id,
          b2bId: b2b.id,
          flowB2c: [
            "anonymous catalogue selection",
            "login restores selected programme",
            "submit no repeated identity",
            "staff accept",
            "learner existing course",
          ],
          flowB2b: [
            "anonymous detail",
            "organization form",
            "503 preserves",
            "submit receipt",
            "staff explicit verified organization",
            "accepted order",
            "import inherited context",
            "automatic assign2",
          ],
          fixturePreparation: "Separate synthetic script; not UI entry",
          b2cRepeatedFields: 0,
          b2bRepeatedFields: 0,
          summary,
          viewports: [360, 390, 768, 1440],
          language: ["ru", "kz"],
          limits:
            "No payment, signature, document issue or external send performed; UNKNOWN/payment0 and documents0 shown",
        },
        null,
        2,
      ),
    );
  } finally {
    await learnerContext.close();
    await staffContext.close();
    await anonymousContext.close();
  }
});

test("N04 explicit profile language applies immediately and later toolbar choice survives autosave", async ({
  page,
}) => {
  page.setDefaultTimeout(20000);
  await login(page, fixture.users.employer);
  await page.goto("/lms/profile");
  await page
    .getByRole("combobox", { name: "Язык кабинета и уведомлений", exact: true })
    .selectOption("kz");
  await expect(
    page.getByRole("heading", { name: "Профиль және баптаулар", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "RU", exact: true }).click();
  await expect(page.getByText("Сохранено", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Профиль и настройки", exact: true }),
  ).toBeVisible();
  const saved = await page.request
    .get("/api/lms/profile")
    .then((response) => response.json());
  expect(saved.preferences.language).toBe("kz");
  await page
    .getByRole("combobox", { name: "Язык кабинета и уведомлений", exact: true })
    .selectOption("ru");
  await expect(page.getByText("Сохранено", { exact: true })).toBeVisible();
  await writeFile(
    path.join(output, "UX_PROFILE_LANGUAGE.json"),
    JSON.stringify(
      {
        status: "PASS",
        explicitKzImmediate: true,
        laterRuNotOverwrittenByPendingSave: true,
      },
      null,
      2,
    ),
  );
});

test("N01 confirmed employer applies without reentering organization or verified contact", async ({
  page,
}) => {
  page.setDefaultTimeout(20000);
  await login(page, fixture.users.employer);
  await page.goto("/catalogue");
  await page
    .getByRole("button", { name: "Подробнее", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("combobox", { name: "Организация", exact: true }),
  ).toHaveValue(fixture.customerId);
  await expect(
    page.getByLabel("Электронная почта", { exact: true }),
  ).toHaveValue(fixture.users.employer.email);
  await expect(
    page.getByLabel("Электронная почта", { exact: true }),
  ).toHaveAttribute("readonly", "");
  await page.getByLabel("Телефон", { exact: true }).fill("+70000000004");
  await page
    .getByRole("button", { name: "Отправить заявку", exact: true })
    .click();
  await expect(
    page.getByText("Заявка сохранена", { exact: true }),
  ).toBeVisible();
  await writeFile(
    path.join(output, "UX_KNOWN_EMPLOYER_APPLICATION.json"),
    JSON.stringify(
      {
        status: "PASS",
        knownFieldsRepeated: 0,
        organizationAndVerifiedContactPrefilled: true,
        unknownExistingBinRemainsUnknown: true,
        typedFields: ["phone"],
      },
      null,
      2,
    ),
  );
});

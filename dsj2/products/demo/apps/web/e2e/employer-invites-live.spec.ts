import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { loginRole } from "./operator-role-fixture";
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE
    ? path.join(process.env.DEMO_E2E_EVIDENCE, "employer-invites")
    : "../../docs/evidence/final-completion/invites/browser",
);
test.use({ trace: "off" });
test("live invitation UI: administrator grants selected-person scope, new employer accepts once, existing password and immediate revoke", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(180000);
  await fs.mkdir(evidence, { recursive: true });
  await loginRole(page, "ADMIN");
  const csrf = (await context.cookies()).find(
    (c) => c.name === "demo_csrf",
  )!.value;
  const headers = { origin: process.env.DEMO_ORIGIN!, "x-csrf-token": csrf };
  const post = async (endpoint: string, data: unknown) => {
    const r = await page.request.post(`/api${endpoint}`, { headers, data });
    expect(r.status()).toBe(201);
    return r.json();
  };
  const suffix = Date.now();
  const customerName = `Компания приглашения ${suffix}`;
  const customer = await post("/customers", { nameRu: customerName });
  const allowedName = `Разрешённый приглашением ${suffix}`;
  const person = await post("/recipients", {
    id: randomUUID(),
    fullNameRu: allowedName,
    employerId: customer.id,
    assignments: [],
  });
  const hidden = await post("/recipients", {
    id: randomUUID(),
    fullNameRu: `Закрытый человек ${suffix}`,
    employerId: customer.id,
    assignments: [],
  });
  await page.goto("/workbench");
  await page
    .getByRole("tab", { name: "Источники и правила", exact: true })
    .click();
  await page
    .getByText("Доступ представителей заказчиков", { exact: true })
    .click();
  await page
    .getByRole("combobox", {
      name: "Способ предоставления доступа",
      exact: true,
    })
    .selectOption("INVITE");
  await page
    .getByRole("button", { name: "Выбрать организацию", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Поиск по справочнику")
    .fill(customerName);
  await page
    .getByRole("dialog")
    .getByRole("row")
    .filter({ hasText: customerName })
    .getByRole("button", { name: "Выбрать", exact: true })
    .click();
  const email = `invited-${randomUUID()}@example.test`;
  const password = `Invited-${randomUUID()}!`;
  await page
    .getByLabel("Имя представителя", { exact: true })
    .fill("Синтетический приглашённый");
  await page.getByLabel("Адрес представителя", { exact: true }).fill(email);
  await page.getByLabel("Доступ до", { exact: true }).fill("2027-09-30T12:00");
  await page
    .getByRole("combobox", { name: "Область людей представителя", exact: true })
    .selectOption("SELECTED");
  await page
    .getByRole("button", {
      name: "Добавить человека в область доступа",
      exact: true,
    })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Поиск по справочнику")
    .fill(allowedName);
  await page
    .getByRole("dialog")
    .getByRole("row")
    .filter({ hasText: allowedName })
    .getByRole("button", { name: "Выбрать", exact: true })
    .click();
  await page.getByLabel("Скачивание файлов", { exact: true }).check();
  await page
    .getByLabel(
      "Разрешаю доступ к составу и заказам выбранной организации в пределах отмеченных прав",
    )
    .check();
  await page
    .getByRole("button", {
      name: "Создать одноразовое приглашение",
      exact: true,
    })
    .click();
  const linkInput = page.getByLabel("Одноразовая ссылка", { exact: true });
  await expect(linkInput).toBeVisible();
  const inviteUrl = await linkInput.inputValue();
  const token = new URL(inviteUrl).hash.slice(1);
  await page
    .getByRole("button", { name: "Скрыть ссылку", exact: true })
    .click();
  await page.screenshot({
    path: path.join(evidence, "administrator-invite.png"),
    fullPage: true,
  });
  const employerContext = await browser.newContext({
    viewport: { width: 375, height: 812 },
    reducedMotion: "reduce",
  });
  const employer = await employerContext.newPage();
  const urls: string[] = [];
  const referrers: string[] = [];
  employer.on("request", (r) => {
    urls.push(r.url());
    referrers.push(r.headers().referer || "");
  });
  try {
    const invitationResponse = await employer.goto(inviteUrl);
    expect(invitationResponse?.headers()["referrer-policy"]).toBe(
      "no-referrer",
    );
    expect(invitationResponse?.headers()["cache-control"]).toContain(
      "no-store",
    );
    await expect(
      employer.getByLabel("Новый пароль", { exact: true }),
    ).toBeVisible();
    await expect(employer).toHaveURL(/\/invite$/);
    expect(
      await employer.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await employer
        .getByLabel("Новый пароль", { exact: true })
        .getAttribute("autocomplete"),
    ).toBe("new-password");
    await employer.screenshot({
      path: path.join(evidence, "invite-mobile.png"),
      fullPage: true,
    });
    await employer.getByLabel("Новый пароль", { exact: true }).fill(password);
    await employer
      .getByLabel("Повторите новый пароль", { exact: true })
      .fill("different-password!");
    await employer
      .getByRole("button", { name: "Принять приглашение", exact: true })
      .click();
    await expect(
      employer.getByRole("alert", { name: "Ошибка приглашения" }),
    ).toContainText("Пароли не совпадают");
    await expect(
      employer.getByRole("alert", { name: "Ошибка приглашения" }),
    ).toBeFocused();
    await employer
      .getByLabel("Повторите новый пароль", { exact: true })
      .fill(password);
    await employer
      .getByRole("button", { name: "Принять приглашение", exact: true })
      .click();
    await expect(
      employer.getByRole("heading", { name: "Кабинет заказчика", exact: true }),
    ).toBeVisible();
    expect(urls.every((url) => !url.includes(token))).toBe(true);
    expect(referrers.every((value) => !value.includes(token))).toBe(true);
    const logPaths = [
      process.env.DEMO_E2E_API_LOG,
      process.env.DEMO_E2E_API_ERROR_LOG,
    ];
    expect(
      logPaths.every(Boolean),
      "Current isolated API stdout/stderr files are required; historical logs cannot prove token handling",
    ).toBe(true);
    const apiLogs = await Promise.all(
      logPaths.map((file) => fs.readFile(file!, "utf8")),
    );
    expect(apiLogs.every((value) => !value.includes(token))).toBe(true);
    expect(
      (await employerContext.cookies()).find((c) => c.name === "demo_session")
        ?.httpOnly,
    ).toBe(true);
    const evidenceResponse = await employer.request.get(
      `/api/portal/evidence?customerId=${customer.id}`,
    );
    expect(evidenceResponse.status()).toBe(200);
    const data = await evidenceResponse.json();
    expect(data.recipients.map((v: { id: string }) => v.id)).toEqual([
      person.id,
    ]);
    expect(JSON.stringify(data)).not.toContain(hidden.id);
    await employer.screenshot({
      path: path.join(evidence, "accepted-portal-mobile.png"),
      fullPage: true,
    });
    const replay = await employerContext.newPage();
    await replay.goto(inviteUrl);
    await expect(
      replay.getByRole("alert", { name: "Ошибка приглашения" }),
    ).toContainText("Приглашение недействительно");
    await expect(
      replay.getByRole("button", { name: "Принять приглашение", exact: true }),
    ).toHaveCount(0);
    await replay.close();
    // Existing account: invitation for a second company requires the existing password.
    const second = await post("/customers", {
      nameRu: `Вторая компания приглашения ${suffix}`,
    });
    const invitation = await post("/employer-invites", {
      email,
      displayName: "Тот же представитель",
      customerId: second.id,
      permissions: ["READ"],
      recipientIds: [],
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      accessExpiresAt: new Date(Date.now() + 86400_000).toISOString(),
    });
    await employer.goto(invitation.inviteUrl);
    await expect(
      employer.getByLabel("Текущий пароль", { exact: true }),
    ).toBeVisible();
    await expect(
      employer.getByLabel("Повторите новый пароль", { exact: true }),
    ).toHaveCount(0);
    await employer
      .getByLabel("Текущий пароль", { exact: true })
      .fill("Different-strong-password!");
    await employer
      .getByRole("button", { name: "Принять приглашение", exact: true })
      .click();
    await expect(
      employer.getByRole("alert", { name: "Ошибка приглашения" }),
    ).toContainText("текущий пароль");
    await employer.getByLabel("Текущий пароль", { exact: true }).fill(password);
    await employer
      .getByRole("button", { name: "Принять приглашение", exact: true })
      .click();
    await expect(
      employer.getByRole("heading", { name: "Кабинет заказчика", exact: true }),
    ).toBeVisible();
    // Revoke through the actual administration UI; both live sessions stop immediately.
    await page.reload();
    await page
      .getByRole("tab", { name: "Источники и правила", exact: true })
      .click();
    await page
      .getByText("Доступ представителей заказчиков", { exact: true })
      .click();
    await page.getByText(/Выданные приглашения \(/).click();
    const row = page
      .locator("div.outcome-entry")
      .filter({ hasText: email })
      .filter({ hasText: "Синтетический приглашённый" });
    await row
      .getByRole("button", {
        name: "Отозвать приглашение и доступ",
        exact: true,
      })
      .click();
    await expect(row.getByText("Отозвано", { exact: true })).toBeVisible();
    expect((await employer.request.get("/api/portal")).status()).toBe(401);
    await employer.reload();
    await expect(
      employer.getByLabel("Электронная почта", { exact: true }),
    ).toBeVisible();
    const regrant = await post("/employer-invites", {
      email,
      displayName: "Повторный доступ",
      customerId: customer.id,
      permissions: ["READ"],
      recipientIds: [hidden.id],
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      accessExpiresAt: new Date(Date.now() + 86400_000).toISOString(),
    });
    await employer.goto(regrant.inviteUrl);
    await employer.getByLabel("Текущий пароль", { exact: true }).fill(password);
    await employer
      .getByRole("button", { name: "Принять приглашение", exact: true })
      .click();
    await expect(
      employer.getByRole("heading", { name: "Кабинет заказчика", exact: true }),
    ).toBeVisible();
    const regranted = await employer.request.get(
      `/api/portal/evidence?customerId=${customer.id}`,
    );
    expect(regranted.status()).toBe(200);
    expect(
      (await regranted.json()).recipients.map((v: { id: string }) => v.id),
    ).toEqual([hidden.id]);
    await post(`/employer-invites/${regrant.id}/revoke`, {});
    await fs.writeFile(
      path.join(evidence, "summary.json"),
      JSON.stringify(
        {
          status: "PASS",
          realApi: true,
          adminCreateThroughUI: true,
          newPassword: true,
          existingPasswordNoReset: true,
          oneTimeReplayDenied: true,
          revokedSessionDenied: true,
          explicitRegrantNewScopeAndSamePassword: true,
          selectedRecipientScope: true,
          fragmentsRemovedBeforeApi: true,
          tokenAbsentFromRequestUrls: true,
          tokenAbsentFromReferrersAndApiLogs: true,
          noStoreNoReferrer: true,
          mobile375NoOverflow: true,
          errorFocus: true,
          syntheticDataOnly: true,
          customerId: customer.id,
        },
        null,
        2,
      ),
    );
  } finally {
    await employerContext.close();
  }
});

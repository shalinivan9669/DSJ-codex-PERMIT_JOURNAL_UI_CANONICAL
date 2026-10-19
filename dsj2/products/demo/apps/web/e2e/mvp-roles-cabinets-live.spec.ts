import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const product = path.resolve(__dirname, "../../..");
const privatePath = path.join(product, ".runtime/mvp-all-roles-20261019/run-01/cabinet-fixture.json");
const fixture = JSON.parse(readFileSync(privatePath, "utf8")) as { tenantId: string; users: Record<string, { id: string; email: string; password: string; role: string }> };
const evidence = path.join(product, "docs/evidence/mvp-all-roles-20261019/run-01/cabinets");
test.use({ trace: "off", screenshot: "off", video: "off" });
test.describe.configure({ mode: "serial" });

async function login(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByRole("button", { name: "RU", exact: true }).click();
  await page.getByLabel("Электронная почта", { exact: true }).fill(user.email);
  await page.getByLabel("Пароль", { exact: true }).fill(user.password);
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = page.waitForResponse(value => value.url().endsWith("/api/auth/login") && value.request().method() === "POST");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    if ((await response).status() !== 429) break;
    await page.waitForTimeout(60000);
  }
  await expect(page).not.toHaveURL(/\/login/);
}
async function geometry(page: Page) {
  const size = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }));
  if (size.width > size.viewport + 1) {
    const overflow = await page.evaluate(() => Array.from(document.querySelectorAll("body *")).map(element => ({ tag: element.tagName, className: element.className, right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width })).filter(element => element.right > innerWidth + 1).slice(0, 25));
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: path.join(evidence, "overflow.png"), fullPage: true });
    expect(size.width, JSON.stringify({ url: page.url(), overflow })).toBeLessThanOrEqual(size.viewport + 1);
  }
  return size;
}

for (const [key, user] of Object.entries(fixture.users)) {
  test(`J01/J12 ${user.role}: profile through navigation, RU/KZ 360/390/768/1440, own password`, async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const measurements: unknown[] = [];
    try {
      await login(page, user);
      await page.locator("header.app-header").getByRole("link", { name: /Профиль и пароль|Профиль және құпиясөз/ }).click();
      await expect(page.getByRole("heading", { name: /Профиль и настройки|Профиль және баптаулар/ })).toBeVisible();
      await page.getByRole("button", { name: "RU", exact: true }).last().click();
      const profileResponse = await page.request.get("/api/lms/profile");
      expect(profileResponse.status(), await profileResponse.text()).toBe(200);
      await expect(page.getByLabel("Имя в кабинете", { exact: true })).toBeVisible();
      const profileName = await page.getByLabel("Имя в кабинете", { exact: true }).inputValue();
      await page.getByLabel("Текущий пароль", { exact: true }).fill("Incorrect-current-password!");
      await page.getByLabel("Новый пароль", { exact: true }).fill(user.password + "-updated");
      await page.getByLabel("Повторите новый пароль", { exact: true }).fill(user.password + "-updated");
      for (const width of [360, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const language of ["RU", "KZ"]) {
          await page.getByRole("button", { name: language, exact: true }).last().click();
          await expect(page.getByLabel(language === "RU" ? "Текущий пароль" : "Ағымдағы құпиясөз", { exact: true })).toHaveValue("Incorrect-current-password!");
          await expect(page.getByLabel(language === "RU" ? "Имя в кабинете" : "Кабинеттегі атыңыз", { exact: true })).toHaveValue(profileName);
          measurements.push({ role: user.role, language, requestedWidth: width, ...await geometry(page) });
        }
      }
      await page.getByRole("button", { name: "Құпиясөзді өзгерту", exact: true }).click();
      await expect(page.locator(".own-password-form").getByRole("alert")).toContainText("Ағымдағы құпиясөз қате");
      await expect(page).not.toHaveURL(/\/login/);
      await expect(page.getByLabel("Жаңа құпиясөз", { exact: true })).toHaveValue(user.password + "-updated");
      await page.getByLabel("Ағымдағы құпиясөз", { exact: true }).fill(user.password);
      await page.getByRole("button", { name: "Құпиясөзді өзгерту", exact: true }).click();
      await expect(page.locator(".own-password-form").getByText("Құпиясөз өзгертілді. Жаңа құпиясөзбен қайта кіріңіз.", { exact: true })).toBeVisible();
      user.password += "-updated";
      await writeFile(privatePath, JSON.stringify(fixture, null, 2));
      await page.getByRole("link", { name: "Кіру", exact: true }).click();
      await login(page, user);
      await expect(page.locator("header.app-header")).toBeVisible();
      await mkdir(evidence, { recursive: true });
      await writeFile(path.join(evidence, `${key}.json`), JSON.stringify({ role: user.role, profileNavigation: "PASS", wrongPasswordPreservesFormAndSession: "PASS", passwordChangedAndNewLogin: "PASS", measurements }, null, 2));
    } finally { await context.close(); }
  });
}

test("J12 settings/audit/portal Kazakh labels and forms at mobile widths", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await login(page, fixture.users.superAdmin);
    await page.goto("/settings?tab=users");
    await page.getByRole("button", { name: "KZ", exact: true }).last().click();
    await expect(page.getByRole("heading", { name: "Пайдаланушылар", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Қызметкерді қосу", exact: true }).click();
    await page.getByLabel("Аты", { exact: true }).fill("Тексеру сақталған аты");
    await page.getByLabel("Электрондық пошта", { exact: true }).fill("unsaved-kz@example.test");
    await expect(page.getByLabel("Аты", { exact: true })).toHaveValue("Тексеру сақталған аты");
    await page.getByRole("button", { name: "Бас тарту", exact: true }).click();
    const samples: unknown[] = [];
    for (const tab of ["profile", "templates", "numbering", "users", "signatories", "audit", "export", "account"]) {
      await page.goto(`/settings?tab=${tab}`);
      await expect(page.getByRole("heading", { name: "Баптаулар", exact: true })).toBeVisible();
      for (const width of [360, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        samples.push({ tab, requestedWidth: width, ...await geometry(page) });
      }
      if (tab === "audit") {
        await expect(page.getByRole("columnheader", { name: "IP мекенжайы", exact: true })).toBeVisible();
        await page.getByText("Толығырақ", { exact: true }).first().click();
        await expect(page.getByRole("heading", { name: "Өзгеріске дейін", exact: true }).first()).toBeVisible();
      }
      if (tab === "users") {
        await page.getByText("Тапсырыс беруші өкілдерінің рұқсаты", { exact: true }).click();
        await expect(page.getByLabel("Рұқсат беру тәсілі", { exact: true })).toBeVisible();
        await page.getByLabel("Рұқсат беру тәсілі", { exact: true }).selectOption("INVITE");
        await expect(page.getByLabel("Өкілдің аты", { exact: true })).toBeVisible();
      }
      await page.screenshot({ path: path.join(evidence, `settings-${tab}-kz.png`), fullPage: true });
    }
    await writeFile(path.join(evidence, "settings.json"), JSON.stringify({ language: "KZ", localizedUserForm: "PASS", safeAuditFieldsVisible: "PASS", samples }, null, 2));
  } finally { await context.close(); }
});

test("J12 legacy error changes language with the open form and preserves entered values", async ({ page }) => {
  await login(page, fixture.users.superAdmin);
  await page.goto("/settings?tab=profile");
  await page.getByRole("button", { name: "RU", exact: true }).last().click();
  await page.getByLabel("Город · RU", { exact: true }).fill("Синтетический несохранённый город");
  await page.route("**/api/settings/profile", async route => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ code: "PRIVILEGED_USER_REQUIRES_SUPER_ADMIN", message: "Администраторами, директорами и суперадминистраторами управляет суперадминистратор" }) });
  });
  await page.getByRole("button", { name: "Сохранить новую версию", exact: true }).click();
  await expect(page.getByText("Администраторами, директорами и суперадминистраторами управляет суперадминистратор", {exact:true})).toBeVisible();
  await page.getByRole("button", { name: "KZ", exact: true }).last().click();
  await expect(page.getByText("Әкімшілерді, директорларды және суперәкімшілерді тек суперәкімші басқарады.", {exact:false})).toBeVisible();
  await expect(page.getByLabel("Қала · RU", { exact: true })).toHaveValue("Синтетический несохранённый город");
  await page.getByRole("button", { name: "RU", exact: true }).last().click();
  await expect(page.getByText("Администраторами, директорами и суперадминистраторами управляет суперадминистратор", {exact:true})).toBeVisible();
  await expect(page.getByLabel("Город · RU", { exact: true })).toHaveValue("Синтетический несохранённый город");
  await writeFile(path.join(evidence, "error-language.json"), JSON.stringify({ status: "PASS", source: "Local synthetic403 response; center profile unchanged", code: "PRIVILEGED_USER_REQUIRES_SUPER_ADMIN", switching: ["RU", "KZ", "RU"], valuesPreserved: true }, null, 2));
});

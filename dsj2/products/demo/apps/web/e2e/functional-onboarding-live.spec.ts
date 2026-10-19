import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

const product = path.resolve(__dirname, "../../..");
const runtime = path.join(product, ".runtime/functional-completion-20261019/run-01");
const setupPath = path.join(runtime, "clean-director.private.json");
const enabled = process.env.DEMO_FUNCTIONAL_ONBOARDING === "1";
const setup = enabled ? JSON.parse(readFileSync(setupPath, "utf8")) : null;
const evidence = path.join(product, "docs/evidence/functional-completion-20261019/run-01/onboarding");
const progressPath = path.join(runtime, "onboarding-result.private.json");
type User = { id?: string; email: string; password: string; role: string; displayName: string };
type Progress = { initialRole?: string; bootstrapComplete?: boolean; users: Record<string, User>; organizations?: { id: string; nameRu: string; nameKz: string }[]; profileId?: string; employer?: User; membershipId?: string; learner?: User };
function progress(): Progress { return existsSync(progressPath) ? JSON.parse(readFileSync(progressPath, "utf8")) : { users: {} }; }
async function save(value: Progress) { await writeFile(progressPath, JSON.stringify(value, null, 2)); }
async function proof(name: string, value: unknown) { await mkdir(evidence, { recursive: true }); await writeFile(path.join(evidence, name), JSON.stringify(value, null, 2)); }
test.use({ trace: "off", screenshot: "off", video: "off" });
test.describe.configure({ mode: "serial" });
test.skip(!enabled, "Requires the explicitly isolated functional-completion clean runtime");
test.beforeEach(async () => { expect(process.env.DEMO_ORIGIN).toBe(setup.baseURL); expect(setup.baseURL).toBe("http://127.0.0.1:3350"); await mkdir(evidence, { recursive: true }); });

async function login(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByRole("button", { name: "RU", exact: true }).click();
  await page.getByLabel("Электронная почта", { exact: true }).fill(user.email);
  await page.getByLabel("Пароль", { exact: true }).fill(user.password);
  for (let attempt = 0; attempt < 3; attempt++) {
    const pending = page.waitForResponse(response => response.url().endsWith("/api/auth/login") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    const response = await pending;
    if (response.status() !== 429) { expect(response.status()).toBe(201); break; }
    await page.waitForTimeout(60_000);
  }
  await expect(page).not.toHaveURL(/\/login/);
}
async function geometry(page: Page, label: string) {
  const measurements = [];
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const actual = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }));
    expect(actual.width, `${label} at ${width}`).toBeLessThanOrEqual(actual.viewport + 1);
    measurements.push({ label, ...actual });
  }
  return measurements;
}

test("F01 clean DIRECTOR bootstrap and every staff account are created through UI", async ({ page, browser }) => {
  test.setTimeout(600_000);
  const state = progress();
  await login(page, setup);
  const before = await page.request.get("/api/context").then(response => response.json());
  if (!state.initialRole) { state.initialRole = before.user.role; await save(state); }
  expect(state.initialRole).toBe("DIRECTOR");
  await page.goto("/settings?tab=users");
  if (before.user.role !== "SUPER_ADMIN") {
    await page.getByRole("button", { name: "Назначить первого суперадминистратора", exact: true }).click();
    const modal = page.getByRole("dialog");
    await modal.getByLabel("Текущий пароль", { exact: true }).fill(setup.password);
    await modal.getByRole("checkbox").check();
    const applied = page.waitForResponse(response => response.url().endsWith("/api/users/bootstrap-super-admin") && response.request().method() === "POST");
    await modal.getByRole("button", { name: "Подтвердить назначение", exact: true }).click();
    expect((await applied).status()).toBe(201);
    await expect(page).toHaveURL(/\/login/);
    await login(page, setup);
    state.bootstrapComplete = true; await save(state);
  }
  state.users.superAdmin = { ...setup, id: before.user.id, role: "SUPER_ADMIN", displayName: "Руководитель учебного центра" };
  await page.goto("/settings?tab=users");
  for (const role of ["ADMIN", "DIRECTOR", "OPERATOR", "TEACHER", "METHODIST", "EXPERT", "VIEWER"]) {
    const key = role.toLowerCase();
    if (state.users[key]) continue;
    const user = { email: `functional-${key}-${Date.now()}@example.test`, password: `Local-${randomBytes(18).toString("base64url")}!`, role, displayName: ({ ADMIN: "Администратор учебного центра", DIRECTOR: "Директор учебного центра", OPERATOR: "Оператор учебного центра", TEACHER: "Преподаватель учебного центра", METHODIST: "Методист учебного центра", EXPERT: "Эксперт учебного центра", VIEWER: "Наблюдатель учебного центра" } as Record<string, string>)[role]! };
    await page.getByRole("button", { name: "Добавить сотрудника", exact: true }).click();
    const modal = page.getByRole("dialog");
    await modal.getByLabel("Имя", { exact: true }).fill(user.displayName);
    await modal.getByLabel("Электронная почта", { exact: true }).fill(user.email);
    await modal.getByRole("combobox", { name: /^Роль/ }).selectOption(role);
    await modal.getByLabel("Первоначальный пароль", { exact: true }).fill(user.password);
    const pending = page.waitForResponse(response => response.url().endsWith("/api/users") && response.request().method() === "POST");
    await modal.getByRole("button", { name: "Сохранить", exact: true }).click();
    const response = await pending; expect(response.status(), await response.text()).toBe(201);
    const created = await response.json(); state.users[key] = { ...user, id: created.id }; await save(state);
    await expect(modal).toHaveCount(0);
  }
  const logins = [];
  for (const user of Object.values(state.users)) {
    const isolated = await browser.newContext(); const account = await isolated.newPage();
    try {
      await login(account, user);
      const current = await account.request.get("/api/context").then(response => response.json());
      expect(current.user.role).toBe(user.role); expect(current.tenant.id).toBe(before.tenant.id);
      logins.push({ role: user.role, id: current.user.id, path: new URL(account.url()).pathname });
      if (user.role === "OPERATOR") expect((await account.request.get("/api/users")).status()).toBe(403);
    } finally { await isolated.close(); }
  }
  await page.screenshot({ path: path.join(evidence, "F01-users.png"), fullPage: true });
  await proof("F01.json", { result: "PASS", initialRole: state.initialRole, bootstrapComplete: state.bootstrapComplete, logins, mutations: "Browser UI only; setup supplied one DIRECTOR; GET API readback", fixturePrerequisites: false });
});

test("F02/F03 clean profile, commission and bilingual organizations through UI", async ({ page }) => {
  test.setTimeout(300_000);
  const state = progress(); await login(page, state.users.superAdmin!);
  await page.goto("/settings?tab=profile");
  if (!state.profileId) {
    await page.getByLabel("Собственное наименование", { exact: true }).fill("Учебный центр «Практика» — учебный пример");
    await page.getByText("Другое наименование на казахском", { exact: true }).click();
    await page.getByLabel("Собственное наименование на казахском отличается", { exact: true }).check();
    await page.getByLabel("Собственное наименование · KZ", { exact: true }).fill("«Практика» оқу орталығы — оқу мысалы");
    await page.getByLabel("Город · RU", { exact: true }).fill("Кызылорда");
    await page.getByLabel("Город · KZ", { exact: true }).fill("Қызылорда");
    await page.getByLabel("ФИО руководителя учебного центра", { exact: true }).fill("Директор Учебного Примера");
    await page.getByLabel("Название комиссии / версии профиля", { exact: true }).fill("Учебная комиссия локальной проверки");
    await page.getByLabel("Основание утверждения / полномочий", { exact: true }).fill("Локальный учебный пример для проверки процесса. Не является реальным приказом или полномочием.");
    for (let i = 0; i < 3; i++) {
      await page.getByRole("button", { name: i ? "Добавить члена комиссии" : "Добавить председателя", exact: true }).click();
      await page.getByLabel("ФИО", { exact: true }).nth(i).fill(["Председатель Учебного Примера", "Преподаватель Учебного Примера", "Эксперт Учебного Примера"][i]!);
      await page.getByLabel("Роль в комиссии / должность", { exact: true }).nth(i).fill(i ? "Член комиссии" : "Председатель");
    }
    await page.getByLabel("Реквизиты и состав комиссии проверены уполномоченным сотрудником центра", { exact: true }).check();
    const pending = page.waitForResponse(response => response.url().endsWith("/api/settings/profile") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Сохранить новую версию", exact: true }).click();
    const result = await pending; expect(result.status(), await result.text()).toBe(201);
    const profile = await result.json(); state.profileId = profile.id; await save(state);
  }
  state.organizations ||= [];
  for (let i = state.organizations.length; i < 2; i++) {
    await page.goto("/customers");
    await page.getByRole("button", { name: "Добавить заказчика", exact: true }).first().click();
    const modal = page.getByRole("dialog");
    const nameRu = i ? "Учебная организация «Бета»" : "Учебная организация «Альфа»";
    const nameKz = i ? "«Бета» оқу ұйымы" : "«Альфа» оқу ұйымы";
    await modal.getByLabel("Собственное наименование", { exact: true }).fill(nameRu);
    await modal.getByText("Другое наименование на казахском", { exact: true }).click();
    await modal.getByLabel("Собственное наименование на казахском отличается", { exact: true }).check();
    await modal.getByLabel("Собственное наименование · KZ", { exact: true }).fill(nameKz);
    const pending = page.waitForResponse(response => response.url().endsWith("/api/customers") && response.request().method() === "POST");
    await modal.getByRole("button", { name: "Сохранить", exact: true }).click();
    const result = await pending; expect(result.status(), await result.text()).toBe(201);
    const customer = await result.json(); state.organizations.push({ id: customer.id, nameRu, nameKz }); await save(state);
    await expect(modal).toHaveCount(0);
  }
  await page.reload();
  for (const customer of state.organizations) await expect(page.getByText(customer.nameKz, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "KZ", exact: true }).last().click();
  await expect(page.getByRole("heading", { name: "Тапсырыс берушілер", exact: true })).toBeVisible();
  const measurements = await geometry(page, "Customers KZ");
  await page.screenshot({ path: path.join(evidence, "F03-organizations-kz.png"), fullPage: true });
  await proof("F02-F03-prerequisites.json", { result: "PASS", profileId: state.profileId, organizations: state.organizations, measurements, mutations: "Browser UI only", synthetic: true, boundary: "Local training profile and commission, not real legal authority" });
});

test("F03 representative invitation, acceptance and scoped cabinet are completed through UI", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const state = progress(); await login(page, state.users.superAdmin!);
  await page.goto("/settings?tab=users");
  await page.getByText("Доступ представителей заказчиков", { exact: true }).click();
  const panel = page.locator("#organization-access");
  await expect(panel.getByLabel("Способ предоставления доступа", { exact: true })).toHaveValue("INVITE");
  await panel.getByRole("button", { name: "Выбрать организацию", exact: true }).click();
  const picker = page.getByRole("dialog");
  await picker.getByLabel("Поиск по справочнику", { exact: true }).fill(state.organizations![0]!.nameRu);
  await picker.getByRole("button", { name: "Выбрать", exact: true }).click();
  const employer = state.employer || { email: `functional-employer-${Date.now()}@example.test`, password: `Local-${randomBytes(18).toString("base64url")}!`, role: "EMPLOYER", displayName: "Представитель учебной организации" };
  state.employer = employer; await save(state);
  await panel.getByLabel("Имя представителя", { exact: true }).fill(employer.displayName);
  await panel.getByLabel("Адрес представителя", { exact: true }).fill(employer.email);
  await panel.getByLabel("Доступ до", { exact: true }).fill("2027-10-19T18:00");
  await panel.getByLabel("Скачивание файлов", { exact: true }).check();
  await panel.getByLabel("Назначение обучения", { exact: true }).check();
  await panel.getByLabel("Разрешаю доступ к составу и заказам выбранной организации в пределах отмеченных прав", { exact: true }).check();
  const invitationCreated = page.waitForResponse(response => response.url().endsWith("/api/employer-invites") && response.request().method() === "POST");
  await panel.getByRole("button", { name: "Создать одноразовое приглашение", exact: true }).click();
  expect((await invitationCreated).status()).toBe(201);
  await expect(panel.getByLabel("Одноразовая ссылка", { exact: true })).toBeVisible();
  const inviteUrl = await panel.getByLabel("Одноразовая ссылка", { exact: true }).inputValue();
  // Hide the one-time link before any later assertion can capture the page snapshot.
  await panel.locator("summary").first().click();
  const session = await browser.newContext(); const representative = await session.newPage();
  try {
    await representative.goto(inviteUrl);
    await expect(representative.getByRole("heading", { name: "Приглашение представителя", exact: true })).toBeVisible();
    const existing = representative.getByLabel("Текущий пароль", { exact: true });
    if (await existing.count()) await existing.fill(employer.password);
    else {
      await representative.getByLabel("Новый пароль", { exact: true }).fill(employer.password);
      await representative.getByLabel("Повторите новый пароль", { exact: true }).fill(employer.password);
    }
    await representative.getByRole("button", { name: "Принять приглашение", exact: true }).click();
    await expect(representative).toHaveURL(/\/portal$/);
    await expect(representative.getByRole("heading", { name: state.organizations![0]!.nameRu, exact: true })).toBeVisible();
    const current = await representative.request.get("/api/context").then(response => response.json());
    employer.id = current.user.id; await save(state);
    expect(current.user.role).toBe("EMPLOYER"); expect(current.user.canAssignTraining).toBe(true);
    const own = await representative.request.get("/api/lms/employer-import/context").then(response => response.json());
    expect(own.customers.map((item: { id: string }) => item.id)).toEqual([state.organizations![0]!.id]);
    expect((await representative.request.get(`/api/customers/${state.organizations![1]!.id}`)).status()).toBe(403);
    await representative.reload();
    await representative.getByRole("button", { name: "KZ", exact: true }).last().click();
    await expect(representative.getByRole("heading", { name: "Ұйым кабинеті", exact: true })).toBeVisible();
    const measurements = await geometry(representative, "Employer KZ");
    await representative.screenshot({ path: path.join(evidence, "F03-employer-kz.png"), fullPage: true });
    await proof("F03-invitation.json", { result: "PASS", employerId: employer.id, customerId: state.organizations![0]!.id, invitation: "Prepared and accepted in UI", permissions: ["READ", "DOWNLOAD", "ASSIGN_TRAINING"], otherOrganizationDenied: true, reload: true, measurements, outboundEmail: false });
  } finally { await session.close(); }
});

test("F03/F29 revoked representative requests access and administrator resolves the real handoff", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const state = progress(); const employer = state.employer!; const customer = state.organizations![0]!;
  await login(page, state.users.superAdmin!);
  await page.goto("/settings?tab=users#organization-access");
  const panel = page.locator("#organization-access");
  await expect(panel).toHaveAttribute("open", "");
  const membership = panel.getByRole("row").filter({ hasText: employer.email });
  await expect(membership).toBeVisible();
  const revoke = membership.getByRole("button", { name: "Отозвать доступ", exact: true });
  if (await revoke.count()) await revoke.click();
  await expect(membership.getByText("Отозван", { exact: true })).toBeVisible();
  const isolated = await browser.newContext(); const representative = await isolated.newPage();
  try {
    await login(representative, employer);
    await expect(representative.getByRole("heading", { name: "Доступ к организации", exact: true })).toBeVisible();
    await expect(representative.getByText("Загружаем запросы…", { exact: true })).toHaveCount(0);
    if (await representative.getByRole("button", { name: "Запросить доступ", exact: true }).count()) {
      await representative.getByLabel("Название организации", { exact: true }).fill(customer.nameRu);
      await representative.getByLabel("Комментарий для учебного центра", { exact: true }).fill("Прошу восстановить доступ представителя к учебной организации для локального учебного процесса.");
      await representative.getByRole("button", { name: "Запросить доступ", exact: true }).click();
    }
    await expect(representative.getByText("Ожидает решения центра", { exact: true })).toBeVisible();
    await representative.reload();
    await expect(representative.getByText("Ожидает решения центра", { exact: true })).toBeVisible();
    await expect(representative.getByRole("button", { name: "Запросить доступ", exact: true })).toHaveCount(0);
    await page.reload();
    await panel.getByRole("button", { name: "Рассмотреть", exact: true }).click();
    const decision = panel.getByRole("region", { name: "Решение по запросу", exact: true });
    await decision.getByRole("combobox", { name: "Выбрать организацию", exact: true }).selectOption(customer.id);
    await decision.getByLabel("Скачивание файлов", { exact: true }).check();
    await decision.getByLabel("Назначение обучения", { exact: true }).check();
    await decision.getByLabel("Доступ до", { exact: true }).fill("2027-10-19T18:00");
    await decision.getByLabel("Комментарий к решению", { exact: true }).fill("В учебном примере проверена принадлежность представителя выбранной организации.");
    await decision.getByRole("checkbox", { name: /Полномочия представителя проверены/ }).check();
    await decision.getByRole("button", { name: "Предоставить доступ", exact: true }).click();
    await expect(panel.getByText("Доступ предоставлен", { exact: true })).toBeVisible();
    await representative.reload();
    await expect(representative.getByRole("heading", { name: customer.nameRu, exact: true })).toBeVisible();
    const own = await representative.request.get("/api/employer-access-requests").then(response => response.json());
    const request = own.items.find((item: { organizationName: string; status: string }) => item.organizationName === customer.nameRu && item.status === "APPROVED");
    expect(request).toBeTruthy();
    const grants = await page.request.get("/api/employer-memberships").then(response => response.json());
    const active = grants.items.filter((item: { userId: string; customerId: string; active: boolean }) => item.userId === employer.id && item.customerId === customer.id && item.active);
    expect(active).toHaveLength(1); state.membershipId = active[0].id; await save(state);
    await representative.screenshot({ path: path.join(evidence, "F03-access-restored.png"), fullPage: true });
    await proof("F03-access-request.json", { result: "PASS", employerId: employer.id, customerId: customer.id, requestId: request.id, membershipId: state.membershipId, pendingSurvivesReload: true, duplicateActiveMemberships: 0, mutations: "Revocation, own request and manager decision through UI", fixturePrerequisites: false });
  } finally { await isolated.close(); }
});

test("F04 self registration creates a real learner with consent and useful empty cabinet", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const state = progress(); await login(page, state.users.admin!);
  await page.goto("/settings?tab=users");
  await expect(page.getByRole("button", { name: /^(Открыть|Закрыть) самостоятельную регистрацию$/ })).toBeEnabled();
  const open = page.getByRole("button", { name: "Открыть самостоятельную регистрацию", exact: true });
  if (await open.count()) await open.click();
  await expect(page.getByRole("button", { name: "Закрыть самостоятельную регистрацию", exact: true })).toBeVisible();
  const isolated = await browser.newContext(); const learner = await isolated.newPage();
  try {
    const user = state.learner || { email: `functional-learner-${Date.now()}@example.test`, password: `Local-${randomBytes(18).toString("base64url")}!`, role: "LEARNER", displayName: "Слушатель учебного центра" };
    if (!state.learner?.id) {
      state.learner = user; await save(state);
      await learner.goto("/learn/register");
      await learner.getByLabel("ФИО", { exact: true }).fill(user.displayName);
      await learner.getByLabel("Электронная почта", { exact: true }).fill(user.email);
      await learner.getByLabel("Придумайте пароль", { exact: true }).fill(user.password);
      await learner.getByRole("button", { name: "KZ", exact: true }).click();
      await expect(learner.getByLabel("Аты-жөні", { exact: true })).toHaveValue(user.displayName);
      await learner.getByRole("button", { name: "RU", exact: true }).click();
      await learner.getByRole("checkbox").check();
      await learner.getByRole("button", { name: "Создать личный кабинет", exact: true }).click();
      await expect(learner).toHaveURL(/\/learn$/);
    } else await login(learner, user);
    const current = await learner.request.get("/api/context").then(response => response.json());
    expect(current.user.role).toBe("LEARNER"); user.id = current.user.id; state.learner = user; state.users.learner = user; await save(state);
    await expect(learner.getByRole("heading", { name: "Моё обучение", exact: true })).toBeVisible();
    await learner.screenshot({ path: path.join(evidence, "F04-registered-learner.png"), fullPage: true });
    await proof("F04-registration.json", { result: "PASS", learnerId: user.id, enabledByAdminUI: true, registeredThroughUI: true, explicitConsent: true, localePreservesInput: true, fixturePrerequisites: false, boundary: "Registration complete; application and assignment continue after course publication in the learning chain" });
  } finally { await isolated.close(); }
});

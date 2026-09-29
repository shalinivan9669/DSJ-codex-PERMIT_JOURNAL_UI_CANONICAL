import { test, expect, type Page } from "@playwright/test";
import { profileSchema, type IssuerProfile } from "@demo/contracts";

const legacyProfile = profileSchema.parse({
  nameRu: "ТОО Синтетический центр",
  nameKz: "Синтетикалық орталық ЖШС",
  addressRu: "",
  addressKz: "",
  cityRu: "",
  cityKz: "",
  approvalBasis: "",
  headName: "Прежний руководитель",
  commission: [
    { name: "Председатель", position: "Председатель комиссии" },
    { name: "Член комиссии", position: "Преподаватель" },
  ],
  approved: false,
  people: [{ name: "Прежний подписант", position: "Директор", role: "SIGNER" }],
  commonFields: {
    documentDate: "2026-09-29",
    hours: "40",
    trainingDateRule: {
      hoursPerDay: 8,
      hoursSource: "THEORY",
      calendar: "WEEKDAYS",
      anchor: "DOCUMENT_AFTER_TRAINING",
      protocolDate: "DOCUMENT_DATE",
      source: "Синтетическое расписание центра",
    },
  },
});

async function fixture(
  page: Page,
  options: { signedIn?: boolean; failRegistration?: boolean } = {},
) {
  await page.routeWebSocket(/\/_next\/webpack-hmr/, (socket) => socket.close());
  let signedIn = !!options.signedIn;
  let profile = structuredClone(legacyProfile);
  let version = 1;
  const registrations: Record<string, unknown>[] = [];
  const saved: IssuerProfile[] = [];
  const mutations: string[] = [];
  const templates = [
    {
      id: "synthetic-template",
      templateId: "ptm-card",
      version: "1",
      approved: false,
      contract: {},
    },
  ];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.slice(4);
    const method = route.request().method();
    if (method !== "GET") mutations.push(path);
    let value: unknown = { items: [], total: 0 };
    if (path === "/auth/session") {
      if (!signedIn)
        return route.fulfill({ status: 401, json: { message: "Войдите" } });
      value = { csrfToken: "synthetic-center-csrf" };
    } else if (path === "/auth/register") {
      const body = route.request().postDataJSON();
      registrations.push(body);
      if (options.failRegistration)
        return route.fulfill({
          status: 409,
          json: {
            message:
              "Этот адрес уже используется. Войдите в существующий центр.",
          },
        });
      signedIn = true;
      profile = profileSchema.parse({
        ...legacyProfile,
        legalForm: body.legalForm,
        ownNameRu: body.ownNameRu,
        ownNameKz: body.ownNameKz,
        headName: "",
        commission: [],
        people: [],
        commonFields: undefined,
      });
      value = { csrfToken: "synthetic-center-csrf" };
    } else if (path === "/context")
      value = {
        user: {
          id: "synthetic-admin",
          role: "ADMIN",
          displayName: "Администратор",
          email: "admin@example.test",
        },
        tenant: {
          id: "synthetic-center",
          name: profile.nameRu,
          timezone: "Asia/Almaty",
          today: "2026-09-29",
          demoOnly: false,
        },
        profile,
        profileVersionId: `profile-${version}`,
        templates,
        numbering: [],
      };
    else if (path === "/settings/templates") value = templates;
    else if (path === "/settings/profile" && method === "POST") {
      profile = profileSchema.parse(route.request().postDataJSON());
      saved.push(structuredClone(profile));
      version++;
      value = { id: `profile-${version}`, version, profile };
    }
    await route.fulfill({ status: method === "POST" ? 201 : 200, json: value });
  });
  return { registrations, saved, mutations };
}
async function fillRegistration(page: Page) {
  await page.getByLabel("Форма организации").selectOption("TOO");
  await page
    .getByRole("textbox", { name: "Собственное наименование", exact: false })
    .fill("Синтетический новый центр");
  await page.getByLabel("Ваше имя").fill("Синтетический администратор");
  await page.getByLabel("Электронная почта").fill("NewCenter@Example.test");
  await page
    .getByLabel("Пароль", { exact: false })
    .fill("Synthetic-browser-password!");
}

test("guest registers center, lands in editable onboarding, preserves unsaved steps and can begin an unapproved draft", async ({
  page,
}, info) => {
  const state = await fixture(page);
  await page.goto("/login");
  await page
    .getByRole("link", { name: "Зарегистрировать учебный центр" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Зарегистрировать учебный центр" }),
  ).toBeVisible();
  await fillRegistration(page);
  await expect(page.locator(".organization-name-preview")).toContainText(
    "ТОО Синтетический новый центр",
  );
  await expect(page.locator(".organization-name-preview")).toContainText(
    "Синтетический новый центр ЖШС",
  );
  await page
    .getByRole("button", { name: "Создать центр и продолжить" })
    .click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(
    page.getByRole("heading", { name: "Подготовим ваш центр к работе" }),
  ).toBeVisible();
  expect(state.registrations).toEqual([
    {
      legalForm: "TOO",
      ownNameRu: "Синтетический новый центр",
      ownNameKz: "",
      displayName: "Синтетический администратор",
      email: "newcenter@example.test",
      password: "Synthetic-browser-password!",
    },
  ]);
  await page
    .getByLabel("ФИО руководителя учебного центра")
    .fill("Несохранённый руководитель");
  await page.getByRole("button", { name: "Перейти к формам" }).click();
  await expect(
    page.getByRole("heading", { name: "Формы документов" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Подтвердить форму" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "1 Реквизиты и люди" }).click();
  await expect(page.getByLabel("ФИО руководителя учебного центра")).toHaveValue(
    "Несохранённый руководитель",
  );
  await page.screenshot({
    path: info.outputPath("center-onboarding-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "Начать черновик заявки" }).click();
  await expect(page).toHaveURL(/\/requests\/new$/);
  expect(state.mutations).toEqual(["/auth/register"]);
});

test("profile save preserves legacy names, schedule and existing people while adding explicit chair/member/teacher roles", async ({
  page,
}, info) => {
  const state = await fixture(page, { signedIn: true });
  await page.goto("/settings");
  await page
    .getByLabel("ФИО руководителя учебного центра")
    .fill("Новый руководитель");
  await expect(
    page.getByText("Председатель комиссии", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Член комиссии 1", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Добавить члена комиссии" }).click();
  await page
    .locator(".commission-row")
    .last()
    .getByLabel("ФИО", { exact: true })
    .fill("Новый член комиссии");
  await page
    .locator(".commission-row")
    .last()
    .getByLabel("Роль в комиссии / должность")
    .fill("Инженер");
  await page
    .getByText("Другие преподаватели и подписанты", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Добавить преподавателя или подписанта" })
    .click();
  await page.getByLabel("ФИО сотрудника").last().fill("Новый преподаватель");
  await page.getByRole("button", { name: "Сохранить новую версию" }).click();
  await expect(
    page.getByText("Создана новая версия реквизитов.", { exact: false }),
  ).toBeVisible();
  expect(state.saved).toHaveLength(1);
  expect(state.saved[0]).toMatchObject({
    nameRu: legacyProfile.nameRu,
    nameKz: legacyProfile.nameKz,
    headName: "Новый руководитель",
    commonFields: legacyProfile.commonFields,
    approved: false,
  });
  expect(state.saved[0].people).toEqual([
    ...legacyProfile.people!,
    { name: "Новый преподаватель", position: "", role: "TEACHER" },
  ]);
  expect(state.saved[0].commission).toEqual([
    ...legacyProfile.commission,
    { name: "Новый член комиссии", position: "Инженер" },
  ]);
  expect(state.mutations).toEqual(["/settings/profile"]);
  await page.getByRole("button", { name: "Сохранить новую версию" }).click();
  await expect.poll(() => state.saved.length).toBe(2);
  expect(state.saved[1]).toEqual(state.saved[0]);
  await page.screenshot({
    path: info.outputPath("center-profile-desktop.png"),
    fullPage: true,
  });
});

test("failed registration keeps data editable and never opens onboarding", async ({
  page,
}) => {
  const state = await fixture(page, { failRegistration: true });
  await page.goto("/register");
  await fillRegistration(page);
  await page
    .getByRole("button", { name: "Создать центр и продолжить" })
    .click();
  await expect(
    page.getByText("Этот адрес уже используется.", { exact: false }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByLabel("Ваше имя")).toHaveValue(
    "Синтетический администратор",
  );
  await expect(
    page.getByRole("button", { name: "Создать центр и продолжить" }),
  ).toBeEnabled();
  expect(state.saved).toHaveLength(0);
});

test("registration and onboarding fit a 390px screen", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await page.goto("/register");
  await fillRegistration(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: info.outputPath("center-register-mobile.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Создать центр и продолжить" })
    .click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole("button", { name: "Добавить председателя" }).click();
  await page
    .locator(".commission-row")
    .getByLabel("ФИО", { exact: true })
    .fill("Синтетический председатель");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: info.outputPath("center-onboarding-mobile.png"),
    fullPage: true,
  });
});

import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { formatOrganizationNames, type IssuerProfile } from "@demo/contracts";
import { provision } from "../../../scripts/setup";
import { db, type Context } from "../../../apps/api/src/core";
import {
  bootstrapSuperAdmin,
  saveProfile,
} from "../../../apps/api/src/settings";
import { assertTestDatabase } from "../../../tests/integration/test-database";

test.use({ trace: "off" });
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    "../../../.runtime/commission-flow/evidence/commission-template",
);
const roles = ["Председатель комиссии", "Член комиссии 1", "Член комиссии 2"];
const headName = "Синтетический Руководитель Центра";

async function fixture(
  profilePatch: Partial<IssuerProfile> = {},
  superAdmin = false,
) {
  assertTestDatabase();
  expect(["127.0.0.1", "localhost"]).toContain(
    new URL(process.env.DATABASE_URL!).hostname,
  );
  const suffix = randomUUID();
  const password = `Synthetic-commission-template-${suffix}!`;
  const email = `commission-template-${suffix}@example.test`;
  const owner = await provision({
    email,
    password,
    name: "Синтетический шаблон комиссии",
    sample: true,
  });
  const context: Context = {
    ...owner,
    role: "DIRECTOR",
    sessionId: "test",
    csrfHash: "test",
    correlationId: suffix,
  };
  if (superAdmin) {
    await bootstrapSuperAdmin(context, {
      currentPassword: password,
      confirm: true,
    });
    context.role = "SUPER_ADMIN";
  }
  const source = await db.issuerProfileVersion.findFirstOrThrow({
    where: { tenantId: owner.tenantId },
  });
  const names = formatOrganizationNames(
    "TOO",
    "«Синтетический учебный центр»",
    "«Синтетикалық оқу орталығы»",
  );
  const { issue: _issue, normalized: _normalized, ...organization } = names;
  const initial = await saveProfile(context, {
    ...(source.profile as object),
    ...organization,
    headName,
    commission: [],
    approved: true,
    people: [
      {
        name: "Синтетический Преподаватель",
        position: "Инженер по безопасности",
        role: "TEACHER",
      },
      {
        name: "Синтетический Подписант",
        position: "Начальник отдела",
        role: "SIGNER",
      },
    ],
    ...profilePatch,
  });
  return { context, email, password, initial, organization };
}

async function login(page: Page, seeded: { email: string; password: string }) {
  await page.goto("/login");
  await page
    .getByLabel("Электронная почта", { exact: true })
    .fill(seeded.email);
  await page.getByLabel("Пароль", { exact: true }).fill(seeded.password);
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
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
    return;
  }
  throw new Error("Synthetic browser login remained rate-limited");
}

function name(page: Page, index: number) {
  return page.getByRole("textbox", {
    name: `${roles[index] || `Член комиссии ${index}`} — ФИО`,
    exact: true,
  });
}
function job(page: Page, index: number) {
  return page.getByRole("combobox", {
    name: `${roles[index] || `Член комиссии ${index}`} — Должность`,
    exact: true,
  });
}
async function jobs(page: Page, expected: string[]) {
  for (let index = 0; index < expected.length; index++)
    await expect(job(page, index).locator("option:checked")).toHaveText(
      expected[index],
    );
}
async function save(page: Page, label = "Сохранить комиссию") {
  const saving = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/settings/profile") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: label, exact: true }).click();
  const response = await saving;
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function latest(tenantId: string) {
  return db.issuerProfileVersion.findFirstOrThrow({
    where: { tenantId },
    orderBy: { version: "desc" },
  });
}
async function screenshot(page: Page, filename: string) {
  await fs.mkdir(evidence, { recursive: true });
  await page.locator("#profile-commission").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(evidence, `${filename}.png`),
    fullPage: false,
  });
  await page
    .locator("#profile-commission")
    .screenshot({ path: path.join(evidence, `${filename}-section.png`) });
}
test.afterAll(async () => {
  await db.$disconnect();
});

test("empty UMO template keeps commission roles distinct from jobs and reuses the director only explicitly", async ({
  page,
}) => {
  const seeded = await fixture();
  const usersBefore = await db.user.count({
    where: { tenantId: seeded.context.tenantId },
  });
  await login(page, seeded);
  await page.goto("/settings?tab=profile&focus=commission");
  await expect(
    page.getByRole("combobox", { name: "Шаблон состава", exact: true }),
  ).toHaveValue("umo-chair");
  await jobs(page, ["Начальник УМО", "Директор", "Преподаватель"]);
  for (let index = 0; index < 3; index++)
    await expect(name(page, index)).toHaveValue("");
  await expect(page.locator("#profile-commission")).toContainText(
    seeded.organization.nameRu,
  );
  await expect(
    page.getByLabel("ФИО руководителя учебного центра", { exact: true }),
  ).toHaveValue(headName);
  await name(page, 0).fill("Синтетический Начальник УМО");
  await page
    .getByRole("button", {
      name: "Подставить руководителя центра",
      exact: true,
    })
    .click();
  await expect(name(page, 1)).toHaveValue(headName);
  await expect(
    page.getByRole("combobox", { name: "Шаблон состава", exact: true }),
  ).toBeDisabled();
  await expect(name(page, 0)).toHaveValue("Синтетический Начальник УМО");
  await name(page, 2).fill("Синтетический Преподаватель комиссии");
  const saved = await save(page);
  expect(saved.profile.commission).toEqual([
    { name: "Синтетический Начальник УМО", position: "Начальник УМО" },
    { name: headName, position: "Директор" },
    { name: "Синтетический Преподаватель комиссии", position: "Преподаватель" },
  ]);
  await page.reload();
  await jobs(page, ["Начальник УМО", "Директор", "Преподаватель"]);
  await expect(name(page, 1)).toHaveValue(headName);
  expect((await latest(seeded.context.tenantId)).profile).toMatchObject({
    ...seeded.organization,
    headName,
    people: (seeded.initial.profile as IssuerProfile).people,
  });
  expect(
    await db.user.count({ where: { tenantId: seeded.context.tenantId } }),
  ).toBe(usersBefore);
  expect(
    (
      await db.issuerProfileVersion.findUniqueOrThrow({
        where: { id: seeded.initial.id },
      })
    ).profile,
  ).toEqual(seeded.initial.profile);
  await screenshot(page, "umo-template-saved-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await screenshot(page, "umo-template-saved-390");
});

test("director-chair template on mobile validates names and preserves the draft after a failed save", async ({
  page,
}) => {
  const seeded = await fixture({}, true);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, seeded);
  await page.goto("/settings?tab=profile&focus=commission");
  await page
    .getByRole("combobox", { name: "Шаблон состава", exact: true })
    .selectOption("director-chair");
  await jobs(page, ["Директор", "Начальник УМО", "Преподаватель"]);
  await page
    .getByRole("button", {
      name: "Подставить руководителя центра",
      exact: true,
    })
    .click();
  await expect(name(page, 0)).toHaveValue(headName);
  const versionsBefore = await db.issuerProfileVersion.count({
    where: { tenantId: seeded.context.tenantId },
  });
  await page
    .getByRole("button", { name: "Сохранить комиссию", exact: true })
    .click();
  await expect(name(page, 1)).toBeFocused();
  await expect(name(page, 1)).toHaveAttribute("aria-invalid", "true");
  expect(
    await db.issuerProfileVersion.count({
      where: { tenantId: seeded.context.tenantId },
    }),
  ).toBe(versionsBefore);
  await name(page, 1).fill("Синтетический Член УМО");
  await name(page, 2).fill("Синтетический Член Преподаватель");
  await page.route("**/api/settings/profile", async (route) => {
    if (route.request().method() === "POST") await route.abort("failed");
    else await route.continue();
  });
  await page
    .getByRole("button", { name: "Сохранить комиссию", exact: true })
    .click();
  await expect(page.getByText(/Нет связи с сервером/)).toBeVisible();
  await jobs(page, ["Директор", "Начальник УМО", "Преподаватель"]);
  await expect(name(page, 0)).toHaveValue(headName);
  await expect(name(page, 1)).toHaveValue("Синтетический Член УМО");
  await expect(name(page, 2)).toHaveValue("Синтетический Член Преподаватель");
  await screenshot(page, "director-template-save-failed-390");
  await page.unroute("**/api/settings/profile");
  const saved = await save(page);
  expect(
    saved.profile.commission.map(
      (person: { position: string }) => person.position,
    ),
  ).toEqual(["Директор", "Начальник УМО", "Преподаватель"]);
  await page.reload();
  await expect(name(page, 0)).toHaveValue(headName);
  await jobs(page, ["Директор", "Начальник УМО", "Преподаватель"]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await screenshot(page, "director-template-saved-390");
});

test("applying a template to legacy data fills blank jobs without replacing names custom jobs translations or extra members", async ({
  page,
}) => {
  const commission = [
    {
      name: "Исторический Председатель",
      position: "Технический руководитель",
      nameEn: "Historical Chair",
      positionEn: "Technical Lead",
    },
    {
      name: "Исторический Первый Член",
      position: "",
      nameEn: "Historical First",
      positionEn: "Existing English Position",
    },
    {
      name: "Исторический Второй Член",
      position: "Преподаватель",
      nameEn: "Historical Second",
      positionEn: "Teacher",
    },
    {
      name: "Исторический Дополнительный Член",
      position: "Эксперт",
      nameEn: "Historical Extra",
      positionEn: "Expert",
    },
  ];
  const seeded = await fixture({
    commission,
    commissionTitle: "Исторический состав 2026",
  });
  await login(page, seeded);
  await page.goto("/settings?tab=profile&focus=commission");
  await expect(job(page, 0).locator("option:checked")).toHaveText(
    "Другая должность",
  );
  await expect(
    page
      .getByRole("group", { name: "Председатель комиссии", exact: true })
      .getByRole("textbox")
      .nth(1),
  ).toHaveValue("Технический руководитель");
  await page
    .getByRole("combobox", { name: "Шаблон состава", exact: true })
    .selectOption("director-chair");
  await expect(job(page, 1)).toHaveValue("");
  for (let index = 0; index < commission.length; index++)
    await expect(name(page, index)).toHaveValue(commission[index].name);
  await page
    .getByRole("button", { name: "Заполнить пустые должности", exact: true })
    .click();
  await expect(job(page, 1).locator("option:checked")).toHaveText(
    "Начальник УМО",
  );
  await expect(
    page
      .getByRole("group", { name: "Председатель комиссии", exact: true })
      .getByRole("textbox")
      .nth(1),
  ).toHaveValue("Технический руководитель");
  await expect(
    page
      .getByRole("group", { name: "Член комиссии 3", exact: true })
      .getByRole("textbox")
      .nth(1),
  ).toHaveValue("Эксперт");
  const saved = await save(page);
  expect(saved.profile.commission).toEqual(
    commission.map((person, index) =>
      index === 1 ? { ...person, position: "Начальник УМО" } : person,
    ),
  );
  expect(saved.profile).toMatchObject({
    ...seeded.organization,
    commissionTitle: "Исторический состав 2026",
    headName,
    people: (seeded.initial.profile as IssuerProfile).people,
  });
  await page.reload();
  await expect(name(page, 3)).toHaveValue(commission[3].name);
  expect(
    (
      await db.issuerProfileVersion.findUniqueOrThrow({
        where: { id: seeded.initial.id },
      })
    ).profile,
  ).toEqual(seeded.initial.profile);
  await screenshot(page, "legacy-custom-commission-preserved");
});

test("saving organization details leaves an untouched display-only commission template empty", async ({
  page,
}) => {
  const seeded = await fixture();
  await login(page, seeded);
  await page.goto("/settings?tab=profile");
  await jobs(page, ["Начальник УМО", "Директор", "Преподаватель"]);
  await page
    .getByLabel("Город · RU", { exact: true })
    .fill("Синтетический город");
  const saved = await save(page, "Сохранить реквизиты");
  expect(saved.profile.commission).toEqual([]);
  expect(saved.profile).toMatchObject({
    ...seeded.organization,
    cityRu: "Синтетический город",
    headName,
    people: (seeded.initial.profile as IssuerProfile).people,
  });
  await page.reload();
  for (let index = 0; index < 3; index++)
    await expect(name(page, index)).toHaveValue("");
  expect(
    ((await latest(seeded.context.tenantId)).profile as IssuerProfile)
      .commission,
  ).toEqual([]);
});

test("directory reuse copies only names and a custom organization job survives save and reload", async ({
  page,
}) => {
  const people: NonNullable<IssuerProfile["people"]> = [
    {
      name: "Синтетический Подписант УМО",
      position: "Начальник УМО",
      role: "SIGNER",
    },
    {
      name: "Синтетический Преподаватель из справочника",
      position: "Инженер",
      role: "TEACHER",
    },
  ];
  const seeded = await fixture({ people });
  const usersBefore = await db.user.count({
    where: { tenantId: seeded.context.tenantId },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, seeded);
  await page.goto("/settings?tab=profile&focus=commission");
  await page
    .getByRole("combobox", {
      name: "Председатель комиссии — Выбрать сотрудника центра",
      exact: true,
    })
    .selectOption("");
  await expect(name(page, 0)).toHaveValue("");
  await page
    .getByRole("combobox", {
      name: "Председатель комиссии — Выбрать сотрудника центра",
      exact: true,
    })
    .selectOption("0");
  await expect(name(page, 0)).toHaveValue(people[0].name);
  await expect(job(page, 0)).toHaveValue("Начальник УМО");
  await page
    .getByRole("button", {
      name: "Подставить руководителя центра",
      exact: true,
    })
    .click();
  await page
    .getByRole("combobox", {
      name: "Член комиссии 2 — Выбрать сотрудника центра",
      exact: true,
    })
    .selectOption("0");
  await expect(name(page, 2)).toHaveValue(people[1].name);
  await expect(job(page, 2)).toHaveValue("Преподаватель");
  await job(page, 2).selectOption("custom");
  await page
    .getByRole("textbox", {
      name: "Член комиссии 2 — Другая должность",
      exact: true,
    })
    .fill("Инструктор по охране труда");
  await expect(name(page, 2)).toHaveValue(people[1].name);
  const saved = await save(page);
  expect(saved.profile.people).toEqual(people);
  expect(saved.profile.commission).toEqual([
    { name: people[0].name, position: "Начальник УМО" },
    { name: headName, position: "Директор" },
    { name: people[1].name, position: "Инструктор по охране труда" },
  ]);
  expect(saved.profile).toMatchObject({ ...seeded.organization, headName });
  await page.reload();
  await expect(job(page, 2).locator("option:checked")).toHaveText(
    "Другая должность",
  );
  await expect(
    page.getByRole("textbox", {
      name: "Член комиссии 2 — Другая должность",
      exact: true,
    }),
  ).toHaveValue("Инструктор по охране труда");
  await expect(name(page, 2)).toHaveValue(people[1].name);
  expect(
    await db.user.count({ where: { tenantId: seeded.context.tenantId } }),
  ).toBe(usersBefore);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await screenshot(page, "directory-names-custom-job-390");
});

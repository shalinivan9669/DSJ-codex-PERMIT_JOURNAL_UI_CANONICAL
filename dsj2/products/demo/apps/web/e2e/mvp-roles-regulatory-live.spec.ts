import { test, expect, type Page, type Locator, type APIResponse } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import { measureLmsActions } from "./lms-action-measurement";
import type { CourseContent, RegulatoryProfile } from "../../../packages/contracts/src/lms";

type User = { id: string; email: string; password: string };
type Measure = ReturnType<typeof measureLmsActions>;
type Version = { id: string; status: string; version: number; regulatoryProfileVersionId: string; content: CourseContent; profile: RegulatoryProfile };
type Readback = { course: { id: string }; versions: Version[] };
type Inbox = { items: Array<{ id: string; titleRu: string; titleKz: string; sourceType: string; href: string; readAt: string | null }>; total: number };
async function body<T>(response: Pick<APIResponse, "ok" | "status" | "text" | "json">): Promise<T> {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true);
  return response.json() as Promise<T>;
}
async function login(page: Page, user: User) {
  await page.goto("/login");
  await page.getByLabel("Электронная почта").fill(user.email);
  await page.getByLabel("Пароль", { exact: true }).fill(user.password);
  let pending = page.waitForResponse((r) => r.url().endsWith("/auth/login") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  let response = await pending;
  if (response.status() === 429) {
    await page.waitForTimeout(30_000); await page.waitForTimeout(31_000);
    pending = page.waitForResponse((r) => r.url().endsWith("/auth/login") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    response = await pending;
  }
  expect(response.ok(), `Login HTTP ${response.status()}`).toBe(true);
  await expect(page).not.toHaveURL(/\/login/);
  if (await page.getByRole("button", { name: "RU", exact: true }).isVisible()) await page.getByRole("button", { name: "RU", exact: true }).click();
}
async function click(m: Measure, button: Locator, label: string) { await m.action("click", label, () => button.click()); }
async function fill(m: Measure, scope: Page | Locator, label: string, value: string) { await m.action("field", label, () => scope.getByLabel(label, { exact: true }).fill(value)); }
async function select(m: Measure, scope: Page | Locator, label: string, value: string) { await m.action("select", label, () => scope.getByLabel(label).selectOption(value), { decision: true }); }
async function tab(m: Measure, page: Page, label: string) { await click(m, page.getByRole("navigation", { name: "Разделы программы" }).getByRole("button", { name: label, exact: true }), label); }
async function expand(m: Measure, page: Page, label: string) {
  const panel = page.locator("details").filter({ has: page.locator(":scope > summary", { hasText: label }) }).first();
  if (!(await panel.evaluate((node) => (node as HTMLDetailsElement).open))) await click(m, panel.locator(":scope > summary"), label);
  return panel;
}
async function saved(page: Page) { await expect(page.locator(".lms-save-state")).toHaveText("Сохранено"); }
const snapshot = (version: Version) => createHash("sha256").update(JSON.stringify(version)).digest("hex");

test("J10 regulatory source revisions, targeted inbox, immutable history and scoped audit through real UI", async ({ browser }) => {
  test.setTimeout(240_000);
  const fixture = JSON.parse(readFileSync(process.env.DEMO_MVP_FIXTURE!, "utf8")) as { users: { authorMethodist: User; authorAdmin: User; superAdmin: User } };
  const output = process.env.DEMO_E2E_EVIDENCE!;
  await mkdir(output, { recursive: true });
  const authorContext = await browser.newContext({ baseURL: process.env.DEMO_ORIGIN });
  const adminContext = await browser.newContext({ baseURL: process.env.DEMO_ORIGIN });
  const auditContext = await browser.newContext({ baseURL: process.env.DEMO_ORIGIN });
  const auditor = await auditContext.newPage();
  const author = await authorContext.newPage(), admin = await adminContext.newPage();
  const token = randomUUID().slice(0, 8), title = `НПА синтетический ${token}`;
  const report: Record<string, unknown> = { startedAt: new Date().toISOString(), synthetic: true, actualRoute: "/lms/courses/:id → Сведения → Основание и оформление → Источник", sourceUrl: "Intentionally empty: synthetic engineering source, no invented legal link" };
  try {
    await login(author, fixture.users.authorMethodist);
    await author.goto("/lms");
    const m = measureLmsActions(author, "J10-source-course", "METHODIST", "Programme catalogue", ["Isolated account", "New programme dedicated to regulatory acceptance"]);
    await click(m, author.getByRole("button", { name: "Создать программу", exact: true }), "Создать отдельную программу");
    await expect(author).toHaveURL(/\/lms\/courses\//);
    const courseId = new URL(author.url()).pathname.split("/").at(-1)!;
    await fill(m, author, "Название RU", title);
    await fill(m, author, "Название KZ", `Синтетикалық НҚА ${token}`);
    await tab(m, author, "Содержание");
    const modules = author.getByRole("group", { name: "Модули и уроки", exact: true });
    await click(m, modules.getByRole("button", { name: "Добавить модуль", exact: true }), "Модуль");
    await fill(m, modules, "Модуль RU", "Синтетическое основание"); await fill(m, modules, "Модуль KZ", "Синтетикалық негіз");
    await click(m, modules.getByRole("button", { name: "Добавить урок", exact: true }), "Урок");
    const lesson = modules.getByRole("group", { name: "Урок 1", exact: true });
    for (const [label, value] of [["Урок RU", "Правило"], ["Урок KZ", "Ереже"], ["Текст RU", "Синтетическое правило для проверки версий."], ["Текст KZ", "Нұсқаларды тексеруге арналған синтетикалық ереже."]]) await fill(m, lesson, label, value);
    await tab(m, author, "Итоговая проверка");
    const exam = author.getByRole("group", { name: "Вопросы и оценка", exact: true });
    await click(m, exam.getByRole("button", { name: "Добавить вопрос", exact: true }), "Вопрос");
    const question = exam.locator(":scope > .lms-assessment-author > details").last();
    await click(m, question.locator(":scope > summary"), "Раскрыть вопрос");
    await fill(m, question, "Вопрос RU", "Синтетический контроль"); await fill(m, question, "Вопрос KZ", "Синтетикалық бақылау");
    for (let n = 1; n <= 2; n++) {
      const option = question.getByRole("group", { name: `Вариант ${n}`, exact: true });
      await fill(m, option, "RU", `Ответ ${n}`); await fill(m, option, "KZ", `Жауап ${n}`);
    }
    await m.action("click", "Верный ответ", () => question.getByRole("group", { name: "Вариант 1", exact: true }).getByLabel("Правильный ответ").check());
    await saved(author);
    report.methodistCreation = m.finish({ courseId, selfBinding: true });

    await login(admin, fixture.users.authorAdmin);
    await admin.goto(`/lms/courses/${courseId}`);
    const a = measureLmsActions(admin, "J10-regulatory-lifecycle", "ADMIN", "Draft owned by a methodist", ["Full programme content prepared through UI"]);
    await expand(a, admin, "Основание и оформление");
    for (const [label, value] of [["Название основания", `Синтетическая норма ${token}`], ["Основание проверки", "Инженерная приёмка; не нормативный акт"], ["Уполномоченный экзаменатор", "Синтетический центр"], ["Эмитент документа", "Синтетический центр А"]]) await fill(a, admin, label, value);
    await select(a, admin, "Проверка основания", "CONFIRMED");
    await admin.getByLabel("Синтетическая учебная программа", { exact: true }).check();
    await click(a, admin.getByRole("button", { name: "Добавить источник", exact: true }), "Источник НПА");
    const source = admin.getByRole("group", { name: "Источник 1", exact: true });
    for (const [label, value] of [["Название", `Синтетический источник ${token}`], ["Редакция", "1"], ["Номер НПА", "SYNTHETIC-J10"], ["Орган", "Инженерная приёмка"], ["Статья", "1"], ["Пункт", "2"], ["Подпункт", "3"], ["Дата НПА", "2026-10-19"], ["Дата актуальности", "2026-10-19"]]) await fill(a, source, label, value);
    await select(a, source, "Состояние источника", "CURRENT");
    await saved(admin);
    const readback = () => admin.request.get(`/api/lms/courses/${courseId}`).then(body<Readback>);
    async function publish() {
      await tab(a, admin, "Публикация");
      const response = admin.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/publish"));
      await click(a, admin.getByRole("button", { name: "Опубликовать", exact: true }), "Опубликовать нормативную редакцию");
      await body(await response);
    }
    await publish();
    const v1 = (await readback()).versions[0];
    expect(v1.status).toBe("PUBLISHED"); expect(v1.profile.sources[0].revision).toBe("1");
    const oldHash = snapshot(v1);
    async function review(state: string, note: string) {
      await tab(a, admin, "Публикация");
      const panel = await expand(a, admin, "Актуальность и новые назначения");
      await select(a, panel, "Текущая проверка основания", state);
      await a.action("field", "Примечание к проверке", () => panel.getByLabel("Примечание к проверке").fill(note));
      const response = admin.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/regulatory-review"));
      await click(a, panel.getByRole("button", { name: "Сохранить проверку", exact: true }), "Актуализировать статус основания");
      await body(await response);
      await expect(panel.getByRole("button", { name: "Сохранить проверку", exact: true })).toBeDisabled();
    }
    await review("CHANGED", "Синтетическая редакция 2 требует актуализации");
    const titleRu = `Требуется актуализация учебной программы: ${title}`;
    await author.goto("/lms/notifications");
    await expect(author.getByText(titleRu, { exact: true })).toBeVisible({ timeout: 60_000 });
    const inbox = await author.request.get("/api/lms/notifications?pageSize=100").then(body<Inbox>);
    const notices = inbox.items.filter((item) => item.titleRu === titleRu);
    expect(notices).toHaveLength(1);
    expect(notices[0].href).toContain(courseId);
    await author.getByRole("button", { name: "KZ", exact: true }).click();
    await expect(author.getByText(notices[0].titleKz, { exact: true })).toBeVisible();
    await author.screenshot({ path: path.join(output, "regulatory-notification-KZ.png"), fullPage: true });
    await author.getByRole("button", { name: "RU", exact: true }).click();
    await click(m, author.locator("li").filter({ has: author.getByText(titleRu, { exact: true }) }).getByRole("link", { name: "Открыть", exact: true }), "Открыть адресное уведомление");
    await expect(author).toHaveURL(new RegExp(courseId));
    await expect.poll(async () => (await author.request.get("/api/lms/notifications?pageSize=100").then(body<Inbox>)).items.find((item) => item.id === notices[0].id)?.readAt).toBeTruthy();
    const adminInbox = await admin.request.get("/api/lms/notifications?pageSize=100").then(body<Inbox>);
    expect(adminInbox.items.filter((item) => item.titleRu === titleRu)).toHaveLength(1);
    await click(a, admin.getByRole("button", { name: "Создать новую версию", exact: true }), "Новая версия НПА и курса");
    await tab(a, admin, "Сведения");
    await expand(a, admin, "Основание и оформление");
    await select(a, admin, "Проверка основания", "CONFIRMED");
    await fill(a, source, "Редакция", "2");
    await fill(a, source, "Дата актуальности", "2026-10-20");
    await saved(admin);
    await source.screenshot({ path: path.join(output, "regulatory-source-revision-2.png") });
    await publish();
    const versions = (await readback()).versions;
    expect(versions).toHaveLength(2);
    expect(versions[0].profile.sources[0].revision).toBe("2");
    expect(versions[0].regulatoryProfileVersionId).not.toBe(v1.regulatoryProfileVersionId);
    expect(snapshot(versions.find((version) => version.id === v1.id)!)).toBe(oldHash);
    await review("CURRENT", "Синтетическая редакция 2 опубликована");
    await author.goto("/lms/notifications");
    await expect(author.getByText(titleRu, { exact: true })).toHaveCount(0);
    expect((await author.request.get("/api/lms/notifications?pageSize=100").then(body<Inbox>)).items.filter((item) => item.titleRu === titleRu)).toHaveLength(0);
    await admin.goto("/lms/regulatory");
    await expect(admin.getByRole("heading", { name: "Нормативная база", exact: true })).toBeVisible();
    await admin.getByLabel("Найти НПА или программу", { exact: true }).fill(token);
    const entries = admin.locator("[data-course-version]");
    await expect(entries).toHaveCount(2);
    const previous = admin.locator(`[data-course-version="${v1.id}"]`);
    await expect(previous).toContainText("редакция 1");
    await previous.locator("summary").click();
    await expect(previous).toContainText("2026-10-19");
    await expect(previous.locator("input,textarea,button")).toHaveCount(0);
    await expect(admin.locator(`[data-course-version="${versions[0].id}"]`)).toContainText("редакция 2");
    await admin.getByLabel("Версии программ").selectOption("DRAFT");
    await expect(entries).toHaveCount(0);
    await admin.getByLabel("Версии программ").selectOption("PUBLISHED");
    await expect(entries).toHaveCount(2);
    for (const language of ["RU", "KZ"]) {
      await admin.getByRole("button", { name: language, exact: true }).click();
      for (const width of [390, 1440]) {
        await admin.setViewportSize({ width, height: 1000 });
        expect(await admin.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await admin.screenshot({ path: path.join(output, `regulatory-catalogue-${language}-${width}.png`), fullPage: true });
      }
    }
    await author.goto("/lms/regulatory");
    await expect(author.getByRole("heading", { name: "Нормативная база", exact: true })).toBeVisible();
    await author.getByLabel("Найти НПА или программу", { exact: true }).fill(token);
    await expect(author.locator("[data-course-version]")).toHaveCount(2);
    expect((await admin.request.get("/api/audit")).status()).toBe(403);
    await login(auditor, fixture.users.superAdmin);
    await auditor.goto("/settings?tab=audit");
    await expect(auditor.getByRole("heading", { name: "Журнал аудита", exact: true })).toBeVisible();
    const auditRow = auditor.getByRole("row").filter({ hasText: "LMS_REGULATORY_REVIEWED" }).filter({ hasText: courseId }).first();
    await expect(auditRow).toBeVisible();
    await auditRow.getByText("Подробности", { exact: true }).click();
    await expect(auditRow).toContainText("CHANGED"); await expect(auditRow).toContainText("CURRENT");
    await expect(auditRow.locator("input,textarea,button")).toHaveCount(0);
    await auditor.screenshot({ path: path.join(output, "regulatory-audit.png"), fullPage: true });
    expect((await author.request.get("/api/audit")).status()).toBe(403);
    report.status = "PASS";
    report.admin = a.finish({ sourceVersions: ["1", "2"], courseId, profileIds: [v1.regulatoryProfileVersionId, versions[0].regulatoryProfileVersionId], oldPublishedSnapshotUnchanged: true });
    report.notification = { methodistCount: 1, adminCount: 1, bothLanguages: true, openedAndRead: true, unchangedReviewSaveDisabled: true, clearedWhenCurrent: true };
    report.catalogue = { route: "/lms/regulatory", versions: 2, search: true, publishedFilter: true, oldSourceReadonly: true, responsiveRuKz: [390, 1440] };
    report.audit = { superAdministratorVisible: true, beforeAfterVisible: true, noEditControls: true, administratorHttpStatus: 403, methodistHttpStatus: 403 };
    report.boundary = "Real UI mutations and read-only API checks. This separate course has no learner results or issued documents; immutable result/document version linkage is checked in the coordinator's main chain and integration suites.";
  } catch (error) {
    report.status = "FAIL"; report.failure = error instanceof Error ? error.message : String(error);
    await author.screenshot({ path: path.join(output, "regulatory-author-failure.png"), fullPage: true }).catch(() => {});
    await admin.screenshot({ path: path.join(output, "regulatory-admin-failure.png"), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    report.completedAt = new Date().toISOString();
    await writeFile(path.join(output, "REGULATORY_UI.json"), JSON.stringify(report, null, 2));
    await Promise.race([Promise.all([authorContext.close(), adminContext.close(), auditContext.close()]), new Promise((resolve) => setTimeout(resolve, 5000))]);
  }
});

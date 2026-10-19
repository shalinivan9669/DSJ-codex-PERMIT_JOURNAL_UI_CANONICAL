import { test, expect, type Page, type APIResponse } from "@playwright/test";
import { readFileSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { CourseContent, RegulatoryProfile } from "../../../packages/contracts/src/lms";
type User = { email: string; password: string };
type Version = { id: string; status: string; content: CourseContent; profile: RegulatoryProfile };
async function body<T>(response: Pick<APIResponse, "ok" | "text" | "json">): Promise<T> { expect(response.ok(), await response.text()).toBe(true); return response.json() as Promise<T>; }
async function login(page: Page, user: User) {
  await page.goto("/login");
  await page.getByLabel("Электронная почта").fill(user.email); await page.getByLabel("Пароль", { exact: true }).fill(user.password);
  let pending = page.waitForResponse(r => r.url().endsWith("/auth/login") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  let response = await pending;
  if (response.status() === 429) { await page.waitForTimeout(30_000); await page.waitForTimeout(31_000); pending = page.waitForResponse(r => r.url().endsWith("/auth/login") && r.request().method() === "POST"); await page.getByRole("button", { name: "Войти", exact: true }).click(); response = await pending; }
  expect(response.ok()).toBe(true); await expect(page).not.toHaveURL(/\/login/);
  await page.getByRole("button", { name: "RU", exact: true }).click();
}
async function section(page: Page, name: string) { await page.getByRole("navigation", { name: "Разделы программы" }).getByRole("button", { name, exact: true }).click(); }
async function decision(page: Page, name: string) { const response = page.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith("/review")); await page.getByRole("button", { name, exact: true }).click(); await body(await response); }
test("J02 missing effective date is corrected by author, approved and published as V2 without altering V1", async ({ browser }) => {
  test.setTimeout(180_000);
  const fixture = JSON.parse(readFileSync(process.env.DEMO_MVP_FIXTURE!, "utf8")) as { users: { authorMethodist: User; authorAdmin: User } };
  const resultPath = path.join(path.dirname(process.env.DEMO_MVP_FIXTURE!), "authoring-result.json");
  const initialText = readFileSync(resultPath, "utf8");
  const initial = JSON.parse(initialText) as { courseId: string; courseVersionId: string };
  const output = process.env.DEMO_E2E_EVIDENCE!; await mkdir(output, { recursive: true });
  const mc = await browser.newContext({ baseURL: process.env.DEMO_ORIGIN }), ac = await browser.newContext({ baseURL: process.env.DEMO_ORIGIN });
  const author = await mc.newPage(), admin = await ac.newPage();
  const report: Record<string, unknown> = { startedAt: new Date().toISOString(), courseId: initial.courseId, previousVersionId: initial.courseVersionId, mutationTransport: "Real user interface only" };
  try {
    await login(author, fixture.users.authorMethodist);
    await author.goto(`/lms/courses/${initial.courseId}`);
    const readback = () => author.request.get(`/api/lms/courses/${initial.courseId}`).then(body<{ versions: Version[] }>);
    const before = (await readback()).versions;
    const original = before.find(v => v.id === initial.courseVersionId)!;
    expect(before[0].status).toBe("DRAFT"); expect([null, "2026-10-01"]).toContain(before[0].profile.effectiveFrom);
    const panel = author.locator("details").filter({ has: author.locator(":scope > summary", { hasText: "Основание и оформление" }) }).first();
    await panel.locator(":scope > summary").click();
    await author.getByLabel("Действует с", { exact: true }).fill("");
    await expect(author.locator("#effective-from-required")).toBeVisible();
    await author.getByLabel("Действует с", { exact: true }).fill("2026-10-01");
    await expect(author.locator("#effective-from-required")).toHaveCount(0);
    await author.getByLabel("Проверка основания").selectOption("CONFIRMED");
    await expect(author.locator(".lms-save-state")).toHaveText("Сохранено");
    await section(author, "Публикация"); await decision(author, "Отправить на проверку");
    await login(admin, fixture.users.authorAdmin); await admin.goto(`/lms/courses/${initial.courseId}`);
    await section(admin, "Публикация"); await decision(admin, "Одобрить редакцию");
    const publishing = admin.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith("/publish"));
    await admin.getByRole("button", { name: "Опубликовать", exact: true }).click(); await body(await publishing);
    const after = (await readback()).versions; const published = after[0];
    expect(published.status).toBe("PUBLISHED"); expect(published.profile.effectiveFrom).toBe("2026-10-01");
    expect(after.find(v => v.id === original.id)).toEqual(original);
    await writeFile(path.join(path.dirname(resultPath), "authoring-result-v1.json"), initialText, { flag: "wx" });
    await writeFile(resultPath, JSON.stringify({ courseId: initial.courseId, courseVersionId: published.id, content: published.content, profile: published.profile }, null, 2));
    await admin.screenshot({ path: path.join(output, "effective-date-v2-published.png"), fullPage: true });
    report.status = "PASS"; report.versionId = published.id; report.oldPublishedSnapshotUnchanged = true; report.effectiveFrom = published.profile.effectiveFrom;
  } catch (error) { report.status = "FAIL"; report.error = error instanceof Error ? error.message : String(error); await author.screenshot({ path: path.join(output, "effective-date-failure.png"), fullPage: true }).catch(() => {}); throw error; }
  finally { await writeFile(path.join(output, "EFFECTIVE_DATE_CORRECTION.json"), JSON.stringify(report, null, 2)); await Promise.race([Promise.all([mc.close(), ac.close()]), new Promise(resolve => setTimeout(resolve, 5000))]); }
});

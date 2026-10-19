import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

test("J12 read-only published editor and normative catalogue RU/KZ at all four widths with keyboard focus", async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = JSON.parse(readFileSync(process.env.DEMO_MVP_FIXTURE!, "utf8")) as { users: { authorAdmin: { email: string; password: string } } };
  const output = process.env.DEMO_E2E_EVIDENCE!; await mkdir(output, { recursive: true });
  await page.goto("/login");
  await page.getByLabel("Электронная почта").fill(fixture.users.authorAdmin.email);
  await page.getByLabel("Пароль", { exact: true }).fill(fixture.users.authorAdmin.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  const mutations: string[] = [];
  page.on("request", request => { if (/\/api\/lms\//.test(request.url()) && !["GET", "HEAD"].includes(request.method())) mutations.push(`${request.method()} ${new URL(request.url()).pathname}`); });
  const samples = [];
  for (const [name, route] of [["published-editor", "/lms/courses/475a31b8-0b1a-42f2-815b-0f44ca10c36f"], ["regulatory-catalogue", "/lms/regulatory"]]) {
    await page.goto(route);
    await expect(page.locator(".lms-workspace")).toBeVisible();
    for (const language of ["RU", "KZ"]) {
      await page.getByRole("button", { name: language, exact: true }).click();
      for (const width of [360, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.keyboard.press("Tab");
        const focus = await page.evaluate(() => {
          const element = document.activeElement as HTMLElement | null;
          if (!element) return { visible: false, indicator: false, tag: "none" };
          const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
          return { visible: rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.left >= 0 && rect.right <= innerWidth, indicator: (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== "none", tag: element.tagName };
        });
        expect(focus.visible).toBe(true); expect(focus.indicator).toBe(true);
        const screenshot = `${name}-${language}-${width}.png`;
        await page.screenshot({ path: path.join(output, screenshot), fullPage: true });
        samples.push({ route, language, width, overflow: false, keyboardFocus: focus, screenshot });
      }
    }
  }
  expect(mutations).toEqual([]);
  await writeFile(path.join(output, "AUTHORING_RESPONSIVE.json"), JSON.stringify({ status: "PASS", readOnly: true, mutations, samples }, null, 2));
});

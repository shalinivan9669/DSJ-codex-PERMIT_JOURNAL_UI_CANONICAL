import { expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

/** Synthetic local session only. Cookies live under ignored runtime, never evidence. */
export async function loginIsolated(page: Page) {
  if (
    process.env.DEMO_E2E_ISOLATED_TENANT !== "1" ||
    !process.env.DEMO_E2E_EMAIL ||
    !process.env.DEMO_E2E_PASSWORD
  )
    throw new Error("ISOLATED_TEST_LOGIN_REQUIRED");
  const cache = path.resolve(
    __dirname,
    "../../../.runtime/operator-flow-full-fix/operator-session.private.json",
  );
  try {
    const stored = JSON.parse(await fs.readFile(cache, "utf8"));
    if (
      stored.email === process.env.DEMO_E2E_EMAIL &&
      stored.origin === (process.env.DEMO_ORIGIN || "http://localhost:3100") &&
      stored.cookies?.some(
        (cookie: { name: string; expires: number }) =>
          cookie.name === "demo_session" &&
          cookie.expires * 1000 - Date.now() >= 2 * 3600_000,
      )
    )
      await page.context().addCookies(stored.cookies);
  } catch {
    /* A first local session is established through the actual login. */
  }
  await page.goto("/requests");
  const requestsHeading = page.getByRole("heading", {
    name: "Заявки на печать",
    exact: true,
  });
  const loginHeading = page.getByRole("heading", {
    name: "Войти в DEMO",
    exact: true,
  });
  await expect(requestsHeading.or(loginHeading)).toBeVisible();
  if (await loginHeading.isVisible()) {
    await page
      .getByLabel("Электронная почта", { exact: true })
      .fill(process.env.DEMO_E2E_EMAIL);
    await page
      .getByLabel("Пароль", { exact: true })
      .fill(process.env.DEMO_E2E_PASSWORD);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    try {
      await expect(requestsHeading).toBeVisible();
    } catch (error) {
      await page.getByLabel("Пароль", { exact: true }).fill("");
      throw error;
    }
  }
  await expect(
    page.getByRole("heading", { name: "Заявки на печать", exact: true }),
  ).toBeVisible();
  const response = await page.request.get("/api/auth/session"),
    session = await response.json();
  expect(session.tenant.demoOnly).toBe(true);
  const origin = new URL(page.url()).origin;
  const privateState = {
    email: process.env.DEMO_E2E_EMAIL,
    origin,
    cookies: await page.context().cookies(),
  };
  await fs.mkdir(path.dirname(cache), { recursive: true });
  const temporary = cache + `.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(privateState));
  await fs.rename(temporary, cache);
  return { origin, "x-csrf-token": session.csrfToken };
}

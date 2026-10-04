import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { loginIsolated } from "./operator-full-fix-session";
import { loginRole } from "./operator-role-fixture";
test.use({ trace: "off" });

test("delivered local account opens final build and authenticated readiness without business mutations", async ({
  page,
  context,
  browser,
}) => {
  const email = process.env.DEMO_E2E_EMAIL;
  const password = process.env.DEMO_E2E_PASSWORD;
  expect(email).toMatch(/@example\.test$/);
  expect(password).toBeTruthy();
  const evidence = path.resolve(
    process.env.DEMO_E2E_EVIDENCE ||
      "../../docs/evidence/final-completion/local-ready",
  );
  await fs.mkdir(evidence, { recursive: true });
  const pageErrors: string[] = [];
  const serverErrors: string[] = [];
  const businessWrites: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500)
      serverErrors.push(new URL(response.url()).pathname);
  });
  page.on("request", (request) => {
    const route = new URL(request.url()).pathname;
    if (
      route.startsWith("/api/") &&
      !["GET", "HEAD"].includes(request.method()) &&
      !route.startsWith("/api/auth/")
    )
      businessWrites.push(route);
  });
  const response = await page.goto("/login");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["x-powered-by"]).toBeUndefined();
  await loginIsolated(page);
  await expect(
    page.getByRole("heading", { name: "Заявки на печать" }),
  ).toBeVisible();
  const appResponse = await context.request.get("/api/context");
  expect(appResponse.ok()).toBe(true);
  const app = await appResponse.json();
  expect(app.tenant.demoOnly).toBe(true);
  expect(app.user.email).toBe(email);
  const operatorReady = await context.request.get("/api/ready");
  expect(operatorReady.status()).toBe(403);
  expect((await operatorReady.json()).code).toBe("ROLE_DENIED");
  const managementContext = await browser.newContext();
  const managementPage = await managementContext.newPage();
  const management = await loginRole(managementPage, "ADMIN");
  expect(management.session.tenant.id).toBe(app.tenant.id);
  const readyResponse = await managementPage.request.get("/api/ready");
  expect(readyResponse.status()).toBe(200);
  const ready = await readyResponse.json();
  await managementContext.close();
  expect(ready.status).toBe("ready");
  expect(ready.storage).toBe("ok");
  await page.goto("/workbench");
  await expect(
    page.getByRole("heading", { name: "Работа центра", exact: true }),
  ).toBeVisible();
  await page.goto("/requests");
  await expect(
    page.getByRole("heading", { name: "Заявки на печать" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Заявки на печать" }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.screenshot({
    path: path.join(evidence, "delivered-account-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => ({
        width: window.innerWidth,
        content: document.documentElement.scrollWidth,
      })),
    )
    .toEqual({ width: 390, content: 390 });
  await page.screenshot({
    path: path.join(evidence, "delivered-account-mobile.png"),
    fullPage: true,
  });
  expect(pageErrors).toEqual([]);
  expect(serverErrors).toEqual([]);
  expect(businessWrites).toEqual([]);
  await fs.writeFile(
    path.join(evidence, "result.json"),
    JSON.stringify(
      {
        status: "PASS",
        executedAt: new Date().toISOString(),
        browser: browser.version(),
        origin: process.env.DEMO_ORIGIN,
        userId: app.user.id,
        tenantId: app.tenant.id,
        accountChanged: false,
        synthetic: true,
        businessWrites,
        pageErrors,
        serverErrors,
        readiness: ready,
        readinessRole: management.session.user.role,
        operatorReadinessDenied: true,
        viewports: [1366, 390],
      },
      null,
      2,
    ),
  );
});

import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const product = path.resolve(__dirname, "../../..");
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    path.join(product, "docs/evidence/final-completion/portal-390"),
);
async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Электронная почта", { exact: true }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
}
async function get(page: Page, endpoint: string) {
  const response = await page.request.get(`/api${endpoint}`);
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
test.use({ trace: "off" });
test("existing V07 three-person portal at390x844 retains private scopes, friendly immutable labels and visible keyboard focus", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(120000);
  await fs.mkdir(evidence, { recursive: true });
  const source = JSON.parse(
    await fs.readFile(
      path.join(
        product,
        "docs/evidence/final-completion/portal-three-complete/summary.json",
      ),
      "utf8",
    ),
  );
  const admin = JSON.parse(
    await fs.readFile(
      path.join(product, ".runtime/invites-ui-auth.json"),
      "utf8",
    ),
  );
  await login(page, admin.email, admin.password);
  await expect(
    page.getByRole("heading", { name: "Заявки на печать" }),
  ).toBeVisible();
  const issued = await get(page, `/print-requests/${source.requestId}`);
  const existingOrder = await get(page, `/orders/${source.orderId}`);
  const companyId = existingOrder.employerId || existingOrder.customerId;
  const own = issued.items.filter(
    (p: { employerId: string }) => p.employerId === companyId,
  );
  const foreign = issued.items.filter(
    (p: { employerId: string }) => p.employerId !== companyId,
  );
  expect(own).toHaveLength(3);
  expect(foreign).toHaveLength(2);
  const before = {
    snapshot: issued.issuances[0].snapshot,
    numbers: issued.documents.map((d: { number: string }) => d.number),
  };
  const email = `portal-390-${randomUUID()}@example.test`,
    password = `Synthetic-${randomUUID()}!`;
  const csrf = (await context.cookies()).find(
    (c) => c.name === "demo_csrf",
  )!.value;
  const post = async (endpoint: string, data: unknown) => {
    const response = await page.request.post(`/api${endpoint}`, {
      headers: { origin: process.env.DEMO_ORIGIN!, "x-csrf-token": csrf },
      data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const principal = await post("/users", {
    email,
    password,
    displayName: "Синтетическая проверка кабинета390",
    role: "EMPLOYER",
  });
  const membership = await post("/employer-memberships", {
    userId: principal.id,
    customerId: companyId,
    recipientIds: own.map((p: { recipientId: string }) => p.recipientId),
    permissions: ["READ", "DOWNLOAD"],
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  await fs.writeFile(
    path.join(product, ".runtime/final-portal-390-auth.json"),
    JSON.stringify({
      email,
      password,
      customerId: companyId,
      membershipId: membership.id,
      recipientIds: own.map((p: { recipientId: string }) => p.recipientId),
    }),
  );
  const portalContext = await browser.newContext({
    baseURL: process.env.DEMO_ORIGIN,
    viewport: { width: 390, height: 844 },
  });
  try {
    const portal = await portalContext.newPage();
    const mutations: string[] = [];
    await login(portal, email, password);
    await expect(
      portal.getByRole("heading", { name: "Кабинет заказчика" }),
    ).toBeVisible();
    portal.on("request", (r) => {
      if (
        r.url().includes("/api/") &&
        !["GET", "HEAD", "OPTIONS"].includes(r.method())
      )
        mutations.push(`${r.method()} ${new URL(r.url()).pathname}`);
    });
    const projection = await get(portal, "/portal");
    const visibleOrder = projection.orders.find(
      (o: { id: string }) => o.id === source.orderId,
    );
    expect(visibleOrder).toBeTruthy();
    const request = visibleOrder.requests.find(
      (r: { id: string }) => r.id === source.requestId,
    );
    expect(request.rows).toHaveLength(3);
    expect(request.rows.map((p: { id: string }) => p.id).sort()).toEqual(
      own.map((p: { id: string }) => p.id).sort(),
    );
    for (const p of foreign)
      expect(JSON.stringify(projection)).not.toContain(p.fullNameRu);
    const docx = visibleOrder.artifacts.filter(
      (a: { format: string }) => a.format === "DOCX",
    );
    expect(docx).toHaveLength(3);
    const frozenNames = own.map((p: { fullNameRu: string }) => p.fullNameRu);
    for (const file of docx) {
      expect(file.label).toContain("№");
      expect(
        frozenNames.some((name: string) => file.label.includes(name)),
      ).toBe(true);
      await expect(
        portal.locator(`a[href="/api/portal/artifacts/${file.id}"]`),
      ).toHaveText(file.label);
    }
    await portal
      .getByRole("button", {
        name: `${request.title} · редакция ${request.revision}`,
        exact: true,
      })
      .click();
    for (const [index, p] of own.entries()) {
      await expect(
        portal.getByRole("textbox", {
          name: `ФИО RU, получатель ${index + 1}`,
          exact: true,
        }),
      ).toHaveValue(p.fullNameRu);
    }
    const beforeReload = await portal.evaluate(() => ({
      viewport: innerWidth,
      root: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    expect(beforeReload.viewport).toBe(390);
    expect(beforeReload.root).toBeLessThanOrEqual(390);
    expect(beforeReload.body).toBeLessThanOrEqual(390);
    await portal.screenshot({
      path: path.join(evidence, "three-own-people-files-390.png"),
      fullPage: true,
    });
    await portal.reload();
    await expect(
      portal.getByRole("heading", { name: "Кабинет заказчика" }),
    ).toBeVisible();
    await expect(
      portal.locator(`a[href="/api/portal/artifacts/${docx[0].id}"]`),
    ).toHaveText(docx[0].label);
    await portal.keyboard.press("Tab");
    const focus = await portal.evaluate(() => {
      const element = document.activeElement as HTMLElement;
      const style = getComputedStyle(element),
        rect = element.getBoundingClientRect();
      return {
        tag: element.tagName,
        text: element.textContent?.trim(),
        focusVisible: element.matches(":focus-visible"),
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        outlineColor: style.outlineColor,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        viewport: innerWidth,
        root: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
      };
    });
    expect(focus.focusVisible).toBe(true);
    expect(focus.outlineStyle).not.toBe("none");
    expect(parseFloat(focus.outlineWidth)).toBeGreaterThanOrEqual(2);
    expect(focus.root).toBeLessThanOrEqual(390);
    expect(focus.body).toBeLessThanOrEqual(390);
    await portal.screenshot({
      path: path.join(evidence, "visible-tab-focus-390.png"),
      fullPage: true,
    });
    expect(mutations).toEqual([]);
    const after = await get(page, `/print-requests/${source.requestId}`);
    expect(after.issuances[0].snapshot).toEqual(before.snapshot);
    expect(after.documents.map((d: { number: string }) => d.number)).toEqual(
      before.numbers,
    );
    await fs.writeFile(
      path.join(evidence, "summary.json"),
      JSON.stringify(
        {
          status: "PASS",
          criterion: "AT158",
          layer: "REAL_EDGE_390X844_PORTAL_READONLY",
          sourceRequestId: source.requestId,
          sourceOrderId: source.orderId,
          ownPeople: 3,
          foreignPeopleExcluded: 2,
          originalDocxFriendlyLabels: docx.map(
            (a: { id: string; label: string }) => ({
              id: a.id,
              label: a.label,
            }),
          ),
          viewport: { width: 390, height: 844 },
          beforeReload,
          focus,
          browser: browser.version(),
          businessMutationsDuringPortalJourney: mutations,
          originalSnapshotAndNumbersUnchanged: true,
          setup:
            "Explicitly authorized new synthetic read/download EMPLOYER account for existing three IDs; credentials in ignored runtime. No password reset, new request, issuance or render.",
          limitation:
            "This is the exact390x844 portal portion of AT158. Complete keyboard workflow at desktop belongs to the operator evidence.",
        },
        null,
        2,
      ),
    );
  } finally {
    await portalContext.close();
  }
});

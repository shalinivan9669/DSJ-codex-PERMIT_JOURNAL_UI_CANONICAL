import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { newRecipient, type Draft } from "../lib/types";
import { loginIsolated } from "./operator-full-fix-session";

test.use({ trace: "off" });

test("real API: delayed acknowledgement, rapid edits, offline Back and retry persist latest bilingual input", async ({
  page,
}) => {
  test.setTimeout(120000);
  if (
    !process.env.DEMO_E2E_EMAIL ||
    !process.env.DEMO_E2E_PASSWORD ||
    process.env.DEMO_E2E_ISOLATED_TENANT !== "1"
  )
    throw new Error("Explicit isolated synthetic tenant credentials required");
  const evidence = path.resolve(
    process.env.DEMO_E2E_EVIDENCE ||
      "../../.runtime/operator-complete-20260929/save-live",
  );
  await fs.mkdir(evidence, { recursive: true });
  await page.routeWebSocket(/\/_next\/webpack-hmr/, (socket) => socket.close());
  await loginIsolated(page);
  await expect(
    page.getByRole("heading", { name: "Заявки на печать", exact: true }),
  ).toBeVisible();
  const session = await (await page.request.get("/api/auth/session")).json();
  const title = `Синтетическая надёжность сохранения ${Date.now()}`;
  const created = await page.request.post("/api/print-requests", {
    headers: {
      origin: new URL(page.url()).origin,
      "x-csrf-token": session.csrfToken,
    },
    data: {
      kind: "PERSON",
      title,
      customerId: null,
      demoMode: true,
      schemaVersion: 2,
      commonFields: { documentDate: "2026-09-29" },
      items: [
        {
          ...newRecipient(),
          fullNameRu: "Исходный Синтетический Получатель",
          fullNameKz: "Бастапқы Синтетикалық Тыңдаушы",
        },
      ],
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const original = (await created.json()) as Draft;
  await page.reload();
  expect(original.title).toBe(title);
  await page
    .getByLabel("Поиск по заявкам", { exact: true })
    .fill(original.title);
  const link = page
    .getByRole("link", { name: original.title, exact: true })
    .and(page.locator(`a[href="/requests/${original.id}"]`));
  await expect(link).toHaveCount(1);
  await expect(link).toHaveAccessibleName(original.title);
  await link.click();
  const input = page.getByLabel("ФИО", { exact: true });
  await expect(input).toBeVisible();
  const endpoint = `**/api/print-requests/${original.id}`;
  const savedRevisions: number[] = [];
  let release!: () => void;
  const delay = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  await page.route(endpoint, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    calls += 1;
    const response = await route.fetch();
    expect(response.ok(), await response.text()).toBe(true);
    savedRevisions.push((await response.json()).revision);
    if (calls === 1) await delay;
    await route.fulfill({ response });
  });
  await input.fill("Первая Медленная Редакция");
  await expect.poll(() => savedRevisions.length).toBe(1);
  const finalName = "Ахметова Әлия Сергеевна · сохранённый ввод";
  await input.fill(finalName);
  await page
    .locator(".person-editor details.person-additional")
    .filter({ has: page.getByText(/^Дополнительные персональные данные/) })
    .locator(":scope > summary")
    .click();
  const kzName = "Ахметова Әлия Серікқызы Ә Ғ Қ Ң Ө Ұ Ү Һ І";
  await page
    .locator('.person-editor [data-field-path="items.0.fullNameKz"]')
    .fill(kzName);
  await page.waitForTimeout(850);
  expect(calls).toBe(1);
  release();
  await expect(page.locator(".save-indicator")).toContainText(
    "Рабочая версия сохранена",
  );
  expect(calls).toBe(2);
  await page.unroute(endpoint);
  const afterDelayed = (await (
    await page.request.get(`/api/print-requests/${original.id}`)
  ).json()) as Draft;
  expect(afterDelayed.items[0].fullNameRu).toBe(finalName);
  expect(afterDelayed.items[0].fullNameKz).toBe(kzName);
  await page.route(endpoint, (route) =>
    route.request().method() === "PATCH"
      ? route.abort("failed")
      : route.continue(),
  );
  const finalPosition = "Ведущий инженер синтетической группы";
  await page.getByLabel("Должность", { exact: true }).fill(finalPosition);
  await page.evaluate(() => history.back());
  await expect(page.locator(".save-indicator")).toContainText("Не сохранено");
  await expect(page.getByLabel("Должность", { exact: true })).toHaveValue(
    finalPosition,
  );
  await page.screenshot({
    path: path.join(evidence, "offline-back-retains-input.png"),
    fullPage: true,
  });
  await page.unroute(endpoint);
  await page.evaluate(() => history.back());
  await expect(
    page.getByRole("heading", { name: "Заявки на печать", exact: true }),
  ).toBeVisible();
  const afterBack = (await (
    await page.request.get(`/api/print-requests/${original.id}`)
  ).json()) as Draft & { documents: unknown[] };
  expect(afterBack.items[0].fullNameRu).toBe(finalName);
  expect(afterBack.items[0].fullNameKz).toBe(kzName);
  expect(afterBack.items[0].positionRu).toBe(finalPosition);
  expect(afterBack.status).toBe("DRAFT");
  expect(afterBack.documents).toHaveLength(0);
  expect(afterBack.title).toBe(title);
  await page
    .getByLabel("Поиск по заявкам", { exact: true })
    .fill(afterBack.title);
  const restoredLink = page
    .getByRole("link", { name: afterBack.title, exact: true })
    .and(page.locator(`a[href="/requests/${original.id}"]`));
  await expect(restoredLink).toHaveCount(1);
  await expect(restoredLink).toHaveAccessibleName(afterBack.title);
  await restoredLink.click();
  // A complete saved person resumes on the compact card. Open only identity.
  await page
    .getByRole("button", { name: "Изменить ФИО и должность", exact: true })
    .click();
  await expect(input).toHaveValue(finalName);
  await expect(page.getByLabel("Должность", { exact: true })).toHaveValue(
    finalPosition,
  );
  await page
    .locator(".person-editor details.person-additional")
    .filter({ has: page.getByText(/^Дополнительные персональные данные/) })
    .locator(":scope > summary")
    .click();
  await expect(
    page.locator('.person-editor [data-field-path="items.0.fullNameKz"]'),
  ).toHaveValue(kzName);
  await page.screenshot({
    path: path.join(evidence, "reopened-confirmed-save.png"),
    fullPage: true,
  });
  await fs.writeFile(
    path.join(evidence, "readback.json"),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        status: "PASS",
        synthetic: true,
        requestId: original.id,
        url: page.url(),
        revisions: [original.revision, ...savedRevisions, afterBack.revision],
        delayedAcknowledgementMs: 850,
        serializedPatchCount: calls,
        values: { ru: finalName, kz: kzName, positionRu: finalPosition },
        offlineBackRetainedInput: true,
        recoveredBackSavedBeforeLeaving: true,
        authenticatedReadback: true,
        reopenedReadback: true,
        issuedDocuments: 0,
      },
      null,
      2,
    ),
  );
});

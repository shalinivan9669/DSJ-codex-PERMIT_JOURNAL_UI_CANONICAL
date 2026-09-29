import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { newRecipient, type Draft } from "../lib/types";

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
  await page.goto("/login");
  await page
    .getByLabel("Электронная почта", { exact: true })
    .fill(process.env.DEMO_E2E_EMAIL);
  await page
    .getByLabel("Пароль", { exact: true })
    .fill(process.env.DEMO_E2E_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
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
  await page.getByLabel("Поиск по заявкам", { exact: true }).fill(title);
  await page.getByRole("link", { name: title, exact: true }).click();
  const input = page.getByLabel("ФИО RU, строка 1", { exact: true });
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
  await page.getByRole("button", { name: "RU + KZ", exact: true }).click();
  const kzName = "Ахметова Әлия Серікқызы Ә Ғ Қ Ң Ө Ұ Ү Һ І";
  await page.getByLabel("ФИО KZ, строка 1", { exact: true }).fill(kzName);
  await page.waitForTimeout(850);
  expect(calls).toBe(1);
  release();
  await expect(page.locator(".save-indicator")).toContainText("Сохранено");
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
  await page
    .getByLabel("Должность RU, строка 1", { exact: true })
    .fill(finalPosition);
  await page.evaluate(() => history.back());
  await expect(page.locator(".save-indicator")).toContainText("Не сохранено");
  await expect(
    page.getByLabel("Должность RU, строка 1", { exact: true }),
  ).toHaveValue(finalPosition);
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
  await page.getByLabel("Поиск по заявкам", { exact: true }).fill(title);
  await page.getByRole("link", { name: title, exact: true }).click();
  await expect(input).toHaveValue(finalName);
  await expect(
    page.getByLabel("Должность RU, строка 1", { exact: true }),
  ).toHaveValue(finalPosition);
  await page.getByRole("button", { name: "RU + KZ", exact: true }).click();
  await expect(
    page.getByLabel("ФИО KZ, строка 1", { exact: true }),
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

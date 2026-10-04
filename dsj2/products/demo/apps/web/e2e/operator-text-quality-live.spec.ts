import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { newRecipient, type Draft, type Recipient } from "../lib/types";
import { assignTrainingBundle } from "../lib/request-bundles";
import { loginIsolated } from "./operator-full-fix-session";
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    "../../docs/evidence/final-completion/operator/text-quality",
);
test("real editor warns about mixed alphabets and invisible symbols without rewriting Kazakh or foreign names or blocking valid issue data", async ({
  page,
}) => {
  await fs.mkdir(evidence, { recursive: true });
  const headers = await loginIsolated(page);
  const person: Recipient = {
    ...newRecipient(),
    fullNameRu: "Синтетический Получатель",
    fullNameKz: "Ә Ғ Қ Ң Ө Ұ Ү Һ І",
    positionRu: "Электрик",
    workplaceRu: "Тест предприятие",
    assignments: [],
  };
  const prepared = assignTrainingBundle<Draft>(
    {
      id: "unsaved-text-quality",
      revision: 0,
      status: "DRAFT" as const,
      kind: "PERSON" as const,
      title: `Синтетическая проверка исходного текста ${Date.now()}`,
      customerId: null,
      demoMode: true,
      schemaVersion: 2,
      commonFields: { documentDate: "2026-10-03" },
      events: [],
      items: [person],
    },
    [person.id],
    "PB",
    "INDIVIDUAL",
  );
  prepared.events![0].commonFields = {
    documentDate: "2026-10-03",
    protocolDate: "2026-10-03",
    trainingStart: "2026-10-01",
    trainingEnd: "2026-10-02",
    trainingSubject: "Синтетическая проверка текста",
    hours: "16",
  };
  for (const assignment of prepared.items[0].assignments) {
    assignment.outcome = {
      status: "PASSED",
      source: "СИНТЕТИЧЕСКАЯ ведомость проверки текста",
    };
    assignment.result = "Сдал";
  }
  const {
    id: _id,
    revision: _revision,
    status: _status,
    ...payload
  } = prepared;
  const created = await page.request.post("/api/print-requests", {
    headers,
    data: payload,
  });
  expect(created.ok(), await created.text()).toBe(true);
  const draft = await created.json();
  await page.goto(`/requests/${draft.id}/edit`);
  const input = page.getByLabel("ФИО, строка 1", { exact: true });
  await input.fill("Ивaнов Синтетический");
  await expect(
    page
      .locator(".operator-grid")
      .getByText(/Проверка источника:/)
      .first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Детали получателя 1", exact: true })
    .click();
  await page.getByRole("tab", { name: /^Личные данные/ }).click();
  const invisible = "Электрик\u200B";
  await page
    .getByLabel("Должность / профессия", { exact: true })
    .fill(invisible);
  await expect(
    page.locator(".person-fields").getByText(/Проверка источника:.*невидим/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Вернуться к списку", exact: true })
    .click();
  const response = page.waitForResponse(
    (value) =>
      value.url().endsWith(`/api/print-requests/${draft.id}/validate`) &&
      value.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Проверить данные", exact: true })
    .click();
  const validation = await (await response).json();
  expect(validation.valid).toBe(true);
  expect(validation.issues).toEqual([]);
  await page.reload();
  await expect(input).toHaveValue("Ивaнов Синтетический");
  const persisted = await (
    await page.request.get(`/api/print-requests/${draft.id}`)
  ).json();
  expect(persisted.items[0].positionRu).toBe(invisible);
  expect(persisted.items[0].fullNameKz).toBe("Ә Ғ Қ Ң Ө Ұ Ү Һ І");
  await input.fill("John Smith");
  await expect(page.locator(".save-indicator")).toContainText(
    "Рабочая версия сохранена",
  );
  await page.reload();
  await expect(input).toHaveValue("John Smith");
  await expect(
    page
      .locator('.operator-grid [data-field-path="items.0.fullNameRu"]')
      .locator("..")
      .getByText(/Проверка источника:/),
  ).toHaveCount(0);
  await expect(
    page.locator(".operator-grid").getByText(/Проверка источника:.*невидим/),
  ).toBeVisible();
  await fs.writeFile(
    path.join(evidence, "text-quality-result.json"),
    JSON.stringify(
      {
        status: "PASS",
        requestId: draft.id,
        mixedScriptWarning: true,
        invisibleWarning: true,
        kazakhPreserved: true,
        foreignNamePreserved: true,
        noAutomaticNameRewrite: true,
        nonblockingServerValidation: true,
        syntheticFixtureViaApi: true,
        actualApi: true,
        noIssuance: true,
        values: {
          fullNameKz: persisted.items[0].fullNameKz,
          positionRu: persisted.items[0].positionRu,
        },
      },
      null,
      2,
    ),
  );
});

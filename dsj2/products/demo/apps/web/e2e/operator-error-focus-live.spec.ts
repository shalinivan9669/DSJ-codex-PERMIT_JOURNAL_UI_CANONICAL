import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
import {
  keyboardActivate,
  keyboardEnter,
  keyboardMetrics,
} from "./operator-keyboard-helpers";
const evidence = process.env.DEMO_E2E_EVIDENCE!;
test("existing 100-row draft shows validation heading at keyboard focus and opens exact erroneous field", async ({
  page,
}) => {
  test.setTimeout(180000);
  await fs.mkdir(evidence, { recursive: true });
  await page.goto("/login");
  await keyboardEnter(
    page,
    page.getByLabel("Электронная почта", { exact: true }),
    process.env.DEMO_E2E_EMAIL!,
  );
  await keyboardEnter(
    page,
    page.getByLabel("Пароль", { exact: true }),
    process.env.DEMO_E2E_PASSWORD!,
  );
  await keyboardActivate(
    page,
    page.getByRole("button", { name: "Войти", exact: true }),
  );
  await expect(
    page.getByRole("heading", { name: "Заявки на печать" }),
  ).toBeVisible();
  await keyboardActivate(
    page,
    page
      .locator(".row-title")
      .filter({ hasText: "G1 · полный UI путь 100 человек" })
      .first(),
  );
  await expect(page.locator(".recipient-table tbody tr")).toHaveCount(100);
  const requestId = /requests\/([^/]+)/.exec(page.url())![1];
  const shared = page
    .locator(".common-context")
    .getByLabel("Программа / тема", { exact: true });
  const original = await shared.inputValue();
  expect(original).toBeTruthy();
  await keyboardEnter(page, shared, "");
  await keyboardActivate(
    page,
    page.getByRole("button", { name: "Сохранить", exact: true }),
  );
  await expect(page.locator(".save-indicator")).toContainText("Сохранено");
  await keyboardActivate(
    page,
    page.getByRole("button", { name: "Проверить", exact: true }),
  );
  const errors = page.locator(".validation-result");
  await expect(errors).toContainText("Исправьте данные перед оформлением");
  await expect(errors).toBeFocused();
  const heading = errors.getByText("Исправьте данные перед оформлением", {
    exact: true,
  });
  const rect = await heading.boundingBox();
  expect(rect).toBeTruthy();
  expect(rect!.y).toBeGreaterThanOrEqual(0);
  expect(rect!.y + rect!.height).toBeLessThan(650);
  expect(
    await errors.evaluate(
      (element) =>
        element.matches(":focus-visible") &&
        getComputedStyle(element).outlineStyle !== "none",
    ),
  ).toBe(true);
  await page.screenshot({
    path: path.join(evidence, "validation-heading-visible.png"),
  });
  await keyboardActivate(
    page,
    errors
      .getByRole("button", {
        name: "Укажите программу/тему обучения",
        exact: true,
      })
      .first(),
  );
  const field = page.locator(
    '[data-field-path="items.0.assignments.0.trainingSubject"]',
  );
  await expect(field).toBeVisible();
  await expect(field).toBeFocused();
  await page.screenshot({
    path: path.join(evidence, "exact-error-field-focused.png"),
  });
  await keyboardEnter(page, shared, original);
  await keyboardActivate(
    page,
    page.getByRole("button", { name: "Сохранить", exact: true }),
  );
  await expect(page.locator(".save-indicator")).toContainText("Сохранено");
  const response = await page.request.get(`/api/print-requests/${requestId}`);
  expect(response.ok()).toBe(true);
  const current = await response.json();
  expect(current.status).toBe("DRAFT");
  expect(current.documents).toHaveLength(0);
  expect(current.events[0].commonFields.trainingSubject).toBe(original);
  await fs.writeFile(
    path.join(evidence, "error-focus-result.json"),
    JSON.stringify(
      {
        status: "PASS",
        requestId,
        rows: 100,
        keyboardOnlyInApp: true,
        validationHeadingWithinViewport: rect,
        validationRegionFocused: true,
        exactErrorFieldFocused: true,
        originalSharedProgramRestored: true,
        noIssuance: true,
        keyboardMetrics,
      },
      null,
      2,
    ),
  );
});

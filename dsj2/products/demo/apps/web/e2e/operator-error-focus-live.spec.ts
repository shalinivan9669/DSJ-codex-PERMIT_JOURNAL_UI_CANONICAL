import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { draftSchema } from "@demo/contracts";
import { newAssignment, newRecipient } from "../lib/types";
import { loginIsolated } from "./operator-full-fix-session";
import { readCommon, expandCommon } from "./operator-common-history-helpers";
import { fourFormsLongDrawerFocus } from "./operator-focus-acceptance-helpers";
import {
  fullSuitePageApiCooldown,
  fullSuiteRunId,
} from "./operator-full-suite";

test.use({ trace: "off" });
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    path.join(
      __dirname,
      "../../../docs/evidence/operator-flow-full-fix-20261003/preparation/error-focus-browser",
    ),
);
test("fresh 100-row draft shows validation heading at keyboard focus and opens exact inherited cause while preserving dates and UNKNOWN", async ({
  page,
}) => {
  test.setTimeout(fullSuiteRunId() ? 360000 : 180000);
  await fs.mkdir(evidence, { recursive: true });
  await fullSuitePageApiCooldown(page, evidence, "error-focus-before-first100");
  const headers = await loginIsolated(page),
    eventId = randomUUID(),
    started = performance.now();
  const input = draftSchema.parse({
    kind: "COMPANY",
    demoMode: true,
    schemaVersion: 2,
    commonFields: { documentDate: "2026-10-03" },
    events: [
      {
        id: eventId,
        title: "Синтетическая 100 группа focus",
        protocolTemplateId: "biot-protocol",
        protocolMode: "GROUP",
        commonFields: {
          trainingSubject: "Синтетическая исходная общая программа",
          trainingStart: "2026-09-20",
          trainingEnd: "2026-09-22",
          protocolDate: "2026-09-22",
          hours: "8",
          productionHours: "16",
          biotCategory: "WORKER",
        },
      },
    ],
    items: Array.from({ length: 100 }, (_, index) => ({
      ...newRecipient(),
      id: randomUUID(),
      employeeCategory: "WORKER",
      fullNameRu: `Синтетический Фокус ${String(index + 1).padStart(3, "0")}`,
      positionRu: "Синтетический рабочий",
      workplaceRu: "Синтетическое предприятие",
      assignments: [
        {
          ...newAssignment("biot-worker-card"),
          id: randomUUID(),
          eventId,
          protocolMode: "GROUP",
          documentDate: index === 1 ? "2026-10-09" : "",
          fieldOrigins: {
            documentDate: index === 1 ? "IMPORTED" : "INHERITED",
            trainingSubject: "INHERITED",
            hours: "INHERITED",
            productionHours: "INHERITED",
          },
          trainingSubject: "",
          hours: "",
          productionHours: "",
          outcome: { status: "UNKNOWN", source: "" },
        },
      ],
    })),
  });
  const createdResponse = await page.request.post("/api/print-requests", {
    headers,
    data: input,
  });
  expect(createdResponse.ok(), await createdResponse.text()).toBe(true);
  const created = await createdResponse.json(),
    requestId = created.id as string;
  await page.goto(`/requests/${requestId}/edit`);
  await expect(page.locator(".operator-grid tbody tr")).toHaveCount(100);
  await expandCommon(page.locator("#request-training"));
  const shared = page.locator(
    '.training-primary-context [data-field-path="events.0.commonFields.trainingSubject"]',
  );
  await shared.focus();
  await shared.press("Control+A");
  await page.keyboard.press("Backspace");
  await expect
    .poll(
      async () =>
        (await readCommon(page, requestId)).events![0].commonFields
          .trainingSubject,
    )
    .toBe("");
  const check = page.getByRole("button", {
    name: "Проверить данные",
    exact: true,
  });
  await check.focus();
  await check.press("Enter");
  const errors = page.locator(".validation-result");
  await expect(errors).toContainText("Исправьте данные перед оформлением");
  await expect(errors).toBeFocused();
  const heading = errors.getByText("Исправьте данные перед оформлением", {
      exact: true,
    }),
    rect = await heading.boundingBox();
  expect(rect).toBeTruthy();
  expect(rect!.y).toBeGreaterThanOrEqual(0);
  expect(rect!.y + rect!.height).toBeLessThan(768);
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
  const button = errors
    .getByRole("button")
    .filter({ hasText: "Укажите программу/тему обучения" })
    .first();
  await expect(button).toBeVisible();
  await button.focus();
  await button.press("Enter");
  await expect(shared).toBeVisible();
  await expect(shared).toBeFocused();
  const active = await page.evaluate(() => ({
    path: document.activeElement?.getAttribute("data-field-path"),
    invalid: document.activeElement?.getAttribute("aria-invalid"),
    describedBy: document.activeElement?.getAttribute("aria-describedby"),
  }));
  expect(active.path).toBe("events.0.commonFields.trainingSubject");
  await page.screenshot({
    path: path.join(evidence, "exact-error-field-focused.png"),
  });
  await shared.press("Control+A");
  await page.keyboard.type("Синтетическая исходная общая программа");
  await expect
    .poll(
      async () =>
        (await readCommon(page, requestId)).events![0].commonFields
          .trainingSubject,
    )
    .toBe("Синтетическая исходная общая программа");
  await page.reload();
  const final = await readCommon(page, requestId);
  expect(final.items).toEqual(created.items);
  expect(final.events![0].commonFields.trainingSubject).toBe(
    input.events![0].commonFields.trainingSubject,
  );
  expect(final.documents).toHaveLength(0);
  expect(
    final.items.every((item) =>
      item.assignments.every(
        (assignment) =>
          assignment.outcome?.status === "UNKNOWN" &&
          !assignment.outcome.confirmedAt &&
          !assignment.outcome.confirmedBy,
      ),
    ),
  ).toBe(true);
  const resolvedResponse = await page.request.get(
      `/api/print-requests/${requestId}/resolved`,
    ),
    resolved = await resolvedResponse.json();
  expect(resolved.draft.items[1].assignments[0].documentDate).toBe(
    "2026-10-09",
  );
  await fullSuitePageApiCooldown(
    page,
    evidence,
    "error-focus-before-long-drawer",
  );
  const longDrawer = await fourFormsLongDrawerFocus(page, headers, evidence);
  await page.screenshot({
    path: path.join(evidence, "long-four-form-drawer-returned.png"),
  });
  await fs.writeFile(
    path.join(evidence, "error-focus-live-result.json"),
    JSON.stringify(
      {
        status: "PASS",
        synthetic: true,
        requestId,
        rows: 100,
        headingRect: rect,
        actualActiveControl: active,
        exactInheritedCauseFocused: true,
        validNeighborDate: "2026-10-09",
        UNKNOWNAndDatesPreserved: true,
        longDrawer,
        issuedDocuments: 0,
        elapsedMs: performance.now() - started,
        humanActiveMs: null,
      },
      null,
      2,
    ),
  );
});

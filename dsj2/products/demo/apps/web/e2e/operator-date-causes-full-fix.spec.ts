import { test, expect, type Page, type Locator } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  draftSchema,
  trainingDateRuleSchema,
  KZ_TRAINING_CALENDAR_VERSION,
  type ValidationIssue,
} from "@demo/contracts";
import {
  draftPayload,
  newAssignment,
  newRecipient,
  type Draft,
} from "../lib/types";
import { loginIsolated } from "./operator-full-fix-session";
import { fullSuiteApiCooldown } from "./operator-full-suite";

test.use({ trace: "off" });
const evidence = path.resolve(
  process.env.DEMO_DATE_CAUSE_EVIDENCE ||
    (process.env.DEMO_E2E_EVIDENCE
      ? path.join(process.env.DEMO_E2E_EVIDENCE, "date-causes")
      : "../../docs/evidence/operator-flow-full-fix-20261003/preparation/date-causes-browser"),
);
const reports: unknown[] = [];
test.beforeAll(async () => {
  test.setTimeout(90000);
  expect(process.env.DEMO_E2E_ISOLATED_TENANT).toBe("1");
  await fs.mkdir(evidence, { recursive: true });
  await fullSuiteApiCooldown(evidence, "remaining-date-causes-before-cases");
});
test.afterAll(async () => {
  await fs.writeFile(
    path.join(evidence, "date-causes-readback.json"),
    JSON.stringify(reports, null, 2),
  );
});
const rule = trainingDateRuleSchema.parse({
  hoursPerDay: 4,
  hoursSource: "THEORY",
  calendar: "KZ_FIVE_DAY",
  calendarVersion: KZ_TRAINING_CALENDAR_VERSION,
  anchor: "DOCUMENT_AFTER_TRAINING",
  protocolDate: "MANUAL",
  source: "Синтетический подтверждённый график для проверки дат",
});
async function create(
  page: Page,
  headers: Record<string, string>,
  overrides: {
    sum?: boolean;
    nonworking?: boolean;
    origins?: boolean;
    commonDate?: boolean;
  } = {},
) {
  const biot = randomUUID(),
    ptm = randomUUID();
  const source = draftSchema.parse({
    kind: "COMPANY",
    schemaVersion: 2,
    demoMode: true,
    commonFields: { documentDate: "2026-10-06" },
    events: [
      {
        id: biot,
        title: "Синтетическая проверка причин БиОТ",
        protocolTemplateId: "biot-protocol",
        protocolMode: "GROUP",
        commonFields: {
          ...(overrides.origins || overrides.commonDate
            ? {}
            : { documentDate: "2026-10-06" }),
          trainingSubject: "Синтетическая программа БиОТ",
          hours: "8",
          productionHours: "16",
          biotCategory: "WORKER",
          trainingDateRule: overrides.origins
            ? null
            : {
                ...rule,
                ...(overrides.sum
                  ? { hoursSource: "THEORY_AND_PRODUCTION" }
                  : {}),
                ...(overrides.nonworking ? { anchor: "DOCUMENT_IS_END" } : {}),
              },
        },
      },
      {
        id: ptm,
        title: "Синтетическая соседняя группа ПТМ",
        protocolTemplateId: "ptm-protocol",
        protocolMode: "GROUP",
        commonFields: {
          documentDate: "2026-10-09",
          trainingSubject: "Синтетическая программа ПТМ",
          hours: "8",
          trainingStart: "2026-10-01",
          trainingEnd: "2026-10-02",
          protocolDate: "2026-10-02",
        },
      },
    ],
    items: [0, 1].map((index) => ({
      ...newRecipient(),
      id: randomUUID(),
      fullNameRu: `Синтетический Причина ${index + 1}`,
      positionRu: "Синтетический рабочий",
      workplaceRu: "Синтетическая организация",
      employeeCategory: "WORKER",
      assignments: [
        {
          ...newAssignment("biot-worker-card"),
          id: randomUUID(),
          eventId: biot,
          protocolMode: "GROUP",
          hours: "",
          productionHours: "",
          documentDate: index ? "2026-10-09" : "",
          fieldOrigins: {
            hours: "INHERITED",
            productionHours: "INHERITED",
            documentDate: index ? "IMPORTED" : "INHERITED",
          },
          outcome: { status: "UNKNOWN", source: "" },
        },
        {
          ...newAssignment("ptm-card"),
          id: randomUUID(),
          eventId: ptm,
          protocolMode: "GROUP",
          documentDate: "2026-10-11",
          fieldOrigins: { documentDate: "IMPORTED" },
          outcome: { status: "UNKNOWN", source: "" },
        },
      ],
    })),
  });
  const response = await page.request.post("/api/print-requests", {
    headers: { ...headers, "idempotency-key": "date-causes-" + randomUUID() },
    data: source,
  });
  expect(response.ok(), await response.text()).toBe(true);
  const created: Draft = await response.json();
  await page.goto(`/requests/${created.id}/edit`);
  await expect(
    page.locator('input[data-field-path="items.0.fullNameRu"]'),
  ).toBeVisible();
  return { id: created.id, biot, ptm };
}
async function read(page: Page, id: string): Promise<Draft> {
  const response = await page.request.get(`/api/print-requests/${id}`);
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function resolved(page: Page, id: string) {
  const response = await page.request.get(`/api/print-requests/${id}/resolved`);
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<{
    draft: Draft;
    provenance: Record<string, Record<string, string>>;
    issues: ValidationIssue[];
  }>;
}
async function expand(details: Locator) {
  if (!(await details.evaluate((node) => (node as HTMLDetailsElement).open)))
    await details.locator(":scope > summary").click();
}
async function section(page: Page) {
  await expand(page.locator("#request-training"));
  return page.locator(".training-primary-context");
}
async function graph(root: Locator) {
  await expand(
    root
      .locator("details")
      .filter({
        has: root
          .page()
          .getByText("Отдельные даты и основания этого обучения", {
            exact: true,
          }),
      })
      .first(),
  );
  const settings = root
    .locator("details.field-provenance")
    .filter({
      has: root.page().getByLabel("Часов в учебном дне", { exact: true }),
    })
    .first();
  await expand(settings);
  return settings;
}
const facts = (draft: Draft) =>
  draft.items.map((item) => ({
    id: item.id,
    assignments: item.assignments.map((assignment) => ({
      id: assignment.id,
      eventId: assignment.eventId,
      outcome: assignment.outcome,
      result: assignment.result,
      knowledge: assignment.biotKnowledgeResult,
      proctoring: assignment.biotProctoringResult,
    })),
  }));
const neighborDates = (draft: Draft, biot: string) =>
  draft.items.flatMap((item, index) =>
    item.assignments
      .filter((assignment) => index !== 0 || assignment.eventId !== biot)
      .map((assignment) => ({
        id: assignment.id,
        documentDate: assignment.documentDate,
        origin: assignment.fieldOrigins?.documentDate,
      })),
  );
async function cause(
  page: Page,
  fixture: { id: string; biot: string },
  code: string,
  field: string,
  focusPath: string,
) {
  await expect
    .poll(async () =>
      (await resolved(page, fixture.id)).issues.some(
        (issue) =>
          issue.code === code &&
          issue.path === `items.0.assignments.0.${field}` &&
          issue.eventId === fixture.biot,
      ),
    )
    .toBe(true);
  const issue = (await resolved(page, fixture.id)).issues.find(
    (entry) =>
      entry.code === code && entry.path === `items.0.assignments.0.${field}`,
  )!;
  expect(issue.eventId).toBe(fixture.biot);
  await expand(page.locator("#request-readiness > details"));
  const button = page
    .locator(".operator-next-fields button")
    .filter({ hasText: issue.message })
    .first();
  await expect(button).toBeVisible();
  await button.click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.activeElement?.getAttribute("data-field-path"),
      ),
    )
    .toBe(focusPath);
  const active = await page.evaluate(() => ({
    path: document.activeElement?.getAttribute("data-field-path"),
    tag: document.activeElement?.tagName,
    value: (document.activeElement as HTMLInputElement)?.value,
    invalid: document.activeElement?.getAttribute("aria-invalid"),
    describedBy: document.activeElement?.getAttribute("aria-describedby"),
  }));
  await page.screenshot({
    path: path.join(
      evidence,
      `${code}-${field.replaceAll(".", "-")}-${reports.length}.png`,
    ),
    fullPage: true,
  });
  return { issue, active };
}

test("UX26 source hours invalid unit, zero, empty, production and period limit focus the saved cause and preserve neighbor dates and UNKNOWN", async ({
  page,
}) => {
  const headers = await loginIsolated(page),
    fixture = await create(page, headers, { sum: true });
  const initial = await read(page, fixture.id),
    root = await section(page);
  const hours = root.locator('[data-field-path="events.0.commonFields.hours"]');
  const cases = [
    { field: "hours", value: "8 ч", code: "TRAINING_HOURS_INVALID", fix: "8" },
    { field: "hours", value: "0", code: "TRAINING_HOURS_INVALID", fix: "8" },
    { field: "hours", value: "", code: "TRAINING_HOURS_INVALID", fix: "8" },
    {
      field: "productionHours",
      value: "16 ч",
      code: "TRAINING_PRODUCTION_HOURS_INVALID",
      fix: "16",
    },
    { field: "hours", value: "40000", code: "TRAINING_PERIOD_LIMIT", fix: "8" },
  ];
  for (const current of cases) {
    const field =
      current.field === "hours"
        ? hours
        : root.locator(
            `[data-field-path="events.0.commonFields.${current.field}"]`,
          );
    await field.fill(current.value);
    const proof = await cause(
      page,
      fixture,
      current.code,
      current.field,
      `events.0.commonFields.${current.field}`,
    );
    await field.fill(current.fix);
    await expect
      .poll(async () =>
        (await resolved(page, fixture.id)).issues.some(
          (issue) => issue.code === current.code,
        ),
      )
      .toBe(false);
    const after = await read(page, fixture.id);
    expect(facts(after)).toEqual(facts(initial));
    expect(neighborDates(after, fixture.biot)).toEqual(
      neighborDates(initial, fixture.biot),
    );
    reports.push({
      id: "UX26",
      case: current,
      fixture,
      ...proof,
      fixed: true,
      rawFacts: facts(after),
      preservedNeighborDates: neighborDates(after, fixture.biot),
    });
  }
});

test("UX26 calendar outside verified years and nonworking anchor focus exact event control and are fixable without changing known facts", async ({
  page,
}) => {
  const headers = await loginIsolated(page);
  for (const nonworking of [false, true]) {
    const fixture = await create(page, headers, { nonworking }),
      initial = await read(page, fixture.id),
      root = await section(page);
    await graph(root);
    const date = root.locator(
      '[data-field-path="events.0.commonFields.documentDate"]',
    );
    await date.fill(nonworking ? "2026-10-04" : "2027-01-12");
    const code = nonworking
      ? "TRAINING_ANCHOR_NONWORKING"
      : "TRAINING_CALENDAR_UNAVAILABLE";
    const field = nonworking ? "documentDate" : "trainingDateRule.calendar";
    const proof = await cause(
      page,
      fixture,
      code,
      field,
      `events.0.commonFields.${field}`,
    );
    await date.fill("2026-10-06");
    await expect
      .poll(async () =>
        (await resolved(page, fixture.id)).issues.some(
          (issue) => issue.code === code,
        ),
      )
      .toBe(false);
    const after = await read(page, fixture.id);
    expect(facts(after)).toEqual(facts(initial));
    expect(neighborDates(after, fixture.biot)).toEqual(
      neighborDates(initial, fixture.biot),
    );
    reports.push({
      id: "UX26",
      case: code,
      fixture,
      ...proof,
      fixed: true,
      rawFacts: facts(after),
      preservedNeighborDates: neighborDates(after, fixture.biot),
    });
  }
});

test("UX26/30 invalid daily parameter remains an accessible unapplied candidate, API rejects the invalid rule with a stable schema path, correction applies only on review", async ({
  page,
}) => {
  const headers = await loginIsolated(page),
    fixture = await create(page, headers),
    initial = await read(page, fixture.id),
    root = await section(page),
    settings = await graph(root);
  const daily = settings.getByLabel("Часов в учебном дне", { exact: true });
  await daily.fill("25");
  await expect(daily).toHaveAttribute("aria-invalid", "true");
  const description = await daily.getAttribute("aria-describedby");
  expect(description).toBeTruthy();
  await expect(page.locator(`[id="${description}"]`)).toContainText(
    "больше 0 и не больше 24",
  );
  await expect(
    settings.getByRole("button", {
      name: "Проверить применение графика",
      exact: true,
    }),
  ).toBeDisabled();
  await daily.press("Tab");
  await daily.focus();
  await expect(daily).toBeFocused();
  const invalidDraft = structuredClone(draftPayload(initial));
  invalidDraft.events![0].commonFields.trainingDateRule = {
    ...rule,
    hoursPerDay: 25,
  };
  const rejected = await page.request.patch(
    `/api/print-requests/${fixture.id}`,
    {
      headers,
      data: { expectedRevision: initial.revision, draft: invalidDraft },
    },
  );
  expect(rejected.status()).toBe(400);
  const rejection = await rejected.json();
  expect(rejection.code).toBe("VALIDATION");
  expect(rejection.details).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: [
          "draft",
          "events",
          0,
          "commonFields",
          "trainingDateRule",
          "hoursPerDay",
        ],
      }),
    ]),
  );
  expect(await read(page, fixture.id)).toEqual(initial);
  const active = await page.evaluate(() =>
    document.activeElement?.getAttribute("data-field-path"),
  );
  expect(active).toBe("events.0.commonFields.trainingDateRule.hoursPerDay");
  await page.screenshot({
    path: path.join(evidence, "UX30-daily25-unapplied-cause.png"),
    fullPage: true,
  });
  await daily.fill("8");
  await expect(daily).not.toHaveAttribute("aria-invalid", "true");
  await settings
    .getByRole("button", { name: "Проверить применение графика", exact: true })
    .click();
  expect(
    (await read(page, fixture.id)).events![0].commonFields.trainingDateRule,
  ).toEqual(initial.events![0].commonFields.trainingDateRule);
  await settings
    .getByRole("button", { name: "Применить правило расчёта", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await read(page, fixture.id)).events![0].commonFields.trainingDateRule
          ?.hoursPerDay,
    )
    .toBe(8);
  const after = await read(page, fixture.id);
  expect(facts(after)).toEqual(facts(initial));
  expect(neighborDates(after, fixture.biot)).toEqual(
    neighborDates(initial, fixture.biot),
  );
  reports.push({
    id: "UX26/30",
    case: "invalidDailyParameter",
    fixture,
    candidatePath: active,
    accessibleDescription: description,
    rejectedApi: { status: rejected.status(), response: rejection },
    appliedAfterExplicitReview: 8,
    rawFacts: facts(after),
    preservedNeighborDates: neighborDates(after, fixture.biot),
  });
});

test("UX09 request/event/individual dates preserve inherited, manual, imported and cleared origins through reload and return to common", async ({
  page,
}) => {
  const headers = await loginIsolated(page),
    fixture = await create(page, headers, { origins: true }),
    initial = await read(page, fixture.id);
  const snapshots: unknown[] = [];
  let sharedDateEntered = false;
  async function check(value: string, origin: string, rawOrigin: string) {
    await expect
      .poll(
        async () =>
          (await resolved(page, fixture.id)).draft.items[0].assignments[0]
            .documentDate,
      )
      .toBe(value);
    const current = await resolved(page, fixture.id),
      raw = await read(page, fixture.id),
      assignment = raw.items[0].assignments[0];
    expect(
      current.provenance[`${raw.items[0].id}:${assignment.id}`].documentDate,
    ).toBe(origin);
    expect(assignment.fieldOrigins?.documentDate).toBe(rawOrigin);
    if (sharedDateEntered) {
      // The resolved origin describes the explicit source value. The raw
      // assignment still proves whether this person inherits that event.
      const event = raw.events!.find((item) => item.id === fixture.biot)!;
      expect(event.commonFields.documentDate).toBe("2026-10-07");
      expect(event.commonFields.fieldOrigins?.documentDate).toBe("MANUAL");
    }
    expect(raw.items[1].assignments[0].documentDate).toBe("2026-10-09");
    expect(raw.items[1].assignments[0].fieldOrigins?.documentDate).toBe(
      "IMPORTED",
    );
    expect(facts(raw)).toEqual(facts(initial));
    snapshots.push({
      value,
      origin,
      rawOrigin,
      rawDocumentDate: assignment.documentDate,
      importedNeighbor: raw.items[1].assignments[0].documentDate,
    });
  }
  await check("2026-10-06", "REQUEST", "INHERITED");
  const root = await section(page);
  await graph(root);
  await root
    .locator('[data-field-path="events.0.commonFields.documentDate"]')
    .fill("2026-10-07");
  sharedDateEntered = true;
  await check("2026-10-07", "MANUAL", "INHERITED");
  await page
    .getByRole("button", { name: "Детали получателя 1", exact: true })
    .click();
  let modal = page.getByRole("dialog");
  let individual = modal.locator(
    '[data-field-path="items.0.assignments.0.documentDate"]',
  );
  await individual.fill("2026-10-08");
  await check("2026-10-08", "MANUAL", "MANUAL");
  await modal
    .getByRole("button", { name: "Вернуться к списку", exact: true })
    .click();
  await page
    .locator('[data-field-path="commonFields.documentDate"]')
    .fill("2026-10-12");
  await page.reload();
  await check("2026-10-08", "MANUAL", "MANUAL");
  await page
    .getByRole("button", { name: "Детали получателя 1", exact: true })
    .click();
  modal = page.getByRole("dialog");
  individual = modal.locator(
    '[data-field-path="items.0.assignments.0.documentDate"]',
  );
  await individual.fill("");
  await check("", "CLEARED", "CLEARED");
  await modal
    .getByRole("button", { name: "Вернуться к списку", exact: true })
    .click();
  await page.reload();
  await check("", "CLEARED", "CLEARED");
  await page
    .getByRole("button", { name: "Детали получателя 1", exact: true })
    .click();
  modal = page.getByRole("dialog");
  await modal
    .locator("[data-assignment-id]")
    .first()
    .getByRole("tab", { name: "Настройки", exact: true })
    .click();
  const provenance = modal.locator("details.field-provenance").first();
  await expand(provenance);
  const dateOrigin = provenance
    .locator("dl > div")
    .filter({ has: page.getByText("Дата документа", { exact: true }) });
  await expect(dateOrigin).toContainText("Очищено вручную");
  await dateOrigin
    .getByRole("button", { name: "Вернуть общее значение", exact: true })
    .click();
  await check("2026-10-07", "MANUAL", "INHERITED");
  await modal
    .getByRole("button", { name: "Вернуться к списку", exact: true })
    .click();
  await page.reload();
  await check("2026-10-07", "MANUAL", "INHERITED");
  await page.screenshot({
    path: path.join(evidence, "UX09-return-common-reload.png"),
    fullPage: true,
  });
  reports.push({ id: "UX09", fixture, snapshots, factsPreserved: true });
});

test("UX09 common empty date exposes its actual cause and malformed calendar drafts cannot pass validation or preview", async ({
  page,
}) => {
  const headers = await loginIsolated(page),
    fixture = await create(page, headers, { commonDate: true }),
    initial = await read(page, fixture.id);
  const common = page.locator('[data-field-path="commonFields.documentDate"]');
  const native = await common.evaluate((node) => {
    const input = node as HTMLInputElement,
      before = input.value;
    input.value = "2026-02-30";
    const rejectedValue = input.value;
    input.value = before;
    return { before, rejectedValue, inputType: input.type };
  });
  expect(native.inputType).toBe("date");
  expect(native.rejectedValue).toBe("");
  await common.fill("");
  const proof = await cause(
    page,
    fixture,
    "DATE_INVALID",
    "documentDate",
    "commonFields.documentDate",
  );
  await expect(common).toHaveAttribute("aria-invalid", "true");
  const cleared = await read(page, fixture.id);
  expect(cleared.commonFields?.fieldOrigins?.documentDate).toBe("CLEARED");
  expect(cleared.items).toEqual(initial.items);
  await page.reload();
  await expect(common).toHaveValue("");
  await expect(page.locator("#request-common-date-feedback")).toContainText(
    /дат/,
  );
  await common.fill("2026-10-06");
  await expect
    .poll(async () =>
      (await resolved(page, fixture.id)).issues.some(
        (issue) => issue.code === "DATE_INVALID",
      ),
    )
    .toBe(false);
  const valid = await read(page, fixture.id),
    invalid = structuredClone(draftPayload(valid));
  expect(valid.commonFields?.fieldOrigins?.documentDate).toBe("MANUAL");
  expect(valid.items).toEqual(initial.items);
  await page.reload();
  await expect(common).toHaveValue("2026-10-06");
  expect(
    (await resolved(page, fixture.id)).issues.some(
      (issue) => issue.code === "DATE_INVALID",
    ),
  ).toBe(false);
  invalid.commonFields!.documentDate = "2026-02-30";
  const patch = await page.request.patch(`/api/print-requests/${fixture.id}`, {
    headers,
    data: { expectedRevision: valid.revision, draft: invalid },
  });
  expect(patch.ok(), await patch.text()).toBe(true);
  const malformed: Draft = await patch.json();
  const validation = await page.request.post(
    `/api/print-requests/${fixture.id}/validate`,
    { headers, data: { expectedRevision: malformed.revision } },
  );
  expect(validation.ok(), await validation.text()).toBe(true);
  const invalidResult = await validation.json();
  expect(invalidResult.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "DATE_INVALID",
        path: "items.0.assignments.0.documentDate",
      }),
    ]),
  );
  const preview = await page.request.post(
    `/api/print-requests/${fixture.id}/preview`,
    { headers, data: { expectedRevision: malformed.revision } },
  );
  expect(preview.status()).toBe(422);
  const previewRejection = await preview.json();
  expect(JSON.stringify(previewRejection)).toContain("DATE_INVALID");
  const after = await read(page, fixture.id);
  expect(facts(after)).toEqual(facts(initial));
  expect(neighborDates(after, fixture.biot)).toEqual(
    neighborDates(initial, fixture.biot),
  );
  const correction = structuredClone(draftPayload(after));
  correction.commonFields!.documentDate = "2026-10-06";
  const fixed = await page.request.patch(`/api/print-requests/${fixture.id}`, {
    headers,
    data: { expectedRevision: after.revision, draft: correction },
  });
  expect(fixed.ok(), await fixed.text()).toBe(true);
  await page.reload();
  await expect(common).toHaveValue("2026-10-06");
  reports.push({
    id: "UX09",
    fixture,
    native,
    commonEmpty: proof,
    malformedSavedDraft: "2026-02-30",
    validationErrors: invalidResult.issues,
    preview: { status: preview.status(), response: previewRejection },
    correctedReload: true,
    rawFacts: facts(await read(page, fixture.id)),
  });
});

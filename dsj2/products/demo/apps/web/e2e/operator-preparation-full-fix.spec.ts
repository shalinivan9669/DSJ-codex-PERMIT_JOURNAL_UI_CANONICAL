import { test, expect, type Page, type Locator } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { loginIsolated } from "./operator-full-fix-session";
import { fullSuiteApiCooldown, fullSuitePageApiCooldown } from "./operator-full-suite";
import {
  applyBusinessRules,
  draftSchema,
  BIOT_CATEGORIES,
  biotCategoryIds,
  businessValidUntil,
  mandatoryTemplates,
  trainingDateRuleSchema,
  KZ_TRAINING_CALENDAR_VERSION,
  type BiotCategory,
  type EmployeeCategory,
  type TrainingDirection,
} from "@demo/contracts";
import {
  draftPayload,
  newAssignment,
  newRecipient,
  type Draft,
} from "../lib/types";

const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    "../../docs/evidence/operator-flow-full-fix-20261003/preparation/browser",
);
const reports: unknown[] = [];
test.use({ trace: "off" });
test.beforeAll(async () => {
  test.setTimeout(90000);
  expect(process.env.DEMO_E2E_ISOLATED_TENANT).toBe("1");
  await fs.mkdir(evidence, { recursive: true });
  await fullSuiteApiCooldown(evidence, "remaining-preparation-before-cases");
});
test.afterAll(async () => {
  await fs.writeFile(
    path.join(evidence, "preparation-browser-readback.json"),
    JSON.stringify(reports, null, 2),
  );
});
async function login(page: Page) {
  return loginIsolated(page);
}
const appliedRule = trainingDateRuleSchema.parse({
  hoursPerDay: 4,
  hoursSource: "THEORY",
  calendar: "KZ_FIVE_DAY",
  calendarVersion: KZ_TRAINING_CALENDAR_VERSION,
  anchor: "DOCUMENT_AFTER_TRAINING",
  protocolDate: "MANUAL",
  source: "Синтетический исходный график",
});
async function create(
  page: Page,
  headers: Record<string, string>,
  confirmed = false,
) {
  const biot = randomUUID(),
    ptm = randomUUID();
  const items = [0, 1].map((index) => ({
    ...newRecipient(),
    id: randomUUID(),
    fullNameRu: `Синтетический Подготовка ${index + 1}`,
    positionRu: "Синтетический инженер",
    workplaceRu: "Синтетическая организация",
    employeeCategory: "ITR" as const,
    assignments: [
      {
        ...newAssignment("biot-itr-certificate"),
        id: randomUUID(),
        eventId: biot,
        protocolMode: "GROUP" as const,
        outcome: {
          status:
            confirmed && index === 0
              ? ("PASSED" as const)
              : ("UNKNOWN" as const),
          source:
            confirmed && index === 0 ? "Синтетическая прежняя ведомость" : "",
        },
        result: confirmed && index === 0 ? "Сдал" : "",
        biotKnowledgeResult:
          confirmed && index === 0 ? "Синтетические прежние знания" : "",
        biotProctoringResult:
          confirmed && index === 0 ? "Синтетический прежний прокторинг" : "",
      },
      {
        ...newAssignment("ptm-card"),
        id: randomUUID(),
        eventId: ptm,
        protocolMode: "GROUP" as const,
        outcome: { status: "UNKNOWN" as const, source: "" },
      },
    ],
  }));
  const source = applyBusinessRules(
    draftSchema.parse({
      kind: "COMPANY",
      schemaVersion: 2,
      demoMode: true,
      commonFields: { documentDate: "2026-10-06" },
      events: [
        {
          id: biot,
          title: "Синтетическое БиОТ",
          protocolTemplateId: "biot-itr-protocol",
          protocolMode: "GROUP",
          commonFields: {
            trainingSubject: "Синтетическая программа БиОТ",
            hours: "40",
            biotCategory: "OHS_SPECIALIST_SPECIAL",
            trainingDateRule: appliedRule,
          },
        },
        {
          id: ptm,
          title: "Синтетическое ПТМ",
          protocolTemplateId: "ptm-protocol",
          protocolMode: "GROUP",
          commonFields: {
            trainingSubject: "Синтетическая программа ПТМ",
            hours: "8",
            trainingDateRule: appliedRule,
          },
        },
      ],
      items,
    }),
  );
  const response = await page.request.post("/api/print-requests", {
    headers: { ...headers, "idempotency-key": "preparation-" + randomUUID() },
    data: source,
  });
  expect(response.ok(), await response.text()).toBe(true);
  const created = await response.json();
  await page.goto(`/requests/${created.id}`);
  await expect(
    page.locator('input[data-field-path="items.0.fullNameRu"]'),
  ).toBeVisible();
  return { id: created.id as string, biot, ptm };
}
async function read(page: Page, id: string): Promise<Draft> {
  const response = await page.request.get(`/api/print-requests/${id}`);
  expect(response.ok(), `REQUEST_READ_FAILED status=${response.status()} request=${id} body=${await response.text()}`).toBe(true);
  return response.json();
}
async function expand(details: Locator) {
  if (!(await details.evaluate((e) => (e as HTMLDetailsElement).open)))
    await details.locator(":scope > summary").click();
}
async function section(page: Page) {
  await expand(page.locator("#request-training"));
  return page.locator(".training-primary-context");
}
async function calendar(root: Locator) {
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
  const result = root
    .locator("details.field-provenance")
    .filter({
      has: root.page().getByLabel("Часов в учебном дне", { exact: true }),
    })
    .first();
  await expand(result);
  return result;
}
const facts = (draft: Draft) =>
  draft.items.map((item) => ({
    id: item.id,
    assignments: item.assignments.map((a) => ({
      id: a.id,
      eventId: a.eventId,
      outcome: a.outcome,
      result: a.result,
      knowledge: a.biotKnowledgeResult,
      proctoring: a.biotProctoringResult,
    })),
  }));

for (const confirmed of [false, true])
  test(`UX24 durable preparation keeps ${confirmed ? "confirmed provenance" : "UNKNOWN"} separate until explicit selected apply`, async ({
    page,
  }) => {
    const headers = await login(page);
    const fixture = await create(page, headers, confirmed);
    const initial = await read(page, fixture.id);
    let root = await section(page);
    const outcome = () =>
      root.locator(
        'details.outcome-entry:has(> summary[data-training-field="outcomes"])',
      );
    await root
      .getByLabel("Известный результат", { exact: true })
      .selectOption("FAILED");
    await root
      .getByLabel("Источник подтверждения", { exact: true })
      .fill("Синтетическая НЕПРИМЕНЁННАЯ ведомость БиОТ");
    await root
      .locator('[data-training-field="biotKnowledgeResult"]')
      .fill("Синтетические НЕПРИМЕНЁННЫЕ знания");
    await root
      .locator('[data-training-field="biotProctoringResult"]')
      .fill("Синтетический НЕПРИМЕНЁННЫЙ прокторинг");
    await expect(outcome().locator(".preparation-status")).toContainText(
      "сохранена в этом браузере, не применена",
    );
    await root
      .getByLabel("Обучение для общих данных и результатов", { exact: true })
      .selectOption(fixture.ptm);
    await expect(
      root.getByLabel("Источник подтверждения", { exact: true }),
    ).toHaveValue("");
    await root
      .getByLabel("Известный результат", { exact: true })
      .selectOption("ABSENT");
    await root
      .getByLabel("Источник подтверждения", { exact: true })
      .fill("Синтетическая НЕПРИМЕНЁННАЯ ведомость ПТМ");
    await root
      .getByLabel("Обучение для общих данных и результатов", { exact: true })
      .selectOption(fixture.biot);
    await expect(
      root.getByLabel("Источник подтверждения", { exact: true }),
    ).toHaveValue("Синтетическая НЕПРИМЕНЁННАЯ ведомость БиОТ");
    await expect(
      root.locator('[data-training-field="biotKnowledgeResult"]'),
    ).toHaveValue("Синтетические НЕПРИМЕНЁННЫЕ знания");
    expect(facts(await read(page, fixture.id))).toEqual(facts(initial));
    await page.reload();
    root = await section(page);
    await expect(
      root.getByLabel("Известный результат", { exact: true }),
    ).toHaveValue("FAILED");
    await expect(
      root.locator('[data-training-field="biotProctoringResult"]'),
    ).toHaveValue("Синтетический НЕПРИМЕНЁННЫЙ прокторинг");
    expect(facts(await read(page, fixture.id))).toEqual(facts(initial));
    await page.screenshot({
      path: path.join(
        evidence,
        `UX24-${confirmed ? "confirmed" : "unknown"}-unapplied-after-reload.png`,
      ),
      fullPage: true,
    });
    await page.locator('main a[href="/requests"]').click();
    await expect(
      page.getByRole("heading", { name: "Заявки на печать", exact: true }),
    ).toBeVisible();
    await page.goBack();
    root = await section(page);
    await expect(
      root.getByLabel("Источник подтверждения", { exact: true }),
    ).toHaveValue("Синтетическая НЕПРИМЕНЁННАЯ ведомость БиОТ");
    await page.getByLabel("Выбрать строку 1", { exact: true }).check();
    await root
      .getByLabel("Кому подтвердить результат", { exact: true })
      .selectOption("selected");
    await expect(
      root.getByRole("button", {
        name: "Применить результат · 1 человек",
        exact: true,
      }),
    ).toBeEnabled();
    expect(facts(await read(page, fixture.id))).toEqual(facts(initial));
    await root
      .locator('[data-training-field="trainingSubject"]')
      .fill("Синтетическая программа изменена после подготовки");
    await expect(outcome()).toContainText(
      "Данные обучения изменились после подготовки",
    );
    await expect(
      root.getByRole("button", {
        name: "Применить результат · 1 человек",
        exact: true,
      }),
    ).toBeDisabled();
    await outcome()
      .getByRole("button", {
        name: "Подготовить применение к текущим данным",
        exact: true,
      })
      .click();
    const beforeApply = await read(page, fixture.id);
    expect(facts(beforeApply)).toEqual(facts(initial));
    await root
      .getByRole("button", {
        name: "Применить результат · 1 человек",
        exact: true,
      })
      .click();
    await expect
      .poll(
        async () =>
          (await read(page, fixture.id)).items[0].assignments.find(
            (a) => a.eventId === fixture.biot,
          )?.outcome?.status,
      )
      .toBe("FAILED");
    const applied = await read(page, fixture.id);
    expect(
      applied.items[0].assignments.find((a) => a.eventId === fixture.biot)
        ?.outcome?.confirmedBy,
    ).toBeTruthy();
    expect(applied.items[1].assignments).toEqual(
      beforeApply.items[1].assignments,
    );
    expect(
      applied.items[0].assignments.find((a) => a.eventId === fixture.ptm),
    ).toEqual(
      beforeApply.items[0].assignments.find((a) => a.eventId === fixture.ptm),
    );
    await page.screenshot({
      path: path.join(
        evidence,
        `UX24-${confirmed ? "confirmed" : "unknown"}-applied.png`,
      ),
      fullPage: true,
    });
    reports.push({
      id: "UX24",
      confirmedFixture: confirmed,
      fixture,
      before: facts(initial),
      beforeApply: facts(beforeApply),
      after: facts(applied),
      preservedUntilExplicitApply: true,
    });
  });

test("UX25/30 equal applied rules keep separate candidates, accessible cause, review, cancel and saved readback", async ({
  page,
}) => {
  const headers = await login(page);
  const fixture = await create(page, headers);
  const before = await read(page, fixture.id);
  let root = await section(page),
    current = await calendar(root);
  await current.getByLabel("Часов в учебном дне", { exact: true }).fill("8");
  await current
    .getByLabel("Источник графика", { exact: true })
    .fill("Синтетический кандидат БиОТ");
  await root
    .getByLabel("Обучение для общих данных и результатов", { exact: true })
    .selectOption(fixture.ptm);
  current = await calendar(root);
  await expect(
    current.getByLabel("Часов в учебном дне", { exact: true }),
  ).toHaveValue("4");
  await current.getByLabel("Часов в учебном дне", { exact: true }).fill("6");
  await current
    .getByLabel("Источник графика", { exact: true })
    .fill("Синтетический кандидат ПТМ");
  await root
    .getByLabel("Обучение для общих данных и результатов", { exact: true })
    .selectOption(fixture.biot);
  current = await calendar(root);
  await expect(
    current.getByLabel("Часов в учебном дне", { exact: true }),
  ).toHaveValue("8");
  await page.reload();
  root = await section(page);
  current = await calendar(root);
  await expect(
    current.getByLabel("Источник графика", { exact: true }),
  ).toHaveValue("Синтетический кандидат БиОТ");
  expect(
    (await read(page, fixture.id)).events?.map(
      (e) => e.commonFields.trainingDateRule,
    ),
  ).toEqual(before.events?.map((e) => e.commonFields.trainingDateRule));
  const numeric = current.getByLabel("Часов в учебном дне", { exact: true });
  for (const value of ["", "0", "25"]) {
    await numeric.fill(value);
    await expect(numeric).toHaveAttribute("aria-invalid", "true");
    const describedBy = await numeric.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`[id="${describedBy}"]`)).toContainText(
      "больше 0 и не больше 24",
    );
    await expect(
      current.getByRole("button", {
        name: "Проверить применение графика",
        exact: true,
      }),
    ).toBeDisabled();
  }
  await page.screenshot({
    path: path.join(evidence, "UX30-invalid-25-cause.png"),
    fullPage: true,
  });
  await numeric.focus();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("7,5");
  await expect(numeric).not.toHaveAttribute("aria-invalid", "true");
  await expect(
    current.getByRole("button", {
      name: "Проверить применение графика",
      exact: true,
    }),
  ).toBeEnabled();
  await current
    .getByRole("button", { name: "Проверить применение графика", exact: true })
    .click();
  await current
    .getByLabel("Источник графика", { exact: true })
    .fill("Синтетический кандидат БиОТ уточнён после проверки");
  await expect(
    current.getByRole("button", {
      name: "Применить правило расчёта",
      exact: true,
    }),
  ).toHaveCount(0);
  await current
    .getByRole("button", { name: "Проверить применение графика", exact: true })
    .click();
  await root.locator('[data-training-field="hours"]').fill("48");
  await expect(current).toContainText("Исходные данные");
  await expect(numeric).toHaveValue("7,5");
  await expect(
    current.getByRole("button", {
      name: "Проверить применение графика",
      exact: true,
    }),
  ).toBeDisabled();
  await current
    .getByRole("button", {
      name: "Подготовить график к текущим данным",
      exact: true,
    })
    .click();
  await current
    .getByRole("button", { name: "Проверить применение графика", exact: true })
    .click();
  await current
    .getByRole("button", { name: "Применить правило расчёта", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await read(page, fixture.id)).events?.find(
          (e) => e.id === fixture.biot,
        )?.commonFields.trainingDateRule?.hoursPerDay,
    )
    .toBe(7.5);
  const applied = await read(page, fixture.id);
  expect(
    applied.events?.find((e) => e.id === fixture.ptm)?.commonFields
      .trainingDateRule,
  ).toEqual(appliedRule);
  await numeric.fill("12");
  await current
    .getByRole("button", {
      name: "Отменить только подготовку графика",
      exact: true,
    })
    .click();
  await expect(numeric).toHaveValue("7.5");
  await page.reload();
  root = await section(page);
  current = await calendar(root);
  await expect(
    current.getByLabel("Часов в учебном дне", { exact: true }),
  ).toHaveValue("7.5");
  await root
    .getByLabel("Обучение для общих данных и результатов", { exact: true })
    .selectOption(fixture.ptm);
  current = await calendar(root);
  await expect(
    current.getByLabel("Часов в учебном дне", { exact: true }),
  ).toHaveValue("6");
  await page.screenshot({
    path: path.join(evidence, "UX25-separate-unapplied-ptm.png"),
    fullPage: true,
  });
  reports.push({
    id: "UX25/30",
    fixture,
    beforeRules: before.events?.map((e) => ({
      id: e.id,
      rule: e.commonFields.trainingDateRule,
    })),
    afterRules: (await read(page, fixture.id)).events?.map((e) => ({
      id: e.id,
      rule: e.commonFields.trainingDateRule,
    })),
    accessibleErrors: ["", "0", "25"],
    validDecimal: 7.5,
    reviewInvalidatedByCandidateAndContext: true,
    cancellationPreservedApplied: true,
  });
});

test("preparation storage failure blocks switching/navigation then retries without losing input; removed target remains separate", async ({
  page,
}) => {
  const headers = await login(page);
  const fixture = await create(page, headers);
  let root = await section(page);
  await page.evaluate(() => {
    const scope = window as unknown as {
      restorePreparationStorage: () => void;
    };
    const original = Storage.prototype.setItem;
    scope.restorePreparationStorage = () => {
      Storage.prototype.setItem = original;
    };
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("demo:preparation:v1:"))
        throw new DOMException(
          "Synthetic controlled quota failure",
          "QuotaExceededError",
        );
      return original.call(this, key, value);
    };
  });
  await root
    .getByLabel("Известный результат", { exact: true })
    .selectOption("PASSED");
  await root
    .getByLabel("Источник подтверждения", { exact: true })
    .fill("Синтетический ввод при контролируемом отказе хранилища");
  await expect(
    root.locator(
      'details.outcome-entry:has(> summary[data-training-field="outcomes"])',
    ),
  ).toContainText("Synthetic controlled quota failure");
  await root
    .getByLabel("Обучение для общих данных и результатов", { exact: true })
    .selectOption(fixture.ptm);
  await expect(
    root.getByLabel("Обучение для общих данных и результатов", { exact: true }),
  ).toHaveValue(fixture.biot);
  await page.locator('main a[href="/requests"]').click();
  await expect(page).toHaveURL(new RegExp(fixture.id));
  await expect(
    root.getByLabel("Источник подтверждения", { exact: true }),
  ).toHaveValue("Синтетический ввод при контролируемом отказе хранилища");
  await page.screenshot({
    path: path.join(evidence, "preparation-storage-error-visible.png"),
    fullPage: true,
  });
  await page.evaluate(() =>
    (
      window as unknown as { restorePreparationStorage: () => void }
    ).restorePreparationStorage(),
  );
  await root
    .getByRole("button", {
      name: "Повторить сохранение подготовки",
      exact: true,
    })
    .click();
  await expect(
    root.locator("details.outcome-entry > .preparation-status"),
  ).toContainText("сохранена");
  await page.reload();
  root = await section(page);
  await expect(
    root.getByLabel("Источник подтверждения", { exact: true }),
  ).toHaveValue("Синтетический ввод при контролируемом отказе хранилища");
  let graph = await calendar(root);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (
      window as unknown as { restorePreparationStorage: () => void }
    ).restorePreparationStorage = () => {
      Storage.prototype.setItem = original;
    };
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("demo:preparation:v1:") && key.includes(":calendar:"))
        throw new DOMException(
          "Synthetic controlled calendar storage failure",
          "QuotaExceededError",
        );
      return original.call(this, key, value);
    };
  });
  await graph.getByLabel("Часов в учебном дне", { exact: true }).fill("8");
  await expect(graph).toContainText(
    "Synthetic controlled calendar storage failure",
  );
  await root
    .getByLabel("Обучение для общих данных и результатов", { exact: true })
    .selectOption(fixture.ptm);
  await expect(
    root.getByLabel("Обучение для общих данных и результатов", { exact: true }),
  ).toHaveValue(fixture.biot);
  await page.locator('main a[href="/requests"]').click();
  await expect(page).toHaveURL(new RegExp(fixture.id));
  await expect(
    graph.getByLabel("Часов в учебном дне", { exact: true }),
  ).toHaveValue("8");
  await page.screenshot({
    path: path.join(evidence, "calendar-storage-error-visible.png"),
    fullPage: true,
  });
  await page.evaluate(() =>
    (
      window as unknown as { restorePreparationStorage: () => void }
    ).restorePreparationStorage(),
  );
  await graph
    .getByRole("button", { name: "Повторить сохранение графика", exact: true })
    .click();
  await expect(graph.locator(".preparation-status")).toContainText("сохранён");
  await page.reload();
  root = await section(page);
  graph = await calendar(root);
  await expect(
    graph.getByLabel("Часов в учебном дне", { exact: true }),
  ).toHaveValue("8");
  const beforeCorruption = facts(await read(page, fixture.id));
  await page.evaluate(
    ({ eventId }) => {
      const key = Object.keys(localStorage).find((key) =>
        key.includes(":outcome:" + eventId),
      );
      if (!key) throw new Error("SYNTHETIC_PREPARATION_NOT_FOUND");
      localStorage.setItem(key, "{controlled synthetic malformed payload");
    },
    { eventId: fixture.biot },
  );
  await page.reload();
  root = await section(page);
  await expect(
    root.locator("details.outcome-entry > .preparation-status"),
  ).toContainText("не сохранена");
  await page.locator('main a[href="/requests"]').click();
  await expect(page).toHaveURL(new RegExp(fixture.id));
  expect(
    await page.evaluate(
      ({ eventId }) => {
        const key = Object.keys(localStorage).find((key) =>
          key.includes(":outcome:" + eventId),
        );
        return key ? localStorage.getItem(key) : null;
      },
      { eventId: fixture.biot },
    ),
  ).toBe("{controlled synthetic malformed payload");
  await root
    .getByRole("button", {
      name: "Отменить только подготовку результата",
      exact: true,
    })
    .click();
  await expect(
    root.locator("details.outcome-entry > .preparation-status"),
  ).toContainText("ещё не заполнена");
  graph = await calendar(root);
  await expect(
    graph.getByLabel("Часов в учебном дне", { exact: true }),
  ).toHaveValue("8");
  expect(facts(await read(page, fixture.id))).toEqual(beforeCorruption);
  const beforeRemove = await read(page, fixture.id);
  const without = draftPayload(beforeRemove);
  without.events = without.events?.filter((e) => e.id !== fixture.biot);
  without.items = without.items.map((item) => ({
    ...item,
    assignments: item.assignments.filter((a) => a.eventId !== fixture.biot),
  }));
  const response = await page.request.patch(
    `/api/print-requests/${fixture.id}`,
    {
      headers,
      data: { expectedRevision: beforeRemove.revision, draft: without },
    },
  );
  expect(response.ok(), await response.text()).toBe(true);
  await page.reload();
  root = await section(page);
  await expect(root).toContainText("обучение удалено");
  await expect(root).toContainText("не применяется к другому обучению");
  const afterRemove = await read(page, fixture.id);
  expect(
    afterRemove.items
      .flatMap((i) => i.assignments)
      .every((a) => a.outcome?.status === "UNKNOWN"),
  ).toBe(true);
  await page.screenshot({
    path: path.join(evidence, "preparation-removed-event-safe.png"),
    fullPage: true,
  });
  reports.push({
    id: "preparation-error/removed",
    fixture,
    failure: "controlled localStorage quota rejection",
    navigationAndEventSwitchBlocked: true,
    retryAndReloadPreservedInput: true,
    calendarFailureSwitchNavigationBlockedAndRetryPreserved: true,
    malformedScopedPreparationExplicitCancellationPreservesCalendarAndFacts: true,
    afterRemovalFacts: facts(afterRemove),
    noConfirmedFactsCreated: true,
  });
});

test("UX13/R4 every supported category and personal form shows forced actual expiry, date change and reload", async ({
  page,
}) => {
  test.setTimeout(600000);
  const headers = await login(page);
  const specs: {
    category: EmployeeCategory;
    direction: TrainingDirection;
    biot?: BiotCategory;
  }[] = [
    ...biotCategoryIds.map((biot) => ({
      category: BIOT_CATEGORIES[biot].form,
      direction: "BIOT" as const,
      biot,
    })),
    ...(["PB", "PTM", "PS"] as const).flatMap((direction) =>
      (["WORKER", "ITR"] as const).map((category) => ({ category, direction })),
    ),
  ];
  const observations = [];
  for (const [specIndex, spec] of specs.entries()) {
    // Fifteen categories generate real editor/save/read traffic. Give the
    // unchanged full-suite API window an idle boundary every three categories.
    if (specIndex > 0 && specIndex % 3 === 0)
      await fullSuitePageApiCooldown(page, evidence, `remaining-expiry-batch-${specIndex}`);
    const item = {
      ...newRecipient(),
      fullNameRu:
        "Синтетическая проверка срока " +
        (spec.biot || spec.direction + spec.category),
      employeeCategory: spec.category,
      assignments: [
        {
          ...newAssignment(
            mandatoryTemplates(spec.direction, spec.category)[0],
          ),
          documentDate: "2026-10-03",
          fieldOrigins: { documentDate: "MANUAL" as const },
          ...(spec.biot ? { biotCategory: spec.biot } : {}),
          protocolMode: "INDIVIDUAL" as const,
        },
      ],
    };
    const source = applyBusinessRules(
      draftSchema.parse({
        kind: "COMPANY",
        schemaVersion: 2,
        demoMode: true,
        items: [item],
      }),
    );
    const response = await page.request.post("/api/print-requests", {
      headers,
      data: source,
    });
    expect(response.ok(), await response.text()).toBe(true);
    const created = await response.json();
    await page.goto(`/requests/${created.id}`);
    await page
      .getByRole("button", { name: "Детали получателя 1", exact: true })
      .click();
    let saved = await read(page, created.id);
    const primary = saved.items[0].assignments.find(
      (a) =>
        !a.templateId.endsWith("-protocol") && a.templateId !== "ps-witness",
    )!;
    const primaryFields = page.locator(`[data-assignment-id="${primary.id}"]`);
    await primaryFields
      .getByLabel("Дата документа", { exact: true })
      .fill("2026-10-09");
    await expect
      .poll(
        async () =>
          (await read(page, created.id)).items[0].assignments.find(
            (a) => a.id === primary.id,
          )?.documentDate,
      )
      .toBe("2026-10-09");
    saved = await read(page, created.id);
    for (const assignment of saved.items[0].assignments) {
      const wrapper = page.locator(`[data-assignment-id="${assignment.id}"]`);
      await expand(wrapper);
      await expand(wrapper.locator(".document-date-details"));
      const until = wrapper.getByLabel("Действителен до", { exact: true });
      if (spec.direction === "PS") await expect(until).toBeDisabled();
      else await expect(until).toBeEditable();
      await expect(until).toHaveValue(assignment.validUntil);
      expect(assignment.validUntil).toBe(
        spec.direction === "PS"
          ? ""
          : businessValidUntil(assignment.documentDate, spec.category),
      );
      expect(assignment.fieldOrigins?.validUntil).toBe("AUTO");
      await expand(wrapper.locator(".assignment-help"));
      await expect(wrapper).toContainText(
        spec.direction === "PS"
          ? "ПС — бессрочно. Дата окончания не указывается."
          : "Введённая вручную или импортированная дата сохраняется",
      );
      if (
        spec.biot &&
        ["INSPECTOR_SPECIAL", "COUNCIL_GENERAL", "COUNCIL_SPECIAL"].includes(
          spec.biot,
        )
      )
        await expect(wrapper).toContainText("Расхождение");
      observations.push({
        requestId: created.id,
        ...spec,
        templateId: assignment.templateId,
        issueDate: assignment.documentDate,
        displayed: await until.inputValue(),
        savedUntil: assignment.validUntil,
        savedOrigin: assignment.fieldOrigins?.validUntil,
      });
    }
    // Automatic values are defaults; an explicit personal expiry is source data.
    // Exercise the actual editable field for every non-PS category, then change
    // the issue date and verify the exception remains manual after saving/reload.
    if (spec.direction !== "PS") {
      const manualUntil = "2031-11-12";
      const primaryBefore = saved.items[0].assignments.find((a) => a.id === primary.id)!;
      await primaryFields.getByLabel("Действителен до", { exact: true }).fill(manualUntil);
      await expect.poll(async () => {
        const value = (await read(page, created.id)).items[0].assignments.find((a) => a.id === primary.id)!;
        return { value: value.validUntil, origin: value.fieldOrigins?.validUntil };
      }).toEqual({ value: manualUntil, origin: "MANUAL" });
      await primaryFields.getByLabel("Дата документа", { exact: true }).fill("2026-10-10");
      await expect.poll(async () => (await read(page, created.id)).items[0].assignments.find((a) => a.id === primary.id)?.documentDate).toBe("2026-10-10");
      saved = await read(page, created.id);
      const manual = saved.items[0].assignments.find((a) => a.id === primary.id)!;
      expect(manual.validUntil).toBe(manualUntil);
      expect(manual.fieldOrigins?.validUntil).toBe("MANUAL");
      expect(manual.outcome).toEqual(primaryBefore.outcome);
      expect(manual.templateId).toBe(primaryBefore.templateId);
      await expect(primaryFields.getByLabel("Действителен до", { exact: true })).toHaveValue(manualUntil);
      observations.push({ requestId: created.id, ...spec, templateId: manual.templateId, issueDate: manual.documentDate, displayed: manualUntil, savedUntil: manual.validUntil, savedOrigin: manual.fieldOrigins?.validUntil });
    }
    if (
      spec.biot === "INSPECTOR_SPECIAL" ||
      spec.biot === "COUNCIL_GENERAL" ||
      spec.biot === "WORKER" ||
      spec.direction === "PS"
    ) {
      await page.screenshot({
        path: path.join(
          evidence,
          `R4-${spec.biot || spec.direction + spec.category}.png`,
        ),
        fullPage: true,
      });
      if (spec.biot) {
        await primaryFields
          .getByLabel("Категория обучения БиОТ", { exact: true })
          .locator("..")
          .screenshot({
            path: path.join(
              evidence,
              `R4-${spec.biot}-category-explanation.png`,
            ),
          });
      }
    }
    await page.reload();
    await page
      .getByRole("button", { name: "Детали получателя 1", exact: true })
      .click();
    expect((await read(page, created.id)).items).toEqual(saved.items);
    for (const assignment of saved.items[0].assignments) {
      const wrapper = page.locator(`[data-assignment-id="${assignment.id}"]`);
      await expand(wrapper);
      await expand(wrapper.locator(".document-date-details"));
      await expect(
        wrapper.getByLabel("Действителен до", { exact: true }),
      ).toHaveValue(assignment.validUntil);
    }
  }
  reports.push({
    id: "UX13/R4",
    allPersonalCategoryForms: observations,
    sourceOfTruth:
      "actual browser input and saved API readback after date change and reload",
    legalApproval: false,
  });
});

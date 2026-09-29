import { test, expect, type Page } from "@playwright/test";
import {
  resolveDraft,
  KZ_TRAINING_CALENDAR_VERSION,
  type TrainingDateRule,
} from "@demo/contracts";
import { newAssignment, newRecipient, type Draft } from "../lib/types";

const requestId = "training-calendar-feedback";
const schedule: TrainingDateRule = {
  hoursPerDay: 8,
  hoursSource: "THEORY",
  calendar: "KZ_FIVE_DAY",
  calendarVersion: KZ_TRAINING_CALENDAR_VERSION,
  anchor: "DOCUMENT_AFTER_TRAINING",
  protocolDate: "DOCUMENT_DATE",
  source: "Подтверждённый график синтетического центра",
};
async function fixture(
  page: Page,
  mode: "center" | "pinned" | "manual-setup" = "center",
) {
  await page.routeWebSocket(/\/_next\/webpack-hmr/, (socket) => socket.close());
  const center = mode === "manual-setup" ? {} : { trainingDateRule: schedule };
  let draft: Draft = {
    id: requestId,
    revision: 0,
    status: "DRAFT",
    kind: "PERSON",
    title: "Проверка календаря обучения",
    customerId: null,
    demoMode: true,
    schemaVersion: 2,
    profileVersionId:
      mode === "pinned" ? "old-center-profile" : "current-center-profile",
    commonFields: { documentDate: "2026-03-26" },
    items: [
      {
        ...newRecipient(),
        id: "person-one",
        fullNameRu: "Тестовый слушатель",
        positionRu: "Монтажник",
        assignments: [
          { ...newAssignment("ptm-card"), id: "card-one", hours: "16" },
        ],
      },
    ],
  };
  let profileReads = 0;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.slice(4);
    const method = route.request().method();
    let value: unknown = { items: [], total: 0 };
    const profile = {
      nameRu: "Синтетический центр",
      nameKz: "",
      addressRu: "",
      addressKz: "",
      cityRu: "",
      cityKz: "",
      approvalBasis: "",
      commission: [],
      approved: true,
      commonFields:
        mode === "pinned"
          ? { trainingDateRule: { ...schedule, hoursPerDay: 4 } }
          : center,
    };
    if (path === "/auth/session") value = { csrfToken: "synthetic-fixture" };
    else if (path === "/context")
      value = {
        user: {
          id: "operator",
          displayName: "Оператор",
          role: "OPERATOR",
          email: "operator@example.invalid",
        },
        tenant: {
          id: "synthetic",
          name: "Синтетический центр",
          timezone: "Asia/Almaty",
          demoOnly: true,
        },
        profile,
        profileVersionId: "current-center-profile",
        templates: [],
        numbering: {},
      };
    else if (path === "/settings/profiles") {
      profileReads++;
      value = {
        items: [
          {
            id: "old-center-profile",
            version: 1,
            profile: { ...profile, commonFields: center },
          },
        ],
      };
    } else if (path === `/print-requests/${requestId}/resolved`)
      value = resolveDraft(draft, center);
    else if (path === `/print-requests/${requestId}/validate`) {
      const result = resolveDraft(draft, center);
      value = { valid: !result.issues.length, errors: result.issues };
    } else if (path === `/print-requests/${requestId}`) {
      if (method === "PATCH") {
        const body = route.request().postDataJSON();
        expect(body.expectedRevision).toBe(draft.revision);
        draft = { ...draft, ...body.draft, revision: draft.revision + 1 };
        value = { revision: draft.revision };
      } else value = draft;
    }
    await route.fulfill({ json: value });
  });
  return { current: () => draft, profileReads: () => profileReads };
}
async function open(page: Page) {
  await page.goto(`/requests/${requestId}/edit`);
  await page
    .getByRole("button", { name: "Документы и даты получателя 1", exact: true })
    .click();
  await expect(
    page.getByLabel("Дата документа", { exact: true }).first(),
  ).toHaveValue("2026-03-26");
}

test("center schedule renders a compact range, preserves a retroactive document date and reveals a precise invalid override", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 1366, height: 1100 });
  await open(page);
  const dates = page.locator(".document-date-details").first();
  await expect(dates.locator("summary").first()).toContainText(
    "19.03.2026 — 20.03.2026",
  );
  const end = page.locator(
    '[data-field-path="items.0.assignments.0.trainingEnd"]',
  );
  await expect(end).toBeHidden();
  await page
    .locator('[data-assignment-section="main"]')
    .first()
    .screenshot({ path: test.info().outputPath("compact-training-dates.png") });
  await dates.locator("summary").first().click();
  await page.getByText("Расчёт дат и пояснения", { exact: true }).click();
  await expect(dates).toContainText(
    "Продолжительность по выбранным часам: 2 учебных дней",
  );
  await expect(dates).toContainText("праздники и переносы 2025–2026");
  await dates.screenshot({
    path: test.info().outputPath("training-calculation-explained.png"),
  });
  await page
    .getByLabel("Дата документа", { exact: true })
    .first()
    .fill("2025-01-08");
  await expect(end).toHaveValue("2025-01-06");
  await expect(
    page.locator('[data-field-path="items.0.assignments.0.trainingStart"]'),
  ).toHaveValue("2025-01-05");
  await end.fill("2025-01-08");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect
    .poll(
      () => state.current().items[0].assignments[0].fieldOrigins?.trainingEnd,
    )
    .toBe("MANUAL");
  await dates.locator("summary").first().click();
  await page
    .getByRole("button", { name: "Вернуться к таблице", exact: true })
    .click();
  await page.getByRole("button", { name: "Проверить", exact: true }).click();
  await page
    .getByRole("button", {
      name: /Окончание обучения должно быть раньше даты документа/,
    })
    .click();
  await expect(end).toBeFocused();
  await expect(end).toHaveValue("2025-01-08");
  await page.reload();
  await page
    .getByRole("button", { name: "Документы и даты получателя 1", exact: true })
    .click();
  await expect(
    page.getByLabel("Дата документа", { exact: true }).first(),
  ).toHaveValue("2025-01-08");
  expect(state.current().items[0].assignments[0].trainingEnd).toBe(
    "2025-01-08",
  );
});

test("a request pinned to the old center profile uses its schedule in the card and request settings", async ({
  page,
}) => {
  const state = await fixture(page, "pinned");
  await open(page);
  await expect(
    page.locator(".document-date-details summary").first(),
  ).toContainText("19.03.2026 — 20.03.2026");
  expect(state.profileReads()).toBeGreaterThan(0);
  await page
    .getByRole("button", { name: "Настроить даты и протоколы", exact: true })
    .click();
  const context = page.locator(".common-context");
  await context
    .getByText("Правило расчёта периода обучения", { exact: true })
    .click();
  await expect(
    context.getByLabel("Часов в учебном дне", { exact: true }),
  ).toHaveValue("8");
  await expect(context.getByLabel("Учебные дни", { exact: true })).toHaveValue(
    "KZ_FIVE_DAY",
  );
});

test("a new schedule requires entered daily hours and persists the selected calendar version without changing raw dates", async ({
  page,
}) => {
  const state = await fixture(page, "manual-setup");
  await open(page);
  await expect(
    page.locator(".document-date-details summary").first(),
  ).toContainText("Период обучения не задан");
  await page
    .getByRole("button", { name: "Настроить даты и протоколы", exact: true })
    .click();
  const context = page.locator(".common-context");
  await context
    .getByText("Правило расчёта периода обучения", { exact: true })
    .click();
  const apply = context.getByRole("button", {
    name: "Применить правило расчёта",
    exact: true,
  });
  await expect(apply).toBeDisabled();
  await expect(
    context.getByLabel("Часов в учебном дне", { exact: true }),
  ).toHaveValue("");
  await expect(
    context.getByLabel("Связь с датой документа", { exact: true }),
  ).toHaveValue("DOCUMENT_AFTER_TRAINING");
  await context.getByLabel("Часов в учебном дне", { exact: true }).fill("8");
  await apply.click();
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect
    .poll(() => state.current().commonFields?.trainingDateRule?.calendarVersion)
    .toBe(KZ_TRAINING_CALENDAR_VERSION);
  expect(state.current().items[0].assignments[0].trainingStart).toBe("");
  await expect(
    page.locator(".document-date-details summary").first(),
  ).toContainText("19.03.2026 — 20.03.2026");
  await page.reload();
  await page
    .getByRole("button", { name: "Документы и даты получателя 1", exact: true })
    .click();
  await expect(
    page.locator(".document-date-details summary").first(),
  ).toContainText("19.03.2026 — 20.03.2026");
});

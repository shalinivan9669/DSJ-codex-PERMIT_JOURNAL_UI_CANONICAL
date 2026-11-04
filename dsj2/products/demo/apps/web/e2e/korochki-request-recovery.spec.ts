import { test, expect, type Page } from "@playwright/test";
import { resolveDraft } from "@demo/contracts";
import { newAssignment, newRecipient, type Draft } from "../lib/types";

async function fixture(
  page: Page,
  options: {
    loseCreate?: boolean;
    malformedCreate?: boolean;
    failDetail?: boolean;
    empty?: boolean;
    paper?: boolean;
  } = {},
) {
  await page.routeWebSocket(/\/_next\/webpack-hmr/, (socket) => socket.close());
  const state = {
    creations: [] as { key: string; body: string }[],
    detailReads: 0,
    exports: 0,
    listReads: 0,
    allowDetail: !options.failDetail,
    paperWrites: [] as {
      documentIds: string[];
      signedAt: string;
      signerNames: string[];
      reason: string;
      allRequiredSignaturesPresent: boolean;
    }[],
  };
  let paperSignature: {
    signedAt: string;
    signerNames: string[];
    reason: string;
  } | null = null;
  let draft: Draft = {
    id: "request-recovery",
    revision: 0,
    status: "DRAFT",
    kind: "COMPANY",
    title: "Группа после обучения",
    customerId: null,
    demoMode: true,
    schemaVersion: 2,
    commonFields: { documentDate: "2026-11-04" },
    ...(options.paper
      ? {
          issuances: [
            {
              id: "issuance-paper",
              sourceRevision: 0,
              createdAt: "2026-11-04T08:00:00Z",
            },
          ],
        }
      : {}),
    items: [
      {
        ...newRecipient(),
        id: "person-one",
        fullNameRu: "Тестовый Иван",
        positionRu: "Сварщик",
        assignments: [newAssignment("biot-worker-card")],
      },
      {
        ...newRecipient(),
        id: "person-two",
        fullNameRu: "Тестовая Анна",
        positionRu: "Инженер",
        assignments: [newAssignment("ptm-card")],
      },
    ],
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.slice(4);
    const method = route.request().method();
    let value: unknown = { items: [], total: 0 };
    if (path === "/auth/session") value = { csrfToken: "synthetic" };
    else if (path === "/context")
      value = {
        user: {
          id: "operator",
          displayName: "Оператор",
          role: options.paper ? "DIRECTOR" : "OPERATOR",
          email: "operator@example.invalid",
        },
        tenant: {
          id: "test-center",
          name: "Тестовый центр",
          timezone: "Asia/Almaty",
          demoOnly: true,
        },
        profile: {
          nameRu: "Тестовый центр",
          nameKz: "Тест",
          addressRu: "",
          addressKz: "",
          cityRu: "",
          cityKz: "",
          approvalBasis: "",
          commission: [],
          approved: true,
        },
        templates: [],
        numbering: {},
      };
    else if (path === "/print-requests" && method === "POST") {
      state.creations.push({
        key: route.request().headers()["idempotency-key"] || "",
        body: route.request().postData() || "",
      });
      draft = {
        ...route.request().postDataJSON(),
        id: draft.id,
        revision: 0,
        status: "DRAFT",
      } as Draft;
      if (state.creations.length === 1 && options.loseCreate) {
        await route.abort("failed");
        return;
      }
      value =
        state.creations.length === 1 && options.malformedCreate ? {} : draft;
    } else if (path === "/print-requests" && method === "GET") {
      state.listReads++;
      value = {
        items: options.empty
          ? []
          : [
              {
                id: draft.id,
                title: draft.title,
                kind: draft.kind,
                status: draft.status,
                revision: draft.revision,
                customerName: "ТОО Тестовая компания",
                itemCount: 2,
              },
            ],
        total: options.empty ? 0 : 1,
      };
    } else if (path === "/print-requests/overview") {
      value = options.empty
        ? { requests: 0, active: 0, archived: 0, documents: 0 }
        : { requests: 1, active: 1, archived: 0, documents: 0 };
    } else if (path === "/print-requests/export") {
      state.exports++;
      if (state.exports === 1) {
        await route.fulfill({
          status: 503,
          json: { message: "Не удалось подготовить реестр" },
        });
        return;
      }
      await route.fulfill({
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        body: "synthetic export",
        headers: {
          "content-disposition": 'attachment; filename="registry.xlsx"',
        },
      });
      return;
    } else if (path === `/print-requests/${draft.id}/signing`) {
      value = {
        issuanceId: "issuance-paper",
        status: paperSignature ? "ISSUED" : "AWAITING_SIGNATURE",
        archived: !!paperSignature,
        providers: {
          EGOV_QR: { available: false, reason: "Не настроен" },
          NCALAYER: { available: false, reason: "Не настроен" },
        },
        missingBindings: [],
        documents: [
          {
            documentId: "document-paper",
            templateId: "biot-worker-card",
            rowId: "person-one",
            number: "ТЕСТ-001",
            artifactId: "paper-pdf",
            complete: !!paperSignature,
            documentDate: "2026-11-04",
            paperAllowed: true,
            canAttestPaper: true,
            paperSignature,
            requiredSigners: ["Директор", "Председатель", "Преподаватель"].map(
              (displayName, index) => ({
                kind: ["DIRECTOR", "CHAIR", "TEACHER"][index],
                displayName,
                canSign: false,
                signed: false,
              }),
            ),
          },
        ],
      };
    } else if (path === `/print-requests/${draft.id}/paper-signatures`) {
      const payload = route.request().postDataJSON();
      state.paperWrites.push(payload);
      if (state.paperWrites.length === 1) {
        await route.fulfill({
          status: 503,
          json: { message: "Не удалось сохранить отметку" },
        });
        return;
      }
      paperSignature = {
        signedAt: payload.signedAt,
        signerNames: payload.signerNames,
        reason: payload.reason,
      };
      value = { status: "ISSUED", archived: true };
    } else if (path === `/print-requests/${draft.id}`) {
      state.detailReads++;
      if (!state.allowDetail) {
        await route.fulfill({
          status: 503,
          json: { message: "Состав временно недоступен" },
        });
        return;
      }
      value = draft;
    } else if (path.endsWith("/resolved")) value = resolveDraft(draft);
    else if (path.endsWith("/validate")) value = { valid: true, errors: [] };
    await route.fulfill({ json: value });
  });
  return state;
}

test("lost creation response can be retried after reload without changing body or idempotency key", async ({
  page,
}) => {
  const state = await fixture(page, { loseCreate: true });
  await page.goto("/requests/new");
  await page.getByRole("radio", { name: "Организация", exact: true }).check();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Повторить создание" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("radio", { name: "Организация", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("radio", { name: "Физическое лицо", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Повторить создание" }).click();
  await expect(page).toHaveURL(/\/requests\/request-recovery\/edit$/);
  expect(state.creations).toHaveLength(2);
  expect(state.creations[0].key).toMatch(/^[a-zA-Z0-9_-]{16,128}$/);
  expect(state.creations[1]).toEqual(state.creations[0]);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("demo:new-request:test-center:operator"),
    ),
  ).toBeNull();
});

test("an unconfirmed successful response retains a safe same-page retry", async ({
  page,
}) => {
  const state = await fixture(page, { malformedCreate: true });
  await page.goto("/requests/new");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(
    page.getByText("Сервер не подтвердил создание заявки.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Повторить создание" }).click();
  await expect(page).toHaveURL(/\/requests\/request-recovery\/edit$/);
  expect(state.creations[1]).toEqual(state.creations[0]);
});

test("registry expands real recipients on demand, recovers a read failure and links to selected employee", async ({
  page,
}, testInfo) => {
  const state = await fixture(page, { failDetail: true });
  await page.goto("/requests");
  const expand = page.getByRole("button", {
    name: "Показать состав заявки «Группа после обучения»",
  });
  await expect(expand).toHaveText("2 · Состав");
  const overview = page.locator(".printing-overview");
  await overview.locator(":scope > summary").click();
  await expect(
    overview
      .locator("dl > div")
      .filter({ has: page.getByText("Всего заявок", { exact: true }) })
      .locator("dd"),
  ).toHaveText("1");
  await expect(
    overview
      .locator("dl > div")
      .filter({
        has: page.getByText("Подготовленных версий документов", {
          exact: true,
        }),
      })
      .locator("dd"),
  ).toHaveText("0");
  await expect(
    page.getByRole("button", { name: "PDF последнего выпуска" }),
  ).toHaveCount(0);
  expect(state.detailReads).toBe(0);
  await expand.click();
  await expect(
    page.getByRole("button", { name: "Повторить загрузку состава" }),
  ).toBeVisible();
  state.allowDetail = true;
  await page
    .getByRole("button", { name: "Повторить загрузку состава" })
    .click();
  const composition = page.getByRole("table", {
    name: "Состав заявки",
    exact: true,
  });
  await expect(composition.getByRole("row")).toHaveCount(3);
  await expect(composition.getByText("Инженер", { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("registry-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("registry-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await composition.getByRole("link", { name: "Тестовая Анна" }).click();
  await expect(page).toHaveURL(/\?recipient=person-two$/);
  await expect(page.locator('[data-recipient-id="person-two"]')).toHaveClass(
    /active/,
  );
});

test("failed registry export retries the export instead of reloading the list", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/requests");
  await expect(page.getByText("Всего: 1", { exact: true })).toBeVisible();
  const before = state.listReads;
  await page.getByRole("button", { name: "Реестр XLSX", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Повторить экспорт" }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Повторить экспорт" }).click();
  await download;
  expect(state.exports).toBe(2);
  expect(state.listReads).toBe(before);
  await expect(
    page.getByText("Не удалось подготовить реестр", { exact: true }),
  ).toHaveCount(0);
});

test("empty archive explains where completed documents appear", async ({
  page,
}) => {
  await fixture(page, { empty: true });
  await page.goto("/history");
  await expect(
    page.getByRole("heading", { name: "В архиве пока нет документов" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Создать первую заявку" }),
  ).toHaveCount(0);
});

test("director can record paper signatures, recover failure with entered data, and never sees a false verified EDS status", async ({
  page,
}) => {
  const state = await fixture(page, { paper: true });
  await page.goto("/requests/request-recovery");
  const section = page
    .locator("details.panel")
    .filter({ has: page.locator(".signing-panel") });
  await section.locator(":scope > summary").click();
  const panel = section.locator(".signing-panel");
  await panel
    .getByText("Оформить с подписями на бумаге", { exact: true })
    .click();
  const form = panel.locator(".paper-document-signature");
  const names =
    "Тестовый Директор\nТестовый Председатель\nТестовый Преподаватель";
  await form.getByLabel("Дата подписания", { exact: true }).fill("2026-11-04");
  await form
    .getByLabel(
      "ФИО директора, председателя и преподавателя — в этом порядке, по одному в строке",
    )
    .fill(names);
  await form
    .getByLabel("Основание проверки оригинала", { exact: true })
    .fill("Проверен тестовый бумажный оригинал");
  await form
    .getByLabel("Проверены все обязательные подписи на бумажном оригинале")
    .check();
  await form
    .getByRole("button", {
      name: "Зафиксировать бумажные подписи",
      exact: true,
    })
    .click();
  await expect(
    form.getByText("Не удалось сохранить отметку", { exact: true }),
  ).toBeVisible();
  await expect(
    form.getByLabel(
      "ФИО директора, председателя и преподавателя — в этом порядке, по одному в строке",
    ),
  ).toHaveValue(names);
  await expect(form.getByLabel("Дата подписания", { exact: true })).toHaveValue(
    "2026-11-04",
  );
  await expect(
    form.getByLabel("Проверены все обязательные подписи на бумажном оригинале"),
  ).toBeChecked();
  await form
    .getByRole("button", {
      name: "Зафиксировать бумажные подписи",
      exact: true,
    })
    .click();
  await expect(
    panel.getByText("Бумажные подписи подтверждены руководителем", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(panel.getByText("ЭЦП проверена", { exact: false })).toHaveCount(
    0,
  );
  await expect(
    panel.locator("li").filter({ hasText: "оформлено на бумаге" }),
  ).toHaveCount(3);
  expect(state.paperWrites).toHaveLength(2);
  expect(state.paperWrites[1]).toEqual(state.paperWrites[0]);
  expect(state.paperWrites[1].signerNames).toEqual(names.split("\n"));
  expect(state.paperWrites[1].documentIds).toEqual(["document-paper"]);
});

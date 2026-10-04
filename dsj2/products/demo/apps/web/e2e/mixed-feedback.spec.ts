import { test, expect, type Page } from "@playwright/test";
import { documentPlan, resolveDraft } from "@demo/contracts";
import { newRecipient, type Draft } from "../lib/types";

const requestId = "mixed-feedback";
const manualDates = ["2026-09-10", "2026-09-11"];
const manualStarts = ["2026-09-01", "2026-09-02"];

async function fixture(page: Page) {
  await page.routeWebSocket(/\/_next\/webpack-hmr/, (socket) => socket.close());
  let draft: Draft = {
    id: requestId,
    revision: 0,
    status: "DRAFT",
    kind: "COMPANY",
    title: "Синтетическая смешанная заявка рабочих и ИТР",
    customerId: null,
    demoMode: true,
    schemaVersion: 2,
    commonFields: { documentDate: "2026-09-29" },
    events: [],
    items: ["Рабочий Синтетический", "Инженер Синтетический"].map(
      (name, index) => ({
        ...newRecipient(),
        id: `mixed-person-${index}`,
        fullNameRu: name,
        positionRu: index ? "Инженер" : "Монтажник",
        employeeCategory: index ? "ITR" : "WORKER",
        assignments: [],
      }),
    ),
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.slice(4);
    let value: unknown = { items: [], total: 0 };
    if (path === "/auth/session")
      value = { csrfToken: "synthetic-mixed-fixture" };
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
        profile: {
          nameRu: "Синтетический центр",
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
    else if (path === `/print-requests/${requestId}/resolved`)
      value = resolveDraft(draft);
    else if (path === `/print-requests/${requestId}`) {
      if (route.request().method() === "PATCH") {
        const body = route.request().postDataJSON();
        if (body.expectedRevision !== draft.revision) {
          await route.fulfill({
            status: 409,
            json: { message: "Конфликт редакций" },
          });
          return;
        }
        draft = { ...draft, ...body.draft, revision: draft.revision + 1 };
        value = { revision: draft.revision };
      } else value = draft;
    }
    await route.fulfill({ json: value });
  });
  await page.goto(`/requests/${requestId}/edit`);
  await expect(page.getByLabel("ФИО, строка 1", { exact: true })).toBeVisible();
  return () => draft;
}

async function selectDocumentsAndDates(page: Page, current: () => Draft) {
  for (const index of [0, 1]) {
    await page
      .getByRole("button", {
        name: new RegExp(`^Настройки обучения получателя ${index + 1}:`),
      })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Назначить обучение",
      exact: true,
    });
    await dialog
      .getByRole("checkbox", { name: /^Безопасность и охрана труда/ })
      .check();
    await dialog
      .getByRole("button", {
        name: "Добавить обучение и комплект",
        exact: true,
      })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => current().items[index].assignments.length).toBe(2);
    await page
      .getByRole("button", {
        name: `Детали получателя ${index + 1}`,
        exact: true,
      })
      .click();
    await page.getByRole("tab", { name: /^Документы/ }).click();
    await page
      .getByRole("dialog")
      .getByLabel("Дата документа", { exact: true })
      .first()
      .fill(manualDates[index]);
    await page
      .getByRole("dialog")
      .getByText("Период обучения, протокол и срок действия", { exact: true })
      .first()
      .click();
    await page
      .getByRole("dialog")
      .getByLabel("Начало обучения", { exact: true })
      .first()
      .fill(manualStarts[index]);
    await expect
      .poll(() => current().items[index].assignments[0].documentDate)
      .toBe(manualDates[index]);
    await page
      .getByRole("button", { name: "Вернуться к списку", exact: true })
      .click();
  }
}

function assertMixedAssignments(draft: Draft) {
  expect(draft.kind).toBe("COMPANY");
  expect(draft.items).toHaveLength(2);
  for (const [index, templateId] of [
    "biot-worker-card",
    "biot-itr-certificate",
  ].entries()) {
    expect(draft.items[index].assignments).toHaveLength(2);
    expect(draft.items[index].assignments[0]).toMatchObject({
      templateId,
      biotCategory: index ? "OHS_SPECIALIST_SPECIAL" : "WORKER",
      documentDate: manualDates[index],
      trainingStart: manualStarts[index],
      fieldOrigins: { documentDate: "MANUAL", trainingStart: "MANUAL" },
    });
  }
}

test("one company request saves workers and ITR with separate forms, categories and manual dates", async ({
  page,
}) => {
  const current = await fixture(page);
  await selectDocumentsAndDates(page, current);
  assertMixedAssignments(current());
  const saved = structuredClone(current().items);
  await page.reload();
  await expect(page.getByLabel("ФИО, строка 1", { exact: true })).toBeVisible();
  for (const [index, category] of ["WORKER", "ITR"].entries()) {
    const row = page.locator(`[data-recipient-id="mixed-person-${index}"]`);
    await expect(
      row.getByRole("button", { name: /^Настройки обучения/ }),
    ).toContainText("БиОТ");
    await expect(
      row.getByRole("combobox", { name: /^Категория сотрудника/ }),
    ).toHaveValue(category);
    await page
      .getByRole("button", {
        name: `Детали получателя ${index + 1}`,
        exact: true,
      })
      .click();
    await page.getByRole("tab", { name: /^Документы/ }).click();
    await expect(
      page
        .getByRole("dialog")
        .getByLabel("Дата документа", { exact: true })
        .first(),
    ).toHaveValue(manualDates[index]);
    await expect(
      page
        .getByRole("dialog")
        .getByRole("combobox", {
          name: "Категория обучения БиОТ",
          exact: true,
        })
        .first(),
    ).toHaveValue(index ? "OHS_SPECIALIST_SPECIAL" : "WORKER");
    await page
      .getByRole("button", { name: "Вернуться к списку", exact: true })
      .click();
  }
  expect(current().items).toEqual(saved);
  expect(current().events).toHaveLength(2);
});

test("a mixed request joins existing documents to separate compatible group protocols without duplicates", async ({
  page,
}) => {
  const current = await fixture(page);
  await selectDocumentsAndDates(page, current);
  const assignmentIds = current().items.map(
    (person) => person.assignments[0].id,
  );
  const eventIds = current().events!.map((event) => event.id);
  await page.locator("#request-training > summary").click();
  for (const [index, title] of ["БиОТ · рабочие", "БиОТ · ИТР"].entries()) {
    const protocol = page.getByRole("combobox", {
      name: new RegExp(`^Протокол:.*(?:${index ? "ITR|ИТР" : "WORKER|рабоч"})`, "i"),
    });
    // Mode changes are explicit on the existing event; they preserve assignment IDs and manual dates.
    await protocol.selectOption("GROUP");
    await expect
      .poll(() => current().items[index].assignments[0].protocolMode)
      .toBe("GROUP");
    await page
      .getByRole("button", {
        name: new RegExp(`^Настройки обучения получателя ${index + 1}:`),
      })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Назначить обучение",
      exact: true,
    });
    await dialog
      .getByRole("checkbox", { name: /^Безопасность и охрана труда/ })
      .check();
    await dialog
      .getByRole("button", {
        name: "Добавить обучение и комплект",
        exact: true,
      })
      .click();
    await expect(dialog).toHaveCount(0);
    // A GROUP protocol is a virtual event document, so the row retains only
    // its credential. Repeating the choice must not restore a redundant
    // individual protocol or replace the original event identity.
    expect(current().items[index].assignments).toHaveLength(1);
    expect(current().events).toHaveLength(2);
    expect(current().events!.map((event) => event.id)).toEqual(eventIds);
    expect(title).toBeTruthy();
  }
  await page.reload();
  await expect(page.getByLabel("ФИО, строка 1", { exact: true })).toBeVisible();
  const draft = current();
  expect(draft.kind).toBe("COMPANY");
  expect(draft.items).toHaveLength(2);
  for (const [index, person] of draft.items.entries()) {
    expect(person.assignments).toHaveLength(1);
    expect(person.assignments[0]).toMatchObject({
      documentDate: manualDates[index],
      trainingStart: manualStarts[index],
      fieldOrigins: { documentDate: "MANUAL", trainingStart: "MANUAL" },
    });
  }
  expect(draft.events).toHaveLength(2);
  expect(draft.events!.map((event) => event.id)).toEqual(eventIds);
  expect(draft.events!.map((event) => event.protocolTemplateId)).toEqual([
    "biot-protocol",
    "biot-itr-protocol",
  ]);
  for (const [index, person] of draft.items.entries()) {
    expect(person.assignments[0]).toMatchObject({
      id: assignmentIds[index],
      protocolMode: "GROUP",
      eventId: draft.events![index].id,
      outcome: { status: "UNKNOWN" },
    });
  }
  const plan = documentPlan(resolveDraft(draft).draft);
  expect(plan.groups).toHaveLength(2);
  expect(plan.groups.map((group) => group.members.length)).toEqual([1, 1]);
  expect(new Set(plan.groups.map((group) => group.event.id)).size).toBe(2);
  await page.screenshot({
    path: test.info().outputPath("mixed-workers-itr.png"),
    fullPage: true,
  });
});

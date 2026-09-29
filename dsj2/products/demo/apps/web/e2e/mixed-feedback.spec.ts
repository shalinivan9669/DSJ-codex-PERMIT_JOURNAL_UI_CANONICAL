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
  await expect(
    page.getByLabel("ФИО RU, строка 1", { exact: true }),
  ).toBeVisible();
  return () => draft;
}

async function selectDocumentsAndDates(page: Page, current: () => Draft) {
  for (const [index, label] of [
    "БиОТ — удостоверение рабочего",
    "БиОТ — сертификат ИТР",
  ].entries()) {
    await page
      .getByRole("button", {
        name: `Выбрать документы получателя ${index + 1}`,
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Выбрать документы",
      exact: true,
    });
    await dialog
      .getByRole("checkbox", { name: new RegExp(`^${label}`) })
      .check();
    await dialog
      .getByRole("button", {
        name: "Добавить выбранные документы",
        exact: true,
      })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => current().items[index].assignments.length).toBe(1);
    await page
      .getByRole("button", {
        name: `Документы и даты получателя ${index + 1}`,
        exact: true,
      })
      .click();
    await page
      .getByLabel("Дата документа", { exact: true })
      .fill(manualDates[index]);
    await page
      .getByText("Период обучения, протокол и срок действия", { exact: true })
      .click();
    await page
      .getByLabel("Начало обучения", { exact: true })
      .fill(manualStarts[index]);
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect
      .poll(() => current().items[index].assignments[0].documentDate)
      .toBe(manualDates[index]);
    await page
      .getByRole("button", { name: "Вернуться к таблице", exact: true })
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
    expect(draft.items[index].assignments).toHaveLength(1);
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
  await expect(
    page.getByLabel("ФИО RU, строка 1", { exact: true }),
  ).toBeVisible();
  for (const [index, chip] of ["БиОТ · рабочий", "БиОТ · ИТР"].entries()) {
    const row = page.locator(`[data-recipient-id="mixed-person-${index}"]`);
    await expect(row.getByText(chip, { exact: true })).toBeVisible();
    await page
      .getByRole("button", {
        name: `Документы и даты получателя ${index + 1}`,
        exact: true,
      })
      .click();
    await expect(
      page.getByLabel("Дата документа", { exact: true }),
    ).toHaveValue(manualDates[index]);
    await expect(
      page.getByRole("combobox", {
        name: "Категория обучения БиОТ",
        exact: true,
      }),
    ).toHaveValue(index ? "OHS_SPECIALIST_SPECIAL" : "WORKER");
    await page
      .getByRole("button", { name: "Вернуться к таблице", exact: true })
      .click();
  }
  expect(current().items).toEqual(saved);
  expect(current().events).toEqual([]);
});

test("a mixed request joins existing documents to separate compatible group protocols without duplicates", async ({
  page,
}) => {
  const current = await fixture(page);
  await selectDocumentsAndDates(page, current);
  const assignmentIds = current().items.map(
    (person) => person.assignments[0].id,
  );
  await page
    .getByRole("button", { name: "Настроить даты и протоколы", exact: true })
    .click();
  await page
    .getByRole("checkbox", {
      name: /^Присоединить к событию существующее назначение/,
    })
    .check();
  for (const [index, direction] of ["biot", "biot-itr"].entries()) {
    if (index)
      await page.getByLabel("Выбрать строку 1", { exact: true }).uncheck();
    await page
      .getByLabel(`Выбрать строку ${index + 1}`, { exact: true })
      .check();
    await page
      .getByRole("combobox", {
        name: "Направление нового события",
        exact: true,
      })
      .selectOption(direction);
    await page
      .getByRole("button", { name: "Добавить событие", exact: true })
      .click();
    await expect.poll(() => current().events?.length).toBe(index + 1);
    const assign = page.getByRole("button", {
      name: "Назначить набор выбранным (1)",
      exact: true,
    });
    await assign.click();
    await expect
      .poll(() => current().items[index].assignments[0].protocolMode)
      .toBe("GROUP");
    await expect(assign).toBeEnabled();
    await assign.click();
    await expect(assign).toBeEnabled();
    expect(current().items[index].assignments).toHaveLength(1);
  }
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await page.reload();
  await expect(
    page.getByLabel("ФИО RU, строка 1", { exact: true }),
  ).toBeVisible();
  const draft = current();
  assertMixedAssignments(draft);
  expect(draft.events).toHaveLength(2);
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

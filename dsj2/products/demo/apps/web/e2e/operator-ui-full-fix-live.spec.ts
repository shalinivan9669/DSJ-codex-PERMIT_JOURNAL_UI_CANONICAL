import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { draftPayload, newRecipient, type Draft } from "../lib/types";
import { documentPlan, trainingDirection } from "@demo/contracts";
import { assignTrainingBundle } from "../lib/request-bundles";
import {
  keyboardFocus,
  openRecipientExtraTools,
} from "./operator-keyboard-helpers";

import { loginIsolated } from "./operator-full-fix-session";
import {
  fullSuitePageApiCooldown,
  fullSuiteRunId,
} from "./operator-full-suite";

test.use({ trace: "off" });

const evidenceRoot = process.env.DEMO_E2E_EVIDENCE
  ? path.join(path.resolve(process.env.DEMO_E2E_EVIDENCE), "ui")
  : path.resolve(
      __dirname,
      "../../../docs/evidence/operator-flow-full-fix-20261003/ui",
    );
const login = loginIsolated;
async function create(
  page: Page,
  headers: Record<string, string>,
  count = 3,
  extra: Record<string, unknown> = {},
) {
  const response = await page.request.post("/api/print-requests", {
    headers,
    data: {
      kind: "PERSON",
      title: `СИНТЕТИЧЕСКАЯ UX UI ${Date.now()}`,
      customerId: null,
      demoMode: true,
      schemaVersion: 2,
      commonFields: { documentDate: "2026-10-03" },
      items: Array.from({ length: count }, () => ({
        ...newRecipient(),
        assignments: [],
      })),
      ...extra,
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as Draft;
}
async function read(page: Page, id: string) {
  const response = await page.request.get(`/api/print-requests/${id}`);
  const errorBody = response.ok() ? "" : (await response.text()).slice(0, 2000);
  expect(
    response.ok(),
    `GET current draft HTTP ${response.status()}: ${errorBody}`,
  ).toBe(true);
  return (await response.json()) as Draft;
}
async function saved(page: Page) {
  await expect(page.locator(".save-indicator")).toContainText(
    /сохранена.*редакция/,
  );
}
async function evidence(page: Page, name: string, data: unknown) {
  await fs.mkdir(evidenceRoot, { recursive: true });
  await page.screenshot({ path: path.join(evidenceRoot, `${name}.png`) });
  await fs.writeFile(
    path.join(evidenceRoot, `${name}.json`),
    JSON.stringify(data, null, 2),
  );
}
async function geometry(page: Page) {
  return page
    .locator(".operator-grid tr[data-recipient-id]")
    .first()
    .evaluate((row) =>
      Array.from(
        row.querySelectorAll(
          "input:not([type=checkbox]),select,.recipient-grid-training-button",
        ),
      )
        .filter((input) => {
          const field = input.getAttribute("data-field-path") || "";
          return (
            input.classList.contains("recipient-grid-training-button") ||
            /\.(fullNameRu|fullNameKz|positionRu|positionKz|employeeCategory)$/.test(
              field,
            ) ||
            /\.assignments\.\d+\.documentDate$/.test(field) ||
            input.getAttribute("aria-label")?.startsWith("Дата выдачи,")
          );
        })
        .map((input) => ({
          label: input.getAttribute("aria-label"),
          offset:
            input.getBoundingClientRect().top - row.getBoundingClientRect().top,
        })),
    );
}

test("UX02/05/12/16 explicit common training, hidden selections, next recipients and persistent row chooser", async ({
  page,
}) => {
  test.setTimeout(480000);
  await fullSuitePageApiCooldown(page, evidenceRoot, "before-common-chooser");
  const headers = await login(page);
  const directionAssignments = (
    draft: Draft,
    row: number,
    direction: "BIOT" | "PTM" | "PB" | "PS",
  ) =>
    draft.items[row].assignments.filter(
      (entry) => trainingDirection(entry.templateId) === direction,
    );
  const rows = page.locator(".operator-grid tr[data-recipient-id]").filter({
    has: page.locator('input[type="checkbox"][aria-label^="Выбрать строку "]'),
  });
  const committed = async (
    id: string,
    predicate: (draft: Draft) => boolean,
  ) => {
    await expect
      .poll(async () => predicate(await read(page, id)), {
        intervals: [1000],
        timeout: 20000,
      })
      .toBe(true);
    await saved(page);
    return read(page, id);
  };
  const listTools = page.locator(".operator-list-tools");
  const showListTools = async () => {
    if (
      !(await listTools.evaluate(
        (element) => (element as HTMLDetailsElement).open,
      ))
    )
      await listTools.locator(":scope > summary").click();
  };
  const chip = (label: string) =>
    page
      .locator(".request-training-chip")
      .filter({ hasText: new RegExp(`^${label}`) });
  const state = (label: string) => chip(label).locator("..");
  const color = (label: string) =>
    chip(label).evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        color: style.color,
        background: style.backgroundColor,
        border: style.borderColor,
        borderStyle: style.borderStyle,
        opacity: style.opacity,
      };
    });
  const chooser = (row: number) =>
    page.getByRole("button", {
      name: new RegExp(`^Настройки обучения получателя ${row}:`),
    });
  const trainingDialog = page.getByRole("dialog", {
    name: "Назначить обучение",
    exact: true,
  });
  const addFromChooser = async (row: number, label: string) => {
    await chooser(row).click();
    await expect(trainingDialog).toBeVisible();
    await trainingDialog.getByLabel(label, { exact: false }).check();
    const protocolMode = trainingDialog.getByRole("combobox", {
      name: /^Протокол при добавлении/,
    });
    await expect(protocolMode).toHaveCount(1);
    await protocolMode.selectOption("INDIVIDUAL");
    await trainingDialog
      .getByRole("button", {
        name: "Добавить обучение и комплект",
        exact: true,
      })
      .click();
    await expect(trainingDialog).toHaveCount(0);
  };
  const removal = page.getByRole("dialog", {
    name: "Снять обучение у этой группы?",
    exact: true,
  });

  await page.goto("/requests/new");
  await expect(
    page.getByText("Физическое лицо", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Организация", { exact: true })).toBeVisible();
  await expect(page.locator("main input:not([type=radio])")).toHaveCount(0);

  // A genuinely empty request disables commands because it has no recipients.
  const empty = await create(page, headers, 0);
  await page.goto(`/requests/${empty.id}/edit`);
  await expect(rows).toHaveCount(0);
  await expect(page.locator(".request-training-chip")).toHaveCount(4);
  for (const button of await page.locator(".request-training-chip").all())
    await expect(button).toBeDisabled();
  await expect(
    page.getByText("Сначала добавьте участника.", { exact: true }),
  ).toBeVisible();
  const noRecipients = await read(page, empty.id);
  expect(noRecipients.items).toHaveLength(0);

  // Three empty kits show enabled NONE; choosing again always opens the same picker.
  const small = await create(page, headers, 3);
  await page.goto(`/requests/${small.id}/edit`);
  await expect(rows).toHaveCount(3);
  for (const label of ["БиОТ", "ПТМ", "ПБ", "ПС"]) {
    await expect(state(label)).toHaveAttribute("data-state", "none");
    await expect(chip(label)).toBeEnabled();
  }
  const noneColor = await color("БиОТ");
  await expect(
    page.getByLabel("Дата выдачи, строка 1", { exact: true }),
  ).toBeDisabled();
  await evidence(page, "empty-before-training", {
    noRecipients,
    emptyKits: await read(page, small.id),
    noneColor,
  });
  await addFromChooser(1, "Безопасность и охрана труда");
  await committed(
    small.id,
    (draft) => directionAssignments(draft, 0, "BIOT").length === 2,
  );
  await addFromChooser(1, "Пожарно-технический минимум");
  await committed(
    small.id,
    (draft) => directionAssignments(draft, 0, "PTM").length === 2,
  );
  await chooser(1).click();
  await expect(
    trainingDialog.getByRole("button", { name: "Снять БиОТ · 1", exact: true }),
  ).toBeVisible();
  await expect(
    trainingDialog.getByRole("button", { name: "Снять ПТМ · 1", exact: true }),
  ).toBeVisible();
  await trainingDialog
    .getByRole("button", { name: "Закрыть диалог", exact: true })
    .click();

  // Real manual facts make removal a reviewable operation. Cancel must not write.
  await page
    .getByLabel("Дата выдачи, строка 1", { exact: true })
    .fill("2026-10-04");
  await page
    .getByRole("button", { name: "Детали получателя 1", exact: true })
    .click();
  const details = page.getByRole("dialog");
  const biotFields = details.locator(".assignment-list > details").first();
  await biotFields
    .getByRole("tab", { name: "Обучение и результат", exact: true })
    .click();
  await biotFields
    .getByLabel("Программа / тема обучения", { exact: true })
    .fill("СИНТЕТИЧЕСКАЯ ручная программа сохранения исходных данных");
  await details
    .getByRole("button", { name: "Вернуться к списку", exact: true })
    .click();
  const partialBefore = await committed(small.id, (draft) =>
    draft.items[0].assignments[0].trainingSubject.includes("ручная программа"),
  );
  await expect(state("БиОТ")).toHaveAttribute("data-state", "partial");
  await expect(chip("БиОТ")).toHaveAccessibleName(
    "БиОТ: добавить остальным (2)",
  );
  await expect(chip("БиОТ")).toHaveAttribute("title", /1 из 3/);
  const partialColor = await color("БиОТ");
  expect(partialColor.borderStyle).toBe("dashed");
  expect(partialColor.border).not.toBe(noneColor.border);
  await page
    .getByRole("button", { name: "БиОТ: снять у этой группы (1)", exact: true })
    .click();
  await expect(removal).toContainText("1 получателей");
  await removal
    .getByRole("button", { name: "Оставить обучение", exact: true })
    .click();
  await expect(removal).toHaveCount(0);
  const canceled = await read(page, small.id);
  expect(canceled.revision).toBe(partialBefore.revision);
  expect(canceled.items).toEqual(partialBefore.items);
  expect(canceled.events).toEqual(partialBefore.events);
  await chip("БиОТ").press("Enter");
  const complete = await committed(small.id, (draft) =>
    draft.items.every((item) =>
      item.assignments.some((entry) => entry.templateId === "biot-worker-card"),
    ),
  );
  await expect(state("БиОТ")).toHaveAttribute("data-state", "all");
  await expect(chip("БиОТ")).toHaveAccessibleName(
    "БиОТ: снять у этой группы (3)",
  );
  await expect(chip("БиОТ")).toBeEnabled();
  const allColor = await color("БиОТ");
  expect(allColor.background).not.toBe(noneColor.background);
  expect(allColor.opacity).toBe("1");
  expect(directionAssignments(complete, 0, "BIOT")).toEqual(
    directionAssignments(partialBefore, 0, "BIOT"),
  );
  expect(directionAssignments(complete, 0, "PTM")).toEqual(
    directionAssignments(partialBefore, 0, "PTM"),
  );

  // Remove a single person's direction from that person's persistent chooser,
  // reopen without a bulk selection, and restore the same IDs and manual facts.
  await chooser(1).click();
  await trainingDialog
    .getByRole("button", { name: "Снять БиОТ · 1", exact: true })
    .click();
  await expect(removal).toBeVisible();
  await removal
    .getByRole("button", {
      name: "Снять обучение у 1 получателей",
      exact: true,
    })
    .click();
  const removedOne = await committed(
    small.id,
    (draft) => directionAssignments(draft, 0, "BIOT").length === 0,
  );
  expect(directionAssignments(removedOne, 0, "PTM")).toEqual(
    directionAssignments(complete, 0, "PTM"),
  );
  expect(removedOne.items.slice(1)).toEqual(complete.items.slice(1));
  await chooser(1).click();
  await expect(
    trainingDialog.getByRole("button", { name: "Снять БиОТ · 1", exact: true }),
  ).toHaveCount(0);
  await expect(
    trainingDialog.getByRole("button", { name: "Снять ПТМ · 1", exact: true }),
  ).toBeVisible();
  await trainingDialog
    .getByRole("button", { name: "Закрыть диалог", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Восстановить обучение", exact: true })
    .click();
  const restored = await committed(
    small.id,
    (draft) => JSON.stringify(draft.items) === JSON.stringify(complete.items),
  );
  expect(restored.events).toEqual(complete.events);
  await page.reload();
  await expect(chip("БиОТ")).toBeEnabled();
  expect((await read(page, small.id)).items).toEqual(complete.items);
  await page
    .getByLabel("Категория сотрудника, строка 1", { exact: true })
    .selectOption("ITR");
  const categoryChanged = await committed(
    small.id,
    (draft) =>
      draft.items[0].employeeCategory === "ITR" &&
      draft.items[0].assignments.some(
        (entry) => entry.templateId === "biot-itr-certificate",
      ),
  );
  expect(categoryChanged.items.slice(1)).toEqual(restored.items.slice(1));
  // The agreed LIVE policy derives every non-PS validity from the person's
  // category: one year for WORKER, three for ITR. Preserve all other PTM facts.
  expect(categoryChanged.businessRuleVersion).toBe("LIVE_V1");
  const ptmBeforeCategory = directionAssignments(restored, 0, "PTM");
  expect(ptmBeforeCategory).toHaveLength(2);
  for (const assignment of ptmBeforeCategory) {
    expect(assignment.documentDate).toBe("2026-10-04");
    expect(assignment.validUntil).toBe("2027-10-04");
    expect(assignment.validityMode).toBe("FIXED");
    expect(assignment.fieldOrigins?.validUntil).toBe("AUTO");
  }
  const expectedPtmAfterCategory = ptmBeforeCategory.map((assignment) => ({
    ...assignment,
    validUntil: "2029-10-04",
  }));
  expect(directionAssignments(categoryChanged, 0, "PTM")).toEqual(
    expectedPtmAfterCategory,
  );
  await chooser(1).click();
  await expect(trainingDialog).toContainText("Сейчас назначено 1 из 1 · всем.");
  await expect(
    trainingDialog.getByRole("checkbox", { name: /^Безопасность и охрана труда/ }),
  ).toBeChecked();
  await expect(
    trainingDialog.getByRole("button", { name: "Снять БиОТ · 1", exact: true }),
  ).toBeVisible();
  await evidence(page, "assigned-training-chooser", {
    partialBefore,
    canceled,
    complete,
    removedOne,
    restored,
    categoryChanged,
    categoryAutoValidityChange: {
      from: "WORKER",
      to: "ITR",
      documentDate: "2026-10-04",
      before: "2027-10-04",
      after: "2029-10-04",
      origin: "AUTO",
      onlyChangedPtmField: "validUntil",
      allOtherPtmFactsPreserved: true,
    },
    noneColor,
    partialColor,
    allColor,
  });
  await trainingDialog
    .getByRole("button", { name: "Закрыть диалог", exact: true })
    .click();

  const draft = await create(page, headers, 10, {
    items: Array.from({ length: 10 }, (_, index) => ({
      ...newRecipient(),
      fullNameRu: `Синтетический Область ${String(index + 1).padStart(2, "0")}`,
      employeeCategory: index === 9 ? "ITR" : "WORKER",
      assignments: [],
    })),
  });
  await page.goto(`/requests/${draft.id}/edit`);
  await showListTools();
  const search = page.getByLabel("Поиск в заявке", { exact: true });
  await search.fill("Область 01");
  await expect(rows).toHaveCount(1);
  await expect(
    page.getByRole("group", {
      name: "Добавить обучение всем в заявке участникам",
      exact: true,
    }),
  ).toContainText("Все 10 в заявке");
  await page
    .getByRole("button", {
      name: "БиОТ: добавить всем в заявке (10)",
      exact: true,
    })
    .click();
  const commonBiot = await committed(draft.id, (current) =>
    current.items.every((item) =>
      item.assignments.some(
        (entry) => trainingDirection(entry.templateId) === "BIOT",
      ),
    ),
  );
  expect(
    commonBiot.trainingDefaults?.find((entry) => entry.direction === "BIOT")
      ?.eventIds,
  ).toHaveLength(2);
  expect(commonBiot.items[9].assignments[0].templateId).toBe(
    "biot-itr-certificate",
  );

  await page.getByLabel("Выбрать строку 1", { exact: true }).check();
  await search.fill("Область 02");
  await expect(rows).toHaveCount(1);
  await expect(page.locator(".request-training-scope")).toContainText(
    "Отмеченные 1, скрытых фильтрами 1",
  );
  const visible = page.getByLabel("Выбрать видимых получателей", {
    exact: true,
  });
  await visible.check();
  await expect(page.locator(".selection-toolbar")).toContainText(
    "Выбрано: 2, из них скрыто фильтрами: 1",
  );
  await visible.uncheck();
  await expect(page.locator(".request-training-scope")).toContainText(
    "Отмеченные 1, скрытых фильтрами 1",
  );
  await visible.check();
  await expect(
    page.getByLabel("Выбрать строку 2", { exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("button", {
      name: "ПТМ: добавить отмеченным (2)",
      exact: true,
    }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "ПТМ: добавить отмеченным (2)", exact: true })
    .click();
  const selectedOnly = await committed(
    draft.id,
    (current) =>
      current.items.filter((item) =>
        item.assignments.some(
          (entry) => trainingDirection(entry.templateId) === "PTM",
        ),
      ).length === 2,
  );
  expect(
    selectedOnly.trainingDefaults?.some((entry) => entry.direction === "PTM"),
  ).toBe(false);
  expect(selectedOnly.items.slice(2)).toEqual(commonBiot.items.slice(2));
  await expect(chip("ПТМ")).toHaveAccessibleName(
    "ПТМ: снять у этой группы (2)",
  );
  await evidence(page, "partial-training-hidden-scope", {
    commonBiot,
    selectedOnly,
    visible: 1,
    selected: 2,
    hiddenSelected: 1,
    scopeText: await page.locator(".request-training-scope").innerText(),
    countText: await page.locator(".selection-toolbar [aria-live]").innerText(),
  });
  await page
    .getByRole("button", { name: "Снять выделение строк", exact: true })
    .click();
  await expect(page.locator(".request-training-scope")).toContainText(
    "Все 10 в заявке",
  );
  await expect(chip("ПТМ")).toHaveAccessibleName("ПТМ: добавить остальным (8)");
  await search.clear();
  await expect(rows).toHaveCount(10);
  expect(
    await rows.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-recipient-id")),
    ),
  ).toEqual(commonBiot.items.map((item) => item.id));
  await expect(
    page.getByLabel("Выбрать строку 1", { exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByLabel("Выбрать строку 2", { exact: true }),
  ).not.toBeChecked();

  await page
    .getByRole("button", { name: "Добавить строку", exact: true })
    .click();
  const newWorker = await committed(
    draft.id,
    (current) => current.items.length === 11,
  );
  expect(newWorker.items[10].employeeCategory).toBe("WORKER");
  expect(newWorker.items[10].assignments[0].templateId).toBe(
    "biot-worker-card",
  );
  expect(directionAssignments(newWorker, 10, "PTM")).toHaveLength(0);
  await page
    .getByLabel("Категория сотрудника, строка 11", { exact: true })
    .selectOption("ITR");
  const newItr = await committed(draft.id, (current) =>
    current.items[10].assignments.some(
      (entry) => entry.templateId === "biot-itr-certificate",
    ),
  );
  // Correcting an existing worker keeps that training's lineage. A similar
  // independent ITR event is not consent to move the person's course.
  const workerEventId = newWorker.items[10].assignments[0].eventId;
  const correctedItrEvent = newItr.events?.find(
    (event) => event.id === newItr.items[10].assignments[0].eventId,
  );
  expect(correctedItrEvent).toMatchObject({
    id: `${workerEventId}-ITR`,
    rootEventId: workerEventId,
    derivedCategory: "ITR",
    protocolTemplateId: "biot-itr-protocol",
  });
  expect(newItr.items[10].assignments[0].templateId).toBe(
    "biot-itr-certificate",
  );
  expect(
    newItr.events?.filter((event) => event.id !== correctedItrEvent?.id),
  ).toEqual(newWorker.events);
  expect(newItr.trainingDefaults).toEqual(newWorker.trainingDefaults);
  expect(directionAssignments(newItr, 10, "PTM")).toHaveLength(0);
  expect(newItr.items.slice(0, 10)).toEqual(newWorker.items.slice(0, 10));

  await page.getByLabel("Выбрать строку 1", { exact: true }).check();
  await page
    .getByRole("button", { name: "БиОТ: снять у этой группы (1)", exact: true })
    .click();
  const singleRemoved = await committed(
    draft.id,
    (current) => directionAssignments(current, 0, "BIOT").length === 0,
  );
  expect(
    singleRemoved.trainingDefaults?.some((entry) => entry.direction === "BIOT"),
  ).toBe(true);
  expect(directionAssignments(singleRemoved, 0, "PTM")).toEqual(
    directionAssignments(newItr, 0, "PTM"),
  );
  await page
    .getByRole("button", { name: "Снять выделение строк", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Добавить строку", exact: true })
    .click();
  const afterSingleRemoval = await committed(
    draft.id,
    (current) => current.items.length === 12,
  );
  expect(afterSingleRemoval.items[11].assignments[0].templateId).toBe(
    "biot-worker-card",
  );
  await page
    .getByRole("button", {
      name: "БиОТ: снять у этой группы (11)",
      exact: true,
    })
    .click();
  const allRemoved = await committed(draft.id, (current) =>
    current.items.every(
      (item) =>
        !item.assignments.some(
          (entry) => trainingDirection(entry.templateId) === "BIOT",
        ),
    ),
  );
  expect(
    allRemoved.trainingDefaults?.some((entry) => entry.direction === "BIOT"),
  ).toBe(false);
  await page
    .getByRole("button", { name: "Добавить строку", exact: true })
    .click();
  const afterAllRemoval = await committed(
    draft.id,
    (current) => current.items.length === 13,
  );
  expect(afterAllRemoval.items[12].assignments).toHaveLength(0);
  await expect(chip("БиОТ")).toHaveAccessibleName(
    "БиОТ: добавить всем в заявке (13)",
  );
  await chip("ПТМ").click();
  const allPtm = await committed(draft.id, (current) =>
    current.items.every((item) =>
      item.assignments.some(
        (entry) => trainingDirection(entry.templateId) === "PTM",
      ),
    ),
  );
  expect(directionAssignments(allPtm, 0, "PTM")).toEqual(
    directionAssignments(selectedOnly, 0, "PTM"),
  );
  expect(directionAssignments(allPtm, 1, "PTM")).toEqual(
    directionAssignments(selectedOnly, 1, "PTM"),
  );
  expect(
    allPtm.trainingDefaults?.some((entry) => entry.direction === "PTM"),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Добавить строку", exact: true })
    .click();
  const afterCommonPtm = await committed(
    draft.id,
    (current) => current.items.length === 14,
  );
  expect(
    directionAssignments(afterCommonPtm, 13, "PTM").length,
  ).toBeGreaterThan(0);
  expect(directionAssignments(afterCommonPtm, 13, "BIOT")).toHaveLength(0);

  // The import preview explicitly opts out even when a common default exists.
  await openRecipientExtraTools(page);
  await page
    .getByRole("button", { name: "Импорт / вставка", exact: true })
    .click();
  const importing = page.getByRole("dialog");
  await importing
    .getByLabel("Или вставьте таблицу с заголовками", { exact: true })
    .fill(
      "ФИО RU\tКатегория сотрудника\nСинтетический Импорт Рабочий\tWORKER\nСинтетический Импорт ИТР\tITR",
    );
  await importing
    .getByRole("button", { name: "Перейти к сопоставлению", exact: true })
    .click();
  await expect(
    importing.getByRole("combobox", {
      name: "Документ для импортируемых строк",
      exact: true,
    }),
  ).toHaveValue("");
  await expect(importing).toContainText(
    "Без обучения — общий выбор заявки не применяется",
  );
  await importing
    .getByRole("button", { name: "Добавить 2 строк в черновик", exact: true })
    .click();
  await expect(importing).toHaveCount(0);
  const imported = await committed(
    draft.id,
    (current) => current.items.length === 16,
  );
  expect(imported.items.slice(-2).map((item) => item.employeeCategory)).toEqual(
    ["WORKER", "ITR"],
  );
  expect(imported.items.slice(-2).map((item) => item.assignments)).toEqual([
    [],
    [],
  ]);
  expect(imported.items.slice(0, 14)).toEqual(afterCommonPtm.items);
  await page.reload();
  const scopeReload = await read(page, draft.id);
  expect(scopeReload.items).toEqual(imported.items);
  expect(scopeReload.trainingDefaults).toEqual(imported.trainingDefaults);
  await expect(rows).toHaveCount(16);

  await page
    .getByLabel("ФИО, строка 1", { exact: true })
    .fill("Синтетический Первый");
  await page.getByLabel("ФИО, строка 1", { exact: true }).press("Enter");
  await expect(page.getByLabel("ФИО, строка 2", { exact: true })).toBeFocused();
  await page.getByLabel("ФИО, строка 2", { exact: true }).press("Shift+Enter");
  await expect(page.getByLabel("ФИО, строка 1", { exact: true })).toBeFocused();
  await page
    .getByLabel("Должность · RU, строка 1", { exact: true })
    .fill("Синтетическая должность");
  await page
    .getByLabel("Должность · RU, строка 1", { exact: true })
    .press("Enter");
  await expect(
    page.getByLabel("Должность · RU, строка 2", { exact: true }),
  ).toBeFocused();
  const date = page.getByLabel("Дата выдачи, строка 1", { exact: true });
  await date.fill("2026-10-04");
  await date.press("Enter");
  await expect(date).toBeFocused();
  await expect(date).toHaveValue("2026-10-04");
  await page.keyboard.press("Escape");
  const category = page.getByLabel("Категория сотрудника, строка 1", {
    exact: true,
  });
  await category.click();
  await category.press("Enter");
  await expect(category).toBeFocused();
  await expect(category).toHaveValue("WORKER");
  const keyboardSaved = await committed(
    draft.id,
    (current) =>
      current.items[0].fullNameRu === "Синтетический Первый" &&
      current.items[0].positionRu === "Синтетическая должность" &&
      current.items[0].assignments[0].documentDate === "2026-10-04",
  );
  await evidence(page, "scope-default-chooser", {
    commonBiot,
    selectedOnly,
    newWorker,
    newItr,
    singleRemoved,
    afterSingleRemoval,
    allRemoved,
    afterAllRemoval,
    allPtm,
    afterCommonPtm,
    imported,
    scopeReload,
    keyboardSaved,
  });

  // A fresh person whose category is already known uses the exact compatible
  // common default. This is separate from changing an assigned worker to ITR.
  await fullSuitePageApiCooldown(
    page,
    evidenceRoot,
    "before-known-category-defaults",
  );
  const knownCategories = await create(page, headers, 2, {
    items: (["WORKER", "ITR"] as const).map((employeeCategory) => ({
      ...newRecipient(),
      fullNameRu: `Синтетический Исходный ${employeeCategory}`,
      employeeCategory,
      assignments: [],
    })),
  });
  await page.goto(`/requests/${knownCategories.id}/edit`);
  await page
    .getByRole("button", {
      name: "БиОТ: добавить всем в заявке (2)",
      exact: true,
    })
    .click();
  await committed(knownCategories.id, (current) =>
    current.items.every((item) => item.assignments.length > 0),
  );
  await page.locator("#request-training > summary").click();
  for (const label of ["БиОТ — Рабочие", "БиОТ — ИТР"])
    await page
      .getByRole("combobox", { name: `Протокол: ${label}`, exact: true })
      .selectOption("INDIVIDUAL");
  const categoryDefaults = await committed(knownCategories.id, (current) =>
    current.events!.every(
      (event) =>
        event.protocolMode === "INDIVIDUAL" &&
        event.protocolModeSource === "MANUAL",
    ),
  );
  expect(
    categoryDefaults.trainingDefaults?.find(
      (entry) => entry.direction === "BIOT",
    )?.eventIds,
  ).toHaveLength(2);
  const freshKnownRecipients: unknown[] = [];
  for (const employeeCategory of ["ITR", "WORKER"] as const) {
    const freshName = `Синтетический Новая категория ${employeeCategory} ${Date.now()}`;
    const storedResponse = await page.request.post("/api/recipients", {
      headers,
      data: {
        ...newRecipient(),
        fullNameRu: freshName,
        employeeCategory,
        assignments: [],
      },
    });
    expect(storedResponse.status(), await storedResponse.text()).toBe(201);
    const stored = await storedResponse.json();
    const previous = await read(page, knownCategories.id);
    await openRecipientExtraTools(page);
    await page
      .getByRole("button", { name: "Найти человека", exact: true })
      .click();
    const picker = page.getByRole("dialog", {
      name: "Найти существующего получателя",
      exact: true,
    });
    await picker.getByLabel("Поиск по справочнику").fill(freshName);
    const resultRow = picker.getByRole("row").filter({ hasText: freshName });
    await expect(resultRow).toHaveCount(1);
    await resultRow
      .getByRole("button", { name: "Выбрать", exact: true })
      .click();
    await expect(picker).toHaveCount(0);
    const current = await committed(
      knownCategories.id,
      (value) => value.items.length === previous.items.length + 1,
    );
    const fresh = current.items.at(-1)!;
    const compatible = categoryDefaults.items.find(
      (item) => item.employeeCategory === employeeCategory,
    )!;
    expect(fresh.fullNameRu).toBe(freshName);
    expect(fresh.employeeCategory).toBe(employeeCategory);
    expect(fresh.recipientId).toBe(stored.id);
    expect(fresh.assignments[0].templateId).toBe(
      employeeCategory === "ITR" ? "biot-itr-certificate" : "biot-worker-card",
    );
    expect(fresh.assignments[0].eventId).toBe(
      compatible.assignments[0].eventId,
    );
    expect(
      fresh.assignments.every(
        (entry) => entry.outcome?.status === "UNKNOWN" && !entry.result,
      ),
    ).toBe(true);
    expect(current.items.slice(0, -1)).toEqual(previous.items);
    expect(current.events).toEqual(previous.events);
    expect(current.trainingDefaults).toEqual(categoryDefaults.trainingDefaults);
    const addedDetails = page.getByRole("dialog", {
      name: `Настройки строки ${current.items.length}`,
      exact: true,
    });
    await expect(addedDetails).toContainText(freshName);
    await expect(
      addedDetails.getByRole("combobox", {
        name: "Категория сотрудника",
        exact: true,
      }),
    ).toHaveValue(employeeCategory);
    await addedDetails
      .getByRole("button", { name: "Вернуться к списку", exact: true })
      .click();
    await expect(addedDetails).toHaveCount(0);
    freshKnownRecipients.push({ employeeCategory, stored, previous, current });
  }
  await page.reload();
  await expect(rows).toHaveCount(4);
  const knownCategoryReload = await read(page, knownCategories.id);
  expect(knownCategoryReload.items).toEqual(
    (freshKnownRecipients.at(-1) as { current: Draft }).current.items,
  );
  await evidence(page, "fresh-known-categories-defaults", {
    categoryDefaults,
    freshKnownRecipients,
    knownCategoryReload,
    correctedWorkerLineage: { newWorker, newItr },
  });

  // These API fixtures state known synthetic outcomes through the genuine
  // operator endpoint. Server confirmation metadata is never manufactured.
  if (fullSuiteRunId()) {
    await fullSuitePageApiCooldown(
      page,
      evidenceRoot,
      "before-training-counters",
    );
    await page.goto(`/requests/${knownCategories.id}/edit`);
    await expect(rows).toHaveCount(4);
    expect((await read(page, knownCategories.id)).items).toEqual(
      knownCategoryReload.items,
    );
  }
  const counters: unknown[] = [];
  const numericFixture = async (count: number, knownPb = false) => {
    let data: Draft = {
      id: "fixture",
      revision: 0,
      status: "DRAFT",
      kind: "PERSON",
      title: `СИНТЕТИЧЕСКИЕ счётчики ${count} ${knownPb} ${Date.now()}`,
      customerId: null,
      demoMode: true,
      schemaVersion: 2,
      commonFields: { documentDate: "2026-10-03" },
      items: Array.from({ length: count }, (_, index) => ({
        ...newRecipient(),
        fullNameRu: `Синтетический Счётчик ${index + 1}`,
        positionRu: "Синтетическая должность",
        workplaceRu: "Синтетическое предприятие",
        assignments: [],
      })),
    };
    for (const direction of ["PB", "PTM"] as const)
      data = assignTrainingBundle(
        data,
        data.items.map((item) => item.id),
        direction,
        "INDIVIDUAL",
      );
    if (knownPb)
      for (const item of data.items)
        for (const assignment of item.assignments)
          if (trainingDirection(assignment.templateId) === "PB") {
            assignment.outcome = {
              status: "PASSED",
              source:
                "СИНТЕТИЧЕСКАЯ известная ведомость для проверки единиц; не реальное обучение",
            };
            assignment.result = "Сдал";
          }
    const created = await create(page, headers, count, draftPayload(data));
    await page.goto(`/requests/${created.id}/edit`);
    await expect(rows).toHaveCount(count);
    await expect(page.locator(".operator-result-reminder")).toContainText(
      `Не подтверждены ${knownPb ? count : count * 2} результатов по обучениям у ${count} получателей.`,
    );
    await expect(page.locator(".operator-result-reminder")).toContainText(
      "Удостоверения, сертификаты и свидетельства",
    );
    await expect(page.locator(".operator-result-reminder")).toContainText(
      "Протоколы отражают фактические результаты, включая неподтверждённые",
    );
    const raw = await read(page, created.id);
    expect(raw.items.every((item) => item.assignments.length === 4)).toBe(true);
    const resolutionResponse = await page.request.get(
      `/api/print-requests/${created.id}/resolved`,
    );
    expect(resolutionResponse.ok(), await resolutionResponse.text()).toBe(true);
    const resolution = await resolutionResponse.json();
    const plan = documentPlan(resolution.draft);
    const kinds = plan.individuals
      .map((entry) => entry.assignment.templateId)
      .sort();
    expect(kinds).toEqual(
      Array.from({ length: count }, () =>
        knownPb
          ? ["pb-card", "pb-protocol", "ptm-protocol"]
          : ["pb-protocol", "ptm-protocol"],
      )
        .flat()
        .sort(),
    );
    expect(plan.documentCount).toBe(count * (knownPb ? 3 : 2));
    expect(
      raw.items
        .flatMap((item) => item.assignments)
        .filter((entry) => entry.outcome?.status === "UNKNOWN")
        .every(
          (entry) =>
            entry.result === "" &&
            !entry.outcome?.confirmedAt &&
            !entry.outcome?.confirmedBy,
        ),
    ).toBe(true);
    if (knownPb)
      expect(
        raw.items[0].assignments
          .filter((entry) => trainingDirection(entry.templateId) === "PB")
          .every(
            (entry) =>
              !!entry.outcome?.confirmedBy && !!entry.outcome.confirmedAt,
          ),
      ).toBe(true);
    await page.reload();
    expect((await read(page, raw.id)).items).toEqual(raw.items);
    await expect(page.locator(".operator-result-reminder")).toContainText(
      `Не подтверждены ${knownPb ? count : count * 2} результатов по обучениям у ${count} получателей.`,
    );
    const checkResponse = await page.request.post(
      `/api/print-requests/${created.id}/validate`,
      { headers, data: { expectedRevision: raw.revision } },
    );
    expect(checkResponse.ok(), await checkResponse.text()).toBe(true);
    const checked = await checkResponse.json();
    expect(checked.recipientCount).toBe(count);
    expect(checked.documentCount).toBe(plan.documentCount);
    expect(checked.protocolCount).toBe(count * 2);
    counters.push({
      requestId: raw.id,
      revision: raw.revision,
      raw,
      resolved: resolution.draft,
      provenance: resolution.provenance,
      plan: {
        documentCount: plan.documentCount,
        kinds,
        groups: plan.groups.length,
      },
      checked,
      reminder: await page.locator(".operator-result-reminder").innerText(),
    });
    return raw;
  };
  await numericFixture(1);
  const five = await numericFixture(5);
  await showListTools();
  await addFromChooser(5, "ПС — обучение по профессии");
  const withPs = await committed(
    five.id,
    (current) => directionAssignments(current, 4, "PS").length === 3,
  );
  await expect(page.locator(".operator-result-reminder")).toContainText(
    "Не подтверждены 11 результатов по обучениям у 5 получателей.",
  );
  await showListTools();
  const scopeFilter = page.getByRole("combobox", {
    name: "Показать строки",
    exact: true,
  });
  await expect(scopeFilter).toHaveCount(1);
  await scopeFilter.selectOption("ps-");
  await expect(rows).toHaveCount(1);
  await expect(chooser(5)).toHaveAccessibleName(/ПС/);
  const psFilteredRaw = await read(page, five.id);
  expect(psFilteredRaw.revision).toBe(withPs.revision);
  expect(psFilteredRaw.items).toEqual(withPs.items);
  expect(
    directionAssignments(withPs, 4, "PS")
      .map((entry) => entry.templateId)
      .sort(),
  ).toEqual(["ps-card", "ps-protocol", "ps-witness"]);
  await evidence(page, "numerictraining-outcome-counts-five-ps", {
    counters,
    withPs,
    psFilteredRaw,
  });
  await numericFixture(1, true);
  await evidence(page, "numerictraining-outcome-counts", {
    counters,
    primaryCompanionDeduplicated: true,
    knownDirectionRemainsInPlan: true,
    originalTenPersonScopeRequestId: draft.id,
  });
});
test("UX03/06/08/18/20 primary geometry remains stable through hints and checked errors; scope keeps active input", async ({
  page,
}) => {
  test.setTimeout(300000);
  const headers = await login(page),
    draft = await create(page, headers);
  await page.goto(`/requests/${draft.id}/edit`);
  const baseline = await geometry(page);
  const input = page.getByLabel("ФИО, строка 1", { exact: true });
  await input.fill("Тeст источника");
  await expect(page.getByText(/Проверка источника:/).first()).toBeVisible();
  const hint = await geometry(page);
  expect(
    hint
      .map((v, i) => Math.abs(v.offset - baseline[i].offset))
      .every((v) => v <= 1),
  ).toBe(true);
  const menu = page.locator(".recipient-extra-tools");
  const opener = menu.locator(":scope > summary");
  await opener.click();
  await expect(opener).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator(".recipient-extra-tools")).not.toHaveAttribute(
    "open",
    "",
  );
  await expect(opener).toBeFocused();
  await expect(opener).toHaveAttribute("aria-expanded", "false");
  await opener.press("Enter");
  await expect(opener).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Tab");
  await expect(
    menu.getByRole("button", { name: "Указать место работы", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(opener).toBeFocused();
  await page.keyboard.press("Escape");
  await opener.click();
  await input.click();
  await expect(menu).not.toHaveAttribute("open", "");
  await expect(input).toBeFocused();
  await opener.press("Enter");
  await menu
    .getByRole("button", { name: "Сопоставить фото", exact: true })
    .press("Tab");
  await expect(menu).not.toHaveAttribute("open", "");
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe(
    "BODY",
  );
  let pickerLoads = 0;
  const countPicker = (request: import("@playwright/test").Request) => {
    if (
      request.method() === "GET" &&
      new URL(request.url()).pathname === "/api/recipients"
    )
      pickerLoads++;
  };
  page.on("request", countPicker);
  await page.setViewportSize({ width: 720, height: 450 });
  await opener.press("Enter");
  await menu
    .getByRole("button", { name: "Найти человека", exact: true })
    .click();
  const picker = page.getByRole("dialog", {
    name: "Найти существующего получателя",
    exact: true,
  });
  await expect(picker).toBeVisible();
  await expect(menu).not.toHaveAttribute("open", "");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect.poll(() => pickerLoads).toBe(1);
  await picker
    .getByLabel("Поиск по справочнику", { exact: true })
    .press("Escape");
  await expect(picker).toHaveCount(0);
  page.off("request", countPicker);
  await input.click();
  await expect(input).toBeFocused();
  expect(
    await input.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return (
        document.elementFromPoint(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2,
        ) === element
      );
    }),
  ).toBe(true);
  await evidence(page, "menu-keyboard-outside-nested-short", {
    requestId: draft.id,
    revision: (await read(page, draft.id)).revision,
    pickerLoads,
    viewport: { width: 720, height: 450 },
    ariaExpanded: await opener.getAttribute("aria-expanded"),
    activePath: await input.getAttribute("data-field-path"),
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator(".operator-list-tools > summary").click();
  const scope = page.getByRole("combobox", { name: /Показать строки/ });
  await scope.selectOption({ label: "Без ФИО на русском" });
  const empty = page.getByLabel("ФИО, строка 2", { exact: true });
  await empty.pressSequentially("Синтетический Второй");
  await expect(empty).toBeFocused();
  await expect(empty).toHaveValue("Синтетический Второй");
  await empty.press("Backspace");
  await expect(empty).toHaveValue("Синтетический Второ");
  await expect(empty).toBeFocused();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() =>
    navigator.clipboard.writeText("й из синтетического источника"),
  );
  await empty.press("Control+V");
  await expect(empty).toHaveValue(
    "Синтетический Второй из синтетического источника",
  );
  await expect(empty).toBeFocused();
  await empty.press("Control+A");
  await empty.press("Backspace");
  await expect(empty).toHaveValue("");
  await expect(empty).toBeFocused();
  await page.evaluate(() =>
    navigator.clipboard.writeText("Синтетический Второй после очистки"),
  );
  await empty.press("Control+V");
  await expect(empty).toHaveValue("Синтетический Второй после очистки");
  await empty.press("Tab");
  await expect(
    page.getByLabel("Должность · RU, строка 2", { exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(empty).toBeFocused();
  await scope.selectOption("");
  await page
    .getByRole("button", { name: "Детали получателя 3", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await expect(
    modal.locator('[data-field-path="items.2.fullNameRu"]'),
  ).toHaveAttribute("aria-invalid", "false");
  await expect(modal.locator(".field-error")).toHaveCount(0);
  await modal
    .getByRole("button", { name: "Вернуться к списку", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Далее: Строка 1.*Выберите документ/ })
    .first()
    .click();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Проверить данные", exact: true })
    .click();
  await expect(
    page.getByLabel("ФИО, строка 3", { exact: true }),
  ).toHaveAttribute("aria-invalid", "true");
  const checked = await geometry(page);
  expect(
    checked
      .map((value, index) => Math.abs(value.offset - baseline[index].offset))
      .every((value) => value <= 1),
  ).toBe(true);
  await evidence(page, "hints-geometry-filter", {
    baseline,
    hint,
    checked,
    active: await page.evaluate(() =>
      document.activeElement?.getAttribute("data-field-path"),
    ),
  });
  await page
    .getByRole("button", { name: "Детали получателя 3", exact: true })
    .click();
  await modal.getByRole("tab", { name: "Личные данные", exact: true }).click();
  const checkedDetailName = modal.locator(
    '[data-field-path="items.2.fullNameRu"]',
  );
  await expect(checkedDetailName).toHaveAttribute("aria-invalid", "true");
  await expect(
    checkedDetailName.locator("..").locator(".field-error"),
  ).toBeVisible();
  const checkedDetail = {
    invalid: await checkedDetailName.getAttribute("aria-invalid"),
    describedBy: await checkedDetailName.getAttribute("aria-describedby"),
    border: await checkedDetailName.evaluate(
      (element) => getComputedStyle(element).borderColor,
    ),
    errors: await modal.locator(".field-error").allTextContents(),
    badges: await modal.locator(".tab-error-count").allTextContents(),
  };
  await checkedDetailName.pressSequentially("С");
  await expect(checkedDetailName).toHaveAttribute("aria-invalid", "false");
  await checkedDetailName.fill("Синтетический Третий из деталей");
  await expect
    .poll(async () => (await read(page, draft.id)).items[2].fullNameRu, {
      intervals: [1000],
    })
    .toBe("Синтетический Третий из деталей");
  await expect(checkedDetailName).toHaveAttribute("aria-invalid", "false");
  await expect(
    checkedDetailName.locator("..").locator(".field-error"),
  ).toHaveCount(0);
  await evidence(page, "details-hint-checked-corrected", {
    checkedDetail,
    correctedAria: await checkedDetailName.getAttribute("aria-invalid"),
    correctedBorder: await checkedDetailName.evaluate(
      (element) => getComputedStyle(element).borderColor,
    ),
    saved: await read(page, draft.id),
  });
  await modal
    .getByRole("button", { name: "Вернуться к списку", exact: true })
    .click();
  await expect(
    page.getByLabel("ФИО, строка 3", { exact: true }),
  ).toHaveAttribute("aria-invalid", "false");
  const correctedBeforeReload = await read(page, draft.id);
  await page.reload();
  const correctedAfterReload = await read(page, draft.id);
  expect(correctedAfterReload.revision).toBe(correctedBeforeReload.revision);
  expect(correctedAfterReload.items).toEqual(correctedBeforeReload.items);
  expect(correctedAfterReload.events).toEqual(correctedBeforeReload.events);
  const correctedGridName = page.getByLabel("ФИО, строка 3", { exact: true });
  await expect(correctedGridName).toHaveValue(
    "Синтетический Третий из деталей",
  );
  await expect(correctedGridName).toHaveAttribute("aria-invalid", "false");
  await expect(
    correctedGridName.locator("..").locator(".field-error"),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Детали получателя 3", exact: true })
    .click();
  await modal.getByRole("tab", { name: "Личные данные", exact: true }).click();
  const reloadedDetailName = modal.locator(
    '[data-field-path="items.2.fullNameRu"]',
  );
  await expect(reloadedDetailName).toHaveValue(
    "Синтетический Третий из деталей",
  );
  await expect(reloadedDetailName).toHaveAttribute("aria-invalid", "false");
  await expect(
    reloadedDetailName.locator("..").locator(".field-error"),
  ).toHaveCount(0);
  await evidence(page, "details-corrected-reload", {
    correctedBeforeReload,
    correctedAfterReload,
    namesAndAssignmentOrigins: correctedAfterReload.items.map((item) => ({
      id: item.id,
      fullNameRu: item.fullNameRu,
      fullNameKz: item.fullNameKz,
      assignments: item.assignments.map((assignment) => ({
        id: assignment.id,
        templateId: assignment.templateId,
        eventId: assignment.eventId,
        fieldOrigins: assignment.fieldOrigins,
        outcome: assignment.outcome,
      })),
    })),
    gridAriaInvalid: await correctedGridName.getAttribute("aria-invalid"),
    detailAriaInvalid: await reloadedDetailName.getAttribute("aria-invalid"),
    detailFieldErrors: await reloadedDetailName
      .locator("..")
      .locator(".field-error")
      .count(),
  });
  await modal
    .getByRole("button", { name: "Вернуться к списку", exact: true })
    .click();
  const resumedTools = page.locator(".operator-list-tools");
  if (
    !(await resumedTools.evaluate(
      (element) => (element as HTMLDetailsElement).open,
    ))
  )
    await resumedTools.locator(":scope > summary").click();
  // Recreate the missing-name condition for the existing error-filter scenario.
  await page.getByLabel("ФИО, строка 3", { exact: true }).clear();
  await expect
    .poll(async () => (await read(page, draft.id)).items[2].fullNameRu, {
      intervals: [1000],
    })
    .toBe("");
  await page
    .getByRole("button", { name: "Проверить данные", exact: true })
    .click();
  await expect(
    page.getByLabel("ФИО, строка 3", { exact: true }),
  ).toHaveAttribute("aria-invalid", "true");
  await scope.selectOption("errors");
  const third = page.getByLabel("ФИО, строка 3", { exact: true });
  await third.pressSequentially("Синтетический Третий");
  await expect(third).toBeFocused();
  await saved(page);
  await expect(third).toBeVisible();
  await scope.selectOption("unassigned");
  await page
    .getByRole("button", { name: /Настройки обучения получателя 3:/ })
    .click();
  const chooser = page.getByRole("dialog", {
    name: "Назначить обучение",
    exact: true,
  });
  await chooser
    .getByRole("checkbox", { name: /^Безопасность и охрана труда/ })
    .check();
  await chooser
    .getByRole("button", { name: "Добавить обучение и комплект", exact: true })
    .click();
  await expect(chooser).toHaveCount(0);
  await saved(page);
  await expect(third).toBeVisible();
  await third.focus();
  await expect(third).toBeFocused();
  const filteredSaved = await read(page, draft.id);
  expect(filteredSaved.items[2].assignments.length).toBeGreaterThan(0);
  // A native filter change starts from the filter itself. selectOption dispatches
  // a value change without moving keyboard focus from the recipient input.
  await scope.focus();
  await scope.selectOption("");
  await scope.selectOption("unassigned");
  await expect(third).toHaveCount(0);
  await expect(scope).toBeFocused();
  await expect(
    page.locator(".operator-grid tr[data-recipient-id]"),
  ).toHaveCount(2);
  await evidence(page, "scope-editing-and-explicit-release", {
    saved: filteredSaved,
    finalVisibleRecipients: 2,
  });
});

test("UX17/18/19/21 shared length policy retains 501 input and resumes saving after correction in both views", async ({
  page,
}) => {
  test.setTimeout(300000);
  const headers = await login(page),
    draft = await create(page, headers, 1, {
      items: [
        {
          ...newRecipient(),
          assignments: [],
          fullNameRu: "Тeст\u200b Синтетический",
        },
      ],
    });
  await page.goto(`/requests/${draft.id}/edit`);
  const text = (length: number) => "слово ".repeat(100).slice(0, length);
  const grid = page.getByLabel("Должность · RU, строка 1", { exact: true });
  for (const length of [499, 500]) {
    await grid.fill(text(length));
    await saved(page);
    expect((await read(page, draft.id)).items[0].positionRu).toBe(text(length));
  }
  const failed = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/print-requests/${draft.id}`) &&
      response.request().method() === "PATCH" &&
      response.status() >= 400,
  );
  await grid.fill(text(501));
  expect((await failed).status()).toBe(400);
  await expect(grid).toHaveValue(text(501));
  await expect(grid).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText(/Максимум 500 символов/).first()).toBeVisible();
  expect((await read(page, draft.id)).items[0].positionRu).toBe(text(500));
  await page.setViewportSize({ width: 390, height: 844 });
  const warnings = [
    page.getByText(/Проверка источника:.*невидимый или управляющий/).first(),
    page
      .getByText(/Проверка источника:.*иностранное имя можно оставить/)
      .first(),
  ];
  for (const warning of warnings) {
    await expect(warning).toBeVisible();
    expect(
      await warning.evaluate(
        (element) =>
          element.scrollHeight <= element.clientHeight + 1 &&
          element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
  }
  await page.getByLabel("ФИО, строка 1", { exact: true }).focus();
  await expect(page.getByLabel("ФИО, строка 1", { exact: true })).toBeFocused();
  expect((await read(page, draft.id)).items[0].fullNameRu).toBe(
    "Тeст\u200b Синтетический",
  );
  await evidence(page, "two-source-warnings-with-length-error-390", {
    warningTexts: await Promise.all(
      warnings.map((warning) => warning.textContent()),
    ),
    localLength: (await grid.inputValue()).length,
    saved: await read(page, draft.id),
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page
    .getByRole("button", { name: "Детали получателя 1", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await modal.getByRole("tab", { name: "Личные данные", exact: true }).click();
  const detail = modal.locator('[data-field-path="items.0.positionRu"]');
  await expect(detail).toHaveValue(text(501));
  await expect(modal.locator(".recipient-details-footer")).toContainText(
    "Не сохранено",
  );
  await evidence(page, "length-error-retained", {
    localLength: (await detail.inputValue()).length,
    savedLength: (await read(page, draft.id)).items[0].positionRu.length,
    serverStatus: 400,
  });
  await detail.fill(text(499));
  await expect(modal.locator(".recipient-details-footer")).toContainText(
    /сохранена.*редакция/,
  );
  await page.setViewportSize({ width: 720, height: 450 });
  await detail.press("Tab");
  await expect(
    modal.getByRole("button", { name: "Вернуться к списку", exact: true }),
  ).toBeInViewport();
  await evidence(page, "length-modal-footer", {
    saved: (await read(page, draft.id)).items[0].positionRu.length,
    viewport: { width: 720, height: 450 },
  });
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  expect((await read(page, draft.id)).items[0].positionRu).toBe(text(499));

  const openPerson = async () => {
    await page
      .getByRole("button", { name: "Детали получателя 1", exact: true })
      .click();
    const card = page.getByRole("dialog", {
      name: "Настройки строки 1",
      exact: true,
    });
    await card.getByRole("tab", { name: "Личные данные", exact: true }).click();
    return card;
  };
  await page.setViewportSize({ width: 1440, height: 900 });
  let card = await openPerson();
  for (const length of [500, 499]) {
    const field = card.locator('[data-field-path="items.0.positionRu"]');
    await field.fill(text(length));
    await expect
      .poll(async () => (await read(page, draft.id)).items[0].positionRu, {
        intervals: [1000],
      })
      .toBe(text(length));
    await expect(card.locator(".recipient-details-footer")).toContainText(
      /сохранена.*редакция/,
    );
    await expect(field).toHaveAttribute("aria-invalid", "false");
  }
  const detailRejected = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/print-requests/${draft.id}`) &&
      response.request().method() === "PATCH" &&
      response.status() === 400,
  );
  await card.locator('[data-field-path="items.0.positionRu"]').fill(text(501));
  await detailRejected;
  await expect(
    card.locator('[data-field-path="items.0.positionRu"]'),
  ).toHaveValue(text(501));
  await expect(
    card.locator('[data-field-path="items.0.positionRu"]'),
  ).toHaveAttribute("aria-invalid", "true");
  await expect(
    card.locator(".recipient-details-footer .field-error"),
  ).toBeVisible();
  expect((await read(page, draft.id)).items[0].positionRu).toBe(text(499));
  await card.locator('[data-field-path="items.0.positionRu"]').fill(text(499));
  await expect(card.locator(".recipient-details-footer")).toContainText(
    /сохранена.*редакция/,
  );
  await card
    .getByRole("button", { name: "Вернуться к списку", exact: true })
    .click();

  const closingReadbacks = [];
  const endpoint = `**/api/print-requests/${draft.id}`;
  for (const method of ["cross", "escape", "return"] as const) {
    card = await openPerson();
    const value = `Синтетическое закрытие ${method}; введённое сохраняется`;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    await page.route(endpoint, async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      calls++;
      const response = await route.fetch();
      expect(response.ok(), await response.text()).toBe(true);
      await gate;
      await route.fulfill({ response });
    });
    try {
      await card.locator('[data-field-path="items.0.positionRu"]').fill(value);
      await expect(card.locator(".recipient-details-footer")).toContainText(
        "Сохраняем…",
      );
      await expect.poll(() => calls).toBe(1);
      await evidence(page, `details-save-in-flight-${method}`, {
        requestId: draft.id,
        localValue: value,
        footer: await card.locator(".recipient-details-footer").innerText(),
        acknowledgementReleased: false,
      });
      if (method === "cross")
        await card
          .getByRole("button", { name: "Закрыть диалог", exact: true })
          .click();
      else if (method === "escape") await page.keyboard.press("Escape");
      else
        await card
          .getByRole("button", { name: "Вернуться к списку", exact: true })
          .click();
      await expect(card).toHaveCount(0);
      await expect(grid).toHaveValue(value);
      await expect(page.locator(".save-indicator")).toContainText("Сохраняем…");
      release();
      await saved(page);
      const actual = await read(page, draft.id);
      expect(actual.items[0].positionRu).toBe(value);
      expect(calls).toBe(1);
      closingReadbacks.push({
        method,
        revision: actual.revision,
        value: actual.items[0].positionRu,
        actual,
      });
      await page.reload();
      await expect(grid).toHaveValue(value);
    } finally {
      release();
      await page.unroute(endpoint);
    }
  }

  // A second real editor advances the revision; the first never overwrites it.
  card = await openPerson();
  const beforeConflict = await read(page, draft.id);
  const other = await page.context().newPage();
  const foreignValue = "Синтетическая редакция второго окна";
  const retainedLocal = "Синтетический несохранённый ввод первого окна";
  try {
    await other.goto(`/requests/${draft.id}/edit`);
    await other
      .getByLabel("Должность · RU, строка 1", { exact: true })
      .fill(foreignValue);
    await expect
      .poll(async () => (await read(page, draft.id)).items[0].positionRu, {
        intervals: [1000],
      })
      .toBe(foreignValue);
    await saved(other);
    const foreign = await read(page, draft.id);
    expect(foreign.revision).toBeGreaterThan(beforeConflict.revision);
    await card
      .locator('[data-field-path="items.0.positionRu"]')
      .fill(retainedLocal);
    const conflict = page.getByRole("dialog", {
      name: "Заявка изменена в другом окне",
      exact: true,
    });
    await expect(conflict).toBeVisible();
    await conflict
      .getByRole("button", { name: "Закрыть диалог", exact: true })
      .click();
    await expect(card.locator(".recipient-details-footer")).toContainText(
      "Сохранение приостановлено: конфликт редакций",
    );
    await expect(
      card.locator('[data-field-path="items.0.positionRu"]'),
    ).toHaveValue(retainedLocal);
    await expect(
      card
        .locator(".recipient-details-footer")
        .getByRole("button", { name: "Разрешить конфликт", exact: true }),
    ).toBeVisible();
    const paused = await read(page, draft.id);
    expect(paused.revision).toBe(foreign.revision);
    expect(paused.items).toEqual(foreign.items);
    await evidence(page, "details-conflict-paused-footer", {
      beforeConflict,
      foreign,
      paused,
      localValue: retainedLocal,
      closingReadbacks,
      footer: await card.locator(".recipient-details-footer").innerText(),
    });
    await card
      .locator(".recipient-details-footer")
      .getByRole("button", { name: "Разрешить конфликт", exact: true })
      .click();
    await conflict
      .getByRole("button", { name: "Загрузить версию сервера", exact: true })
      .click();
    await expect(conflict).toHaveCount(0);
    await expect(grid).toHaveValue(foreignValue);
    await saved(page);
    await page.reload();
    await expect(grid).toHaveValue(foreignValue);
    expect((await read(page, draft.id)).items).toEqual(foreign.items);
  } finally {
    await other.close();
  }
  await evidence(page, "details-close-contract-readback", {
    closingReadbacks,
    final: await read(page, draft.id),
    allThreeMethodsRetainedLocalAndSavedRevision: true,
  });

  const beforeImportLength = await read(page, draft.id);
  await openRecipientExtraTools(page);
  await page
    .getByRole("button", { name: "Импорт / вставка", exact: true })
    .click();
  const importing = page.getByRole("dialog", {
    name: "Импорт получателей",
    exact: true,
  });
  await importing
    .getByLabel("Или вставьте таблицу с заголовками", { exact: true })
    .fill(
      `ФИО RU\tДолжность RU\nСинтетический Импорт Пятьсот\t${text(500)}\nСинтетический Исправляемый Импорт\t${text(501)}`,
    );
  await importing
    .getByRole("button", { name: "Перейти к сопоставлению", exact: true })
    .click();
  const mappedPosition = importing.getByLabel(
    "Исправленное значение, исходная строка 3, Должность RU",
    { exact: true },
  );
  await expect(mappedPosition).toHaveValue(text(501));
  await expect(mappedPosition).toHaveAttribute("aria-invalid", "true");
  await expect(
    importing.getByRole("button", {
      name: "Добавить 2 строк в черновик",
      exact: true,
    }),
  ).toBeDisabled();
  expect((await read(page, draft.id)).items).toEqual(beforeImportLength.items);
  await mappedPosition.fill(text(499));
  await expect(mappedPosition).toHaveAttribute("aria-invalid", "false");
  await importing
    .getByRole("button", { name: "Добавить 2 строк в черновик", exact: true })
    .click();
  await expect(importing).toHaveCount(0);
  const importedLength = await read(page, draft.id);
  expect(importedLength.items).toHaveLength(3);
  expect(importedLength.items[0]).toEqual(beforeImportLength.items[0]);
  expect(importedLength.items.slice(1).map((item) => item.positionRu)).toEqual([
    text(500),
    text(499),
  ]);

  await page.getByLabel("Выбрать строку 1", { exact: true }).check();
  await openRecipientExtraTools(page);
  await page
    .getByRole("button", { name: "Изменить данные выбранных (1)", exact: true })
    .click();
  const bulk = page.getByRole("dialog", {
    name: "Общие значения для 1 получателей",
    exact: true,
  });
  await bulk.locator(".bulk-recipient-fields > summary").click();
  await bulk.getByLabel("Должность RU", { exact: true }).check();
  const bulkMode = bulk.getByRole("combobox", { name: /^Режим применения/ });
  await expect(bulkMode).toHaveCount(1);
  await bulkMode.selectOption("REPLACE");
  const bulkPosition = bulk.getByLabel("Общее значение: Должность RU", {
    exact: true,
  });
  await bulkPosition.fill(text(501));
  await expect(bulkPosition).toHaveValue(text(501));
  await expect(bulkPosition).toHaveAttribute("aria-invalid", "true");
  await expect(
    bulk.getByRole("button", { name: "Показать изменения", exact: true }),
  ).toBeDisabled();
  expect((await read(page, draft.id)).items).toEqual(importedLength.items);
  await bulkPosition.fill(text(500));
  await expect(bulkPosition).toHaveAttribute("aria-invalid", "false");
  await bulk
    .getByRole("button", { name: "Показать изменения", exact: true })
    .click();
  await bulk
    .getByLabel(
      "Подтверждаю замену отмеченных полей, включая индивидуальные значения",
      { exact: true },
    )
    .check();
  await bulk
    .getByRole("button", { name: "Применить 1 изменений", exact: true })
    .click();
  await expect(bulk).toHaveCount(0);
  const bulkLength = await read(page, draft.id);
  expect(bulkLength.items[0].positionRu).toBe(text(500));
  expect(bulkLength.items.slice(1)).toEqual(importedLength.items.slice(1));
  await page.reload();
  expect((await read(page, draft.id)).items).toEqual(bulkLength.items);
  await evidence(page, "length-grid-details-import-bulk-readback", {
    beforeImportLength,
    importedLength,
    bulkLength,
    gridServer501: 400,
    detailsServer501: 400,
    import501: "VISIBLE_INVALID_APPLY_DISABLED",
    bulk501: "VISIBLE_INVALID_PREVIEW_DISABLED",
    importedLengths: [500, 499],
    finalSelectedLength: 500,
  });
});

test("UX10/23 selected company compact summary, cancel first entry and late creation response never selects cancelled input", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const headers = await login(page),
    draft = await create(page, headers, 1, { kind: "COMPANY" });
  await page.goto(`/requests/${draft.id}/edit`);
  await page
    .getByLabel("Название компании", { exact: true })
    .fill("Синтетическая отменённая компания");
  await expect(page.locator(".save-indicator")).toContainText(
    "Название компании ещё не сохранено",
  );
  let posts = 0;
  await page.route("**/api/customers", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 1300));
    await route.fulfill({ response });
  });
  await page
    .getByRole("button", { name: "Использовать эту компанию", exact: true })
    .dblclick();
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Добавить компанию", exact: true }),
  ).toBeVisible();
  await expect.poll(() => posts).toBe(1);
  await expect(page.locator(".save-indicator")).not.toContainText("Сохраняем");
  await new Promise((resolve) => setTimeout(resolve, 1700));
  expect((await read(page, draft.id)).customerId).toBeNull();
  await page.unroute("**/api/customers");
  await page
    .getByRole("button", { name: "Добавить компанию", exact: true })
    .click();
  await page
    .getByLabel("Название компании", { exact: true })
    .fill("Синтетическая выбранная компания");
  await page
    .getByRole("button", { name: "Использовать эту компанию", exact: true })
    .click();
  await saved(page);
  await expect(
    page.locator(".request-organization-selected-compact"),
  ).toContainText("Синтетическая выбранная компания");
  await expect(
    page.getByRole("button", {
      name: "Использовать эту компанию",
      exact: true,
    }),
  ).toHaveCount(0);
  const firstInput = page.getByLabel("ФИО, строка 1", { exact: true });
  const firstInputBounds = await firstInput.boundingBox();
  expect(firstInputBounds).not.toBeNull();
  expect(firstInputBounds!.y).toBeGreaterThanOrEqual(0);
  expect(firstInputBounds!.y + firstInputBounds!.height).toBeLessThanOrEqual(
    900,
  );
  await evidence(page, "company-compact-cancel", {
    posts,
    firstInputBounds,
    request: await read(page, draft.id),
  });
});

test("UX22 deletion and restoration focus an existing row; query and fragment navigation flushes last input", async ({
  page,
}) => {
  test.setTimeout(300000);
  const headers = await login(page),
    draft = await create(page, headers, 3, {
      items: Array.from({ length: 3 }, (_, index) => ({
        ...newRecipient(),
        assignments: [],
        fullNameRu: `Синтетический защищённый получатель ${index + 1}`,
      })),
    });
  await page.goto(`/requests/${draft.id}/edit`);
  await page
    .getByRole("button", { name: "Удалить получателя 2", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Убрать из заявки", exact: true })
    .click();
  await expect(page.getByLabel("ФИО, строка 2", { exact: true })).toBeFocused();
  await page
    .getByRole("button", { name: "Восстановить получателя", exact: true })
    .click();
  await expect(page.getByLabel("ФИО, строка 2", { exact: true })).toBeFocused();
  await page
    .getByLabel("ФИО, строка 2", { exact: true })
    .fill("Синтетический Последний ввод");
  await page
    .locator(".back-link")
    .evaluate((link) =>
      link.setAttribute("href", "/requests?uxfull=1#synthetic-fragment"),
    );
  await page.locator(".back-link").click();
  await expect(page).toHaveURL(/\/requests\?uxfull=1#synthetic-fragment$/);
  expect((await read(page, draft.id)).items[1].fullNameRu).toBe(
    "Синтетический Последний ввод",
  );
  await page.goBack();
  await expect(page.getByLabel("ФИО, строка 2", { exact: true })).toHaveValue(
    "Синтетический Последний ввод",
  );
  const deletionChecks = [];
  const beforeEdges = await read(page, draft.id);
  for (const target of [1, 3]) {
    await page
      .getByRole("button", {
        name: `Удалить получателя ${target}`,
        exact: true,
      })
      .click();
    const removal = page.getByRole("dialog", {
      name: "Убрать получателя из заявки?",
      exact: true,
    });
    await removal
      .getByRole("button", { name: "Оставить", exact: true })
      .click();
    expect((await read(page, draft.id)).items).toEqual(beforeEdges.items);
    await expect(
      page.getByRole("button", {
        name: `Удалить получателя ${target}`,
        exact: true,
      }),
    ).toBeFocused();
    await page
      .getByRole("button", {
        name: `Удалить получателя ${target}`,
        exact: true,
      })
      .click();
    await removal
      .getByRole("button", { name: "Убрать из заявки", exact: true })
      .click();
    await expect(
      page.getByLabel(`ФИО, строка ${target === 1 ? 1 : 2}`, { exact: true }),
    ).toBeFocused();
    const deleted = await read(page, draft.id);
    expect(deleted.items).toEqual(
      beforeEdges.items.filter((_, index) => index !== target - 1),
    );
    await page
      .getByRole("button", { name: "Восстановить получателя", exact: true })
      .click();
    await expect(
      page.getByLabel(`ФИО, строка ${target}`, { exact: true }),
    ).toBeFocused();
    const restored = await read(page, draft.id);
    expect(restored.items).toEqual(beforeEdges.items);
    await page.keyboard.press("Tab");
    await expect(
      page.getByLabel(`Должность · RU, строка ${target}`, { exact: true }),
    ).toBeFocused();
    deletionChecks.push({
      target,
      deleted,
      restored,
      activeAfterTab: `items.${target - 1}.positionRu`,
    });
  }

  let release!: () => void;
  const acknowledgement = new Promise<void>((resolve) => {
    release = resolve;
  });
  let patches = 0;
  let inFlightPatch: Promise<void> | null = null;
  const endpoint = `**/api/print-requests/${draft.id}`;
  await page.route(endpoint, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    inFlightPatch = (async () => {
      patches++;
      const response = await route.fetch();
      expect(response.ok(), await response.text()).toBe(true);
      await acknowledgement;
      await route.fulfill({ response });
    })();
    await inFlightPatch;
  });
  let hashWhileSaving!: string;
  let requestedHashTarget!: string;
  try {
    const dirtyName = "Синтетический Последний символ перед якорем";
    await page.getByLabel("ФИО, строка 2", { exact: true }).fill(dirtyName);
    await expect.poll(() => patches).toBe(1);
    await expect(page.locator(".save-indicator")).toContainText("Сохраняем…");
    const skip = page.getByRole("link", {
      name: "Перейти к содержимому",
      exact: true,
    });
    await keyboardFocus(page, skip);
    requestedHashTarget = new URL(
      (await skip.getAttribute("href"))!,
      page.url(),
    ).href;
    await skip.press("Enter");
    // The chosen navigation contract waits for the outstanding real save.
    // Keep the requested fragment across that wait, then verify it afterward.
    await expect(page).toHaveURL(new RegExp(`/requests/${draft.id}/edit$`));
    await expect(page.locator(".save-indicator")).toContainText("Сохраняем…");
    hashWhileSaving = page.url();
    release();
    await saved(page);
    await expect(page).toHaveURL(requestedHashTarget);
    expect(new URL(page.url()).hash).toBe("#main");
    expect(
      await page
        .locator("#main")
        .evaluate((element) => Math.abs(element.getBoundingClientRect().top)),
    ).toBeLessThanOrEqual(2);
    const savedHash = await read(page, draft.id);
    expect(savedHash.items[1].fullNameRu).toBe(dirtyName);
    expect(patches).toBe(1);
    await evidence(page, "skip-link-dirty-hash-readback", {
      hashWhileSaving,
      requestedHashTarget,
      hashAfterSave: page.url(),
      requestId: draft.id,
      patches,
      saved: savedHash,
      deletionChecks,
    });
  } finally {
    release();
    // Do not remove/close a route while its real response is still being
    // fulfilled, which would add a secondary "already handled" failure.
    await inFlightPatch;
    await page.unroute(endpoint);
  }

  const single = await create(page, headers, 1, {
    items: [{
      ...newRecipient(),
      assignments: [],
      fullNameRu: "Синтетический защищённый единственный получатель",
    }],
  });
  await page.goto(`/requests/${single.id}/edit`);
  await page
    .getByRole("button", { name: "Удалить получателя 1", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Убрать получателя из заявки?", exact: true })
    .getByRole("button", { name: "Убрать из заявки", exact: true })
    .click();
  await expect(
    page.locator(".operator-grid tr[data-recipient-id]"),
  ).toHaveCount(0);
  await expect(page.locator("[data-add-recipient]")).toBeFocused();
  expect((await read(page, single.id)).items).toHaveLength(0);
  await page
    .getByRole("button", { name: "Восстановить получателя", exact: true })
    .click();
  await expect(page.getByLabel("ФИО, строка 1", { exact: true })).toBeFocused();
  const restoredSingle = await read(page, single.id);
  expect(restoredSingle.items).toEqual(single.items);
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("ФИО, строка 1", { exact: true })).toBeFocused();
  await evidence(page, "delete-restore-navigation", {
    requestId: draft.id,
    beforeEdges,
    deletionChecks,
    hashWhileSaving,
    requestedHashTarget,
    finalOriginal: await read(page, draft.id),
    single,
    restoredSingle,
  });
});

test("UX06/07/11/21 ten long bilingual rows, photo crop/error/retry and every required viewport keep active controls uncovered", async ({
  page,
}) => {
  test.setTimeout(fullSuiteRunId() ? 420000 : 300000);
  await fullSuitePageApiCooldown(page, evidenceRoot, "before-viewport-photo");
  const headers = await login(page);
  const draft = await create(page, headers, 10, {
    items: Array.from({ length: 10 }, (_, index) => ({
      ...newRecipient(),
      assignments: [],
      fullNameRu: `Синтетический Получатель ${index + 1} с длинным исходным именем`,
      fullNameKz: `Ә Ғ Қ Ң Ө Ұ Ү Һ І Синтетикалық қатысушы ${index + 1}`,
      positionRu:
        "Синтетическая длинная должность для проверки полного исходного текста",
      positionKz: "Көрнекі ұзын лауазым және бастапқы мәтін",
      workplaceRu: "Синтетическая организация для проверки читаемости",
    })),
  });
  await page.goto(`/requests/${draft.id}/edit`);
  const metrics: unknown[] = [];
  for (const photo of [false, true]) {
    if (photo) {
      await page
        .getByRole("button", {
          name: "БиОТ: добавить всем в заявке (10)",
          exact: true,
        })
        .click();
      await saved(page);
      await page
        .getByRole("button", {
          name: "ПБ: добавить всем в заявке (10)",
          exact: true,
        })
        .click();
      await saved(page);
      await page
        .getByRole("button", {
          name: "Добавить фото получателя 1",
          exact: true,
        })
        .click();
      const modal = page.getByRole("dialog", {
        name: "Фото для печати",
        exact: true,
      });
      const photoFile = path.resolve(
        __dirname,
        "../../../tests/fixtures/source-photo.png",
      );
      await modal.getByLabel("Выбрать фотографию").setInputFiles(photoFile);
      await modal.getByLabel("Масштаб", { exact: true }).fill("1.25");
      await modal.getByLabel("По горизонтали", { exact: true }).fill("60");
      await modal.getByLabel("Поворот", { exact: true }).selectOption("90");
      await page.route(
        "**/api/photos",
        (route) =>
          route.request().method() === "POST"
            ? route.fulfill({
                status: 503,
                contentType: "application/json",
                body: JSON.stringify({
                  code: "SYNTHETIC_PHOTO_FAILURE",
                  message: "Синтетический отказ загрузки для проверки повтора",
                }),
              })
            : route.continue(),
        { times: 1 },
      );
      await modal
        .getByRole("button", { name: "Сохранить фото", exact: true })
        .click();
      await expect(modal).toContainText("Синтетический отказ загрузки");
      expect((await read(page, draft.id)).items[0].photoAssetId).toBeFalsy();
      await modal
        .getByRole("button", { name: "Сохранить фото", exact: true })
        .click();
      await expect(modal).toHaveCount(0);
      await saved(page);
      const firstAsset = (await read(page, draft.id)).items[0].photoAssetId;
      expect(firstAsset).toBeTruthy();
      await page
        .getByRole("button", {
          name: "Изменить фото получателя 1",
          exact: true,
        })
        .click();
      await modal.getByLabel("Выбрать фотографию").setInputFiles(photoFile);
      await modal
        .getByRole("button", { name: "Сохранить фото", exact: true })
        .click();
      await expect(modal).toHaveCount(0);
      await saved(page);
      expect((await read(page, draft.id)).items[0].photoAssetId).not.toBe(
        firstAsset,
      );
      await page.reload();
      await expect(
        page.getByRole("button", {
          name: "Изменить фото получателя 1",
          exact: true,
        }),
      ).toBeVisible();
    }
    for (const [width, height] of [
      [1440, 900],
      [1280, 900],
      [768, 900],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await expect(
        page
          .locator(".operator-grid tr[data-recipient-id]")
          .filter({ has: page.locator(".recipient-grid-selection") }),
      ).toHaveCount(10);
      const geometryStates = [];
      const name = page.getByLabel("ФИО, строка 1", { exact: true });
      const position = page.getByLabel("Должность · RU, строка 1", {
        exact: true,
      });
      const originalName = await name.inputValue();
      const originalPosition = await position.inputValue();
      for (const category of ["WORKER", "ITR"]) {
        await page
          .getByLabel("Категория сотрудника, строка 1", { exact: true })
          .selectOption(category);
        await saved(page);
        const baseline = await geometry(page);
        await name.fill(`${originalName}\u200b`);
        await expect(
          page
            .getByText(/Проверка источника:.*невидимый или управляющий/)
            .first(),
        ).toBeVisible();
        const hinted = await geometry(page);
        const rejected = page.waitForResponse(
          (response) =>
            response.url().endsWith(`/api/print-requests/${draft.id}`) &&
            response.request().method() === "PATCH" &&
            response.status() === 400,
        );
        await position.fill("я".repeat(501));
        await rejected;
        await expect(position).toHaveAttribute("aria-invalid", "true");
        const checked = await geometry(page);
        for (const state of [hinted, checked]) {
          expect(state.map((entry) => entry.label)).toEqual(
            baseline.map((entry) => entry.label),
          );
          expect(
            Math.max(
              ...state.map((entry, index) =>
                Math.abs(entry.offset - baseline[index].offset),
              ),
            ),
          ).toBeLessThanOrEqual(1);
        }
        geometryStates.push({
          category,
          baseline,
          hinted,
          checked,
          serverStatus: 400,
        });
        await name.fill(originalName);
        await position.fill(originalPosition);
        await saved(page);
        const current = await read(page, draft.id);
        expect(current.items).toHaveLength(10);
        expect(current.items[0].fullNameRu).toBe(originalName);
        expect(current.items[0].positionRu).toBe(originalPosition);
        expect(current.items[0].employeeCategory).toBe(category);
      }
      const last = page.getByLabel("Должность · KZ, строка 10", {
        exact: true,
      });
      await last.focus();
      await expect(last).toBeFocused();
      const measured = await last.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const center = {
          x: (box.left + box.right) / 2,
          y: (box.top + box.bottom) / 2,
        };
        const scroll = element.closest(".recipient-grid-scroll") as HTMLElement;
        return {
          center,
          uncovered: document.elementFromPoint(center.x, center.y) === element,
          width: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: scroll.scrollWidth,
          scrollClientWidth: scroll.clientWidth,
          scrollLeft: scroll.scrollLeft,
        };
      });
      expect(measured.uncovered).toBe(true);
      expect(measured.width).toBeLessThanOrEqual(measured.clientWidth + 1);
      if (width <= 768)
        expect(measured.scrollWidth).toBeGreaterThan(
          measured.scrollClientWidth,
        );
      await page
        .getByRole("button", { name: "Детали получателя 10", exact: true })
        .focus();
      await expect(
        page.getByRole("button", { name: "Детали получателя 10", exact: true }),
      ).toBeInViewport();
      metrics.push({ photo, width, height, measured, geometryStates });
      await evidence(page, `viewport-${width}-photo-${photo ? "on" : "off"}`, {
        measured,
        geometryStates,
        requestId: draft.id,
      });
    }
  }
  await fs.writeFile(
    path.join(evidenceRoot, "viewports-photo-readback.json"),
    JSON.stringify(
      {
        requestId: draft.id,
        metrics,
        saved: await read(page, draft.id),
        controlledPhotoFailure: true,
      },
      null,
      2,
    ),
  );
  // Four directions require nine individual mandatory forms. Test actual
  // first/last forms, not only the last input of the initially open first form.
  let formDraft: Draft = {
    id: "fixture",
    revision: 0,
    status: "DRAFT",
    kind: "PERSON",
    title: `СИНТЕТИЧЕСКИЕ длинные детали ${Date.now()}`,
    customerId: null,
    schemaVersion: 2,
    demoMode: true,
    commonFields: { documentDate: "2026-10-03" },
    items: [
      {
        ...newRecipient(),
        fullNameRu:
          "Синтетический Получатель длинных деталей и четырёх направлений",
        assignments: [],
      },
    ],
  };
  for (const direction of ["BIOT", "PTM", "PB", "PS"] as const)
    formDraft = assignTrainingBundle(
      formDraft,
      formDraft.items.map((item) => item.id),
      direction,
      "INDIVIDUAL",
    );
  await fullSuitePageApiCooldown(page, evidenceRoot, "before-nine-form-drawer");
  const formCreated = await create(page, headers, 1, draftPayload(formDraft));
  expect(formCreated.items[0].assignments).toHaveLength(9);
  await page.setViewportSize({ width: 720, height: 450 });
  await page.goto(`/requests/${formCreated.id}/edit`);
  const returnInput = page.getByLabel("ФИО, строка 1", { exact: true });
  await returnInput.click();
  await returnInput.press("Home");
  await returnInput.press("Shift+End");
  const beforeModal = await returnInput.evaluate((element) => {
    const input = element as HTMLInputElement;
    const scroll = element.closest(".recipient-grid-scroll")!;
    return {
      selectionStart: input.selectionStart,
      selectionEnd: input.selectionEnd,
      scrollLeft: scroll.scrollLeft,
      scrollTop: scroll.scrollTop,
      windowY: window.scrollY,
    };
  });
  await page
    .getByRole("button", { name: "Детали получателя 1", exact: true })
    .click();
  const longModal = page.getByRole("dialog", {
    name: "Настройки строки 1",
    exact: true,
  });
  const forms = longModal.locator(".assignment-list > details");
  await expect(forms).toHaveCount(9);
  const firstForm = forms.first();
  await firstForm
    .getByRole("tab", { name: "Обучение и результат", exact: true })
    .click();
  const firstProgram = firstForm.locator(
    'textarea[data-field-path="items.0.assignments.0.trainingSubject"]',
  );
  await keyboardFocus(page, firstProgram);
  await firstProgram.press("Tab");
  const firstProgramKz = firstForm.locator(
    '[data-field-path="items.0.assignments.0.trainingSubjectKz"]',
  );
  await expect(firstProgramKz).toBeFocused();
  await firstProgramKz.press("Tab");
  await expect(
    firstForm.locator('[data-field-path="items.0.assignments.0.result"]'),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(firstProgramKz).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(firstProgram).toBeFocused();
  await expect(
    longModal.getByRole("button", { name: "Вернуться к списку", exact: true }),
  ).toBeInViewport();
  await evidence(page, "long-details-first-form-720", {
    requestId: formCreated.id,
    revision: formCreated.revision,
    forms: 9,
    active: await firstProgram.getAttribute("data-field-path"),
    beforeModal,
  });
  const lastForm = forms.last();
  await lastForm.locator(":scope > summary").press("Enter");
  await expect(lastForm).toHaveAttribute("open", "");
  await lastForm
    .getByRole("tab", { name: "Обучение и результат", exact: true })
    .click();
  const lastPath = await lastForm.evaluate((element) => {
    const controls = Array.from(
      element.querySelectorAll<HTMLElement>(
        "input[data-field-path],select[data-field-path],textarea[data-field-path]",
      ),
    ).filter(
      (control) =>
        !control.matches(":disabled") &&
        control.tabIndex >= 0 &&
        control.checkVisibility({
          checkOpacity: true,
          checkVisibilityCSS: true,
        }),
    );
    return controls[controls.length - 1]?.getAttribute("data-field-path");
  });
  expect(lastPath).toMatch(/^items\.0\.assignments\.8\./);
  const lastControl = lastForm.locator(`[data-field-path="${lastPath}"]`);
  await keyboardFocus(page, lastControl);
  await lastControl.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(lastControl).toBeFocused();
  const visibleLastControl = async () =>
    lastControl.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const dialog = element.closest("dialog")!;
      const footer = dialog
        .querySelector(".recipient-details-footer")!
        .getBoundingClientRect();
      const head = dialog.querySelector(".modal-head")!.getBoundingClientRect();
      const center = {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
      };
      return {
        uncovered: document.elementFromPoint(center.x, center.y) === element,
        aboveFooter: bounds.bottom <= footer.top,
        belowHead: bounds.top >= head.bottom,
        bounds: { top: bounds.top, bottom: bounds.bottom },
        footerTop: footer.top,
        headBottom: head.bottom,
      };
    });
  await expect
    .poll(async () => {
      const measured = await visibleLastControl();
      return measured.uncovered && measured.aboveFooter && measured.belowHead;
    })
    .toBe(true);
  await expect(
    longModal.getByRole("button", { name: "Вернуться к списку", exact: true }),
  ).toBeInViewport();
  await evidence(page, "long-details-last-form-720", {
    requestId: formCreated.id,
    revision: formCreated.revision,
    forms: 9,
    lastPath,
    measured: await visibleLastControl(),
    viewport: { width: 720, height: 450 },
  });
  await longModal
    .getByRole("button", { name: "Вернуться к списку", exact: true })
    .click();
  await expect(returnInput).toBeFocused();
  await expect(returnInput).toBeInViewport();
  const returnedControl = await returnInput.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const region = element
      .closest(".recipient-grid-scroll")!
      .getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      centerUncovered:
        document.elementFromPoint(
          (bounds.left + bounds.right) / 2,
          (bounds.top + bounds.bottom) / 2,
        ) === element,
      withinTable: bounds.left >= region.left && bounds.right <= region.right,
      focusVisible: element.matches(":focus-visible"),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    };
  });
  expect(returnedControl.centerUncovered).toBe(true);
  expect(returnedControl.withinTable).toBe(true);
  expect(returnedControl.focusVisible).toBe(true);
  expect(returnedControl.outlineStyle).not.toBe("none");
  expect(parseFloat(returnedControl.outlineWidth)).toBeGreaterThanOrEqual(2);
  const afterModal = await returnInput.evaluate((element) => {
    const input = element as HTMLInputElement;
    const scroll = element.closest(".recipient-grid-scroll")!;
    return {
      selectionStart: input.selectionStart,
      selectionEnd: input.selectionEnd,
      scrollLeft: scroll.scrollLeft,
      scrollTop: scroll.scrollTop,
      windowY: window.scrollY,
    };
  });
  expect(afterModal).toEqual(beforeModal);
  const formReadback = await read(page, formCreated.id);
  expect(formReadback.items).toEqual(formCreated.items);
  expect(formReadback.revision).toBe(formCreated.revision);
  await evidence(page, "long-details-four-directions-readback", {
    created: formCreated,
    readback: formReadback,
    beforeModal,
    afterModal,
    returnedControl,
    actualForms: formReadback.items[0].assignments.map((entry) => ({
      id: entry.id,
      templateId: entry.templateId,
      outcome: entry.outcome,
    })),
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  const legacyDefaultTitles = ["BIOT — Рабочие", "PTM", "PB", "PS"];
  expect(formReadback.events?.map((event) => event.title)).toEqual(
    legacyDefaultTitles,
  );
  const nextAction = page.locator(".operator-next-action");
  await expect(nextAction).toContainText("БиОТ");
  await expect(page.locator(".operator-readiness")).not.toContainText(
    /\b(?:BIOT|PTM|PB|PS)\b/,
  );
  const readinessBefore = await page.locator(".operator-readiness").innerText();
  const directionLabels = ["БиОТ", "ПТМ", "ПБ", "ПС"];
  const mainDirectionLabels: string[] = [];
  for (const label of directionLabels) {
    const mainChip = page.getByRole("button", {
      name: new RegExp(`^${label}:`),
    });
    await expect(mainChip).toHaveCount(1);
    mainDirectionLabels.push(await mainChip.innerText());
  }
  await page
    .getByRole("button", {
      name: /^Настройки обучения получателя 1:/,
    })
    .click();
  const dictionaryDialog = page.getByRole("dialog", {
    name: "Назначить обучение",
    exact: true,
  });
  await expect(dictionaryDialog).toBeVisible();
  const removalLabels: string[] = [];
  for (const label of directionLabels) {
    const removalButton = dictionaryDialog.getByRole("button", {
      name: `Снять ${label} · 1`,
      exact: true,
    });
    await expect(removalButton).toBeVisible();
    await expect(removalButton).toBeInViewport();
    removalLabels.push(await removalButton.innerText());
  }
  await expect(
    dictionaryDialog.getByRole("button", {
      name: /^Снять (BIOT|PTM|PB|PS)\b/,
    }),
  ).toHaveCount(0);
  await page.screenshot({
    path: path.join(evidenceRoot, "training-direction-dictionary-all-four.png"),
  });
  await dictionaryDialog
    .getByRole("button", { name: "Отмена", exact: true })
    .click();
  await expect(dictionaryDialog).toHaveCount(0);
  const dictionaryAfterCancel = await read(page, formCreated.id);
  expect(dictionaryAfterCancel.revision).toBe(formReadback.revision);
  expect(dictionaryAfterCancel.items).toEqual(formReadback.items);
  expect(dictionaryAfterCancel.events).toEqual(formReadback.events);
  await fs.writeFile(
    path.join(evidenceRoot, "training-direction-dictionary-all-four.json"),
    JSON.stringify(
      {
        directionLabels,
        mainDirectionLabels,
        removalLabels,
        before: formReadback,
        afterCancel: dictionaryAfterCancel,
      },
      null,
      2,
    ),
  );
  await page.reload();
  await saved(page);
  const dictionaryAfterReload = await read(page, formCreated.id);
  expect(dictionaryAfterReload.revision).toBe(formReadback.revision);
  expect(dictionaryAfterReload.items).toEqual(formReadback.items);
  expect(dictionaryAfterReload.events).toEqual(formReadback.events);
  expect(dictionaryAfterReload.events?.map((event) => event.title)).toEqual(
    legacyDefaultTitles,
  );
  await expect(nextAction).toContainText("БиОТ");
  await expect(page.locator(".operator-readiness")).not.toContainText(
    /\b(?:BIOT|PTM|PB|PS)\b/,
  );
  await nextAction.scrollIntoViewIfNeeded();
  await evidence(page, "training-default-title-readiness-reload", {
    legacyDefaultTitles,
    readinessBefore,
    readinessAfterReload: await page.locator(".operator-readiness").innerText(),
    before: formReadback,
    afterCancel: dictionaryAfterCancel,
    afterReload: dictionaryAfterReload,
  });
});

test("UX10/23 company replacement, directory choice, pending input navigation, failure retry and all legal names preserve saved scope", async ({
  page,
}) => {
  if (fullSuiteRunId()) test.setTimeout(300000);
  await fullSuitePageApiCooldown(
    page,
    evidenceRoot,
    "before-company-replacement",
  );
  const headers = await login(page);
  const companyResponse = await page.request.post("/api/customers", {
    headers,
    data: {
      legalForm: "AO",
      ownNameRu: `Синтетический Справочник ${Date.now()}`,
      ownNameKz: "Тест анықтамалық",
    },
  });
  expect(companyResponse.ok(), await companyResponse.text()).toBe(true);
  const existing = await companyResponse.json();
  const draft = await create(page, headers, 1, {
    kind: "COMPANY",
    customerId: existing.id,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/requests/${draft.id}/edit`);
  await expect(
    page.locator(".request-organization-selected-compact"),
  ).toContainText(existing.nameRu);
  await expect(
    page.getByText(
      "Добавьте организацию в заявку или отмените её ввод перед выходом.",
      { exact: true },
    ),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Сменить компанию", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Новая компания", exact: true })
    .click();
  const companyName = page.getByLabel("Название компании", { exact: true });
  await companyName.fill("Синтетический неприменённый ввод");
  await page.getByRole("link", { name: "← Все заявки", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/requests/${draft.id}/edit$`));
  await expect(companyName).toHaveValue("Синтетический неприменённый ввод");
  expect((await read(page, draft.id)).customerId).toBe(existing.id);
  const reloadDialog = page.waitForEvent("dialog");
  await page.evaluate(() => {
    setTimeout(() => location.reload(), 0);
  });
  const leave = await reloadDialog;
  expect(leave.type()).toBe("beforeunload");
  await leave.dismiss();
  await expect(companyName).toHaveValue("Синтетический неприменённый ввод");
  let logoutPosts = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/auth/logout"
    )
      logoutPosts++;
  });
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(
    page.getByText(
      "Добавьте организацию в заявку или отмените её ввод перед выходом.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(logoutPosts).toBe(0);
  await expect(companyName).toHaveValue("Синтетический неприменённый ввод");
  const backDialog = page.waitForEvent("dialog");
  await page.evaluate(() => history.back());
  const backLeave = await backDialog;
  expect(backLeave.type()).toBe("beforeunload");
  await backLeave.dismiss();
  await expect(page).toHaveURL(new RegExp(`/requests/${draft.id}/edit$`));
  await expect(companyName).toHaveValue("Синтетический неприменённый ввод");
  expect((await read(page, draft.id)).customerId).toBe(existing.id);
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(
    page.getByText(
      "Добавьте организацию в заявку или отмените её ввод перед выходом.",
      { exact: true },
    ),
  ).toHaveCount(0);
  await expect(
    page.locator(".request-organization-selected-compact"),
  ).toContainText(existing.nameRu);
  await page
    .getByRole("button", { name: "Сменить компанию", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Найти в справочнике", exact: true })
    .click();
  const picker = page.getByRole("dialog", {
    name: "Найти заказчика",
    exact: true,
  });
  await picker
    .getByLabel("Поиск по справочнику", { exact: true })
    .fill(existing.ownNameRu);
  await picker
    .getByRole("row")
    .filter({ hasText: existing.nameRu })
    .getByRole("button", { name: "Выбрать", exact: true })
    .click();
  await expect(picker).toHaveCount(0);
  await saved(page);
  expect((await read(page, draft.id)).customerId).toBe(existing.id);
  await page
    .getByRole("button", { name: `Готово: ${existing.nameRu}`, exact: true })
    .click();
  const reports = [];
  for (const [index, legalForm] of ["TOO", "IP", "AO"].entries()) {
    await page
      .getByRole("button", { name: "Сменить компанию", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Новая компания", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Форма компании", exact: true })
      .selectOption(legalForm);
    const ownNameRu =
      index === 2
        ? `Синтетическая длинная компания ${"данные ".repeat(18)}${Date.now()}`
        : `Тест ${legalForm} ${Date.now()}`;
    await companyName.fill(ownNameRu);
    const ownNameKz =
      index === 1 ? `Синтетикалық өзгеше ұйым ${Date.now()}` : "";
    if (ownNameKz) {
      await page.locator(".organization-extra-name > summary").click();
      await page
        .getByLabel("Собственное наименование на казахском отличается", {
          exact: true,
        })
        .check();
      await page
        .getByLabel("Собственное наименование · KZ", { exact: true })
        .fill(ownNameKz);
      await expect(companyName).toHaveValue(ownNameRu);
    }
    if (index === 0) {
      let failed = false;
      await page.route("**/api/customers", async (route) => {
        if (!failed && route.request().method() === "POST") {
          failed = true;
          return route.fulfill({
            status: 503,
            json: { message: "СИНТЕТИЧЕСКИЙ отказ создания до записи" },
          });
        }
        return route.continue();
      });
      await page
        .getByRole("button", { name: "Использовать эту компанию", exact: true })
        .click();
      await expect(
        page.getByText("СИНТЕТИЧЕСКИЙ отказ создания до записи", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(companyName).toHaveValue(ownNameRu);
      expect((await read(page, draft.id)).customerId).toBe(existing.id);
      await page.unroute("**/api/customers");
    }
    await page
      .getByRole("button", { name: "Использовать эту компанию", exact: true })
      .click();
    await saved(page);
    const current = await read(page, draft.id);
    const company = await (
      await page.request.get(`/api/customers/${current.customerId}`)
    ).json();
    expect(company.legalForm).toBe(legalForm);
    expect(company.ownNameRu).toBe(ownNameRu);
    expect(company.ownNameKz).toBe(ownNameKz);
    if (ownNameKz) {
      expect(company.nameKz).toContain(ownNameKz);
      expect(company.nameRu).toContain(ownNameRu);
      expect(company.nameKz).not.toContain(ownNameRu);
    }
    await page.reload();
    const compact = page.locator(".request-organization-selected-compact");
    await expect(compact).toContainText(company.nameRu);
    await compact.locator("details > summary").click();
    await expect(compact).toContainText(company.nameKz);
    await expect(
      compact.getByRole("button", {
        name: "Изменить общую карточку организации",
        exact: true,
      }),
    ).toBeVisible();
    await compact.locator("details > summary").click();
    for (const width of [1440, 1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      if (width >= 1280) {
        const bounds = await page
          .getByLabel("ФИО, строка 1", { exact: true })
          .boundingBox();
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900);
      }
    }
    reports.push({
      legalForm,
      companyId: company.id,
      nameRu: company.nameRu,
      nameKz: company.nameKz,
      ownNameRu: company.ownNameRu,
      ownNameKz: company.ownNameKz,
      customerIdAfterReload: (await read(page, draft.id)).customerId,
    });
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  await evidence(page, "company-replacement-directory-failure", {
    reports,
    originalCustomerId: existing.id,
    pendingNavigationBlocked: true,
    cancelledReloadPreservedInput: true,
    pendingLogoutPosts: logoutPosts,
    browserBackBlockedWithoutLosingInput: true,
    cancelledSelectionPreserved: true,
  });
});

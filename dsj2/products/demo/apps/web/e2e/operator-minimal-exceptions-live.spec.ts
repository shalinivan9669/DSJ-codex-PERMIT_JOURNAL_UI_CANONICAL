import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import {
  employeeCategoryFor,
  isTechnicalBlankRecipient,
  mandatoryTemplates,
  selectAssignmentScope,
  trainingDirection,
} from "@demo/contracts";
import { loginRole, readPrintDetail } from "./operator-role-fixture";
import type { Recipient } from "../lib/types";

test("saved person and explicit exceptions survive common date, added course and reload through UI", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  expect(new URL(process.env.DEMO_ORIGIN!).hostname).toBe("127.0.0.1");
  await loginRole(page, "OPERATOR");
  const started = Date.now();
  const sourceResponse = await page.request.get(
    "/api/recipients?search=" +
      encodeURIComponent("Синтет") +
      "&page=1&pageSize=20",
  );
  expect(sourceResponse.ok()).toBe(true);
  const records = (await sourceResponse.json()) as {
    items: { id: string; data: Recipient }[];
  };
  let source = records.items.find((record) =>
    /синтет/i.test(record.data.fullNameRu),
  );
  if (!source) {
    const sourceName = `Синтетический сохранённый ${randomUUID().slice(0, 8)}`;
    await page.goto("/requests/new");
    await page.getByRole("radio", { name: "Организация", exact: true }).check();
    await page.getByRole("button", { name: "Далее", exact: true }).click();
    await page.getByLabel("ФИО, строка 1", { exact: true }).fill(sourceName);
    await page
      .getByRole("button", { name: "Детали получателя 1", exact: true })
      .click();
    const sourceModal = page.getByRole("dialog", {
      name: "Настройки строки 1",
      exact: true,
    });
    await sourceModal
      .getByRole("tab", { name: "Личные данные", exact: true })
      .click();
    await sourceModal
      .locator("summary")
      .filter({ hasText: "Работодатель, справочник и история" })
      .click();
    await sourceModal
      .locator("summary")
      .filter({ hasText: "Постоянная запись, работодатель и история" })
      .click();
    await sourceModal
      .getByLabel(
        "Подтверждаю актуальность сведений для постоянной записи человека",
        { exact: true },
      )
      .check();
    await sourceModal
      .getByRole("button", {
        name: "Сохранить человека в справочник",
        exact: true,
      })
      .click();
    await expect(
      sourceModal.getByRole("button", {
        name: "Обновить текущие сведения человека",
        exact: true,
      }),
    ).toBeVisible();
    await sourceModal
      .getByRole("button", { name: "Вернуться к списку", exact: true })
      .click();
    const created = (await (
      await page.request.get(
        "/api/recipients?search=" +
          encodeURIComponent(sourceName) +
          "&pageSize=20",
      )
    ).json()) as { items: { id: string; data: Recipient }[] };
    source = created.items[0];
  }
  expect(
    source,
    "A saved synthetic person must already exist; this test never API-prefills one",
  ).toBeTruthy();
  const storedBefore = await (
    await page.request.get(`/api/recipients/${source!.id}`)
  ).json();
  const partialName = `Синтетический неполный ${randomUUID().slice(0, 8)}`;
  await page.goto("/requests/new");
  await page.getByRole("radio", { name: "Организация", exact: true }).check();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(page).toHaveURL(/\/requests\/[a-f0-9-]+\/edit$/);
  const id = /\/requests\/([a-f0-9-]+)\/edit$/.exec(page.url())![1];
  await page.getByLabel("ФИО, строка 1", { exact: true }).fill(partialName);
  await page.locator("summary").filter({ hasText: /^Ещё$/ }).click();
  await page
    .getByRole("button", { name: "Найти человека", exact: true })
    .click();
  const picker = page.getByRole("dialog", {
    name: "Найти существующего получателя",
    exact: true,
  });
  await picker
    .getByLabel("Поиск по справочнику", { exact: true })
    .fill(source!.data.fullNameRu);
  await picker
    .getByRole("row")
    .filter({ has: page.getByText(source!.data.fullNameRu, { exact: true }) })
    .first()
    .getByRole("button", { name: "Выбрать", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Вернуться к списку", exact: true })
    .click();
  await expect(page.getByLabel("ФИО, строка 1", { exact: true })).toHaveValue(
    partialName,
  );
  await expect(page.getByLabel("ФИО, строка 2", { exact: true })).toHaveValue(
    source!.data.fullNameRu,
  );
  for (const course of ["БиОТ", "ПТМ", "ПБ"])
    await page
      .getByRole("button", {
        name: `${course}: добавить всем в заявке (2)`,
        exact: true,
      })
      .click();
  await expect
    .poll(async () => {
      const saved = await readPrintDetail(page, id);
      const assignments = saved.items[1]?.assignments || [];
      return [...new Set(assignments.map((assignment) =>
        trainingDirection(assignment.templateId),
      ))].sort();
    })
    .toEqual(["BIOT", "PB", "PTM"]);
  const before = await readPrintDetail(page, id);
  const reused = before.items[1];
  expect(reused.recipientId).toBe(source!.id);
  expect(reused.employeeCategory).toBe(source!.data.employeeCategory || "WORKER");
  for (const direction of ["BIOT", "PTM", "PB"] as const) {
    const assignments = reused.assignments.filter(
      (assignment) => trainingDirection(assignment.templateId) === direction,
    );
    const primary = assignments.find(
      (assignment) => !assignment.templateId.endsWith("-protocol"),
    )!;
    expect(primary).toBeTruthy();
    const mode = before.events?.find((event) => event.id === primary.eventId)
      ?.protocolMode || primary.protocolMode;
    const expected = mandatoryTemplates(direction, employeeCategoryFor(reused))
      .filter((templateId) => mode !== "GROUP" || !templateId.endsWith("-protocol"));
    expect(assignments.map((assignment) => assignment.templateId).sort())
      .toEqual([...expected].sort());
  }
  expect(
    reused.assignments.every(
      (assignment) => assignment.outcome?.status === "PASSED",
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Детали получателя 2", exact: true })
    .click();
  const modal = page.getByRole("dialog", {
    name: "Настройки строки 2",
    exact: true,
  });
  const outcomes = { BIOT: "UNKNOWN", PTM: "FAILED", PB: "ABSENT" } as const;
  const chosen = Object.keys(outcomes).map(
    (direction) =>
      reused.assignments.find(
        (assignment) =>
          trainingDirection(assignment.templateId) === direction &&
          !assignment.templateId.endsWith("-protocol"),
      )!,
  );
  for (const assignment of chosen) {
    const detail = modal.locator(
      `details[data-assignment-id="${assignment.id}"]`,
    );
    if ((await detail.getAttribute("open")) === null)
      await detail.locator(":scope > summary").click();
    if (assignment === chosen[0]) {
      await detail.locator(".document-date-details > summary").click();
      await detail
        .getByLabel("Действителен до", { exact: true })
        .fill("2030-12-31");
      await detail.locator('input[data-field-path$=".hours"]').fill("");
    }
    await detail
      .getByRole("tab", { name: "Обучение и результат", exact: true })
      .click();
    await detail
      .getByLabel("Исход обучения", { exact: true })
      .selectOption(
        outcomes[
          trainingDirection(assignment.templateId) as keyof typeof outcomes
        ],
      );
  }
  await modal
    .getByRole("button", { name: "Вернуться к списку", exact: true })
    .click();
  await page.getByLabel("ФИО, строка 2", { exact: true }).press("Enter");
  await expect(page.getByLabel("ФИО, строка 3", { exact: true })).toHaveValue(
    "",
  );
  await page
    .locator('input[data-field-path="commonFields.documentDate"]')
    .fill("2026-10-15");
  await page
    .getByRole("button", {
      name: "ПС: добавить всем в заявке (3)",
      exact: true,
    })
    .click();
  await expect
    .poll(async () => {
      const saved = await readPrintDetail(page, id);
      return (
        saved.commonFields?.documentDate === "2026-10-15" &&
        saved.items[1]?.assignments.some(
          (assignment) => trainingDirection(assignment.templateId) === "PS",
        )
      );
    })
    .toBe(true);
  await page.reload();
  await expect(page.getByLabel("ФИО, строка 1", { exact: true })).toHaveValue(
    partialName,
  );
  const after = await readPrintDetail(page, id);
  const person = after.items.find((item) => item.recipientId === source!.id)!;
  for (const [direction, outcome] of Object.entries(outcomes)) {
    const assignments = person.assignments.filter(
      (assignment) => trainingDirection(assignment.templateId) === direction,
    );
    expect(assignments.length).toBeGreaterThan(0);
    expect(
      assignments.every((assignment) => assignment.outcome?.status === outcome),
    ).toBe(true);
    expect(
      assignments.every(
        (assignment) => assignment.fieldOrigins?.outcome === "MANUAL",
      ),
    ).toBe(true);
  }
  const exception = person.assignments.find(
    (assignment) => assignment.id === chosen[0].id,
  )!;
  expect(exception.validUntil).toBe("2030-12-31");
  expect(exception.fieldOrigins?.validUntil).toBe("MANUAL");
  expect(exception.hours).toBe("");
  expect(exception.fieldOrigins?.hours).toBe("CLEARED");
  const technicalBlank = after.items.find(
    (item) => !item.fullNameRu && !item.fullNameKz,
  )!;
  expect(technicalBlank).toBeTruthy();
  expect(isTechnicalBlankRecipient(technicalBlank)).toBe(true);
  expect(
    selectAssignmentScope(after).assignments.some(
      (entry) => entry.rowId === technicalBlank.id,
    ),
  ).toBe(false);
  expect(
    after.items.find((item) => item.fullNameRu === partialName)?.positionRu,
  ).toBe("");
  expect(after.status).toBe("DRAFT");
  expect(after.approval?.status).not.toBe("PENDING");
  const storedAfter = await (
    await page.request.get(`/api/recipients/${source!.id}`)
  ).json();
  expect(storedAfter.data).toEqual(storedBefore.data);
  await page.screenshot({
    path: testInfo.outputPath("exceptions-after-reload.png"),
    fullPage: true,
  });
  await fs.writeFile(
    testInfo.outputPath("exceptions-proof.json"),
    JSON.stringify(
      {
        requestId: id,
        sourceRecipientId: source!.id,
        elapsedMs: Date.now() - started,
        inputViaUiOnly: true,
        profileChanged: false,
        status: after.status,
        approval: after.approval ?? null,
        preservedPartialRow: true,
        technicalBlankExcludedFromIssuanceScope: true,
        sourceRecordUnchanged: true,
        outcomes,
        manualValidity: exception.validUntil,
        validityOrigin: exception.fieldOrigins?.validUntil,
        hours: exception.hours,
        hoursOrigin: exception.fieldOrigins?.hours,
        commonDate: after.commonFields?.documentDate,
      },
      null,
      2,
    ),
  );
});

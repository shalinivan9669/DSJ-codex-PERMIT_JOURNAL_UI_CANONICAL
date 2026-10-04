import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { draftSchema } from "@demo/contracts";
import { draftPayload, type Draft } from "../lib/types";

import { loginIsolated as login } from "./operator-full-fix-session";
import { fullSuitePageApiCooldown } from "./operator-full-suite";

test.use({ trace: "off" });

function fixture(individual = false) {
  return draftSchema.parse({
    kind: "PERSON",
    title: `СИНТЕТИЧЕСКИЙ UX integrity ${Date.now()}`,
    demoMode: true,
    schemaVersion: 2,
    commonFields: { documentDate: "2026-10-03" },
    trainingDefaults: [{ direction: "BIOT", eventIds: ["ux-biот-event"] }],
    events: [
      {
        id: "ux-biот-event",
        title: "Синтетическая группа БиОТ",
        protocolTemplateId: "biot-protocol",
        protocolMode: individual ? "INDIVIDUAL" : "GROUP",
        protocolModeSource: individual ? "MANUAL" : "AUTO",
        commonFields: {
          documentDate: "2026-10-03",
          trainingSubject: "Общая синтетическая программа",
          trainingStart: "2026-10-01",
          trainingEnd: "2026-10-02",
          protocolDate: "2026-10-02",
          hours: "10",
          productionHours: "16",
          biotCategory: "WORKER",
        },
      },
    ],
    items: [1, 2].map((number) => ({
      id: `ux-person-${number}`,
      employeeCategory: "WORKER",
      fullNameRu: `Синтетический Получатель ${number}`,
      positionRu: "Синтетическая должность",
      workplaceRu: "Синтетическое предприятие",
      assignments: [
        {
          id: `ux-biot-${number}`,
          templateId: "biot-worker-card",
          eventId: "ux-biот-event",
          protocolMode: individual ? "INDIVIDUAL" : "GROUP",
          documentDate: "2026-10-04",
          fieldOrigins: {
            documentDate: "IMPORTED",
            trainingSubject: individual ? "MANUAL" : "INHERITED",
            hours: "INHERITED",
            productionHours: "INHERITED",
          },
          trainingSubject: individual ? "Ручная синтетическая программа" : "",
          outcome: {
            status: "PASSED",
            source:
              "СИНТЕТИЧЕСКАЯ известная ведомость UX, не реальное обучение",
          },
        },
      ],
    })),
  });
}
async function create(
  page: Page,
  headers: Record<string, string>,
  individual = false,
) {
  const response = await page.request.post("/api/print-requests", {
    headers,
    data: fixture(individual),
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as Draft;
}
async function read(page: Page, id: string) {
  const response = await page.request.get(`/api/print-requests/${id}`);
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as Draft;
}
async function saved(page: Page) {
  await expect(page.locator(".save-indicator")).toContainText(
    /Рабочая версия сохранена|Согласовано|Сохранено/,
  );
}
async function evidence(name: string, value: unknown) {
  const target = process.env.DEMO_E2E_EVIDENCE
    ? path.join(path.resolve(process.env.DEMO_E2E_EVIDENCE), "domain-browser")
    : path.resolve(
        __dirname,
        "../../../docs/evidence/operator-flow-full-fix-20261003/domain/browser",
      );
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(
    path.join(target, `${name}.json`),
    JSON.stringify(value, null, 2),
  );
}
async function removeFirst(page: Page) {
  await page.getByLabel("Выбрать строку 1", { exact: true }).check();
  await page
    .getByRole("button", { name: "БиОТ: снять у этой группы (1)", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Снять обучение у этой группы?",
    exact: true,
  });
  await expect(dialog).toContainText("1 получателей");
  await dialog
    .getByRole("button", {
      name: "Снять обучение у 1 получателей",
      exact: true,
    })
    .click();
  await expect(dialog).toHaveCount(0);
  await saved(page);
}

test("UX-01/02 scoped UI remove/reload/restore preserves IDs, dates, confirmations and an unrelated saved edit", async ({
  page,
}, testInfo) => {
  await fullSuitePageApiCooldown(page, testInfo.outputDir, "before-domain-remove-restore");
  const headers = await login(page);
  const created = await create(page, headers);
  const before = created.items[0].assignments[0];
  await page.goto(`/requests/${created.id}/edit`);
  await removeFirst(page);
  const removed = await read(page, created.id);
  expect(removed.items[0].assignments).toHaveLength(0);
  expect(removed.items[1].assignments[0].outcome).toEqual(
    created.items[1].assignments[0].outcome,
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Восстановить обучение", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Должность · RU, строка 2", { exact: true })
    .fill("Независимая правка после снятия");
  await saved(page);
  await page.screenshot({
    path: testInfo.outputPath("scoped-removed-reloaded.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Восстановить обучение", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Восстановить обучение", exact: true }),
  ).toHaveCount(0);
  await saved(page);
  const restored = await read(page, created.id);
  expect(restored.items[0].assignments[0]).toEqual(before);
  expect(restored.items[1].positionRu).toBe("Независимая правка после снятия");
  await page.reload();
  await page.getByLabel("ФИО, строка 1", { exact: true }).waitFor();
  expect((await read(page, created.id)).items[0].assignments[0]).toEqual(
    before,
  );
  await page.screenshot({
    path: testInfo.outputPath("scoped-restored.png"),
    fullPage: true,
  });
  await evidence("scoped-restoration", {
    requestId: created.id,
    before,
    removedAssignments: removed.items[0].assignments.length,
    restored: restored.items[0].assignments[0],
    unrelatedPosition: restored.items[1].positionRu,
  });
});

test("UX-28 conflict copy double activation creates exactly one new request and resumes its save lane", async ({
  page,
  browser,
}, testInfo) => {
  const headers = await login(page);
  const created = await create(page, headers);
  await page.goto(`/requests/${created.id}/edit`);
  const secondContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    storageState: await page.context().storageState(),
  });
  const second = await secondContext.newPage();
  try {
    await second.goto(`/requests/${created.id}/edit`);
    await second.getByLabel("ФИО, строка 1", { exact: true }).waitFor();
    await page
      .getByLabel("Должность · RU, строка 1", { exact: true })
      .fill("Актуальная серверная должность A");
    await expect
      .poll(async () => (await read(page, created.id)).items[0].positionRu)
      .toBe("Актуальная серверная должность A");
    const sourceBefore = await read(page, created.id);
    await second
      .getByLabel("Должность · RU, строка 1", { exact: true })
      .fill("Локальная должность B для новой копии");
    const dialog = second.getByRole("dialog", {
      name: "Заявка изменена в другом окне",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    const listedBefore = await (
      await page.request.get("/api/print-requests?pageSize=1")
    ).json();
    const creates: Array<{ key: string | undefined }> = [];
    second.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/api/print-requests")
      )
        creates.push({ key: request.headers()["idempotency-key"] });
    });
    await dialog
      .getByRole("button", { name: "Сохранить мой ввод в копию", exact: true })
      .dblclick();
    await expect(second).not.toHaveURL(
      new RegExp(`/requests/${created.id}/edit$`),
    );
    await second.getByLabel("ФИО, строка 1", { exact: true }).waitFor();
    const copiedId = new URL(second.url()).pathname.split("/")[2];
    expect(copiedId).toBeTruthy();
    expect(copiedId).not.toBe(created.id);
    const copied = await read(second, copiedId);
    expect(copied.items[0].positionRu).toBe(
      "Локальная должность B для новой копии",
    );
    const withoutConfirmationTime = (item: Draft["items"][number]) => ({
      ...item,
      assignments: item.assignments.map((assignment) => ({
        ...assignment,
        outcome: assignment.outcome && {
          ...assignment.outcome,
          confirmedAt: undefined,
        },
      })),
    });
    // A new request receives its own authenticated confirmation time. Raw
    // facts, form IDs, source and field origins are copied unchanged.
    expect(withoutConfirmationTime(copied.items[1])).toEqual(
      withoutConfirmationTime(sourceBefore.items[1]),
    );
    expect(creates).toHaveLength(1);
    expect(creates[0].key).toMatch(/^ux-copy-/);
    const listedAfter = await (
      await page.request.get("/api/print-requests?pageSize=1")
    ).json();
    expect(listedAfter.total).toBe(listedBefore.total + 1);
    const sourceAfter = await read(page, created.id);
    expect(sourceAfter.revision).toBe(sourceBefore.revision);
    expect(sourceAfter.items).toEqual(sourceBefore.items);
    await second
      .getByLabel("Должность · RU, строка 2", { exact: true })
      .fill("Сохранённая правка новой копии");
    await expect
      .poll(async () => (await read(second, copiedId)).items[1].positionRu)
      .toBe("Сохранённая правка новой копии");
    await saved(second);
    await expect(second.locator(".save-indicator")).not.toContainText(
      "Сохранение приостановлено",
    );
    await second.screenshot({
      path: testInfo.outputPath("conflict-copy-new-lane-saved.png"),
      fullPage: true,
    });
    await evidence("conflict-copy", {
      sourceId: created.id,
      copiedId,
      sourceBeforeRevision: sourceBefore.revision,
      sourceAfterRevision: sourceAfter.revision,
      createRequests: creates.length,
      idempotencyKeyPresent: !!creates[0].key,
      requestCountDelta: listedAfter.total - listedBefore.total,
      copiedLocalPosition: copied.items[0].positionRu,
      copiedLaneSavedPosition: (await read(second, copiedId)).items[1]
        .positionRu,
    });
  } finally {
    await secondContext.close();
  }
});

test("UX-01 persisted undo detects a changed training context and preserves both current data and removed facts", async ({
  page,
}, testInfo) => {
  const headers = await login(page);
  const created = await create(page, headers);
  await page.goto(`/requests/${created.id}/edit`);
  await removeFirst(page);
  const removed = await read(page, created.id);
  const changed = draftPayload(removed);
  changed.events![0].commonFields.trainingSubject =
    "Изменённая синтетическая программа второй вкладки";
  const response = await page.request.patch(
    `/api/print-requests/${created.id}`,
    { headers, data: { expectedRevision: removed.revision, draft: changed } },
  );
  expect(response.ok(), await response.text()).toBe(true);
  await page.reload();
  await page
    .getByRole("button", { name: "Восстановить обучение", exact: true })
    .click();
  const conflictDialog = page.getByRole("dialog", {
    name: "Восстановление требует сверки изменений",
    exact: true,
  });
  await expect(
    conflictDialog.getByText("Затронутые сведения изменились после снятия.", {
      exact: false,
    }),
  ).toBeVisible();
  const after = await read(page, created.id);
  expect(after.items[0].assignments).toHaveLength(0);
  expect(after.events![0].commonFields.trainingSubject).toBe(
    changed.events![0].commonFields.trainingSubject,
  );
  await page.screenshot({
    path: testInfo.outputPath("restore-context-conflict.png"),
    fullPage: true,
  });
  await conflictDialog
    .getByRole("button", { name: "Оставить текущие данные", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Восстановить обучение", exact: true }),
  ).toBeVisible();
  await evidence("restore-context-conflict", {
    requestId: created.id,
    revision: after.revision,
    program: after.events![0].commonFields.trainingSubject,
    assignments: after.items[0].assignments,
  });
});

test("UX-14 category correction cycles retain original event ID and confirmation without orphan groups", async ({
  page,
}, testInfo) => {
  const headers = await login(page);
  const created = await create(page, headers);
  await page.goto(`/requests/${created.id}/edit`);
  const states: unknown[] = [];
  for (let cycle = 0; cycle < 3; cycle++) {
    await page
      .getByLabel("Категория сотрудника, строка 1", { exact: true })
      .selectOption("ITR");
    await expect
      .poll(
        async () => (await read(page, created.id)).items[0].employeeCategory,
      )
      .toBe("ITR");
    await saved(page);
    const itr = await read(page, created.id);
    expect(itr.events).toHaveLength(2);
    expect(itr.items[0].assignments[0].outcome).toEqual(
      created.items[0].assignments[0].outcome,
    );
    states.push({
      category: "ITR",
      eventIds: itr.events!.map((event) => event.id),
    });
    await page
      .getByLabel("Категория сотрудника, строка 1", { exact: true })
      .selectOption("WORKER");
    await expect
      .poll(
        async () => (await read(page, created.id)).items[0].employeeCategory,
      )
      .toBe("WORKER");
    await saved(page);
    const worker = await read(page, created.id);
    expect(worker.events).toHaveLength(1);
    expect(worker.items[0].assignments).toHaveLength(1);
    expect(worker.items[0].assignments[0].id).toBe(
      created.items[0].assignments[0].id,
    );
    expect(worker.items[0].assignments[0].eventId).toBe(
      created.items[0].assignments[0].eventId,
    );
    states.push({
      category: "WORKER",
      eventIds: worker.events!.map((event) => event.id),
    });
  }
  await page.reload();
  await page.getByLabel("ФИО, строка 1", { exact: true }).waitFor();
  await page.screenshot({
    path: testInfo.outputPath("category-return-original-group.png"),
    fullPage: true,
  });
  await evidence("category-cycles", {
    requestId: created.id,
    states,
    after: (await read(page, created.id)).items[0].assignments,
  });
});

test("UX-15 protocol reset updates both form origins and resolved program after reload", async ({
  page,
}, testInfo) => {
  const headers = await login(page);
  const created = await create(page, headers, true);
  await page.goto(`/requests/${created.id}/edit`);
  await page
    .getByRole("button", { name: "Детали получателя 1", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  const protocolId = created.items[0].assignments.find(
    (assignment) => assignment.templateId === "biot-protocol",
  )!.id;
  const protocol = dialog.locator(
    `details[data-assignment-id="${protocolId}"]`,
  );
  await protocol.locator(":scope > summary").click();
  await protocol.getByRole("tab", { name: "Настройки", exact: true }).click();
  await protocol.getByText("Источники общих значений", { exact: true }).click();
  await protocol
    .locator("dl > div")
    .filter({ has: page.locator("dt", { hasText: /^Программа$/ }) })
    .getByRole("button", { name: "Вернуть общее значение", exact: true })
    .click();
  await expect
    .poll(async () =>
      (await read(page, created.id)).items[0].assignments.every(
        (assignment) =>
          assignment.fieldOrigins?.trainingSubject === "INHERITED",
      ),
    )
    .toBe(true);
  await saved(page);
  await protocol
    .getByRole("tab", { name: "Обучение и результат", exact: true })
    .click();
  await expect(
    protocol.getByLabel("Программа / тема обучения", { exact: true }),
  ).toHaveValue("Общая синтетическая программа");
  await page.screenshot({
    path: testInfo.outputPath("protocol-common-reset.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await page.reload();
  const readback = await read(page, created.id);
  const resolved = await (
    await page.request.get(`/api/print-requests/${created.id}/resolved`)
  ).json();
  expect(
    resolved.draft.items[0].assignments.every(
      (assignment: { trainingSubject: string }) =>
        assignment.trainingSubject === "Общая синтетическая программа",
    ),
  ).toBe(true);
  await evidence("linked-form-reset", {
    requestId: created.id,
    assignments: readback.items[0].assignments,
    resolvedAssignments: resolved.draft.items[0].assignments,
    provenance: resolved.provenance,
  });
});

test("UX-28 real two-tab conflict stays paused after dismissal and local edits until explicit reload", async ({
  page,
  browser,
}, testInfo) => {
  const headers = await login(page);
  const created = await create(page, headers);
  await page.goto(`/requests/${created.id}/edit`);
  const secondContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    storageState: await page.context().storageState(),
  });
  const second = await secondContext.newPage();
  try {
    await second.goto(
      `${new URL(page.url()).origin}/requests/${created.id}/edit`,
    );
    await second.getByLabel("ФИО, строка 1", { exact: true }).waitFor();
    await page
      .getByLabel("Должность · RU, строка 1", { exact: true })
      .fill("Сохранённая правка A");
    await expect
      .poll(async () => (await read(page, created.id)).items[0].positionRu)
      .toBe("Сохранённая правка A");
    let patches = 0;
    second.on("request", (request) => {
      if (
        request.method() === "PATCH" &&
        request.url().endsWith(`/print-requests/${created.id}`)
      )
        patches++;
    });
    await second
      .getByLabel("Должность · RU, строка 1", { exact: true })
      .fill("Несохранённая правка B");
    const dialog = second.getByRole("dialog", {
      name: "Заявка изменена в другом окне",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await second.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    const pausedCount = patches;
    await second
      .getByLabel("Должность · RU, строка 1", { exact: true })
      .fill("Несохранённая правка B ещё раз");
    await second
      .getByLabel("ФИО, строка 2", { exact: true })
      .fill("Локальный синтетический B");
    await second.waitForTimeout(1800); // More than three autosave debounce periods.
    expect(patches).toBe(pausedCount);
    await expect(dialog).toHaveCount(0);
    await expect(second.locator(".save-indicator")).toContainText(
      "Сохранение приостановлено",
    );
    expect((await read(page, created.id)).items[0].positionRu).toBe(
      "Сохранённая правка A",
    );
    await second.screenshot({
      path: testInfo.outputPath("conflict-paused-local-input.png"),
      fullPage: true,
    });
    await second
      .getByRole("button", { name: "Разрешить конфликт", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Загрузить версию сервера", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(
      second.getByLabel("Должность · RU, строка 1", {
        exact: true,
      }),
    ).toHaveValue("Сохранённая правка A");
    await second
      .getByLabel("Должность · RU, строка 1", { exact: true })
      .fill("Новая сохранённая правка B после решения");
    await expect
      .poll(async () => (await read(page, created.id)).items[0].positionRu)
      .toBe("Новая сохранённая правка B после решения");
    await evidence("conflict-pause", {
      requestId: created.id,
      firstConflictPatches: pausedCount,
      pausedPatches: patches - 1,
      after: (await read(page, created.id)).items[0].positionRu,
    });
  } finally {
    await secondContext.close();
  }
});

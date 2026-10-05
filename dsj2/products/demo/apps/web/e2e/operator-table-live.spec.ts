import { expect, test, type Page, type Locator } from "@playwright/test";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { newAssignment, newRecipient, type Draft } from "../lib/types";
import { loginIsolated } from "./operator-full-fix-session";
import { removeRestoreFocus } from "./operator-focus-acceptance-helpers";

test.use({ trace: "off" });
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    path.join(
      __dirname,
      "../../../docs/evidence/operator-flow-full-fix-20261003/preparation/table-browser",
    ),
);
async function readDraft(page: Page, requestId: string) {
  const response = await page.request.get(`/api/print-requests/${requestId}`);
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<Draft & { documents: unknown[] }>;
}
async function expand(details: Locator) {
  if (
    !(await details.evaluate((element) => (element as HTMLDetailsElement).open))
  )
    await details.locator(":scope > summary").click();
}
async function sharedSettings(page: Page) {
  await expand(page.locator("#request-training"));
  await expand(
    page
      .locator(".training-primary-context .training-advanced-settings")
      .filter({
        has: page.getByText("Дополнительные настройки обучения", {
          exact: true,
        }),
      }),
  );
  await expand(
    page
      .locator(
        ".training-primary-context .training-advanced-settings > details",
      )
      .filter({
        has: page.getByText("Даты и программа для всей заявки", {
          exact: true,
        }),
      }),
  );
}
async function createFixture(
  page: Page,
  headers: Record<string, string>,
  count: number,
) {
  const eventId = randomUUID();
  const response = await page.request.post("/api/print-requests", {
    headers,
    data: {
      kind: "COMPANY",
      title: `Синтетический аудит оператора · ${count} получателей · ${Date.now()}`,
      customerId: null,
      demoMode: true,
      schemaVersion: 2,
      commonFields: { documentDate: "2026-09-29" },
      events: [
        {
          id: eventId,
          title: "Синтетическая группа ПБ",
          protocolTemplateId: "pb-protocol",
          protocolMode: "GROUP",
          protocolModeSource: "MANUAL",
          revision: 0,
          commonFields: {},
        },
      ],
      items: Array.from({ length: count }, (_, index) => ({
        ...newRecipient(),
        fullNameRu: `${index % 3 ? "Иванов Иван Сергеевич" : "Иванова Александра Константиновна"} ${String(index + 1).padStart(3, "0")}`,
        fullNameKz: `Әбдірахманов Нұрсұлтан Мұхамеджанұлы ${String(index + 1).padStart(3, "0")}`,
        positionRu: index % 2 ? "Мастер" : "Инженер",
        positionKz: index % 2 ? "Шебер" : "Инженер",
        workplaceRu:
          index % 7
            ? "Синтетическая организация Альфа"
            : "Синтетическая организация Бета, производственный участок № 2",
        workplaceKz: "Синтетикалық ұйым",
        assignments: [
          {
            ...newAssignment("pb-card"),
            eventId: eventId,
            protocolMode: "GROUP",
          },
        ],
      })),
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const created: Draft = await response.json();
  await page.goto(`/requests/${created.id}/edit`);
  await expect(page.locator(".operator-grid tbody tr")).toHaveCount(count);
  const saved = await readDraft(page, created.id);
  expect(saved.items).toHaveLength(count);
  expect(saved.items.every((item) => item.assignments.every((assignment) => assignment.outcome?.status === "PASSED"))).toBe(true);
  return saved;
}
for (const count of [100, 150, 250]) {
  test(`${count} real recipients: keyboard editing, scoped selection, bilingual fields, autosave and reload`, async ({
    page,
  }) => {
    test.setTimeout(360000);
    await fs.mkdir(evidence, { recursive: true });
    const headers = await loginIsolated(page),
      started = performance.now(),
      before = await createFixture(page, headers, count),
      expectedItems = structuredClone(before.items),
      requestId = before.id,
      fixtureUrl = page.url();
    await fs.writeFile(
      path.join(evidence, `fixture-${count}.json`),
      JSON.stringify(
        { requestId, url: fixtureUrl, count, synthetic: true, issued: false },
        null,
        2,
      ),
    );
    const checkpoints: unknown[] = [];
    const field = (row: number, key: string) =>
      page.locator(
        `.operator-grid [data-field-path="items.${row - 1}.${key}"]`,
      );
    const firstName = field(1, "fullNameRu"),
      firstPosition = field(1, "positionRu");
    expectedItems[0].fullNameRu = `Первый Оператор ${count}`;
    await firstName.fill(expectedItems[0].fullNameRu);
    await firstName.press("Enter");
    await expect(field(2, "fullNameRu")).toBeFocused();
    await page.keyboard.press("Shift+Enter");
    await expect(firstName).toBeFocused();
    await firstName.press("Tab");
    await expect(firstPosition).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(firstName).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(firstPosition).toBeFocused();
    checkpoints.push({
      step: "keyboard-first-row",
      elapsedMs: performance.now() - started,
      active: await page.evaluate(() =>
        document.activeElement?.getAttribute("data-field-path"),
      ),
    });
    await page.getByLabel("Поиск в заявке", { exact: true }).fill("Мастер");
    await expect(page.locator(".operator-grid tbody tr")).toHaveCount(
      count / 2,
    );
    await page
      .getByLabel("Выбрать видимых получателей", { exact: true })
      .check();
    await expect(page.locator(".selection-toolbar")).toContainText(
      `Выбрано: ${count / 2}`,
    );
    await page
      .getByRole("button", { name: "Сбросить фильтры", exact: true })
      .click();
    await expect(
      page.getByLabel("Выбрать строку 1", { exact: true }),
    ).not.toBeChecked();
    await expect(
      page.getByLabel("Выбрать строку 2", { exact: true }),
    ).toBeChecked();
    await expect(
      page.getByLabel(`Выбрать строку ${count}`, { exact: true }),
    ).toBeChecked();
    await page
      .getByRole("button", { name: "Снять выделение строк", exact: true })
      .click();
    checkpoints.push({
      step: "scoped-filter-selection",
      elapsedMs: performance.now() - started,
      selectedVisible: count / 2,
    });
    expectedItems[count - 1].fullNameRu = `Последний Оператор ${count}`;
    expectedItems[count - 1].positionRu = `Старший мастер ${count}`;
    const lastName = field(count, "fullNameRu"),
      lastPosition = field(count, "positionRu");
    await lastName.fill(expectedItems[count - 1].fullNameRu);
    await lastName.press("Tab");
    await expect(lastPosition).toBeFocused();
    await lastPosition.fill(expectedItems[count - 1].positionRu!);
    await lastPosition.press("Shift+Tab");
    await expect(lastName).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(lastPosition).toBeFocused();
    expectedItems[count - 1].fullNameKz = `Соңғы Оператор ${count}`;
    expectedItems[count - 1].positionKz = `Аға шебер ${count}`;
    await field(count, "positionKz").fill(expectedItems[count - 1].positionKz!);
    await page
      .getByRole("button", { name: `Детали получателя ${count}`, exact: true })
      .click();
    let modal = page.getByRole("dialog");
    await modal
      .getByRole("tab", { name: "Личные данные", exact: true })
      .click();
    await expand(
      modal
        .locator("details")
        .filter({
          has: page.getByText(/^Казахский вариант/),
        })
        .first(),
    );
    await modal
      .locator(`[data-field-path="items.${count - 1}.fullNameKz"]`)
      .fill(expectedItems[count - 1].fullNameKz!);
    await modal
      .getByRole("button", { name: "Вернуться к списку", exact: true })
      .click();
    await expect
      .poll(async () => (await readDraft(page, requestId)).items)
      .toEqual(expectedItems);
    const afterSave = await readDraft(page, requestId);
    expect(afterSave.revision).toBeGreaterThan(before.revision);
    checkpoints.push({
      step: "last-row-bilingual-saved",
      elapsedMs: performance.now() - started,
      revision: afterSave.revision,
    });
    await sharedSettings(page);
    const sharedValue = `Общая программа для ${count} получателей`;
    const savedCommon = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().endsWith(`/api/print-requests/${requestId}`) &&
        response.request().postDataJSON()?.draft?.commonFields
          ?.trainingSubject === sharedValue,
    );
    await page
      .getByLabel("Программа / тема для заявки", { exact: true })
      .fill(sharedValue);
    expect((await savedCommon).ok()).toBe(true);
    const afterAutosave = await readDraft(page, requestId);
    expect(afterAutosave.commonFields?.trainingSubject).toBe(sharedValue);
    expect(afterAutosave.items).toEqual(expectedItems);
    expect(afterAutosave.revision).toBeGreaterThan(afterSave.revision);
    checkpoints.push({
      step: "common-autosaved",
      elapsedMs: performance.now() - started,
      revision: afterAutosave.revision,
    });
    await page.reload();
    await expect(page.locator(".operator-grid tbody tr")).toHaveCount(count);
    await expect(page.locator(".operator-result-reminder")).toHaveCount(0);
    expect((await readDraft(page, requestId)).items).toEqual(expectedItems);
    await expect(lastName).toHaveValue(expectedItems[count - 1].fullNameRu);
    await expect(lastPosition).toHaveValue(
      expectedItems[count - 1].positionRu!,
    );
    await expect(field(count, "positionKz")).toHaveValue(
      expectedItems[count - 1].positionKz!,
    );
    await page
      .getByRole("button", { name: `Детали получателя ${count}`, exact: true })
      .click();
    modal = page.getByRole("dialog");
    await modal
      .getByRole("tab", { name: "Личные данные", exact: true })
      .click();
    await expect(
      modal.locator(`[data-field-path="items.${count - 1}.fullNameKz"]`),
    ).toHaveValue(expectedItems[count - 1].fullNameKz!);
    await modal
      .getByRole("button", { name: "Вернуться к списку", exact: true })
      .click();
    await sharedSettings(page);
    await expect(
      page.getByLabel("Программа / тема для заявки", { exact: true }),
    ).toHaveValue(sharedValue);
    await page.locator("#request-training > summary").click();
    const focusRecovery: unknown[] = [];
    if (count === 250) {
      for (const [index, options] of [
        [0, { cancelFirst: true, dirtyNeighbor: true }],
        [124, {}],
        [249, {}],
        [249, { filter: true }],
      ] as const) {
        focusRecovery.push(
          await removeRestoreFocus(
            page,
            requestId,
            expectedItems,
            index,
            readDraft,
            options,
          ),
        );
      }
      const single = await createFixture(page, headers, 1);
      focusRecovery.push({
        singleRecipient: true,
        ...(await removeRestoreFocus(
          page,
          single.id,
          structuredClone(single.items),
          0,
          readDraft,
          { cancelFirst: true, dirtyNeighbor: true },
        )),
      });
      await page.goto(fixtureUrl);
      await expect(page.locator(".operator-grid tbody tr")).toHaveCount(count);
      expect((await readDraft(page, requestId)).items).toEqual(expectedItems);
      await page
        .locator(
          `.operator-grid tr[data-recipient-id="${expectedItems[count - 1].id}"]`,
        )
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(evidence, "table-250-remove-restore-stable-ids.png"),
      });
    }
    const orderedIds = expectedItems.map((item) => item.id);
    expect(
      await page
        .locator(".operator-grid tbody tr")
        .evaluateAll((rows) =>
          rows.map((row) => row.getAttribute("data-recipient-id")),
        ),
    ).toEqual(orderedIds);
    for (const viewport of [
      { width: 1366, height: 768, name: "desktop" },
      { width: 390, height: 844, name: "narrow" },
    ]) {
      await page.setViewportSize(viewport);
      await page.locator(".operator-grid").scrollIntoViewIfNeeded();
      const measured = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth,
        viewport: innerWidth,
      }));
      expect(measured.page).toBeLessThanOrEqual(measured.viewport);
      checkpoints.push({
        step: `viewport-${viewport.name}`,
        elapsedMs: performance.now() - started,
        ...measured,
      });
      await page.screenshot({
        path: path.join(evidence, `table-${count}-${viewport.name}.png`),
      });
    }
    await page
      .getByLabel("Поиск в заявке", { exact: true })
      .fill(expectedItems[count - 1].fullNameRu);
    await expect(page.locator(".operator-grid tbody tr")).toHaveCount(1);
    await expect(lastName).toHaveValue(expectedItems[count - 1].fullNameRu);
    await page.screenshot({
      path: path.join(evidence, `table-${count}-narrow-search.png`),
    });
    const final = await readDraft(page, requestId);
    expect(final.items).toEqual(expectedItems);
    expect(final.commonFields?.trainingSubject).toBe(sharedValue);
    expect(final.status).toBe("DRAFT");
    expect(final.documents).toHaveLength(0);
    await fs.writeFile(
      path.join(evidence, `live-${count}-result.json`),
      JSON.stringify(
        {
          status: "PASS",
          checkedAt: new Date().toISOString(),
          requestId,
          rows: count,
          keyboard: ["Enter", "Shift+Enter", "Tab", "Shift+Tab"],
          orderedRecipientIds: orderedIds,
          focusRecovery,
          filteredSelection: count / 2,
          bilingualLastRowSaved: true,
          allRecipientFieldsMatchAfterReload: true,
          commonFieldsAutosavedWithoutSaveClick: true,
          revisions: [
            before.revision,
            afterSave.revision,
            afterAutosave.revision,
          ],
          elapsedMs: performance.now() - started,
          checkpoints,
          humanActiveMs: null,
          draftOnly: true,
          issuedDocuments: 0,
        },
        null,
        2,
      ),
    );
  });
}

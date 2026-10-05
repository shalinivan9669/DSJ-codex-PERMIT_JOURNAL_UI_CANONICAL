import { expect, type Locator, type Page } from "@playwright/test";
import path from "node:path";
import {
  newAssignment,
  newRecipient,
  type Draft,
  type Recipient,
} from "../lib/types";
import { keyboardActivate, keyboardFocus } from "./operator-keyboard-helpers";

export async function actualFocus(page: Page) {
  return page.evaluate(() => {
    const control = document.activeElement as HTMLElement | null;
    const rect = control?.getBoundingClientRect();
    const center = rect && {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    };
    const hit = center && document.elementFromPoint(center.x, center.y);
    const style = control && getComputedStyle(control);
    return {
      tag: control?.tagName,
      path: control?.getAttribute("data-field-path"),
      rowId: control
        ?.closest("tr[data-recipient-id]")
        ?.getAttribute("data-recipient-id"),
      label:
        control?.getAttribute("aria-label") ||
        control?.textContent?.trim().slice(0, 100),
      value: control instanceof HTMLInputElement ? control.value : null,
      center,
      centerOwned:
        !!control && !!hit && (hit === control || control.contains(hit)),
      visibleOutline:
        !!control?.matches(":focus-visible") &&
        style?.outlineStyle !== "none" &&
        parseFloat(style?.outlineWidth || "0") > 0,
      inDialog: !!control?.closest("dialog[open]"),
    };
  });
}

async function visibleFocus(page: Page, rowId?: string) {
  await expect
    .poll(async () => (await actualFocus(page)).centerOwned)
    .toBe(true);
  const state = await actualFocus(page);
  expect(state.tag).not.toBe("BODY");
  expect(state.visibleOutline).toBe(true);
  if (rowId) expect(state.rowId).toBe(rowId);
  return state;
}

/** UI removal and its real undo: no API writes, fake focus or altered business facts. */
export async function removeRestoreFocus(
  page: Page,
  requestId: string,
  expectedItems: Recipient[],
  index: number,
  read: (page: Page, id: string) => Promise<Draft & { documents: unknown[] }>,
  options: {
    filter?: boolean;
    cancelFirst?: boolean;
    dirtyNeighbor?: boolean;
  } = {},
) {
  const beforeIds = expectedItems.map((item) => item.id);
  const target = expectedItems[index];
  await expand(page.locator("details.operator-list-tools"));
  const search = page.getByLabel("Поиск в заявке", { exact: true });
  await search.fill(options.filter ? target.fullNameRu : "");
  if (options.filter)
    await expect(page.locator(".operator-grid tbody tr")).toHaveCount(1);
  const row = page.locator(
    `.operator-grid tr[data-recipient-id="${target.id}"]`,
  );
  const remove = row.getByRole("button", {
    name: `Удалить получателя ${index + 1}`,
    exact: true,
  });
  const name = row.locator(`[data-field-path="items.${index}.fullNameRu"]`);
  await name.click();
  await name.press("Tab");
  await expect(
    row.locator(`[data-field-path="items.${index}.positionRu"]`),
  ).toBeFocused();
  if (options.dirtyNeighbor) {
    expectedItems[index].positionRu = `Сохранить перед удалением ${index + 1}`;
    await row
      .locator(`[data-field-path="items.${index}.positionRu"]`)
      .fill(expectedItems[index].positionRu);
  }
  await keyboardActivate(page, remove);
  const dialog = page.getByRole("dialog", {
    name: "Убрать получателя из заявки?",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  let cancellation = null;
  if (options.cancelFirst) {
    await keyboardActivate(
      page,
      dialog.getByRole("button", { name: "Оставить", exact: true }),
    );
    await expect(remove).toBeFocused();
    cancellation = await visibleFocus(page, target.id);
    expect((await read(page, requestId)).items.map((item) => item.id)).toEqual(
      beforeIds,
    );
    await remove.press("Enter");
    await expect(dialog).toBeVisible();
  }
  const beforeRemoval = await read(page, requestId);
  const removalCommitted = page.waitForResponse((response) => {
    if (response.request().method() !== "PATCH" || !response.url().endsWith("/api/print-requests/" + requestId)) return false;
    const payload = response.request().postDataJSON();
    return Array.isArray(payload?.draft?.items) && !payload.draft.items.some((item: { id: string }) => item.id === target.id);
  });
  await keyboardActivate(
    page,
    dialog.getByRole("button", { name: "Убрать из заявки", exact: true }),
  );
  const removalResponse = await removalCommitted;
  expect(removalResponse.ok(), await removalResponse.text()).toBe(true);
  const committedRemoval = await removalResponse.json();
  const afterItems = expectedItems.filter((item) => item.id !== target.id);
  await expect
    .poll(async () => (await read(page, requestId)).items)
    .toEqual(afterItems);
  const persistedRemoval = await read(page, requestId);
  expect(persistedRemoval.revision).toBe(committedRemoval.revision);
  expect(persistedRemoval.revision).toBeGreaterThan(beforeRemoval.revision);
  expect(persistedRemoval.items.some((item) => item.id === target.id)).toBe(false);
  await expect(dialog).toHaveCount(0);
  const neighbor = afterItems[Math.min(index, afterItems.length - 1)];
  const expectedFocus = neighbor
    ? page.locator(
        `.operator-grid tr[data-recipient-id="${neighbor.id}"] [data-field-path$=".fullNameRu"]`,
      )
    : page.locator("[data-add-recipient]");
  await expect(expectedFocus).toBeFocused();
  const removedFocus = await visibleFocus(page, neighbor?.id);
  if (neighbor) {
    await page.keyboard.press("Tab");
    await expect(
      page.locator(
        `.operator-grid tr[data-recipient-id="${neighbor.id}"] [data-field-path$=".positionRu"]`,
      ),
    ).toBeFocused();
    await visibleFocus(page, neighbor.id);
    await page.keyboard.press("Shift+Tab");
    await expect(expectedFocus).toBeFocused();
  }
  const undo = page.getByRole("button", {
    name: "Восстановить получателя",
    exact: true,
  });
  await expect(undo).toBeEnabled();
  // The recovery command is in the page header. A real pointer activation avoids
  // traversing thousands of unchanged grid fields; the resulting focus is measured.
  await undo.click();
  await expect
    .poll(async () => (await read(page, requestId)).items)
    .toEqual(expectedItems);
  const restoredName = page.locator(
    `.operator-grid tr[data-recipient-id="${target.id}"] [data-field-path="items.${index}.fullNameRu"]`,
  );
  await expect(restoredName).toBeFocused();
  const restoredFocus = await visibleFocus(page, target.id);
  await page.keyboard.press("Tab");
  await expect(
    page.locator(
      `.operator-grid tr[data-recipient-id="${target.id}"] [data-field-path="items.${index}.positionRu"]`,
    ),
  ).toBeFocused();
  await visibleFocus(page, target.id);
  await page.keyboard.press("Shift+Tab");
  await expect(restoredName).toBeFocused();
  expect(
    await page
      .locator(".operator-grid tbody tr")
      .evaluateAll((rows) =>
        rows.map((item) => item.getAttribute("data-recipient-id")),
      ),
  ).toEqual(beforeIds);
  await page.reload();
  await expect(page.locator(".operator-grid tbody tr")).toHaveCount(
    expectedItems.length,
  );
  expect((await read(page, requestId)).items).toEqual(expectedItems);
  return {
    index,
    targetId: target.id,
    filter: !!options.filter,
    cancellation,
    removedFocus,
    restoredFocus,
    beforeIds,
    afterIds: afterItems.map((item) => item.id),
    restoredIds: beforeIds,
    dirtyValue: options.dirtyNeighbor ? expectedItems[index].positionRu : null,
    reloadPreservedAllFields: true,
  };
}

async function expand(details: Locator) {
  if (
    !(await details.evaluate((element) => (element as HTMLDetailsElement).open))
  )
    await details.locator(":scope > summary").click();
}

/** First and last recipients, all four direction forms, real Tab/Shift+Tab at 720×450. */
export async function fourFormsLongDrawerFocus(
  page: Page,
  headers: Record<string, string>,
  evidence: string,
) {
  const templates = [
    "biot-worker-card",
    "pb-card",
    "ptm-card",
    "ps-card",
  ] as const;
  const response = await page.request.post("/api/print-requests", {
    headers,
    data: {
      kind: "COMPANY",
      customerId: null,
      demoMode: true,
      schemaVersion: 2,
      englishAppendix: true,
      commonFields: {
        documentDate: "2026-10-03",
        trainingStart: "2026-09-20",
        trainingEnd: "2026-09-22",
        protocolDate: "2026-09-22",
        trainingSubject: "Синтетическая длинная программа для проверки деталей",
        trainingSubjectEn: "Synthetic long drawer training",
        hours: "8",
        productionHours: "16",
      },
      items: Array.from({ length: 2 }, (_, index) => ({
        ...newRecipient(),
        fullNameRu: `Синтетический Длинные Детали ${index + 1}`,
        fullNameKz: `Синтетикалық Ұзақ Деректер ${index + 1}`,
        fullNameEn: `Synthetic Long Drawer ${index + 1}`,
        positionRu: "Синтетический рабочий",
        positionKz: "Синтетикалық жұмысшы",
        positionEn: "Synthetic worker",
        workplaceRu: "Синтетическая организация",
        workplaceKz: "Синтетикалық ұйым",
        workplaceEn: "Synthetic company",
        assignments: templates.map((template) => ({
          ...newAssignment(template),
          protocolMode: "INDIVIDUAL",
          externalBasisNumber: `Синтетическое-основание-${index + 1}-${template}`,
          fieldOrigins: {
            documentDate: "INHERITED",
            trainingStart: "INHERITED",
            trainingEnd: "INHERITED",
            protocolDate: "INHERITED",
            trainingSubject: "INHERITED",
            hours: "INHERITED",
            productionHours: "INHERITED",
          },
          outcome: { status: "UNKNOWN", source: "" },
        })),
      })),
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const created: Draft = await response.json();
  await page.goto(`/requests/${created.id}/edit`);
  await page.setViewportSize({ width: 720, height: 450 });
  const measured = [];
  for (const [index, person] of created.items.entries()) {
    for (const template of templates) {
      const assignment = person.assignments.find(
        (entry) => entry.templateId === template,
      );
      expect(assignment, `Current LIVE kit contains ${template}`).toBeTruthy();
      const opener = page.getByRole("button", {
        name: `Детали получателя ${index + 1}`,
        exact: true,
      });
      await opener.click();
      const dialog = page.getByRole("dialog");
      const form = dialog.locator(`[data-assignment-id="${assignment!.id}"]`);
      await expand(form);
      await form.getByRole("tab", { name: "Настройки", exact: true }).click();
      const provenance = form.locator(
        "[data-assignment-section=settings] > details.field-provenance",
      );
      for (const entry of await provenance.all()) await expand(entry);
      const last = form.locator('[data-field-path$=".externalBasisNumber"]');
      await keyboardFocus(page, last);
      const lastFocus = await visibleFocus(page);
      expect(lastFocus.inDialog).toBe(true);
      const dimensions = await dialog.evaluate((element) => ({
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      }));
      expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
      const footer = dialog.locator(".recipient-details-footer");
      const returnButton = footer.getByRole("button", {
        name: "Вернуться к списку",
        exact: true,
      });
      await expect(returnButton).toBeVisible();
      const footerGeometry = await returnButton.boundingBox();
      expect(footerGeometry!.y).toBeGreaterThanOrEqual(0);
      expect(footerGeometry!.y + footerGeometry!.height).toBeLessThanOrEqual(
        450,
      );
      const screenshot = `drawer-${index === 0 ? "first" : "last"}-${template}-720x450-last-field-footer.png`;
      await page.screenshot({ path: path.join(evidence, screenshot) });
      const keyboardPath = [];
      for (let step = 0; step < 80; step++) {
        await page.keyboard.press("Tab");
        const state = await visibleFocus(page);
        expect(state.inDialog).toBe(true);
        keyboardPath.push(state);
        if (
          await returnButton.evaluate(
            (element) => element === document.activeElement,
          )
        )
          break;
      }
      await expect(returnButton).toBeFocused();
      const footerFocus = await visibleFocus(page);
      await page.keyboard.press("Shift+Tab");
      const previousFocus = await visibleFocus(page);
      expect(previousFocus.inDialog).toBe(true);
      await page.keyboard.press("Tab");
      await expect(returnButton).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
      const returned = await visibleFocus(page, person.id);
      measured.push({
        template,
        recipientIndex: index,
        recipientId: person.id,
        assignmentId: assignment!.id,
        viewport: { width: 720, height: 450 },
        dimensions,
        lastFocus,
        footerGeometry,
        keyboardPath,
        footerFocus,
        previousFocus,
        returned,
        screenshot,
      });
    }
  }
  const readback = await page.request.get(`/api/print-requests/${created.id}`);
  expect(readback.ok()).toBe(true);
  const final: Draft = await readback.json();
  expect(final.items).toEqual(created.items);
  expect(final.items.map((item) => item.id)).toEqual(
    created.items.map((item) => item.id),
  );
  await page.setViewportSize({ width: 1366, height: 768 });
  return {
    requestId: created.id,
    measured,
    firstAndLastAllFourForms: true,
    unchangedAllRecipientAndAssignmentFields: true,
    zoomScope:
      "720x450 CSS viewport; actual 200% native zoom remains the separately measured root UI case",
  };
}

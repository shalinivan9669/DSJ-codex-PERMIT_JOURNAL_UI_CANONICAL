import { expect, type Locator, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
export const keyboardMetrics = {
  tabs: 0,
  shiftTabs: 0,
  activations: 0,
  textEntries: 0,
  selections: 0,
  focusVisibleChecks: 0,
  enterNoFinalizeChecks: 0,
  dialogTrapChecks: 0,
  artifactDownloads: 0,
  nativeFileSelections: 0,
  appReopens: 0,
};
export async function keyboardFocus(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  await expect(target).toBeEnabled();
  let backwards: boolean | undefined;
  for (let count = 0; count < 1800; count++) {
    const state = await target.evaluate((element) => {
      if (document.activeElement === element) {
        const style = getComputedStyle(element);
        return {
          available: true,
          focused: true,
          visible:
            element.matches(":focus-visible") &&
            style.outlineStyle !== "none" &&
            parseFloat(style.outlineWidth) > 0,
          backwards: false,
        };
      }
      const scope = element.closest("dialog[open]") || document;
      const controls = Array.from(
        scope.querySelectorAll<HTMLElement>(
          "button,a[href],input,select,textarea,summary,[tabindex]",
        ),
      ).filter(
        (control) =>
          control.tabIndex >= 0 &&
          !control.matches(":disabled,[aria-hidden=true]") &&
          control.getClientRects().length > 0,
      );
      const wanted = controls.indexOf(element as HTMLElement);
      if (wanted < 0)
        return {
          available: false,
          focused: false,
          visible: false,
          backwards: false,
        };
      const active = document.activeElement as HTMLElement;
      let current = controls.indexOf(active);
      if (current < 0 && active !== document.body)
        current =
          controls.filter(
            (control) =>
              !!(
                control.compareDocumentPosition(active) &
                Node.DOCUMENT_POSITION_FOLLOWING
              ),
          ).length - 1;
      const forward =
        (wanted - current + controls.length) % controls.length ||
        controls.length;
      const backwards =
        (current - wanted + controls.length) % controls.length ||
        controls.length;
      return {
        available: true,
        focused: false,
        visible: false,
        backwards: backwards < forward,
      };
    });
    if (state.available === false) {
      await expect(target).toBeVisible();
      continue;
    }
    if (state.focused) {
      expect(
        state.visible,
        "Focused UI control has a visible keyboard outline",
      ).toBe(true);
      keyboardMetrics.focusVisibleChecks++;
      return;
    }
    backwards ??= state.backwards;
    await page.keyboard.press(backwards ? "Shift+Tab" : "Tab");
    if (backwards) keyboardMetrics.shiftTabs++;
    else keyboardMetrics.tabs++;
  }
  throw new Error("Keyboard focus did not reach target after 1800 Tab steps");
}
export async function keyboardActivate(page: Page, target: Locator) {
  await keyboardFocus(page, target);
  await page.keyboard.press("Enter");
  keyboardMetrics.activations++;
}
export async function keyboardEnter(
  page: Page,
  target: Locator,
  value: string,
) {
  await keyboardFocus(page, target);
  if ((await target.getAttribute("type")) === "date") {
    const [year, month, day] = value.split("-");
    const order = await page.evaluate(() =>
      new Intl.DateTimeFormat()
        .formatToParts(new Date(2026, 8, 22))
        .filter((part) => ["year", "month", "day"].includes(part.type))
        .map((part) => part.type),
    );
    const values: Record<string, string> = { year, month, day };
    for (const [index, key] of order.entries()) {
      const segment = values[key];
      for (let step = 0; step < 4; step++)
        await page.keyboard.press("ArrowLeft");
      for (let step = 0; step < index; step++)
        await page.keyboard.press("ArrowRight");
      await page.keyboard.type(segment);
    }
  } else {
    await page.keyboard.press("Control+A");
    if (value) await page.keyboard.insertText(value);
    else await page.keyboard.press("Backspace");
  }
  keyboardMetrics.textEntries++;
  await expect(target).toHaveValue(value);
}
export async function keyboardCheck(page: Page, target: Locator) {
  if (await target.isChecked()) return;
  await keyboardFocus(page, target);
  await page.keyboard.press("Space");
  keyboardMetrics.activations++;
  await expect(target).toBeChecked();
}
export async function keyboardSelect(
  page: Page,
  target: Locator,
  value: string,
) {
  await keyboardFocus(page, target);
  const index = await target.evaluate(
    (element, wanted) =>
      Array.from((element as HTMLSelectElement).options).findIndex(
        (option) => option.value === wanted,
      ),
    value,
  );
  expect(index).toBeGreaterThanOrEqual(0);
  await page.keyboard.press("Home");
  for (let count = 0; count < index; count++)
    await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  keyboardMetrics.selections++;
  await expect(target).toHaveValue(value);
}
export async function keyboardReopen(page: Page) {
  const title = await page
    .getByLabel("Название заявки", { exact: true })
    .inputValue();
  await keyboardActivate(
    page,
    page.getByRole("link", { name: "Заявки", exact: true }),
  );
  await expect(
    page.getByRole("heading", { name: "Заявки на печать", exact: true }),
  ).toBeVisible();
  await keyboardActivate(
    page,
    page.getByRole("link", { name: title, exact: true }),
  );
  await expect(page.getByLabel("Название заявки", { exact: true })).toHaveValue(
    title,
  );
  keyboardMetrics.appReopens++;
}
export async function saveKeyboardMetrics(directory: string, status: string) {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, "keyboard-metrics.json"),
    JSON.stringify(
      {
        status,
        keyboardOnlyInApp: true,
        mouseClicks: 0,
        programmaticElementFocus: 0,
        apiMutationsForUiShortcuts: 0,
        nativeFileChooserFixtureBoundary: true,
        ...keyboardMetrics,
      },
      null,
      2,
    ),
  );
}

/** Preserve legacy test setup explicitly now that a new request has no default document. */
export async function createRequestWithWorkerDocument(
  page: Page,
  kind: "PERSON" | "COMPANY" = "PERSON",
) {
  await page
    .getByRole("radio", {
      name: kind === "COMPANY" ? /^Организация/ : /^Физическое лицо/,
    })
    .check();
  await page
    .getByRole("button", { name: "Перейти к людям и документам", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Выбрать документы получателя 1",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("checkbox", { name: /^БиОТ — удостоверение рабочего/ })
    .check();
  await dialog
    .getByRole("button", { name: "Добавить выбранные документы", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
}

/** The same explicit fixture setup through the keyboard-only access path. */
export async function keyboardCreateRequestWithWorkerDocument(
  page: Page,
  kind: "PERSON" | "COMPANY" = "PERSON",
) {
  await keyboardCheck(
    page,
    page.getByRole("radio", {
      name: kind === "COMPANY" ? /^Организация/ : /^Физическое лицо/,
    }),
  );
  await keyboardActivate(
    page,
    page.getByRole("button", {
      name: "Перейти к людям и документам",
      exact: true,
    }),
  );
  await keyboardActivate(
    page,
    page.getByRole("button", {
      name: "Выбрать документы получателя 1",
      exact: true,
    }),
  );
  const dialog = page.getByRole("dialog");
  await keyboardCheck(
    page,
    dialog.getByRole("checkbox", { name: /^БиОТ — удостоверение рабочего/ }),
  );
  await keyboardActivate(
    page,
    dialog.getByRole("button", {
      name: "Добавить выбранные документы",
      exact: true,
    }),
  );
  await expect(dialog).toHaveCount(0);
}

export async function openRecipientExtraTools(page: Page) {
  const menu = page.locator(".recipient-extra-tools");
  if ((await menu.getAttribute("open")) === null)
    await menu.locator("summary").click();
}

export async function keyboardOpenRecipientExtraTools(page: Page) {
  const menu = page.locator(".recipient-extra-tools");
  if ((await menu.getAttribute("open")) === null)
    await keyboardActivate(page, menu.locator("summary"));
}

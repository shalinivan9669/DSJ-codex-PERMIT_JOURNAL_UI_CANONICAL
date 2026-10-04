import { test, expect, type Page, type Locator } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { stripVTControlCharacters } from "node:util";
import {
  fullSuiteApiCooldown,
  fullSuiteRunId,
  requireEmptyFullPreparation,
} from "./operator-full-suite";
import { readCommon } from "./operator-common-history-helpers";
import {
  g1Product,
  g1Evidence,
  g1Sources,
  g1KeyboardSession,
  verifyG1Files,
  type G1Checkpoint,
} from "./operator-g1-helpers";
import {
  assertTechnicalBlankRemoval,
  keyboardMetrics,
  keyboardFocus,
  keyboardActivate,
  keyboardEnter,
  keyboardCheck,
  keyboardSelect,
  keyboardReopen,
  keyboardOpenRecipientExtraTools,
  saveKeyboardMetrics,
} from "./operator-keyboard-helpers";

test.use({ trace: "off" });
const evidence = g1Evidence();
function sanitizeDiagnostic(value: string) {
  let safe = stripVTControlCharacters(value);
  for (const [key, secret] of Object.entries(process.env)) {
    if (secret && /PASSWORD|SECRET|TOKEN|COOKIE|EMAIL|DATABASE_URL/i.test(key))
      safe = safe.split(secret).join("[REDACTED]");
  }
  return safe
    .replace(
      /(["']?(?:password|csrfToken|x-csrf-token|cookie|authorization|accessToken|refreshToken|sessionToken)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,
      "$1[REDACTED]",
    )
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9/+_.=-]+/gi, "[REDACTED_AUTH]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/[A-Za-z0-9_-]{40,}/g, "[REDACTED_LONG_VALUE]")
    .slice(0, 6000);
}
async function expand(page: Page, details: Locator) {
  if ((await details.getAttribute("open")) === null)
    await keyboardActivate(page, details.locator(":scope > summary"));
}
async function saved(page: Page) {
  await expect(page.locator(".save-indicator.saved")).toHaveText(
    /^Рабочая версия сохранена · редакция \d+$/,
    { timeout: 180000 },
  );
}
async function nativeChromeDate(page: Page, input: Locator, value: string) {
  await keyboardFocus(page, input);
  const [year, month, day] = value.split("-");
  const locale = await input.evaluate(
    (element) =>
      element.closest("[lang]")?.getAttribute("lang") || navigator.language,
  );
  const order = new Intl.DateTimeFormat(locale)
    .formatToParts(new Date(2026, 8, 22))
    .filter((part) => ["year", "month", "day"].includes(part.type))
    .map((part) => part.type);
  const segments: Record<string, string> = { year, month, day };
  for (const [index, key] of order.entries()) {
    for (let step = 0; step < 4; step++) await page.keyboard.press("ArrowLeft");
    for (let step = 0; step < index; step++)
      await page.keyboard.press("ArrowRight");
    await page.keyboard.type(segments[key]);
  }
  keyboardMetrics.textEntries++;
  await expect(input).toHaveValue(value);
}
test.afterEach(async ({ page }, info) => {
  await saveKeyboardMetrics(
    evidence,
    info.status || (page.isClosed() ? "CLOSED" : "UNKNOWN"),
  );
  if (info.status !== "passed") {
    const stripAnsi = stripVTControlCharacters;
    const ownFile = info.file.replaceAll("\\", "/");
    const ownLocation = new RegExp(
      `${ownFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:(\\d+):(\\d+)`,
    );
    await fs.writeFile(
      path.join(evidence, "g1-failure-diagnostic.json"),
      JSON.stringify(
        {
          capturedUtc: new Date().toISOString(),
          suiteRunId: fullSuiteRunId(),
          status: info.status,
          title: info.title,
          safeFieldsOnly: true,
          noHeadersCookiesTokensOrCredentials: true,
          errors: info.errors.map((error) => {
            const message = stripAnsi(error.message || "Test failed");
            const location = ownLocation.exec(
              (error.stack || "").replaceAll("\\", "/"),
            );
            return {
              name:
                /^(TimeoutError|SyntaxError|TypeError|AssertionError|Error):/.exec(
                  message,
                )?.[1] || "TestError",
              message: sanitizeDiagnostic(message),
              location: {
                file: info.file,
                line: location ? Number(location[1]) : info.line,
                column: location ? Number(location[2]) : info.column,
              },
            };
          }),
        },
        null,
        2,
      ),
    );
  }
});

test("G1 keyboard only: original 100 people and photos, common PB group, real Director approval and 101 issued documents", async ({
  page,
  browser,
}) => {
  test.setTimeout(7200000);
  expect(process.env.DEMO_E2E_ISOLATED_TENANT).toBe("1");
  await requireEmptyFullPreparation(evidence);
  await fs.mkdir(evidence, { recursive: true });
  await fullSuiteApiCooldown(evidence, "g1-producer-before-ui");
  const { people, sourceEvent, peopleSource, resultsSource } =
    await g1Sources();
  const started = Date.now(),
    checkpoints: unknown[] = [];
  let mutations = 0,
    individualPanelsOpened = 0,
    mouseClicks = 0;
  page.on("request", (request) => {
    if (
      request.url().includes("/api/") &&
      !["GET", "HEAD", "OPTIONS"].includes(request.method())
    )
      mutations++;
  });
  await page.exposeFunction("g1PanelOpened", () => individualPanelsOpened++);
  await page.exposeFunction("g1MouseClick", () => mouseClicks++);
  await page.addInitScript(() => {
    document.addEventListener(
      "click",
      (event) => {
        if (event.detail > 0)
          (window as unknown as { g1MouseClick: () => void }).g1MouseClick();
        const button = (event.target as Element).closest("button");
        if (button?.getAttribute("aria-label")?.startsWith("Детали получателя"))
          (window as unknown as { g1PanelOpened: () => void }).g1PanelOpened();
      },
      true,
    );
  });
  await g1KeyboardSession(page);
  let preparationContinuation: {
    version: number;
    synthetic: boolean;
    phase: string;
    requestId: string;
    title: string;
    originalAttemptStatus: string;
    originalMouseProof: string;
    originalKeyboardMetrics: Record<string, unknown>;
    items: Awaited<ReturnType<typeof readCommon>>["items"];
  } | null = null;
  let title: string;
  let requestId: string, requestPath: string, checkpoint: G1Checkpoint;
  let renderStarted = Date.now();
  let issuanceContinuation: {
    directory: string;
    originalAttemptStats: unknown;
  } | null = null;
  const issuedContinuationDirectory =
    process.env.DEMO_E2E_G1_CONTINUE_ISSUANCE_CHECKPOINT;
  if (issuedContinuationDirectory) {
    const directory = path.resolve(issuedContinuationDirectory),
      owned = path.resolve(
        g1Product,
        "docs/evidence/operator-flow-full-fix-20261003/preparation/attempts",
      );
    const relative = path.relative(owned, directory);
    expect(relative.startsWith("..") || path.isAbsolute(relative)).toBe(false);
    checkpoint = JSON.parse(
      await fs.readFile(path.join(directory, "g1-checkpoint.json"), "utf8"),
    );
    expect(checkpoint.version).toBe(2);
    expect(checkpoint.status).toBe("ISSUED_WAITING_FILES");
    expect(checkpoint.items).toHaveLength(100);
    expect(checkpoint.individualPanelsOpened).toBe(0);
    const priorMetrics = JSON.parse(
      await fs.readFile(path.join(directory, "keyboard-metrics.json"), "utf8"),
    );
    expect(priorMetrics.nativeFileSelections).toBe(1);
    expect(priorMetrics.dialogTrapChecks).toBe(1);
    expect(priorMetrics.enterNoFinalizeChecks).toBe(1);
    for (const key of Object.keys(keyboardMetrics) as Array<
      keyof typeof keyboardMetrics
    >)
      keyboardMetrics[key] = priorMetrics[key];
    requestId = checkpoint.requestId;
    requestPath = checkpoint.requestPath;
    await page.goto(requestPath);
    const actual = await readCommon(page, requestId);
    expect(actual.status).toBe("FINALIZED");
    expect(actual.items).toEqual(checkpoint.items);
    expect(actual.documents).toHaveLength(101);
    expect(actual.issuances).toHaveLength(1);
    expect(actual.issuances[0].snapshot).toEqual(checkpoint.snapshot);
    const originalAttempt = JSON.parse(
      await fs.readFile(path.join(directory, "results.json"), "utf8"),
    );
    issuanceContinuation = {
      directory,
      originalAttemptStats: originalAttempt.stats,
    };
    for (const name of [
      "g1-director-approved.png",
      "g1-ready.png",
      "g1-validation-response.json",
      "outcome-focus-ancestors.json",
      "actual-progress-history.json",
    ]) {
      try {
        await fs.copyFile(
          path.join(directory, name),
          path.join(evidence, name),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    checkpoints.push({
      step: "same-fresh-issued-101-checkpoint-continued-without-reapproval-or-reissue",
      requestId,
      originalAttemptStats: originalAttempt.stats,
    });
    await fs.writeFile(
      path.join(evidence, "g1-checkpoint.json"),
      JSON.stringify(checkpoint, null, 2),
    );
  } else {
    if (process.env.DEMO_E2E_G1_CONTINUE_PREPARATION) {
      const directory = path.resolve(
        process.env.DEMO_E2E_G1_CONTINUE_PREPARATION,
      );
      const ownedAttempts = path.join(
        g1Product,
        "docs/evidence/operator-flow-full-fix-20261003/preparation/attempts",
      );
      expect(path.relative(ownedAttempts, directory).startsWith("..")).toBe(
        false,
      );
      preparationContinuation = JSON.parse(
        await fs.readFile(
          path.join(directory, "fresh-preparation-continuation.json"),
          "utf8",
        ),
      );
      expect(preparationContinuation!.version).toBe(2);
      expect(preparationContinuation!.synthetic).toBe(true);
      expect([
        "PHOTOS_IMPORTED",
        "EVENT_ASSIGNED",
        "RESULTS_APPLIED",
      ]).toContain(preparationContinuation!.phase);
      for (const key of Object.keys(keyboardMetrics) as Array<
        keyof typeof keyboardMetrics
      >) {
        const value = preparationContinuation!.originalKeyboardMetrics[key];
        expect(typeof value).toBe("number");
        keyboardMetrics[key] = value as number;
      }
      title = preparationContinuation!.title;
      await page.goto(`/requests/${preparationContinuation!.requestId}/edit`);
      await expect(page.locator(".operator-grid tbody tr")).toHaveCount(100);
      const actual = await readCommon(page, preparationContinuation!.requestId);
      expect(actual.items).toEqual(preparationContinuation!.items);
      expect(
        actual.items.every(
          (item) =>
            !!item.photoAssetId &&
            item.assignments.length ===
              (preparationContinuation!.phase === "PHOTOS_IMPORTED" ? 0 : 1),
        ),
      ).toBe(true);
      expect(actual.events).toHaveLength(
        preparationContinuation!.phase === "PHOTOS_IMPORTED" ? 0 : 1,
      );
      expect(actual.documents).toHaveLength(0);
      checkpoints.push({
        step: "explicit-same-fresh-keyboard-preparation-continuation",
        requestId: actual.id,
        rows: 100,
        photos: 100,
        originalAttemptStatus: preparationContinuation!.originalAttemptStatus,
        originalMouseProof: preparationContinuation!.originalMouseProof,
      });
    } else {
      await keyboardActivate(
        page,
        page.getByRole("link", { name: "Новая заявка", exact: true }),
      );
      await keyboardFocus(
        page,
        page.getByRole("radio", { name: "Физическое лицо", exact: true }),
      );
      await page.keyboard.press("ArrowRight");
      keyboardMetrics.selections++;
      await expect(
        page.getByRole("radio", { name: "Организация", exact: true }),
      ).toBeChecked();
      await keyboardFocus(
        page,
        page.getByRole("radio", { name: "Организация", exact: true }),
      );
      await keyboardActivate(
        page,
        page.getByRole("button", { name: "Далее", exact: true }),
      );
      title = `G1 · исходные 100 человек · клавиатура ${Date.now()}`;
      await expand(
        page,
        page.locator("details.operator-request-options").filter({
          has: page.getByText(/^Название заявки и служебные параметры/),
        }),
      );
      await keyboardEnter(
        page,
        page.getByLabel("Название заявки", { exact: true }),
        title,
      );
      await keyboardEnter(
        page,
        page.getByLabel("Название компании", { exact: true }),
        people[0].workplaceRu,
      );
      await keyboardActivate(
        page,
        page.getByRole("button", {
          name: "Использовать эту компанию",
          exact: true,
        }),
      );
      await saved(page);
      await keyboardActivate(
        page,
        page.getByRole("button", { name: "Удалить получателя 1", exact: true }),
      );
      await assertTechnicalBlankRemoval(page);
      await keyboardActivate(
        page,
        page.getByRole("button", { name: "Импорт / вставка", exact: true }),
      );
      const columns: string[] = peopleSource.columns;
      await keyboardEnter(
        page,
        page.getByLabel("Или вставьте таблицу с заголовками"),
        [
          columns.join("\t"),
          ...people.map((person) =>
            columns.map((column) => person[column]).join("\t"),
          ),
        ].join("\n"),
      );
      await keyboardActivate(
        page,
        page.getByRole("button", {
          name: "Перейти к сопоставлению",
          exact: true,
        }),
      );
      await expect(
        page.getByText("Прочитано: 100", { exact: true }),
      ).toBeVisible();
      await keyboardSelect(
        page,
        page.getByRole("combobox", {
          name: "Документ для импортируемых строк",
          exact: true,
        }),
        "",
      );
      await keyboardActivate(
        page,
        page.getByRole("button", {
          name: "Добавить 100 строк в черновик",
          exact: true,
        }),
      );
      await expect(page.locator(".operator-grid tbody tr")).toHaveCount(100);
      await saved(page);
      checkpoints.push({
        step: "original-100-imported-without-training",
        elapsedMs: Date.now() - started,
      });
      await keyboardOpenRecipientExtraTools(page);
      await keyboardActivate(
        page,
        page.getByRole("button", { name: "Сопоставить фото", exact: true }),
      );
      const photoBytes = await fs.readFile(
        path.join(g1Product, "tests/fixtures/source-photo.png"),
      );
      await keyboardFocus(
        page,
        page.getByLabel("Фотографии PNG/JPEG", { exact: true }),
      );
      await page
        .getByLabel("Фотографии PNG/JPEG", { exact: true })
        .setInputFiles(
          people.map((person) => ({
            name: `${person.externalPersonKey}.png`,
            mimeType: "image/png",
            buffer: photoBytes,
          })),
        );
      keyboardMetrics.nativeFileSelections++;
      const modal = page.getByRole("dialog");
      await expect(modal).toContainText(
        "Совпало: 100. Неоднозначных файлов: 0",
      );
      await keyboardCheck(
        page,
        page.getByLabel(
          "Проверены однозначные совпадения: применить 100 фото. Остальные строки сохранить.",
        ),
      );
      const close = modal.getByRole("button", {
        name: "Закрыть диалог",
        exact: true,
      });
      const applyPhotos = modal.getByRole("button", {
        name: "Применить 100 фото",
        exact: true,
      });
      await keyboardFocus(page, close);
      await page.keyboard.press("Shift+Tab");
      keyboardMetrics.shiftTabs++;
      await expect(applyPhotos).toBeFocused();
      await page.keyboard.press("Tab");
      keyboardMetrics.tabs++;
      await expect(close).toBeFocused();
      keyboardMetrics.dialogTrapChecks++;
      await page.screenshot({
        path: path.join(evidence, "g1-photo-dialog-keyboard-trap.png"),
      });
      await keyboardActivate(page, applyPhotos);
      await expect(modal).toHaveCount(0, { timeout: 240000 });
      await keyboardActivate(
        page,
        page.getByRole("button", { name: "Проверить данные", exact: true }),
      );
      await expect(page.locator(".validation-result")).toContainText(
        "Исправьте данные перед оформлением",
      );
      await expect(page.locator(".validation-result")).toBeFocused();
      await page.screenshot({
        path: path.join(evidence, "g1-validation-keyboard-focus.png"),
      });
      const lastName = page.getByLabel("ФИО, строка 100", { exact: true });
      await keyboardFocus(page, lastName);
      const nameBefore = await lastName.inputValue();
      await page.keyboard.press("Enter");
      keyboardMetrics.enterNoFinalizeChecks++;
      await expect(lastName).toHaveValue(nameBefore);
      await expect(page.locator(".title-with-status .status")).toHaveText(
        "Черновик",
      );
    }
    requestId = /requests\/([^/]+)/.exec(page.url())![1];
    requestPath = new URL(page.url()).pathname;
    if (preparationContinuation?.phase !== "RESULTS_APPLIED") {
      await keyboardCheck(
        page,
        page.getByLabel("Выбрать видимых получателей", { exact: true }),
      );
      if (preparationContinuation?.phase !== "EVENT_ASSIGNED") {
        await keyboardActivate(
          page,
          page.getByRole("button", {
            name: "Дополнительные действия",
            exact: true,
          }),
        );
        await keyboardActivate(
          page,
          page.getByRole("dialog").getByRole("button", {
            name: "Общие даты и протоколы",
            exact: true,
          }),
        );
        const eventModal = page.getByRole("dialog");
        await keyboardSelect(
          page,
          eventModal.getByRole("combobox", {
            name: "Направление нового события",
            exact: true,
          }),
          "pb",
        );
        await keyboardActivate(
          page,
          eventModal.getByRole("button", {
            name: "Добавить событие",
            exact: true,
          }),
        );
        await keyboardEnter(
          page,
          eventModal.getByLabel("Название события", { exact: true }),
          "PB-G1 · исходный синтетический сценарий",
        );
        await keyboardActivate(
          page,
          eventModal.getByRole("button", {
            name: "Назначить набор выбранным (100)",
            exact: true,
          }),
        );
        await keyboardActivate(
          page,
          eventModal.getByRole("button", {
            name: "Закрыть диалог",
            exact: true,
          }),
        );
      }
      await saved(page);
      await expand(page, page.locator("#request-training"));
      const primary = page.locator(".training-primary-context");
      const advanced = primary.locator(".training-advanced-settings").filter({
        has: page.getByText("Дополнительные настройки обучения", {
          exact: true,
        }),
      });
      await expand(page, advanced);
      const assignment = advanced
        .locator(".training-advanced-settings")
        .filter({
          has: page.getByText("Добавить выбранных людей в это обучение", {
            exact: true,
          }),
        });
      await expand(page, assignment);
      const protocolMode = page.getByRole("combobox", {
        name: "Протокол: PB-G1 · исходный синтетический сценарий",
        exact: true,
      });
      await keyboardSelect(page, protocolMode, "INDIVIDUAL");
      await saved(page);
      await keyboardSelect(page, protocolMode, "GROUP");
      await saved(page);
      const dates = primary.locator(".training-advanced-settings").filter({
        has: page.getByText("Отдельные даты и основания этого обучения", {
          exact: true,
        }),
      });
      await expand(page, dates);
      for (const field of [
        "documentDate",
        "trainingStart",
        "trainingEnd",
        "trainingSubject",
        "hours",
      ]) {
        const input = primary
          .locator(`[data-field-path="events.0.commonFields.${field}"]`)
          .first();
        if ((await input.getAttribute("type")) === "date")
          await nativeChromeDate(page, input, sourceEvent[field]);
        else await keyboardEnter(page, input, sourceEvent[field]);
      }
      await nativeChromeDate(
        page,
        page.locator(
          '.training-overview [data-field-path="events.0.commonFields.protocolDate"]',
        ),
        sourceEvent.protocolDate,
      );
      await saved(page);
      const before = await readCommon(page, requestId);
      expect(before.items).toHaveLength(100);
      expect(before.documents).toHaveLength(0);
      for (const [index, item] of before.items.entries()) {
        expect(item.externalId).toBe(people[index].externalPersonKey);
        expect(item.personnelNumber).toBe(people[index].personnelNumber);
        expect(item.sourceRow).toBe(index + 2);
        expect(item.fullNameKz).toBe(people[index].fullNameKz);
        expect(item.positionRu).toBe(people[index].positionRu);
        expect(item.positionKz).toBe(people[index].positionKz);
        expect(item.workplaceRu).toBe(people[index].workplaceRu);
        expect(item.workplaceKz).toBe(people[index].workplaceKz);
        expect(item.photoAssetId).toBeTruthy();
        expect(item.assignments).toHaveLength(1);
        expect(item.assignments[0].templateId).toBe("pb-card");
        expect(item.assignments[0].outcome?.status).toBe("UNKNOWN");
        expect(item.assignments[0].result).toBe("");
      }
      await keyboardActivate(
        page,
        assignment.getByRole("button", {
          name: "Назначить набор выбранным (100)",
          exact: true,
        }),
      );
      await saved(page);
      expect(
        (await readCommon(page, requestId)).items.map(
          (item) => item.assignments,
        ),
      ).toEqual(before.items.map((item) => item.assignments));
      await fs.writeFile(
        path.join(evidence, "outcome-focus-ancestors.json"),
        JSON.stringify(
          await primary.evaluate((element) =>
            Array.from(
              (function* (node: Element | null): Generator<Element> {
                while (node) {
                  yield node;
                  node = node.parentElement;
                }
              })(element),
            ).map((node) => ({
              tag: node.tagName,
              id: node.id,
              open: node instanceof HTMLDetailsElement ? node.open : undefined,
              visible: node.checkVisibility({
                checkOpacity: true,
                checkVisibilityCSS: true,
              }),
            })),
          ),
          null,
          2,
        ),
      );
      await expand(page, page.locator("#request-training"));
      const outcome = primary.locator("details.outcome-entry").filter({
        has: page.getByText("Фактические результаты обучения", { exact: true }),
      });
      await expand(page, outcome);
      // Use the real next Tab stop from the disclosure to the first outcome field.
      // A 100-row table contains native date subsegments absent from DOM tab-order
      // inventories; do not navigate that whole table when this adjacent stop exists.
      await keyboardFocus(page, outcome.locator(":scope > summary"));
      await page.keyboard.press("Tab");
      keyboardMetrics.tabs++;
      await expect(
        outcome.getByLabel("Кому подтвердить результат", { exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Tab");
      keyboardMetrics.tabs++;
      await expect(
        outcome.getByLabel("Известный результат", { exact: true }),
      ).toBeFocused();
      await keyboardSelect(
        page,
        outcome.getByLabel("Известный результат", { exact: true }),
        "PASSED",
      );
      const source = `${resultsSource.rows[0].evidenceKey}; ${resultsSource.rows[0].confirmedBy}; ${resultsSource.rows[0].confirmedAt}`;
      await keyboardEnter(
        page,
        outcome.getByLabel("Источник подтверждения", { exact: true }),
        source,
      );
      await keyboardActivate(
        page,
        outcome.getByRole("button", {
          name: "Проверить применение результатов",
          exact: true,
        }),
      );
      await expect(outcome).toContainText("100 участников");
      await keyboardActivate(
        page,
        outcome.getByRole("button", {
          name: "Подтвердить результаты",
          exact: true,
        }),
      );
      await saved(page);
    } else {
      const actual = await readCommon(page, requestId);
      const actualSource = `${resultsSource.rows[0].evidenceKey}; ${resultsSource.rows[0].confirmedBy}; ${resultsSource.rows[0].confirmedAt}`;
      expect(
        actual.items.every(
          (item) =>
            item.assignments[0].outcome?.status === "PASSED" &&
            item.assignments[0].outcome?.source === actualSource,
        ),
      ).toBe(true);
      expect(actual.items).toEqual(preparationContinuation.items);
      checkpoints.push({
        step: "same-fresh-100-already-ui-confirmed-results-preserved-without-reapply",
        requestId,
        rows: 100,
      });
    }
    await keyboardReopen(page);
    const validateButton = page.getByRole("button", {
      name: "Проверить данные",
      exact: true,
    });
    await keyboardFocus(page, validateButton);
    // The genuine 101-document layout check supports a 180s preflight. Begin
    // response timers after keyboard navigation and retain the real UI command.
    const validationStarted = performance.now();
    const validationStartedUtc = new Date().toISOString();
    let validationHeadersMs = 0,
      resolvedHeadersMs = 0;
    const validationResponse = page
      .waitForResponse(
        (response) =>
          response
            .url()
            .endsWith(`/api/print-requests/${requestId}/validate`) &&
          response.request().method() === "POST",
        { timeout: 240000 },
      )
      .then((response) => {
        validationHeadersMs = performance.now() - validationStarted;
        return response;
      });
    const resolvedResponse = page
      .waitForResponse(
        (response) =>
          response
            .url()
            .endsWith(`/api/print-requests/${requestId}/resolved`) &&
          response.request().method() === "GET",
        { timeout: 240000 },
      )
      .then((response) => {
        resolvedHeadersMs = performance.now() - validationStarted;
        return response;
      });
    await page.keyboard.press("Enter");
    keyboardMetrics.activations++;
    const [checked, resolvedChecked] = await Promise.all([
      validationResponse,
      resolvedResponse,
    ]);
    const responseEvidence = {
      stage: "HEADERS_RECEIVED",
      status: checked.status(),
      requestId,
      code: undefined as string | undefined,
      message: undefined as string | undefined,
      valid: undefined as boolean | undefined,
      documentCount: undefined as number | undefined,
      validationContentType: checked.headers()["content-type"] || null,
      resolvedStatus: resolvedChecked.status(),
      resolvedContentType: resolvedChecked.headers()["content-type"] || null,
      resolvedRecipients: undefined as number | undefined,
      resolvedIssueCount: undefined as number | undefined,
      validationStartedUtc,
      validationHeadersMs,
      resolvedHeadersMs,
      bothBodiesCompletedMs: null as number | null,
      responseTimeoutMs: 240000,
      bodyDiagnostics: null as {
        validation: {
          bytes: number;
          sha256: string;
          sanitizedTextPrefix: string;
        };
        resolved: {
          bytes: number;
          sha256: string;
          sanitizedTextPrefix: string;
        };
      } | null,
      bodyError: null as { name: string; message: string } | null,
      noHeadersCookiesTokensOrCredentials: true,
      genuineKeyboardEnter: true,
      keyboardFocusBeforeResponseTimers: true,
      apiShortcutCalls: 0,
      uiSettled: false,
      uiSettledMs: null as number | null,
    };
    const saveResponseEvidence = () =>
      fs.writeFile(
        path.join(evidence, "g1-validation-response.json"),
        JSON.stringify(responseEvidence, null, 2),
      );
    await saveResponseEvidence();
    let validationText: string, resolvedText: string;
    try {
      [validationText, resolvedText] = await Promise.all([
        checked.text(),
        resolvedChecked.text(),
      ]);
    } catch (error) {
      responseEvidence.stage = "BODY_READ_FAILED";
      responseEvidence.bodyError = {
        name: error instanceof Error ? error.name : "UnknownError",
        message: sanitizeDiagnostic(
          error instanceof Error ? error.message : String(error),
        ),
      };
      await saveResponseEvidence();
      throw error;
    }
    const diagnosticBody = (body: string) => ({
      bytes: Buffer.byteLength(body, "utf8"),
      sha256: createHash("sha256").update(body).digest("hex"),
      sanitizedTextPrefix: sanitizeDiagnostic(body).slice(0, 512),
    });
    responseEvidence.stage = "TEXT_RECEIVED_BEFORE_JSON_PARSE";
    responseEvidence.bothBodiesCompletedMs =
      performance.now() - validationStarted;
    responseEvidence.bodyDiagnostics = {
      validation: diagnosticBody(validationText),
      resolved: diagnosticBody(resolvedText),
    };
    await saveResponseEvidence();
    let validationReadback: {
      code?: string;
      message?: string;
      valid?: boolean;
      documentCount?: number;
    };
    let resolvedReadback: { draft?: { items?: unknown[] }; issues?: unknown[] };
    try {
      validationReadback = JSON.parse(validationText);
      resolvedReadback = JSON.parse(resolvedText);
    } catch (error) {
      responseEvidence.stage = "JSON_PARSE_FAILED";
      responseEvidence.bodyError = {
        name: error instanceof Error ? error.name : "UnknownError",
        message: sanitizeDiagnostic(
          error instanceof Error ? error.message : String(error),
        ),
      };
      await saveResponseEvidence();
      throw error;
    }
    expect(validationReadback).not.toBeNull();
    expect(resolvedReadback).not.toBeNull();
    responseEvidence.stage = "JSON_PARSED";
    responseEvidence.code = validationReadback.code;
    responseEvidence.message = validationReadback.message
      ? sanitizeDiagnostic(validationReadback.message)
      : undefined;
    responseEvidence.valid = validationReadback.valid;
    responseEvidence.documentCount = validationReadback.documentCount;
    responseEvidence.resolvedRecipients = resolvedReadback.draft?.items?.length;
    responseEvidence.resolvedIssueCount = resolvedReadback.issues?.length;
    await saveResponseEvidence();
    expect(checked.ok(), JSON.stringify(validationReadback)).toBe(true);
    expect(
      resolvedChecked.ok(),
      "UI resolved response succeeds before displaying validation",
    ).toBe(true);
    expect(validationReadback.valid).toBe(true);
    expect(validationReadback.documentCount).toBe(101);
    expect(resolvedReadback.draft?.items).toHaveLength(100);
    await expect(
      page.getByText("Данные прошли проверку", { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await expect(validateButton).toBeEnabled({ timeout: 30000 });
    await expect(
      page.getByRole("button", { name: "Проверяем…", exact: true }),
    ).toHaveCount(0);
    responseEvidence.uiSettled = true;
    responseEvidence.uiSettledMs = performance.now() - validationStarted;
    await fs.writeFile(
      path.join(evidence, "g1-validation-response.json"),
      JSON.stringify(responseEvidence, null, 2),
    );
    await keyboardCheck(
      page,
      page.getByLabel(/Все подтверждённые ещё не оформленные курсы/),
    );
    await keyboardActivate(
      page,
      page.getByRole("button", { name: /Проверить и передать директору/ }),
    );
    await expect
      .poll(async () => (await readCommon(page, requestId)).approval?.status)
      .toBe("PENDING");
    const applied = await readCommon(page, requestId);
    expect(applied.approval?.status).toBe("PENDING");
    const directorContext = await browser.newContext({
        baseURL: process.env.DEMO_ORIGIN,
      }),
      directorPage = await directorContext.newPage();
    await directorPage.exposeFunction(
      "g1DirectorMouseClick",
      () => mouseClicks++,
    );
    await directorPage.addInitScript(() => {
      document.addEventListener(
        "click",
        (event) => {
          if (event.detail > 0)
            (
              window as unknown as { g1DirectorMouseClick: () => void }
            ).g1DirectorMouseClick();
        },
        true,
      );
    });
    try {
      await g1KeyboardSession(directorPage, true);
      await directorPage.goto(
        `/approvals?proposal=${applied.approval!.proposalId}`,
      );
      await keyboardEnter(
        directorPage,
        directorPage.getByRole("textbox", {
          name: "Комментарий к решению",
          exact: true,
        }),
        "СИНТЕТИЧЕСКИЙ G1: исходные 100 человек, общий PB протокол, проверены фото и фактическая редакция",
      );
      await keyboardActivate(
        directorPage,
        directorPage.getByRole("button", {
          name: "Согласовать эту редакцию",
          exact: true,
        }),
      );
      await expect
        .poll(async () => (await readCommon(page, requestId)).approval?.status)
        .toBe("APPROVED");
      await directorPage.screenshot({
        path: path.join(evidence, "g1-director-approved.png"),
        fullPage: true,
      });
    } finally {
      await directorContext.close();
    }
    await keyboardReopen(page);
    expect(individualPanelsOpened).toBe(0);
    expect(mouseClicks).toBe(0);
    checkpoint = {
      version: 2,
      suiteRunId: fullSuiteRunId(),
      status: "READY",
      requestId,
      requestPath,
      title,
      prepareWallMs: Date.now() - started,
      mutations,
      individualPanelsOpened,
      keyboardOnlyInApp: true,
      keyboardMetrics: { ...keyboardMetrics },
      items: applied.items,
    };
    await fs.writeFile(
      path.join(evidence, "g1-checkpoint.json"),
      JSON.stringify(checkpoint, null, 2),
    );
    await page.screenshot({
      path: path.join(evidence, "g1-ready.png"),
      fullPage: true,
    });
    renderStarted = Date.now();
    await keyboardActivate(
      page,
      page.getByRole("button", { name: "Сформировать документы", exact: true }),
    );
    await expect
      .poll(async () => (await readCommon(page, requestId)).status)
      .toBe("FINALIZED");
    const dispatched = await readCommon(page, requestId);
    expect(dispatched.documents).toHaveLength(101);
    checkpoint.status = "ISSUED_WAITING_FILES";
    checkpoint.snapshot = dispatched.issuances[0].snapshot;
    await fs.writeFile(
      path.join(evidence, "g1-checkpoint.json"),
      JSON.stringify(checkpoint, null, 2),
    );
    console.log(
      `[G1_RENDER_DISPATCHED] ${requestId}; 101 actual documents; immutable issuance saved`,
    );
    await saveKeyboardMetrics(evidence, "RUNNING_FILES_WAIT");
  }
  const { issued, files, group } = await verifyG1Files(
    page,
    checkpoint,
    evidence,
  );
  checkpoint.status = "FILES_VERIFIED";
  checkpoint.renderWallMs = Date.now() - renderStarted;
  checkpoint.documents = issued.documents;
  checkpoint.snapshot = issued.issuances[0].snapshot;
  checkpoint.files = files;
  checkpoint.keyboardMetrics = { ...keyboardMetrics };
  await fs.writeFile(
    path.join(evidence, "g1-checkpoint.json"),
    JSON.stringify(checkpoint, null, 2),
  );
  await page.reload();
  await expect(page.locator(".files-panel")).toContainText(
    "Готово 204 из 204",
    { timeout: 180000 },
  );
  const ready = page.waitForEvent("download");
  await keyboardActivate(
    page,
    page
      .locator(".files-panel article")
      .filter({
        has: page.locator(".file-type").getByText("PDF", { exact: true }),
      })
      .first()
      .getByRole("link", { name: "Скачать", exact: true }),
  );
  await (await ready).saveAs(path.join(evidence, "keyboard-download.pdf"));
  keyboardMetrics.artifactDownloads++;
  await keyboardReopen(page);
  expect((await readCommon(page, requestId)).items).toEqual(checkpoint.items);
  expect(mouseClicks).toBe(0);
  await page.screenshot({
    path: path.join(evidence, "g1-issued.png"),
    fullPage: true,
  });
  await fs.writeFile(
    path.join(evidence, "g1-result.json"),
    JSON.stringify(
      {
        status: "PASS",
        suiteRunId: fullSuiteRunId(),
        syntheticOnly: true,
        keyboardOnlyInApp: true,
        actualMouseClicks: mouseClicks,
        mouseClickScope:
          preparationContinuation || issuanceContinuation
            ? "Continuation live event counter; prior UI phase source audited, original failed event counter not persisted"
            : "Whole fresh UI journey live event counter",
        freshPreparationContinuation: preparationContinuation,
        sameFreshIssuanceContinuation: issuanceContinuation,
        personalCardNameScope:
          "Pinned legacy PB card/protocol renderer prints FULL_NAME_RU. All100 FULL_NAME_KZ values remain exact in raw and immutable snapshot; GROUP logical FULL_NAME_BOTH manifest differs from preserved legacy fill policy. RU/KZ positions/workplaces remain supplied where mapped.",
        apiMutationsForUiShortcuts: 0,
        requestId,
        recipients: 100,
        photos: 100,
        individualPanelsOpened,
        documentCount: 101,
        artifacts: files.length,
        groupProtocolCount: 1,
        groupNumber: group.number,
        allFilesHashVerified: true,
        prepareWallMs: checkpoint.prepareWallMs,
        renderWallMs: checkpoint.renderWallMs,
        automatedWallMs: Date.now() - started,
        humanOperatorMs: null,
        baselineMs: null,
        keyboardMetrics,
        checkpoints,
        apiMutations: mutations,
        legalAcceptance: "NOT_RUN",
        physicalPrint: "NOT_RUN",
        browser: browser.version(),
        files,
      },
      null,
      2,
    ),
  );
});

import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveDraft } from "@demo/contracts";
import { newRecipient, type Draft } from "../lib/types";

// Same synthetic work and API delay for both saved baseline and current source.
// These are end-to-end automation timings, never estimates of human speed.
for (const count of [10, 100, 150, 250]) {
  test(`comparable operator measurements: ${count} mixed recipients`, async ({
    page,
  }) => {
    const evidence = process.env.DEMO_E2E_EVIDENCE!;
    await fs.mkdir(evidence, { recursive: true });
    await page.routeWebSocket(/\/_next\/webpack-hmr/, (socket) =>
      socket.close(),
    );
    let draft: Draft = {
      id: "timing",
      revision: 0,
      status: "DRAFT",
      kind: "PERSON",
      title: `Сопоставимый замер: ${count}`,
      customerId: null,
      demoMode: true,
      schemaVersion: 2,
      commonFields: {},
      items: Array.from({ length: count }, (_, i) => ({
        ...newRecipient(),
        id: `person-${i}`,
        fullNameRu: `${i % 2 ? "Иванов" : "Иванова"} Алексей Сергеевич ${String(i + 1).padStart(3, "0")}`,
        fullNameKz: `Әбдірахманов Нұрсұлтан Мұхамеджанұлы ${i + 1}`,
        positionRu:
          i % 3
            ? "Мастер участка"
            : "Инженер по охране труда и промышленной безопасности",
        positionKz: "Еңбек қауіпсіздігі инженері",
        workplaceRu:
          i % 7
            ? "Синтетическая организация Альфа"
            : "Синтетическая организация Бета, производственный участок № 2",
        workplaceKz: "Синтетикалық ұйым",
      })),
    };
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url()).pathname.slice(4);
      let value: unknown = { items: [], total: 0 };
      if (url === "/auth/session") value = { csrfToken: "fixture" };
      else if (url === "/context")
        value = {
          user: {
            id: "operator",
            role: "OPERATOR",
            displayName: "Оператор",
            email: "operator@example.invalid",
          },
          tenant: {
            id: "synthetic",
            name: "Синтетический центр",
            demoOnly: true,
            timezone: "Asia/Almaty",
          },
          profile: {
            nameRu: "Синтетический центр",
            nameKz: "Тест",
            commission: [],
            approved: true,
          },
          templates: [],
          numbering: {},
        };
      else if (url.endsWith("/resolved")) value = resolveDraft(draft);
      else if (url === "/print-requests/timing") {
        if (route.request().method() === "PATCH") {
          const body = route.request().postDataJSON();
          expect(body.expectedRevision).toBe(draft.revision);
          await new Promise((resolve) => setTimeout(resolve, 100));
          draft = { ...draft, ...body.draft, revision: draft.revision + 1 };
          value = { revision: draft.revision };
        } else value = draft;
      }
      await route.fulfill({ json: value });
    });
    const timings: Record<string, number> = {};
    const opened = performance.now();
    await page.goto("/requests/timing/edit");
    await expect(page.locator(".operator-grid tbody tr")).toHaveCount(count);
    timings.openMs = performance.now() - opened;
    const first = page.getByLabel("ФИО, строка 1", { exact: true });
    let started = performance.now();
    await first.fill("Андреев Андрей Анатольевич");
    await expect(first).toHaveValue("Андреев Андрей Анатольевич");
    timings.inputActionMs = performance.now() - started;
    await expect(page.locator(".save-indicator")).toContainText(
      "Рабочая версия сохранена",
    );
    expect(draft.items[0].fullNameRu).toBe("Андреев Андрей Анатольевич");
    timings.firstSaveFromInputMs = performance.now() - started;
    const middle = Math.floor(count / 2);
    const search = page.getByLabel("Поиск в заявке", { exact: true });
    const searchTools = page.locator(".operator-list-tools");
    if (
      !(await searchTools.evaluate(
        (element) => (element as HTMLDetailsElement).open,
      ))
    )
      await searchTools.locator(":scope > summary").click();
    started = performance.now();
    await search.fill(String(middle).padStart(3, "0"));
    await expect(page.locator(".operator-grid tbody tr")).toHaveCount(1);
    timings.searchActionMs = performance.now() - started;
    started = performance.now();
    await page
      .getByLabel("Выбрать видимых получателей", { exact: true })
      .check();
    await expect(
      page.getByLabel(`Выбрать строку ${middle}`, { exact: true }),
    ).toBeChecked();
    timings.selectActionMs = performance.now() - started;
    const row = page.getByLabel(`ФИО, строка ${middle}`, { exact: true });
    await row.fill("Найденная Исправленная Запись");
    await expect(row).toBeFocused();
    await expect(page.locator(".operator-grid tbody tr")).toHaveCount(1);
    await expect(page.locator(".save-indicator")).toContainText(
      "Рабочая версия сохранена",
    );
    await page
      .getByRole("button", { name: "Сбросить фильтры", exact: true })
      .click();
    const opener = page.getByRole("button", {
      name: `Детали получателя ${middle}`,
      exact: true,
    });
    started = performance.now();
    await opener.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page
      .getByRole("button", { name: "Вернуться к списку", exact: true })
      .click();
    await expect(row).toBeVisible();
    timings.cardRoundtripMs = performance.now() - started;
    const restoredFocus = await opener.evaluate(
      (element) => document.activeElement === element,
    );
    if (process.env.DEMO_COMPARE_EXPECT_FIXED === "1")
      expect(restoredFocus).toBe(true);
    const expected = structuredClone(draft.items);
    started = performance.now();
    await page.reload();
    await expect(page.locator(".operator-grid tbody tr")).toHaveCount(count);
    await expect(row).toHaveValue("Найденная Исправленная Запись");
    expect(draft.items).toEqual(expected);
    timings.reloadMs = performance.now() - started;
    await page.screenshot({
      path: path.join(evidence, `measured-${count}.png`),
      fullPage: true,
    });
    await fs.writeFile(
      path.join(evidence, `measurements-${count}.json`),
      JSON.stringify(
        {
          count,
          synthetic: true,
          api: "deterministic mock, PATCH 100 ms",
          timings,
          focusLossOnRename: 0,
          focusLossAfterCard: restoredFocus ? 0 : 1,
          dataEqualAfterReload: true,
          humanTiming: false,
          readyValidatedRequestTiming: null,
          comment:
            "Timings include Playwright actionability and assertions. Single run, no statistical speed claim. Render/compile and system load may differ.",
        },
        null,
        2,
      ),
    );
  });
}

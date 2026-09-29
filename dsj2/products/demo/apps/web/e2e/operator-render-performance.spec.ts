import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { newRecipient, type Draft } from "../lib/types";

test.use({ trace: "off" });
test("250 recipients: trusted key events to next paint, focus and saved value", async ({
  page,
  context,
}) => {
  test.setTimeout(180000);
  const evidence = path.resolve(process.env.DEMO_E2E_EVIDENCE!);
  await fs.mkdir(evidence, { recursive: true });
  let draft: Draft = {
    id: "render-performance",
    revision: 0,
    status: "DRAFT",
    kind: "PERSON",
    title: "Синтетический замер отклика 250",
    customerId: null,
    demoMode: true,
    schemaVersion: 2,
    commonFields: {},
    items: Array.from({ length: 250 }, (_, i) => ({
      ...newRecipient(),
      id: `person-${i}`,
      fullNameRu: `${i % 2 ? "Иванов" : "Иванова"} Алексей Сергеевич ${i + 1}`,
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
  await page.routeWebSocket(/\/_next\/webpack-hmr/, (socket) => socket.close());
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
    else if (url === "/print-requests/render-performance") {
      if (route.request().method() === "PATCH") {
        const body = route.request().postDataJSON();
        expect(body.expectedRevision).toBe(draft.revision);
        draft = { ...draft, ...body.draft, revision: draft.revision + 1 };
        value = { revision: draft.revision };
      } else value = draft;
    }
    await route.fulfill({ json: value });
  });
  await page.goto("/requests/render-performance/edit");
  await expect(page.locator(".operator-grid tbody tr")).toHaveCount(250);
  const input = page.getByLabel("ФИО RU, строка 126", { exact: true });
  await input.focus();
  await input.press("End");
  await input.press("a");
  await input.press("b");
  await expect(page.locator(".save-indicator")).toContainText("Сохранено");
  const originalValue = await input.inputValue();
  await input.evaluate((element) => {
    type Sample = {
      key: string;
      start: number;
      inputAt?: number;
      commitMs?: number;
      firstFrameMs?: number;
      nextFrameMs?: number;
    };
    const samples: Sample[] = [];
    const completed: Sample[] = [];
    const longTasks: { start: number; duration: number }[] = [];
    Object.assign(window, {
      operatorPaintMeasurements: { samples, completed, longTasks },
    });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        longTasks.push({ start: entry.startTime, duration: entry.duration });
    }).observe({ type: "longtask" });
    new MutationObserver(() => {
      const sample = samples.at(-1);
      if (sample && sample.commitMs === undefined)
        sample.commitMs = performance.now() - sample.start;
    }).observe(element, { attributes: true, attributeFilter: ["title"] });
    element.addEventListener(
      "keydown",
      (event) => {
        const key = (event as KeyboardEvent).key;
        if (key.length !== 1) return;
        const sample: Sample = { key, start: performance.now() };
        samples.push(sample);
        requestAnimationFrame(() => {
          sample.firstFrameMs = performance.now() - sample.start;
          requestAnimationFrame(() => {
            sample.nextFrameMs = performance.now() - sample.start;
            completed.push(sample);
          });
        });
      },
      true,
    );
    element.addEventListener(
      "input",
      () => {
        const sample = samples.at(-1);
        if (sample) sample.inputAt = performance.now() - sample.start;
      },
      true,
    );
  });
  const profiler =
    process.env.DEMO_RENDER_PROFILE === "1"
      ? await context.newCDPSession(page)
      : null;
  if (profiler) {
    await profiler.send("Profiler.enable");
    await profiler.send("Profiler.setSamplingInterval", { interval: 1000 });
    await profiler.send("Profiler.start");
  }
  for (const [index, key] of [..."cdefghijklmn"].entries()) {
    await page.keyboard.press(key);
    await page.waitForFunction((count) => {
      const metrics = (
        window as Window & {
          operatorPaintMeasurements?: { completed: unknown[] };
        }
      ).operatorPaintMeasurements;
      return metrics?.completed.length === count;
    }, index + 1);
  }
  await expect(input).toBeFocused();
  if (profiler) {
    const profile = await profiler.send("Profiler.stop");
    await fs.writeFile(
      path.join(evidence, "browser-cpu-profile.json"),
      JSON.stringify(profile),
    );
    await profiler.detach();
  }
  const metrics = await page.evaluate(
    () =>
      (window as Window & { operatorPaintMeasurements?: unknown })
        .operatorPaintMeasurements,
  );
  await expect(input).toHaveValue(`${originalValue}cdefghijklmn`);
  await expect(page.locator(".save-indicator")).toContainText("Сохранено");
  expect(draft.items[125].fullNameRu).toBe(`${originalValue}cdefghijklmn`);
  await fs.writeFile(
    path.join(evidence, "paint-measurements.json"),
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        origin: process.env.DEMO_ORIGIN,
        count: 250,
        nextDev: true,
        synthetic: true,
        keyboard: "trusted CDP key events",
        technique:
          "Capture keydown timestamp in browser; input default action timestamp; title attribute mutation after React commit; first and second requestAnimationFrame. Second RAF is an upper bound spanning a paint, not a standardized INP score.",
        samples: 12,
        profiling: !!profiler,
        focusLoss: 0,
        exactSaveReadback: true,
        metrics,
      },
      null,
      2,
    ),
  );
});

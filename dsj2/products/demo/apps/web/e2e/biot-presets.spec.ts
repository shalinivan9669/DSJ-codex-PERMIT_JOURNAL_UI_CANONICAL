import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { loginIsolated } from "./operator-full-fix-session";
import { expandCommon } from "./operator-common-history-helpers";
import type { Draft } from "../lib/types";

test.use({ trace: "off" });
for (const category of ["WORKER", "ITR"] as const) {
  test(`${category}: current category defaults, explicit hours and automatic expiry survive server save and reload`, async ({
    page,
  }, info) => {
    const evidence = path.resolve(
      process.env.DEMO_E2E_EVIDENCE ||
        "../../docs/evidence/commercial-acceptance/browser/biot-presets",
      "biot-presets",
    );
    await fs.mkdir(evidence, { recursive: true });
    await loginIsolated(page);
    await page.getByRole("link", { name: "Новая заявка", exact: true }).click();
    await page.getByRole("button", { name: "Далее", exact: true }).click();
    const person = page.locator(".person-editor");
    await person.getByLabel("ФИО", { exact: true })
      .fill(`Тестовый Получатель Категории ${category}`);
    await person.getByLabel("Должность", { exact: true }).fill("Электромонтёр");
    await person.getByRole("button", { name: "Далее", exact: true }).click();
    await person.getByRole("button", {
      name: category === "WORKER" ? "Рабочий" : "ИТР", exact: true,
    }).click();
    await person.getByRole("button", { name: "Далее", exact: true }).click();
    await person.getByRole("button", { name: /^БиОТ/ }).click();
    await person.getByRole("button", { name: "Готово", exact: true }).click();
    await expect(person.locator('[data-person-stage="summary"]')).toBeVisible();
    let modal = page.getByRole("dialog", { name: "Параметры документа", exact: true });
    const requestId = /requests\/([^/]+)/.exec(page.url())![1];
    const read = async () =>
      (await (
        await page.request.get(`/api/print-requests/${requestId}`)
      ).json()) as Draft;
    const worker = category === "WORKER";
    const templateId = worker ? "biot-worker-card" : "biot-itr-certificate";
    const categoryValue = worker ? "WORKER" : "OHS_SPECIALIST_SPECIAL";
    const inspect = async () => {
      await person.locator(".person-document-list > li").first()
        .getByRole("button", { name: "Параметры", exact: true }).click();
      modal = page.getByRole("dialog", { name: "Параметры документа", exact: true });
      const form = modal.locator(".assignment-list > details").first();
      await expandCommon(form);
      await form.getByRole("tab", { name: "Основное", exact: true }).click();
      await expandCommon(form.locator(".document-date-details"));
      return form;
    };
    let form = await inspect();
    const biotCategory = form.getByLabel("Категория обучения БиОТ", { exact: true });
    // The ordinary ITR course defaults to the centre programme. Special
    // competencies are a separate explicit choice, not an automatic default.
    await expect(biotCategory).toHaveValue(worker ? "WORKER" : "ITR_STANDARD");
    if (!worker) {
      await expect(form.getByLabel("Объём программы учебного центра, акад. ч.", { exact: true })).toHaveValue("40");
      await biotCategory.selectOption(categoryValue);
    }
    const hoursLabel = worker
      ? "Теоретическое обучение, акад. ч."
      : "Обучение, акад. ч.";
    await expect(
      form.getByLabel("Форма документа", { exact: true }),
    ).toHaveValue(templateId);
    await expect(
      form.getByLabel("Форма документа", { exact: true }),
    ).toBeDisabled();
    await expect(
      form.getByLabel("Категория обучения БиОТ", { exact: true }),
    ).toHaveValue(categoryValue);
    await expect(form.getByLabel(hoursLabel, { exact: true })).toHaveValue(
      worker ? "10" : "40",
    );
    await form.getByLabel("Дата документа", { exact: true }).fill("2028-02-29");
    const until = form.getByLabel("Действителен до", { exact: true });
    await expect(until).toBeEditable();
    await expect(until).toHaveValue(worker ? "2029-02-28" : "2031-02-28");
    await expect(form).toContainText(
      worker
        ? "Расчётный срок: 1 год для рабочего"
        : "Расчётный срок: 3 года для ИТР",
    );
    await expect(form).toContainText(
      "Введённая вручную или импортированная дата сохраняется",
    );
    await form
      .getByLabel(hoursLabel, { exact: true })
      .fill(worker ? "11" : "41");
    await form
      .getByLabel(hoursLabel, { exact: true })
      .fill(worker ? "10" : "40");
    if (worker) {
      await expect(
        form.getByLabel("Производственное обучение, часов", { exact: true }),
      ).toHaveValue("16");
      await form
        .getByLabel("Производственное обучение, часов", { exact: true })
        .fill("17");
      await form
        .getByLabel("Производственное обучение, часов", { exact: true })
        .fill("16");
    }
    await modal
      .getByRole("button", { name: "Готово", exact: true })
      .click();
    await expect(page.locator(".save-indicator")).toContainText(
      "Рабочая версия сохранена",
    );
    const samePreset = await read();
    const originalId = samePreset.items[0].assignments[0].id;
    expect(samePreset.items[0].assignments[0].biotManualFields).toEqual(
      worker ? ["hours", "productionHours"] : ["hours"],
    );
    await page.reload();
    form = await inspect();
    await expect(form.getByLabel(hoursLabel, { exact: true })).toHaveValue(
      worker ? "10" : "40",
    );
    await expect(
      form.getByLabel("Действителен до", { exact: true }),
    ).toHaveValue(worker ? "2029-02-28" : "2031-02-28");
    await form
      .getByLabel(hoursLabel, { exact: true })
      .fill(worker ? "12" : "48");
    if (worker)
      await form
        .getByLabel("Производственное обучение, часов", { exact: true })
        .fill("20");
    await form.getByLabel("Дата документа", { exact: true }).fill("2028-03-01");
    await expect(
      form.getByLabel("Действителен до", { exact: true }),
    ).toHaveValue(worker ? "2029-03-01" : "2031-03-01");
    await modal
      .getByRole("button", { name: "Готово", exact: true })
      .click();
    await expect(page.locator(".save-indicator")).toContainText(
      "Рабочая версия сохранена",
    );
    const raw = await read();
    expect(raw.status).toBe("DRAFT");
    expect(raw.issuances || []).toHaveLength(0);
    expect(raw.items[0].assignments[0].id).toBe(originalId);
    expect(raw.items[0].assignments[0].biotCategory).toBe(categoryValue);
    expect(raw.items[0].assignments[0].biotManualFields).toEqual(
      worker ? ["hours", "productionHours"] : ["hours"],
    );
    expect(
      raw.items[0].assignments.every(
        (assignment) => assignment.outcome?.status === "PASSED",
      ),
    ).toBe(true);
    await page.reload();
    form = await inspect();
    await expect(form.getByLabel(hoursLabel, { exact: true })).toHaveValue(
      worker ? "12" : "48",
    );
    await expect(
      form.getByLabel("Действителен до", { exact: true }),
    ).toHaveValue(worker ? "2029-03-01" : "2031-03-01");
    if (worker)
      await expect(
        form.getByLabel("Производственное обучение, часов", { exact: true }),
      ).toHaveValue("20");
    await page.screenshot({
      path: path.join(evidence, `${templateId}-manual-reload.png`),
    });
    await fs.writeFile(
      path.join(evidence, `${templateId}.json`),
      JSON.stringify(
        {
          status: "PASS",
          requestId,
          syntheticOnly: true,
          currentPolicy: "LIVE_V1",
          automaticExpiryReadOnly: false,
          automaticExpiryVerifiedWithoutOverwritingManualFacts: true,
          specialItrCategoryChosenExplicitly: !worker,
          explicitSamePresetSurvived: samePreset.items[0].assignments,
          rawAfterReload: await read(),
          scope:
            "Actual defaults, explicit hours, leap-date expiry, raw save and reload. Historical manual expiry remains tested separately; this fresh LIVE request promises computed expiry. No issuance or regulatory approval.",
        },
        null,
        2,
      ),
    );
    await fs.writeFile(
      info.outputPath("category-readback.json"),
      JSON.stringify(raw, null, 2),
    );
  });
}

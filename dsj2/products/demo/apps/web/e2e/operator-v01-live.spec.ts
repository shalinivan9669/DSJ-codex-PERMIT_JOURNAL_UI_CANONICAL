import { createRequestWithWorkerDocument } from "./operator-keyboard-helpers";
import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { realApprovalRoles } from "./operator-role-fixture";
import {
  commonSettings,
  expandCommon,
} from "./operator-common-history-helpers";
import type { Draft, Artifact, Job } from "../lib/types";

test.use({ trace: "off" });
test("V01 one person obtains actual files for one mandatory training kit without company, order or portal", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(420000);
  const evidence = path.resolve(
    process.env.DEMO_E2E_EVIDENCE ||
      "../../docs/evidence/operator-value/v01-browser",
    "v01",
  );
  await fs.mkdir(evidence, { recursive: true });
  const started = Date.now();
  const roles = await realApprovalRoles(browser, page);
  try {
    await roles.configureSignatories();
    await page.getByRole("link", { name: "Новая заявка", exact: true }).click();
    await createRequestWithWorkerDocument(page, "PERSON");
    await page
      .getByLabel("ФИО, строка 1", { exact: true })
      .fill("Тестовый Получатель Одиночного Выпуска");
    await page
      .getByLabel("Должность · RU, строка 1", { exact: true })
      .fill("Инженер");
    await page
      .getByRole("button", { name: "Детали получателя 1", exact: true })
      .click();
    const modal = page.getByRole("dialog");
    await modal
      .getByRole("tab", { name: "Личные данные", exact: true })
      .click();
    await expandCommon(modal.locator("details.employer-document-wording"));
    await modal
      .getByLabel("Место работы · RU", { exact: true })
      .fill("Тестовое предприятие");
    await expandCommon(modal.locator("details.person-fields-wide").first());
    await modal
      .locator('[data-field-path="items.0.fullNameKz"]')
      .fill("Синтетикалық Ә Ғ Қ Ң Ө Ұ Ү Һ І");
    await modal
      .getByRole("button", { name: "Вернуться к списку", exact: true })
      .click();
    const training = await commonSettings(page);
    for (const [label, value] of [
      ["Дата документа для заявки", "2026-09-24"],
      ["Начало обучения для заявки", "2026-09-20"],
      ["Окончание обучения для заявки", "2026-09-23"],
      ["Дата проверки / протокола для заявки", "2026-09-23"],
      ["Программа / тема для заявки", "Тестовая программа БиОТ"],
    ])
      await training.getByLabel(label, { exact: true }).fill(value);
    const requestId = /requests\/([^/]+)/.exec(page.url())![1];
    const read = async () =>
      (await (
        await page.request.get(`/api/print-requests/${requestId}`)
      ).json()) as Draft & {
        documents: { id: string; templateId: string; number: string }[];
        artifacts: Artifact[];
      };
    await expect(page.locator(".save-indicator")).toContainText(
      /Рабочая версия сохранена/,
    );
    await page.reload();
    const unknown = await read();
    expect(unknown.items).toHaveLength(1);
    expect(unknown.items[0].assignments).toHaveLength(2);
    expect(
      unknown.items[0].assignments.every(
        (assignment) => assignment.outcome?.status === "UNKNOWN",
      ),
    ).toBe(true);
    expect(unknown.documents).toHaveLength(0);
    expect(unknown.customerId).toBeNull();
    const currentTraining = page.locator("#request-training");
    await expandCommon(currentTraining);
    const outcome = currentTraining.locator(
      'details.outcome-entry:has(> summary[data-training-field="outcomes"])',
    );
    await expandCommon(outcome);
    await outcome
      .getByLabel("Известный результат", { exact: true })
      .selectOption("PASSED");
    await outcome
      .getByLabel("Источник подтверждения", { exact: true })
      .fill("СИНТЕТИЧЕСКАЯ ведомость одиночного выпуска; не реальное обучение");
    expect(
      (await read()).items[0].assignments.every(
        (assignment) => assignment.outcome?.status === "UNKNOWN",
      ),
    ).toBe(true);
    await outcome
      .getByRole("button", {
        name: "Проверить применение результатов",
        exact: true,
      })
      .click();
    await outcome
      .getByRole("button", { name: "Подтвердить результаты", exact: true })
      .click();
    await expect
      .poll(async () =>
        (await read()).items[0].assignments.every(
          (assignment) => assignment.outcome?.status === "PASSED",
        ),
      )
      .toBe(true);
    await page
      .getByRole("button", { name: "Проверить данные", exact: true })
      .click();
    await expect(
      page.getByText("Данные прошли проверку", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(evidence, "v01-ready.png"),
      fullPage: true,
    });
    await roles.approve(requestId);
    await page.reload();
    const finalized = page.waitForResponse(
      (response) =>
        response.url().endsWith("/finalize") &&
        response.request().method() === "POST",
    );
    const renderStarted = Date.now();
    await page
      .getByRole("button", { name: "Сформировать документы", exact: true })
      .click();
    const response = await finalized;
    expect(response.ok(), await response.text()).toBe(true);
    await expect
      .poll(
        async () => {
          const jobs = (
            await (
              await page.request.get(`/api/jobs?requestId=${requestId}`)
            ).json()
          ).items as Job[];
          const issued = jobs.filter((job) => job.issuanceId);
          return (
            issued.length === 6 &&
            issued.every(
              (job) => job.status === "SUCCEEDED" && !!job.artifactId,
            )
          );
        },
        { timeout: 300000, intervals: [1000, 2500] },
      )
      .toBe(true);
    const record = await read();
    expect(record.status).toBe("FINALIZED");
    expect(record.customerId).toBeNull();
    expect(record.items).toHaveLength(1);
    expect(record.items[0].fullNameKz).toBe("Синтетикалық Ә Ғ Қ Ң Ө Ұ Ү Һ І");
    expect(record.documents).toHaveLength(2);
    expect(
      record.documents.map((document) => document.templateId).sort(),
    ).toEqual(["biot-protocol", "biot-worker-card"]);
    expect(record.issuances).toHaveLength(1);
    const files = [];
    for (const artifact of record.artifacts.filter(
      (entry) => entry.issuanceId && entry.documentId,
    )) {
      const download = await page.request.get(`/api/artifacts/${artifact.id}`);
      expect(download.ok()).toBe(true);
      const bytes = await download.body();
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        artifact.sha256,
      );
      if (artifact.format === "PDF")
        expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
      else expect(bytes.subarray(0, 2).toString()).toBe("PK");
      const file = `${artifact.id}.${artifact.format!.toLowerCase()}`;
      await fs.writeFile(path.join(evidence, file), bytes);
      files.push({
        artifactId: artifact.id,
        format: artifact.format,
        sha256: artifact.sha256,
        file,
      });
    }
    expect(files).toHaveLength(4);
    await page.reload();
    expect((await read()).documents).toEqual(record.documents);
    await page.screenshot({
      path: path.join(evidence, "v01-rendered.png"),
      fullPage: true,
    });
    await fs.writeFile(
      path.join(evidence, "v01-result.json"),
      JSON.stringify(
        {
          status: "PASS",
          syntheticDataOnly: true,
          requestId,
          files,
          documents: record.documents,
          browser: browser.version(),
          customerCreated: false,
          orderCreated: false,
          portalConfigured: false,
          services: 1,
          mandatoryForms: 2,
          actualDirectorDecision: true,
          lifecycle: record.lifecycle,
          automatedWallMs: Date.now() - started,
          issueToFilesWallMs: Date.now() - renderStarted,
          activeOperatorMs: null,
          baselineMs: null,
          limitation:
            "Automated synthetic engineering cycle; no real-client usability, legal signature, paid pilot or human timing improvement is established.",
        },
        null,
        2,
      ),
    );
    await fs.writeFile(
      info.outputPath("v01-readback.json"),
      JSON.stringify(record, null, 2),
    );
  } finally {
    await roles.close();
  }
});

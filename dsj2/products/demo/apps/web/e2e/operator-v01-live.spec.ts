import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { realApprovalRoles } from "./operator-role-fixture";
import { expandCommon } from "./operator-common-history-helpers";
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
    await page
      .getByRole("radio", { name: "Физическое лицо", exact: true })
      .check();
    await page.getByRole("button", { name: "Далее", exact: true }).click();
    await page
      .getByLabel("ФИО", { exact: true })
      .fill("Тестовый Получатель Одиночного Выпуска");
    await page.getByLabel("Должность", { exact: true }).fill("Инженер");
    await expandCommon(
      page.locator(".person-editor details.person-additional").first(),
    );
    await page
      .locator(".person-editor")
      .locator('[data-field-path="items.0.fullNameKz"]')
      .fill("Синтетикалық Ә Ғ Қ Ң Ө Ұ Ү Һ І");
    await page.getByRole("button", { name: "Далее", exact: true }).click();
    await page.getByRole("button", { name: "Рабочий", exact: true }).click();
    await page.getByRole("button", { name: "Далее", exact: true }).click();
    await page.getByRole("button", { name: "БиОТ", exact: true }).click();
    const course = page.getByRole("region", {
      name: "Параметры БиОТ",
      exact: true,
    });
    await course
      .getByLabel("Дата документа", { exact: true })
      .fill("2026-09-24");
    await course
      .getByLabel("Дата протокола", { exact: true })
      .fill("2026-09-23");
    await page
      .getByLabel("Место работы", { exact: true })
      .fill("Тестовое предприятие");
    await course
      .getByRole("button", { name: "Параметры", exact: true })
      .first()
      .click();
    const modal = page.getByRole("dialog", {
      name: "Параметры документа",
      exact: true,
    });
    await expandCommon(modal.locator("details.document-date-details"));
    await modal
      .locator('[data-field-path="items.0.assignments.0.trainingStart"]')
      .fill("2026-09-20");
    await modal
      .locator('[data-field-path="items.0.assignments.0.trainingEnd"]')
      .fill("2026-09-23");
    await modal.getByRole("tab", { name: /^Обучение и результат/ }).click();
    await modal
      .locator('[data-field-path="items.0.assignments.0.trainingSubject"]')
      .fill("Тестовая программа БиОТ");
    await modal.getByRole("button", { name: "Готово", exact: true }).click();
    await page.getByRole("button", { name: "Готово", exact: true }).click();
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
    const saved = await read();
    expect(saved.items).toHaveLength(1);
    expect(saved.items[0].assignments).toHaveLength(2);
    expect(
      saved.items[0].assignments.every(
        (assignment) => assignment.outcome?.status === "PASSED",
      ),
    ).toBe(true);
    expect(saved.documents).toHaveLength(0);
    expect(saved.customerId).toBeNull();
    expect(saved.items[0].fullNameKz).toBe("Синтетикалық Ә Ғ Қ Ң Ө Ұ Ү Һ І");
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

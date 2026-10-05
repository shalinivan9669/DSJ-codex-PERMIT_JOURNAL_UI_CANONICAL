import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { draftSchema } from "@demo/contracts";
import { realApprovalRoles, write } from "./operator-role-fixture";
import type { Draft, Artifact, Job } from "../lib/types";

test.use({ trace: "off" });
test("isolated issuer: actual worker and ITR categories generate all four current BIOT forms after a real director decision", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(600000);
  const roles = await realApprovalRoles(browser, page);
  try {
    await roles.adminPage.goto("/settings");
    for (const [label, value] of [
      ["Юридическое название · RU", "ТЕСТОВЫЙ учебный центр БиОТ"],
      ["Юридическое название · KZ", "БиОТ СЫНАҚ оқу орталығы"],
      ["БИН учебного центра", "000000000001"],
      [
        "ФИО руководителя учебного центра",
        roles.director.session.user.displayName,
      ],
      ["Город · RU", "Кызылорда"],
      ["Город · KZ", "Қызылорда"],
      ["Адрес · RU", "Тестовый адрес, 1"],
      ["Адрес · KZ", "Сынақ мекенжайы, 1"],
      [
        "Основание утверждения / полномочий",
        "ТЕСТ: синтетическая комиссия; не реальное обучение",
      ],
    ])
      await roles.adminPage.getByLabel(label, { exact: true }).fill(value);
    await roles.adminPage
      .getByLabel(
        "Реквизиты и состав комиссии проверены уполномоченным сотрудником центра",
      )
      .check();
    await roles.adminPage
      .getByRole("button", { name: "Сохранить новую версию", exact: true })
      .click();
    await expect(
      roles.adminPage.getByText(/Создана новая версия реквизитов/),
    ).toBeVisible();
    await roles.configureSignatories();
    const ids = [randomUUID(), randomUUID()];
    // Fixture declares known synthetic facts. Confirmed metadata is stamped
    // by the authenticated operator API; no fabricated training or decision.
    const created = await write(
      page,
      roles.operator.headers,
      "/print-requests",
      draftSchema.parse({
        kind: "PERSON",
        schemaVersion: 2,
        demoMode: true,
        title: "СИНТЕТИЧЕСКИЕ четыре текущие формы БиОТ " + Date.now(),
        commonFields: { documentDate: "2026-09-22" },
        events: ids.map((id, index) => ({
          id,
          title: index
            ? "Синтетическая БиОТ группа ИТР"
            : "Синтетическая БиОТ группа рабочих",
          protocolTemplateId: index ? "biot-itr-protocol" : "biot-protocol",
          protocolMode: "GROUP",
          commonFields: {
            documentDate: "2026-09-22",
            protocolDate: "2026-09-21",
            trainingStart: "2026-09-18",
            trainingEnd: "2026-09-21",
            trainingSubject: "ТЕСТ: программа по безопасности и охране труда",
            biotCategory: index ? "OHS_SPECIALIST_SPECIAL" : "WORKER",
            hours: index ? "40" : "10",
            productionHours: index ? "" : "16",
            biotIndustryRu: index ? "ТЕСТ: промышленное строительство" : "",
            biotIndustryKz: index ? "СЫНАҚ: өнеркәсіптік құрылыс" : "",
          },
        })),
        items: ids.map((eventId, index) => ({
          id: randomUUID(),
          employeeCategory: index ? "ITR" : "WORKER",
          fullNameRu: index
            ? "Тестовый Получатель ИТР БиОТ"
            : "Тестовый Получатель Рабочий БиОТ",
          fullNameKz: index
            ? "Сынақ ИТР Әли Қасымұлы"
            : "Сынақ Жұмысшы Әли Қасымұлы",
          positionRu: "Тестовый инженер",
          positionKz: "Сынақ инженері",
          workplaceRu: "ТЕСТОВОЕ предприятие",
          workplaceKz: "СЫНАҚ кәсіпорны",
          departmentRu: "Тестовый участок",
          departmentKz: "Сынақ учаскесі",
          employerBin: "000000000002",
          employerAddressRu: "Тестовый адрес предприятия, 2",
          employerAddressKz: "Сынақ кәсіпорын мекенжайы, 2",
          assignments: [
            {
              id: randomUUID(),
              eventId,
              protocolMode: "GROUP",
              templateId: index ? "biot-itr-certificate" : "biot-worker-card",
              biotCategory: index ? "OHS_SPECIALIST_SPECIAL" : "WORKER",
              result: "Сдал / Тапсырды (ТЕСТ)",
              outcome: {
                status: "PASSED",
                source:
                  "СИНТЕТИЧЕСКАЯ известная ведомость четырёх форм БиОТ; не реальное обучение",
              },
              biotKnowledgeResult: index ? "ТЕСТ: 92 из 100" : "",
              biotProctoringResult: index ? "ТЕСТ: прошел / өткен" : "",
            },
          ],
        })),
      }),
    );
    const id = created.id as string;
    const read = async () =>
      (await (
        await page.request.get("/api/print-requests/" + id)
      ).json()) as Draft & {
        documents: Array<{ id: string; templateId: string; number: string }>;
        artifacts: Artifact[];
        issuances: unknown[];
      };
    await page.goto("/requests/" + id + "/edit");
    await page
      .getByRole("button", { name: "Проверить данные", exact: true })
      .click();
    await expect(
      page.getByText("Данные прошли проверку", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Предпросмотр любого документа",
        exact: true,
      })
      .click();
    const previewDialog = page.getByRole("dialog", {
      name: "Предпросмотр документа",
      exact: true,
    });
    await expect(previewDialog).toBeVisible();
    const viewer = previewDialog.getByRole("region", {
      name: "Предпросмотр назначенных документов",
      exact: true,
    });
    await expect(viewer).toBeVisible();
    const previewDraft = await read();
    const previewTargets = [
      ...previewDraft.items.flatMap((person) =>
        person.assignments.map((assignment) => ({
          kind: "ASSIGNMENT" as const,
          rowId: person.id,
          assignmentId: assignment.id,
        })),
      ),
      ...previewDraft.events!.map((event) => ({
        kind: "GROUP_PROTOCOL" as const,
        eventId: event.id,
      })),
    ];
    expect(previewTargets).toHaveLength(4);
    const renderedPreviews: Array<{
      target: unknown;
      pdf: string;
      docx: string;
    }> = [];
    for (const target of previewTargets) {
      await viewer
        .getByLabel("Человек и форма документа", { exact: true })
        .selectOption(JSON.stringify(target));
      const pendingPreview = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/print-requests/${id}/preview`) &&
          response.request().method() === "POST",
      );
      await viewer
        .getByRole("button", { name: "Создать предпросмотр", exact: true })
        .click();
      const response = await pendingPreview;
      expect(response.ok(), await response.text()).toBe(true);
      expect(response.request().postDataJSON()).toMatchObject({
        target,
        expectedRevision: previewDraft.revision,
      });
      await expect(
        viewer.getByRole("img", { name: /^Страница 1 из/ }),
      ).toBeVisible({ timeout: 240000 });
      const pdf = viewer.getByRole("link", {
        name: "Открыть PDF",
        exact: true,
      });
      const docx = viewer.getByRole("link", {
        name: "Скачать DOCX",
        exact: true,
      });
      await expect(pdf).toBeVisible();
      await expect(docx).toBeVisible();
      renderedPreviews.push({
        target,
        pdf: (await pdf.getAttribute("href"))!,
        docx: (await docx.getAttribute("href"))!,
      });
    }
    expect(new Set(renderedPreviews.map((entry) => entry.pdf)).size).toBe(4);
    expect(new Set(renderedPreviews.map((entry) => entry.docx)).size).toBe(4);
    expect((await read()).documents).toHaveLength(0);
    expect((await read()).issuances).toHaveLength(0);
    await page.keyboard.press("Escape");
    await expect
      .poll(
        async () =>
          (await read()).artifacts.filter(
            (artifact) =>
              artifact.provenance === "PREVIEW" && artifact.format === "PDF",
          ).length,
        { timeout: 240000, intervals: [1000, 2500] },
      )
      .toBe(4);
    await roles.approve(id);
    await page.reload();
    const before = await read();
    expect(before.documents).toHaveLength(0);
    const preview = before.artifacts.find(
      (artifact) =>
        artifact.provenance === "PREVIEW" && artifact.format === "PDF",
    )!;
    await page
      .locator(".files-panel")
      .getByRole("button", { name: "Обновить", exact: true })
      .click();
    const card = page.locator(".artifact-list article").filter({
      has: page.locator('a[href="/api/artifacts/' + preview.id + '"]'),
    });
    await card
      .getByRole("button", { name: "Печать макета", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("four-biot-preview.png"),
    });
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Сформировать документы", exact: true })
      .click();
    await expect.poll(async () => (await read()).status).toBe("FINALIZED");
    await expect
      .poll(
        async () => {
          const jobs = (
            await (await page.request.get("/api/jobs?requestId=" + id)).json()
          ).items as Job[];
          const originals = jobs.filter((job) => job.issuanceId);
          return (
            originals.length === 10 &&
            originals.every(
              (job) => job.status === "SUCCEEDED" && !!job.artifactId,
            )
          );
        },
        { timeout: 300000, intervals: [1000, 2500] },
      )
      .toBe(true);
    const issued = await read();
    expect(issued.issuances).toHaveLength(1);
    expect(issued.documents).toHaveLength(4);
    expect(
      issued.documents.map((document) => document.templateId).sort(),
    ).toEqual(
      [
        "biot-worker-card",
        "biot-protocol",
        "biot-itr-certificate",
        "biot-itr-protocol",
      ].sort(),
    );
    const artifacts = [];
    for (const artifact of issued.artifacts.filter((artifact) =>
      ["PDF", "DOCX"].includes(artifact.format || ""),
    )) {
      const response = await page.request.get("/api/artifacts/" + artifact.id);
      expect(response.ok()).toBe(true);
      const bytes = await response.body();
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        artifact.sha256,
      );
      const file = artifact.id + "-" + artifact.fileName;
      await fs.writeFile(testInfo.outputPath(file), bytes);
      artifacts.push({
        id: artifact.id,
        format: artifact.format,
        sha256: artifact.sha256,
        size: bytes.length,
        file,
      });
    }
    const unsigned = await page.request.post(
      "/api/print-requests/" + id + "/export",
      { headers: roles.operator.headers, data: { format: "ZIP" } },
    );
    expect(unsigned.status()).toBe(409);
    expect((await unsigned.json()).code).toBe("ISSUANCE_NOT_COMPLETE");
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("four-biot-rendered-awaiting-signatures.png"),
      fullPage: true,
    });
    await fs.writeFile(
      testInfo.outputPath("issue-result.json"),
      JSON.stringify(
        {
          status: "PASS",
          requestId: id,
          browser: browser.version(),
          profileConfiguredThroughAdminUi: true,
          actualOperatorAndDirectorRoles: true,
          initialFixtureKnownSyntheticFacts: true,
          directorDecisionThroughUi: true,
          currentForms: issued.documents,
          renderedPreviews,
          artifacts,
          unsignedOfficialDeliveryCode: "ISSUANCE_NOT_COMPLETE",
          ncaSignatureAcceptanceVerified: false,
        },
        null,
        2,
      ),
    );
    if (process.env.DEMO_E2E_EVIDENCE)
      await fs.copyFile(
        testInfo.outputPath("issue-result.json"),
        path.join(
          process.env.DEMO_E2E_EVIDENCE,
          "biot-four-current-forms.json",
        ),
      );
  } finally {
    await roles.close();
  }
});

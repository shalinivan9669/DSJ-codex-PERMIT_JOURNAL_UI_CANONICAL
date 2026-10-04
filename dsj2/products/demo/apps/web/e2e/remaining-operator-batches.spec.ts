import { test, expect } from "@playwright/test";
import { randomUUID, createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { draftSchema } from "@demo/contracts";
import {
  realApprovalRoles,
  write,
  readPrintDetail,
  waitOriginalJobs,
} from "./operator-role-fixture";

test("one working request: director approves selected BIOT then later PTM, real originals and combined PDF retain first batch", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(900000);
  const evidence = path.join(
    process.env.DEMO_E2E_EVIDENCE!,
    "remaining-batches",
  );
  await fs.mkdir(evidence, { recursive: true });
  const roles = await realApprovalRoles(browser, page);
  try {
    await roles.configureSignatories();
    const biot = randomUUID(),
      ptm = randomUUID();
    const input = draftSchema.parse({
      kind: "PERSON",
      schemaVersion: 2,
      businessRuleVersion: "LIVE_V1",
      demoMode: true,
      title: "СИНТЕТИЧЕСКАЯ сквозная заявка произвольных партий",
      events: [
        {
          id: biot,
          title: "Безопасность и охрана труда",
          protocolTemplateId: "biot-protocol",
          protocolMode: "GROUP",
          commonFields: {
            biotCategory: "WORKER",
            hours: "10",
            productionHours: "16",
            trainingStart: "2026-10-01",
            trainingEnd: "2026-10-03",
            documentDate: "2026-10-04",
            protocolDate: "2026-10-04",
          },
        },
        {
          id: ptm,
          title: "ПТМ",
          protocolTemplateId: "ptm-protocol",
          protocolMode: "GROUP",
          commonFields: {
            trainingStart: "2026-10-01",
            trainingEnd: "2026-10-03",
            documentDate: "2026-10-05",
            protocolDate: "2026-10-05",
          },
        },
      ],
      items: [0, 1].map((index) => ({
        id: randomUUID(),
        fullNameRu: `Синтетический Последовательный Получатель ${index + 1}`,
        fullNameKz: `Сынақ Қатысушы ${index + 1}`,
        positionRu: "Электромонтёр",
        positionKz: "Электрмонтер",
        workplaceRu: "Синтетическое предприятие",
        employeeCategory: "WORKER",
        assignments: [
          {
            id: randomUUID(),
            eventId: biot,
            templateId: "biot-worker-card",
            protocolMode: "GROUP",
            biotCategory: "WORKER",
            hours: "10",
            productionHours: "16",
            outcome: {
              status: index === 0 ? "PASSED" : "UNKNOWN",
              source:
                index === 0 ? "СИНТЕТИЧЕСКАЯ ведомость БиОТ от 04.10.2026" : "",
            },
          },
          {
            id: randomUUID(),
            eventId: ptm,
            templateId: "ptm-card",
            protocolMode: "GROUP",
            outcome: { status: "UNKNOWN", source: "" },
          },
        ],
      })),
    });
    const created = await write(
      page,
      roles.operator.headers,
      "/print-requests",
      input,
    );
    const id = created.id;
    await page.goto(`/requests/${id}/edit`);
    const panel = page.getByRole("region", {
      name: "Готовность и состав следующего выпуска",
    });
    // Named section is exposed as region; use its accessible ready selection.
    await panel
      .getByLabel(/Все подтверждённые ещё не оформленные курсы/)
      .check();
    await panel
      .getByRole("button", { name: /Проверить и передать директору/ })
      .click();
    await expect(
      panel.getByText(/Выбранный состав проверен и передан директору/),
    ).toBeVisible();
    await roles.approve(id);
    await page.reload();
    await page
      .getByRole("button", { name: "Сформировать документы", exact: true })
      .click();
    await waitOriginalJobs(page, id, 420000);
    let state = await readPrintDetail(page, id);
    expect(state.status).toBe("DRAFT");
    expect(state.issuances).toHaveLength(1);
    expect(state.issuedAssignments).toHaveLength(1);
    const first = state.issuances[0];
    const originals = state.artifacts.filter(
      (artifact) =>
        artifact.issuanceId === first.id &&
        ["PDF", "DOCX"].includes(artifact.format!),
    );
    expect(originals).toHaveLength(4);
    const immutable = [];
    for (const artifact of originals) {
      const response = await page.request.get(`/api/artifacts/${artifact.id}`);
      expect(response.ok()).toBe(true);
      const bytes = await response.body();
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        artifact.sha256,
      );
      await fs.writeFile(
        path.join(evidence, `${artifact.id}.${artifact.format!.toLowerCase()}`),
        bytes,
      );
      immutable.push({
        id: artifact.id,
        sha256: artifact.sha256,
        number: state.documents.find(
          (document) => document.id === artifact.documentId,
        )?.number,
      });
    }
    await fs.writeFile(
      path.join(evidence, "first-readback.json"),
      JSON.stringify(state, null, 2),
    );
    await page.reload();
    await expect(
      page.getByText(/Согласованная партия уже оформлена/),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Сформировать документы", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Документы и печать", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(evidence, "first-batch-ready.png"),
      fullPage: true,
    });
    // Same person confirms a different course on a later date. Read/write actual
    // persisted identities so first issued assignment cannot be reconstructed.
    const savedWorking = await page.request.get(`/api/print-requests/${id}`);
    expect(savedWorking.ok()).toBe(true);
    const secondInput = draftSchema.parse((await savedWorking.json()).draft);
    secondInput.items[0].assignments.find(
      (assignment) => assignment.eventId === ptm,
    )!.outcome = {
      status: "PASSED",
      source: "СИНТЕТИЧЕСКАЯ ведомость ПТМ от 05.10.2026",
    };
    secondInput.items[1].positionRu = "Синтетический Ожидающий Мастер";
    await write(
      page,
      roles.operator.headers,
      `/print-requests/${id}`,
      { expectedRevision: state.revision, draft: secondInput },
      "PATCH",
    );
    await page.reload();
    await panel
      .getByLabel(/Все подтверждённые ещё не оформленные курсы/)
      .check();
    await panel
      .getByRole("button", { name: /Проверить и передать директору/ })
      .click();
    await expect(
      panel.getByText(/Выбранный состав проверен и передан директору/),
    ).toBeVisible();
    await roles.approve(id);
    await page.reload();
    await page
      .getByRole("button", { name: "Сформировать документы", exact: true })
      .click();
    await expect
      .poll(async () => (await readPrintDetail(page, id)).issuances.length, {
        timeout: 210000,
      })
      .toBe(2);
    await waitOriginalJobs(page, id, 420000);
    state = await readPrintDetail(page, id);
    expect(state.id).toBe(id);
    expect(state.status).toBe("DRAFT");
    expect(state.issuances).toHaveLength(2);
    expect(state.issuedAssignments).toHaveLength(2);
    expect(
      state.items[1].assignments.every(
        (assignment) => assignment.outcome?.status === "UNKNOWN",
      ),
    ).toBe(true);
    for (const artifact of immutable) {
      const response = await page.request.get(`/api/artifacts/${artifact.id}`);
      expect(
        createHash("sha256")
          .update(await response.body())
          .digest("hex"),
      ).toBe(artifact.sha256);
    }
    await fs.writeFile(
      path.join(evidence, "second-readback.json"),
      JSON.stringify(state, null, 2),
    );
    const pdfs = state.artifacts.filter(
      (artifact) =>
        artifact.issuanceId === first.id && artifact.format === "PDF",
    );
    const plan = await page.request.post(
      `/api/print-requests/${id}/print-set/plan`,
      {
        headers: roles.operator.headers,
        data: {
          format: "PDF",
          artifactIds: pdfs.map((artifact) => artifact.id),
        },
      },
    );
    expect(plan.ok(), await plan.text()).toBe(true);
    const planned = await plan.json();
    expect(planned.files).toHaveLength(2);
    const packed = await write(
      page,
      roles.operator.headers,
      `/print-requests/${id}/print-set`,
      { format: "PDF", artifactIds: pdfs.map((artifact) => artifact.id) },
    );
    expect(packed.pages).toBeGreaterThanOrEqual(2);
    const packedResponse = await page.request.get(
      `/api/artifacts/${packed.artifact.id}`,
    );
    expect(packedResponse.ok()).toBe(true);
    await fs.writeFile(
      path.join(evidence, "first-batch-combined.pdf"),
      await packedResponse.body(),
    );
    await fs.writeFile(
      path.join(evidence, "combined-manifest.json"),
      JSON.stringify({ plan: planned, result: packed, immutable }, null, 2),
    );
    await page.goto("/requests");
    const requestRow = page.getByRole("row").filter({
      has: page.locator(`a[href="/requests/${id}"]`).first(),
    });
    await expect(requestRow).toHaveCount(1);
    await requestRow
      .getByRole("button", { name: "PDF последнего выпуска", exact: true })
      .click();
    await expect(
      requestRow.getByText(/файлов, .* человек, частей/),
    ).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await requestRow
      .getByRole("button", { name: "Скачать PDF", exact: true })
      .click();
    const download = await downloadPromise;
    await download.saveAs(path.join(evidence, "latest-batch-from-list.pdf"));
    await page.screenshot({
      path: path.join(evidence, "download-latest-from-list.png"),
      fullPage: true,
    });
    await testInfo.attach("saved-batch-manifest", {
      body: JSON.stringify({
        requestId: id,
        issuanceIds: state.issuances.map((issuance) => issuance.id),
        immutable,
        mergedArtifactId: packed.artifact.id,
      }),
      contentType: "application/json",
    });
  } finally {
    await roles.close();
  }
});

import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { templateIds } from "@demo/contracts";
import {
  loginRole,
  readPrintDetail,
  waitOriginalJobs,
} from "./operator-role-fixture";

test("resume the existing UI-entered manual twenty at director review and verify all eleven original forms", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(3_600_000);
  const id = process.env.DEMO_E2E_MANUAL20_REQUEST_ID;
  const proposalId = process.env.DEMO_E2E_MANUAL20_PROPOSAL_ID;
  test.skip(
    !id || !proposalId,
    "This continuation requires the existing UI-created request and proposal IDs",
  );
  expect(new URL(process.env.DEMO_ORIGIN!).hostname).toBe("127.0.0.1");
  const checkpointPath = process.env.DEMO_E2E_MANUAL20_CHECKPOINT;
  expect(checkpointPath, "Exact UI preparation checkpoint is required").toBeTruthy();
  const checkpointBytes = await fs.readFile(checkpointPath!);
  const checkpoint = JSON.parse(checkpointBytes.toString("utf8")) as {
    requestId: string;
    proposalId: string;
    noApiPrefill: boolean;
    before: Awaited<ReturnType<typeof readPrintDetail>>;
  };
  expect(checkpoint.requestId).toBe(id);
  expect(checkpoint.proposalId).toBe(proposalId);
  expect(checkpoint.noApiPrefill).toBe(true);
  const sourceCheckpoint = {
    path: checkpointPath,
    sha256: createHash("sha256").update(checkpointBytes).digest("hex"),
  };
  const operator = await loginRole(page, "OPERATOR");
  const before = await readPrintDetail(page, id!);
  expect(before.items).toEqual(checkpoint.before.items);
  expect(before.items).toHaveLength(20);
  expect(
    before.items.every((row) => row.fullNameRu.startsWith("Синтетический ")),
  ).toBe(true);
  expect(before.approval?.proposalId).toBe(proposalId);
  expect(before.approval?.status).toBe("PENDING");
  expect(before.issuances).toHaveLength(0);
  const writeJson = (name: string, value: unknown) =>
    fs.writeFile(testInfo.outputPath(name), JSON.stringify(value, null, 2));
  await writeJson("manual20-resume-before.json", {
    synthetic: true,
    apiPrefill: false,
    requestId: id,
    proposalId,
    sourceCheckpoint,
    before,
  });
  await page.goto(`/requests/${id}/edit`);
  await expect(page.getByLabel("ФИО, строка 20", { exact: true })).toHaveValue(
    before.items[19].fullNameRu,
  );
  const directorContext = await browser.newContext({
    baseURL: process.env.DEMO_ORIGIN,
  });
  const steps = [
    "Продолжена существующая заявка после реального ручного ввода20 и явной передачи директору; повторного ввода нет",
  ];
  try {
    const directorPage = await directorContext.newPage();
    const director = await loginRole(directorPage, "DIRECTOR");
    expect(director.session.tenant.id).toBe(operator.session.tenant.id);
    await directorPage.goto(`/approvals?proposal=${proposalId}`);
    await expect(
      directorPage.getByRole("region", {
        name: "Подготовленные данные редакции",
      }),
    ).toContainText("20 человек");
    const viewer = directorPage.getByRole("region", {
      name: "Предпросмотр назначенных документов",
    });
    const reviewedPerson = before.items[19];
    const reviewedAssignment = reviewedPerson.assignments.find(
      (assignment) => assignment.templateId === "biot-itr-certificate",
    )!;
    expect(reviewedAssignment).toBeTruthy();
    const selector = viewer.getByRole("combobox", {
      name: "Человек и форма документа",
      exact: true,
    });
    await selector.selectOption(
      JSON.stringify({
        kind: "ASSIGNMENT",
        rowId: reviewedPerson.id,
        assignmentId: reviewedAssignment.id,
      }),
    );
    await expect(selector.locator("option:checked")).toContainText(
      reviewedPerson.fullNameRu,
    );
    await viewer
      .getByRole("button", { name: "Создать предпросмотр", exact: true })
      .click();
    await expect(
      viewer.getByRole("img", { name: /^Страница 1 из/ }),
    ).toBeVisible({ timeout: 240_000 });
    await expect(
      viewer.getByRole("link", { name: "Открыть PDF", exact: true }),
    ).toBeVisible();
    await expect(
      viewer.getByRole("link", { name: "Скачать DOCX", exact: true }),
    ).toBeVisible();
    await directorPage.screenshot({
      path: testInfo.outputPath("manual20-director-preview.png"),
      fullPage: true,
    });
    steps.push(
      "Директор открыл сводку20 и реально отрисованный PDF сертификата ИТР строки20 переданной редакции",
    );
    await directorPage
      .getByRole("button", { name: "Согласовать эту редакцию", exact: true })
      .click();
    await expect
      .poll(async () => (await readPrintDetail(page, id!)).approval?.status, {
        timeout: 120_000,
      })
      .toBe("APPROVED");
    steps.push("Одно решение директора для всего переданного состава");
    await writeJson("manual20-resume-approved.json", {
      steps,
      approved: await readPrintDetail(page, id!),
    });
    // Intentionally do not reload the operator page between the decision and this assertion.
    const finalize = page.getByRole("button", {
      name: "Сформировать документы",
      exact: true,
    });
    await expect(finalize).toBeEnabled({ timeout: 60_000 });
    await page.screenshot({
      path: testInfo.outputPath(
        "manual20-operator-approved-without-reload.png",
      ),
      fullPage: true,
    });
    steps.push(
      "Оператор получил решение автоматически без reload и повторной передачи",
    );
    await finalize.click({ timeout: 120_000 });
    await expect
      .poll(async () => (await readPrintDetail(page, id!)).issuances.length, {
        timeout: 240_000,
      })
      .toBe(1);
    await writeJson("manual20-resume-issued-checkpoint.json", {
      steps,
      issued: await readPrintDetail(page, id!),
    });
    console.log("MANUAL20_ISSUANCE_CREATED", id);
    await waitOriginalJobs(page, id!, 2_700_000);
    const issued = await readPrintDetail(page, id!);
    expect(issued.issuances).toHaveLength(1);
    expect(issued.documents).toHaveLength(105);
    expect(
      [...new Set(issued.documents.map((entry) => entry.templateId))].sort(),
    ).toEqual([...templateIds].sort());
    const snapshot = issued.issuances[0].snapshot.draft;
    expect(snapshot.items).toHaveLength(20);
    expect(snapshot.items.map((row) => row.fullNameRu)).toEqual(
      before.items.map((row) => row.fullNameRu),
    );
    for (const row of snapshot.items)
      for (const assignment of row.assignments) {
        expect(assignment.trainingStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(assignment.trainingEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(assignment.protocolDate).toBe(assignment.documentDate);
      }
    const artifacts = issued.artifacts.filter(
      (artifact) =>
        artifact.issuanceId === issued.issuances[0].id &&
        ["PDF", "DOCX"].includes(artifact.format || ""),
    );
    expect(artifacts).toHaveLength(210);
    const examples = new Map<string, (typeof artifacts)[number]>();
    for (const artifact of artifacts) {
      const document = issued.documents.find(
        (entry) => entry.id === artifact.documentId,
      );
      if (
        document &&
        !examples.has(`${document.templateId}.${artifact.format}`)
      )
        examples.set(`${document.templateId}.${artifact.format}`, artifact);
    }
    expect(examples.size).toBe(22);
    const paths: Record<string, string> = {};
    const selected: Record<string, unknown> = {};
    for (const [key, artifact] of examples) {
      const response = await page.request.get(`/api/artifacts/${artifact.id}`);
      expect(response.ok()).toBe(true);
      const bytes = await response.body();
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        artifact.sha256,
      );
      paths[key] = testInfo.outputPath(`example-${key.toLowerCase()}`);
      selected[key] = {
        artifact,
        document: issued.documents.find(
          (entry) => entry.id === artifact.documentId,
        ),
      };
      await fs.writeFile(paths[key], bytes);
    }
    steps.push(
      "Один выпуск105 документов; скачаны22 оригинальных примераPDF/DOCX для всех11 форм, хеши проверены",
    );
    await page.screenshot({
      path: testInfo.outputPath("manual20-files.png"),
      fullPage: true,
    });
    await writeJson("manual20-readback.json", {
      synthetic: true,
      noApiPrefill: true,
      continuedExistingUiRequest: true,
      sourceCheckpoint,
      requestId: id,
      proposalId,
      steps,
      saved: before,
      snapshot,
      documents: issued.documents,
      selectedExamples: selected,
      examples: paths,
    });
    console.log("MANUAL20_ALL_FORMS_DOWNLOADED", id, paths);
  } finally {
    await directorContext.close();
  }
});

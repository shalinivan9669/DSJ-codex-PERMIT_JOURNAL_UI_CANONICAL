import { test, expect, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { measureLmsActions } from "./lms-action-measurement";

const product = path.resolve(__dirname, "../../..");
const evidence = process.env.DEMO_E2E_EVIDENCE
  ? path.resolve(process.env.DEMO_E2E_EVIDENCE, "lms-copy-original-live")
  : path.join(
      product,
      "docs/evidence/lms-one-run-20261015/agent-b/copy-original-live",
    );
const execute = promisify(execFile);
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
async function fixtureCommand(mode?: "--advance" | "--readback") {
  await execute(
    process.execPath,
    [
      path.join(product, "node_modules/tsx/dist/cli.mjs"),
      "--tsconfig",
      "apps/api/tsconfig.json",
      "scripts/verification/lms-copy-fixture.ts",
      ...(mode ? [mode] : []),
    ],
    {
      cwd: product,
      env: process.env,
      timeout: mode === "--advance" ? 240000 : 60000,
      windowsHide: true,
    },
  );
}
async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Электронная почта", { exact: true }).fill(email);
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("Synthetic-LMS-only-20261015!");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test("COPY_OF_ORIGINAL: reviewed external private source becomes an approved real copy with files, registry and minimal public QR", async ({
  page,
}) => {
  test.setTimeout(360000);
  await fixtureCommand();
  const fixture = JSON.parse(
    await fs.readFile(
      path.join(product, ".runtime/lms-one-run/copy-fixture.json"),
      "utf8",
    ),
  );
  await fs.mkdir(evidence, { recursive: true });
  await fs.writeFile(
    path.join(evidence, "fixture.json"),
    JSON.stringify(fixture, null, 2),
  );
  await login(page, fixture.director);
  await page.goto("/lms/results");
  const measurements: unknown[] = [];
  function measure(
    target: Page,
    phase: string,
    startState: string,
    goal: string,
  ) {
    const value = measureLmsActions(
      target,
      `E10 COPY_OF_ORIGINAL: ${phase}`,
      "DIRECTOR",
      startState,
      [
        fixture.preconditions,
        `Fixture setup ${fixture.setupMilliseconds} ms and initial authentication are outside this prepared operation.`,
      ],
    );
    return {
      action: value.action,
      finish(result: unknown) {
        const actual = value.finish(result);
        measurements.push({
          ...actual,
          phase,
          startState,
          goal,
          actualSteps: actual.steps,
          filledFields: actual.fields,
        });
      },
    };
  }
  const prepare = measure(
    page,
    "prepared copy request",
    "Known eligible external result selected in the open result list",
    "Prepare the copy from saved source and learner fields without re-entry",
  );
  const preparedResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/lms/results/documents") &&
      r.request().method() === "POST",
  );
  await prepare.action(
    "click",
    "Prepare selected copy",
    () =>
      page
        .getByRole("button", { name: "Подготовить документы · 1", exact: true })
        .click(),
    { decision: true, confirmation: true },
  );
  const prepared = await (await preparedResponse).json();
  expect(prepared.errors).toEqual([]);
  expect(prepared.items).toHaveLength(1);
  const link = prepared.items[0];
  expect(link.legalForm).toBe("COPY_OF_ORIGINAL");
  expect(link.originalReference).toContain(fixture.originalNumber);
  await expect(
    page.getByText("Копия оригинала", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Скачать комплект", exact: true }),
  ).toBeDisabled();
  prepare.finish({
    requestId: link.requestId,
    legalForm: link.legalForm,
    waitingForApproval: true,
  });
  await page.screenshot({
    path: path.join(evidence, "01-copy-awaiting-approval.png"),
    fullPage: true,
  });
  const proposals = await (await page.request.get("/api/approvals")).json();
  const proposal = proposals.items.find(
    (p: { requestId: string }) => p.requestId === link.requestId,
  );
  expect(proposal).toBeTruthy();
  const approval = measure(
    page,
    "separate director approval",
    "Immutable submitted copy proposal exists; its page has not been opened",
    "Review the saved copy proposal and explicitly approve it",
  );
  await approval.action("navigate", "Open the immutable proposal", () =>
    page.goto(`/approvals?proposal=${proposal.id}`),
  );
  const approved = page.waitForResponse((r) =>
    r.url().endsWith(`/api/approvals/${proposal.id}/decision`),
  );
  await approval.action(
    "click",
    "Approve this revision",
    () =>
      page
        .getByRole("button", { name: "Согласовать эту редакцию", exact: true })
        .click(),
    { decision: true, confirmation: true },
  );
  expect((await approved).ok()).toBe(true);
  approval.finish({ approved: true, separateAuthorizedDecision: true });
  await fixtureCommand("--advance");
  await fixtureCommand("--readback");
  const readback = JSON.parse(
    await fs.readFile(
      path.join(product, ".runtime/lms-one-run/copy-readback.json"),
      "utf8",
    ),
  );
  expect(readback).toMatchObject({
    workflowStatus: "ISSUED",
    legalForm: "COPY_OF_ORIGINAL",
    assessmentKind: "EXTERNAL_AUTHORIZED",
    score: null,
    maximum: null,
    attempts: 0,
    signatures: 0,
    sourceStatus: "DOCUMENT_REVIEWED",
    privateSourceSha256: fixture.sourceSha256,
  });
  await fs.writeFile(
    path.join(evidence, "readback.json"),
    JSON.stringify(readback, null, 2),
  );
  const record = await (
    await page.request.get(`/api/print-requests/${link.requestId}`)
  ).json();
  expect(record.documents).toHaveLength(1);
  const assignment = record.items[0].assignments[0];
  expect(assignment.lms).toMatchObject({
    legalForm: "COPY_OF_ORIGINAL",
    assessmentKind: "EXTERNAL_AUTHORIZED",
    score: null,
    maximum: null,
    source: {
      verification: "DOCUMENT_REVIEWED",
      issuer: fixture.issuer,
      documentNumber: fixture.originalNumber,
    },
  });
  const sourceFile = await page.request.get(
    `/api/lms/external-evidence/${fixture.sourceId}/file`,
  );
  expect(sourceFile.ok()).toBe(true);
  expect(digest(await sourceFile.body())).toBe(fixture.sourceSha256);
  const files = measure(
    page,
    "saved files and registry",
    "Approved copy is issued by the application and its original files are ready",
    "Download actual PDF, DOCX and registry without changing saved source facts",
  );
  await files.action("navigate", "Open the saved copy request", () =>
    page.goto(`/requests/${link.requestId}`),
  );
  const personSummary = page.getByRole("region", { name: "Данные физлица" });
  await expect(
    personSummary.getByText("Обучение — сертификат центра", { exact: true }),
  ).toBeVisible();
  await expect(personSummary).not.toContainText("lms-certificate");
  const hashes: Record<string, string> = {};
  for (const format of ["PDF", "DOCX"]) {
    const artifact = record.artifacts.find(
      (item: { format: string; provenance: string }) =>
        item.format === format && item.provenance === "ORIGINAL",
    );
    expect(artifact).toBeTruthy();
    const downloading = page.waitForEvent("download");
    await files.action(
      "click",
      `Download original application ${format}`,
      () =>
        page
          .locator(`.artifact-list a[href="/api/artifacts/${artifact.id}"]`)
          .click(),
      { decision: true },
    );
    const file = path.join(evidence, `copy.${format.toLowerCase()}`);
    await (await downloading).saveAs(file);
    hashes[format] = digest(await fs.readFile(file));
    expect(hashes[format]).toBe(artifact.sha256);
  }
  const registryDownload = page.waitForEvent("download");
  await files.action(
    "click",
    "Download real issued registry",
    () =>
      page.getByRole("button", { name: "Реестр XLSX", exact: true }).click(),
    { decision: true },
  );
  await (await registryDownload).saveAs(path.join(evidence, "registry.xlsx"));
  files.finish({
    actualPdf: true,
    actualDocx: true,
    registryDownload: true,
    artifactHashes: hashes,
  });
  await page.screenshot({
    path: path.join(evidence, "02-issued-copy-files.png"),
    fullPage: true,
  });
  const publication = measure(
    page,
    "explicit public verification",
    "Issued copy request is open with publication controls available",
    "Publish only the minimal registry record and inspect the copy/source labels",
  );
  await publication.action("click", "Open publication controls", () =>
    page
      .locator("summary")
      .filter({ hasText: "Ссылка и QR для проверки записи" })
      .click(),
  );
  await publication.action(
    "select",
    "Select the saved issued copy",
    () =>
      page
        .getByRole("combobox", { name: "Выданный документ", exact: true })
        .selectOption(record.documents[0].id),
    { decision: true },
  );
  await publication.action(
    "click",
    "Give explicit publication permission",
    () =>
      page
        .getByRole("checkbox", {
          name: "Разрешаю публичную проверку выбранной записи эмитента",
          exact: true,
        })
        .check(),
    { decision: true, confirmation: true },
  );
  const linkResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/verification-links") &&
      r.request().method() === "POST",
  );
  await publication.action(
    "click",
    "Create the minimal link and QR",
    () =>
      page
        .getByRole("button", { name: "Создать ссылку и QR", exact: true })
        .click(),
    { decision: true, confirmation: true },
  );
  const verification = await (await linkResponse).json();
  await expect(
    page.getByRole("img", {
      name: "QR для проверки записи эмитента",
      exact: true,
    }),
  ).toBeVisible();
  const popup = page.waitForEvent("popup");
  await publication.action(
    "click",
    "Open the public minimal record",
    () =>
      page
        .getByRole("link", { name: "Открыть публичную проверку", exact: true })
        .click(),
    { navigation: true },
  );
  const publicPage = await popup;
  await expect(
    publicPage.getByText("Копия оригинала", { exact: true }),
  ).toBeVisible();
  await expect(
    publicPage.getByText(record.documents[0].number, { exact: true }),
  ).toBeVisible();
  await expect(
    publicPage.getByText(fixture.originalNumber, { exact: false }),
  ).toBeVisible();
  await expect(
    publicPage.getByText(fixture.fullName, { exact: true }),
  ).toHaveCount(0);
  const minimal = await (
    await publicPage.request.get(`/api/verification/${verification.token}`)
  ).json();
  expect(minimal.learningDocument).toMatchObject({
    legalForm: "COPY_OF_ORIGINAL",
    assessmentKind: "EXTERNAL_AUTHORIZED",
    sourceIssuer: fixture.issuer,
    sourceVerification: "DOCUMENT_REVIEWED",
    originalReference: link.originalReference,
  });
  const publicJson = JSON.stringify(minimal);
  for (const forbidden of [
    fixture.fullName,
    fixture.learner,
    fixture.director,
    fixture.sourceSha256,
    "storageKey",
    "password",
    "MACHINE_VERIFIED",
  ])
    expect(publicJson).not.toContain(forbidden);
  expect(minimal).not.toHaveProperty("score");
  await publicPage.screenshot({
    path: path.join(evidence, "03-public-copy-minimal-record.png"),
    fullPage: true,
  });
  publication.finish({
    minimalPublicRecord: true,
    copyLabel: true,
    originalReference: link.originalReference,
    fullNamePublished: false,
    electronicSignatureClaimed: false,
  });
  await publicPage.close();
  const validation = await execute(
    process.env.DEMO_PYTHON!,
    [
      "-c",
      [
        "import sys,json,zipfile,xml.etree.ElementTree as E,fitz,openpyxl,pathlib",
        "p=pathlib.Path(sys.argv[1]); pdf=fitz.open(p/'copy.pdf'); text='\\n'.join(page.get_text() for page in pdf)",
        "pdf[0].get_pixmap(matrix=fitz.Matrix(1.5,1.5)).save(p/'copy-page-1.png')",
        "z=zipfile.ZipFile(p/'copy.docx'); root=E.fromstring(z.read('word/document.xml')); docx=' '.join(root.itertext())",
        "w=openpyxl.load_workbook(p/'registry.xlsx',read_only=True,data_only=False); rows=[list(r) for sheet in w for r in sheet.iter_rows(values_only=True)]",
        "print(json.dumps({'pdfText':text,'docxText':docx,'registryRows':rows,'pages':len(pdf)},ensure_ascii=False,default=str))",
      ].join("\n"),
      evidence,
    ],
    {
      windowsHide: true,
      timeout: 30000,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    },
  );
  const rendered = JSON.parse(validation.stdout);
  for (const text of [rendered.pdfText, rendered.docxText]) {
    expect(text).toContain("Копия исходного документа");
    expect(text).toContain(fixture.originalNumber);
    expect(text).toContain(fixture.issuer);
    expect(text).not.toContain("MACHINE_VERIFIED");
    expect(text).not.toMatch(/10\s*\/\s*10|9\s*\/\s*10/);
  }
  expect(JSON.stringify(rendered.registryRows)).toContain(
    record.documents[0].number,
  );
  await fs.writeFile(
    path.join(evidence, "file-validation.json"),
    JSON.stringify(rendered, null, 2),
  );
  await fs.writeFile(
    path.join(evidence, "acceptance.json"),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        result: "PASS",
        legalForm: "COPY_OF_ORIGINAL",
        synthetic: true,
        fixtureVersion: fixture.fixtureVersion,
        preconditions: fixture.preconditions,
        requestId: link.requestId,
        documentId: record.documents[0].id,
        issuedNumber: record.documents[0].number,
        operatorDocumentLabel: "Обучение — сертификат центра",
        technicalTemplateCodeVisibleInOperatorControl: false,
        sourceId: fixture.sourceId,
        originalReference: link.originalReference,
        sourceStatus: "DOCUMENT_REVIEWED",
        assessmentKind: "EXTERNAL_AUTHORIZED",
        score: null,
        maximum: null,
        localAttempts: 0,
        electronicSignatures: 0,
        actualPrivateFileRetained: true,
        hashes,
        registryRows: rendered.registryRows.length,
        publicRecord: minimal,
        measurements,
        physicalPrintPerformed: false,
        realAuthorityClaimed: false,
        visualReview:
          "Pending separate visual inspection of actual copy-page-1.png; text/hash/assertion PASS is not visual review.",
      },
      null,
      2,
    ),
  );
});

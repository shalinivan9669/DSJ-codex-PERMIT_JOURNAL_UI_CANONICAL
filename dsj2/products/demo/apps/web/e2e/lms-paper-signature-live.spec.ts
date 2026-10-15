import { test, expect, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const product = path.resolve(__dirname, "../../..");
const evidence = process.env.DEMO_E2E_EVIDENCE
  ? path.resolve(process.env.DEMO_E2E_EVIDENCE, "lms-paper-signature-live")
  : path.join(
      product,
      "docs/evidence/lms-one-run-20261015/agent-b/paper-signature-live",
    );
async function fixtureCommand(render = false, negative = false) {
  await promisify(execFile)(
    process.execPath,
    [
      path.join(product, "node_modules/tsx/dist/cli.mjs"),
      "--tsconfig",
      "apps/api/tsconfig.json",
      "scripts/verification/lms-operator-fixture.ts",
      "--paper",
      ...(render ? ["--render"] : []),
      ...(negative ? ["--negative-binding"] : []),
    ],
    { cwd: product, env: process.env, timeout: render ? 210000 : 30000 },
  );
}
async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Электронная почта", { exact: true }).fill(email);
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("Synthetic-LMS-only-20261015!");
  const response = page.waitForResponse((value) =>
    value.url().endsWith("/api/auth/login"),
  );
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  const auth = await (await response).json();
  await expect(page).not.toHaveURL(/\/login/);
  return {
    "x-csrf-token": auth.csrfToken as string,
    origin: process.env.DEMO_ORIGIN!,
  };
}

test("synthetic paper original requires a separate immutable director attestation and never invents electronic signatures", async ({
  page,
  browser,
}) => {
  test.setTimeout(300000);
  await fixtureCommand();
  const fixture = JSON.parse(
    await fs.readFile(
      path.join(product, ".runtime/lms-one-run/paper-fixture.json"),
      "utf8",
    ),
  );
  await fs.mkdir(evidence, { recursive: true });
  const headers = await login(page, fixture.director);
  await page.goto("/lms/results");
  const response = page.waitForResponse(
    (value) =>
      value.url().endsWith("/api/lms/results/documents") &&
      value.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Подготовить документы · 1", exact: true })
    .click();
  const prepared = await (await response).json();
  expect(prepared.errors).toEqual([]);
  expect(prepared.items).toHaveLength(1);
  const link = prepared.items[0];
  const approvals = await (await page.request.get("/api/approvals")).json();
  const approval = approvals.items.find(
    (value: { requestId: string }) => value.requestId === link.requestId,
  );
  await page.goto(`/approvals?proposal=${approval.id}`);
  const approved = page.waitForResponse((value) =>
    value.url().endsWith(`/api/approvals/${approval.id}/decision`),
  );
  await page
    .getByRole("button", { name: "Согласовать эту редакцию", exact: true })
    .click();
  expect((await approved).ok()).toBe(true);
  await fixtureCommand(true);
  const statePath = `/api/print-requests/${link.requestId}/signing`;
  const endpoint = `/api/print-requests/${link.requestId}/paper-signatures`;
  const before = await (await page.request.get(statePath)).json();
  expect(before.status).toBe("AWAITING_SIGNATURE");
  expect(before.documents[0].complete).toBe(false);
  expect(before.documents[0].paperSignature).toBeNull();
  expect(before.signatures).toEqual([]);
  await page.goto(`/requests/${link.requestId}`);
  await expect(
    page.getByRole("button", { name: "Реестр XLSX", exact: true }),
  ).toBeDisabled();
  await expect(
    page
      .locator("summary")
      .filter({ hasText: "Ссылка и QR для проверки записи" }),
  ).toHaveCount(0);
  const unsignedPublication = await page.request.post(
    "/api/verification-links",
    {
      headers,
      data: {
        documentId: before.documents[0].documentId,
        publicationConfirmed: true,
      },
    },
  );
  expect(unsignedPublication.status()).toBe(409);
  expect((await unsignedPublication.json()).code).toBe("ISSUANCE_NOT_COMPLETE");
  const signedAt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Qyzylorda",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const body = {
    documentIds: [before.documents[0].documentId],
    signedAt,
    signerNames: ["Синтетический подписант"],
    allRequiredSignaturesPresent: true,
    reason: "Синтетическая приёмочная фиксация бумажного оригинала",
  };
  const future = await page.request.post(endpoint, {
    headers,
    data: { ...body, signedAt: "2099-12-31" },
  });
  expect(future.status()).toBe(422);
  const unconfirmed = await page.request.post(endpoint, {
    headers,
    data: { ...body, allRequiredSignaturesPresent: false },
  });
  expect(unconfirmed.ok()).toBe(false);
  const employerContext = await browser.newContext({
    baseURL: process.env.DEMO_ORIGIN,
  });
  const employer = await employerContext.newPage();
  const employerHeaders = await login(employer, fixture.employer);
  const denied = await employer.request.post(endpoint, {
    headers: employerHeaders,
    data: body,
  });
  expect(denied.status()).toBe(403);
  await employerContext.close();
  await page.goto("/lms/results");
  await page
    .getByRole("button", { name: fixture.fullName, exact: true })
    .click();
  await page
    .getByText("Подписи на бумажном оригинале", { exact: true })
    .click();
  await page.getByLabel("Дата подписания", { exact: true }).fill(signedAt);
  await page
    .getByLabel("ФИО подписавших, по одному в строке", { exact: true })
    .fill(body.signerNames.join("\n"));
  await page
    .getByLabel("Основание проверки оригинала", { exact: true })
    .fill(body.reason);
  await page
    .getByLabel("Проверены все обязательные подписи на бумажном оригинале", {
      exact: true,
    })
    .check();
  await page.screenshot({
    path: path.join(evidence, "01-explicit-paper-facts.png"),
    fullPage: true,
  });
  const recorded = page.waitForResponse(
    (value) =>
      value.url().endsWith(endpoint.slice(4)) &&
      value.request().method() === "POST",
  );
  await page
    .getByRole("button", {
      name: "Зафиксировать бумажные подписи",
      exact: true,
    })
    .click();
  expect((await recorded).ok()).toBe(true);
  await expect(
    page.getByRole("button", {
      name: "Зафиксировать бумажные подписи",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.getByText("Ожидает подписи", { exact: true })).toHaveCount(
    0,
  );
  const after = await (await page.request.get(statePath)).json();
  expect(after.status).toBe("ISSUED");
  expect(after.documents[0].complete).toBe(true);
  expect(after.documents[0].paperSignature.category).toBe("OPERATOR_ATTESTED");
  expect(after.documents[0].paperSignature.signedAt).toBe(signedAt);
  expect(after.documents[0].paperSignature.recordedBy).toBeTruthy();
  expect(after.documents[0].documentSha256).toBe(
    before.documents[0].documentSha256,
  );
  expect(after.signatures).toEqual([]);
  const issued = await (
    await page.request.get(`/api/print-requests/${link.requestId}`)
  ).json();
  expect(issued.documents).toHaveLength(1);
  await page.goto(`/requests/${link.requestId}`);
  const registryDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Реестр XLSX", exact: true }).click();
  const registryPath = path.join(evidence, "paper-registry.xlsx");
  await (await registryDownload).saveAs(registryPath);
  expect((await fs.readFile(registryPath)).subarray(0, 2).toString()).toBe(
    "PK",
  );
  const registryRead = await promisify(execFile)(
    process.env.DEMO_PYTHON!,
    [
      "-c",
      "import sys,json,openpyxl; w=openpyxl.load_workbook(sys.argv[1],read_only=True); print(json.dumps([list(r) for s in w for r in s.iter_rows(values_only=True)],ensure_ascii=False,default=str))",
      registryPath,
    ],
    {
      windowsHide: true,
      timeout: 30000,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    },
  );
  expect(registryRead.stdout).toContain(issued.documents[0].number);
  await page
    .locator("summary")
    .filter({ hasText: "Ссылка и QR для проверки записи" })
    .click();
  await page
    .getByRole("combobox", { name: "Выданный документ", exact: true })
    .selectOption(issued.documents[0].id);
  await page
    .getByRole("checkbox", {
      name: "Разрешаю публичную проверку выбранной записи эмитента",
      exact: true,
    })
    .check();
  const publication = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/verification-links") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Создать ссылку и QR", exact: true })
    .click();
  const verification = await (await publication).json();
  await expect(
    page.getByRole("img", {
      name: "QR для проверки записи эмитента",
      exact: true,
    }),
  ).toBeVisible();
  const popup = page.waitForEvent("popup");
  await page
    .getByRole("link", { name: "Открыть публичную проверку", exact: true })
    .click();
  const publicPage = await popup;
  await expect(
    publicPage.getByText("Бумажный оригинал", { exact: true }),
  ).toBeVisible();
  await expect(
    publicPage.getByText(issued.documents[0].number, { exact: true }),
  ).toBeVisible();
  await expect(
    publicPage.getByText(fixture.fullName, { exact: true }),
  ).toHaveCount(0);
  const publicRecord = await (
    await publicPage.request.get(`/api/verification/${verification.token}`)
  ).json();
  expect(publicRecord.learningDocument.legalForm).toBe("PAPER_ORIGINAL");
  for (const privateValue of [
    fixture.fullName,
    fixture.learner,
    fixture.director,
    "storageKey",
    "signerIin",
    "password",
  ])
    expect(JSON.stringify(publicRecord)).not.toContain(privateValue);
  await publicPage.screenshot({
    path: path.join(evidence, "03-paper-public-minimal-record.png"),
    fullPage: true,
  });
  await publicPage.close();
  const repeated = await page.request.post(endpoint, { headers, data: body });
  expect(repeated.ok()).toBe(true);
  expect((await repeated.json()).items[0].duplicate).toBe(true);
  const changed = await page.request.post(endpoint, {
    headers,
    data: { ...body, reason: "Изменённое основание" },
  });
  expect(changed.status()).toBe(409);
  await page.screenshot({
    path: path.join(evidence, "02-recorded-paper-signature.png"),
    fullPage: true,
  });
  // Isolated synthetic corruption is constructed only after the real positive
  // workflow completed. Existing immutable documents and files are never edited.
  await fixtureCommand(false, true);
  const attacked = JSON.parse(
    await fs.readFile(
      path.join(product, ".runtime/lms-one-run/paper-fixture.json"),
      "utf8",
    ),
  );
  const wrongRow = await page.request.post(endpoint, {
    headers,
    data: {
      ...body,
      documentIds: [attacked.negativeBindingDocuments.wrongRow],
    },
  });
  expect(wrongRow.status()).toBe(409);
  expect((await wrongRow.json()).code).toBe("RESULT_INELIGIBLE");
  const wrongAssignment = await page.request.post(endpoint, {
    headers,
    data: {
      ...body,
      documentIds: [attacked.negativeBindingDocuments.wrongAssignment],
    },
  });
  expect(wrongAssignment.status()).toBe(409);
  expect((await wrongAssignment.json()).code).toBe("PAPER_ORIGINAL_REQUIRED");
  await fs.writeFile(
    path.join(evidence, "acceptance.json"),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        synthetic: true,
        physicalPrintPerformed: false,
        beforeStatus: before.status,
        afterStatus: after.status,
        actorRecorded: true,
        dateRecorded: true,
        category: after.documents[0].paperSignature.category,
        electronicSignatures: after.signatures.length,
        unsignedPublicationDenied: unsignedPublication.status(),
        documentHashUnchanged: true,
        actualRegistryDownloaded: true,
        registryContainsIssuedNumber: true,
        publicRecord,
        paperPublicLabel: true,
        publicRecordContainsFullName: false,
        actualQrCreated: true,
        futureDateDenied: future.status(),
        unconfirmedDenied: unconfirmed.status(),
        employerDenied: denied.status(),
        immutableChangedReplayDenied: changed.status(),
        exactReplayIdempotent: true,
        wrongRecipientBindingDenied: wrongRow.status(),
        unknownCanonicalAssignmentDenied: wrongAssignment.status(),
        adversarialFixture:
          "Copies reference actual original PDF bytes in this isolated synthetic tenant; existing immutable rows/files were not changed or removed. Added after successful original workflow completion.",
      },
      null,
      2,
    ),
  );
});

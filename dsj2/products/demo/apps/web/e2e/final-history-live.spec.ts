import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { approveFinalFixture, openFinalPanel } from "./final-approval-fixture";
import { unsignedPublicState } from "./final-unsigned-public-qa";
test.use({ trace: "off" });

const product = path.resolve(__dirname, "../../..");
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    path.join(product, "docs/evidence/final-completion/history"),
);
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function fixture(mode: string, id?: string) {
  const output = execFileSync(
    process.execPath,
    [
      path.join(product, "node_modules/tsx/dist/cli.mjs"),
      "--tsconfig",
      path.join(product, "tsconfig.base.json"),
      path.join(product, "scripts/verification/final-history-fixture.ts"),
      mode,
      ...(id ? [id] : []),
    ],
    {
      cwd: product,
      env: process.env,
      windowsHide: true,
      timeout: 270000,
      encoding: "utf8",
    },
  );
  return JSON.parse(output.trim().split(/\r?\n/).at(-1)!);
}
test.beforeAll(() => {
  fixture("provision");
});
test.beforeEach(async ({ context }) => {
  await context.routeWebSocket("**/_next/webpack-hmr", (socket) =>
    socket.close(),
  );
});

test("real history UI preserves original files across search, damaged copy, reconstruction, new event and correction", async ({
  page,
  browser,
}) => {
  test.setTimeout(720000);
  page.setDefaultNavigationTimeout(30000);
  await fs.mkdir(evidence, { recursive: true });
  const started = Date.now();
  const auth = JSON.parse(
    await fs.readFile(
      path.join(product, ".runtime/final-history-ui-auth.json"),
      "utf8",
    ),
  );
  const steps: Record<string, unknown>[] = [];
  async function record(action: string, proof: Record<string, unknown>) {
    steps.push({ action, elapsedMs: Date.now() - started, ...proof });
    await fs.writeFile(
      path.join(evidence, "history-checkpoint.json"),
      JSON.stringify(
        { status: "RUNNING", tenantId: auth.tenantId, steps },
        null,
        2,
      ),
    );
  }
  async function get(endpoint: string) {
    const response = await page.request.get(`/api${endpoint}`);
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }
  async function savedDownload(artifactId: string, fileName: string) {
    const event = page.waitForEvent("download");
    await page
      .locator(`.artifact-list a[href="/api/artifacts/${artifactId}"]`)
      .click();
    const file = path.join(evidence, fileName);
    await (await event).saveAs(file);
    return sha(await fs.readFile(file));
  }
  async function issue() {
    const id = /requests\/([^/]+)/.exec(page.url())![1];
    await page
      .getByRole("button", { name: "Проверить данные", exact: true })
      .click();
    await expect(
      page.getByText("Данные прошли проверку", { exact: true }),
    ).toBeVisible();
    await approveFinalFixture(browser, page, auth, id);
    await page.reload();
    const pending = page.waitForResponse(
      (r) => r.url().endsWith("/finalize") && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Сформировать документы", exact: true })
      .click();
    const response = await pending;
    expect(response.ok(), await response.text()).toBe(true);
    const drain = fixture("drain", id);
    await record("real-worker-drain", drain);
    await page.reload();
    await expect(page.locator(".files-panel")).toContainText("Готово 6 из 6", {
      timeout: 60000,
    });
    return get(`/print-requests/${id}`);
  }
  await page.goto("/login");
  await page.getByLabel("Электронная почта", { exact: true }).fill(auth.email);
  await page.getByLabel("Пароль", { exact: true }).fill(auth.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
  await page.goto("/requests");
  await expect(
    page.getByRole("heading", { name: "Заявки на печать" }),
  ).toBeVisible();
  await page.goto(`/requests/${auth.originalId}`);
  const original = await issue();
  const pdf = original.artifacts.find(
    (a: { format: string }) => a.format === "PDF",
  );
  const originalSnapshot = original.issuances[0].snapshot;
  const originalNumber = original.documents[0].number;
  expect(await savedDownload(pdf.id, "original.pdf")).toBe(pdf.sha256);
  const baseline = fixture("state");
  expect(original.documents.map((document: { templateId: string }) => document.templateId).sort()).toEqual(["pb-card", "pb-protocol"]);
  expect(baseline.reservations).toBe(2);
  await record("original-issued-through-ui", {
    requestId: original.id,
    number: originalNumber,
    sha256: pdf.sha256,
    baseline,
  });

  let injected = false;
  let recoveredReads = 0;
  await page.route(`**/api/jobs?requestId=${original.id}`, async (route) => {
    if (!injected) {
      injected = true;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        headers: { "retry-after": "3" },
        body: JSON.stringify({
          message: "Synthetic one-time files polling interruption",
        }),
      });
    } else {
      recoveredReads++;
      await route.continue();
    }
  });
  await page
    .locator(".files-panel")
    .getByRole("button", { name: "Обновить", exact: true })
    .click();
  await expect(page.locator(".files-panel")).toContainText(
    "Synthetic one-time files polling interruption",
  );
  await expect(page.locator(".files-panel")).toContainText("Готово 6 из 6", {
    timeout: 15000,
  });
  await expect(page.locator(".files-panel")).not.toContainText(
    "Synthetic one-time files polling interruption",
  );
  expect(recoveredReads).toBeGreaterThan(0);
  expect(fixture("state")).toEqual(baseline);
  await page.unroute(`**/api/jobs?requestId=${original.id}`);
  await record("one-503-then-real-http-recovers-automatically", {
    injected,
    recoveredReads,
    noReissue: true,
  });

  // Generated originals await a real NCA signature. They remain in the
  // working request list; the official signed archive correctly excludes
  // them. Number search still opens the saved bytes without issuing again.
  await page.goto("/requests");
  await page
    .getByLabel("Поиск по заявкам", { exact: true })
    .fill(originalNumber);
  await expect(page.locator(".request-table tbody tr")).toHaveCount(1);
  await page.locator(`.row-title[href="/requests/${original.id}"]`).click();
  expect(await savedDownload(pdf.id, "search-redownload.pdf")).toBe(pdf.sha256);
  expect(fixture("state")).toEqual(baseline);
  await record("number-search-opens-existing-file", {
    sha256: pdf.sha256,
    requestsCreated: 0,
    numbersAllocated: 0,
  });

  await page.goto(`/requests/${auth.duplicateId}`);
  await page
    .getByRole("button", { name: "Проверить данные", exact: true })
    .click();
  const oldLink = page.getByRole("link", {
    name: `Открыть прежний документ № ${originalNumber}`,
    exact: true,
  });
  await expect(oldLink).toBeVisible();
  await oldLink.click();
  await expect(page).toHaveURL(new RegExp(`/requests/${original.id}$`));
  expect(await savedDownload(pdf.id, "duplicate-warning-redownload.pdf")).toBe(
    pdf.sha256,
  );
  expect(fixture("state")).toEqual(baseline);
  await record("duplicate-warning-links-to-original", {
    warningScope: "stable recipient + program + actual basis date",
    sha256: pdf.sha256,
    externalManualActions: 0,
  });

  await openFinalPanel(page, "review");
  await page
    .getByText("Зафиксировать передачу или повторную печать", { exact: true })
    .click();
  await page.getByLabel(pdf.fileName, { exact: true }).check();
  await page
    .getByLabel("Получатель комплекта", { exact: true })
    .fill("Синтетический получатель истории");
  await page.getByLabel("Дата передачи", { exact: true }).fill("2026-09-24");
  await page
    .getByRole("combobox", { name: "Способ", exact: true })
    .selectOption("PAPER");
  await page
    .getByRole("combobox", { name: "Действие", exact: true })
    .selectOption("REPRINT_DAMAGED");
  await expect(
    page.getByRole("button", { name: "Зафиксировать факт", exact: true }),
  ).toBeDisabled();
  const damagedReason =
    "Синтетический бумажный экземпляр испорчен; сохранённый файл исправен";
  await page
    .getByLabel("Причина перепечатки", { exact: true })
    .fill(damagedReason);
  await page
    .getByRole("button", { name: "Зафиксировать факт", exact: true })
    .click();
  await expect(
    page.getByText("Факт передачи сохранён с выбранным составом файлов.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await openFinalPanel(page, "review");
  await page
    .getByText("История передачи и перепечатки (1)", { exact: true })
    .click();
  await expect(
    page.getByText(`Причина: ${damagedReason}`, { exact: true }),
  ).toBeVisible();
  const transfers = await get(`/print-requests/${original.id}/transfers`);
  expect(transfers.items).toHaveLength(1);
  expect(transfers.items[0].action).toBe("DAMAGED_COPY_REPRINT");
  expect(
    transfers.items[0].metadata.files.map((a: { id: string }) => a.id),
  ).toEqual([pdf.id]);
  expect(fixture("state")).toEqual(baseline);
  await page.screenshot({
    path: path.join(evidence, "damaged-copy-history.png"),
    fullPage: true,
  });
  await record("damaged-copy-history-survives-reload", {
    selectedArtifactId: pdf.id,
    noRenderJobs: true,
    originalSha256: pdf.sha256,
  });

  fixture("lose", pdf.id);
  try {
    const unavailable = await page.request.get(`/api/artifacts/${pdf.id}`);
    expect(unavailable.status()).toBe(503);
    await page.reload();
    const originalArticle = page
      .locator(".artifact-list article")
      .filter({ has: page.locator(`a[href="/api/artifacts/${pdf.id}"]`) });
    await expect(originalArticle).toContainText("Оригинал недоступен");
    await originalArticle
      .getByRole("button", { name: "Восстановить файл", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Создать восстановленную копию",
        exact: true,
      }),
    ).toBeDisabled();
    await page
      .getByLabel("Причина восстановления", { exact: true })
      .fill(
        "Синтетическая проверка утраты файла: сохранить исходную запись и SHA",
      );
    await page
      .getByRole("button", {
        name: "Создать восстановленную копию",
        exact: true,
      })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    fixture("drain", original.id);
    await page.reload();
    const reconstructed = await get(`/print-requests/${original.id}`);
    const replacement = reconstructed.artifacts.find(
      (a: { format: string; provenance: string }) =>
        a.format === "PDF" && a.provenance === "RECONSTRUCTED",
    );
    expect(replacement).toBeTruthy();
    expect(replacement.id).not.toBe(pdf.id);
    expect(
      reconstructed.artifacts.find((a: { id: string }) => a.id === pdf.id)
        .sha256,
    ).toBe(pdf.sha256);
    expect(reconstructed.documents[0].number).toBe(originalNumber);
    expect(reconstructed.issuances[0].snapshot).toEqual(originalSnapshot);
    expect(fixture("state").reservations).toBe(baseline.reservations);
    expect(await savedDownload(replacement.id, "reconstructed.pdf")).toBe(
      replacement.sha256,
    );
    await expect(page.locator(".artifact-list")).toContainText(
      "Восстановленная копия",
    );
    await page.screenshot({
      path: path.join(evidence, "lost-file-reconstruction.png"),
      fullPage: true,
    });
    await record("lost-file-reconstructed-as-separate-artifact", {
      replacementArtifactId: replacement.id,
      replacementSha256: replacement.sha256,
      originalSha256: pdf.sha256,
      numberUnchanged: true,
    });
  } finally {
    fixture("restore", pdf.id);
  }
  const restoredOriginal = await page.request.get(`/api/artifacts/${pdf.id}`);
  expect(sha(await restoredOriginal.body())).toBe(pdf.sha256);

  await page.goto(`/requests/${auth.duplicateId}`);
  await page
    .locator(".person-document-list li")
    .first()
    .getByRole("button", { name: "Параметры", exact: true })
    .click();
  const detail = page.getByRole("dialog", {
    name: "Параметры документа",
    exact: true,
  });
  // LIVE kits contain both the credential and its mandatory companion. Edit
  // the primary credential; the shared linked-field handler updates its kit.
  const fields = detail.locator(".assignment-list > details").first();
  await fields.locator(".document-date-details > summary").click();
  for (const [label, value] of [
    ["Дата документа", "2026-10-01"],
    ["Начало обучения", "2026-09-30"],
    ["Окончание обучения", "2026-10-01"],
    ["Дата протокола", "2026-10-01"],
  ])
    await fields.getByLabel(label, { exact: true }).fill(value);
  await fields.getByRole("tab", { name: "Настройки", exact: true }).click();
  await fields
    .getByLabel("Внешний номер основания", { exact: true })
    .fill("SYNTHETIC-NEW-ACTUAL-EVENT-2026-10");
  await detail
    .getByRole("button", { name: "Готово", exact: true })
    .click();
  await expect(page.locator(".save-indicator")).toContainText(/сохранена/i);
  await page
    .getByRole("button", { name: "Проверить данные", exact: true })
    .click();
  await expect(
    page.getByText("Данные прошли проверку", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Открыть прежний документ/ }),
  ).toHaveCount(0);
  const next = await issue();
  expect(next.documents[0].number).not.toBe(originalNumber);
  const nextPdf = next.artifacts.find(
    (a: { format: string }) => a.format === "PDF",
  );
  expect(await savedDownload(nextPdf.id, "new-actual-event.pdf")).toBe(
    nextPdf.sha256,
  );
  await record("new-actual-event-issued-without-false-duplicate", {
    requestId: next.id,
    number: next.documents[0].number,
    actualBasisDate: "2026-10-01",
    sha256: nextPdf.sha256,
  });

  await page.goto(`/requests/${original.id}`);
  await expect(page.getByText("Ссылка и QR для проверки записи", { exact: true })).toHaveCount(0);
  const publicationSession = await (await page.request.get("/api/auth/session")).json();
  const publicationResponse = await page.request.post("/api/verification-links", {
    headers: { origin: process.env.DEMO_ORIGIN!, "x-csrf-token": publicationSession.csrfToken },
    data: { documentId: original.documents[0].id, publicationConfirmed: true },
  });
  expect(publicationResponse.status()).toBe(409);
  expect((await publicationResponse.json()).code).toBe("ISSUANCE_NOT_COMPLETE");
  await expect(page.locator(".files-panel")).toContainText("Комплект ожидает электронных подписей");
  await expect(page.getByRole("link", { name: "Открыть публичную проверку", exact: true })).toHaveCount(0);
  expect((await get(`/print-requests/${original.id}/signing`)).status).toBe("AWAITING_SIGNATURE");
  const unsignedState = unsignedPublicState(auth.tenantId, original.id);
  await record("unsigned-public-record-refused-before-any-publication", { status: 409, code: "ISSUANCE_NOT_COMPLETE", signingStatus: "AWAITING_SIGNATURE", publicUiControlHidden: true, createdPublicLink: false, actualReadOnlyState: unsignedState });
  await page
    .getByRole("button", { name: "Создать исправление", exact: true })
    .click();
  const correctionDialog = page.getByRole("dialog");
  await expect(
    correctionDialog.getByRole("button", {
      name: "Создать исправление",
      exact: true,
    }),
  ).toBeDisabled();
  const correctionReason =
    "Синтетическое исправление должности по согласованному источнику";
  await correctionDialog
    .getByLabel("Причина", { exact: true })
    .fill(correctionReason);
  await correctionDialog
    .getByRole("button", { name: "Создать исправление", exact: true })
    .click();
  await expect(page).toHaveURL(/\/requests\/[^/]+\/edit$/);
  const personal = page.locator(".person-editor");
  await personal.getByRole("button", { name: "Изменить ФИО и должность", exact: true }).click();
  await personal
    .getByLabel("Должность", { exact: true })
    .fill("Старший инженер");
  await personal
    .getByRole("button", { name: "Готово", exact: true })
    .click();
  await expect(page.locator(".save-indicator")).toContainText(/сохранена/i);
  const corrected = await issue();
  expect(corrected.issuances[0].correctsIssuanceId).toBe(
    original.issuances[0].id,
  );
  expect(corrected.issuances[0].correctsRequestId).toBe(original.id);
  expect(corrected.issuances[0].correctionReason).toBe(correctionReason);
  expect(corrected.documents[0].number).not.toBe(originalNumber);
  expect(corrected.items[0].positionRu).toBe("Старший инженер");
  const correctedPdf = corrected.artifacts.find(
    (a: { format: string }) => a.format === "PDF",
  );
  expect(await savedDownload(correctedPdf.id, "corrected.pdf")).toBe(
    correctedPdf.sha256,
  );
  expect(correctedPdf.sha256).not.toBe(pdf.sha256);
  const correctedText = execFileSync(
    process.env.DEMO_PYTHON!,
    [
      "-c",
      "from pypdf import PdfReader; import sys; sys.stdout.buffer.write('\\n'.join(p.extract_text() or '' for p in PdfReader(sys.argv[1]).pages).encode('utf-8'))",
      path.join(evidence, "corrected.pdf"),
    ],
    { encoding: "utf8", windowsHide: true, timeout: 15000 },
  );
  expect(correctedText).toContain("Старший инженер");
  await page.locator(".issuance-details summary").click();
  await expect(
    page.getByText(`Причина: ${correctionReason}`, { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Открыть исходный выпуск", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/requests/${original.id}(?:/edit)?$`));
  await expect(page.locator(".issuance-details")).toContainText(
    "Ожидает подписи",
  );
  // REPLACED and its reverse link are legal completion effects, emitted only
  // after genuine mandatory signatures. The unsigned correction must preserve
  // the original state while keeping its explicit new-to-source relation.
  await expect(page.locator(".issuance-details")).not.toContainText("Выпуск заменён");
  await expect(
    page.getByRole("link", {
      name: "Открыть исправленный выпуск",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(await savedDownload(pdf.id, "original-after-correction.pdf")).toBe(
    pdf.sha256,
  );
  const reread = await get(`/print-requests/${original.id}`);
  expect(reread.issuances[0].snapshot).toEqual(originalSnapshot);
  expect(reread.documents[0].number).toBe(originalNumber);
  expect(Array.isArray(reread.issuanceEvents)).toBe(true);
  expect(reread.issuanceEvents.some((event: { kind: string; issuanceId: string }) => event.issuanceId === original.issuances[0].id && event.kind === "REPLACED")).toBe(false);
  const originalUnsigned = unsignedPublicState(auth.tenantId, original.id);
  expect((await get(`/print-requests/${corrected.id}/signing`)).status).toBe("AWAITING_SIGNATURE");
  const correctedUnsigned = unsignedPublicState(auth.tenantId, corrected.id);
  await page.screenshot({
    path: path.join(evidence, "linked-correction-history.png"),
    fullPage: true,
  });
  await record("unsigned-correction-source-link-and-immutable-original-with-no-premature-replacement", {
    originalRequestId: original.id,
    correctionRequestId: corrected.id,
    originalNumber,
    newNumber: corrected.documents[0].number,
    originalSha256: pdf.sha256,
    correctedSha256: correctedPdf.sha256,
    originalSnapshotUnchanged: true,
    correctionFieldsReentered: 1,
    reasonRequired: true,
    publicReplacedRecordVerified: false,
    originalUnsigned,
    correctedUnsigned,
    signedReverseReplacementLinkVerified: false,
    reason: "The real product requires mandatory signatures before publication; no genuine local NCA configuration has been supplied",
  });
  await fs.writeFile(
    path.join(evidence, "history-checkpoint.json"),
    JSON.stringify({ status: "PASS", tenantId: auth.tenantId, steps }, null, 2),
  );
  await fs.writeFile(
    path.join(evidence, "history-coverage.json"),
    JSON.stringify(
      {
        status: "PASS",
        syntheticDataOnly: true,
        tenantId: auth.tenantId,
        browser: browser.version(),
        wallMs: Date.now() - started,
        legacyAcceptanceReferences: ["AT064", "AT065", "AT067", "AT177", "AT178"],
        officialSignedPublicSubscope: {
          status: "BLOCKED_MISSING_GENUINE_NCA_CONFIGURATION",
          originalPositivePublicReplacementClaim: false,
          actualNegativeGuard: "409 ISSUANCE_NOT_COMPLETE; no publication/link",
        },
        scenarios: [
          {
            id: "V09",
            status: "PASS",
            execution_layer:
              "REAL_CHROME_HISTORY_SEARCH_CORRECTION_AND_ORIGINAL_FILES",
            scope:
              "Actual working-request number search and duplicate warning open the saved original. Authorized correction requires a reason, copies existing details and changes one position field. The correction UI opens its actual source; original snapshot/number/files remain immutable and neither unsigned workflow creates a premature REPLACED event or reverse replacement link. Unsigned public publication rejects409; positive signed reverse/public replacement remains unverified.",
            evidence: [
              "history-checkpoint.json",
              "linked-correction-history.png",
              "original-after-correction.pdf",
              "corrected.pdf",
            ],
            measurements: {
              automationWallMs: Date.now() - started,
              humanActiveMs: null,
              identityFieldsReentered: 0,
              correctionFieldsEdited: 1,
              externalManualActions: 0,
            },
            remaining: "Positive official signed public replacement requires genuine NCA configuration; no signature/provider/workflow bypass",
          },
        ],
        steps,
        limitation:
          "Synthetic fixtures prepared by service; user operations, downloads and reloads use actual browser/API. One 503 is deliberately injected, followed by real HTTP reads. One own fixture file is temporarily held and restored in finally. Renderer claims only this tenant. No physical printing, real-client timing comparison or production cutover is claimed.",
      },
      null,
      2,
    ),
  );
});

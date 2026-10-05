import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { loginIsolated } from "./operator-full-fix-session";
import { openFinalPanel } from "./final-approval-fixture";
import { openLegacyPersonal } from "./operator-legacy-lifecycle-fixture";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import {
  courseResultText,
  DEFAULT_POSITIVE_OUTCOME_SOURCE,
} from "@demo/contracts";

const product = path.resolve(__dirname, "../../..");
const sourceDirectory = path.resolve(
  process.env.DEMO_E2E_REPEAT_SOURCE ||
    path.join(
      product,
      "docs/evidence/operator-flow-full-fix-20261003/preparation/common-history-browser",
    ),
);
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    path.join(product, "docs/evidence/final-completion/repeat-basis"),
);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
async function get(page: Page, endpoint: string) {
  const response = await page.request.get(`/api${endpoint}`);
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
test.use({ trace: "off" });
test("V02 actual history repeat uses a current employer and cannot finalize an unknown new result", async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  await fs.mkdir(evidence, { recursive: true });
  const source = JSON.parse(
    await fs.readFile(
      path.join(sourceDirectory, "common-history-result.json"),
      "utf8",
    ),
  );
  expect(source.status).toBe("PASS");
  if (process.env.DEMO_E2E_FULL_CHECKPOINTS === "1") {
    expect(
      process.env.DEMO_E2E_FULL_RUN_ID,
      "Full-suite source identity is required",
    ).toBeTruthy();
    expect(
      source.suiteRunId,
      "Repeat basis must use this full run's freshly produced history",
    ).toBe(process.env.DEMO_E2E_FULL_RUN_ID);
  }
  const companyIds = source.companies.map(
    (company: { id: string }) => company.id,
  ) as string[];
  expect(companyIds).toHaveLength(2);
  for (const id of companyIds) expect(id).toMatch(/^[a-f0-9-]{36}$/);
  const started = Date.now();
  const steps: Record<string, unknown>[] = [];
  async function record(action: string, proof: Record<string, unknown>) {
    steps.push({ action, elapsedMs: Date.now() - started, ...proof });
    await fs.writeFile(
      path.join(evidence, "checkpoint.json"),
      JSON.stringify(
        { status: "RUNNING", sourceRequestId: source.requestId, steps },
        null,
        2,
      ),
    );
  }
  await loginIsolated(page);
  const original = await get(page, `/print-requests/${source.requestId}`);
  const current = await get(page, `/recipients/${source.personId}`);
  const employerB = await get(page, `/customers/${companyIds[1]}`);
  expect(current.employment).toHaveLength(2);
  expect(current.data.employerId).toBe(companyIds[1]);
  const historicalRow = original.items.find(
    (p: { recipientId: string }) => p.recipientId === source.personId,
  );
  expect(historicalRow.employerId).toBe(companyIds[0]);
  const oldSnapshot = original.issuances[0].snapshot;
  const oldNumbers = original.documents.map(
    (d: { number: string }) => d.number,
  );
  const document = original.documents.find(
    (d: { rowId: string }) => d.rowId === historicalRow.id,
  );
  const artifact = original.artifacts.find(
    (a: { documentId: string; format: string }) =>
      a.documentId === document.id && a.format === "PDF",
  );
  expect(artifact).toBeTruthy();
  await page.goto(`/requests/${source.requestId}`);
  await expect(page.getByLabel("ФИО, строка 1", { exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .locator(`.artifact-list a[href="/api/artifacts/${artifact.id}"]`)
    .click();
  await (await download).saveAs(path.join(evidence, "historical-original.pdf"));
  expect(
    sha(await fs.readFile(path.join(evidence, "historical-original.pdf"))),
  ).toBe(artifact.sha256);
  await openFinalPanel(page, "operations");
  await page
    .getByText(
      `Повторное обращение по получателю «${historicalRow.fullNameRu}»`,
      { exact: true },
    )
    .click();
  await page
    .getByRole("combobox", { name: "Исторический документ", exact: true })
    .selectOption(historicalRow.assignments[0].id);
  await page
    .getByLabel("Источник правила срока", { exact: true })
    .fill(
      "V02 — явное новое обращение от работодателя B; срок следующей проверки не предполагается",
    );
  const policyVersion = `V02-current-employer-${Date.now()}`;
  await page
    .getByLabel("Версия / дата проверки правила", { exact: true })
    .fill(policyVersion);
  await page
    .getByLabel("Подтверждённая дата основания", { exact: true })
    .fill("2026-09-25");
  const needPending = page.waitForResponse(
    (r) => r.url().endsWith("/renewals") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", {
      name: "Добавить в повторные обращения",
      exact: true,
    })
    .click();
  const needResponse = await needPending;
  const needResult = await needResponse.json();
  await record("historical-ui-create-unconfirmed-need", {
    status: needResponse.status(),
    response: needResult,
  });
  expect(needResponse.ok(), JSON.stringify(needResult)).toBe(true);
  const needId = needResult.id;
  await page.goto("/workbench");
  await page
    .getByRole("tab", { name: "Повторные обращения", exact: true })
    .click();
  const renewalRow = page.getByRole("row").filter({ hasText: policyVersion });
  await expect(renewalRow).toContainText("Нужно проверить актуальность");
  await expect(
    renewalRow.getByRole("button", {
      name: "Создать повторную заявку",
      exact: true,
    }),
  ).toHaveCount(0);
  await renewalRow
    .getByRole("button", { name: "Записать результат контакта", exact: true })
    .click();
  await page.getByLabel("Дата контакта", { exact: true }).fill("2026-09-25");
  await page
    .getByRole("combobox", { name: "Ответ заказчика", exact: true })
    .selectOption("CONFIRMED");
  await page
    .getByLabel("Подтверждённые сведения / причина", { exact: true })
    .fill(
      `Работодатель B ${employerB.nameRu} подтвердил новое обращение существующего сотрудника. Новый фактический результат ещё не получен.`,
    );
  await page
    .getByRole("button", { name: "Сохранить контакт", exact: true })
    .click();
  await expect(renewalRow).toContainText("Подтверждено");
  await renewalRow
    .getByRole("button", { name: "Создать повторную заявку", exact: true })
    .click();
  await expect(page).toHaveURL(/\/requests\/[a-f0-9-]{36}$/);
  const nextId = /requests\/([^/]+)/.exec(page.url())![1];
  const fresh = await get(page, `/print-requests/${nextId}`);
  expect(fresh.items).toHaveLength(1);
  expect(fresh.items[0].recipientId).toBe(source.personId);
  expect(fresh.items[0].fullNameRu).toBe(historicalRow.fullNameRu);
  expect(fresh.documents).toHaveLength(0);
  expect(fresh.issuances).toHaveLength(0);
  expect(fresh.artifacts).toHaveLength(0);
  for (const a of fresh.items[0].assignments) {
    for (const field of [
      "documentDate",
      "trainingStart",
      "trainingEnd",
      "protocolDate",
      "externalBasisNumber",
    ])
      expect(a[field] || "").toBe("");
    expect(a.eventId).toBeUndefined();
    expect(a.result).toBe(courseResultText(a.templateId, "PASSED"));
    expect(a.outcome?.status).toBe("PASSED");
    expect(a.outcome?.source).toBe(DEFAULT_POSITIVE_OUTCOME_SOURCE);
    expect(a.fieldOrigins?.outcome).toBe("AUTO");
  }
  await record("new-history-repeat-has-no-old-results-dates-numbers", {
    needId,
    newRequestId: nextId,
    recipientId: source.personId,
    sameIdentity: true,
    oldIssuerSnapshotUnchanged: true,
  });
  const personal = await openLegacyPersonal(page);
  await personal.locator(".employer-document-wording > summary").click();
  await page
    .getByText("Постоянная запись, работодатель и история", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Выбрать работодателя", exact: true })
    .click();
  await page
    .getByLabel("Поиск по справочнику", { exact: true })
    .fill(employerB.nameRu);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Выбрать", exact: true })
    .click();
  await page
    .getByLabel("Должность / профессия", { exact: true })
    .fill(current.data.positionRu);
  await page
    .getByLabel("Период работы / основание актуальности", { exact: true })
    .fill(current.data.employmentPeriod);
  // The repeat has new positive defaults. This scenario explicitly records
  // the outstanding result, then verifies that the exception survives reload.
  await personal.getByRole("tab", { name: /^Документы/ }).click();
  const form = personal.locator("details[data-assignment-id]").first();
  if (!(await form.evaluate((node) => (node as HTMLDetailsElement).open)))
    await form.locator(":scope > summary").click();
  await form
    .getByRole("tab", { name: "Обучение и результат", exact: true })
    .click();
  await form
    .getByLabel("Исход обучения", { exact: true })
    .selectOption("UNKNOWN");
  await form
    .getByLabel("Источник подтверждения результата", { exact: true })
    .fill(
      "Новый результат ожидается по подтверждённому обращению работодателя B",
    );
  await personal
    .getByRole("button", { name: "Вернуться к списку", exact: true })
    .click();
  await expect(page.locator(".save-indicator")).toContainText(/сохранена/i);
  await page.reload();
  const updated = await get(page, `/print-requests/${nextId}`);
  expect(updated.items[0].employerId).toBe(companyIds[1]);
  expect(updated.items[0].recipientId).toBe(source.personId);
  expect(
    updated.items[0].assignments.every(
      (assignment: { outcome: { status: string } }) =>
        assignment.outcome.status === "UNKNOWN",
    ),
  ).toBe(true);
  const validatePending = page.waitForResponse(
    (r) => r.url().endsWith("/validate") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Проверить данные", exact: true })
    .click();
  await expect(
    page.getByText("Исправьте данные перед оформлением", { exact: true }),
  ).toBeVisible();
  const validate = await validatePending;
  const validation = await validate.json();
  expect(validate.ok(), JSON.stringify(validation)).toBe(true);
  expect(JSON.stringify(validation)).toMatch(
    /RESULT_REQUIRED|RESULT_UNCONFIRMED|OUTCOME_UNCONFIRMED/,
  );
  await expect(
    page.getByRole("button", { name: "Сформировать документы", exact: true }),
  ).toHaveCount(0);
  const session = await get(page, "/auth/session");
  const finalized = await page.request.post(
    `/api/print-requests/${nextId}/finalize`,
    {
      headers: {
        origin: process.env.DEMO_ORIGIN!,
        "x-csrf-token": session.csrfToken,
        "Idempotency-Key": randomUUID(),
      },
      data: { expectedRevision: updated.revision },
    },
  );
  expect(finalized.status()).toBe(409);
  const refused = await finalized.json();
  expect(refused.code).toBe("DIRECTOR_APPROVAL_REQUIRED");
  await page.screenshot({
    path: path.join(evidence, "unknown-new-result-blocks-issuance.png"),
    fullPage: true,
  });
  await page.reload();
  const blocked = await get(page, `/print-requests/${nextId}`);
  expect(blocked.status).toBe("DRAFT");
  expect(blocked.documents).toHaveLength(0);
  expect(blocked.issuances).toHaveLength(0);
  expect(blocked.artifacts).toHaveLength(0);
  const oldAgain = await get(page, `/print-requests/${source.requestId}`);
  expect(oldAgain.issuances[0].snapshot).toEqual(oldSnapshot);
  expect(oldAgain.documents.map((d: { number: string }) => d.number)).toEqual(
    oldNumbers,
  );
  const originalBytes = await page.request.get(`/api/artifacts/${artifact.id}`);
  expect(originalBytes.ok()).toBe(true);
  expect(sha(await originalBytes.body())).toBe(artifact.sha256);
  const samePerson = await get(page, `/recipients/${source.personId}`);
  expect(samePerson.employment).toEqual(current.employment);
  await record(
    "current-employer-B-reload-validate-and-explicit-finalize-blocked",
    {
      currentEmployerId: companyIds[1],
      validation,
      finalizeStatus: finalized.status(),
      errorCode: refused.code,
      newIssuedDocuments: 0,
      newIssuances: 0,
      newArtifacts: 0,
      oldNumbersUnchanged: true,
      originalSnapshotUnchanged: true,
      originalSha256: artifact.sha256,
      employmentPeriodsUnchanged: true,
    },
  );
  await fs.writeFile(
    path.join(evidence, "summary.json"),
    JSON.stringify(
      {
        status: "PASS",
        scenario: "V02",
        criterion: "AT164",
        browser: browser.version(),
        sourceRequestId: source.requestId,
        newRequestId: nextId,
        needId,
        personId: source.personId,
        oldEmployerId: companyIds[0],
        currentEmployerId: companyIds[1],
        sourceEvidence: path.relative(product, sourceDirectory),
        originalFileSha256: artifact.sha256,
        steps,
        automatedWallMs: Date.now() - started,
        reenteredIdentityFields: 0,
        explicitlyUpdatedCurrentEmploymentFields: 3,
        externalManualActionsDuringJourney: 0,
        humanActiveMs: null,
        customerWaitingMs: null,
        limitation:
          "Reuses actual issued100-person synthetic history and stable identity with two employment periods. One history repeat is reviewed for employer B through real UI and explicitly marked as awaiting a result; actual UI does not offer generation and an independent HTTP finalize is rejected before any issuance. No new document is rendered or issued, and human timing/production acceptance is not claimed.",
      },
      null,
      2,
    ),
  );
});

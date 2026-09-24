import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const product = path.resolve(__dirname, "../../..");
const sourceDirectory = path.resolve(
  process.env.DEMO_E2E_REPEAT_SOURCE ||
    path.join(
      product,
      "docs/evidence/final-completion/operator/common-history-resume-v3",
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
  await page.goto("/login");
  await page
    .getByLabel("Электронная почта", { exact: true })
    .fill(process.env.DEMO_E2E_EMAIL!);
  await page
    .getByLabel("Пароль", { exact: true })
    .fill(process.env.DEMO_E2E_PASSWORD!);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Заявки на печать" }),
  ).toBeVisible();
  const original = await get(page, `/print-requests/${source.requestId}`);
  const current = await get(page, `/recipients/${source.personId}`);
  const employerB = await get(page, `/customers/${source.companies[1]}`);
  expect(current.employment).toHaveLength(2);
  expect(current.data.employerId).toBe(source.companies[1]);
  const historicalRow = original.items.find(
    (p: { recipientId: string }) => p.recipientId === source.personId,
  );
  expect(historicalRow.employerId).toBe(source.companies[0]);
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
  await expect(
    page.getByLabel("ФИО RU, строка 1", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Документы и даты получателя 1", exact: true })
    .click();
  const download = page.waitForEvent("download");
  await page
    .locator(`.artifact-list a[href="/api/artifacts/${artifact.id}"]`)
    .click();
  await (await download).saveAs(path.join(evidence, "historical-original.pdf"));
  expect(
    sha(await fs.readFile(path.join(evidence, "historical-original.pdf"))),
  ).toBe(artifact.sha256);
  await page
    .getByRole("button", { name: "Открыть действия", exact: true })
    .click();
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
      "result",
      "documentDate",
      "trainingStart",
      "trainingEnd",
      "protocolDate",
      "externalBasisNumber",
    ])
      expect(a[field] || "").toBe("");
    expect(a.eventId).toBeUndefined();
    expect(a.outcome?.status || "UNKNOWN").toBe("UNKNOWN");
  }
  await record("new-history-repeat-has-no-old-results-dates-numbers", {
    needId,
    newRequestId: nextId,
    recipientId: source.personId,
    sameIdentity: true,
    oldIssuerSnapshotUnchanged: true,
  });
  await page
    .getByRole("button", { name: "Документы и даты получателя 1", exact: true })
    .click();
  await page.getByRole("tab", { name: "Личные данные", exact: true }).click();
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
    .getByLabel("Должность · RU", { exact: true })
    .fill(current.data.positionRu);
  await page
    .getByLabel("Период работы / основание актуальности", { exact: true })
    .fill(current.data.employmentPeriod);
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.locator(".save-indicator")).toContainText("Сохранено");
  await page.reload();
  const updated = await get(page, `/print-requests/${nextId}`);
  expect(updated.items[0].employerId).toBe(source.companies[1]);
  expect(updated.items[0].recipientId).toBe(source.personId);
  const validatePending = page.waitForResponse(
    (r) => r.url().endsWith("/validate") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Проверить", exact: true }).click();
  await expect(
    page.getByText("Исправьте данные перед оформлением", { exact: true }),
  ).toBeVisible();
  const validate = await validatePending;
  const validation = await validate.json();
  expect(validate.ok(), JSON.stringify(validation)).toBe(true);
  expect(JSON.stringify(validation)).toMatch(
    /RESULT_REQUIRED|RESULT_UNCONFIRMED/,
  );
  await page
    .getByRole("button", { name: "Оформить комплект", exact: true })
    .click();
  const finalizePending = page.waitForResponse(
    (r) => r.url().endsWith("/finalize") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Оформить", exact: true }).click();
  const finalized = await finalizePending;
  expect(finalized.status()).toBe(422);
  const refused = await finalized.json();
  expect(refused.code).toBe("FINALIZE_VALIDATION");
  expect(JSON.stringify(refused)).toMatch(/RESULT_REQUIRED|RESULT_UNCONFIRMED/);
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
      currentEmployerId: source.companies[1],
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
        oldEmployerId: source.companies[0],
        currentEmployerId: source.companies[1],
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
          "Reuses actual issued100-person synthetic history and stable identity with two employment periods. One history repeat is reviewed for employer B through real UI; no fresh result is entered, actual UI finalize is rejected. No new document is rendered or issued, and human timing/production acceptance is not claimed.",
      },
      null,
      2,
    ),
  );
});

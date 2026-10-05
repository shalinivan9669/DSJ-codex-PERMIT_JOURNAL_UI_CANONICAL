import { expect, test, type Page, type Locator } from "@playwright/test";
import { draftSchema, mandatoryTemplates, resolveDraft, resolveRecipientText, type TrainingDirection } from "@demo/contracts";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { draftPayload, type Draft, type AppContext, type Customer } from "../lib/types";
import { draftReadiness } from "../lib/draft-readiness";
import { effectiveRecipientEmployer } from "../lib/recipient-employer";
import { loginIsolated as login } from "./operator-full-fix-session";

test.use({ trace: "off" });
const priorDomainEvidenceRoot = path.resolve(__dirname, "../../../docs/evidence/operator-flow-full-fix-20261003/domain");
const evidenceRoot = path.resolve(
  process.env.DEMO_E2E_EVIDENCE || path.resolve(__dirname, "../../../docs/evidence/browser"),
  "domain-acceptance",
);
const dates = { documentDate: "2026-10-03", trainingStart: "2026-10-01", trainingEnd: "2026-10-02", protocolDate: "2026-10-02" };
const originKeys = ["documentDate", "trainingStart", "trainingEnd", "protocolDate", "trainingSubject", "hours", "productionHours", "reason"] as const;
function input(count = 3, directions: TrainingDirection[] = ["BIOT", "PB"], individual = false) {
  return draftSchema.parse({
    title: `СИНТЕТИЧЕСКАЯ полная domain приёмка ${Date.now()}`,
    kind: "COMPANY", demoMode: true, schemaVersion: 2, commonFields: dates,
    events: directions.map((direction) => ({
      id: `accept-${direction}`, title: `Синтетическое обучение ${direction}`,
      protocolTemplateId: mandatoryTemplates(direction, "WORKER").at(-1),
      protocolMode: individual ? "INDIVIDUAL" : "GROUP", protocolModeSource: "MANUAL",
      commonFields: { ...dates, trainingSubject: `Общая синтетическая программа ${direction}`, hours: "10", productionHours: "16", reason: "Общая синтетическая причина", biotCategory: direction === "BIOT" ? "WORKER" : undefined, biotCheckType: direction === "BIOT" ? "PERIODIC" : undefined },
    })),
    items: Array.from({ length: count }, (_, index) => ({
      id: `accept-person-${index + 1}`, fullNameRu: `Синтетический Участник ${index + 1}`, employeeCategory: "WORKER", positionRu: "Инженер", workplaceRu: "Тест Альфа",
      assignments: directions.map((direction) => ({
        id: `accept-${direction}-credential-${index + 1}`, eventId: `accept-${direction}`,
        templateId: mandatoryTemplates(direction, "WORKER")[0], protocolMode: individual ? "INDIVIDUAL" : "GROUP",
        ...dates, trainingSubject: "", hours: "10", productionHours: "16",
        fieldOrigins: Object.fromEntries(originKeys.map((key) => [key, "INHERITED"])),
        result: "Сдал — известный синтетический результат",
        outcome: { status: "PASSED", source: "СИНТЕТИЧЕСКАЯ известная ведомость полной domain приёмки; не реальное обучение" },
      })),
    })),
  });
}
async function create(page: Page, headers: Record<string, string>, value: unknown, bindCompany = true) {
  const submitted = draftSchema.parse(value);
  // Event ownership spans requests. Each new fixture uses fresh event IDs;
  // references within that fixture retain their exact correspondence.
  const eventIds = new Map((submitted.events || []).map((event) => [event.id, randomUUID()]));
  for (const event of submitted.events || []) {
    event.id = eventIds.get(event.id)!;
    if (event.rootEventId) event.rootEventId = eventIds.get(event.rootEventId) || event.rootEventId;
  }
  for (const person of submitted.items)
    for (const assignment of person.assignments)
      if (assignment.eventId) assignment.eventId = eventIds.get(assignment.eventId) || assignment.eventId;
  if (bindCompany && submitted.kind === "COMPANY" && !submitted.customerId) {
    noteExplicitDomainApiRequest(page, "POST", "/api/customers");
    const response = await page.request.post("/api/customers", { headers, data: { legalForm: "NONE", ownNameRu: `Синтетическая domain компания ${randomUUID()}` } });
    expect(response.ok(), await response.text()).toBe(true);
    submitted.customerId = (await response.json()).id;
  }
  noteExplicitDomainApiRequest(page, "POST", "/api/print-requests");
  const response = await page.request.post("/api/print-requests", { headers, data: submitted });
  expect(response.ok(), await response.text()).toBe(true);
  return await response.json() as Draft;
}
async function read(page: Page, id: string) {
  noteExplicitDomainApiRequest(page, "GET", `/api/print-requests/${id}`);
  const response = await page.request.get(`/api/print-requests/${id}`);
  expect(response.ok(), await response.text()).toBe(true);
  return await response.json() as Draft & { documents: unknown[] };
}
async function patch(page: Page, headers: Record<string, string>, draft: Draft) {
  noteExplicitDomainApiRequest(page, "PATCH", `/api/print-requests/${draft.id}`);
  const response = await page.request.patch(`/api/print-requests/${draft.id}`, { headers, data: { expectedRevision: draft.revision, draft: draftPayload(draft) } });
  expect(response.ok(), await response.text()).toBe(true);
  return read(page, draft.id);
}
async function saved(page: Page) { await expect(page.locator(".save-indicator")).toContainText(/сохранена|Согласовано/i); }
async function savedChange(page: Page, requestId: string, activate: () => Promise<unknown>) {
  const pending = page.waitForResponse((response) => response.url().endsWith(`/print-requests/${requestId}`) && response.request().method() === "PATCH");
  await activate();
  const response = await pending;
  expect(response.ok(), await response.text()).toBe(true);
  await saved(page);
}
async function record(page: Page, name: string, value: unknown) {
  await fs.mkdir(evidenceRoot, { recursive: true });
  await fs.writeFile(path.join(evidenceRoot, `${name}.json`), JSON.stringify(value, null, 2));
  await page.screenshot({ path: path.join(evidenceRoot, `${name}.png`), fullPage: true });
}
async function listTools(page: Page) {
  const details = page.locator("details.operator-list-tools");
  if (!await details.evaluate((element) => (element as HTMLDetailsElement).open)) await details.locator(":scope > summary").click();
}
async function closeDetails(page: Page) {
  const modal = page.getByRole("dialog", { name: /^Настройки строки/ });
  if (await modal.count()) await modal.getByRole("button", { name: "Вернуться к списку", exact: true }).click();
  const personDocument = page.getByRole("dialog", { name: "Параметры документа", exact: true });
  if (await personDocument.count()) await personDocument.getByRole("button", { name: "Готово", exact: true }).click();
}
async function immutableReference(page: Page) {
  const currentSource = process.env.DEMO_E2E_DOMAIN_IMMUTABLE_SOURCE;
  const value = JSON.parse(await fs.readFile(
    currentSource ? path.resolve(currentSource) : path.resolve(priorDomainEvidenceRoot, "v6-positive/role-lifecycle-readback.json"),
    "utf8",
  ));
  if (currentSource) expect(value.status).toBe("PASS");
  const requestId = value.requestId || value.id;
  const expectedFiles = value.artifactHashes || value.files;
  expect(requestId).toBeTruthy();
  expect(expectedFiles.length).toBeGreaterThan(0);
  const draft = await read(page, requestId) as Awaited<ReturnType<typeof read>> & {
    artifacts: { id: string; provenance: string; format?: string }[];
  };
  expect(draft.status).toBe("FINALIZED");
  if (currentSource) {
    const originals = (draft.artifacts || []).filter((artifact) =>
      artifact.provenance === "ORIGINAL" && ["PDF", "DOCX"].includes(artifact.format || ""),
    );
    expect(originals.map((artifact) => artifact.id).sort()).toEqual(
      expectedFiles.map((artifact: { id: string }) => artifact.id).sort(),
    );
    expect(draft.documents).toHaveLength(value.documents.length);
    expect((draft.documents as { id: string }[]).map((document) => document.id).sort()).toEqual(
      value.documents.map((document: { id: string }) => document.id).sort(),
    );
    expect(draft.issuances?.map((issuance) => issuance.id).sort()).toEqual([...value.issuanceIds].sort());
  }
  const files = [];
  for (const artifact of expectedFiles) {
    const response = await page.request.get(`/api/artifacts/${artifact.id}`);
    expect(response.ok()).toBe(true);
    const sha256 = createHash("sha256").update(await response.body()).digest("hex");
    expect(sha256).toBe(artifact.sha256);
    files.push({ id: artifact.id, sha256 });
  }
  return { requestId, documents: draft.documents, issuances: draft.issuances, files };
}

type DomainApiCall = { method: string; path: string };
type DomainApiBudget = { browser: DomainApiCall[]; explicit: DomainApiCall[] };
const domainApiBudgets = new WeakMap<Page, DomainApiBudget>();
function noteExplicitDomainApiRequest(page: Page, method: string, requestPath: string) {
  domainApiBudgets.get(page)?.explicit.push({ method, path: requestPath });
}
function observeDomainApiBudget(page: Page) {
  const budget: DomainApiBudget = { browser: [], explicit: [] };
  domainApiBudgets.set(page, budget);
  const observe = (request: { url(): string; method(): string }) => {
    if (request.url().includes("/api/")) budget.browser.push({ method: request.method(), path: new URL(request.url()).pathname });
  };
  page.on("request", observe);
  return {
    snapshot: () => ({ browserCount: budget.browser.length, explicitCount: budget.explicit.length, total: budget.browser.length + budget.explicit.length, browser: [...budget.browser], explicit: [...budget.explicit] }),
    reset: () => { budget.browser.length = 0; budget.explicit.length = 0; },
    stop: () => { page.off("request", observe); domainApiBudgets.delete(page); },
  };
}
async function sessionCookieMetadata(page: Page) {
  return (await page.context().cookies()).filter((cookie) => cookie.name === "demo_session" || cookie.name === "demo_csrf").map((cookie) => ({ name: cookie.name, expiresUtc: cookie.expires > 0 ? new Date(cookie.expires * 1000).toISOString() : null, remainingMs: cookie.expires > 0 ? Math.floor(cookie.expires * 1000 - Date.now()) : null }));
}

/** Long acceptance fixtures respect the unchanged 600/minute API policy.
 * Stop editor polling and prove an actual empty browser/API window. */
async function measuredApiCooldown(page: Page, stage: string, directory = "ux08-next-targets", precedingBudget?: ReturnType<ReturnType<typeof observeDomainApiBudget>["snapshot"]>) {
  const root = path.resolve(process.env.DEMO_E2E_EVIDENCE || evidenceRoot, directory);
  await fs.mkdir(root, { recursive: true });
  await page.goto("about:blank");
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const requests: string[] = [];
  const explicitBefore = domainApiBudgets.get(page)?.explicit.length ?? 0;
  const observe = (request: { url(): string }) => { if (request.url().includes("/api/")) requests.push(new URL(request.url()).pathname); };
  page.on("request", observe);
  await fs.writeFile(path.join(root, `cooldown-${stage}.json`), JSON.stringify({ status: "WAITING", stage, startedAt, requestedMs: 60000, stoppedEditorPolling: true, precedingBudget }, null, 2));
  await page.waitForTimeout(60000);
  page.off("request", observe);
  const elapsedMs = Date.now() - start;
  const explicitApiRequestsDuringCooldown = (domainApiBudgets.get(page)?.explicit.length ?? explicitBefore) - explicitBefore;
  await fs.writeFile(path.join(root, `cooldown-${stage}.json`), JSON.stringify({ status: "PASS", stage, startedAt, finishedAt: new Date().toISOString(), requestedMs: 60000, elapsedMs, apiRequests: requests, explicitApiRequestsDuringCooldown, stoppedEditorPolling: true, unchangedProductRateLimitPerMinute: 600, precedingBudget, sessionCookies: await sessionCookieMetadata(page) }, null, 2));
  expect(elapsedMs).toBeGreaterThanOrEqual(60000);
  expect(requests).toEqual([]);
  expect(explicitApiRequestsDuringCooldown).toBe(0);
}

/** UX08 uses real omissions. In particular, GROUP UNKNOWN is a valid protocol
 * fact, so it is never relabelled as a missing PASSED result by this fixture. */
async function reasonPrecheckAcceptance(page: Page, headers: Record<string, string>) {
  const root = path.resolve(process.env.DEMO_E2E_EVIDENCE || evidenceRoot, "ux08-reason-precheck");
  await fs.mkdir(root, { recursive: true });
  const contextResponse = await page.request.get("/api/context");
  expect(contextResponse.ok()).toBe(true);
  const context = await contextResponse.json() as AppContext;
  const fixture = input(3, ["BIOT"]);
  fixture.title = `СИНТЕТИЧЕСКАЯ причина до проверки ${Date.now()}`;
  fixture.items[1].assignments[0].reason = "";
  fixture.items[1].assignments[0].fieldOrigins!.reason = "CLEARED";
  const created = await create(page, headers, fixture);
  const before = await read(page, created.id);
  const rawAssignment = before.items[1].assignments[0];
  const expectedPath = "items.1.assignments.0.reason";
  const resolved = resolveDraft(before, context.profile?.commonFields);
  const readiness = draftReadiness(before, context.profile, resolved);
  expect(rawAssignment.reason).toBe("");
  expect(rawAssignment.fieldOrigins?.reason).toBe("CLEARED");
  expect(before.events![0].commonFields.reason).toBeTruthy();
  expect(resolved.draft.items[1].assignments[0].reason).toBe("");
  expect(readiness.issues).toHaveLength(1);
  expect(readiness.issues[0]).toMatchObject({ code: "GROUP_COMMON_OVERRIDE", path: expectedPath, rowId: before.items[1].id, assignmentId: rawAssignment.id, eventId: rawAssignment.eventId, field: "reason" });
  expect(readiness.fieldHints[expectedPath]).toBeTruthy();
  let validationPosts = 0;
  const observeValidation = (request: { url(): string; method(): string }) => { if (request.url().endsWith(`/print-requests/${created.id}/validate`) && request.method() === "POST") validationPosts++; };
  page.on("request", observeValidation);
  const evidence: Record<string, unknown> = { status: "RUNNING", requestId: created.id, targetRecipientId: before.items[1].id, assignmentId: rawAssignment.id, expectedPath, before, resolved: resolved.draft, readiness, diagnosticOnly: process.env.DEMO_E2E_DOMAIN_REASON_PRECHECK_ONLY === "1", fullUx04AndFourContextsClaim: false };
  async function checkpoint(stage: string) {
    evidence.stage = stage;
    evidence.validationPosts = validationPosts;
    evidence.active = await page.evaluate(() => ({ tag: document.activeElement?.tagName, path: document.activeElement?.getAttribute("data-field-path"), label: document.activeElement?.getAttribute("aria-label"), text: document.activeElement?.textContent?.slice(0, 160) }));
    await fs.writeFile(path.join(root, "reason-precheck.json"), JSON.stringify(evidence, null, 2));
    await page.screenshot({ path: path.join(root, `${stage}.png`), fullPage: true });
  }
  try {
    await page.goto(`/requests/${created.id}/edit`);
    await expect(page.locator(".operator-next-action")).toContainText("Общее поле протокола отличается");
    expect(validationPosts).toBe(0);
    await checkpoint("before-next");
    await page.locator(".operator-next-action").click();
    const reason = page.locator(`[data-field-path="${expectedPath}"]`).filter({ visible: true }).first();
    evidence.visibleReasonControls = await reason.count();
    await checkpoint("after-next-before-focus-assertion");
    await expect(reason).toBeFocused();
    await expect(reason).toHaveValue("");
    await expect(reason).toHaveAttribute("aria-invalid", "false");
    await expect(reason).toHaveAttribute("aria-describedby", /feedback-/);
    expect(validationPosts).toBe(0);
    expect((await read(page, created.id)).items).toEqual(before.items);
    await expect(reason).toBeFocused();
    await checkpoint("actual-precheck-reason-focus");
    const form = page.getByRole("dialog", { name: "Настройки строки 2", exact: true }).locator(`details[data-assignment-id="${rawAssignment.id}"]`);
    await savedChange(page, created.id, () => form.getByRole("button", { name: "Использовать общее значение причины", exact: true }).click());
    const after = await read(page, created.id);
    const expectedItems = structuredClone(before.items);
    expectedItems[1].assignments[0].fieldOrigins = { ...expectedItems[1].assignments[0].fieldOrigins, reason: "INHERITED" };
    expect(after.items).toEqual(expectedItems);
    expect(after.events).toEqual(before.events);
    await expect(reason).toHaveValue(before.events![0].commonFields.reason!);
    expect(validationPosts).toBe(0);
    const validationResponse = await page.request.post(`/api/print-requests/${created.id}/validate`, { headers, data: { expectedRevision: after.revision } });
    expect(validationResponse.ok(), await validationResponse.text()).toBe(true);
    const validation = await validationResponse.json();
    evidence.after = after;
    evidence.authoritativeValidation = validation;
    expect(validation.valid).toBe(true);
    expect(validation.issues).toEqual([]);
    expect(resolveDraft(after, context.profile?.commonFields).draft.items[1].assignments[0].reason).toBe(before.events![0].commonFields.reason);
    await closeDetails(page);
    await page.reload();
    expect((await read(page, created.id)).items).toEqual(expectedItems);
    await expect(page.locator(".operator-readiness")).toContainText("Основные поля заполнены");
    evidence.status = "PASS_EXACT_REASON_PRECHECK_REPAIR_ONLY";
    evidence.otherFieldsAssignmentsRecipientsAndConfirmationsUnchanged = true;
    await checkpoint("repaired-reloaded-server-valid");
  } catch (error) {
    evidence.status = "FAILED";
    evidence.error = error instanceof Error ? error.message : String(error);
    await checkpoint("failed");
    throw error;
  } finally {
    page.off("request", observeValidation);
  }
}

async function readinessAcceptance(page: Page, headers: Record<string, string>) {
  const contextResponse = await page.request.get("/api/context");
  expect(contextResponse.ok()).toBe(true);
  const context = await contextResponse.json() as AppContext;
  expect(context.profile?.approved).toBe(true);
  const root = path.resolve(process.env.DEMO_E2E_EVIDENCE || evidenceRoot, "ux08-next-targets");
  await fs.mkdir(root, { recursive: true });
  const proofs: unknown[] = [];
  for (const kind of ["PERSON", "COMPANY"] as const) for (const category of ["WORKER", "ITR"] as const) {
    if (proofs.length) await measuredApiCooldown(page, `${kind}-${category}`);
    const fixture = input(3, ["BIOT"]);
    const event = fixture.events![0];
    event.id = randomUUID();
    event.title = `Синтетический UX08 ${kind} ${category}`;
    event.protocolTemplateId = category === "ITR" ? "biot-itr-protocol" : "biot-protocol";
    event.commonFields = { ...event.commonFields, biotCategory: category === "ITR" ? "OHS_SPECIALIST_SPECIAL" : "WORKER", hours: category === "ITR" ? "40" : "10", biotIndustryRu: category === "ITR" ? "Синтетическая химическая отрасль" : "" };
    fixture.kind = kind;
    for (const person of fixture.items) {
      person.id = randomUUID();
      person.employeeCategory = category;
      person.employerBin = "123456789012";
      person.employerAddressRu = "Синтетический адрес предприятия";
      for (const assignment of person.assignments) {
        assignment.id = randomUUID();
        assignment.eventId = event.id;
        assignment.templateId = mandatoryTemplates("BIOT", category)[0];
        assignment.biotCategory = event.commonFields.biotCategory;
        assignment.biotKnowledgeResult = "Сдал";
        assignment.biotProctoringResult = "Синтетический прокторинг подтверждён";
      }
    }
    const customerResponse = kind === "COMPANY" ? await page.request.post("/api/customers", { headers, data: { legalForm: "TOO", ownNameRu: `Синтетический UX08 ${category} ${Date.now()}`, ownNameKz: "Синтетикалық UX08", bin: "", addressRu: "", addressKz: "" } }) : undefined;
    if (customerResponse) expect(customerResponse.ok(), await customerResponse.text()).toBe(true);
    const customer = customerResponse ? await customerResponse.json() as Customer : null;
    let draft = await create(page, headers, fixture, false);
    const stages: unknown[] = [];
    function currentReadiness(value: Draft) {
      const resolved = resolveDraft({ ...value, items: value.items.map((person) => resolveRecipientText(effectiveRecipientEmployer(person, value.customerId ? customer : null))) }, context.profile?.commonFields);
      return draftReadiness(value, context.profile, resolved);
    }
    async function checkpoint(stage: string, extra: Record<string, unknown>) {
      const active = await page.evaluate(() => ({ tag: document.activeElement?.tagName, path: document.activeElement?.getAttribute("data-field-path"), label: document.activeElement?.getAttribute("aria-label"), text: document.activeElement?.textContent?.slice(0, 160) }));
      stages.push(structuredClone({ stage, ...extra, active }));
      await fs.writeFile(path.join(root, `${kind}-${category}.json`), JSON.stringify({ status: "RUNNING", requestId: draft.id, kind, category, stages, sessionCookies: await sessionCookieMetadata(page) }, null, 2));
      await page.screenshot({ path: path.join(root, `${kind}-${category}-${stage}.png`), fullPage: true });
    }
    async function next(code: string, rawPath: string, expectedControlPath: string, notice: RegExp) {
      const before = await read(page, draft.id);
      const issues = currentReadiness(before).issues;
      expect(issues[0], `${kind}/${category}: authoritative first readiness cause`).toMatchObject({ code, path: rawPath });
      const button = page.locator(".operator-next-action");
      await expect(button).toContainText(notice);
      await button.click();
      const control = page.locator(`${expectedControlPath.startsWith("events.") ? ".training-primary-context " : ""}[data-field-path="${expectedControlPath}"]`).filter({ visible: true }).first();
      await checkpoint(`attempt-${code}-${rawPath.replaceAll(".", "-")}`, { code, rawPath, expectedControlPath, issues, visibleControlCount: await control.count() });
      await expect(control).toBeFocused();
      await checkpoint(`focus-${code}-${rawPath.replaceAll(".", "-")}`, { code, rawPath, expectedControlPath, issues, exactActualFocus: true });
      expect((await read(page, draft.id)).items).toEqual(before.items);
      await expect(control).toBeFocused();
      return control;
    }
    async function writeCommon(key: "trainingSubject" | "documentDate", value: string) {
      const before = await read(page, draft.id);
      const control = page.locator(`.training-primary-context [data-field-path="events.0.commonFields.${key}"]`).filter({ visible: true }).first();
      await savedChange(page, draft.id, async () => { await control.fill(value); await control.press("Tab"); });
      draft = await read(page, draft.id);
      expect(draft.events![0].commonFields[key]).toBe(value);
      expect(draft.items).toEqual(before.items);
      await expect(page.locator(".operator-readiness")).toContainText("Основные поля заполнены");
      await page.reload();
      expect((await read(page, draft.id)).items).toEqual(before.items);
    }
    async function returnAfterCorrection(control: Locator, row: number) {
      const modal = page.getByRole("dialog", { name: `Настройки строки ${row}`, exact: true });
      const fieldPath = await control.getAttribute("data-field-path");
      const wasDrawer = !!await modal.count();
      if (kind === "PERSON") {
        await expect(control).toBeFocused();
        await expect(control).toBeInViewport();
        const person = page.locator(".person-editor");
        await person.getByRole("button", { name: "Готово", exact: true }).click();
        await expect(person.locator('[data-person-stage="summary"]')).toBeVisible();
        await expect(page.getByLabel("Человек в заявке", { exact: true })).toHaveValue(draft.items[row - 1].id);
      } else if (wasDrawer) {
        await expect(modal).toBeVisible();
        await closeDetails(page);
        await expect(page.getByRole("button", { name: `Детали получателя ${row}`, exact: true })).toBeFocused();
      } else {
        await expect(control).toBeFocused();
        await expect(control).toBeInViewport();
      }
      await checkpoint(`return-row-${row}-${fieldPath}`, { row, fieldPath, layer: kind === "PERSON" ? "person returned to summary with the same stable identity" : wasDrawer ? "drawer returned to row opener" : "inline field stayed focused", actualPredictableReturn: true });
    }
    await page.goto(`/requests/${draft.id}/edit`);
    if (kind === "COMPANY") {
      expect(currentReadiness(draft).issues[0]).toMatchObject({ code: "CUSTOMER_REQUIRED", path: "customerId" });
      await page.locator(".operator-next-action").click();
      await expect(page.locator("#request-customer input[required]").first()).toBeFocused();
      await checkpoint("company-next", { code: "CUSTOMER_REQUIRED", companyInputFocused: true, personCustomerWasNotCreated: true });
      await page.getByRole("button", { name: "Из справочника", exact: true }).click();
      const initialOptionCount = await page.locator(`[data-field-path="customerId"] option[value="${customer!.id}"]`).count();
      await page.getByRole("button", { name: "Найти в справочнике", exact: true }).click();
      const picker = page.getByRole("dialog", { name: "Найти заказчика", exact: true });
      await picker.getByLabel("Поиск по справочнику", { exact: true }).fill(customer!.nameRu);
      const found = picker.locator("tbody tr").filter({ hasText: customer!.nameRu });
      await expect(found).toHaveCount(1);
      await savedChange(page, draft.id, () => found.getByRole("button", { name: "Выбрать", exact: true }).click());
      await expect(picker).toHaveCount(0);
      draft = await read(page, draft.id);
      expect(draft.customerId).toBe(customer!.id);
      await checkpoint("company-cause-search-repair", { initialOptionCount, searchedName: customer!.nameRu, actualCustomerId: draft.customerId, exactDirectorySelectionSaved: true });
    } else expect(draft.customerId).toBeNull();
    expect(currentReadiness(draft).issues).toEqual([]);
    await expect(page.locator(".operator-readiness")).toContainText("Основные поля заполнены");

    draft.events![0].commonFields.trainingSubject = "";
    draft.events![0].commonFields.fieldOrigins = { ...draft.events![0].commonFields.fieldOrigins, trainingSubject: "CLEARED" };
    draft = await patch(page, headers, draft);
    await page.reload();
    await next("SUBJECT_REQUIRED", "items.0.assignments.0.trainingSubject", "events.0.commonFields.trainingSubject", /Укажите программу/);
    await writeCommon("trainingSubject", `Восстановленная синтетическая программа ${kind} ${category}`);

    // Retain the original EVENT/CLEARED cause. A focused individual override
    // is not sufficient if the shared virtual protocol remains unrepaired.
    draft.events![0].commonFields.protocolDate = "";
    draft.events![0].commonFields.dateOrigins = { ...draft.events![0].commonFields.dateOrigins, protocolDate: "CLEARED" };
    draft = await patch(page, headers, draft);
    await page.reload();
    const beforeClearedProtocol = await read(page, draft.id);
    expect(beforeClearedProtocol.items.every((person) => person.assignments[0].fieldOrigins?.protocolDate === "INHERITED")).toBe(true);
    const protocolDate = await next("PROTOCOL_DATE_REQUIRED", "items.0.assignments.0.protocolDate", "events.0.commonFields.protocolDate", /Укажите дату протокола/);
    await savedChange(page, draft.id, async () => { await protocolDate.fill(dates.protocolDate); await protocolDate.press("Tab"); });
    const repairedProtocol = await read(page, draft.id);
    const protocolValidationResponse = await page.request.post(`/api/print-requests/${draft.id}/validate`, { headers, data: { expectedRevision: repairedProtocol.revision } });
    expect(protocolValidationResponse.ok(), await protocolValidationResponse.text()).toBe(true);
    const protocolValidation = await protocolValidationResponse.json();
    const remainingProtocolCauses = currentReadiness(repairedProtocol).issues.filter((issue) => /protocolDate$/.test(issue.path) || issue.code === "GROUP_COMMON_OVERRIDE");
    await checkpoint("cleared-event-protocol-repair", { before: beforeClearedProtocol, after: repairedProtocol, authoritativeValidation: protocolValidation, remainingProtocolCauses });
    expect(remainingProtocolCauses, "The actual focused control must repair the shared cleared protocol cause for all participants and forms").toEqual([]);
    expect(protocolValidation.issues.filter((issue: { field?: string; code: string }) => issue.field === "protocolDate" || issue.code === "GROUP_COMMON_OVERRIDE")).toEqual([]);
    expect(protocolValidation.valid).toBe(true);
    expect(repairedProtocol.events![0].commonFields.protocolDate).toBe(dates.protocolDate);
    expect(repairedProtocol.events![0].commonFields.dateOrigins?.protocolDate).toBe("MANUAL");
    expect(repairedProtocol.items).toEqual(beforeClearedProtocol.items);
    draft = repairedProtocol;
    await closeDetails(page);
    await page.reload();
    expect(currentReadiness(await read(page, draft.id)).issues).toEqual([]);

    if (kind === "PERSON") {
      for (const person of draft.items) { person.workplaceRu = ""; person.workplaceKz = ""; }
      draft = await patch(page, headers, draft);
      await page.reload();
      const missing = currentReadiness(draft).issues.filter((issue) => issue.path.endsWith(".workplaceRu"));
      expect(missing.map((issue) => issue.path)).toEqual(["items.0.workplaceRu", "items.1.workplaceRu", "items.2.workplaceRu"]);
      const remaining = page.locator(".operator-readiness details");
      await remaining.locator(":scope > summary").click();
      for (let index = 0; index < 3; index++) await expect(remaining.getByRole("button").filter({ hasText: new RegExp(`Строка ${index + 1}, Синтетический Участник ${index + 1}.*наименование предприятия`) })).toHaveCount(1);
      await page.getByLabel("Человек в заявке", { exact: true }).selectOption(draft.items[1].id);
      await expect(page.locator(".operator-grid")).toHaveCount(0);
      for (let index = 0; index < 3; index++) {
        const before = await read(page, draft.id);
        const control = await next("BIOT_FIELD_REQUIRED", `items.${index}.workplaceRu`, `items.${index}.workplaceRu`, new RegExp(`Строка ${index + 1}.*наименование предприятия`));
        await savedChange(page, draft.id, () => control.fill(`Синтетический работодатель ${index + 1}`));
        draft = await read(page, draft.id);
        const expected = structuredClone(before.items);
        expected[index].workplaceRu = `Синтетический работодатель ${index + 1}`;
        expect(draft.items).toEqual(expected);
        expect(currentReadiness(draft).issues.filter((issue) => issue.path.endsWith(".workplaceRu"))).toHaveLength(2 - index);
        await returnAfterCorrection(control, index + 1);
      }
      expect(draft.customerId).toBeNull();
    } else {
      for (const person of draft.items) { person.workplaceRu = ""; person.workplaceKz = ""; }
      draft = await patch(page, headers, draft);
      await page.reload();
      expect(currentReadiness(draft).issues).toEqual([]);
      await expect(page.locator(".operator-readiness")).toContainText("Основные поля заполнены");
      await checkpoint("company-employer-inherited", { customerId: draft.customerId, rawWorkplacesEmpty: true, effectiveEmployer: customer!.nameRu, noFalsePersonalEmployerRequirement: true });
    }
    if (category === "ITR") for (const field of ["employerBin", "employerAddressRu"] as const) {
      draft.items[2][field] = "";
      draft = await patch(page, headers, draft);
      await page.reload();
      if (kind === "PERSON") {
        await page.getByLabel("Человек в заявке", { exact: true }).selectOption(draft.items[0].id);
        await expect(page.locator(".operator-grid")).toHaveCount(0);
      } else {
        await listTools(page);
        await page.getByLabel("Поиск в заявке", { exact: true }).fill("Участник 1");
        await expect(page.locator(`tr[data-recipient-id="${draft.items[2].id}"]`)).toHaveCount(0);
      }
      const before = await read(page, draft.id);
      const control = await next(field === "employerBin" ? "BIOT_BIN_REQUIRED" : "BIOT_FIELD_REQUIRED", `items.2.${field}`, `items.2.${field}`, /Строка 3/);
      const value = field === "employerBin" ? "123456789012" : "Восстановленный синтетический адрес";
      await savedChange(page, draft.id, () => control.fill(value));
      draft = await read(page, draft.id);
      const expected = structuredClone(before.items);
      expected[2][field] = value;
      expect(draft.items).toEqual(expected);
      await returnAfterCorrection(control, 3);
      expect(currentReadiness(draft).issues).toEqual([]);
    }
    // A technical blank inherits earlier values. Explicitly clear the EVENT
    // date through fieldOrigins, keeping all participants INHERITED.
    draft.events![0].commonFields.documentDate = "";
    draft.events![0].commonFields.fieldOrigins = { ...draft.events![0].commonFields.fieldOrigins, documentDate: "CLEARED" };
    draft = await patch(page, headers, draft);
    await page.reload();
    const beforeEventDate = await read(page, draft.id);
    expect(beforeEventDate.items.every((person) => person.assignments[0].fieldOrigins?.documentDate === "INHERITED")).toBe(true);
    await next("DATE_INVALID", "items.0.assignments.0.documentDate", "events.0.commonFields.documentDate", /действительную календарную дату/);
    await writeCommon("documentDate", dates.documentDate);
    const eventDateValidationResponse = await page.request.post(`/api/print-requests/${draft.id}/validate`, { headers, data: { expectedRevision: draft.revision } });
    expect(eventDateValidationResponse.ok(), await eventDateValidationResponse.text()).toBe(true);
    const eventDateValidation = await eventDateValidationResponse.json();
    expect(eventDateValidation.valid).toBe(true);
    expect(eventDateValidation.issues.filter((issue: { field?: string }) => issue.field === "documentDate")).toEqual([]);
    expect(draft.items).toEqual(beforeEventDate.items);
    await checkpoint("event-document-date-repair", { rawEventBefore: beforeEventDate.events![0], rawEventAfter: draft.events![0], authoritativeValidation: eventDateValidation, allRawMembersAndOriginsUnchanged: true });

    draft.commonFields!.documentDate = "";
    draft.commonFields!.fieldOrigins = { ...draft.commonFields!.fieldOrigins, documentDate: "CLEARED" };
    delete draft.events![0].commonFields.documentDate;
    delete draft.events![0].commonFields.fieldOrigins?.documentDate;
    draft = await patch(page, headers, draft);
    await page.reload();
    const beforeDate = await read(page, draft.id);
    const commonDate = await next("DATE_INVALID", "items.0.assignments.0.documentDate", "commonFields.documentDate", /действительную календарную дату/);
    await savedChange(page, draft.id, () => commonDate.fill(dates.documentDate));
    draft = await read(page, draft.id);
    expect(draft.commonFields!.documentDate).toBe(dates.documentDate);
    expect(draft.items).toEqual(beforeDate.items);
    expect(currentReadiness(draft).issues).toEqual([]);
    await expect(page.locator(".operator-readiness")).toContainText("Основные поля заполнены");
    await page.reload();
    expect((await read(page, draft.id)).items).toEqual(beforeDate.items);
    async function applyKnownResult(targetIndex: number, source: string) {
      const before = await read(page, draft.id);
      if (kind === "PERSON") {
        await page.getByLabel("Человек в заявке", { exact: true }).selectOption(draft.items[targetIndex].id);
        await expect(page.locator(".operator-grid")).toHaveCount(0);
      } else {
        await listTools(page);
        await page.getByLabel("Поиск в заявке", { exact: true }).fill("");
        for (let index = 0; index < draft.items.length; index++) await page.getByLabel(`Выбрать строку ${index + 1}`, { exact: true }).setChecked(index === targetIndex);
      }
      const preparation = page.locator(".training-primary-context .outcome-entry").filter({ has: page.locator('[data-field-path="events.0.outcomes"]') });
      await preparation.getByLabel("Кому подтвердить результат", { exact: true }).selectOption("selected");
      await preparation.getByLabel("Известный результат", { exact: true }).selectOption("PASSED");
      await preparation.getByLabel("Источник подтверждения", { exact: true }).fill(source);
      const apply = preparation.getByRole("button", { name: "Применить результат · 1 человек", exact: true });
      await expect(apply).toBeEnabled();
      await expect(preparation).toContainText("Результат будет применён к людям: 1.");
      expect((await read(page, draft.id)).items).toEqual(before.items);
      await savedChange(page, draft.id, () => apply.click());
      draft = await read(page, draft.id);
      for (let index = 0; index < draft.items.length; index++) if (index !== targetIndex) expect(draft.items[index]).toEqual(before.items[index]);
      for (const [index, assignment] of draft.items[targetIndex].assignments.entries()) {
        expect(assignment.outcome).toMatchObject({ status: "PASSED", source, confirmedBy: context.user.id });
        expect(assignment.outcome?.confirmedAt).toBeTruthy();
        const prior = before.items[targetIndex].assignments[index];
        expect(assignment.result).toBe(prior.result || "Өтті/прошел");
        expect(assignment.resultKz).toBe(prior.resultKz || "Өтті");
        expect(assignment.fieldOrigins).toEqual({
          ...prior.fieldOrigins,
          result: prior.result ? prior.fieldOrigins?.result || "MANUAL" : "COURSE",
          resultKz: prior.resultKz ? prior.fieldOrigins?.resultKz || "MANUAL" : "COURSE",
          outcome: "MANUAL",
        });
        const { result: _oldResult, resultKz: _oldResultKz, outcome: _oldOutcome, fieldOrigins: _oldOrigins, ...oldFacts } = prior;
        const { result: _newResult, resultKz: _newResultKz, outcome: _newOutcome, fieldOrigins: _newOrigins, ...newFacts } = assignment;
        expect(newFacts).toEqual(oldFacts);
      }
      expect(currentReadiness(draft).issues).toEqual([]);
      await expect(page.locator(".operator-readiness")).toContainText("Основные поля заполнены");
      await page.reload();
      expect((await read(page, draft.id)).items).toEqual(draft.items);
    }
    draft.items[1].assignments[0].result = "";
    draft.items[1].assignments[0].resultKz = "";
    draft.items[1].assignments[0].fieldOrigins = {
      ...draft.items[1].assignments[0].fieldOrigins,
      result: "CLEARED",
      resultKz: "CLEARED",
    };
    draft = await patch(page, headers, draft);
    await page.reload();
    const beforeClearedResult = await read(page, draft.id);
    const resultField = await next("RESULT_REQUIRED", "items.1.assignments.0.result", "items.1.assignments.0.result", /подтверждённый результат/);
    const manualResult = `СИНТЕТИЧЕСКАЯ подтверждённая оценка UX08 ${kind}/${category}`;
    const manualResultKz = `СИНТЕТИКАЛЫҚ расталған баға UX08 ${kind}/${category}`;
    const resultConfirmationStartedAt = Date.now();
    await savedChange(page, draft.id, () => resultField.fill(manualResult));
    const afterRuResult = await read(page, draft.id);
    const resultConfirmationFinishedAt = Date.now();
    const priorOutcome = beforeClearedResult.items[1].assignments[0].outcome!;
    const confirmedOutcome = afterRuResult.items[1].assignments[0].outcome!;
    // Editing the confirmed RU result is an authenticated new confirmation.
    // The server stamps this action; a KZ text-only edit must preserve that stamp.
    expect(confirmedOutcome).toEqual({
      ...priorOutcome,
      confirmedBy: context.user.id,
      confirmedAt: confirmedOutcome.confirmedAt,
    });
    const confirmationTime = Date.parse(confirmedOutcome.confirmedAt!);
    expect(Number.isFinite(confirmationTime)).toBe(true);
    expect(confirmationTime).toBeGreaterThan(Date.parse(priorOutcome.confirmedAt!));
    expect(confirmationTime).toBeGreaterThanOrEqual(resultConfirmationStartedAt);
    expect(confirmationTime).toBeLessThanOrEqual(resultConfirmationFinishedAt);
    const expectedRuResultItems = structuredClone(beforeClearedResult.items);
    expectedRuResultItems[1].assignments[0] = {
      ...expectedRuResultItems[1].assignments[0],
      result: manualResult,
      outcome: confirmedOutcome,
      fieldOrigins: { ...expectedRuResultItems[1].assignments[0].fieldOrigins, result: "MANUAL" },
    };
    expect(afterRuResult.items).toEqual(expectedRuResultItems);
    expect(afterRuResult.events).toEqual(beforeClearedResult.events);
    expect(afterRuResult.items[1].assignments[0].resultKz).toBe("");
    expect(afterRuResult.items[1].assignments[0].fieldOrigins?.resultKz).toBe("CLEARED");
    const resultKzField = page.locator('[data-field-path="items.1.assignments.0.resultKz"]').filter({ visible: true }).first();
    await savedChange(page, draft.id, () => resultKzField.fill(manualResultKz));
    draft = await read(page, draft.id);
    const expectedResultItems = structuredClone(expectedRuResultItems);
    expectedResultItems[1].assignments[0] = {
      ...expectedResultItems[1].assignments[0],
      result: manualResult,
      resultKz: manualResultKz,
      fieldOrigins: { ...expectedResultItems[1].assignments[0].fieldOrigins, result: "MANUAL", resultKz: "MANUAL" },
    };
    expect(draft.items).toEqual(expectedResultItems);
    expect(draft.events).toEqual(beforeClearedResult.events);
    expect(currentReadiness(draft).issues).toEqual([]);
    const resultValidationResponse = await page.request.post(`/api/print-requests/${draft.id}/validate`, { headers, data: { expectedRevision: draft.revision } });
    expect(resultValidationResponse.ok(), await resultValidationResponse.text()).toBe(true);
    const resultValidation = await resultValidationResponse.json();
    expect(resultValidation.valid).toBe(true);
    expect(resultValidation.issues.filter((issue: { code: string }) => issue.code === "RESULT_REQUIRED")).toEqual([]);
    await checkpoint("explicit-cleared-result-repair", { before: beforeClearedResult, after: draft, authoritativeValidation: resultValidation, actualResultFieldFocusedAndEdited: true, ruAndKzEnteredSeparately: true, allOtherRawFactsPreserved: true, authenticatedResultConfirmation: { before: priorOutcome, afterRu: confirmedOutcome, afterKz: draft.items[1].assignments[0].outcome, startedAt: resultConfirmationStartedAt, finishedAt: resultConfirmationFinishedAt } });
    await closeDetails(page);
    await page.reload();
    const reloadedResult = await read(page, draft.id);
    expect(reloadedResult.items).toEqual(expectedResultItems);
    expect(reloadedResult.events).toEqual(beforeClearedResult.events);
    expect(currentReadiness(reloadedResult).issues).toEqual([]);
    await expect(page.locator(".operator-readiness")).toContainText("Основные поля заполнены");
    draft.items[2].assignments[0].outcome!.source = "";
    draft = await patch(page, headers, draft);
    await page.reload();
    await next("OUTCOME_SOURCE_REQUIRED", "items.2.assignments.0.outcome.source", "events.0.outcomes.source", /источник подтверждённого результата/);
    await applyKnownResult(2, `СИНТЕТИЧЕСКАЯ проверенная ведомость UX08 ${kind}/${category}/источник`);
    const proof = { status: "PASS", requestId: draft.id, kind, category, stages, savedItems: draft.items, savedEvents: draft.events, customerId: draft.customerId, actualReadinessComplete: currentReadiness(draft).locallyComplete, noInventedPassedResult: true, otherTrainingFactsAndOriginsPreserved: true };
    proofs.push(proof);
    await fs.writeFile(path.join(root, `${kind}-${category}.json`), JSON.stringify(proof, null, 2));
  }
  await fs.writeFile(path.join(root, "readiness-acceptance.json"), JSON.stringify({ status: "PASS", contexts: proofs, legalApproval: false, currentRuntimeRequired: true }, null, 2));
}

test("UX01 exact hidden multi-person removal preserves MANUAL IMPORTED CLEARED facts, other direction and issued reference", async ({ page }) => {
  test.setTimeout(300000);
  const headers = await login(page);
  const immutableBefore = await immutableReference(page);
  const fixture = input(10);
  fixture.items[9].employeeCategory = "ITR";
  fixture.items[9].fullNameRu = "Синтетический Скрытый Инженер";
  fixture.events!.push({
    ...structuredClone(fixture.events![0]),
    id: "accept-BIOT-ITR",
    title: "Синтетическое обучение БиОТ ИТР",
    protocolTemplateId: "biot-itr-protocol",
    commonFields: { ...fixture.events![0].commonFields, biotCategory: "OHS_SPECIALIST_SPECIAL", hours: "40", productionHours: "" },
  });
  fixture.items[9].assignments[0].templateId = mandatoryTemplates("BIOT", "ITR")[0];
  fixture.items[9].assignments[0].eventId = "accept-BIOT-ITR";
  for (const [index, person] of fixture.items.entries()) {
    const biot = person.assignments[0];
    biot.fieldOrigins = { ...biot.fieldOrigins, documentDate: "MANUAL", trainingStart: "IMPORTED", trainingEnd: "CLEARED", protocolDate: "IMPORTED" };
    biot.documentDate = `2026-10-${String(index + 3).padStart(2, "0")}`;
    biot.trainingStart = "2026-09-20"; biot.trainingEnd = "";
  }
  const created = await create(page, headers, fixture);
  await page.goto(`/requests/${created.id}/edit`);
  await page.getByLabel("Выбрать строку 1", { exact: true }).check();
  await page.getByLabel("Выбрать строку 10", { exact: true }).check();
  await listTools(page);
  await page.getByLabel("Поиск в заявке", { exact: true }).fill("Участник 1");
  await expect(page.locator(".selection-toolbar")).toContainText("скрыто фильтрами: 1");
  const remove = page.getByRole("button", { name: "БиОТ: снять у этой группы (2)", exact: true });
  await remove.click();
  const confirmation = page.getByRole("dialog", { name: "Снять обучение у этой группы?", exact: true });
  await expect(confirmation).toContainText("2 получателей");
  await expect(confirmation).toContainText("История и оформленные документы сохраняются");
  await confirmation.getByRole("button", { name: "Оставить обучение", exact: true }).click();
  expect((await read(page, created.id)).items).toEqual(created.items);
  await remove.click();
  const removalPending = page.waitForResponse((response) => response.url().endsWith(`/print-requests/${created.id}/training-removals`) && response.request().method() === "POST");
  await confirmation.getByRole("button", { name: "Снять обучение у 2 получателей", exact: true }).click();
  const removalResponse = await removalPending;
  expect(removalResponse.ok(), await removalResponse.text()).toBe(true);
  const removalScope = removalResponse.request().postDataJSON();
  expect(removalScope.direction).toBe("BIOT");
  expect([...removalScope.eventIds].sort()).toEqual([created.items[0].assignments[0].eventId, created.items[9].assignments[0].eventId].sort());
  expect([...removalScope.recipientIds].sort()).toEqual(["accept-person-1", "accept-person-10"]);
  await expect(confirmation).toHaveCount(0);
  await saved(page);
  const removed = await read(page, created.id);
  for (const index of [0, 9]) expect(removed.items[index].assignments.map((assignment) => assignment.templateId)).toEqual(["pb-card"]);
  expect(removed.items[1].assignments).toEqual(created.items[1].assignments);
  await page.reload();
  await page.getByLabel("Должность · RU, строка 2", { exact: true }).fill("Независимая сохранённая правка");
  await saved(page);
  await page.getByRole("button", { name: "Восстановить обучение", exact: true }).click();
  await expect(page.getByRole("button", { name: "Восстановить обучение", exact: true })).toHaveCount(0);
  await saved(page);
  const restored = await read(page, created.id);
  for (const index of [0, 9]) expect(restored.items[index].assignments).toEqual(created.items[index].assignments);
  expect(restored.items[1].positionRu).toBe("Независимая сохранённая правка");
  expect(restored.items[1].assignments).toEqual(created.items[1].assignments);
  await page.reload();
  await expect(page.getByRole("button", { name: "Восстановить обучение", exact: true })).toHaveCount(0);
  expect((await read(page, created.id)).items[9].assignments).toEqual(created.items[9].assignments);
  expect(await immutableReference(page)).toEqual(immutableBefore);
  // An empty mistaken choice has a direct removal and durable undo, without
  // the confirmation required for the known facts above.
  const empty = input(1, ["BIOT"]);
  empty.events = [];
  empty.commonFields = {};
  empty.items[0].assignments = [];
  const blank = await create(page, headers, empty);
  await page.goto(`/requests/${blank.id}/edit`);
  await page.getByRole("button", { name: /^Настройки обучения получателя 1:/ }).click();
  const emptyChoice = page.getByRole("dialog", { name: "Назначить обучение", exact: true });
  await emptyChoice.getByRole("checkbox", { name: /Безопасность и охрана труда/ }).check();
  await savedChange(page, blank.id, () => emptyChoice.getByRole("button", { name: "Добавить обучение и комплект", exact: true }).click());
  await expect(emptyChoice).toHaveCount(0);
  const mistaken = await read(page, blank.id);
  expect(mistaken.items[0].assignments).not.toHaveLength(0);
  expect(mistaken.items[0].assignments[0].outcome?.status).toBe("PASSED");
  expect(mistaken.items[0].assignments[0].fieldOrigins?.outcome).toBe("AUTO");
  await page.getByRole("button", { name: "БиОТ: снять у этой группы (1)", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Снять обучение у этой группы?", exact: true })).toHaveCount(0);
  await expect.poll(async () => (await read(page, blank.id)).items[0].assignments.length).toBe(0);
  await page.reload();
  await page.getByRole("button", { name: "Восстановить обучение", exact: true }).click();
  await expect.poll(async () => (await read(page, blank.id)).items[0].assignments.length).toBe(mistaken.items[0].assignments.length);
  expect((await read(page, blank.id)).items[0].assignments).toEqual(mistaken.items[0].assignments);
  await record(page, "ux01-full-scope", { requestId: created.id, removalScope, before: created.items, removed: removed.items, restored: restored.items, emptyRequestId: blank.id, actualEmptyChoice: mistaken.items[0], immutableReference: immutableBefore, immutableAfter: await immutableReference(page) });
});

test("UX04 actual fourth-row group and individual issues focus exact assignment fields after deletion reorder and filtering; UX08 Next repairs true PERSON COMPANY WORKER ITR causes", async ({ page }) => {
  test.setTimeout(600000);
  if (process.env.DEMO_E2E_DOMAIN_REASON_PRECHECK_ONLY === "1" && process.env.DEMO_E2E_FULL_CHECKPOINTS === "1")
    throw new Error("A short reason diagnostic cannot stand in for the complete UX04/UX08 full-suite case");
  await measuredApiCooldown(page, "initial-ux04-after-prior-probes");
  const headers = await login(page);
  await reasonPrecheckAcceptance(page, headers);
  if (process.env.DEMO_E2E_DOMAIN_REASON_PRECHECK_ONLY === "1") {
    console.log("SHORT_REASON_PRECHECK_DIAGNOSTIC_ONLY: the remaining structural UX04 and four UX08 contexts are reserved for the full normal run.");
    return;
  }
  const fixture = input(4);
  fixture.events![1].protocolMode = "INDIVIDUAL";
  const target = fixture.items[3];
  target.fullNameRu = ""; target.fullNameKz = "";
  for (const assignment of target.assignments) {
    assignment.fieldOrigins = Object.fromEntries(originKeys.map((key) => [key, "MANUAL"]));
    assignment.documentDate = ""; assignment.trainingStart = "2026-02-31"; assignment.trainingEnd = "2026-02-30"; assignment.protocolDate = "2026-02-31";
    assignment.trainingSubject = "";
    assignment.fieldOrigins.trainingSubject = "CLEARED";
    assignment.hours = "1"; assignment.productionHours = "1";
  }
  const created = await create(page, headers, fixture);
  const states: unknown[] = [];
  async function check(expectedIndex: number, hide: boolean) {
    const validate = page.waitForResponse((response) => response.url().endsWith("/validate") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Проверить данные", exact: true }).click();
    const body = await (await validate).json();
    const issues = body.issues.filter((issue: { recipientId?: string }) => issue.recipientId === target.id);
    expect(issues.some((issue: { code: string }) => issue.code === "NAME_REQUIRED")).toBe(true);
    expect(body.issues.some((issue: { code: string; recipientId: string }) => issue.code === "NAME_REQUIRED" && issue.recipientId === created.items[0].id)).toBe(false);
    const raw = await read(page, created.id);
    const person = raw.items[expectedIndex];
    expect(person.id).toBe(target.id);
    const codes: Record<string, string> = { fullNameRu: "NAME_REQUIRED", documentDate: "DATE_INVALID", trainingStart: "DATE_INVALID", trainingEnd: "DATE_INVALID", protocolDate: "DATE_INVALID", trainingSubject: "SUBJECT_REQUIRED", hours: "BIOT_HOURS_MIN", productionHours: "BIOT_PRODUCTION_HOURS_MIN", reason: "GROUP_COMMON_OVERRIDE" };
    const fields: Array<{ field: string; assignmentId?: string }> = [{ field: "fullNameRu" }];
    for (const assignment of person.assignments) {
      for (const field of ["documentDate", "trainingStart", "trainingEnd", "protocolDate", "trainingSubject"]) fields.push({ field, assignmentId: assignment.id });
      for (const field of ["hours", "productionHours", "reason"]) if (issues.some((issue: { field: string; code: string; assignmentId: string }) => issue.field === field && issue.code === codes[field] && issue.assignmentId === assignment.id)) fields.push({ field, assignmentId: assignment.id });
    }
    const actualFocus = [];
    for (const { field, assignmentId } of fields) {
      const issue = issues.find((entry: { field: string; code: string; assignmentId?: string }) => entry.field === field && entry.code === codes[field] && (field === "fullNameRu" || entry.assignmentId === assignmentId));
      expect(issue, `${assignmentId || target.id}:${field}`).toBeTruthy();
      const assignmentIndex = field === "fullNameRu" ? undefined : person.assignments.findIndex((assignment) => assignment.id === issue.assignmentId);
      const expectedPath = field === "fullNameRu" ? `items.${expectedIndex}.${field}` : `items.${expectedIndex}.assignments.${assignmentIndex}.${field}`;
      expect(issue.path).toBe(expectedPath);
      if (field !== "fullNameRu") expect(issue.eventId).toBe(person.assignments[assignmentIndex!].eventId);
      if (hide) {
        await listTools(page);
        await page.getByLabel("Поиск в заявке", { exact: true }).fill("Участник 3");
        await expect(page.locator(`tr[data-recipient-id="${target.id}"]`)).toHaveCount(0);
      }
      const group = page.locator(".review-issue-group").filter({ has: page.getByRole("heading", { name: `Получатель ${expectedIndex + 1}`, exact: true }) });
      const uniqueIssues = [...new Map(issues.map((entry: { path: string; message: string }) => [JSON.stringify([entry.path, entry.message]), entry])).values()] as Array<{ path: string; message: string }>;
      const buttonIndex = uniqueIssues.findIndex((entry) => entry.path === issue.path && entry.message === issue.message);
      expect(buttonIndex).toBeGreaterThanOrEqual(0);
      await group.getByRole("button").nth(buttonIndex).click();
      const focused = page.locator(`[data-field-path="${expectedPath}"]`).filter({ visible: true }).first();
      await expect(focused).toBeFocused();
      await expect(focused).toHaveAttribute("aria-invalid", "true");
      if (field === "fullNameRu") await expect(page.locator(".operator-grid").getByLabel(`ФИО, строка ${expectedIndex + 1}`, { exact: true })).toBeFocused();
      else if (await page.getByRole("dialog", { name: `Настройки строки ${expectedIndex + 1}`, exact: true }).count()) {
        const modal = page.getByRole("dialog", { name: `Настройки строки ${expectedIndex + 1}`, exact: true });
        await expect(modal).toBeVisible();
        expect(await focused.evaluate((element) => element.closest("details[data-assignment-id]")?.getAttribute("data-assignment-id"))).toBe(issue.assignmentId);
      } else expect(field).toBe("documentDate");
      actualFocus.push({ field, assignmentId, path: expectedPath, eventId: issue.eventId, actualControlFocusedAndInvalid: true });
      await closeDetails(page);
    }
    states.push({ expectedIndex, hiddenBeforeFocus: hide, issues, actualFocus });
  }
  await page.goto(`/requests/${created.id}/edit`);
  await check(3, false);
  await page.getByRole("button", { name: "Удалить получателя 2", exact: true }).click();
  const deletion = page.getByRole("dialog", { name: "Убрать получателя из заявки?", exact: true });
  await deletion.getByRole("button", { name: "Убрать из заявки", exact: true }).click();
  await saved(page);
  await check(2, false);
  const reordered = await read(page, created.id);
  reordered.items = [reordered.items[2], reordered.items[0], reordered.items[1]];
  await patch(page, headers, reordered);
  await page.reload();
  await check(0, true);
  const beforeReset = await read(page, created.id);
  const bio = beforeReset.items[0].assignments[0];
  await page.getByRole("button", { name: "Детали получателя 1", exact: true }).click();
  const bioForm = page.getByRole("dialog").locator(`details[data-assignment-id="${bio.id}"]`);
  if (!await bioForm.evaluate((element) => (element as HTMLDetailsElement).open)) await bioForm.locator(":scope > summary").click();
  await bioForm.getByRole("tab", { name: /^Обучение и результат(?: Ошибок: \d+)?$/ }).click();
  const reason = bioForm.locator('[data-field-path="items.0.assignments.0.reason"]');
  await expect(reason).toHaveAttribute("aria-invalid", "true");
  await savedChange(page, created.id, () => bioForm.getByRole("button", { name: "Использовать общее значение причины", exact: true }).click());
  const afterReset = await read(page, created.id);
  const expectedReset = structuredClone(beforeReset.items[0]);
  expectedReset.assignments[0].fieldOrigins = { ...expectedReset.assignments[0].fieldOrigins, reason: "INHERITED" };
  expect(afterReset.items[0]).toEqual(expectedReset);
  expect(afterReset.items.slice(1)).toEqual(beforeReset.items.slice(1));
  await expect(reason).toHaveValue(created.events![0].commonFields.reason!);
  await closeDetails(page);
  const validateReset = page.waitForResponse((response) => response.url().endsWith("/validate") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Проверить данные", exact: true }).click();
  const corrected = await (await validateReset).json();
  expect(corrected.issues.some((issue: { assignmentId?: string; field?: string }) => issue.assignmentId === bio.id && issue.field === "reason")).toBe(false);
  await record(page, "ux04-structural-field-focus", { requestId: created.id, targetId: target.id, stages: states, currentIds: afterReset.items.map((person) => person.id), reasonReset: { assignmentId: bio.id, origin: afterReset.items[0].assignments[0].fieldOrigins?.reason, displayedCommonValue: created.events![0].commonFields.reason, otherFieldsAndAssignmentsUnchanged: true, remainingIssues: corrected.issues } });
  await readinessAcceptance(page, headers);
});

test("UX14 independent facts remain separate and changed original context offers an explicit compatible return", async ({ page }) => {
  const headers = await login(page);
  const fixture = input(2, ["BIOT"]);
  fixture.events!.push({ ...structuredClone(fixture.events![0]), id: "accept-independent-same-title", commonFields: { ...dates, trainingSubject: "Независимая синтетическая программа" } });
  fixture.events!.push({ ...structuredClone(fixture.events![0]), id: "accept-independent-empty-fact", title: "Самостоятельное событие без участников", commonFields: { reason: "Самостоятельный синтетический факт без участников" } });
  const created = await create(page, headers, fixture);
  await page.goto(`/requests/${created.id}/edit`);
  const category = page.getByLabel("Категория сотрудника, строка 1", { exact: true });
  await savedChange(page, created.id, () => category.selectOption("ITR"));
  const derived = await read(page, created.id);
  const oldFact = derived.items[0].assignments[0];
  const derivedIndex = derived.events!.findIndex((event) => event.id === oldFact.eventId);
  const commonSettings = page.locator("details.operator-common-settings");
  if (!await commonSettings.evaluate((element) => (element as HTMLDetailsElement).open)) await commonSettings.locator(":scope > summary").click();
  await page.getByLabel("Обучение для общих данных и результатов", { exact: true }).selectOption(oldFact.eventId!);
  const preparation = page.locator(".training-primary-context .outcome-entry").filter({ has: page.locator(`[data-field-path="events.${derivedIndex}.outcomes"]`) });
  if (!await preparation.evaluate((element) => (element as HTMLDetailsElement).open)) await preparation.locator(":scope > summary").click();
  const preparationSource = preparation.getByLabel("Источник подтверждения", { exact: true });
  const unappliedSource = `СИНТЕТИЧЕСКАЯ неподтверждённая подготовка UX14 ${created.id}`;
  await preparationSource.fill(unappliedSource);
  await expect(preparation.locator(".preparation-status")).toContainText("сохранена в этом браузере, не применена");
  expect((await read(page, created.id)).items).toEqual(derived.items);
  const other = await page.context().newPage();
  let secondTabEdit: Record<string, unknown>;
  try {
    await other.goto(`/requests/${created.id}/edit`);
    const otherSettings = other.locator("details.operator-common-settings");
    if (!await otherSettings.evaluate((element) => (element as HTMLDetailsElement).open)) await otherSettings.locator(":scope > summary").click();
    await other.getByLabel("Обучение для общих данных и результатов", { exact: true }).selectOption(created.events![0].id);
    const commonProgram = other.locator('.training-primary-context [data-field-path="events.0.commonFields.trainingSubject"]');
    await expect(commonProgram).toHaveValue(derived.events![0].commonFields.trainingSubject!);
    await savedChange(other, created.id, async () => { await commonProgram.fill("Новая программа другой вкладки"); await commonProgram.press("Tab"); });
    const afterSecondTab = await read(other, created.id);
    expect(afterSecondTab.revision).toBeGreaterThan(derived.revision);
    const expectedEvents = structuredClone(derived.events);
    expectedEvents![0].commonFields.trainingSubject = "Новая программа другой вкладки";
    expectedEvents![0].commonFields.fieldOrigins = { ...expectedEvents![0].commonFields.fieldOrigins, trainingSubject: "MANUAL" };
    expectedEvents![0].revision = (derived.events![0].revision || 0) + 1;
    expect(afterSecondTab.events).toEqual(expectedEvents);
    expect(afterSecondTab.items).toEqual(derived.items);
    // No automatic reload or fake API writer: the first real page keeps its
    // event-owned, unapplied preparation while the other page saves a new base.
    await expect(category).toHaveValue("ITR");
    await expect(preparationSource).toHaveValue(unappliedSource);
    expect((await read(page, created.id)).items[0].assignments[0]).toEqual(oldFact);
    secondTabEdit = { actualSecondPage: true, fieldPath: "events.0.commonFields.trainingSubject", beforeRevision: derived.revision, afterRevision: afterSecondTab.revision, after: afterSecondTab, otherRawFieldsAssignmentsRecipientsAndConfirmationsUnchanged: true, firstPageUnappliedSource: unappliedSource, firstPagePreparationPreservedBeforeExplicitReload: true };
    await fs.mkdir(evidenceRoot, { recursive: true });
    await other.screenshot({ path: path.join(evidenceRoot, "ux14-second-tab-program-change.png"), fullPage: true });
  } finally {
    await other.close();
  }
  await page.reload();
  const reloadedSettings = page.locator("details.operator-common-settings");
  if (!await reloadedSettings.evaluate((element) => (element as HTMLDetailsElement).open)) await reloadedSettings.locator(":scope > summary").click();
  await page.getByLabel("Обучение для общих данных и результатов", { exact: true }).selectOption(oldFact.eventId!);
  const reloadedPreparation = page.locator(".training-primary-context .outcome-entry").filter({ has: page.locator(`[data-field-path="events.${derivedIndex}.outcomes"]`) });
  if (!await reloadedPreparation.evaluate((element) => (element as HTMLDetailsElement).open)) await reloadedPreparation.locator(":scope > summary").click();
  await expect(reloadedPreparation.getByLabel("Источник подтверждения", { exact: true })).toHaveValue(unappliedSource);
  await savedChange(page, created.id, () => category.selectOption("WORKER"));
  const refused = await read(page, created.id);
  expect(refused.items[0].assignments[0].eventId).toBe(oldFact.eventId);
  expect(refused.items[0].assignments[0].outcome).toEqual(oldFact.outcome);
  await page.getByRole("button", { name: "Проверить данные", exact: true }).click();
  await expect(page.locator(".review-issue-group")).toContainText("Исходная группа изменилась");
  await expect(category).toHaveAttribute("aria-invalid", "true");
  const validate = await page.request.post(`/api/print-requests/${created.id}/validate`, { headers, data: { expectedRevision: refused.revision } });
  expect(validate.ok(), await validate.text()).toBe(true);
  const issue = (await validate.json()).issues.find((entry: { code: string }) => entry.code === "CATEGORY_LINEAGE_CONFLICT");
  expect(issue).toMatchObject({ recipientId: created.items[0].id, eventId: oldFact.eventId, assignmentId: oldFact.id, field: "employeeCategory" });
  await record(page, "ux14-return-refused", { requestId: created.id, original: created, derived, secondTabEdit, refused, issue });
  // Keeping the compatible ITR category preserves the old confirmed facts
  // and leaves the changed worker event independent for its other member.
  await savedChange(page, created.id, () => category.selectOption("ITR"));
  const compatible = await read(page, created.id);
  expect(compatible.items[0].employeeCategory).toBe("ITR");
  expect(compatible.items[0].assignments[0]).toEqual(oldFact);
  expect(compatible.events!.find((event) => event.id === created.events![1].id)).toEqual(created.events![1]);
  expect(compatible.events!.find((event) => event.id === created.events![2].id)).toEqual(created.events![2]);
  expect(compatible.events!.find((event) => event.id === created.events![0].id)!.commonFields.trainingSubject).toBe("Новая программа другой вкладки");
  await page.reload();
  expect((await read(page, created.id)).items[0].assignments[0]).toEqual(oldFact);
  await record(page, "ux14-compatible-facts", { requestId: created.id, compatible });
});

async function showField(form: Locator, key: string) {
  const field = form.locator(`[data-field-path$=".${key}"]`).first();
  if (!await field.count()) return undefined;
  const section = await field.evaluate((element) => element.closest("[data-assignment-section]")?.getAttribute("data-assignment-section"));
  const labels: Record<string, string> = { main: "Основное", training: "Обучение и результат", settings: "Настройки" };
  if (section && labels[section]) await form.getByRole("tab", { name: labels[section], exact: true }).click();
  await field.evaluate((element) => { let ancestor = element.parentElement; while (ancestor) { if (ancestor instanceof HTMLDetailsElement) ancestor.open = true; ancestor = ancestor.parentElement; } });
  return field;
}

test("UX15 reset every offered training field from credential protocol and witness displays current common values after reload", async ({ page }) => {
  // Three real form entry points, each with a measured 60s empty window before
  // its reset burst and after eight fields, need up to six minutes of pacing.
  test.setTimeout(600000);
  const headers = await login(page);
  const apiBudget = observeDomainApiBudget(page);
  try {
  const fixture = input(1, ["BIOT", "PS"], true);
  fixture.englishAppendix = true;
  fixture.items[0].fullNameEn = "Synthetic Participant";
  fixture.items[0].positionEn = "Synthetic engineer";
  fixture.items[0].workplaceEn = "Test Alpha";
  const extraKeys = ["trainingSubjectEn", "reasonEn", "education", "educationEn", "biotIndustryRu", "biotIndustryKz", "biotIndustryEn"] as const;
  const commonExtra = { trainingSubjectEn: "Shared synthetic programme", reasonEn: "Shared synthetic reason", education: "Общая синтетическая подготовка", educationEn: "Shared synthetic education", biotIndustryRu: "Общая синтетическая отрасль", biotIndustryKz: "Ортақ синтетикалық сала", biotIndustryEn: "Shared synthetic industry" };
  const personalExtra = { trainingSubjectEn: "Personal synthetic programme", reasonEn: "Personal synthetic reason", education: "Индивидуальная синтетическая подготовка", educationEn: "Personal synthetic education", biotIndustryRu: "Индивидуальная синтетическая отрасль", biotIndustryKz: "Жеке синтетикалық сала", biotIndustryEn: "Personal synthetic industry" };
  for (const assignment of fixture.items[0].assignments) {
    assignment.fieldOrigins = Object.fromEntries([...originKeys, ...extraKeys].map((key, index) => [key, index % 3 === 0 ? "MANUAL" : index % 3 === 1 ? "IMPORTED" : "CLEARED"]));
    Object.assign(assignment, { documentDate: "2026-09-29", trainingStart: "2026-09-01", trainingEnd: "", protocolDate: "2026-09-29", trainingSubject: "Ручная программа", hours: "99", productionHours: "99", reason: "Ручная причина" }, personalExtra);
    assignment.externalBasisNumber = `INDEPENDENT-${assignment.id}`;
    assignment.fieldOrigins.externalBasisNumber = "IMPORTED";
  }
  for (const event of fixture.events!) Object.assign(event.commonFields, commonExtra, { externalBasisNumber: "COMMON-BASIS" });
  const created = await create(page, headers, fixture);
  let current = created;
  const identities = created.items[0].assignments.map((assignment) => ({ id: assignment.id, templateId: assignment.templateId, outcome: assignment.outcome }));
  const proofs = [];
  const pacing: unknown[] = [];
  // Existing UI and template policy omit EN controls. Preserve those legacy
  // facts while exercising every reset the current RU/KZ form actually offers.
  const hiddenLanguageKeys = extraKeys.filter((key) => key.endsWith("En"));
  const hiddenLanguageFacts = (draft: Draft) => draft.items[0].assignments.map((assignment) => ({
    id: assignment.id,
    fields: Object.fromEntries(hiddenLanguageKeys.map((key) => [key, {
      value: assignment[key], origin: assignment.fieldOrigins?.[key],
    }])),
  }));
  const assessmentFacts = (draft: Draft) => draft.items[0].assignments.map((assignment) => ({
    id: assignment.id, outcome: assignment.outcome,
    fields: Object.fromEntries((["result", "resultKz", "resultEn"] as const).map((key) => [key, {
      value: assignment[key], origin: assignment.fieldOrigins?.[key],
    }])),
  }));
  async function pauseResetBurst(stage: string) {
    await closeDetails(page);
    const before = await read(page, created.id);
    const precedingBudget = apiBudget.snapshot();
    await measuredApiCooldown(page, stage, "domain-api-pacing", precedingBudget);
    apiBudget.reset();
    await page.goto(`/requests/${created.id}/edit`);
    const after = await read(page, created.id);
    expect(after.items).toEqual(before.items);
    expect(after.events).toEqual(before.events);
    expect(after.revision).toBe(before.revision);
    pacing.push({ stage, requestId: created.id, precedingBudget, savedRevisionBefore: before.revision, savedRevisionAfter: after.revision, itemsEventsAndRevisionUnchanged: true });
  }
  for (const selectedTemplate of ["biot-worker-card", "biot-protocol", "ps-witness"]) {
    await pauseResetBurst(`ux15-${selectedTemplate}-before-form`);
    const selected = current.items[0].assignments.find((assignment) => assignment.templateId === selectedTemplate)!;
    const independentDirection = structuredClone(current.items[0].assignments.filter((assignment) => assignment.eventId !== selected.eventId));
    // Each entry point receives fresh explicit training exceptions, allowing
    // the same reset contract to be exercised from all three actual forms.
    for (const assignment of current.items[0].assignments.filter((entry) => entry.eventId === selected.eventId)) {
      assignment.fieldOrigins = { ...assignment.fieldOrigins, ...Object.fromEntries([...originKeys, ...extraKeys].map((key) => [key, "MANUAL"])) };
      Object.assign(assignment, { documentDate: "2026-09-29", trainingStart: "2026-09-01", trainingEnd: "2026-09-29", protocolDate: "2026-09-29", trainingSubject: "Ручная программа", hours: "99", productionHours: "99", reason: "Ручная причина" }, personalExtra);
      if (assignment.templateId.startsWith("biot-")) {
        assignment.biotCategory = "WORKER";
        assignment.biotCheckType = "REPEAT";
        assignment.fieldOrigins = { ...assignment.fieldOrigins, biotCategory: "IMPORTED", biotCheckType: "MANUAL" };
      }
    }
    await patch(page, headers, current);
    const beforeResets = await read(page, created.id);
    const hiddenBeforeResets = hiddenLanguageFacts(beforeResets);
    const assessmentsBeforeResets = assessmentFacts(beforeResets);
    await page.goto(`/requests/${created.id}/edit`);
    async function openResetForm() {
      await page.getByRole("button", { name: "Детали получателя 1", exact: true }).click();
      const modal = page.getByRole("dialog", { name: "Настройки строки 1", exact: true });
      const selectedForm = modal.locator(`details[data-assignment-id="${selected.id}"]`);
      if (!await selectedForm.evaluate((element) => (element as HTMLDetailsElement).open)) await selectedForm.locator(":scope > summary").click();
      await selectedForm.getByRole("tab", { name: "Настройки", exact: true }).click();
      await selectedForm.getByText("Источники общих значений", { exact: true }).click();
      return selectedForm;
    }
    let form = await openResetForm();
    if (selectedTemplate === "biot-protocol") {
      const resultSource = form.locator(".field-provenance dl > div").filter({ has: page.locator("dt", { hasText: /^result$/ }) });
      await expect(resultSource).toContainText("Введено вручную");
      await expect(resultSource.getByRole("button", { name: "Вернуть общее значение", exact: true })).toHaveCount(0);
      const resultInput = await showField(form, "result");
      expect(resultInput, "The individual assessment remains directly editable").toBeDefined();
      await expect(resultInput!).toBeEnabled();
      await expect(resultInput!).toHaveValue(selected.result || "");
      await form.getByRole("tab", { name: "Настройки", exact: true }).click();
    }
    const labels: Record<string, string> = { documentDate: "Дата документа", trainingStart: "Начало обучения", trainingEnd: "Окончание обучения", protocolDate: "Дата протокола", trainingSubject: "Программа", trainingSubjectEn: "Программа · EN", hours: "Часы", productionHours: "Производственные часы", reason: "Причина", reasonEn: "Причина · EN", education: "Образование", educationEn: "Образование · EN", biotIndustryRu: "biotIndustryRu", biotIndustryKz: "biotIndustryKz", biotIndustryEn: "biotIndustryEn", biotCategory: "Категория", biotCheckType: "Вид проверки" };
    const resetKeys = [...originKeys, ...extraKeys, ...(selectedTemplate.startsWith("biot-") ? ["biotCategory", "biotCheckType"] as const : [])].filter((key) => !key.endsWith("En"));
    for (const [resetIndex, key] of resetKeys.entries()) {
      // The fixed midpoint bounds the fast UI burst even when individual
      // saves generate several refresh requests. The measured budget also
      // creates an earlier empty window if future UI request counts grow.
      if (resetIndex === 8 || apiBudget.snapshot().total >= 200) {
        await pauseResetBurst(`ux15-${selectedTemplate}-before-field-${resetIndex}-${key}`);
        form = await openResetForm();
      }
      const row = form.locator(".field-provenance dl > div").filter({ has: page.locator("dt", { hasText: new RegExp(`^${labels[key]}$`) }) });
      const reset = row.getByRole("button", { name: "Вернуть общее значение", exact: true });
      // Resetting protocolDate also resets its displayed documentDate; the
      // latter control therefore ceases to offer a second redundant reset.
      if (!await reset.count()) { expect(selectedTemplate.endsWith("-protocol") && key === "protocolDate", `Missing offered reset: ${selectedTemplate}.${key}`).toBe(true); continue; }
      await savedChange(page, created.id, () => reset.click());
      expect((await read(page, created.id)).items[0].assignments.find((assignment) => assignment.id === selected.id)!.fieldOrigins?.[selectedTemplate.endsWith("-protocol") && key === "documentDate" ? "protocolDate" : key]).toBe("INHERITED");
    }
    {
      const independentBasis = current.items[0].assignments.filter((assignment) => assignment.id !== selected.id).map((assignment) => ({ id: assignment.id, value: assignment.externalBasisNumber, origin: assignment.fieldOrigins?.externalBasisNumber }));
      const basisRow = form.locator(".field-provenance dl > div").filter({ has: page.locator("dt", { hasText: /^Внешний номер основания$/ }) });
      await savedChange(page, created.id, () => basisRow.getByRole("button", { name: "Вернуть общее значение", exact: true }).click());
      expect((await read(page, created.id)).items[0].assignments.find((assignment) => assignment.id === selected.id)!.fieldOrigins?.externalBasisNumber).toBe("INHERITED");
      const afterBasis = (await read(page, created.id)).items[0].assignments.filter((assignment) => assignment.id !== selected.id).map((assignment) => ({ id: assignment.id, value: assignment.externalBasisNumber, origin: assignment.fieldOrigins?.externalBasisNumber }));
      expect(afterBasis).toEqual(independentBasis);
    }
    // Every reset offered by this actual form has been exercised; a newly
    // offered field cannot silently fall outside the acceptance coverage.
    await expect(form.locator(".field-provenance").getByRole("button", { name: "Вернуть общее значение", exact: true })).toHaveCount(0);
    await closeDetails(page);
    await saved(page);
    current = await read(page, created.id);
    expect(hiddenLanguageFacts(current)).toEqual(hiddenBeforeResets);
    expect(assessmentFacts(current)).toEqual(assessmentsBeforeResets);
    expect(current.items[0].assignments.filter((assignment) => assignment.eventId !== selected.eventId)).toEqual(independentDirection);
    const event = current.events!.find((entry) => entry.id === selected.eventId)!;
    event.commonFields.trainingSubject = `Новая общая программа после reset ${selectedTemplate}`;
    current = await patch(page, headers, current);
    await page.reload();
    noteExplicitDomainApiRequest(page, "GET", `/api/print-requests/${created.id}/resolved`);
    const resolvedResponse = await page.request.get(`/api/print-requests/${created.id}/resolved`);
    expect(resolvedResponse.ok(), await resolvedResponse.text()).toBe(true);
    const resolved = (await resolvedResponse.json()).draft as Draft;
    await page.getByRole("button", { name: "Детали получателя 1", exact: true }).click();
    const displays = [];
    for (const linked of current.items[0].assignments.filter((assignment) => assignment.eventId === selected.eventId)) {
      const linkedForm = page.getByRole("dialog").locator(`details[data-assignment-id="${linked.id}"]`);
      if (!await linkedForm.evaluate((element) => (element as HTMLDetailsElement).open)) await linkedForm.locator(":scope > summary").click();
      const effective = resolved.items[0].assignments.find((assignment) => assignment.id === linked.id)!;
      for (const key of [...resetKeys, "externalBasisNumber" as const]) {
        const control = await showField(linkedForm, key);
        if (control) { await expect(control).toHaveValue(effective[key] || ""); displays.push({ assignmentId: linked.id, key, displayed: await control.inputValue(), resolved: effective[key] }); }
      }
      expect(effective.trainingSubject).toBe(event.commonFields.trainingSubject);
      expect(linked.outcome).toEqual(identities.find((entry) => entry.id === linked.id)!.outcome);
    }
    expect(assessmentFacts(current)).toEqual(assessmentsBeforeResets);
    proofs.push({ selectedTemplate, selectedId: selected.id, assignments: current.items[0].assignments, displays, hiddenLanguageFactsPreserved: hiddenBeforeResets, individualAssessmentFactsPreserved: assessmentsBeforeResets });
    await closeDetails(page);
  }
  expect(current.items[0].assignments.map((assignment) => ({ id: assignment.id, templateId: assignment.templateId, outcome: assignment.outcome }))).toEqual(identities);
  await record(page, "ux15-all-form-reset", { requestId: created.id, identities, proofs, pacing, finalApiBudget: apiBudget.snapshot(), unchangedProductRateLimitPerMinute: 600 });
  } finally {
    apiBudget.stop();
  }
});

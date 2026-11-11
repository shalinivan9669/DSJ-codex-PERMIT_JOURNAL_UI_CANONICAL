import { test, expect } from "@playwright/test";

test("director prepares and signs the selected approval directly in the cabinet", async ({
  page,
}, testInfo) => {
  const proposalId = "11111111-1111-4111-8111-111111111111";
  const issuanceId = "22222222-2222-4222-8222-222222222222";
  let approved = false,
    prepared = false,
    signed = false,
    failNextPrepare = true;
  const commands: { body: unknown; key: string | undefined }[] = [];
  const signingQueries: string[] = [];
  const assignments = [{ rowId: "worker-1", assignmentId: "ptm" }];
  const proposal = () => ({
    id: proposalId,
    requestId: "director-release",
    status: approved ? "APPROVED" : "PENDING",
    requestedAction: "SAVE",
    requestRevision: 3,
    currentRevision: 4,
    proposalHash: "a".repeat(64),
    submittedAt: "2026-11-10T10:00:00Z",
    author: { displayName: "Тестовый оператор" },
    title: "Синтетическая заявка",
    request: { title: "Синтетическая заявка" },
    assignments,
    issuance: prepared
      ? { id: issuanceId, createdAt: "2026-11-10T11:00:00Z" }
      : null,
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname.slice(4);
    let result: unknown = { items: [], total: 0 };
    if (path === "/auth/session")
      result = {
        csrfToken: "synthetic",
        user: { id: "director", role: "DIRECTOR" },
      };
    else if (path === "/context")
      result = {
        user: {
          id: "director",
          role: "DIRECTOR",
          displayName: "Тестовый директор",
          email: "director@example.invalid",
        },
        tenant: {
          id: "synthetic",
          name: "Синтетический центр",
          timezone: "Asia/Qyzylorda",
          demoOnly: true,
        },
        profile: {
          nameRu: "Синтетический центр",
          approved: true,
          commission: [],
        },
        templates: [],
        numbering: {},
      };
    else if (path === "/approvals") result = { items: [proposal()], total: 1 };
    else if (path === `/approvals/${proposalId}`) result = proposal();
    else if (path === `/approvals/${proposalId}/decision`) {
      approved = true;
      result = proposal();
    } else if (path === "/print-requests/director-release/finalize") {
      commands.push({
        body: request.postDataJSON(),
        key: request.headers()["idempotency-key"],
      });
      if (failNextPrepare) {
        failNextPrepare = false;
        await route.fulfill({
          status: 503,
          json: { message: "Временный отказ. Повторите подготовку." },
        });
        return;
      }
      prepared = true;
      result = { issuanceId };
    } else if (path === "/print-requests/director-release/signing") {
      signingQueries.push(url.searchParams.get("issuanceId") || "");
      result = {
        issuanceId,
        status: signed ? "ISSUED" : "AWAITING_SIGNATURE",
        archived: false,
        providers: {
          EGOV_QR: { available: true },
          NCALAYER: { available: false },
        },
        missingBindings: [],
        documents: [
          {
            documentId: "document",
            templateId: "ptm-card",
            rowId: "worker-1",
            number: "ТЕСТ-001",
            artifactId: "selected-original-pdf",
            complete: signed,
            requiredSigners: [
              {
                kind: "DIRECTOR",
                displayName: "Тестовый директор",
                canSign: !signed,
                signed,
              },
            ],
          },
        ],
      };
    } else if (path === "/print-requests/director-release/signing/start") {
      expect(request.postDataJSON()).toEqual({
        artifactId: "selected-original-pdf",
        provider: "EGOV_QR",
      });
      result = { id: "synthetic-session", provider: "EGOV_QR" };
    } else if (path === "/signing/synthetic-session/complete") {
      signed = true;
      result = { status: "ISSUED" };
    }
    await route.fulfill({ json: result });
  });
  await page.goto(`/approvals?proposal=${proposalId}`);
  await page
    .getByRole("button", { name: "Согласовать эту редакцию", exact: true })
    .click();
  const section = page.getByRole("region", {
    name: "Подписание и выпуск согласованной редакции",
  });
  await expect(section).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Состояние", exact: true }),
  ).toHaveValue("APPROVED");
  const prepare = section.getByRole("button", {
    name: "Подготовить к подписанию",
    exact: true,
  });
  await prepare.click();
  await expect(
    page.getByText("Временный отказ. Повторите подготовку."),
  ).toBeVisible();
  await prepare.click();
  await expect(prepare).toHaveCount(0);
  expect(commands).toHaveLength(2);
  expect(commands[0]).toEqual(commands[1]);
  expect(commands[0].body).toEqual({
    expectedRevision: 4,
    assignments,
    expectedProposalId: proposalId,
  });
  expect(commands[0].key).toBeTruthy();
  expect(signingQueries.every((id) => id === issuanceId)).toBe(true);
  const panel = section.locator(".signing-panel");
  await expect(panel).toBeVisible();
  await panel
    .getByRole("button", { name: "Подписать через eGov Mobile", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Проверить подпись", exact: true })
    .click();
  await expect(panel).toContainText("Выпуск оформлен");
  await expect(page).toHaveURL(
    new RegExp(`/approvals\\?proposal=${proposalId}$`),
  );
  await expect(
    section.getByRole("link", { name: "Документы и печать", exact: true }),
  ).toHaveAttribute("href", "/requests/director-release#request-files");
  await page.screenshot({
    path: testInfo.outputPath("director-release-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("director-release-mobile.png"),
    fullPage: true,
  });
});

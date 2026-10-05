import { test, expect } from "@playwright/test";
import { resolveDraft } from "@demo/contracts";
import { newRecipient, type Draft } from "../lib/types";

test("a working request exposes earlier immutable signing stages and every signing action uses the selected original", async ({
  page,
}, testInfo) => {
  const earlier = "11111111-1111-4111-8111-111111111111";
  const latest = "22222222-2222-4222-8222-222222222222";
  const draft: Draft = {
    id: "signing-stages",
    revision: 4,
    status: "DRAFT",
    kind: "PERSON",
    schemaVersion: 2,
    demoMode: true,
    customerId: null,
    title: "Синтетическая заявка: две оформленные партии и ожидание",
    commonFields: {},
    items: [
      {
        ...newRecipient(),
        fullNameRu: "Синтетический ожидающий",
        assignments: [],
      },
    ],
    issuances: [
      { id: earlier, sourceRevision: 1, createdAt: "2026-10-01T10:00:00Z" },
      { id: latest, sourceRevision: 3, createdAt: "2026-10-03T11:00:00Z" },
    ],
  };
  let signedEarlier = false;
  let blockSave = false;
  let pendingPatch = false;
  let releaseSave: (() => void) | undefined;
  let requestReads = 0;
  const selectedQueries: string[] = [];
  const startArtifacts: string[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.slice(4);
    let result: unknown = { items: [], total: 0 };
    if (path === "/auth/session")
      result = {
        csrfToken: "synthetic",
        user: { id: "operator", role: "OPERATOR" },
      };
    else if (path === "/context")
      result = {
        user: {
          id: "operator",
          role: "OPERATOR",
          displayName: "Тестовый подписант",
          email: "test@example.invalid",
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
    else if (path === `/print-requests/${draft.id}`) {
      if (request.method() === "PATCH") {
        if (blockSave) {
          pendingPatch = true;
          await new Promise<void>((resolve) => {
            releaseSave = resolve;
          });
        }
        Object.assign(draft, request.postDataJSON().draft, {
          revision: draft.revision + 1,
        });
        result = { revision: draft.revision };
      } else {
        requestReads++;
        result = structuredClone(draft);
      }
    } else if (path === `/print-requests/${draft.id}/resolved`)
      result = resolveDraft(draft);
    else if (path === `/print-requests/${draft.id}/signing`) {
      const issuanceId = url.searchParams.get("issuanceId") || latest;
      selectedQueries.push(issuanceId);
      const complete = issuanceId === earlier && signedEarlier;
      result = {
        issuanceId,
        status: complete ? "ISSUED" : "AWAITING_SIGNATURE",
        archived: false,
        providers: {
          EGOV_QR: { available: true },
          NCALAYER: { available: false, reason: "Синтетическая проверка UI" },
        },
        missingBindings: [],
        documents: [
          {
            documentId: `${issuanceId}-document`,
            templateId: "ptm-card",
            rowId: "issued-person",
            number: issuanceId === earlier ? "ПТМ-001" : "ПТМ-002",
            artifactId:
              issuanceId === earlier
                ? "earlier-original-pdf"
                : "latest-original-pdf",
            complete,
            requiredSigners: [
              {
                kind: "DIRECTOR",
                displayName: "Синтетический подписант",
                canSign: true,
                signed: complete,
              },
            ],
          },
        ],
      };
    } else if (path === `/print-requests/${draft.id}/signing/start`) {
      const body = request.postDataJSON();
      startArtifacts.push(body.artifactId);
      expect(body).toEqual({
        artifactId: "earlier-original-pdf",
        provider: "EGOV_QR",
      });
      result = { id: "synthetic-earlier-session", provider: "EGOV_QR" };
    } else if (path === "/signing/synthetic-earlier-session/complete") {
      signedEarlier = true;
      result = { status: "ISSUED", archived: false };
    }
    await route.fulfill({ json: result });
  });
  await page.goto(`/requests/${draft.id}/edit`);
  const details = page
    .locator("details")
    .filter({ has: page.getByText("Электронные подписи", { exact: true }) });
  await details.locator(":scope > summary").click();
  const panel = page.locator(".signing-panel");
  const choice = panel.getByRole("combobox", {
    name: "Выпуск для подписания",
    exact: true,
  });
  await expect(choice).toHaveValue(latest);
  await expect(panel.getByRole("heading", { name: /ПТМ-002/ })).toBeVisible();
  await choice.selectOption(earlier);
  await expect(panel.getByRole("heading", { name: /ПТМ-001/ })).toBeVisible();
  await expect(panel.getByRole("heading", { name: /ПТМ-002/ })).toHaveCount(0);
  await panel.getByRole("button", { name: "Обновить", exact: true }).click();
  await expect.poll(() => selectedQueries.at(-1)).toBe(earlier);
  blockSave = true;
  const updatedName = "Синтетический ожидающий — сохранённое продолжение";
  const waitingName = page.getByLabel("ФИО", { exact: true });
  await waitingName.fill(updatedName);
  await expect.poll(() => pendingPatch).toBe(true);
  const readsBeforeSigning = requestReads;
  await panel
    .getByRole("button", { name: "Подписать через eGov Mobile", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Подпись через eGov Mobile",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(choice).toBeDisabled();
  await dialog
    .getByRole("button", { name: "Проверить подпись", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(panel).toContainText(
    "Все необходимые подписи этого выпуска проверены. Заявка остаётся доступной",
  );
  await expect(panel).not.toContainText("помещён в архив");
  await expect(choice).toHaveValue(earlier);
  await expect(waitingName).toHaveValue(updatedName);
  expect(draft.items[0].fullNameRu).toBe("Синтетический ожидающий");
  expect(requestReads).toBe(readsBeforeSigning);
  expect(releaseSave).toBeDefined();
  blockSave = false;
  releaseSave!();
  await expect.poll(() => draft.items[0].fullNameRu).toBe(updatedName);
  await expect.poll(() => requestReads).toBeGreaterThan(readsBeforeSigning);
  await expect(waitingName).toHaveValue(updatedName);
  expect(startArtifacts).toEqual(["earlier-original-pdf"]);
  expect(draft.status).toBe("DRAFT");
  await page.screenshot({
    path: testInfo.outputPath("earlier-stage-signed-request-still-working.png"),
    fullPage: true,
  });
  await choice.selectOption(latest);
  await expect(panel.getByRole("heading", { name: /ПТМ-002/ })).toBeVisible();
  await expect(
    panel.getByRole("button", {
      name: "Подписать через eGov Mobile",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(panel.getByRole("heading", { name: /ПТМ-001/ })).toHaveCount(0);
});

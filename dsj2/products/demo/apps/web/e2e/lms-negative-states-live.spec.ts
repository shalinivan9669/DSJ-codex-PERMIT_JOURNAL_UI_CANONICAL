import { test, expect, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { measureLmsActions } from "./lms-action-measurement";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Электронная почта", { exact: true }).fill(email);
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("Synthetic-LMS-only-20261015!");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test("prepared negative results and unknown delivery remain human-readable and fail closed without blind retries", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(360000);
  const root = path.resolve(__dirname, "../../..");
  const evidence = process.env.DEMO_E2E_EVIDENCE
    ? path.join(process.env.DEMO_E2E_EVIDENCE, "lms-negative-states-live")
    : testInfo.outputDir;
  await fs.mkdir(evidence, { recursive: true });
  await promisify(execFile)(
    process.execPath,
    [
      path.join(root, "node_modules/tsx/dist/cli.mjs"),
      "--tsconfig",
      "apps/api/tsconfig.json",
      "scripts/verification/lms-negative-fixture.ts",
    ],
    { cwd: root, env: process.env, windowsHide: true, timeout: 300000 },
  );
  const fixture = JSON.parse(
    await fs.readFile(
      path.join(root, ".runtime/lms-one-run/negative-fixture.json"),
      "utf8",
    ),
  );
  await fs.writeFile(
    path.join(evidence, "fixture.json"),
    JSON.stringify(fixture, null, 2),
  );
  await login(page, fixture.director);
  const measurements: unknown[] = [];
  const negative = measureLmsActions(
    page,
    "Г: inspect ineligible results without creating official documents",
    "DIRECTOR",
    "Authenticated director opens results with prepared negative scenarios",
    [
      fixture.boundary,
      `Fixture setup ${fixture.setupMilliseconds} ms is separate from operator actions.`,
    ],
  );
  await negative.action("navigate", "Открыть результаты", () =>
    page.goto("/lms/results"),
  );
  for (const kind of [
    "PRACTICE",
    "FAILED",
    "AUTO",
    "UNVERIFIED",
    "NEEDS_LEGAL_REVIEW",
  ]) {
    const item = fixture.cases.find(
      (value: { kind: string }) => value.kind === kind,
    );
    const row = page.getByRole("row").filter({ hasText: item.name });
    await expect(row).toBeVisible();
    await expect(row.getByRole("checkbox")).toHaveCount(0);
    if (kind === "PRACTICE")
      await expect(
        row.getByText("Учебный тест", { exact: true }),
      ).toBeVisible();
    if (kind === "FAILED")
      await expect(row.getByText("Не сдано", { exact: true })).toBeVisible();
    const detail = await (
      await page.request.get(`/api/lms/enrollments/${item.enrollmentId}`)
    ).json();
    expect(detail.documents).toEqual([]);
    if (["AUTO", "UNVERIFIED", "NEEDS_LEGAL_REVIEW"].includes(kind))
      expect(detail.results).toEqual([]);
    else expect(detail.results[0].eligible).toBe(false);
  }
  const unverified = fixture.cases.find(
    (value: { kind: string }) => value.kind === "UNVERIFIED",
  );
  await negative.action("click", "Открыть непроверенное основание", () =>
    page.getByRole("button", { name: unverified.name, exact: true }).click(),
  );
  await expect(page.getByText("Не проверено", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Подтвердить проверку", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: path.join(evidence, "01-ineligible-and-unverified.png"),
    fullPage: true,
  });
  measurements.push(
    negative.finish({
      practiceEligible: false,
      failedEligible: false,
      autoResultCount: 0,
      unverifiedResultCount: 0,
      needsReviewResultCount: 0,
      officialSelectionForAllFive: false,
      unverifiedNextStep: "Проверить источник и заполнить способ проверки",
    }),
  );

  const signature = measureLmsActions(
    page,
    "Г: inspect mandatory electronic signature",
    "DIRECTOR",
    "Prepared result list is open; source has real approved/rendered documents",
    [
      "Electronic original requires DIRECTOR signature; no signer service or synthetic signature is provided.",
    ],
  );
  await signature.action("click", "Закрыть основание", () =>
    page.getByRole("button", { name: "Закрыть", exact: true }).click(),
  );
  const signed = fixture.cases.find(
    (value: { kind: string }) => value.kind === "SIGNATURE",
  );
  await signature.action(
    "click",
    "Посмотреть документ с обязательной подписью",
    () => page.getByRole("button", { name: signed.name, exact: true }).click(),
  );
  await expect(
    page.getByText("Ожидает подписи", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Электронный оригинал", { exact: true }).last(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Подтвердить бумажные подписи/ }),
  ).toHaveCount(0);
  const document = await (
    await page.request.get(`/api/lms/documents/${fixture.signature.documentId}`)
  ).json();
  expect(document.status).toBe("AWAITING_SIGNATURE");
  await signature.action(
    "click",
    "Открыть комплект для подписания",
    () =>
      page
        .getByRole("row")
        .filter({ hasText: signed.name })
        .getByRole("link", { name: "Посмотреть", exact: true })
        .click(),
    { navigation: true },
  );
  await signature.action("click", "Посмотреть электронные подписи", () =>
    page.locator("summary").filter({ hasText: "Электронные подписи" }).click(),
  );
  await expect(
    page.getByText(
      "eGov Mobile: Не подключены официальный eGov Mobile QR и сервер проверки ЭЦП",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText("NCALayer: Не подключён сервер проверки ЭЦП НУЦ РК", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("button", { name: /Подписать через/ })
      .and(page.locator(":enabled")),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Реестр XLSX", exact: true }),
  ).toBeDisabled();
  await expect(
    page
      .locator("summary")
      .filter({ hasText: "Ссылка и QR для проверки записи" }),
  ).toHaveCount(0);
  const signedRequest = await (
    await page.request.get(`/api/print-requests/${document.link.requestId}`)
  ).json();
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "demo_csrf",
  )!.value;
  const unsignedPublication = await page.request.post(
    "/api/verification-links",
    {
      headers: { origin: process.env.DEMO_ORIGIN!, "x-csrf-token": csrf },
      data: {
        documentId: signedRequest.documents[0].id,
        publicationConfirmed: true,
      },
    },
  );
  expect(unsignedPublication.status()).toBe(409);
  expect((await unsignedPublication.json()).code).toBe("ISSUANCE_NOT_COMPLETE");
  await page.screenshot({
    path: path.join(evidence, "02-mandatory-signature.png"),
    fullPage: true,
  });
  measurements.push(
    signature.finish({
      status: document.status,
      legalForm: document.link.legalForm,
      issued: false,
      signatureInvented: false,
      enabledSignActions: 0,
      officialRegistryDisabled: true,
      publicationControlsUnavailable: true,
      unsignedPublicationDenied: unsignedPublication.status(),
      reason:
        "Подключение и проверка ЭЦП не настроены; требуется настройка подписантов директором",
    }),
  );

  const restricted = fixture.cases.find(
    (value: { kind: string }) => value.kind === "NEEDS_LEGAL_REVIEW",
  );
  const learnerContext = await browser.newContext();
  const learner = await learnerContext.newPage();
  await login(learner, restricted.email);
  const route = measureLmsActions(
    learner,
    "Г: unconfirmed exam route",
    "LEARNER",
    "Authenticated learner opens assigned course with all required learning already satisfied",
    [
      "Published immutable course; NEEDS_LEGAL_REVIEW profile; no raw state changes.",
    ],
  );
  await route.action("navigate", "Открыть курс", () =>
    learner.goto(`/learn/${restricted.enrollmentId}`),
  );
  const refused = learner.waitForResponse(
    (response) =>
      response
        .url()
        .endsWith(`/learn/enrollments/${restricted.enrollmentId}/attempts`) &&
      response.request().method() === "POST",
  );
  await route.action(
    "click",
    "Начать экзамен",
    () =>
      learner
        .getByRole("button", { name: "Начать экзамен", exact: true })
        .click(),
    { decision: true },
  );
  expect((await refused).status()).toBe(409);
  await expect(
    learner.getByText("Маршрут экзамена требует проверки учебным центром.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(learner.locator("body")).not.toContainText(
    "ROUTE_REVIEW_REQUIRED",
  );
  await learner.screenshot({
    path: path.join(evidence, "03-route-review-blocked.png"),
    fullPage: true,
  });
  measurements.push(
    route.finish({
      blocked: true,
      httpStatus: 409,
      nextStep: "Маршрут экзамена требует проверки учебным центром",
    }),
  );
  await learnerContext.close();

  const uncertain = measureLmsActions(
    page,
    "Ж: inspect unknown delivery without blind resend",
    "DIRECTOR",
    "Authenticated director opens sanitary list after a real guarded test-adapter timeout",
    [
      fixture.boundary,
      "One adapter submit threw after possible receipt; no further worker delivery runs before this measurement.",
    ],
  );
  const writes: string[] = [];
  const track = (request: import("@playwright/test").Request) => {
    if (request.method() === "POST" && request.url().includes("/lms/sanitary"))
      writes.push(request.url());
  };
  page.on("request", track);
  await uncertain.action("navigate", "Открыть санитарное обучение", () =>
    page.goto("/lms/sanitary"),
  );
  const batch = page.getByRole("region", {
    name: "Санитарный журнал",
    exact: true,
  });
  await expect(
    batch.getByText("Исход требует проверки", { exact: true }),
  ).toBeVisible();
  await uncertain.action("click", "Открыть список с неизвестным исходом", () =>
    batch.getByRole("button").first().click(),
  );
  await expect(
    page.getByText(
      "Ответ не получен. Проверьте приём у получателя перед повторной передачей.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText("OUTCOME_UNKNOWN");
  await expect(page.locator("body")).not.toContainText("private diagnostic");
  await expect(
    page.getByRole("button", {
      name: /Отправить|Повторить передачу|Отправить повторно/,
    }),
  ).toHaveCount(0);
  await expect(page.getByText("Принято системой", { exact: true })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: path.join(evidence, "04-unknown-safe-inspection.png"),
    fullPage: true,
  });
  const detail = await (
    await page.request.get(`/api/lms/sanitary/${fixture.unknown.batchId}`)
  ).json();
  expect(detail.items[0].delivery.state).toBe("UNKNOWN");
  expect(detail.deliveryCounts.accepted).toBe(0);
  expect(writes).toEqual([]);
  page.off("request", track);
  measurements.push(
    uncertain.finish({
      deliveryState: detail.items[0].delivery.state,
      accepted: detail.deliveryCounts.accepted,
      adapterSubmits: fixture.unknown.submits,
      sanitaryWrites: writes,
      blindResendAvailable: false,
      greenSuccessClaim: false,
    }),
  );
  await page.getByRole("button", { name: "KZ", exact: true }).click();
  await page.setViewportSize({ width: 360, height: 900 });
  await expect(
    page.getByText(
      "Жауап алынбады. Қайта жібермес бұрын алушының қабылдағанын тексеріңіз.",
      { exact: true },
    ),
  ).toBeVisible();
  const unknownMobileWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  expect(unknownMobileWidth).toBeLessThanOrEqual(361);
  await page.screenshot({
    path: path.join(evidence, "05-unknown-kz.png"),
    fullPage: true,
  });
  await fs.writeFile(
    path.join(evidence, "acceptance.json"),
    JSON.stringify(
      {
        status: "PASS",
        checkedAt: new Date().toISOString(),
        fixtureVersion: fixture.fixtureVersion,
        setup: fixture.boundary,
        setupMilliseconds: fixture.setupMilliseconds,
        measurements,
        unknownMobile: {
          language: "KZ",
          width: 360,
          actualPageWidth: unknownMobileWidth,
        },
        boundary:
          "Actual local UI/API/domain and render output with synthetic data; no provider network, real electronic signature or physical printing. RU/KZ verification after the measurement is separate from operator action counts.",
      },
      null,
      2,
    ),
  );
});

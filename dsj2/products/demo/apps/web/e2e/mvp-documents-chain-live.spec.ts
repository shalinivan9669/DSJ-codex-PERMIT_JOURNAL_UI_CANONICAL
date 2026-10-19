import { test, expect, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const product = path.resolve(__dirname, "../../..");
const runtime = path.join(product, ".runtime/mvp-all-roles-20261019/run-01");
const output = path.join(
  product,
  "docs/evidence/mvp-all-roles-20261019/run-01/documents/browser-chain",
);
async function login(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByRole("button", { name: "RU", exact: true }).click();
  await page.getByLabel("Электронная почта", { exact: true }).fill(user.email);
  await page.getByLabel("Пароль", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
test.use({ trace: "off", screenshot: "off", video: "off" });
test("J07/J08 full browser chain: completed learning to operator, director, commission, paper record, learner files and public QR", async ({
  browser,
}) => {
  test.setTimeout(480000);
  const fixture = JSON.parse(
    await readFile(path.join(runtime, "browser-fixture.json"), "utf8"),
  );
  const chain = JSON.parse(
    await readFile(path.join(runtime, "chain-result.json"), "utf8"),
  );
  await mkdir(output, { recursive: true });
  const contexts = await Promise.all(
    [0, 1, 2, 3, 4].map(() =>
      browser.newContext({ baseURL: process.env.DEMO_ORIGIN }),
    ),
  );
  const [operator, director, expert, learner, publicPage] = await Promise.all(
    contexts.map((context) => context.newPage()),
  );
  try {
    await login(operator, fixture.users.operator);
    await login(director, fixture.users.director);
    await login(expert, fixture.users.expert);
    await login(learner, fixture.users.learner);
    let detail = await (
      await operator.request.get(`/api/lms/enrollments/${chain.enrollmentId}`)
    ).json();
    const chainResult = detail.results.find(
      (item: { id: string }) => item.id === chain.resultId,
    );
    expect(chainResult, "The completed chain result must exist").toBeTruthy();
    expect(
      chainResult.documentEligible,
      "Document continuation requires an eligible immutable result; inspect the published profile and readiness before retrying",
    ).toBe(true);
    let links = detail.documents.filter(
      (item: { resultId: string }) => item.resultId === chain.resultId,
    );
    if (!links.length) {
      await operator.goto(`/lms/results?enrollmentId=${chain.enrollmentId}`);
      const prepare = operator.getByRole("button", {
        name: "Подготовить документы",
        exact: true,
      });
      await expect(prepare).toBeVisible();
      const response = operator.waitForResponse(
        (r) =>
          r.url().endsWith("/api/lms/results/documents") &&
          r.request().method() === "POST",
      );
      await prepare.click();
      const prepared = await (await response).json();
      expect(prepared.errors).toEqual([]);
      links = prepared.items;
    }
    expect(links).toHaveLength(3);
    const requestId = links[0].requestId;
    const approvals = await (
      await director.request.get("/api/approvals")
    ).json();
    const pending = approvals.items.find(
      (item: { requestId: string; status: string }) =>
        item.requestId === requestId && item.status === "PENDING",
    );
    if (pending) {
      await director.goto(`/approvals?proposal=${pending.id}`);
      const response = director.waitForResponse((r) =>
        r.url().endsWith(`/api/approvals/${pending.id}/decision`),
      );
      await director
        .getByRole("button", { name: "Согласовать эту редакцию", exact: true })
        .click();
      expect((await response).ok()).toBe(true);
    }
    await expect
      .poll(
        async () => {
          const state = await (
            await director.request.get(
              `/api/print-requests/${requestId}/signing`,
            )
          ).json();
          return (
            state.documents?.filter(
              (document: { artifactId: string | null }) => document.artifactId,
            ).length || 0
          );
        },
        { timeout: 240000, intervals: [1000, 2000, 5000] },
      )
      .toBe(3);
    const before = await (
      await director.request.get(`/api/print-requests/${requestId}/signing`)
    ).json();
    expect(before.signatures).toEqual([]);
    expect(before.providers.EGOV_QR.available).toBe(false);
    expect(before.providers.NCALAYER.available).toBe(false);
    detail = await (
      await operator.request.get(`/api/lms/enrollments/${chain.enrollmentId}`)
    ).json();
    links = detail.documents.filter(
      (item: { resultId: string }) => item.resultId === chain.resultId,
    );
    const protocol = links.find(
      (item: { documentType: string }) => item.documentType === "PROTOCOL",
    );
    const protocolView = await (
      await operator.request.get(`/api/lms/documents/${protocol.id}`)
    ).json();
    await expert.goto("/lms/commission");
    await expert
      .getByRole("button", { name: "RU", exact: true })
      .last()
      .click();
    await expert
      .getByRole("row")
      .filter({ hasText: protocolView.link.number })
      .getByRole("button", { name: "Открыть", exact: true })
      .click();
    await expect(
      expert.getByRole("link", { name: "Скачать PDF", exact: true }),
    ).toHaveCount(3);
    for (let index = 0; index < 3; index++) {
      const download = expert.waitForEvent("download");
      await expert
        .getByRole("link", { name: "Скачать PDF", exact: true })
        .nth(index)
        .click();
      await (
        await download
      ).saveAs(path.join(output, `commission-${index + 1}.pdf`));
    }
    const geometry = [];
    for (const width of [360, 390, 768, 1440]) {
      await expert.setViewportSize({ width, height: 900 });
      for (const language of ["RU", "KZ"]) {
        await expert
          .getByRole("button", { name: language, exact: true })
          .last()
          .click();
        if (language === "KZ") {
          await expect(
            expert.getByRole("heading", {
              name: "Құжаттарға қол қою",
              exact: true,
            }),
          ).toBeVisible();
          await expect(
            expert.getByText(
              "eGov Mobile: Ресми eGov Mobile QR және ЭЦҚ тексеру сервері қосылмаған",
              { exact: true },
            ),
          ).toBeVisible();
          await expect(
            expert.getByText(
              "NCALayer: ҚР ҰКО ЭЦҚ тексеру сервері қосылмаған",
              { exact: true },
            ),
          ).toBeVisible();
        }
        expect(
          await expert.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
        geometry.push({ language, width, overflow: false });
        await expert.screenshot({
          path: path.join(output, `commission-${language}-${width}.png`),
          fullPage: true,
        });
      }
    }
    await expert
      .getByRole("button", { name: "RU", exact: true })
      .last()
      .click();
    if (
      await expert
        .getByRole("button", { name: "Подтвердить протокол", exact: true })
        .count()
    ) {
      await expert
        .getByLabel(
          "Результаты и окончательные PDF просмотрены, протокол подтверждаю",
          { exact: true },
        )
        .check();
      const response = expert.waitForResponse((r) =>
        /\/lms\/commission\/[^/]+\/confirm$/.test(r.url()),
      );
      await expert
        .getByRole("button", { name: "Подтвердить протокол", exact: true })
        .click();
      expect((await response).ok()).toBe(true);
    }
    await expect(
      expert.getByText("Вы подтвердили этот протокол", { exact: false }),
    ).toBeVisible();
    await expert.screenshot({
      path: path.join(output, "commission-confirmed.png"),
      fullPage: true,
    });
    // This is an explicitly synthetic record of paper facts. No electronic
    // signature or physical printing is asserted by the acceptance fixture.
    await director.goto(`/lms/results?enrollmentId=${chain.enrollmentId}`);
    const signedAt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Qyzylorda",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    for (const document of before.documents) {
      if (document.paperSignature) continue;
      const card = director.locator("article.lms-panel").filter({
        has: director.getByRole("heading", {
          name: new RegExp(document.number),
        }),
      });
      await card
        .getByText("Подписи на бумажном оригинале", { exact: true })
        .click();
      await card.getByLabel("Дата подписания", { exact: true }).fill(signedAt);
      await card
        .getByLabel("ФИО подписавших, по одному в строке", { exact: true })
        .fill("Синтетический подписант приёмки");
      await card
        .getByLabel("Основание проверки оригинала", { exact: true })
        .fill(
          "Синтетический учебный сценарий бумажной фиксации; реальная подпись и физическая печать не заявляются",
        );
      await card
        .getByLabel(
          "Проверены все обязательные подписи на бумажном оригинале",
          { exact: true },
        )
        .check();
      const response = director.waitForResponse(
        (r) =>
          r
            .url()
            .endsWith(`/api/print-requests/${requestId}/paper-signatures`) &&
          r.request().method() === "POST",
      );
      await card
        .getByRole("button", {
          name: "Зафиксировать бумажные подписи",
          exact: true,
        })
        .click();
      expect((await response).ok()).toBe(true);
    }
    const after = await (
      await director.request.get(`/api/print-requests/${requestId}/signing`)
    ).json();
    expect(after.status).toBe("ISSUED");
    expect(after.signatures).toEqual([]);
    expect(
      after.documents.map(
        (document: { documentSha256: string }) => document.documentSha256,
      ),
    ).toEqual(
      before.documents.map(
        (document: { documentSha256: string }) => document.documentSha256,
      ),
    );
    await director.screenshot({
      path: path.join(output, "paper-recorded.png"),
      fullPage: true,
    });
    await learner.goto("/learn/documents");
    await learner
      .getByRole("button", { name: "RU", exact: true })
      .last()
      .click();
    const card = learner.locator("article.lms-panel").filter({
      has: learner.getByRole("heading", {
        name: new RegExp(protocolView.link.number),
      }),
    });
    await card.getByText("Показать QR документа", { exact: true }).click();
    await expect(
      card.getByRole("img", { name: "QR для проверки документа", exact: true }),
    ).toBeVisible();
    for (const format of ["DOCX", "PDF"]) {
      const download = learner.waitForEvent("download");
      await card
        .getByRole("link", { name: `Скачать ${format}`, exact: true })
        .click();
      await (
        await download
      ).saveAs(path.join(output, `learner-protocol.${format.toLowerCase()}`));
    }
    const preview = learner.waitForEvent("popup");
    await card
      .getByRole("link", { name: "Просмотр и печать PDF", exact: true })
      .click();
    await (await preview).close();
    await learner.screenshot({
      path: path.join(output, "learner-issued-qr.png"),
      fullPage: true,
    });
    const url = await card
      .getByRole("link", { name: "Проверить запись в реестре", exact: true })
      .getAttribute("href");
    await publicPage.goto(url!);
    await expect(
      publicPage.getByText("Действующая запись", { exact: true }),
    ).toBeVisible();
    await expect(
      publicPage.getByText("Бумажный оригинал", { exact: true }),
    ).toBeVisible();
    await expect(
      publicPage.getByText("Синтетический learner", { exact: true }),
    ).toHaveCount(0);
    await publicPage.screenshot({
      path: path.join(output, "public-paper-record.png"),
      fullPage: true,
    });
    await writeFile(
      path.join(output, "J07-J08.json"),
      JSON.stringify(
        {
          status: "PASS",
          synthetic: true,
          enrollmentId: chain.enrollmentId,
          resultId: chain.resultId,
          requestId,
          source:
            "Continuation of the same browser-authored, assigned, learned and examined course",
          documents: after.documents.map(
            (document: {
              number: string;
              documentSha256: string;
              paperSignature: { category: string };
            }) => ({
              number: document.number,
              sha256: document.documentSha256,
              paperSignatureCategory: document.paperSignature.category,
            }),
          ),
          commissionConfirmedThroughUi: true,
          expertSigningPanelKz: true,
          unavailableProvidersShownInKz: ["EGOV_QR", "NCALAYER"],
          learnerDownloadedDocxPdf: true,
          previewOpened: true,
          embeddedQrPublicRecord: true,
          electronicSignatures: after.signatures.length,
          physicalPrintPerformed: false,
          actualHandwrittenSignaturesClaimed: false,
          geometry,
        },
        null,
        2,
      ),
    );
  } finally {
    // Preserve the first workflow assertion if Playwright has already closed a context.
    await Promise.allSettled(contexts.map((context) => context.close()));
  }
});

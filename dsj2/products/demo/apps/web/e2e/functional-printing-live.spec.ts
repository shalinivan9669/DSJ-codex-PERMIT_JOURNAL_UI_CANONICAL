import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const product = path.resolve(__dirname, "../../..");
const output = path.join(
  product,
  "docs/evidence/functional-completion-20261019/run-01/operations/printing",
);
async function login(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Электронная почта", { exact: true }).fill(user.email);
  await page.getByLabel("Пароль", { exact: true }).fill(user.password);
  for (let i = 0; i < 3; i++) {
    const result = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/auth/login") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    const r = await result;
    if (r.status() !== 429) {
      expect(r.ok(), await r.text()).toBe(true);
      break;
    }
    await page.waitForTimeout(30000);
    await page.waitForTimeout(31000);
  }
  await expect(page).not.toHaveURL(/\/login/);
}
test.skip(
  process.env.DEMO_FUNCTIONAL_OPERATIONS !== "1",
  "Requires isolated functional clean runtime",
);
test("F16 ordinary operator request, director review, original files and PASSED provenance remain separate from LMS", async ({
  page,
  browser,
}) => {
  test.setTimeout(480000);
  await mkdir(output, { recursive: true });
  const fixture = JSON.parse(
    readFileSync(
      path.join(
        product,
        ".runtime/functional-completion-20261019/run-01/onboarding-result.private.json",
      ),
      "utf8",
    ),
  );
  const context = await browser.newContext({
    baseURL: process.env.DEMO_ORIGIN,
  });
  const director = await context.newPage();
  try {
    expect(process.env.DEMO_ORIGIN).toBe("http://127.0.0.1:3350");
    await login(page, fixture.users.operator);
    await login(director, fixture.users.director);
    await director.goto("/settings?tab=templates");
    for (const title of [
      "ПТМ — групповой протокол",
      "ПТМ — индивидуальный протокол",
    ]) {
      const card = director
        .locator(".template-list article")
        .filter({
          has: director.getByRole("heading", { name: title, exact: true }),
        });
      await expect(card).toBeVisible();
      const button = card.getByRole("button", {
        name: "Подтвердить форму",
        exact: true,
      });
      if (await button.count()) {
        await button.click();
        await expect(
          card.getByText("Подтверждена", { exact: true }),
        ).toBeVisible();
      }
    }
    const progress = JSON.parse(
      readFileSync(
        path.join(
          product,
          ".runtime/functional-completion-20261019/run-01/operations-printing-progress.json",
        ),
        "utf8",
      ),
    );
    const id = progress.requestId;
    await page.goto(`/requests/${id}/edit`);
    const read = async () => {
      const r = await page.request.get(`/api/print-requests/${id}`);
      expect(r.ok(), await r.text()).toBe(true);
      return r.json();
    };
    const draft = await read();
    const submitted = { approval: { proposalId: progress.proposalId } };
    await director.goto(`/approvals?proposal=${submitted.approval.proposalId}`);
    await director
      .getByText(/^Предпросмотр данных всех людей и документов/)
      .click();
    await expect(
      director.getByRole("region", { name: "Подготовленные данные редакции" }),
    ).toContainText("Синтетический Печатный Сотрудник");
    const viewer = director.getByRole("region", {
      name: "Предпросмотр назначенных документов",
    });
    await viewer
      .getByRole("button", { name: "Создать предпросмотр", exact: true })
      .click();
    for (let retry = 0; retry < 3; retry++) {
      try {
        await expect(
          viewer.getByRole("img", { name: /^Страница 1 из/ }),
        ).toBeVisible({ timeout: 45000 });
        break;
      } catch (error) {
        if (retry === 2) throw error;
        const recreate = viewer.getByRole("button", {
          name: /^(Создать|Повторить) предпросмотр$/,
        });
        if (await recreate.isVisible()) await recreate.click();
      }
    }
    await director.screenshot({
      path: path.join(output, "director-preview.png"),
      fullPage: true,
    });
    await director
      .getByRole("button", { name: "Согласовать эту редакцию", exact: true })
      .click();
    await expect
      .poll(async () => (await read()).approval?.status)
      .toBe("APPROVED");
    await expect(
      page.getByRole("button", { name: "Сформировать документы", exact: true }),
    ).toBeEnabled({ timeout: 30000 });
    await page
      .getByRole("button", { name: "Сформировать документы", exact: true })
      .click();
    await expect
      .poll(
        async () => {
          const d = await read();
          return (
            d.jobs
              ?.filter((j: any) => j.provenance === "ORIGINAL" || j.issuanceId)
              .every((j: any) => j.status === "SUCCEEDED") &&
            d.documents?.length > 0
          );
        },
        { timeout: 210000 },
      )
      .toBe(true);
    const issued = await read();
    expect(issued.issuances).toHaveLength(1);
    expect(new Set(issued.documents.map((d: any) => d.number)).size).toBe(
      issued.documents.length,
    );
    const pdf = issued.artifacts.find(
      (a: any) => a.format === "PDF" && a.provenance === "ORIGINAL",
    );
    expect(pdf).toBeTruthy();
    const file = await page.request.get(`/api/artifacts/${pdf.id}`);
    expect(file.ok(), await file.text()).toBe(true);
    expect((await file.body()).subarray(0, 4).toString()).toBe("%PDF");
    await writeFile(path.join(output, "ordinary.pdf"), await file.body());
    const docx = issued.artifacts.find(
      (a: any) => a.format === "DOCX" && a.provenance === "ORIGINAL",
    );
    expect(docx).toBeTruthy();
    const docxFile = await page.request.get(`/api/artifacts/${docx.id}`);
    expect(docxFile.ok()).toBe(true);
    expect((await docxFile.body()).subarray(0, 2).toString()).toBe("PK");
    await writeFile(path.join(output, "ordinary.docx"), await docxFile.body());
    await page.screenshot({
      path: path.join(output, "operator-files.png"),
      fullPage: true,
    });
    const record = {
      status: "PASS",
      synthetic: true,
      requestId: id,
      issuedDocumentIds: issued.documents.map((d: any) => d.id),
      numbers: issued.documents.map((d: any) => d.number),
      pdfArtifactId: pdf.id,
      docxArtifactId: docx.id,
      defaultOutcome: "PASSED",
      defaultOutcomeOrigin: "AUTO",
      outcomeSources: draft.items[0].assignments.map(
        (a: any) => a.outcome.source,
      ),
      ordinaryRequestSource: issued.requestSource || "ORDINARY",
      unsignedPaperIsNotElectronicOriginal: true,
    };
    await writeFile(
      path.join(output, "F16-printing.json"),
      JSON.stringify(record, null, 2),
    );
  } finally {
    await context.close();
  }
});

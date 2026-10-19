import { test, expect, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const product = path.resolve(__dirname, "../../..");
const evidence = path.join(
  product,
  "docs/evidence/mvp-all-roles-20261019/run-01/documents/browser-j09",
);
type User = { email: string; password: string };
async function login(page: Page, user: User) {
  await page.goto("/login");
  await page.getByRole("button", { name: "RU", exact: true }).click();
  await page.getByLabel("Электронная почта", { exact: true }).fill(user.email);
  await page.getByLabel("Пароль", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
async function render(requestId: string) {
  await promisify(execFile)(
    process.execPath,
    [
      path.join(product, "node_modules/tsx/dist/cli.mjs"),
      "--tsconfig",
      "apps/api/tsconfig.json",
      "scripts/verification/mvp-documents-fixture.ts",
      "--render",
      requestId,
    ],
    { cwd: product, env: process.env, timeout: 240000, windowsHide: true },
  );
}
async function prepare(operator: Page, director: Page, enrollmentId: string) {
  await operator.goto(`/lms/results?enrollmentId=${enrollmentId}`);
  await operator
    .getByRole("button", { name: "RU", exact: true })
    .last()
    .click();
  const prepared = operator.waitForResponse(
    (r) =>
      r.url().endsWith("/api/lms/results/documents") &&
      r.request().method() === "POST",
  );
  await operator
    .getByRole("button", { name: "Подготовить документы", exact: true })
    .click();
  const documents = await (await prepared).json();
  expect(documents.errors).toEqual([]);
  expect(documents.items).toHaveLength(3);
  const requestId = documents.items[0].requestId;
  const approvals = await (await director.request.get("/api/approvals")).json();
  const approval = approvals.items.find(
    (item: { requestId: string }) => item.requestId === requestId,
  );
  expect(approval).toBeTruthy();
  await director.goto(`/approvals?proposal=${approval.id}`);
  const approved = director.waitForResponse((r) =>
    r.url().endsWith(`/api/approvals/${approval.id}/decision`),
  );
  await director
    .getByRole("button", { name: "Согласовать эту редакцию", exact: true })
    .click();
  expect((await approved).ok()).toBe(true);
  await render(requestId);
  return documents.items as Array<{
    id: string;
    requestId: string;
    documentType: string;
  }>;
}
test.use({ trace: "off", screenshot: "off", video: "off" });
test("J09 documents: actual UI prepare, approval, learner QR, correction, replacement and revocation preserve original bytes", async ({
  browser,
}) => {
  test.setTimeout(600000);
  const fixture = JSON.parse(
    await readFile(
      path.join(
        product,
        ".runtime/mvp-all-roles-20261019/run-01/document-ui-fixture.json",
      ),
      "utf8",
    ),
  );
  await mkdir(evidence, { recursive: true });
  const contexts = await Promise.all(
    [0, 1, 2, 3].map(() =>
      browser.newContext({ baseURL: process.env.DEMO_ORIGIN }),
    ),
  );
  const [operator, director, learner, publicPage] = await Promise.all(
    contexts.map((context) => context.newPage()),
  );
  try {
    await login(operator, fixture.operator);
    await login(director, fixture.director);
    await login(learner, fixture.learner);
    const original = await prepare(operator, director, fixture.enrollmentId);
    await learner.goto("/learn/documents");
    await learner
      .getByRole("button", { name: "RU", exact: true })
      .last()
      .click();
    await expect(
      learner.getByText("Показать QR документа", { exact: true }),
    ).toHaveCount(3);
    await learner
      .getByText("Показать QR документа", { exact: true })
      .first()
      .click();
    await expect(
      learner
        .getByRole("img", { name: "QR для проверки документа", exact: true })
        .first(),
    ).toBeVisible();
    const measurement: object[] = [];
    for (const width of [360, 390, 768, 1440]) {
      await learner.setViewportSize({ width, height: 900 });
      for (const language of ["RU", "KZ"]) {
        await learner
          .getByRole("button", { name: language, exact: true })
          .last()
          .click();
        const geometry = await learner.evaluate(() => ({
          width: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }));
        expect(geometry.scrollWidth).toBeLessThanOrEqual(width + 1);
        measurement.push({ language, ...geometry });
        await learner.screenshot({
          path: path.join(evidence, `01-learner-qr-${language}-${width}.png`),
          fullPage: true,
        });
      }
    }
    await learner
      .getByRole("button", { name: "RU", exact: true })
      .last()
      .click();
    const protocol = original.find((item) => item.documentType === "PROTOCOL")!;
    const originalView = await (
      await learner.request.get(`/api/learn/documents/${protocol.id}`)
    ).json();
    expect(originalView.status).toBe("ISSUED");
    const originalUrl = originalView.verification.url;
    await publicPage.goto(originalUrl);
    await expect(
      publicPage.getByText("Действующая запись", { exact: true }),
    ).toBeVisible();
    await expect(
      publicPage.getByText(fixture.fullName, { exact: true }),
    ).toHaveCount(0);
    await publicPage.screenshot({
      path: path.join(evidence, "02-public-active.png"),
      fullPage: true,
    });
    const pdf = originalView.artifacts.find(
      (item: { kind: string }) => item.kind === "PDF",
    );
    const originalBytes = await (
      await learner.request.get(`/api/learn/artifacts/${pdf.id}`)
    ).body();
    const originalHash = createHash("sha256")
      .update(originalBytes)
      .digest("hex");
    await writeFile(
      path.join(evidence, "original-protocol.pdf"),
      originalBytes,
    );
    await director.goto(`/lms/results?enrollmentId=${fixture.enrollmentId}`);
    await director
      .getByRole("button", { name: "RU", exact: true })
      .last()
      .click();
    await director
      .getByText("Исправление или аннулирование", { exact: true })
      .click();
    await director
      .getByLabel("Основание", { exact: true })
      .fill("Синтетическая проверка исправленной редакции J09");
    const changed = director.waitForResponse((r) =>
      r.url().endsWith(`/api/lms/results/${fixture.resultId}/correct`),
    );
    await director
      .getByRole("button", {
        name: "Создать исправленную редакцию",
        exact: true,
      })
      .click();
    const replacement = await (await changed).json();
    expect(replacement.replacementResultId).toBeTruthy();
    await expect(
      director.getByText("Изменение зарегистрировано", { exact: true }),
    ).toBeVisible();
    await director.screenshot({
      path: path.join(evidence, "03-correction-recorded.png"),
      fullPage: true,
    });
    await publicPage.reload();
    await expect(
      publicPage.getByText("Заменена исправленным документом", { exact: true }),
    ).toBeVisible();
    expect(
      (await learner.request.get(`/api/learn/artifacts/${pdf.id}`)).status(),
    ).toBe(409);
    const corrected = await prepare(operator, director, fixture.enrollmentId);
    const correctedProtocol = corrected.find(
      (item) => item.documentType === "PROTOCOL",
    )!;
    const correctedView = await (
      await learner.request.get(`/api/learn/documents/${correctedProtocol.id}`)
    ).json();
    expect(correctedView.verification.url).not.toBe(originalUrl);
    expect(correctedView.link.number).not.toBe(originalView.link.number);
    await publicPage.reload();
    await expect(
      publicPage.getByText(
        new RegExp(`Заменяющий документ: № ${correctedView.link.number}`),
      ),
    ).toBeVisible();
    await publicPage.screenshot({
      path: path.join(evidence, "04-public-replacement.png"),
      fullPage: true,
    });
    const oldBytes = await (
      await operator.request.get(`/api/lms/artifacts/${pdf.id}`)
    ).body();
    expect(createHash("sha256").update(oldBytes).digest("hex")).toBe(
      originalHash,
    );
    await director.goto(`/lms/results?enrollmentId=${fixture.enrollmentId}`);
    await director
      .getByText("Исправление или аннулирование", { exact: true })
      .click();
    await director
      .getByRole("combobox", { name: "Действие", exact: true })
      .selectOption("revoke");
    await director
      .getByLabel("Основание", { exact: true })
      .fill("Синтетическая проверка аннулирования J09");
    const revoked = director.waitForResponse((r) =>
      r
        .url()
        .endsWith(`/api/lms/results/${replacement.replacementResultId}/revoke`),
    );
    await director
      .getByRole("button", { name: "Аннулировать результат", exact: true })
      .click();
    expect((await revoked).ok()).toBe(true);
    await expect(
      director.getByText("Изменение зарегистрировано", { exact: true }),
    ).toBeVisible();
    await director.screenshot({
      path: path.join(evidence, "05-revocation-recorded.png"),
      fullPage: true,
    });
    await publicPage.goto(correctedView.verification.url);
    await expect(
      publicPage.getByText("Отозвана", { exact: true }),
    ).toBeVisible();
    await publicPage.screenshot({
      path: path.join(evidence, "06-public-revoked.png"),
      fullPage: true,
    });
    const correctedPdf = correctedView.artifacts.find(
      (item: { kind: string }) => item.kind === "PDF",
    );
    expect(
      (
        await learner.request.get(`/api/learn/artifacts/${correctedPdf.id}`)
      ).status(),
    ).toBe(409);
    await writeFile(
      path.join(evidence, "acceptance.json"),
      JSON.stringify(
        {
          passed: true,
          synthetic: true,
          tenantId: fixture.tenantId,
          enrollmentId: fixture.enrollmentId,
          resultId: fixture.resultId,
          replacementResultId: replacement.replacementResultId,
          originalHash,
          originalNumber: originalView.link.number,
          replacementNumber: correctedView.link.number,
          originalBytesUnchanged: true,
          actualUiActions: [
            "operator.prepare",
            "director.approve",
            "learner.qr",
            "director.correct",
            "operator.prepare-correction",
            "director.approve-correction",
            "director.revoke",
          ],
          publicStates: ["ACTIVE_RECORD", "REPLACED", "REVOKED"],
          formerLearnerDownloadStatus: 409,
          revokedLearnerDownloadStatus: 409,
          publicContainsFullName: false,
          physicalPrintPerformed: false,
          learningPrerequisite:
            "real service exam in a separate synthetic tenant; document lifecycle actions performed in browser UI",
          measurement,
        },
        null,
        2,
      ),
    );
  } finally {
    for (const context of contexts) await context.close();
  }
});

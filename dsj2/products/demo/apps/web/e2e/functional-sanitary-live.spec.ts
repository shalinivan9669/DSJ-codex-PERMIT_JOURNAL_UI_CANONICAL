import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
const product = path.resolve(__dirname, "../../..");
const output = path.join(
  product,
  "docs/evidence/functional-completion-20261019/run-01/operations/sanitary",
);
async function login(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Электронная почта", { exact: true }).fill(user.email);
  await page.getByLabel("Пароль", { exact: true }).fill(user.password);
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/auth/login") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  expect((await response).status()).toBe(201);
  await expect(page).not.toHaveURL(/\/login/);
}
test.use({ trace: "off", screenshot: "only-on-failure", video: "off" });
test.skip(
  process.env.DEMO_FUNCTIONAL_OPERATIONS !== "1",
  "Requires isolated functional browser runtime",
);
test("F17 sanitary course, real scored result, internal export and immutable operator correction", async ({
  page,
  browser,
}) => {
  test.setTimeout(480000);
  expect(process.env.DEMO_ORIGIN).toBe("http://127.0.0.1:3349");
  await mkdir(output, { recursive: true });
  const fixture = JSON.parse(
    readFileSync(
      path.join(
        product,
        ".runtime/functional-completion-20261019/run-01/populated.private.json",
      ),
      "utf8",
    ),
  );
  const learner = fixture.learners[12];
  await login(page, learner);
  await page.goto(`/learn/${learner.enrollmentId}`);
  const learning = async () => {
    const r = await page.request.get(
      `/api/learn/enrollments/${learner.enrollmentId}`,
    );
    expect(r.ok(), await r.text()).toBe(true);
    return r.json();
  };
  let data = await learning();
  const lessons = data.content.modules.flatMap((m: any) => m.lessons);
  expect(lessons.filter((l: any) => l.kind === "TEXT")).toHaveLength(4);
  expect(lessons.filter((l: any) => l.kind === "PDF")).toHaveLength(1);
  if (!data.results.some((r: any) => r.eligible && r.verdict === "PASSED")) {
    if (!data.attempts.some((a: any) => a.state === "IN_PROGRESS")) {
      for (const lesson of lessons) {
        if (lesson.completed) continue;
        await page
          .getByRole("button", { name: "Материалы и задания", exact: true })
          .click();
        await page
          .locator(".lms-outline")
          .getByRole("button", {
            name: new RegExp(
              lesson.titleRu.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            ),
          })
          .click();
        if (lesson.kind === "PDF") {
          const link = page.getByRole("link", {
            name: "Открыть материал PDF",
            exact: true,
          });
          const href = await link.getAttribute("href");
          const pdf = await page.request.get(href!);
          expect(pdf.ok()).toBe(true);
          const body = await pdf.body();
          expect(body.subarray(0, 4).toString()).toBe("%PDF");
          await writeFile(path.join(output, "study-material.pdf"), body);
          const opened = page.waitForEvent("popup");
          await link.click();
          const popup = await opened;
          await popup.waitForLoadState("domcontentloaded");
          await popup.close();
        } else await expect(page.locator(".lms-prose").last()).not.toBeEmpty();
        await page
          .getByRole("button", { name: "Изучено, дальше", exact: true })
          .click();
        await expect
          .poll(
            async () =>
              (await learning()).content.modules
                .flatMap((m: any) => m.lessons)
                .find((l: any) => l.id === lesson.id).completed,
          )
          .toBe(true);
      }
      await page
        .getByRole("button", {
          name: "Итоговая проверка и документы",
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("button", { name: "Начать экзамен", exact: true }),
      ).toBeEnabled();
      await page
        .getByRole("button", { name: "Начать экзамен", exact: true })
        .click();
    }
    await expect(page.locator(".lms-question")).toHaveCount(8);
    for (const answer of [
      "Из действующей инструкции и применимого основания",
      "Нет, нужна установленная процедура и её подтверждение",
      "Уточнить сведения у ответственного",
      "Нет, предусмотренная процедура сохраняется",
      "Как отсутствие данных или ошибка с причиной",
      "После фактически выполненного действия",
      "Установить источник ошибки и сохранить историю исправления",
      "Нет, это разные процессы и доказательства",
    ]) {
      await page.getByRole("radio", { name: answer, exact: true }).check();
    }
    await expect(page.locator(".lms-exam-top").getByRole("status")).toHaveText(
      "Ответы сохранены",
    );
    await page.reload();
    await expect(page.locator(".lms-question input:checked")).toHaveCount(8);
    await page
      .getByRole("button", { name: "Завершить попытку", exact: true })
      .click();
    await expect(page.getByText("Баллы: 8 / 8", { exact: true })).toBeVisible();
  }
  data = await learning();
  const result = data.results.find(
    (r: any) => r.eligible && r.verdict === "PASSED",
  );
  expect(result).toBeTruthy();
  expect(result.assessmentKind).toBe("CENTER_EXAM");
  await page.screenshot({
    path: path.join(output, "learner-real-result.png"),
    fullPage: true,
  });
  const staffContext = await browser.newContext({
    baseURL: process.env.DEMO_ORIGIN,
  });
  const staff = await staffContext.newPage();
  try {
    await login(staff, fixture.users.admin);
    await staff.goto("/lms/sanitary");
    let batch: any;
    await expect
      .poll(
        async () => {
          const r = await staff.request.get("/api/lms/sanitary");
          expect(r.ok(), await r.text()).toBe(true);
          batch = (await r.json()).items.find((b: any) =>
            b.items.some((i: any) => i.resultId === result.id),
          );
          return !!batch;
        },
        { timeout: 60000 },
      )
      .toBe(true);
    expect(batch.connectionState).toBe("NOT_CONNECTED");
    await staff.reload();
    const row = staff
      .getByRole("region", { name: "Санитарный журнал", exact: true })
      .locator("tbody tr")
      .filter({ has: staff.locator(`a[href*="/${batch.id}/export"]`) });
    await expect(row).toBeVisible();
    for (const format of ["CSV", "XLSX", "PDF"]) {
      await staff
        .getByRole("combobox", { name: "Формат", exact: true })
        .selectOption(format);
      const download = staff.waitForEvent("download", { timeout: 90000 });
      await row.getByRole("link", { name: "Скачать", exact: true }).click();
      await (
        await download
      ).saveAs(path.join(output, `internal-list.${format.toLowerCase()}`));
    }
    await row.getByRole("button").click();
    const composition = staff.getByRole("region", {
      name: "Состав списка",
      exact: true,
    });
    const item = batch.items.find((i: any) => i.resultId === result.id);
    const personRow = composition
      .locator("tbody tr")
      .filter({ hasText: item.snapshot.learner.fullNameRu });
    await personRow
      .getByRole("button", { name: "Добавить подтверждение", exact: true })
      .click();
    const originalSource =
      "Учебный пример: оператор сверил внутренний список. Внешнее принятие и ЛМК не подтверждаются.";
    const correctionSource =
      "Учебное исправление: уточнён локальный номер сверки внутреннего списка. Внешнее принятие и ЛМК не подтверждаются.";
    await staff
      .getByLabel("Источник подтверждения", { exact: true })
      .fill(originalSource);
    await staff
      .getByLabel("Номер или ссылка на подтверждение", { exact: true })
      .fill("LOCAL-SYNTHETIC-01");
    await staff
      .getByLabel("Файл подтверждения, если есть", { exact: true })
      .setInputFiles(path.join(output, "internal-list.pdf"));
    const form = staff
      .locator("form")
      .filter({
        has: staff.getByLabel("Источник подтверждения", { exact: true }),
      });
    await form
      .getByRole("button", { name: "Добавить подтверждение", exact: true })
      .click();
    const history = staff
      .locator("details")
      .filter({
        has: staff.locator("summary", { hasText: /^Подтверждения оператора$/ }),
      });
    await history.locator("summary").click();
    await expect(history).toContainText(originalSource);
    const before = await staff.request
      .get(`/api/lms/sanitary/${batch.id}`)
      .then((r) => r.json());
    const original = before.evidence.find(
      (e: any) => e.source === originalSource,
    );
    expect(original).toBeTruthy();
    expect(original.category).toBe("OPERATOR_ATTESTED");
    const fileDownload = staff.waitForEvent("download");
    await history
      .getByRole("link", { name: "Скачать подтверждение", exact: true })
      .click();
    await (
      await fileDownload
    ).saveAs(path.join(output, "downloaded-evidence.pdf"));
    const hash = (name: string) =>
      createHash("sha256")
        .update(readFileSync(path.join(output, name)))
        .digest("hex");
    expect(hash("downloaded-evidence.pdf")).toBe(hash("internal-list.pdf"));
    await history
      .getByRole("button", { name: "Исправить подтверждение", exact: true })
      .click();
    await staff
      .getByLabel("Источник и причина исправления", { exact: true })
      .fill(correctionSource);
    await staff
      .getByLabel("Номер или ссылка на подтверждение", { exact: true })
      .fill("LOCAL-SYNTHETIC-02");
    await staff
      .getByLabel("Файл подтверждения, если есть", { exact: true })
      .setInputFiles(path.join(output, "internal-list.pdf"));
    await staff
      .locator("form")
      .filter({
        has: staff.getByLabel("Источник и причина исправления", {
          exact: true,
        }),
      })
      .getByRole("button", { name: "Добавить подтверждение", exact: true })
      .click();
    await expect(history).toContainText("Заменено исправлением");
    await staff.reload();
    await staff
      .getByRole("region", { name: "Санитарный журнал", exact: true })
      .locator("tbody tr")
      .filter({ has: staff.locator(`a[href*="/${batch.id}/export"]`) })
      .getByRole("button")
      .click();
    await staff
      .locator("summary", { hasText: /^Подтверждения оператора$/ })
      .click();
    await expect(
      staff.getByText(correctionSource, { exact: false }),
    ).toBeVisible();
    const after = await staff.request
      .get(`/api/lms/sanitary/${batch.id}`)
      .then((r) => r.json());
    const corrected = after.evidence.find(
      (e: any) => e.supersedesId === original.id,
    );
    expect(corrected).toBeTruthy();
    expect(after.evidence.find((e: any) => e.id === original.id)).toEqual(
      original,
    );
    expect(after.connectionState).toBe("NOT_CONNECTED");
    const delivery = after.items.find((i: any) => i.id === item.id).delivery;
    expect(delivery.state).not.toBe("ACCEPTED");
    expect(delivery.lmkState).not.toBe("CONFIRMED");
    await staff.screenshot({
      path: path.join(output, "operator-history.png"),
      fullPage: true,
    });
    await writeFile(
      path.join(output, "F17-sanitary.json"),
      JSON.stringify(
        {
          status: "PASS",
          synthetic: true,
          enrollmentId: learner.enrollmentId,
          resultId: result.id,
          assessmentKind: result.assessmentKind,
          score: result.score,
          maximum: result.maximum,
          eligible: result.eligible,
          progressPercent: data.progressPercent,
          batchId: batch.id,
          deliveryId: delivery.id,
          deliveryState: delivery.state,
          lmkState: delivery.lmkState,
          connectionState: after.connectionState,
          evidence: [original, corrected],
          originalFileSha256: hash("internal-list.pdf"),
          downloadedFileSha256: hash("downloaded-evidence.pdf"),
          externalAcceptanceClaimed: false,
          realMedicalClearanceClaimed: false,
        },
        null,
        2,
      ),
    );
  } finally {
    await staffContext.close();
  }
});

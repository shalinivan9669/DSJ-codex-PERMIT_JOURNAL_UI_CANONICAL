import { expect, type Page } from "@playwright/test";

/** Actual review UI. Caller provides the authorized synthetic teacher and target, never a forged score/result. */
export async function reviewLearningWork(
  page: Page,
  user: { email: string; password: string },
  target: {
    type: "ATTEMPT" | "SUBMISSION";
    id: string;
    learnerName?: string;
    decision?: "ACCEPTED" | "RETURNED" | "REJECTED";
    feedback?: string;
  },
) {
  await page.goto("/login");
  await page.getByLabel("Электронная почта").fill(user.email);
  await page.getByLabel("Пароль").fill(user.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto("/lms/teaching");
  await page.getByRole("button", { name: "RU", exact: true }).click();
  await page.getByLabel("Работы").selectOption(target.type);
  // The link is selected from the real scoped queue and verified against the response target.
  const queue = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Очередь проверки", exact: true }),
  });
  if (target.learnerName) {
    const row = queue
      .getByRole("listitem")
      .filter({ has: page.getByText(target.learnerName, { exact: true }) })
      .first();
    await row
      .getByRole("button", { name: "Открыть работу", exact: true })
      .click();
  } else
    await queue
      .getByRole("button", { name: "Открыть работу", exact: true })
      .first()
      .click();
  const detail = page.locator("section[aria-busy]");
  await expect(detail).toBeVisible();
  const targetResponse = await page.request.get(
    `/api/lms/reviews/${target.type}/${target.id}`,
  );
  expect(targetResponse.ok()).toBe(true);
  const frozen = (await targetResponse.json()) as {
    pendingQuestionIds?: string[];
    revision: number;
    contentHash: string;
  };
  const feedback =
    target.feedback || "Синтетическая проверка: критерии выполнены.";
  if (target.type === "ATTEMPT") {
    const grades = detail.getByLabel("Оценка ответа");
    await expect(grades).toHaveCount(frozen.pendingQuestionIds!.length);
    for (const grade of await grades.all()) await grade.selectOption("1");
  } else
    await detail
      .getByLabel("Решение")
      .selectOption(target.decision || "ACCEPTED");
  await detail.getByLabel("Обратная связь слушателю").fill(feedback);
  await page.getByRole("button", { name: "KZ", exact: true }).click();
  await expect(detail.getByLabel("Тыңдаушыға кері байланыс")).toHaveValue(
    feedback,
  );
  await page.getByRole("button", { name: "RU", exact: true }).click();
  const sent = page.waitForRequest(
    (request) =>
      request
        .url()
        .endsWith(`/api/lms/reviews/${target.type}/${target.id}/decision`) &&
      request.method() === "POST",
  );
  const saved = page.waitForResponse(
    (response) =>
      response
        .url()
        .endsWith(`/api/lms/reviews/${target.type}/${target.id}/decision`) &&
      response.request().method() === "POST",
  );
  await detail
    .getByRole("button", { name: "Сохранить решение", exact: true })
    .click();
  const payload = (await sent).postDataJSON();
  expect(payload.revision).toBe(frozen.revision);
  expect(payload.contentHash).toBe(frozen.contentHash);
  expect((await saved).ok()).toBe(true);
  await expect(
    page.getByText("Решение сохранено", { exact: true }),
  ).toBeVisible();
  return {
    targetType: target.type,
    targetId: target.id,
    revision: frozen.revision,
    contentHash: frozen.contentHash,
    decision:
      target.type === "ATTEMPT" ? "GRADE" : target.decision || "ACCEPTED",
    throughUi: true,
    feedbackRetainedAcrossLocale: true,
  };
}

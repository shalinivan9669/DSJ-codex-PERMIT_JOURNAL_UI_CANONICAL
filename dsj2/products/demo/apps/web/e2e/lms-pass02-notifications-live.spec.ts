import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const product = path.resolve(__dirname, "../../..");
const fixture = JSON.parse(
  readFileSync(
    path.join(
      product,
      ".runtime/lms-pass02-operations-20261018/notifications-browser-fixture.json",
    ),
    "utf8",
  ),
);
const output =
  process.env.DEMO_E2E_EVIDENCE ||
  path.join(
    product,
    "docs/evidence/lms-full-tz-pass-02-operations-20261018/notifications-browser",
  );
async function login(page: Page, user: { email: string; password: string }) {
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(60000);
  await page.goto("/login");
  await page.getByLabel("Электронная почта", { exact: true }).fill(user.email);
  await page.getByLabel("Пароль", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
async function post(page: Page, url: string) {
  const session = await page.request
    .get("/api/auth/session")
    .then((r) => r.json());
  return page.request.post(url, {
    data: {},
    headers: {
      "x-csrf-token": session.csrfToken,
      origin: "http://127.0.0.1:3339",
    },
  });
}
test("N05 inbox learner and employer: pagination, read-all, recover503, stale scope404, RU/KZ mobile", async ({
  browser,
}) => {
  await mkdir(output, { recursive: true });
  const started = Date.now();
  const learnerContext = await browser.newContext(),
    employerContext = await browser.newContext(),
    directorContext = await browser.newContext();
  const learner = await learnerContext.newPage(),
    employer = await employerContext.newPage(),
    director = await directorContext.newPage();
  try {
    await login(learner, fixture.users.learner);
    await learner.goto("/learn/notifications");
    await expect(
      learner.getByRole("heading", { name: "Уведомления", exact: true }),
    ).toBeVisible();
    await expect
      .poll(
        async () => {
          const r = await learner.request
            .get("/api/lms/notifications?pageSize=100")
            .then((r) => r.json());
          return r.items.some(
            (n: { titleRu: string }) => n.titleRu === "Вам назначено обучение",
          );
        },
        { timeout: 90000 },
      )
      .toBe(true);
    const first = await learner.request
      .get("/api/lms/notifications?page=1&pageSize=25")
      .then((r) => r.json());
    expect(first.total).toBeGreaterThan(25);
    expect(first.items.length).toBe(25);
    await learner
      .getByRole("navigation", { name: "Страницы уведомлений", exact: true })
      .getByRole("button", { name: "Далее", exact: true })
      .click();
    await expect(learner.getByText("2 / 2", { exact: true })).toBeVisible();
    const second = await learner.request
      .get("/api/lms/notifications?page=2&pageSize=25")
      .then((r) => r.json());
    expect(
      second.items.every(
        (n: { id: string }) =>
          !first.items.some((f: { id: string }) => f.id === n.id),
      ),
    ).toBe(true);
    await learner
      .getByRole("button", { name: "Прочитано", exact: true })
      .first()
      .press("Enter");
    await expect
      .poll(
        async () =>
          (
            await learner.request
              .get("/api/lms/notifications")
              .then((r) => r.json())
          ).unread,
      )
      .toBe(first.unread - 1);
    await learner
      .getByRole("button", { name: "Прочитать все", exact: true })
      .click();
    await expect(
      learner.getByText("Непрочитанные: 0", { exact: true }),
    ).toBeVisible();
    await learner.reload();
    await expect(
      learner.getByText("Непрочитанные: 0", { exact: true }),
    ).toBeVisible();
    let failOnce = true;
    await learner.route("**/api/lms/notifications?*", async (route) => {
      if (failOnce) {
        failOnce = false;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            code: "TEMPORARY",
            message: "Synthetic local retry",
          }),
        });
      } else await route.continue();
    });
    await learner.reload();
    await expect(
      learner
        .getByRole("alert")
        .filter({ hasText: /Не удалось/ })
        .first(),
    ).toBeVisible();
    await learner
      .getByRole("button", { name: "Повторить", exact: true })
      .click();
    await expect(
      learner.getByText("Непрочитанные: 0", { exact: true }),
    ).toBeVisible();
    for (const width of [360, 390, 768, 1440]) {
      await learner.setViewportSize({ width, height: 900 });
      expect(
        await learner.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await learner.screenshot({
        path: path.join(output, `learner-${width}-ru.png`),
        fullPage: true,
      });
    }
    await learner.getByRole("button", { name: "KZ", exact: true }).click();
    await expect(
      learner.getByRole("heading", { name: "Хабарламалар", exact: true }),
    ).toBeVisible();
    await learner.screenshot({
      path: path.join(output, "learner-kz.png"),
      fullPage: true,
    });
    await learner.getByRole("button", { name: "RU", exact: true }).click();
    const row = learner
      .locator(".lms-list li")
      .filter({ hasText: "Синтетическое событие" })
      .first();
    await row.getByRole("link", { name: "Открыть", exact: true }).click();
    await expect(learner).toHaveURL(
      new RegExp(`/learn/${fixture.enrollmentId}$`),
    );
    await expect(
      learner.getByRole("heading", {
        name: "Синтетическая программа безопасности",
        exact: true,
      }),
    ).toBeVisible();
    await login(employer, fixture.users.employer);
    await employer.goto("/lms/notifications");
    await expect(
      employer.getByRole("heading", { name: "Уведомления", exact: true }),
    ).toBeVisible();
    const employerInbox = await employer.request
      .get("/api/lms/notifications?pageSize=100")
      .then((r) => r.json());
    const old = employerInbox.items.find(
      (n: { sourceType: string }) => n.sourceType === "ENROLLMENT",
    );
    expect(!!old).toBe(true);
    await employer
      .getByRole("button", { name: "Прочитать все", exact: true })
      .click();
    await expect(
      employer.getByText("Непрочитанные: 0", { exact: true }),
    ).toBeVisible();
    await login(director, fixture.users.director);
    expect(
      (
        await post(
          director,
          `/api/employer-memberships/${fixture.membershipId}/revoke`,
        )
      ).ok(),
    ).toBe(true);
    expect(
      (await post(employer, `/api/lms/notifications/${old.id}/read`)).status(),
    ).toBe(404);
    const after = await employer.request
      .get("/api/lms/notifications?pageSize=100")
      .then((r) => r.json());
    expect(
      after.items.every(
        (n: { sourceType: string }) => n.sourceType === "ACCOUNT",
      ),
    ).toBe(true);
    await employer.reload();
    await expect(employer.getByText(/Синтетическое событие/)).toHaveCount(0);
    await employer.screenshot({
      path: path.join(output, "employer-revoked.png"),
      fullPage: true,
    });
    await writeFile(
      path.join(output, "UX_NOTIFICATIONS.json"),
      JSON.stringify(
        {
          status: "PASS",
          elapsedMs: Date.now() - started,
          actualAssignmentDelivered: true,
          paginationDistinct: true,
          readAndReadAllPersist: true,
          retry503: true,
          staleMessageAfterMembershipRevoke: 404,
          learnerDeepLink: true,
          viewports: [360, 390, 768, 1440],
          languages: ["ru", "kz"],
          fixture:
            "52 explicit synthetic history rows for pagination; actual ASSIGNED events delivered through real worker",
          externalSends: false,
        },
        null,
        2,
      ),
    );
  } finally {
    await learnerContext.close();
    await employerContext.close();
    await directorContext.close();
  }
});

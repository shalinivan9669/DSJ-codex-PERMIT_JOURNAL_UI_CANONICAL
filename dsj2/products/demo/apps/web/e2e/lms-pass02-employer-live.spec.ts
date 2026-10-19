import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const product = path.resolve(__dirname, "../../..");
const fixture = JSON.parse(
  readFileSync(
    process.env.DEMO_LMS_EMPLOYER_FIXTURE ||
      path.join(
        product,
        ".runtime/lms-pass02-operations-20261018/employer-browser-fixture.json",
      ),
    "utf8",
  ),
);
const output =
  process.env.DEMO_E2E_EVIDENCE ||
  path.join(
    product,
    "docs/evidence/lms-full-tz-pass-02-operations-20261018/employer-browser",
  );
async function login(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Электронная почта", { exact: true }).fill(user.email);
  await page.getByLabel("Пароль", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
test("N03/N04 employer bulk exceptions autosave automatic worker, filtered selection, profile and responsive language", async ({
  page,
}) => {
  const started = Date.now();
  page.setDefaultTimeout(20000);
  const actions: Record<string, unknown>[] = [];
  await mkdir(output, { recursive: true });
  await login(page, fixture.users.employer);
  await page.goto(
    `/lms/import?customerId=${fixture.customerId}&versionId=${fixture.courseVersionId}`,
  );
  await page
    .getByLabel("Добавление сотрудников", { exact: true })
    .selectOption("bulk");
  const prefix = `Synthetic browser ${Date.now()}`;
  const rows = Array.from({ length: 260 }, (_, i) =>
    [
      i === 0 ? "Synthetic existing 000" : i === 1 ? "" : `${prefix} ${i}`,
      "",
      `+7${String(Date.now() + i).slice(-10)}`,
      "",
      "Synthetic worker",
      "",
    ].join("\t"),
  );
  await page.getByLabel(/ФИО · ИИН · телефон/).fill(rows.join("\n"));
  await page
    .getByRole("button", { name: "Проверить список", exact: true })
    .click();
  await expect(
    page.getByText("Нужна проверка строк: 2", { exact: false }),
  ).toBeVisible();
  await page
    .getByLabel("Сопоставление · 1", { exact: true })
    .selectOption(fixture.knownRecipientId);
  await page.getByLabel("ФИО · 2", { exact: true }).fill(`${prefix} repaired`);
  await page.getByLabel("ФИО · 2", { exact: true }).press("Tab");
  await expect(page.getByText(/Сохранено/).first()).toBeVisible();
  await expect(
    page.getByText("Нужна проверка строк:", { exact: false }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("ФИО · 2", { exact: true })).toHaveValue(
    `${prefix} repaired`,
  );
  const draftId = new URL(page.url()).searchParams.get("id")!;
  await page
    .getByRole("button", { name: "Подтвердить и назначить", exact: true })
    .click();
  await expect(page.getByText(/Обработка завершена/)).toBeVisible({
    timeout: 120000,
  });
  const state = await page.request
    .get(`/api/lms/employer-import/${draftId}`)
    .then((response) => response.json());
  expect(state.assignment.cursor).toBe(260);
  expect(state.assignment.state).toBe("COMPLETED");
  actions.push({
    scenario: "260 row employer import",
    startState:
      "Employer member ASSIGN_TRAINING; published course and 300 known people from explicit API fixture",
    sequence: [
      "select bulk",
      "paste260 fields",
      "preview",
      "resolve existing row1",
      "correct missing name row2",
      "Tab autosave",
      "reload",
      "confirm automatically starts worker",
    ],
    clicks: 2,
    selects: 2,
    filledFields: 2,
    keyboard: 1,
    repeatedFields: 0,
    reloadsForEvidence: 1,
    manualPolling: 0,
    result: { importId: draftId, assigned: 260 },
  });
  await page.screenshot({
    path: path.join(output, "completed-desktop.png"),
    fullPage: true,
  });
  await page.goto("/lms/assign");
  await page
    .getByLabel("Найти сотрудника", { exact: true })
    .fill("Synthetic existing");
  await page
    .getByRole("button", { name: /Выбрать всю отфильтрованную выборку/ })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Выбрано: 300" }),
  ).toBeVisible();
  await page.getByLabel("Найти сотрудника", { exact: true }).fill(prefix);
  await expect(
    page.getByRole("status").filter({ hasText: /Выбрано:/ }),
  ).toHaveCount(0);
  actions.push({
    scenario: "all filtered selection",
    sequence: [
      "search known prefix",
      "select all300",
      "change filter resets selection",
    ],
    filledFields: 2,
    clicks: 1,
    result:
      "300 authorized IDs selected; no stale inclusion after changing filter",
  });
  await page.goto("/lms/profile");
  const name = page.getByLabel("Имя в кабинете", { exact: true });
  await expect(name).toBeVisible();
  let failed = false;
  await page.route("**/api/lms/profile", async (route) => {
    if (route.request().method() === "PUT" && !failed) {
      failed = true;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          code: "SERVICE_UNAVAILABLE",
          message: "Synthetic unavailable",
        }),
      });
    } else await route.continue();
  });
  await name.fill("Synthetic saved display");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(name).toHaveValue("Synthetic saved display");
  await page
    .getByRole("button", { name: "Повторить сохранение", exact: true })
    .click();
  await expect(page.getByText("Сохранено", { exact: true })).toBeVisible();
  await page.unroute("**/api/lms/profile");
  await page.reload();
  await expect(name).toHaveValue("Synthetic saved display");
  await page
    .getByLabel("Показывать счётчик непрочитанных", { exact: true })
    .uncheck();
  await expect(page.getByText("Сохранено", { exact: true })).toBeVisible();
  const profile = await page.request
    .get("/api/lms/profile")
    .then((response) => response.json());
  expect(profile.preferences.showUnreadBadge).toBe(false);
  expect(profile.email).toBe(fixture.users.employer.email);
  actions.push({
    scenario: "profile autosave503",
    sequence: [
      "change displayName",
      "503 retains value",
      "retry",
      "reload",
      "disable decorative unread count",
    ],
    filledFields: 1,
    clicks: 2,
    repeatedFields: 0,
    reloadsForEvidence: 1,
    result: "Only display name/preferences changed; verified email unchanged",
  });
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/lms/import?id=${draftId}`);
    await expect(page.getByText(/Обработка завершена/)).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: path.join(output, `import-${width}-ru.png`),
      fullPage: true,
    });
  }
  const language = page.getByRole("button", { name: "Қазақша", exact: true });
  if (await language.count()) {
    await language.click();
  } else {
    await page.getByRole("button", { name: "KZ", exact: true }).click();
  }
  await expect(page.getByText(/Өңдеу аяқталды/)).toBeVisible();
  await page.screenshot({
    path: path.join(output, "import-kz.png"),
    fullPage: true,
  });
  await writeFile(
    path.join(output, "UX_EMPLOYER.json"),
    JSON.stringify(
      {
        status: "PASS",
        capturedAt: new Date().toISOString(),
        elapsedMs: Date.now() - started,
        fixturePreparation:
          "Separate synthetic fixture script, not counted as UI entry",
        actions,
        viewports: [360, 390, 768, 1440],
        language: "RU and KZ final import states",
        limits:
          "Browser 503 injected locally; integration proves actual server scope/revocation/lease and formula rejection separately",
      },
      null,
      2,
    ),
  );
});

test("N03 import autosave preserves input through 503 and real concurrent revision conflict", async ({
  page,
}) => {
  page.setDefaultTimeout(20000);
  await mkdir(output, { recursive: true });
  await login(page, fixture.users.employer);
  await page.goto(
    `/lms/import?customerId=${fixture.customerId}&versionId=${fixture.courseVersionId}`,
  );
  const prefix = `Synthetic conflict ${Date.now()}`;
  await page.getByLabel("ФИО", { exact: true }).fill(prefix);
  await page
    .getByRole("button", { name: "Проверить список", exact: true })
    .click();
  const name = page.getByLabel("ФИО · 1", { exact: true });
  await expect(name).toHaveValue(prefix);
  const id = new URL(page.url()).searchParams.get("id")!;
  let failed = false;
  await page.route(`**/api/lms/employer-import/${id}`, async (route) => {
    if (route.request().method() === "PUT" && !failed) {
      failed = true;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ code: "SERVICE_UNAVAILABLE" }),
      });
    } else await route.continue();
  });
  await name.fill(`${prefix} retained503`);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(name).toHaveValue(`${prefix} retained503`);
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(page.getByText(/Сохранено/).first()).toBeVisible();
  await page.unroute(`**/api/lms/employer-import/${id}`);
  const current = await page.request
    .get(`/api/lms/employer-import/${id}`)
    .then((response) => response.json());
  const row = { ...current.rows[0] };
  delete row.preview;
  delete row.result;
  const session = await page.request
    .get("/api/auth/session")
    .then((response) => response.json());
  const remote = await page.request.put(`/api/lms/employer-import/${id}`, {
    headers: {
      origin: new URL(page.url()).origin,
      "x-csrf-token": session.csrfToken,
    },
    data: {
      revision: current.revision,
      rows: [{ ...row, positionRu: "Concurrent saved position" }],
    },
  });
  expect(remote.ok()).toBe(true);
  await name.fill(`${prefix} retained409`);
  await expect(
    page.getByRole("button", {
      name: "Сохранить исправленные строки",
      exact: true,
    }),
  ).toBeVisible();
  await expect(name).toHaveValue(`${prefix} retained409`);
  await page.getByText("Текущие сохранённые строки", { exact: true }).click();
  await expect(page.getByText(/Concurrent saved position/)).toBeVisible();
  await page.screenshot({
    path: path.join(output, "import-revision-conflict.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Сохранить исправленные строки", exact: true })
    .click();
  await expect(page.getByText(/Сохранено/).first()).toBeVisible();
  await page.reload();
  await expect(name).toHaveValue(`${prefix} retained409`);
  await writeFile(
    path.join(output, "UX_IMPORT_CONFLICT.json"),
    JSON.stringify(
      {
        status: "PASS",
        importId: id,
        injected503: true,
        actual409: true,
        repeatEntry: 0,
        explicitOverwriteAfterSavedValueShown: true,
        serverRevision: (
          await page.request
            .get(`/api/lms/employer-import/${id}`)
            .then((response) => response.json())
        ).revision,
      },
      null,
      2,
    ),
  );
});

import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import path from "node:path";
const product = path.resolve(__dirname, "../../..");
const fixture = JSON.parse(
  readFileSync(
    path.join(
      product,
      ".runtime/lms-pass02-operations-20261018/security-browser-fixture.json",
    ),
    "utf8",
  ),
);
const output =
  process.env.DEMO_E2E_EVIDENCE ||
  path.join(
    product,
    "docs/evidence/lms-full-tz-pass-02-operations-20261018/security-browser",
  );
test.use({ trace: "off", screenshot: "off", video: "off" });
function totp(secret: string, offset = 0) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret]
    .map((char) => alphabet.indexOf(char).toString(2).padStart(5, "0"))
    .join("");
  const bytes = Buffer.from(
    bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const digest = createHmac("sha1", bytes).update(counter).digest(),
    start = digest[digest.length - 1] & 15;
  return ((digest.readUInt32BE(start) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, "0");
}
async function login(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Электронная почта", { exact: true }).fill(user.email);
  await page.getByLabel("Пароль", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
}
test("N08 browser: fresh password, TOTP setup, one-time recovery, live mandatory-policy gate, masked RU/KZ/mobile", async ({
  browser,
}) => {
  await mkdir(output, { recursive: true });
  const started = Date.now();
  const directorContext = await browser.newContext(),
    operatorContext = await browser.newContext(),
    factorContext = await browser.newContext(),
    reuseContext = await browser.newContext();
  const director = await directorContext.newPage(),
    operator = await operatorContext.newPage(),
    factor = await factorContext.newPage(),
    reuse = await reuseContext.newPage();
  for (const page of [director, operator, factor, reuse]) {
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(60000);
  }
  try {
    await login(operator, fixture.users.operator);
    await expect(operator).not.toHaveURL(/\/login/);
    expect((await operator.request.get("/api/context")).status()).toBe(200);
    await login(director, fixture.users.director);
    await expect(director).not.toHaveURL(/\/login/);
    await director.goto("/security");
    await expect(
      director.getByRole("heading", {
        name: "Безопасность входа",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      director.getByRole("button", { name: "Продолжить", exact: true }),
    ).toBeEnabled();
    await director
      .getByLabel("Текущий пароль", { exact: true })
      .fill(fixture.users.director.password);
    let failOnce = true;
    await director.route("**/api/auth/mfa/reauth", async (route) => {
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
    await director.getByLabel("Текущий пароль", { exact: true }).press("Enter");
    await expect(
      director.getByRole("alert").filter({ hasText: /.+/ }).first(),
    ).toBeVisible();
    expect(
      (await director
        .getByLabel("Текущий пароль", { exact: true })
        .inputValue()) === fixture.users.director.password,
    ).toBe(true);
    await director
      .getByRole("button", { name: "Продолжить", exact: true })
      .click();
    const seedField = director.getByLabel("Ключ подключения", { exact: true });
    await expect(seedField).toBeVisible();
    const secret = await seedField.inputValue();
    await director.screenshot({
      path: path.join(output, "setup-key-masked.png"),
      fullPage: true,
      mask: [
        seedField,
        director.locator('input[autocomplete="one-time-code"]'),
      ],
    });
    await director
      .getByLabel("Код нового устройства", { exact: true })
      .fill(totp(secret));
    await director
      .getByLabel("Код нового устройства", { exact: true })
      .press("Enter");
    const recoveryField = director.getByLabel("Резервные коды", {
      exact: true,
    });
    await expect(recoveryField).toBeVisible();
    const codes = (await recoveryField.inputValue()).trim().split("\n");
    expect(codes.length).toBe(10);
    await director.screenshot({
      path: path.join(output, "recovery-codes-masked.png"),
      fullPage: true,
      mask: [recoveryField],
    });
    expect((await director.request.get("/api/context")).status()).toBe(401);
    await director
      .getByRole("link", { name: "Войти снова", exact: true })
      .click();
    await login(director, fixture.users.director);
    const challengeField = director.getByLabel(
      "Код приложения или резервный код",
      { exact: true },
    );
    await expect(challengeField).toBeVisible();
    expect((await director.request.get("/api/context")).status()).toBe(401);
    await challengeField.fill(codes[0]);
    await challengeField.press("Enter");
    await expect(director).not.toHaveURL(/\/login/);
    expect((await director.request.get("/api/context")).status()).toBe(200);
    await login(factor, fixture.users.director);
    const factorField = factor.getByLabel("Код приложения или резервный код", {
      exact: true,
    });
    await factorField.fill(totp(secret, 1));
    await factorField.press("Enter");
    await expect(factor).not.toHaveURL(/\/login/);
    await login(reuse, fixture.users.director);
    const reuseField = reuse.getByLabel("Код приложения или резервный код", {
      exact: true,
    });
    await reuseField.fill(codes[0]);
    await reuseField.press("Enter");
    await expect(
      reuse
        .getByRole("alert")
        .filter({ hasText: /Код|код/ })
        .first(),
    ).toBeVisible();
    expect((await reuse.request.get("/api/context")).status()).toBe(401);
    await reuseField.fill(codes[2]);
    await reuseField.press("Enter");
    await expect(reuse).not.toHaveURL(/\/login/);
    await director.goto("/security");
    await director
      .getByRole("combobox", { name: "Действие", exact: true })
      .selectOption("POLICY");
    await director
      .getByLabel("Текущий пароль", { exact: true })
      .fill(fixture.users.director.password);
    await director
      .getByLabel("Код приложения или резервный код", { exact: true })
      .fill(codes[1]);
    await director
      .getByRole("button", { name: "Продолжить", exact: true })
      .click();
    await expect(
      director.getByRole("option", {
        name: "Снять обязательность для сотрудников",
        exact: true,
      }),
    ).toBeAttached();
    const gated = await operator.request.get("/api/context");
    expect(gated.status()).toBe(403);
    expect((await gated.json()).code).toBe("MFA_SETUP_REQUIRED");
    await operator.reload();
    await expect(
      operator.getByText("Для вашей роли требуется второй фактор", {
        exact: true,
      }),
    ).toBeVisible();
    for (const width of [360, 390, 768, 1440]) {
      await operator.setViewportSize({ width, height: 900 });
      expect(
        await operator.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
      await operator.screenshot({
        path: path.join(output, `policy-${width}-ru.png`),
        fullPage: true,
        mask: [operator.locator("input")],
      });
    }
    await operator.getByRole("button", { name: "KZ", exact: true }).click();
    await expect(
      operator.getByRole("heading", { name: "Кіру қауіпсіздігі", exact: true }),
    ).toBeVisible();
    await operator.screenshot({
      path: path.join(output, "policy-kz.png"),
      fullPage: true,
      mask: [operator.locator("input")],
    });
    await writeFile(
      path.join(output, "UX_SECURITY.json"),
      JSON.stringify(
        {
          status: "PASS",
          elapsedMs: Date.now() - started,
          syntheticTenantId: fixture.tenantId,
          setupRequiresFreshPassword: true,
          setup503PreservesPassword: true,
          realTotpChallenge: true,
          recoverySingleUse: true,
          mandatoryPolicyBlocksExistingStaffSession: 403,
          noSessionBeforeSecondFactor: true,
          keyboardEnter: true,
          languages: ["ru", "kz"],
          widths: [360, 390, 768, 1440],
          evidenceContainsSecrets: false,
          secrets:
            "Only in browser memory; all manual screenshots masked; no traces/videos/automatic screenshots",
        },
        null,
        2,
      ),
    );
  } finally {
    await directorContext.close();
    await operatorContext.close();
    await factorContext.close();
    await reuseContext.close();
  }
});

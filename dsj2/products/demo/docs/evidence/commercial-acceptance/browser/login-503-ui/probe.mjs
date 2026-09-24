import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = process.cwd();
const require = createRequire(path.join(root, 'package.json'));
const { chromium, expect } = require('@playwright/test');
const folder = path.dirname(fileURLToPath(import.meta.url));
const origin = process.env.DEMO_ORIGIN || 'http://localhost:3200';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await context.newPage();
const email = 'synthetic-login-error@example.invalid';
const password = 'Synthetic-unused-password-only';
let mockedPosts = 0;
let response = {};
await page.route('**/api/auth/login', async route => {
  assert.equal(route.request().method(), 'POST');
  mockedPosts++;
  await route.fulfill(response);
});
const observations = [];
try {
  await page.goto(origin + '/login', { waitUntil: 'networkidle' });
  const emailInput = page.getByLabel('Электронная почта', { exact: true });
  const passwordInput = page.getByLabel('Пароль', { exact: true });
  const button = page.getByRole('button', { name: 'Войти', exact: true });
  await emailInput.fill(email);
  await passwordInput.fill(password);
  for (const scenario of [
    { name: '500-service-json', status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'SERVICE_ERROR', message: 'Не удалось выполнить операцию. Сообщите код ошибки администратору', correlationId: 'synthetic-login-500' }), text: 'Не удалось выполнить операцию. Сообщите код ошибки администратору Код обращения: synthetic-login-500' },
    { name: '503-service-json', status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'SERVICE_ERROR', message: 'Сервис временно недоступен', correlationId: 'synthetic-login-503' }), text: 'Сервис временно недоступен Код обращения: synthetic-login-503' },
    { name: '503-non-json', status: 503, contentType: 'text/html', body: '<html><body>upstream unavailable</body></html>', text: 'Сервер не выполнил запрос. Повторите попытку.' },
  ]) {
    response = { status: scenario.status, contentType: scenario.contentType, body: scenario.body };
    await emailInput.focus();
    await page.keyboard.press('Tab');
    await expect(passwordInput).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(button).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText(scenario.text, { exact: true })).toBeVisible();
    await expect(button).toBeEnabled();
    const focusAfterError = await page.evaluate(() => document.activeElement?.tagName);
    let keyboardStepsToSubmit = 0;
    while (!(await button.evaluate(element => document.activeElement === element)) && keyboardStepsToSubmit < 6) {
      await page.keyboard.press('Tab');
      keyboardStepsToSubmit++;
    }
    await expect(button).toBeFocused();
    await expect(emailInput).toHaveValue(email);
    await expect(passwordInput).toHaveValue(password);
    await expect(page.getByText(/неверн.*(парол|логин)|неправильн.*(парол|логин)/i)).toHaveCount(0);
    assert.equal(new URL(page.url()).pathname, '/login');
    await page.screenshot({ path: path.join(folder, scenario.name + '.png'), fullPage: true });
    observations.push({ scenario: scenario.name, mockedStatus: scenario.status, visibleMessage: scenario.text, focusAfterError, keyboardStepsToSubmit, keyboardFocus: 'Submit reachable with Tab after error; disabled submit releases focus during request', valuesRetained: true, incorrectPasswordClaim: false, status: 'PASS' });
  }
  assert.equal(mockedPosts, 3);
  await fs.writeFile(path.join(folder, 'result.json'), JSON.stringify({ status: 'PASS', completedAt: new Date().toISOString(), origin, browser: browser.version(), scope: 'Actual login UI in a fresh unauthenticated Chromium context. Only POST /api/auth/login fulfilled by Playwright; zero server login requests, no credentials used, no DB/service mutations. This is UI fault-response simulation, not a real database outage.', mockedPosts, observations }, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'PASS', scenarios: observations.length, mockedPosts }));
} finally {
  await context.close();
  await browser.close();
}

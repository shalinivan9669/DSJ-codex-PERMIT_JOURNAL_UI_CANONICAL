import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const mode = process.argv[2] || "before";
if (!["before", "after"].includes(mode)) throw new Error("Unknown stage");
const base = path.resolve("docs/evidence/functional-completion-20261019/run-01");
const data = JSON.parse(await fs.readFile(".runtime/functional-completion-20261019/run-01/populated.private.json", "utf8"));
const learner = data.learners[0];
const browser = await chromium.launch({channel: "chrome", headless: true});
const page = await browser.newPage({viewport: {width: 1280, height: 900}});
try {
  await page.goto(data.origin + "/login");
  await page.locator('input[type="email"]').fill(learner.email);
  await page.locator('input[type="password"]').fill(learner.password);
  await page.getByRole("button", {name: "Войти", exact: true}).click();
  await page.waitForURL(url => !url.pathname.includes("login"));
  const read = async () => {
    const response = await page.request.get(data.origin + "/api/lms/notifications?page=1&pageSize=100");
    expect(response.ok()).toBe(true);
    return response.json();
  };
  await page.goto(data.origin + "/lms/notifications");
  await page.getByRole("heading", {name: "Уведомления", exact: true}).waitFor();
  if (mode === "before") {
    const initial = await read();
    expect(initial.items.some(item => item.kind === "DOCUMENT_READY")).toBe(true);
    expect(initial.items.some(item => item.kind === "RESULT")).toBe(true);
    const mark = page.getByRole("button", {name: "Отметить прочитанным", exact: true}).first();
    if (await mark.isVisible()) {
      const response = page.waitForResponse(r => r.url().includes("/notifications/") && r.url().endsWith("/read") && r.request().method() === "POST");
      await mark.click();
      expect((await response).ok()).toBe(true);
    }
    const row = page.locator("li").filter({has: page.getByRole("link", {name:"Открыть",exact:true})}).first();
    const target = await row.getByRole("link", {name:"Открыть",exact:true}).getAttribute("href");
    await row.getByRole("link", {name:"Открыть",exact:true}).click();
    await expect(page).toHaveURL(new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await expect(page.getByRole("link", {name:"Скачать PDF",exact:true}).first()).toBeVisible();
    await page.goto(data.origin + "/lms/notifications");
    await page.getByRole("heading", {name: "Уведомления", exact: true}).waitFor();
    const snapshot = await read();
    await fs.writeFile(path.join(base, "NOTIFICATIONS_BEFORE.json"), JSON.stringify({capturedAt: new Date().toISOString(), uiReadAndOpen: true, snapshot}, null, 2));
  } else {
    const previous = JSON.parse(await fs.readFile(path.join(base, "NOTIFICATIONS_BEFORE.json"), "utf8"));
    const current = await read();
    const keys = item => [item.kind,item.sourceType,item.sourceId,item.eventId,item.enrollmentId].join(":");
    const preserved = previous.snapshot.items.map(item => {
      const now = current.items.find(value => value.id === item.id);
      expect(now).toBeTruthy();
      expect(now.readAt).toBe(item.readAt);
      expect(current.items.filter(value => keys(value) === keys(item))).toHaveLength(previous.snapshot.items.filter(value => keys(value) === keys(item)).length);
      return item.id;
    });
    await fs.writeFile(path.join(base, "NOTIFICATIONS_RESTART_RESULT.json"), JSON.stringify({status: "PASS", capturedAt: new Date().toISOString(), preservedIds: preserved, beforeTotal: previous.snapshot.total, afterTotal: current.total, readStatePreserved: true, unchangedSourcesNotDuplicated: true, scope:"Learner01 inbox from actual assignment, result and document events across full worker/API/web restart", externalDelivery: false}, null, 2));
  }
  await page.screenshot({path: path.join(base, `notifications-${mode}.png`), fullPage: true});
  console.log(`NOTIFICATIONS_${mode.toUpperCase()}_PASS`);
} finally {
  await browser.close();
}

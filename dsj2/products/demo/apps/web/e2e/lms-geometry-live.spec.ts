import { test, expect, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const product = path.resolve(__dirname, "../../..");
const evidence = process.env.DEMO_E2E_EVIDENCE
  ? path.resolve(process.env.DEMO_E2E_EVIDENCE, "lms-geometry-live")
  : path.join(
      product,
      "docs/evidence/lms-one-run-20261015/agent-b/geometry-live",
    );
async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Электронная почта", { exact: true }).fill(email);
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("Synthetic-LMS-only-20261015!");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
test("secondary LMS screens preserve readable RU and KZ controls at all four acceptance widths", async ({
  browser,
}) => {
  test.setTimeout(240000);
  await promisify(execFile)(
    process.execPath,
    [
      path.join(product, "node_modules/tsx/dist/cli.mjs"),
      "--tsconfig",
      "apps/api/tsconfig.json",
      "scripts/verification/lms-operator-fixture.ts",
      "--geometry",
    ],
    { cwd: product, env: process.env, timeout: 30000 },
  );
  const fixture = JSON.parse(
    await fs.readFile(
      path.join(product, ".runtime/lms-one-run/geometry-fixture.json"),
      "utf8",
    ),
  );
  await fs.mkdir(evidence, { recursive: true });
  const measurements: unknown[] = [];
  for (const role of ["director", "employer"] as const) {
    const context = await browser.newContext({
      baseURL: process.env.DEMO_ORIGIN,
    });
    const page = await context.newPage();
    await login(page, fixture[role]);
    const screens = [
      { name: "catalogue", path: "/lms" },
      { name: "assignment", path: "/lms/assign" },
      { name: "results", path: "/lms/results" },
      ...(role === "director"
        ? [
            { name: "editor", path: `/lms/courses/${fixture.draftCourseId}` },
            { name: "sanitary-settings", path: "/lms/sanitary" },
          ]
        : []),
    ];
    for (const screen of screens) {
      await page.goto(screen.path);
      await expect(page.locator(".lms-workspace h1")).toBeVisible();
      await page.getByRole("button", { name: "RU", exact: true }).click();
      if (screen.name === "catalogue")
        await page
          .getByText("Условия обучения", { exact: true })
          .first()
          .click();
      if (screen.name === "results") {
        await page
          .getByRole("button", { name: fixture.fullName, exact: true })
          .click();
        if (role === "director") {
          await page.getByText("Срок доступа", { exact: true }).click();
          await page.getByText("Доступ к обучению", { exact: true }).click();
        }
      }
      if (screen.name === "editor") {
        await page.getByText("Основание и оформление", { exact: true }).click();
        await page.getByText("Параметры теста", { exact: true }).click();
        await page.getByText("1. Вопрос 0", { exact: true }).click();
      }
      if (screen.name === "sanitary-settings") {
        await page.getByText("Параметры центра", { exact: true }).click();
        await page
          .getByText("Производственный календарь", { exact: true })
          .click();
        await page
          .getByText("Добавить версию календаря", { exact: true })
          .click();
      }
      for (const language of ["RU", "KZ"] as const) {
        await page.getByRole("button", { name: language, exact: true }).click();
        await expect(page.locator(".lms-workspace")).toHaveAttribute(
          "lang",
          language === "RU" ? "ru" : "kk",
        );
        for (const width of [360, 390, 768, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          const result = await page.evaluate(() => {
            const workspace = document.querySelector(".lms-workspace")!;
            const small = [
              ...workspace.querySelectorAll(
                "button,a.button,select,input:not([type=checkbox]):not([type=radio]),summary",
              ),
            ].flatMap((element) => {
              const box = element.getBoundingClientRect();
              if (!box.width || !box.height) return [];
              return box.height < 43.5
                ? [
                    {
                      label: element.textContent?.trim().slice(0, 80),
                      height: box.height,
                    },
                  ]
                : [];
            });
            const technicalStatuses = [
              ...workspace.querySelectorAll(".lms-status"),
            ]
              .map((element) => element.textContent || "")
              .filter((text) =>
                /(?:PAPER_ORIGINAL|CENTER_EXAM|NEEDS_REVIEW|NOT_CONNECTED|OPERATOR_ATTESTED|PREPARED|CONFIRMED)/.test(
                  text,
                ),
              );
            return {
              viewport: window.innerWidth,
              documentWidth: document.documentElement.scrollWidth,
              small,
              technicalStatuses,
              activeControls: workspace.querySelectorAll(
                "button,select,input,summary",
              ).length,
            };
          });
          expect(
            result.documentWidth,
            `${role}/${screen.name}/${language}/${width} page overflow`,
          ).toBeLessThanOrEqual(width + 1);
          expect(
            result.small,
            `${role}/${screen.name}/${language}/${width} touch height`,
          ).toEqual([]);
          expect(result.technicalStatuses).toEqual([]);
          const keyboardTarget = page.getByRole("button", {
            name: language,
            exact: true,
          });
          await keyboardTarget.focus();
          await page.keyboard.press("Tab");
          const focus = await page.evaluate(() => ({
            visible:
              !!document.activeElement &&
              document.activeElement !== document.body,
            outline: getComputedStyle(document.activeElement!).outlineStyle,
          }));
          expect(focus.visible).toBe(true);
          expect(focus.outline).not.toBe("none");
          await page.screenshot({
            path: path.join(
              evidence,
              `${role}-${screen.name}-${language}-${width}.png`,
            ),
            fullPage: false,
          });
          measurements.push({
            role,
            screen: screen.name,
            language,
            width,
            ...result,
            focus,
            keyboardActions: 1,
            manualRefresh: 0,
            dialogs: 0,
          });
        }
      }
    }
    await context.close();
  }
  await fs.writeFile(
    path.join(evidence, "geometry.json"),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        fixture:
          "fresh synthetic accounts, existing results and editable course",
        widths: [360, 390, 768, 1440],
        languages: ["RU", "KZ"],
        samples: measurements.length,
        measurements,
      },
      null,
      2,
    ),
  );
});

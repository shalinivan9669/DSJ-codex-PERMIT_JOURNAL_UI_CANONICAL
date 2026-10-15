import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

// Run after the actual operator document scenario. This script publishes only
// the already completed synthetic fixture's minimum registry records.
const product = process.cwd();
const links = JSON.parse(
  await fs.readFile(
    path.join(product, ".runtime/lms-one-run/public-links.json"),
    "utf8",
  ),
);
const evidence = path.join(
  product,
  "docs/evidence/lms-one-run-20261015/root-public-browser",
);
await fs.mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const rows = [];
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const privatePageHeaders = [];
  for (const pathname of ["/learn/invite", "/learn/recovery", links[0].path]) {
    const response = await context.request.get(
      new URL(pathname, process.env.DEMO_ORIGIN).href,
    );
    const headers = response.headers();
    if (
      headers["referrer-policy"] !== "no-referrer" ||
      !headers["cache-control"]?.includes("no-store") ||
      !headers["x-robots-tag"]?.includes("noindex")
    )
      throw new Error("PRIVATE_PAGE_HEADERS_MISSING");
    privatePageHeaders.push({
      route: pathname.startsWith("/verify/") ? "/verify/:token" : pathname,
      referrerPolicy: headers["referrer-policy"],
      cacheControl: headers["cache-control"],
      robots: headers["x-robots-tag"],
    });
  }
  for (const link of links) {
    for (const width of [360, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(new URL(link.path, process.env.DEMO_ORIGIN).href);
      await page.getByText(link.number, { exact: true }).waitFor();
      for (const language of ["ru", "kz"]) {
        await page
          .getByRole("button", {
            name: language === "ru" ? "RU" : "KZ",
            exact: true,
          })
          .click();
        await page
          .locator(`main[lang="${language === "ru" ? "ru" : "kk"}"]`)
          .waitFor();
        const text = await page.locator("main").innerText();
        if (!text.includes(link.labels[language]))
          throw new Error(`DOCUMENT_TYPE_MISSING:${link.type}:${language}`);
        if (
          !text.includes(
            language === "ru"
              ? "Информационная карточка"
              : "Ақпараттық карточка",
          )
        )
          throw new Error("LEGAL_FORM_MISSING");
        if (/Синтетический слушатель|@example\.test|\b\d{12}\b/.test(text))
          throw new Error("PRIVATE_SUBJECT_EXPOSED");
        const dimensions = await page.evaluate(() => ({
          viewport: innerWidth,
          width: document.documentElement.scrollWidth,
        }));
        if (dimensions.width > dimensions.viewport + 1)
          throw new Error(`PAGE_OVERFLOW:${width}`);
        const screenshot = `${link.type}-${width}-${language}.png`;
        await page.screenshot({
          path: path.join(evidence, screenshot),
          fullPage: true,
        });
        rows.push({
          documentType: link.type,
          width,
          language,
          numberVisible: true,
          legalFormVisible: true,
          privateSubjectAbsent: true,
          overflow: false,
          screenshot,
        });
      }
    }
  }
  await fs.writeFile(
    path.join(evidence, "results.json"),
    JSON.stringify(
      {
        status: "PASS",
        checkedAt: new Date().toISOString(),
        source:
          "Real three issued synthetic documents; public pages read without an authenticated session",
        rows,
        privatePageHeaders,
      },
      null,
      2,
    ),
  );
  console.log(`PUBLIC_BROWSER_PASS ${rows.length} views`);
} finally {
  await browser.close();
}

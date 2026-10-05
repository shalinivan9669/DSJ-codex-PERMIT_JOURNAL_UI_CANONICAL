import { chromium, expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { loginIsolated } from "./operator-full-fix-session";
import { draftPayload, newRecipient } from "../lib/types";
import { assignTrainingBundle } from "../lib/request-bundles";

test.use({ trace: "off" });
async function nativeViewportScreenshot(
  page: Page,
  file: string,
  factor: number,
) {
  if (factor === 1) return page.screenshot({ path: file });
  // Capture the native viewport without an emulated-DPR clip. Genuine browser
  // zoom changes Chrome's physical surface independently of Playwright options.
  const cdp = await page.context().newCDPSession(page);
  try {
    const capture = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
    });
    const bytes = Buffer.from(capture.data, "base64");
    expect(
      bytes.length,
      "The native viewport must contain rendered controls",
    ).toBeGreaterThan(5000);
    await fs.writeFile(file, bytes);
  } finally {
    await cdp.detach();
  }
}
test("UX06/11/21 genuine Chrome 200 percent zoom in a disposable native profile retains input, footer, and internal table scroll", async () => {
  const product = path.resolve(__dirname, "../../..");
  const evidence = process.env.DEMO_E2E_EVIDENCE
    ? path.join(process.env.DEMO_E2E_EVIDENCE, "ui")
    : path.join(product, "docs/evidence/operator-flow-full-fix-20261003/ui");
  await fs.mkdir(evidence, { recursive: true });
  const metrics: unknown[] = [];
  for (const factor of [1, 2]) {
    const profile = path.join(
      product,
      ".runtime/operator-flow-full-fix",
      `zoom-${factor}-${Date.now()}`,
    );
    await fs.mkdir(path.join(profile, "Default"), { recursive: true });
    const zoomLevel = Math.log(factor) / Math.log(1.2);
    await fs.writeFile(
      path.join(profile, "Default/Preferences"),
      JSON.stringify({ partition: { default_zoom_level: { x: zoomLevel } } }),
    );
    const context = await chromium.launchPersistentContext(profile, {
      channel: "chrome",
      headless: true,
      viewport: null,
      baseURL: process.env.DEMO_ORIGIN,
      args: ["--window-size=1440,1000", "--lang=en-US"],
    });
    try {
      const page = context.pages()[0] || (await context.newPage());
      await page.bringToFront();
      const headers = await loginIsolated(page);
      let data = {
        id: "fixture",
        revision: 0,
        status: "DRAFT",
        kind: "COMPANY" as const,
        title: `СИНТЕТИЧЕСКИЙ zoom ${factor}`,
        customerId: null,
        demoMode: true,
        schemaVersion: 2 as const,
        commonFields: { documentDate: "2026-10-03" },
        items: Array.from({ length: 10 }, (_, i) => ({
          ...newRecipient(),
          fullNameRu: `Синтетический Получатель ${i + 1} с длинным именем`,
          positionRu: "Синтетическая длинная должность для проверки читаемости",
          positionKz: "Көрнекі ұзын лауазым",
          workplaceRu: "Синтетическое предприятие",
          assignments: [],
        })),
      };
      for (const direction of ["BIOT", "PTM", "PB", "PS"] as const)
        data = assignTrainingBundle(
          data,
          data.items.map((item) => item.id),
          direction,
          "INDIVIDUAL",
        );
      const response = await page.request.post("/api/print-requests", {
        headers,
        data: draftPayload(data),
      });
      expect(response.ok(), await response.text()).toBe(true);
      const created = await response.json();
      const beforeDetailsResponse = await page.request.get(
        `/api/print-requests/${created.id}`,
      );
      expect(beforeDetailsResponse.ok()).toBe(true);
      const beforeDetails = await beforeDetailsResponse.json();
      await page.goto(`/requests/${created.id}/edit`);
      await expect(
        page.getByLabel("ФИО, строка 1", { exact: true }),
      ).toBeVisible();
      const measured = await page.evaluate(() => ({
        innerWidth,
        innerHeight,
        outerWidth,
        outerHeight,
        dpr: devicePixelRatio,
        visualScale: visualViewport?.scale,
        rootZoom: getComputedStyle(document.documentElement).zoom,
        bodyZoom: getComputedStyle(document.body).zoom,
        documentWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(measured.dpr).toBe(factor);
      expect(measured.visualScale).toBe(1);
      expect(measured.rootZoom).toBe("1");
      expect(measured.bodyZoom).toBe("1");
      expect(measured.documentWidth).toBeLessThanOrEqual(
        measured.clientWidth + 1,
      );
      await page
        .getByLabel("Должность / профессия / квалификация · KZ, строка 10", { exact: true })
        .focus();
      const focus = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement;
        const rect = element.getBoundingClientRect(),
          scroll = element
            .closest(".recipient-grid-scroll")!
            .getBoundingClientRect();
        const center = {
          x: (rect.left + rect.right) / 2,
          y: (rect.top + rect.bottom) / 2,
        };
        return {
          field: element.getAttribute("data-field-path"),
          center,
          uncovered: document.elementFromPoint(center.x, center.y) === element,
          insideScroll: rect.left >= scroll.left && rect.right <= scroll.right,
          scrollLeft: element.closest(".recipient-grid-scroll")!.scrollLeft,
        };
      });
      expect(focus.uncovered).toBe(true);
      expect(focus.insideScroll).toBe(true);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await nativeViewportScreenshot(
        page,
        path.join(evidence, `native-zoom-${factor * 100}-table.png`),
        factor,
      );
      await page
        .getByRole("button", { name: "Детали получателя 10", exact: true })
        .click();
      const modal = page.getByRole("dialog"),
        back = modal.getByRole("button", {
          name: "Вернуться к списку",
          exact: true,
        });
      await expect(back).toBeInViewport();
      await modal
        .locator("input:visible:not(:disabled),select:visible:not(:disabled)")
        .last()
        .focus();
      const active = modal
        .locator("input:visible:not(:disabled),select:visible:not(:disabled)")
        .last();
      await expect(active).toBeFocused();
      await expect
        .poll(() =>
          active.evaluate((element) => {
            const box = element.getBoundingClientRect();
            return (
              document.elementFromPoint(
                (box.left + box.right) / 2,
                (box.top + box.bottom) / 2,
              ) === element
            );
          }),
        )
        .toBe(true);
      await expect(back).toBeInViewport();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await nativeViewportScreenshot(
        page,
        path.join(evidence, `native-zoom-${factor * 100}-details.png`),
        factor,
      );
      const forms = modal.locator(".assignment-list > details");
      await expect(forms).toHaveCount(9);
      const lastForm = forms.last();
      await lastForm.locator(":scope > summary").press("Enter");
      await expect(lastForm).toHaveAttribute("open", "");
      await lastForm
        .getByRole("tab", { name: "Обучение и результат", exact: true })
        .click();
      const lastFormControl = lastForm
        .locator(
          "input[data-field-path]:visible:not(:disabled),select[data-field-path]:visible:not(:disabled),textarea[data-field-path]:visible:not(:disabled)",
        )
        .last();
      await lastFormControl.focus();
      await expect(lastFormControl).toBeFocused();
      await lastFormControl.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await expect(lastFormControl).toBeFocused();
      const lastFormGeometry = () =>
        lastFormControl.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          const dialog = element.closest("dialog")!;
          const footer = dialog
            .querySelector(".recipient-details-footer")!
            .getBoundingClientRect();
          const header = dialog
            .querySelector(".modal-head")!
            .getBoundingClientRect();
          return {
            path: element.getAttribute("data-field-path"),
            uncovered:
              document.elementFromPoint(
                (bounds.left + bounds.right) / 2,
                (bounds.top + bounds.bottom) / 2,
              ) === element,
            aboveFooter: bounds.bottom <= footer.top,
            belowHeader: bounds.top >= header.bottom,
          };
        });
      await expect
        .poll(async () => {
          const current = await lastFormGeometry();
          return (
            current.uncovered && current.aboveFooter && current.belowHeader
          );
        })
        .toBe(true);
      const lastFormMeasured = await lastFormGeometry();
      expect(lastFormMeasured.path).toMatch(/^items\.9\.assignments\.8\./);
      await expect(back).toBeInViewport();
      await nativeViewportScreenshot(
        page,
        path.join(evidence, `native-zoom-${factor * 100}-last-form.png`),
        factor,
      );
      await back.click();
      await expect(modal).toHaveCount(0);
      const afterDetailsResponse = await page.request.get(
        `/api/print-requests/${created.id}`,
      );
      expect(afterDetailsResponse.ok()).toBe(true);
      const afterDetails = await afterDetailsResponse.json();
      expect(afterDetails.items).toEqual(beforeDetails.items);
      expect(afterDetails.events).toEqual(beforeDetails.events);
      expect(afterDetails.commonFields).toEqual(beforeDetails.commonFields);
      expect(afterDetails.revision).toBe(beforeDetails.revision);
      metrics.push({
        factor,
        zoomLevel,
        method:
          "Native Chrome partition.default_zoom_level in an isolated profile; no metrics/DPR/CSS emulation",
        measured,
        focus,
        lastFormMeasured,
        savedDataUnchanged: true,
        requestId: created.id,
      });
    } finally {
      await context.close();
    }
  }
  await fs.writeFile(
    path.join(evidence, "native-zoom-acceptance.json"),
    JSON.stringify(
      {
        source:
          "https://chromium.googlesource.com/chromium/src/+/lkgr/chrome/browser/ui/zoom/chrome_zoom_level_prefs.cc",
        metrics,
      },
      null,
      2,
    ),
  );
});

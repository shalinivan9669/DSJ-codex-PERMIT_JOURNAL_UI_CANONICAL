import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const product = path.resolve(__dirname, "../../..");
const requireFromApi = createRequire(
  path.join(product, "apps/api/package.json"),
);
const sharp = requireFromApi("sharp");
// tsx already ships the bundler; exercise the real component with isolated
// network fault injection, without adding a test route to the shipped app.
const requireFromTsx = createRequire(require.resolve("tsx/package.json"));
const build = requireFromTsx("esbuild").build as (
  options: Record<string, unknown>,
) => Promise<{ outputFiles: { text: string }[] }>;
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    path.join(
      product,
      "docs/evidence/operator-details-ux-20261005/photo-component",
    ),
);
let bundle: string;
let css: string;
let png: Buffer;
let jpeg6: Buffer;
let jpeg8: Buffer;

test.beforeAll(async () => {
  await fs.mkdir(evidence, { recursive: true });
  css = await fs.readFile(
    path.join(product, "apps/web/app/globals.css"),
    "utf8",
  );
  bundle = (
    await build({
      absWorkingDir: path.join(product, "apps/web"),
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      jsx: "automatic",
      stdin: {
        resolveDir: path.join(product, "apps/web"),
        loader: "tsx",
        contents: `
      import {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {PhotoDialog} from './components/photo-dialog';
      import * as helpers from './lib/photo-crop';
      import {api} from './lib/api';
      window.photoHelpers=helpers;
      function Harness() {
        const [person,setPerson]=useState('A'); const [open,setOpen]=useState(true);
        const [saved,setSaved]=useState('unchanged');
        return <main><button onClick={()=>setOpen(true)}>Открыть фото</button>
          <button onClick={()=>{setPerson('B');setOpen(true)}}>Другой человек</button>
          <output aria-label="Сохранённое фото">{saved}</output>
          {open && <PhotoDialog key={person} onClose={()=>setOpen(false)} onSaved={async(id,{signal})=>{
            await api('/photo-attachment',{method:'POST',body:JSON.stringify({id,person}),signal});
            if(signal.aborted) throw new Error('Отменено'); setSaved(person+':'+id);
          }}/>}</main>
      }
      createRoot(document.getElementById('root')).render(<Harness/>);`,
      },
    })
  ).outputFiles[0].text;
  const source = Buffer.from(
    `<svg width="600" height="800"><rect width="600" height="800" fill="#ffffff"/><rect width="300" height="400" fill="#f02030"/><rect x="300" width="300" height="400" fill="#20d050"/><rect y="400" width="300" height="400" fill="#2050e0"/><rect x="300" y="400" width="300" height="400" fill="#e0b020"/><circle cx="300" cy="400" r="70" fill="#151515"/></svg>`,
  );
  png = await sharp(source).png().toBuffer();
  jpeg6 = await sharp(png).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  jpeg8 = await sharp(png).jpeg().withMetadata({ orientation: 8 }).toBuffer();
});

async function open(page: Page) {
  await page.route("http://photo-component.test/**", async (route) => {
    if (route.request().url().endsWith("/api/photos"))
      return route.fulfill({ json: { assetId: "synthetic-photo" } });
    if (route.request().url().endsWith("/api/photo-attachment"))
      return route.fulfill({ json: { saved: true } });
    return route.fulfill({
      contentType: "text/html",
      body: `<html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"/><style>${css}</style></head><body><div id="root"></div><script>${bundle}</script></body></html>`,
    });
  });
  await page.goto("http://photo-component.test/");
  await expect(
    page.getByRole("dialog", { name: "Фото для печати" }),
  ).toBeVisible();
}
async function choose(page: Page, bytes = png, name = "synthetic.png") {
  await page.getByLabel("Выбрать фотографию").setInputFiles({
    name,
    mimeType: name.endsWith("png") ? "image/png" : "image/jpeg",
    buffer: bytes,
  });
}

test("valid-invalid-valid and same-file reselection never retain a rejected candidate", async ({
  page,
}) => {
  await open(page);
  await choose(page);
  await expect(
    page.getByRole("button", { name: "Сохранить фото", exact: true }),
  ).toBeEnabled();
  await choose(page, Buffer.alloc(5 * 1024 * 1024 + 1), "too-large.png");
  await expect(page.getByText(/Файл больше 5 МБ/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Сохранить фото", exact: true }),
  ).toBeDisabled();
  await expect(page.locator("canvas")).toHaveCount(0);
  await choose(page);
  await expect(
    page.getByRole("button", { name: "Сохранить фото", exact: true }),
  ).toBeEnabled();
  await choose(page, Buffer.from("corrupt image"));
  await expect(page.getByText(/исправный PNG или JPEG/)).toBeVisible();
  await choose(page);
  await expect(
    page.getByRole("button", { name: "Сохранить фото", exact: true }),
  ).toBeEnabled();
  await choose(page);
  await expect(
    page.getByRole("button", { name: "Сохранить фото", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Сохранить фото", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("Сохранённое фото")).toHaveText(
    "A:synthetic-photo",
  );
});

test("PNG/JPEG limits and 20MP crop movements use only the prepared bitmap and small output canvas", async ({
  page,
  browser,
}) => {
  await open(page);
  await page.evaluate(() => {
    const w = window as any;
    w.photoBitmaps = [];
    w.photoCanvases = [];
    const decode = window.createImageBitmap.bind(window);
    window.createImageBitmap = (async (...args: any[]) => {
      const bitmap = await (decode as any)(...args);
      w.photoBitmaps.push({ width: bitmap.width, height: bitmap.height });
      return bitmap;
    }) as typeof createImageBitmap;
    const context = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: any[]
    ) {
      w.photoCanvases.push({ width: this.width, height: this.height });
      return (context as any).apply(this, args);
    } as typeof context;
  });
  const bigPng = await sharp({
    create: { width: 5000, height: 4000, channels: 3, background: "#307080" },
  })
    .png()
    .toBuffer();
  const bigJpeg = await sharp(bigPng).jpeg().toBuffer();
  const tooManyPixels = await sharp({
    create: { width: 5001, height: 4000, channels: 3, background: "#307080" },
  })
    .png()
    .toBuffer();
  const raw = Buffer.alloc(1320 * 1320 * 3);
  let random = 98123456;
  for (let i = 0; i < raw.length; i++) {
    random ^= random << 13;
    random ^= random >>> 17;
    random ^= random << 5;
    raw[i] = random & 255;
  }
  const nearBytesPng = await sharp(raw, {
    raw: { width: 1320, height: 1320, channels: 3 },
  })
    .png()
    .toBuffer();
  expect(nearBytesPng.length).toBeGreaterThan(5 * 1024 * 1024 * 0.99);
  expect(nearBytesPng.length).toBeLessThanOrEqual(5 * 1024 * 1024);
  for (const [name, bytes] of [
    ["20mp.png", bigPng],
    ["20mp.jpg", bigJpeg],
    ["near5mib.png", nearBytesPng],
  ] as const) {
    await choose(page, bytes, name);
    await expect(
      page.getByRole("button", { name: "Сохранить фото", exact: true }),
    ).toBeEnabled();
    for (const x of [0, 27, 73, 100])
      await page.getByLabel("По горизонтали", { exact: true }).fill(String(x));
  }
  await choose(page, tooManyPixels, "above20mp.png");
  await expect(page.getByText(/превышает 20 мегапикселей/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Сохранить фото", exact: true }),
  ).toBeDisabled();
  await choose(page);
  await expect(
    page.getByRole("button", { name: "Сохранить фото", exact: true }),
  ).toBeEnabled();
  const allocations = await page.evaluate(() => ({
    bitmaps: (window as any).photoBitmaps,
    canvases: (window as any).photoCanvases,
  }));
  expect(allocations.bitmaps).toHaveLength(4);
  expect(
    allocations.bitmaps.every(
      (size: { width: number; height: number }) =>
        Math.max(size.width, size.height) <= 1600,
    ),
  ).toBe(true);
  expect(
    allocations.canvases.every(
      (size: { width: number; height: number }) =>
        size.width * size.height <= 120000,
    ),
  ).toBe(true);
  await fs.writeFile(
    path.join(evidence, "boundaries-and-allocations.json"),
    JSON.stringify(
      {
        status: "PASS",
        browser: browser.version(),
        pngNearByteLimit: nearBytesPng.length,
        png20mp: bigPng.length,
        jpeg20mp: bigJpeg.length,
        overPixelLimitRejected: true,
        allocations,
      },
      null,
      2,
    ),
  );
});

test("429, 503 and network failure recover; failed attachment retries the accepted asset without reupload", async ({
  page,
}) => {
  await open(page);
  let postCount = 0;
  await page.route("**/api/photos", async (route) => {
    postCount++;
    if (postCount === 1)
      return route.fulfill({ status: 413, json: { message: "too large" } });
    if (postCount === 2)
      return route.fulfill({ status: 429, json: { message: "throttle" } });
    if (postCount === 3)
      return route.fulfill({ status: 503, json: { message: "unavailable" } });
    if (postCount === 4) return route.abort("connectionfailed");
    return route.fulfill({ json: { assetId: "accepted-once" } });
  });
  let attachments = 0;
  await page.route("**/api/photo-attachment", async (route) => {
    attachments++;
    return attachments === 1
      ? route.fulfill({
          status: 503,
          json: { message: "Сохранение заявки недоступно" },
        })
      : route.fulfill({ json: { saved: true } });
  });
  await choose(page);
  for (const message of [
    /Файл больше допустимого размера 5 МБ/,
    /ограничил частоту/,
    /временно недоступен/,
    /Нет связи с сервером/,
    /не прикреплено к заявке/,
  ]) {
    await page
      .getByRole("button", { name: "Сохранить фото", exact: true })
      .click();
    await expect(page.getByText(message)).toBeVisible();
    await expect(page.getByLabel("Сохранённое фото")).toHaveText("unchanged");
  }
  await page
    .getByRole("button", { name: "Повторить прикрепление", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(postCount).toBe(5);
  expect(attachments).toBe(2);
  await expect(page.getByLabel("Сохранённое фото")).toHaveText(
    "A:accepted-once",
  );
});

test("POST timeout, stop and close invalidate late responses and unlock controls", async ({
  page,
}) => {
  await open(page);
  await page.clock.install();
  const pending: import("@playwright/test").Route[] = [];
  await page.route("**/api/photos", (route) => {
    pending.push(route);
  });
  await choose(page);
  await page
    .getByRole("button", { name: "Сохранить фото", exact: true })
    .click();
  await expect(page.getByLabel("Выбрать фотографию")).toBeDisabled();
  await expect(page.getByLabel("Масштаб", { exact: true })).toBeDisabled();
  await page.clock.fastForward(65_001);
  await expect(page.getByText(/не ответил за 65 секунд/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Сохранить фото", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Сохранить фото", exact: true })
    .click();
  await page.getByRole("button", { name: "Остановить", exact: true }).click();
  await expect(page.getByText(/Загрузка остановлена/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Сохранить фото", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Сохранить фото", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Закрыть диалог", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Другой человек", exact: true })
    .click();
  for (const route of pending)
    await route.fulfill({ json: { assetId: "late-A" } }).catch(() => {});
  await expect(page.getByLabel("Сохранённое фото")).toHaveText("unchanged");
  await expect(page.locator("canvas")).toHaveCount(0);
  await page.unroute("**/api/photos");
  await choose(page);
  await page
    .getByRole("button", { name: "Сохранить фото", exact: true })
    .click();
  await expect(page.getByLabel("Сохранённое фото")).toHaveText(
    "B:synthetic-photo",
  );
});

test("processing timeout and rapid replacement discard late bitmap results", async ({
  page,
}) => {
  await open(page);
  await page.clock.install();
  await page.evaluate(() => {
    const w = window as any;
    const native = window.createImageBitmap.bind(window);
    w.photoDecodes = [];
    w.closedBitmaps = 0;
    window.createImageBitmap = ((...args: any[]) =>
      new Promise((resolve) => {
        w.photoDecodes.push(async () => {
          const bitmap = await (native as any)(...args);
          const close = bitmap.close.bind(bitmap);
          bitmap.close = () => {
            w.closedBitmaps++;
            close();
          };
          resolve(bitmap);
        });
      })) as typeof createImageBitmap;
  });
  await choose(page);
  await expect(page.getByRole("dialog").getByRole("status")).toHaveText(
    "Обрабатываем фотографию…",
  );
  await expect
    .poll(() => page.evaluate(() => (window as any).photoDecodes.length))
    .toBe(1);
  await page.clock.fastForward(15_001);
  await expect(page.getByText(/больше 15 секунд/)).toBeVisible();
  await choose(page, jpeg6, "exif6.jpg");
  await expect
    .poll(() => page.evaluate(() => (window as any).photoDecodes.length))
    .toBe(2);
  await choose(page, jpeg8, "exif8.jpg");
  await expect
    .poll(() => page.evaluate(() => (window as any).photoDecodes.length))
    .toBe(3);
  await page.evaluate(async () => {
    const q = (window as any).photoDecodes;
    await q[2]();
    await q[0]();
    await q[1]();
  });
  await expect(
    page.getByRole("button", { name: "Сохранить фото", exact: true }),
  ).toBeEnabled();
  await expect
    .poll(() => page.evaluate(() => (window as any).closedBitmaps))
    .toBe(2);
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).closedBitmaps))
    .toBe(3);
});

test("EXIF 6/8, rotations and original crop coordinates match server normalization", async ({
  page,
}) => {
  await open(page);
  const comparisons = [];
  for (const [orientation, bytes] of [
    [1, png],
    [6, jpeg6],
    [8, jpeg8],
  ] as const) {
    await choose(
      page,
      bytes,
      orientation === 1 ? "normal.png" : `exif${orientation}.jpg`,
    );
    await expect(
      page.getByRole("button", { name: "Сохранить фото", exact: true }),
    ).toBeEnabled();
    for (const rotation of [0, 90, 180, 270]) {
      await page
        .getByLabel("Поворот", { exact: true })
        .selectOption(String(rotation));
      await page.getByLabel("Масштаб", { exact: true }).fill("1.55");
      await page.getByLabel("По горизонтали", { exact: true }).fill("27");
      await page.getByLabel("По вертикали", { exact: true }).fill("73");
      const result = await page.evaluate(
        ({ rotation, orientation }) => {
          const helpers = (window as any).photoHelpers;
          const size =
            orientation >= 5
              ? { width: 800, height: 600 }
              : { width: 600, height: 800 };
          const crop = helpers.photoCrop(size, rotation, 1.55, 27, 73);
          return {
            crop,
            image: document
              .querySelector("canvas")!
              .toDataURL("image/png")
              .split(",")[1],
          };
        },
        { rotation, orientation },
      );
      // This is the exact autoOrient -> explicit rotation -> extract chain in uploadPhoto.
      const reference = await sharp(bytes)
        .autoOrient()
        .rotate(rotation)
        .extract({
          left: result.crop.x,
          top: result.crop.y,
          width: result.crop.width,
          height: result.crop.height,
        })
        .resize(300, 400, { fit: "fill" })
        .removeAlpha()
        .raw()
        .toBuffer();
      const actual = await sharp(Buffer.from(result.image, "base64"))
        .removeAlpha()
        .raw()
        .toBuffer();
      let difference = 0;
      for (let i = 0; i < actual.length; i++)
        difference += Math.abs(actual[i] - reference[i]);
      const meanError = difference / actual.length;
      expect(
        meanError,
        `EXIF ${orientation}, rotation ${rotation}`,
      ).toBeLessThan(4);
      comparisons.push({
        orientation,
        rotation,
        meanChannelDifference: meanError,
        crop: result.crop,
      });
    }
  }
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 768, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(
      page.getByRole("button", { name: "Сохранить фото", exact: true }),
    ).toBeInViewport();
    await page.screenshot({
      path: path.join(evidence, `photo-${viewport.width}.png`),
    });
  }
  await fs.writeFile(
    path.join(evidence, "crop-coordinate-comparison.json"),
    JSON.stringify(
      {
        status: "PASS",
        network:
          "isolated fault-injection component harness; server normalization algorithm exercised through Sharp",
        comparisons,
      },
      null,
      2,
    ),
  );
});

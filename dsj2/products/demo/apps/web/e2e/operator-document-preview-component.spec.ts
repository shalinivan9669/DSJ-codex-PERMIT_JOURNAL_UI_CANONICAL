import { test, expect, type Page, type Route } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pdfObjects, pdfStream } from "../../../tests/fixtures/pdf";

const product = path.resolve(__dirname, "../../..");
const webRequire = createRequire(path.join(product, "apps/web/package.json"));
const bundleWith = createRequire(require.resolve("tsx/package.json"))(
  "esbuild",
).build;
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    path.join(
      product,
      "docs/evidence/operator-details-ux-20261005/preview-component",
    ),
);
let bundle: string;
let worker: Buffer;
let css: string;
const targetA = {
  kind: "ASSIGNMENT",
  rowId: "row-a",
  assignmentId: "assignment-a",
};
const targetB = {
  kind: "ASSIGNMENT",
  rowId: "row-b",
  assignmentId: "assignment-b",
};
const done = (id: string) => ({
  id: `job-${id}`,
  kind: "PDF",
  status: "SUCCEEDED",
  artifactId: id,
  sourceRevision: 7,
});
const pending = (id: string) => ({
  id: `job-${id}`,
  kind: "PDF",
  status: "QUEUED",
  sourceRevision: 7,
});
function pdf(color = "0 0.7 0.2") {
  return pdfObjects([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R >>",
    pdfStream(Buffer.from(`${color} rg 0 0 100 100 re f\n`)),
  ]);
}
test.beforeAll(async () => {
  await fs.mkdir(evidence, { recursive: true });
  worker = await fs.readFile(
    path.join(
      path.dirname(webRequire.resolve("pdfjs-dist")),
      "pdf.worker.min.mjs",
    ),
  );
  css = await fs.readFile(
    path.join(product, "apps/web/app/globals.css"),
    "utf8",
  );
  bundle = (
    await bundleWith({
      absWorkingDir: path.join(product, "apps/web"),
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      jsx: "automatic",
      target: "es2022",
      stdin: {
        resolveDir: path.join(product, "apps/web"),
        loader: "tsx",
        contents: `
      import {useState} from 'react'; import {createRoot} from 'react-dom/client';
      import {DocumentPreview} from './components/document-preview';
      const draft={items:[{id:'row-a',fullNameRu:'Человек А',fullNameKz:'',assignments:[{id:'assignment-a',templateId:'pb-card'}]}, {id:'row-b',fullNameRu:'Человек Б',fullNameKz:'',assignments:[{id:'assignment-b',templateId:'pb-card'}]}],events:[{id:'event',title:'Общий состав',protocolTemplateId:'pb-protocol'}]};
      function Harness(){const [revision,setRevision]=useState(7); const [hash,setHash]=useState('immutable-hash-one');
        return <main><button onClick={()=>setRevision(r=>r+1)}>Новая редакция</button><button onClick={()=>setHash('immutable-hash-two')}>Другой снимок</button>
          <DocumentPreview requestId='request' draft={draft} samples source={{revision,proposalId:'proposal',expectedProposalHash:hash}}/>
        </main>}
      createRoot(document.getElementById('root')).render(<Harness/>);`,
      },
    })
  ).outputFiles[0].text;
});

async function open(page: Page) {
  await page.route("http://preview-component.test/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("pdf.worker.min.mjs"))
      return route.fulfill({ contentType: "text/javascript", body: worker });
    if (pathname === "/harness.js")
      return route.fulfill({ contentType: "text/javascript", body: bundle });
    if (pathname.startsWith("/api/artifacts/"))
      return route.fulfill({ contentType: "application/pdf", body: pdf() });
    if (pathname === "/api/jobs")
      return route.fulfill({ json: { items: [done("B")], total: 1 } });
    if (pathname.endsWith("/preview"))
      return route.fulfill({ json: { jobs: [done("B")] } });
    if (pathname.endsWith("/retry"))
      return route.fulfill({ json: { status: "QUEUED" } });
    return route.fulfill({
      contentType: "text/html",
      body: `<html lang="ru"><head><style>${css}</style></head><body><div id="root"></div><script type="module" src="/harness.js"></script></body></html>`,
    });
  });
  await page.goto("http://preview-component.test/");
  await expect(
    page.getByRole("button", { name: "Создать предпросмотр", exact: true }),
  ).toBeVisible();
}
const chooseB = (page: Page) =>
  page.getByRole("combobox").first().selectOption(JSON.stringify(targetB));
const create = (page: Page) =>
  page
    .getByRole("button", { name: "Создать предпросмотр", exact: true })
    .click();
const ready = (page: Page) =>
  expect(
    page.getByRole("img", { name: "Страница 1 из 1", exact: true }),
  ).toBeVisible();

test("A to B during POST and polling never displays A's late PDF as B", async ({
  page,
}) => {
  await open(page);
  const stalePosts: Route[] = [];
  const artifacts: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/artifacts/"))
      artifacts.push(request.url());
  });
  await page.route("**/api/print-requests/request/preview", (route) => {
    if (route.request().postDataJSON().target.rowId === "row-a") {
      stalePosts.push(route);
      return;
    }
    return route.fulfill({ json: { jobs: [done("B")] } });
  });
  await create(page);
  await expect.poll(() => stalePosts.length).toBe(1);
  await chooseB(page);
  await create(page);
  await ready(page);
  await stalePosts[0].fulfill({ json: { jobs: [done("A")] } }).catch(() => {});
  await expect(
    page.getByRole("link", { name: "Открыть PDF", exact: true }),
  ).toHaveAttribute("href", "/api/artifacts/B?inline=1");
  expect(artifacts.some((url) => url.includes("/A?"))).toBe(false);
  await page
    .getByRole("combobox")
    .first()
    .selectOption(JSON.stringify(targetA));
  const stalePolls: Route[] = [];
  await page.unroute("**/api/print-requests/request/preview");
  await page.route("**/api/print-requests/request/preview", (route) =>
    route.fulfill({
      json: {
        jobs: [
          route.request().postDataJSON().target.rowId === "row-a"
            ? pending("A")
            : done("B"),
        ],
      },
    }),
  );
  await page.route("**/api/jobs?**", (route) => {
    stalePolls.push(route);
  });
  await create(page);
  await expect.poll(() => stalePolls.length).toBe(1);
  await chooseB(page);
  await page.unroute("**/api/jobs?**");
  await create(page);
  await ready(page);
  await stalePolls[0]
    .fulfill({ json: { items: [done("A")], total: 1 } })
    .catch(() => {});
  await expect(
    page.getByRole("link", { name: "Открыть PDF", exact: true }),
  ).toHaveAttribute("href", "/api/artifacts/B?inline=1");
  expect(artifacts.some((url) => url.includes("/A?"))).toBe(false);
});

test("revision and immutable proposal hash are sent with identity target and invalidate every old artifact", async ({
  page,
}) => {
  await open(page);
  const payloads: any[] = [];
  await page.route("**/api/print-requests/request/preview", (route) => {
    payloads.push(route.request().postDataJSON());
    return route.fulfill({ json: { jobs: [done("B")] } });
  });
  await create(page);
  await ready(page);
  expect(payloads[0]).toEqual({
    expectedRevision: 7,
    proposalId: "proposal",
    expectedProposalHash: "immutable-hash-one",
    target: targetA,
  });
  await page
    .getByRole("button", { name: "Новая редакция", exact: true })
    .click();
  await expect(page.getByRole("img")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Открыть PDF", exact: true }),
  ).toHaveCount(0);
  await create(page);
  await ready(page);
  expect(payloads[1].expectedRevision).toBe(8);
  await page
    .getByRole("button", { name: "Другой снимок", exact: true })
    .click();
  await expect(page.getByRole("img")).toHaveCount(0);
  await create(page);
  await ready(page);
  expect(payloads[2].expectedProposalHash).toBe("immutable-hash-two");
  await page
    .getByRole("button", {
      name: "Посмотреть образцы PDF и общие протоколы",
      exact: true,
    })
    .click();
  await expect.poll(() => payloads.length).toBe(4);
  expect(payloads[3]).toEqual({
    expectedRevision: 8,
    proposalId: "proposal",
    expectedProposalHash: "immutable-hash-two",
  });
});

test("FAILED uses the existing retry endpoint before requesting the same target again", async ({
  page,
}) => {
  await open(page);
  const order: string[] = [];
  let failed = true;
  const failedJob = { ...pending("failed"), status: "FAILED" };
  await page.route("**/api/print-requests/request/preview", (route) => {
    order.push("preview");
    return route.fulfill({ json: { jobs: [failed ? failedJob : done("B")] } });
  });
  await page.route("**/api/jobs?**", (route) =>
    route.fulfill({
      json: { items: [failed ? failedJob : done("B")], total: 1 },
    }),
  );
  await page.route("**/api/jobs/job-failed/retry", (route) => {
    order.push("retry");
    failed = false;
    return route.fulfill({ json: { status: "QUEUED" } });
  });
  await create(page);
  await expect(
    page.getByText("Не удалось подготовить документ. Повторите подготовку.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Повторить предпросмотр", exact: true })
    .click();
  await ready(page);
  expect(order).toEqual(["preview", "retry", "preview"]);
});

test("missing jobs and repeated HTTP failures stop after bounded attempts and permit retry", async ({
  page,
}) => {
  await open(page);
  await page.clock.install();
  let requests = 0;
  let mode = "missing";
  await page.route("**/api/print-requests/request/preview", (route) =>
    route.fulfill({ json: { jobs: [pending("B")] } }),
  );
  await page.route("**/api/jobs?**", (route) => {
    requests++;
    return mode === "http"
      ? route.fulfill({ status: 503, json: { message: "Временно недоступно" } })
      : route.fulfill({ json: { items: [], total: 0 } });
  });
  await create(page);
  for (let expected = 1; expected <= 3; expected++) {
    await expect.poll(() => requests).toBe(expected);
    if (expected < 3) await page.clock.fastForward(2001);
  }
  await expect(
    page.getByText(/Задание предпросмотра не найдено/),
  ).toBeVisible();
  await page.clock.fastForward(60_000);
  expect(requests).toBe(3);
  mode = "http";
  requests = 0;
  await page
    .getByRole("button", { name: "Повторить предпросмотр", exact: true })
    .click();
  for (let expected = 1; expected <= 3; expected++) {
    await expect.poll(() => requests).toBe(expected);
    if (expected < 3) await page.clock.fastForward(3001);
  }
  await expect(
    page.getByText("Временно недоступно", { exact: true }),
  ).toBeVisible();
  await page.clock.fastForward(60_000);
  expect(requests).toBe(3);
});

test("queued retry with retained artifact identity hides old PDF and DOCX until successful", async ({
  page,
}) => {
  await open(page);
  await page.clock.install();
  let complete = false;
  let polls = 0;
  const artifacts: string[] = [];
  const retained = () => [
    { ...done("B"), status: complete ? "SUCCEEDED" : "QUEUED" },
    {
      ...done("word-B"),
      kind: "DOCX",
      status: complete ? "SUCCEEDED" : "RUNNING",
    },
  ];
  page.on("request", (request) => {
    if (request.url().includes("/api/artifacts/"))
      artifacts.push(request.url());
  });
  await page.route("**/api/print-requests/request/preview", (route) =>
    route.fulfill({ json: { jobs: retained() } }),
  );
  await page.route("**/api/jobs?**", (route) => {
    polls++;
    return route.fulfill({ json: { items: retained(), total: 2 } });
  });
  await create(page);
  await expect.poll(() => polls).toBe(1);
  await expect(
    page.getByRole("link", { name: /Открыть PDF|Скачать DOCX/ }),
  ).toHaveCount(0);
  expect(artifacts).toEqual([]);
  await expect(
    page.getByRole("button", { name: "Готовится…", exact: true }),
  ).toBeDisabled();
  complete = true;
  await page.clock.fastForward(2001);
  await ready(page);
  await expect(
    page.getByRole("link", { name: "Открыть PDF", exact: true }),
  ).toHaveAttribute("href", "/api/artifacts/B?inline=1");
  await expect(
    page.getByRole("link", { name: "Скачать DOCX", exact: true }),
  ).toHaveAttribute("href", "/api/artifacts/word-B");
});

test("hung status GET is bounded and recoverable", async ({ page }) => {
  await open(page);
  await page.clock.install();
  const requests: Route[] = [];
  await page.route("**/api/print-requests/request/preview", (route) =>
    route.fulfill({ json: { jobs: [pending("B")] } }),
  );
  await page.route("**/api/jobs?**", (route) => {
    requests.push(route);
  });
  await create(page);
  for (let expected = 1; expected <= 3; expected++) {
    await expect.poll(() => requests.length).toBe(expected);
    await page.clock.fastForward(15_001);
    if (expected < 3) await page.clock.fastForward(3001);
  }
  await expect(
    page.getByRole("button", { name: "Повторить предпросмотр", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText(/состояни[ея].*предпросмотр|состояни[ея].*задани/i),
  ).toBeVisible();
  for (const route of requests) await route.abort().catch(() => {});
});

test("real pdf.js classifies missing and corrupt saved files and recovers on reopen", async ({
  page,
}) => {
  await open(page);
  let mode = "missing";
  await page.route("**/api/artifacts/B?inline=1", (route) =>
    mode === "missing"
      ? route.fulfill({
          status: 404,
          json: { code: "NOT_FOUND", message: "Файл не найден" },
        })
      : mode === "corrupt"
        ? route.fulfill({
            contentType: "application/pdf",
            body: Buffer.from("definitely not a PDF file"),
          })
        : mode === "storage"
          ? route.fulfill({
              status: 503,
              json: {
                code: "ARTIFACT_UNAVAILABLE",
                message: "Сохранённый файл отсутствует или повреждён",
              },
            })
          : route.fulfill({ contentType: "application/pdf", body: pdf() }),
  );
  await create(page);
  await expect(page.getByText(/Файл PDF отсутствует/)).toBeVisible();
  mode = "corrupt";
  await page
    .getByRole("button", { name: "Повторить открытие PDF", exact: true })
    .click();
  await expect(page.getByText(/не удалось прочитать как PDF/)).toBeVisible();
  mode = "storage";
  await page
    .getByRole("button", { name: "Повторить открытие PDF", exact: true })
    .click();
  await expect(
    page.getByText(/Файл PDF отсутствует|файл.*отсутствует или повреждён/i),
  ).toBeVisible();
  mode = "ready";
  await page
    .getByRole("button", { name: "Повторить открытие PDF", exact: true })
    .click();
  await ready(page);
  await page.screenshot({ path: path.join(evidence, "pdf-recovered.png") });
});

test("hung PDF fetch stops after its deadline and late A cannot render after selecting B", async ({
  page,
}) => {
  await open(page);
  await page.clock.install();
  const requests: Route[] = [];
  await page.route("**/api/artifacts/B?inline=1", (route) => {
    requests.push(route);
  });
  await create(page);
  await expect.poll(() => requests.length).toBe(1);
  await page.clock.fastForward(30_001);
  await expect(
    page.getByRole("button", { name: "Повторить открытие PDF", exact: true }),
  ).toBeEnabled();
  await expect(page.getByText(/PDF.*30 секунд/)).toBeVisible();
  await chooseB(page);
  await expect(page.getByRole("img")).toHaveCount(0);
  for (const route of requests)
    await route
      .fulfill({ contentType: "application/pdf", body: pdf("0.8 0 0") })
      .catch(() => {});
  await expect(page.getByRole("img")).toHaveCount(0);
});

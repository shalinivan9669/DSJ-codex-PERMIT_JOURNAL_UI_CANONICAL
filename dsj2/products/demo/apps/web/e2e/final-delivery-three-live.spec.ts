import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { approveFinalFixture, openFinalPanel } from "./final-approval-fixture";
test.use({ trace: "off" });
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE
    ? path.join(process.env.DEMO_E2E_EVIDENCE, "delivery-three")
    : "../../docs/evidence/final-completion/delivery-three",
);
const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
test("V08/V12: three saved people retain source order/profile/original bytes, unsigned official guards and explicit transfer without invented signed evidence", async ({
  page,
  browser,
  context,
}) => {
  test.setTimeout(1200000);
  const product = path.resolve("../..");
  execFileSync(
    process.execPath,
    ["--import", "tsx", "scripts/verification/provision-final-service-ui.ts"],
    { cwd: product, env: process.env, windowsHide: true, stdio: "pipe" },
  );
  const auth = JSON.parse(
    await fs.readFile(
      path.join(product, ".runtime/final-service-ui-auth.json"),
      "utf8",
    ),
  );
  await fs.mkdir(evidence, { recursive: true });
  await context.routeWebSocket("**/_next/webpack-hmr", (s) => s.close());
  await page.goto("/login");
  await page.getByLabel("Электронная почта", { exact: true }).fill(auth.email);
  await page.getByLabel("Пароль", { exact: true }).fill(auth.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
  await page.goto("/requests");
  await expect(
    page.getByRole("heading", { name: "Заявки на печать" }),
  ).toBeVisible();
  const csrf = (await context.cookies()).find(
    (c) => c.name === "demo_csrf",
  )!.value;
  const headers = { origin: process.env.DEMO_ORIGIN!, "x-csrf-token": csrf };
  const get = async (endpoint: string) => {
    const r = await page.request.get(`/api${endpoint}`);
    expect(r.ok(), await r.text()).toBe(true);
    return r.json();
  };
  const post = async (
    endpoint: string,
    data: unknown,
    extra: Record<string, string> = {},
  ) => {
    const r = await page.request.post(`/api${endpoint}`, {
      headers: { ...headers, ...extra },
      data,
    });
    expect(r.ok(), await r.text()).toBe(true);
    return r.json();
  };
  const suffix = Date.now();
  const customer = await post("/customers", {
    nameRu: `Выдача по профилю ${suffix}`,
  });
  const photoBytes = await fs.readFile(
    path.join(product, "tests/fixtures/source.png"),
  );
  const photoResponse = await page.request.post("/api/photos", {
    headers,
    multipart: {
      file: {
        name: "synthetic.png",
        mimeType: "image/png",
        buffer: photoBytes,
      },
    },
  });
  expect(photoResponse.ok(), await photoResponse.text()).toBe(true);
  const photo = await photoResponse.json();
  const eventId = randomUUID();
  const items = [];
  for (const n of [3, 1, 2]) {
    const recipient = await post("/recipients", {
      id: randomUUID(),
      fullNameRu: `Демонстрационный Слушатель ${String(n).padStart(3, "0")}`,
      fullNameKz: `Демонстрациялық Тыңдаушы ${String(n).padStart(3, "0")}`,
      employerId: customer.id,
      personnelNumber: String(n).padStart(6, "0"),
      assignments: [],
    });
    items.push({
      id: randomUUID(),
      recipientId: recipient.id,
      employerId: customer.id,
      fullNameRu: recipient.data.fullNameRu,
      fullNameKz: recipient.data.fullNameKz,
      positionRu: "Инженер",
      positionKz: "Инженер",
      personnelNumber: String(n).padStart(6, "0"),
      photoAssetId: photo.id,
      sourceOrder: items.length,
      assignments: [
        {
          id: randomUUID(),
          templateId: "pb-card",
          eventId,
          protocolMode: "EXTERNAL_REFERENCE",
          externalBasisNumber: "SYNTHETIC-V08",
          documentDate: "2026-09-24",
          protocolDate: "2026-09-24",
          trainingStart: "2026-09-23",
          trainingEnd: "2026-09-24",
          trainingSubject: "Синтетическая программа ПБ",
          result: "Сдал",
          outcome: { status: "PASSED", source: "Синтетическая ведомость" },
        },
      ],
    });
  }
  const request = await post("/print-requests", {
    schemaVersion: 2,
    kind: "COMPANY",
    customerId: customer.id,
    title: `Порядок P003 P001 P002 ${suffix}`,
    demoMode: true,
    events: [
      {
        id: eventId,
        title: "Событие трёх участников",
        protocolTemplateId: "pb-protocol",
        commonFields: {
          documentDate: "2026-09-24",
          protocolDate: "2026-09-24",
          trainingStart: "2026-09-23",
          trainingEnd: "2026-09-24",
          trainingSubject: "Синтетическая программа ПБ",
        },
      },
    ],
    items,
  });
  await approveFinalFixture(browser, page, auth, request.id);
  await post(
    `/print-requests/${request.id}/finalize`,
    { expectedRevision: request.revision },
    { "Idempotency-Key": randomUUID() },
  );
  const renderResult = execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/verification/drain-delivery-test-request.ts",
      auth.tenantId,
      request.id,
    ],
    {
      cwd: product,
      env: process.env,
      encoding: "utf8",
      windowsHide: true,
      timeout: 360000,
    },
  );
  await fs.writeFile(path.join(evidence, "scoped-worker.json"), renderResult);
  await expect
    .poll(
      async () => {
        const d = await get(`/print-requests/${request.id}`);
        return d.artifacts.filter(
          (a: { documentId?: string; format: string; availability: string }) =>
            a.documentId &&
            ["PDF", "DOCX"].includes(a.format) &&
            a.availability !== "MISSING",
        ).length;
      },
      { timeout: 60000, intervals: [2000, 5000] },
    )
    .toBe(12);
  const original = await get(`/print-requests/${request.id}`);
  expect(original.documents).toHaveLength(6);
  expect(
    original.documents.filter(
      (doc: { templateId: string }) => doc.templateId === "pb-protocol",
    ),
  ).toHaveLength(3);
  const files = original.artifacts.filter(
    (a: { documentId?: string; format: string }) =>
      a.documentId && ["PDF", "DOCX"].includes(a.format),
  );
  const profile = await post("/customer-export-profiles", {
    name: `Согласованный профиль ${suffix}`,
    customerId: customer.id,
    sort: "SOURCE_ORDER",
    dateFormat: "DD.MM.YYYY",
    columns: [
      { field: "personnelNumber", title: "Табельный номер", type: "TEXT" },
      { field: "fullNameRu", title: "ФИО RU", type: "TEXT" },
      { field: "documentNumber", title: "Номер документа", type: "TEXT" },
      { field: "documentDate", title: "Дата документа", type: "DATE_ONLY" },
    ],
    files: {
      grouping: "BY_PERSON",
      nameFields: ["personnelNumber", "fullNameRu", "documentNumber"],
      includeRegistry: true,
      includeInventory: true,
      includeCoverText: true,
    },
  });
  await page.goto(`/requests/${request.id}`);
  await page
    .getByText("Выборочная печать и скачивание сохранённых документов", {
      exact: true,
    })
    .click();
  await page
    .getByRole("combobox", {
      name: "Получатель для выборочной выдачи",
      exact: true,
    })
    .selectOption(items[0].id);
  await page
    .getByRole("combobox", { name: "Форма для выборочной выдачи", exact: true })
    .selectOption("pb-card");
  await page
    .getByRole("combobox", { name: "Формат выборочной выдачи", exact: true })
    .selectOption("PDF");
  await page
    .getByLabel("Выбрать все доступные файлы по фильтру", { exact: true })
    .check();
  await expect(
    page.getByRole("button", {
      name: "Скачать выбранные файлы (1)",
      exact: true,
    }),
  ).toBeDisabled();
  const internalFolder = path.join(evidence, "internal-unsigned-qa");
  const internalReadback = execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/verification/final-delivery-internal-qa.ts",
      auth.tenantId,
      request.id,
      profile.id,
      internalFolder,
    ],
    {
      cwd: product,
      env: process.env,
      windowsHide: true,
      encoding: "utf8",
      timeout: 360000,
    },
  );
  const internalProof = JSON.parse(
    internalReadback.trim().split(/\r?\n/).at(-1)!,
  );
  expect(internalProof.provenance).toBe("INTERNAL_UNSIGNED_SAVED_BYTES_QA");
  await fs.writeFile(
    path.join(evidence, "internal-unsigned-assembly.json"),
    JSON.stringify(internalProof, null, 2),
  );
  const selectedZip = path.join(
    internalFolder,
    "internal-unsigned-selected.zip",
  );
  const selectedManifest = JSON.parse(
    execFileSync(
      process.env.DEMO_PYTHON!,
      [
        "-c",
        "import sys,json,zipfile,hashlib\nz=zipfile.ZipFile(sys.argv[1]);m=json.loads(z.read('manifest.json'))\nfor f in m['files']: assert hashlib.sha256(z.read(f['file'])).hexdigest()==f['sha256']\nprint(json.dumps(m,ensure_ascii=True))",
        selectedZip,
      ],
      { encoding: "utf8", windowsHide: true },
    ),
  );
  expect(selectedManifest.files).toHaveLength(1);
  const selectedOriginal = files.find(
    (a: { id: string }) => a.id === selectedManifest.files[0].id,
  );
  expect(selectedOriginal).toBeTruthy();
  expect(selectedManifest.files[0].sha256).toBe(selectedOriginal.sha256);
  expect(selectedOriginal.format).toBe("PDF");
  expect((await get(`/print-requests/${request.id}`)).issuances).toEqual(
    original.issuances,
  );
  const output = await openFinalPanel(page, "output");
  await page
    .getByRole("button", {
      name: "Применить сохранённые настройки",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Сохранённый профиль", exact: true }),
  ).toHaveValue(profile.id);
  const guards = [];
  for (const [format, label] of [
    ["XLSX", "Реестр XLSX"],
    ["ZIP", "Комплект ZIP"],
  ] as const) {
    const pending = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        r.url().endsWith(`/print-requests/${request.id}/export`),
    );
    await output.getByRole("button", { name: label, exact: true }).click();
    const response = await pending;
    expect(response.status()).toBe(409);
    const error = await response.json();
    expect(error.code).toBe("ISSUANCE_NOT_COMPLETE");
    guards.push({ format, status: response.status(), code: error.code });
  }
  const xlsx = path.join(internalFolder, "internal-unsigned-registry.xlsx"),
    zip = path.join(internalFolder, "internal-unsigned-customer.zip");
  const inspection = JSON.parse(
    execFileSync(
      process.env.DEMO_PYTHON!,
      [
        "-c",
        "import json,sys,zipfile,hashlib,openpyxl\nw=openpyxl.load_workbook(sys.argv[1]);z=zipfile.ZipFile(sys.argv[2]);m=json.loads(z.read('manifest.json'))\nfor f in m['files']: assert hashlib.sha256(z.read(f['file'])).hexdigest()==f['sha256']\nprint(json.dumps({'rows':list(w.active.values),'files':m['files'],'names':z.namelist()},ensure_ascii=True,default=str))",
        xlsx,
        zip,
      ],
      { encoding: "utf8", windowsHide: true },
    ),
  );
  expect(inspection.rows.slice(1).map((r: string[]) => r[0])).toEqual([
    "000003",
    "000003",
    "000001",
    "000001",
    "000002",
    "000002",
  ]);
  expect(inspection.files).toHaveLength(12);
  expect(inspection.names).toEqual(
    expect.arrayContaining([
      "Реестр.xlsx",
      "Опись.tsv",
      "Сопроводительное письмо.txt",
    ]),
  );
  for (const a of files)
    expect(inspection.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: a.id, sha256: a.sha256 }),
      ]),
    );
  const first = files.find((a: { format: string }) => a.format === "PDF");
  const bytes1 = await (
    await page.request.get(`/api/artifacts/${first.id}`)
  ).body();
  const bytes2 = await (
    await page.request.get(`/api/artifacts/${first.id}`)
  ).body();
  expect(hash(bytes1)).toBe(first.sha256);
  expect(hash(bytes2)).toBe(first.sha256);
  expect(
    (await get(`/print-requests/${request.id}/transfers`)).items,
  ).toHaveLength(0);
  const review = await openFinalPanel(page, "review");
  await page
    .getByText("Зафиксировать передачу или повторную печать", { exact: true })
    .click();
  const transfer = review.locator("details").filter({
    has: page.getByText("Зафиксировать передачу или повторную печать", {
      exact: true,
    }),
  });
  await transfer.getByLabel(first.fileName, { exact: true }).check();
  await page
    .getByLabel("Получатель комплекта", { exact: true })
    .fill("Синтетический представитель А");
  await page.getByLabel("Дата передачи", { exact: true }).fill("2026-09-24");
  await page
    .getByRole("combobox", { name: "Способ", exact: true })
    .selectOption("OTHER");
  await page
    .getByRole("button", { name: "Зафиксировать факт", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await get(`/print-requests/${request.id}/transfers`)).items.length,
    )
    .toBe(1);
  await page.reload();
  await openFinalPanel(page, "review");
  await page
    .getByText("История передачи и перепечатки (1)", { exact: true })
    .click();
  await expect(
    page.getByText("Синтетический представитель А", { exact: false }),
  ).toBeVisible();
  expect((await get(`/print-requests/${request.id}`)).issuances).toEqual(
    original.issuances,
  );
  const order = await post("/orders", {
    title: `Основания трёх участников ${suffix}`,
    customerId: customer.id,
    requestIds: [request.id],
  });
  const missingLabel = "Согласованный подписанный экземпляр отсутствует";
  await post(`/orders/${order.id}/milestones`, {
    label: missingLabel,
    category: "EVIDENCE",
    source: "CONTRACT",
    sourceReference: "Синтетическое согласование V12",
  });
  await page.goto("/workbench");
  await page.getByRole("button", { name: order.title, exact: true }).click();
  await page
    .getByText("Дело заказа и сохранённые основания", { exact: true })
    .click();
  await page
    .getByRole("combobox", {
      name: "К какому событию относится основание",
      exact: true,
    })
    .selectOption(eventId);
  await page
    .getByLabel("Источник и назначение", { exact: true })
    .fill("Согласованный материал, без подписи");
  await page
    .getByLabel("Файл PDF, PNG или JPEG", { exact: true })
    .setInputFiles(path.join(product, "tests/fixtures/source.png"));
  await page
    .getByRole("button", { name: "Сохранить основание", exact: true })
    .click();
  await expect(
    page.getByText(
      "Основание сохранено отдельно от оригиналов выданных документов.",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Проверить комплектность оснований",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("listitem").filter({ hasText: missingLabel }),
  ).toBeVisible();
  const dossierWait = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Скачать дело заказа ZIP", exact: true })
    .click();
  const dossier = path.join(evidence, "dossier.zip");
  await (await dossierWait).saveAs(dossier);
  const dossierReport = JSON.parse(
    execFileSync(
      process.env.DEMO_PYTHON!,
      [
        "-c",
        "import json,sys,zipfile,hashlib\nz=zipfile.ZipFile(sys.argv[1]);d=json.loads(z.read('order-dossier.json'));m=json.loads(z.read('manifest.json'))\nprint(json.dumps({'detail':d,'manifest':m,'names':z.namelist()},ensure_ascii=True,default=str))",
        dossier,
      ],
      { encoding: "utf8", windowsHide: true },
    ),
  );
  expect(
    dossierReport.detail.missing.some(
      (m: { label: string }) => m.label === missingLabel,
    ),
  ).toBe(true);
  expect(dossierReport.detail.attachments).toHaveLength(1);
  expect(dossierReport.detail.attachments[0].category).not.toBe("SIGNED_SCAN");
  expect((await get(`/orders/${order.id}`)).summary.people).toBe(3);
  await page.screenshot({
    path: path.join(evidence, "missing-signed-copy.png"),
    fullPage: true,
  });
  await fs.writeFile(
    path.join(evidence, "result.json"),
    JSON.stringify(
      {
        status: "PASS",
        requestId: request.id,
        orderId: order.id,
        profileId: profile.id,
        sourceOrder: ["000003", "000001", "000002"],
        inspection,
        officialExportGuards: guards,
        internalAssembly: internalProof,
        originalFileHashes: files.map((a: { id: string; sha256: string }) => ({
          id: a.id,
          sha256: a.sha256,
        })),
        dossier: dossierReport,
        checks: [
          "saved profile applied through actual UI",
          "official UI XLSX and ZIP reject unsigned workflow with409; internal frozen-byte assembly is reported separately",
          "all six original files match stored hashes",
          "repeat download creates no issuance or transfer",
          "explicit selected transfer survives reload",
          "three-person order identifies missing signed copy without fabricating it",
          "available event material retained separately",
        ],
      },
      null,
      2,
    ),
  );
});

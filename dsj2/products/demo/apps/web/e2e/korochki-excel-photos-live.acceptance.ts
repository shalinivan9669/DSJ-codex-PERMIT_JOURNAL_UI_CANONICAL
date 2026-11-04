import { test, expect, type Page } from "@playwright/test";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { provision } from "../../../scripts/setup";
import { db, type Context } from "../../../apps/api/src/core";
import {
  bootstrapSuperAdmin,
  saveProfile,
  saveUser,
} from "../../../apps/api/src/settings";
import { saveSignatory } from "../../../apps/api/src/signing";
import { assertTestDatabase } from "../../../tests/integration/test-database";
import {
  loginRole,
  readPrintDetail,
  waitOriginalJobs,
} from "./operator-role-fixture";
import { documentText } from "./operator-common-history-helpers";

test.use({ trace: "off" });
test.setTimeout(900_000);
const names = {
  director: "Синтетический Директор",
  chair: "Синтетический Председатель",
  teacher: "Синтетический Преподаватель",
};

async function setup() {
  assertTestDatabase();
  expect(new URL(process.env.DATABASE_URL!).pathname).toMatch(
    /^\/demo_test_.*browser/,
  );
  const suffix = randomUUID();
  const password = `Synthetic-local-${suffix}!`;
  const email = `admin-${suffix}@example.test`;
  const owner = await provision({
    email,
    password,
    name: `Синтетическая приёмка Excel ${suffix}`,
    sample: true,
  });
  const admin: Context = {
    ...owner,
    role: "DIRECTOR",
    sessionId: "local-test",
    csrfHash: "local-test",
    correlationId: suffix,
  };
  await bootstrapSuperAdmin(admin, {
    currentPassword: password,
    confirm: true,
  });
  admin.role = "SUPER_ADMIN";
  const operator = await saveUser(admin, {
    email: `operator-${suffix}@example.test`,
    password,
    displayName: "Синтетический Оператор",
    role: "OPERATOR",
  });
  const director = await saveUser(admin, {
    email: `director-${suffix}@example.test`,
    password,
    displayName: names.director,
    role: "DIRECTOR",
  });
  const chair = await saveUser(admin, {
    email: `chair-${suffix}@example.test`,
    password,
    displayName: names.chair,
    role: "OPERATOR",
  });
  const teacher = await saveUser(admin, {
    email: `teacher-${suffix}@example.test`,
    password,
    displayName: names.teacher,
    role: "OPERATOR",
  });
  const profile = await db.issuerProfileVersion.findFirstOrThrow({
    where: { tenantId: owner.tenantId },
    orderBy: { version: "desc" },
  });
  await saveProfile(admin, {
    ...(profile.profile as object),
    headName: names.director,
    commission: [
      { name: names.chair, position: "Председатель" },
      { name: "Синтетический Член Один", position: "Член комиссии" },
      { name: "Синтетический Член Два", position: "Член комиссии" },
    ],
    people: [
      { name: names.teacher, position: "Преподаватель", role: "TEACHER" },
    ],
  });
  for (const [user, role, iin] of [
    [director, "DIRECTOR", "000000000001"],
    [chair, "CHAIR", "000000000002"],
    [teacher, "TEACHER", "000000000003"],
  ] as const)
    await saveSignatory(admin, {
      userId: user.id,
      displayName: user.displayName,
      role,
      iin,
    });
  process.env.DEMO_E2E_ISOLATED_TENANT = "1";
  process.env.DEMO_ADMIN_EMAIL = email;
  process.env.DEMO_ADMIN_PASSWORD = password;
  process.env.DEMO_OPERATOR_EMAIL = operator.email;
  process.env.DEMO_OPERATOR_PASSWORD = password;
  process.env.DEMO_DIRECTOR_EMAIL = director.email;
  process.env.DEMO_DIRECTOR_PASSWORD = password;
  return owner;
}

async function createCompany(page: Page, name: string) {
  await page.goto("/requests/new");
  await page.getByRole("radio", { name: "Организация", exact: true }).check();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(page).toHaveURL(/\/requests\/[a-f0-9-]+\/edit$/);
  await page.getByLabel("Название компании", { exact: true }).fill(name);
  return /\/requests\/([a-f0-9-]+)\/edit$/.exec(page.url())![1];
}

async function save(page: Page, id: string) {
  await page
    .getByRole("button", { name: "Дополнительные действия", exact: true })
    .click();
  try {
    await page
      .getByRole("button", { name: "Сохранить изменения", exact: true })
      .click({ timeout: 2000 });
  } catch (error) {
    // Autosave can finish between opening this menu and clicking its dirty-only
    // Save action. Accept that race only after the UI and API confirm saved data.
    if (
      !/Рабочая версия сохранена/.test(
        await page.locator(".save-indicator").innerText(),
      )
    )
      throw error;
  }
  const menu = page.getByRole("dialog", { name: "Прочее", exact: true });
  if (await menu.isVisible())
    await menu.getByRole("button", { name: /^Закрыть(?: диалог)?$/ }).click();
  await expect
    .poll(async () => !!(await readPrintDetail(page, id)).customerId)
    .toBe(true);
  await expect(page.locator(".save-indicator")).toContainText(/сохранена/i);
}

test("local manual and Excel photo journeys preserve mixed groups, dates and saved documents", async ({
  page,
  browser,
}, testInfo) => {
  const owner = await setup();
  const workbook = testInfo.outputPath("synthetic-four-photos.xlsx");
  await fs.mkdir(path.dirname(workbook), { recursive: true });
  execFileSync(
    process.env.DEMO_PYTHON || "python",
    [
      "-c",
      `
import sys, io
from openpyxl import Workbook
from openpyxl.drawing.image import Image as ExcelImage
from PIL import Image
book=Workbook(); sheet=book.active; sheet.title='Данные'
sheet.append(['ФИО RU','ФИО KZ','Должность RU','Должность KZ','Категория сотрудника','Табельный номер','Фото'])
for i,color in enumerate(['red','blue','green','orange'],1):
    sheet.append([f'Синтетический Получатель {i}',f'Синтетикалық Алушы {i}','Слесарь' if i<3 else 'Инженер','Жөндеуші' if i<3 else 'Инженер','Рабочий' if i<3 else 'ИТР',f'{i:05d}',''])
    data=io.BytesIO();Image.new('RGB',(120,160),color).save(data,'PNG');data.seek(0)
    photo=ExcelImage(data);photo.width=60;photo.height=80;sheet.add_image(photo,f'G{i+1}');sheet.row_dimensions[i+1].height=70
book.save(sys.argv[1])
`,
      path.toNamespacedPath(workbook),
    ],
    { windowsHide: true },
  );
  try {
    page.on("requestfailed", (request) =>
      console.info(
        "BROWSER_REQUEST_FAILED",
        new URL(request.url()).pathname,
        request.failure()?.errorText,
      ),
    );
    page.on("response", (response) => {
      if (response.url().endsWith("/api/customers"))
        console.info("CUSTOMER_RESPONSE", response.status());
    });
    await loginRole(page, "OPERATOR");
    const manualId = await createCompany(page, "Синтетическая ручная компания");
    for (let index = 1; index <= 2; index++) {
      const name = page.getByLabel(`ФИО, строка ${index}`, { exact: true });
      await name.fill(`Ручной Синтетический ${index}`);
      await page
        .getByLabel(`Должность · RU, строка ${index}`, { exact: true })
        .fill(index === 1 ? "Слесарь" : "Инженер");
      if (index === 1) await name.press("Enter");
    }
    await page
      .getByLabel("Категория сотрудника, строка 2", { exact: true })
      .selectOption("ITR");
    await page
      .getByRole("button", {
        name: "БиОТ: добавить всем в заявке (2)",
        exact: true,
      })
      .click();
    await page.getByLabel(/^Общая дата документов/).fill("2026-01-31");
    await page
      .getByLabel("Дата выдачи, строка 2", { exact: true })
      .fill("2026-01-30");
    await save(page, manualId);
    await page.reload();
    await expect(page.getByLabel("ФИО, строка 2", { exact: true })).toHaveValue(
      "Ручной Синтетический 2",
    );
    await expect(
      page.getByLabel("Дата выдачи, строка 2", { exact: true }),
    ).toHaveValue("2026-01-30");
    const manual = await readPrintDetail(page, manualId);
    expect(manual.items).toHaveLength(2);
    expect(manual.items.map((person) => person.employeeCategory)).toEqual([
      "WORKER",
      "ITR",
    ]);
    expect(
      manual.items[1].assignments.find(
        (assignment) => assignment.templateId === "biot-itr-certificate",
      )?.fieldOrigins?.documentDate,
    ).toBe("MANUAL");
    await page.screenshot({
      path: testInfo.outputPath("manual-mixed-dates.png"),
      fullPage: true,
    });

    const id = await createCompany(page, "Синтетическая компания Excel");
    await page.getByRole("button", { name: "Импорт", exact: true }).click();
    const modal = page.getByRole("dialog");
    const template = await page.request.get("/api/imports/template");
    expect(template.ok()).toBe(true);
    expect(template.headers()["content-type"]).toContain("spreadsheetml");
    await fs.writeFile(
      testInfo.outputPath("downloaded-template.xlsx"),
      await template.body(),
    );
    await modal.locator('input[type="file"]').setInputFiles({
      name: "synthetic-four-photos.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: await fs.readFile(workbook),
    });
    await expect(modal.locator(".import-preview tbody tr")).toHaveCount(4);
    await expect(
      modal.getByRole("img", { name: /Фото сотрудника, строка/ }),
    ).toHaveCount(4);
    await expect
      .poll(async () =>
        modal
          .getByRole("img", { name: /Фото сотрудника, строка/ })
          .evaluateAll((images) =>
            images.every(
              (image) => (image as HTMLImageElement).naturalWidth > 0,
            ),
          ),
      )
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("excel-four-photo-preview.png"),
      fullPage: true,
    });
    await modal
      .getByRole("button", { name: "Добавить 4 строк в черновик", exact: true })
      .click();
    await expect(modal).toHaveCount(0);
    await expect(page.getByLabel("ФИО, строка 4", { exact: true })).toHaveValue(
      "Синтетический Получатель 4",
    );
    await page
      .getByRole("button", {
        name: "БиОТ: добавить всем в заявке (4)",
        exact: true,
      })
      .click();
    await page.getByLabel("Выбрать строку 1", { exact: true }).check();
    for (const course of ["ПБ", "ПТМ"])
      await page
        .getByRole("button", {
          name: `${course}: добавить отмеченным (1)`,
          exact: true,
        })
        .click();
    await page.getByLabel("Выбрать строку 1", { exact: true }).uncheck();
    await page
      .getByText("Параметры обучения и документов", { exact: true })
      .click();
    for (const course of ["ПБ", "ПТМ"]) {
      await page
        .getByLabel("Обучение для общих данных и результатов", { exact: true })
        .selectOption({ label: course });
      await page
        .getByLabel("Объём обучения, часов", { exact: true })
        .filter({ visible: true })
        .first()
        .fill("16");
    }
    await page
      .getByText("Параметры обучения и документов", { exact: true })
      .click();
    await page.getByLabel(/^Общая дата документов/).fill("2026-01-31");
    await save(page, id);
    await page.reload();
    const saved = await readPrintDetail(page, id);
    expect(saved.items).toHaveLength(4);
    expect(saved.items.every((person) => person.photoAssetId)).toBe(true);
    expect(new Set(saved.items.map((person) => person.photoAssetId)).size).toBe(
      4,
    );
    expect(
      saved.events?.filter((event) =>
        event.protocolTemplateId.startsWith("biot-"),
      ).length,
    ).toBe(2);
    expect(saved.items.map((person) => person.personnelNumber)).toEqual([
      "00001",
      "00002",
      "00003",
      "00004",
    ]);
    expect(
      await db.examAttempt.count({ where: { tenantId: owner.tenantId } }),
    ).toBe(0);
    await page.getByRole("button", { name: "Импорт", exact: true }).click();
    await page
      .getByRole("dialog")
      .locator('input[type="file"]')
      .setInputFiles({
        name: "synthetic-four-photos.xlsx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: await fs.readFile(workbook),
      });
    await expect(
      page.getByRole("button", {
        name: "Добавить 0 строк в черновик",
        exact: true,
      }),
    ).toBeDisabled();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^Закрыть(?: диалог)?$/ })
      .click();
    expect((await readPrintDetail(page, id)).items).toHaveLength(4);
    const submit = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/print-requests/${id}/approval/submit`),
    );
    await page
      .getByRole("button", { name: /Проверить и передать директору/ })
      .click();
    const submitted = await submit;
    expect(submitted.ok(), await submitted.text()).toBe(true);
    const proposal = await readPrintDetail(page, id);
    const directorContext = await browser.newContext({
      baseURL: process.env.DEMO_ORIGIN,
    });
    try {
      const directorPage = await directorContext.newPage();
      const director = await loginRole(directorPage, "DIRECTOR");
      await directorPage.goto(
        `/approvals?proposal=${proposal.approval!.proposalId}`,
      );
      const viewer = directorPage.getByRole("region", {
        name: "Предпросмотр назначенных документов",
      });
      const pb = proposal.items[0].assignments.find(
        (assignment) => assignment.templateId === "pb-card",
      )!;
      await viewer
        .getByRole("combobox", {
          name: "Человек и форма документа",
          exact: true,
        })
        .selectOption(
          JSON.stringify({
            kind: "ASSIGNMENT",
            rowId: proposal.items[0].id,
            assignmentId: pb.id,
          }),
        );
      await viewer
        .getByRole("button", { name: "Создать предпросмотр", exact: true })
        .click();
      await expect(
        viewer.getByRole("link", { name: "Скачать DOCX", exact: true }),
      ).toBeVisible({ timeout: 180_000 });
      const previewUrl = await viewer
        .getByRole("link", { name: "Скачать DOCX", exact: true })
        .getAttribute("href");
      const preview = await directorPage.request.get(previewUrl!);
      expect(preview.ok()).toBe(true);
      expect(documentText(await preview.body())).toContain(
        "Синтетический Получатель 1",
      );
      await fs.writeFile(
        testInfo.outputPath("pb-photo-preview.docx"),
        await preview.body(),
      );
      await directorPage.screenshot({
        path: testInfo.outputPath("director-real-preview.png"),
        fullPage: true,
      });
      await directorPage
        .getByRole("button", { name: "Согласовать эту редакцию", exact: true })
        .click();
      await expect
        .poll(async () => (await readPrintDetail(page, id)).approval?.status)
        .toBe("APPROVED");
      await expect(
        page.getByRole("button", {
          name: "Сформировать документы",
          exact: true,
        }),
      ).toBeEnabled({ timeout: 30_000 });
      await fs.writeFile(
        testInfo.outputPath("checkpoint.json"),
        JSON.stringify(
          {
            synthetic: true,
            tenantId: owner.tenantId,
            requestId: id,
            manualRequestId: manualId,
            documentCount: 10,
            photos: saved.items.map((person) => person.photoAssetId),
          },
          null,
          2,
        ),
      );
      const finalized = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith(`/print-requests/${id}/finalize`),
        { timeout: 210_000 },
      );
      await page
        .getByRole("button", { name: "Сформировать документы", exact: true })
        .click();
      const finalizedResponse = await finalized;
      expect(finalizedResponse.ok(), await finalizedResponse.text()).toBe(true);
      await waitOriginalJobs(page, id, 420_000);
      const generated = await readPrintDetail(page, id);
      expect(
        generated.documents.filter(
          (document) => document.templateId === "biot-protocol",
        ),
      ).toHaveLength(1);
      expect(
        generated.documents.filter(
          (document) => document.templateId === "biot-itr-protocol",
        ),
      ).toHaveLength(1);
      expect(generated.documents).toHaveLength(10);
      const attest = await directorPage.request.post(
        `/api/print-requests/${id}/paper-signatures`,
        {
          headers: director.headers,
          data: {
            documentIds: generated.documents.map((document) => document.id),
            signedAt: "2026-01-31",
            signerNames: [names.director, names.chair, names.teacher],
            allRequiredSignaturesPresent: true,
            reason:
              "СИНТЕТИЧЕСКИЙ тест бумажного пути. Реальные подписи не создавались.",
          },
        },
      );
      expect(attest.ok(), await attest.text()).toBe(true);
      const artifactEvidence = [];
      const documents = generated.artifacts.filter(
        (artifact) =>
          artifact.documentId &&
          ["DOCX", "PDF"].includes(artifact.format || ""),
      );
      expect(documents).toHaveLength(20);
      for (const artifact of documents) {
        const download = await page.request.get(
          `/api/artifacts/${artifact.id}`,
        );
        expect(
          download.ok(),
          `artifact ${artifact.id}: HTTP ${download.status()}`,
        ).toBe(true);
        const bytes = await download.body();
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        expect(sha256).toBe(artifact.sha256);
        if (artifact.format === "DOCX")
          expect(documentText(bytes)).toMatch(/Синтетическ/);
        else expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
        const filename = `saved-${artifact.documentId}.${artifact.format!.toLowerCase()}`;
        await fs.writeFile(testInfo.outputPath(filename), bytes);
        artifactEvidence.push({
          id: artifact.id,
          documentId: artifact.documentId,
          format: artifact.format,
          sha256,
          filename,
        });
      }
      for (const templateId of ["pb-card", "ptm-card"]) {
        const documentId = generated.documents.find(
          (document) => document.templateId === templateId,
        )!.id;
        const file = artifactEvidence.find(
          (artifact) =>
            artifact.documentId === documentId && artifact.format === "DOCX",
        )!;
        const hasImportedRedPhoto = execFileSync(
          process.env.DEMO_PYTHON || "python",
          [
            "-c",
            `
import sys, io
from zipfile import ZipFile
from PIL import Image
with ZipFile(sys.argv[1]) as book:
    colors=[]
    for name in book.namelist():
        if name.startswith('word/media/'):
            try:
                color=Image.open(io.BytesIO(book.read(name))).convert('RGB').resize((1,1)).getpixel((0,0))
                colors.append(color)
            except (OSError, ValueError): pass
    print('yes' if any(r>220 and g<35 and b<35 for r,g,b in colors) else 'no')
`,
            path.toNamespacedPath(testInfo.outputPath(file.filename)),
          ],
          { windowsHide: true, encoding: "utf8" },
        ).trim();
        expect(
          hasImportedRedPhoto,
          `${templateId} must contain the real first-row photograph`,
        ).toBe("yes");
      }
      await fs.writeFile(
        testInfo.outputPath("acceptance.json"),
        JSON.stringify(
          {
            synthetic: true,
            tenantId: owner.tenantId,
            documentCount: 10,
            requestId: id,
            manualRequestId: manualId,
            source: "real browser forms and actual local API/database/worker",
            manualRows: manual.items.length,
            importedRows: saved.items.length,
            photos: saved.items.map((person) => person.photoAssetId),
            documents: generated.documents,
            artifacts: artifactEvidence,
            paperAttestation:
              "synthetic API scenario only; no real physical or electronic signatures",
          },
          null,
          2,
        ),
      );
    } finally {
      await directorContext.close();
    }
  } finally {
    await db.$disconnect();
  }
});

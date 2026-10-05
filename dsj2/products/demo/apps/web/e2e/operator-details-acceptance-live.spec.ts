import { test, expect, type Page, type Locator } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  realApprovalRoles,
  readPrintDetail,
  waitOriginalJobs,
} from "./operator-role-fixture";
import {
  commonSettings,
  documentText,
} from "./operator-common-history-helpers";

test.use({ trace: "off" });
const evidence = process.env.DEMO_E2E_EVIDENCE
  ? path.resolve(process.env.DEMO_E2E_EVIDENCE, "live-cycle")
  : path.resolve(
      __dirname,
      "../../../docs/evidence/operator-details-ux-20261005/live-cycle",
    );
async function saved(page: Page) {
  await expect(page.locator(".save-indicator")).toContainText(/сохранена/i);
}
async function date(field: Locator, value: string) {
  await field.fill(value);
  await field.press("Tab");
}
async function preview(page: Page, viewer: Locator, filename: string) {
  await viewer
    .getByRole("button", {
      name: /^(Создать|Обновить|Повторить) предпросмотр$/,
    })
    .click();
  await expect(viewer.getByRole("img", { name: /^Страница 1 из/ })).toBeVisible(
    { timeout: 150000 },
  );
  await page.screenshot({
    path: path.join(evidence, filename + ".png"),
    fullPage: false,
  });
  for (const [label, format] of [
    ["Открыть PDF", "pdf"],
    ["Скачать DOCX", "docx"],
  ]) {
    const href = await viewer
      .getByRole("link", { name: label, exact: true })
      .getAttribute("href");
    const response = await page.request.get(href!);
    expect(response.ok(), await response.text()).toBe(true);
    await fs.writeFile(
      path.join(evidence, filename + "." + format),
      await response.body(),
    );
  }
}

test("current PERSON PS: three UI steps, exact period, every form, director target and immutable issue", async ({
  page,
  browser,
}) => {
  test.setTimeout(600000);
  await fs.mkdir(evidence, { recursive: true });
  const roles = await realApprovalRoles(browser, page);
  try {
    await roles.configureSignatories();
    await page.goto("/requests/new");
    await page.getByRole("radio", { name: /^Физическое лицо/ }).check();
    await page.getByRole("button", { name: "Далее", exact: true }).click();
    const person = page.locator(".person-editor");
    await expect(person.getByLabel("ФИО", { exact: true })).toBeFocused();
    await person
      .getByLabel("ФИО", { exact: true })
      .fill("Синтетический Текущий Период");
    await person.getByLabel("Должность", { exact: true }).fill("Сварщик");
    await person.getByRole("button", { name: "Далее", exact: true }).click();
    await person.getByRole("button", { name: "Рабочий", exact: true }).click();
    await person.getByRole("button", { name: "Далее", exact: true }).click();
    await person.getByRole("button", { name: "ПС", exact: true }).click();
    await date(person.getByLabel("Обучение с", { exact: true }), "2026-09-01");
    await date(person.getByLabel("по", { exact: true }), "2026-09-30");
    await date(
      person.getByLabel("Дата документа", { exact: true }),
      "2026-10-20",
    );
    await date(
      person.getByLabel("Дата протокола", { exact: true }),
      "2026-10-18",
    );
    await person.getByLabel("Часы программы", { exact: true }).fill("160");
    await person.getByRole("button", { name: "Готово", exact: true }).click();
    await saved(page);
    const id = /requests\/([^/]+)/.exec(page.url())![1];
    await person
      .getByRole("button", { name: "Добавить фото", exact: true })
      .click();
    const photo = page.getByRole("dialog", {
      name: "Фото для печати",
      exact: true,
    });
    await photo
      .getByLabel("Выбрать фотографию")
      .setInputFiles(
        path.resolve(__dirname, "../../../tests/fixtures/source-photo.png"),
      );
    await expect(
      photo.getByRole("button", { name: "Сохранить фото", exact: true }),
    ).toBeEnabled();
    await photo
      .getByRole("button", { name: "Сохранить фото", exact: true })
      .click();
    await expect(photo).toHaveCount(0);
    await saved(page);
    await page.reload();
    await expect(person.locator('[data-person-stage="summary"]')).toBeVisible();
    await expect(page.locator(".operator-grid")).toHaveCount(0);
    const before = await readPrintDetail(page, id);
    for (const assignment of before.items[0].assignments) {
      expect(assignment.trainingStart).toBe("2026-09-01");
      expect(assignment.trainingEnd).toBe("2026-09-30");
      expect(assignment.documentDate).toBe(
        assignment.templateId.endsWith("-protocol")
          ? "2026-10-18"
          : "2026-10-20",
      );
      expect(assignment.protocolDate).toBe("2026-10-18");
    }
    for (const width of [1440, 1280, 768, 390]) {
      await page.setViewportSize({ width, height: width === 1280 ? 720 : 900 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: path.join(evidence, `person-${width}.png`),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const button of await person
      .getByRole("button", { name: /^Предпросмотр:/ })
      .all()) {
      const label =
        (await button.getAttribute("aria-label")) || (await button.innerText());
      await button.click();
      const modal = page.getByRole("dialog", {
        name: "Предпросмотр документа",
        exact: true,
      });
      const name = label.includes("свидетельство")
        ? "ps-witness-preview"
        : label.includes("протокол")
          ? "ps-protocol-preview"
          : "ps-card-preview";
      await preview(page, modal, name);
      await modal
        .getByRole("button", { name: "Закрыть диалог", exact: true })
        .click();
    }
    const afterPreviews = await readPrintDetail(page, id);
    expect(afterPreviews.issuances).toHaveLength(0);
    expect(afterPreviews.documents).toHaveLength(0);
    expect(afterPreviews.items).toEqual(before.items);
    await page
      .getByRole("button", { name: /^Проверить и передать директору/ })
      .click();
    await expect
      .poll(async () => (await readPrintDetail(page, id)).approval?.status, {
        timeout: 30000,
      })
      .toBe("PENDING");
    const pending = await readPrintDetail(page, id);
    await roles.directorPage.goto(
      `/approvals?proposal=${pending.approval!.proposalId}`,
    );
    const viewer = roles.directorPage.getByRole("region", {
      name: "Предпросмотр назначенных документов",
    });
    const selection = roles.directorPage.getByLabel(
      "Человек и форма документа",
      { exact: true },
    );
    await selection.selectOption({
      label: "Синтетический Текущий Период · ПС — свидетельство",
    });
    await preview(roles.directorPage, viewer, "director-ps-witness");
    await roles.directorPage
      .getByLabel("Комментарий к решению", { exact: true })
      .fill("Синтетическая локальная приёмка периода и конкретной формы");
    await roles.directorPage
      .getByRole("button", { name: "Согласовать эту редакцию", exact: true })
      .click();
    await expect
      .poll(async () => (await readPrintDetail(page, id)).approval?.status)
      .toBe("APPROVED");
    await page.reload();
    await page
      .getByRole("button", { name: "Сформировать документы", exact: true })
      .click();
    await expect
      .poll(async () => (await readPrintDetail(page, id)).status)
      .toBe("FINALIZED");
    await waitOriginalJobs(page, id);
    const issued = await readPrintDetail(page, id);
    const files = [];
    for (const artifact of issued.artifacts.filter(
      (item) =>
        item.provenance === "ORIGINAL" &&
        ["PDF", "DOCX"].includes(item.format || ""),
    )) {
      const response = await page.request.get(`/api/artifacts/${artifact.id}`);
      expect(response.ok()).toBe(true);
      const bytes = await response.body();
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        artifact.sha256,
      );
      const filename = `${artifact.id}-${artifact.fileName}`;
      await fs.writeFile(path.join(evidence, filename), bytes);
      files.push({
        id: artifact.id,
        fileName: filename,
        format: artifact.format,
        sha256: artifact.sha256,
      });
    }
    expect(files.filter((item) => item.format === "PDF")).toHaveLength(3);
    expect(files.filter((item) => item.format === "DOCX")).toHaveLength(3);
    await fs.writeFile(
      path.join(evidence, "person-cycle.json"),
      JSON.stringify(
        {
          status: "PASS",
          id,
          revision: issued.revision,
          proposalId: pending.approval!.proposalId,
          issuanceIds: issued.issuances.map((item) => item.id),
          documents: issued.documents,
          files,
          syntheticOnly: true,
          managerInputThroughUi: true,
          directorPreviewAndDecisionThroughUi: true,
          period: ["2026-09-01", "2026-09-30"],
          protocolDate: "2026-10-18",
          documentDate: "2026-10-20",
        },
        null,
        2,
      ),
    );
  } finally {
    await roles.close();
  }
});

test("current COMPANY PTM: explicit import conflict, shared employer, second person and group previews, immutable issue", async ({
  page,
  browser,
}) => {
  test.setTimeout(600000);
  await fs.mkdir(evidence, { recursive: true });
  const roles = await realApprovalRoles(browser, page);
  const companyName = `Синтетическая компания ${Date.now()}`;
  const manifest = JSON.parse(await fs.readFile(
    path.resolve(__dirname, "../../../assets/templates/manifest.json"), "utf8",
  ));
  const cardFields: string[] = manifest.templates.find(
    (template: { id: string }) => template.id === "ptm-card",
  ).fields;
  // The preserved PTM reference form has one name slot, explicitly RU.
  // Independent KZ names remain in the source and immutable issued snapshot;
  // both position fields are mapped into the printed card.
  expect(cardFields).toContain("FULL_NAME_RU");
  expect(cardFields).not.toContain("FULL_NAME_KZ");
  expect(cardFields).not.toContain("FULL_NAME_BOTH");
  expect(cardFields).toEqual(expect.arrayContaining(["POSITION_RU", "POSITION_KZ"]));
  const people = [
    {
      ru: "Синтетический Первый Сотрудник",
      kz: "Синтетикалық Бірінші Қызметкер",
      positionRu: "Электрик",
      positionKz: "Электрші",
      personnelNumber: "COMPANY-01",
    },
    {
      ru: "Синтетический Второй Сотрудник",
      kz: "Синтетикалық Екінші Қызметкер",
      positionRu: "Сварщик",
      positionKz: "Дәнекерлеуші",
      personnelNumber: "COMPANY-02",
    },
  ];
  try {
    await roles.configureSignatories();
    await page.goto("/requests/new");
    await page.getByRole("radio", { name: /^Организация/ }).check();
    await page.getByRole("button", { name: "Далее", exact: true }).click();
    await page
      .getByLabel("Название компании", { exact: true })
      .fill(companyName);
    await page.getByRole("button", { name: "Импорт", exact: true }).click();
    const importer = page.getByRole("dialog", {
      name: "Импорт получателей",
      exact: true,
    });
    await importer
      .getByLabel("Или вставьте таблицу с заголовками")
      .fill(
        [
          [
            "ФИО RU",
            "ФИО KZ",
            "Должность RU",
            "Должность KZ",
            "Категория сотрудника",
            "Табельный номер",
            "Место работы RU",
          ].join("\t"),
          ...people.map((person, index) =>
            [
              person.ru,
              person.kz,
              person.positionRu,
              person.positionKz,
              "WORKER",
              person.personnelNumber,
              index === 0 ? "ТОО Другая синтетическая компания" : "",
            ].join("\t"),
          ),
        ].join("\n"),
      );
    await importer
      .getByRole("button", { name: "Проверить таблицу", exact: true })
      .click();
    await expect(
      importer.getByText(/Работодатель отличается от компании заявки:/),
    ).toBeVisible();
    const add = importer.getByRole("button", {
      name: "Добавить 2 строк в черновик",
      exact: true,
    });
    await expect(add).toBeDisabled();
    await importer
      .getByRole("checkbox", {
        name: "Привести эти строки к компании заявки",
        exact: true,
      })
      .check();
    await expect(add).toBeEnabled();
    await page.screenshot({
      path: path.join(evidence, "company-import-conflict-resolved.png"),
    });
    await add.click();
    await expect(importer).toHaveCount(0);
    await saved(page);
    const id = /requests\/([^/]+)/.exec(page.url())![1];
    const imported = await readPrintDetail(page, id);
    expect(imported.kind).toBe("COMPANY");
    expect(imported.customerId).toBeTruthy();
    expect(imported.items).toHaveLength(2);
    for (const [index, item] of imported.items.entries()) {
      expect(item.fullNameRu).toBe(people[index].ru);
      expect(item.fullNameKz).toBe(people[index].kz);
      expect(item.positionKz).toBe(people[index].positionKz);
      expect(item.personnelNumber).toBe(people[index].personnelNumber);
      expect(item.sourceRow).toBe(index + 2);
      expect(item.importId).toBeTruthy();
      expect(item.workplaceRu || "").toBe("");
      expect(item.employerId || "").toBe("");
    }
    await page.reload();
    await expect(page.locator("#request-customer")).toContainText(companyName);
    await expect(
      page
        .locator(".operator-grid")
        .getByLabel(/Место работы|БИН работодателя|Название компании/),
    ).toHaveCount(0);
    await expect(page.locator(".person-editor")).toHaveCount(0);
    const afterReload = await readPrintDetail(page, id);
    expect(afterReload.items).toEqual(imported.items);
    expect(afterReload.customerId).toBe(imported.customerId);
    await page
      .getByRole("button", {
        name: "ПТМ: добавить всем в заявке (2)",
        exact: true,
      })
      .click();
    const shared = await commonSettings(page);
    await date(
      shared.getByLabel("Дата документа для заявки", { exact: true }),
      "2026-10-20",
    );
    await date(
      shared.getByLabel("Начало обучения для заявки", { exact: true }),
      "2026-10-17",
    );
    await date(
      shared.getByLabel("Окончание обучения для заявки", { exact: true }),
      "2026-10-18",
    );
    await date(
      shared.getByLabel("Дата проверки / протокола для заявки", {
        exact: true,
      }),
      "2026-10-18",
    );
    await shared
      .getByLabel("Объём обучения, часов", { exact: true })
      .fill("16");
    await page.locator("#request-training > summary").click();
    await saved(page);
    for (const index of [1, 2]) {
      await page
        .getByRole("button", {
          name: `Добавить фото получателя ${index}`,
          exact: true,
        })
        .click();
      const photo = page.getByRole("dialog", {
        name: "Фото для печати",
        exact: true,
      });
      await photo
        .getByLabel("Выбрать фотографию")
        .setInputFiles(
          path.resolve(__dirname, "../../../tests/fixtures/source-photo.png"),
        );
      await expect(
        photo.getByRole("button", { name: "Сохранить фото", exact: true }),
      ).toBeEnabled();
      await photo
        .getByRole("button", { name: "Сохранить фото", exact: true })
        .click();
      await expect(photo).toHaveCount(0);
      await saved(page);
    }
    await page.reload();
    const before = await readPrintDetail(page, id);
    expect(before.items).toHaveLength(2);
    expect(before.events).toHaveLength(1);
    expect(before.events![0].protocolMode).toBe("GROUP");
    expect(before.events![0].protocolTemplateId).toBe("ptm-protocol");
    expect(before.events![0].commonFields.hours).toBe("16");
    for (const item of before.items) {
      expect(item.assignments).toHaveLength(1);
      expect(item.assignments[0].templateId).toBe("ptm-card");
      expect(item.assignments[0].protocolMode).toBe("GROUP");
      expect(item.assignments[0].outcome?.status).toBe("PASSED");
      expect(item.photoAssetId).toBeTruthy();
      expect(item.workplaceRu || "").toBe("");
    }
    const second = before.items[1];
    const secondTarget = {
      kind: "ASSIGNMENT",
      rowId: second.id,
      assignmentId: second.assignments[0].id,
    };
    const groupTarget = {
      kind: "GROUP_PROTOCOL",
      eventId: before.events![0].id,
    };
    await page.screenshot({
      path: path.join(evidence, "company-two-employees.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", {
        name: "Предпросмотр любого документа",
        exact: true,
      })
      .click();
    const modal = page.getByRole("dialog", {
      name: "Предпросмотр документа",
      exact: true,
    });
    const selection = modal.getByLabel("Человек и форма документа", {
      exact: true,
    });
    await selection.selectOption(JSON.stringify(secondTarget));
    await expect(selection.locator("option:checked")).toContainText(
      people[1].ru,
    );
    await preview(page, modal, "company-second-ptm-preview");
    const secondText = documentText(
      await fs.readFile(path.join(evidence, "company-second-ptm-preview.docx")),
    );
    expect(secondText).toContain(people[1].ru);
    expect(secondText).toContain(people[1].positionRu);
    expect(secondText).toContain(people[1].positionKz);
    expect(secondText).not.toContain(people[0].ru);
    await selection.selectOption(JSON.stringify(groupTarget));
    await preview(page, modal, "company-group-ptm-preview");
    const groupText = documentText(
      await fs.readFile(path.join(evidence, "company-group-ptm-preview.docx")),
    );
    for (const person of people) expect(groupText).toContain(person.ru);
    await modal
      .getByRole("button", { name: "Закрыть диалог", exact: true })
      .click();
    const afterPreviews = await readPrintDetail(page, id);
    expect(afterPreviews.issuances).toHaveLength(0);
    expect(afterPreviews.documents).toHaveLength(0);
    expect(afterPreviews.items).toEqual(before.items);
    expect(afterPreviews.events).toEqual(before.events);
    await page
      .getByRole("button", { name: /^Проверить и передать директору/ })
      .click();
    await expect
      .poll(async () => (await readPrintDetail(page, id)).approval?.status, {
        timeout: 30000,
      })
      .toBe("PENDING");
    const pending = await readPrintDetail(page, id);
    await roles.directorPage.goto(
      `/approvals?proposal=${pending.approval!.proposalId}`,
    );
    const viewer = roles.directorPage.getByRole("region", {
      name: "Предпросмотр назначенных документов",
    });
    await viewer
      .getByLabel("Человек и форма документа", { exact: true })
      .selectOption(JSON.stringify(secondTarget));
    await preview(roles.directorPage, viewer, "director-company-second-ptm");
    const directorText = documentText(
      await fs.readFile(
        path.join(evidence, "director-company-second-ptm.docx"),
      ),
    );
    expect(directorText).toContain(people[1].ru);
    expect(directorText).not.toContain(people[0].ru);
    await roles.directorPage
      .getByLabel("Комментарий к решению", { exact: true })
      .fill(
        "Синтетическая приёмка: проверены второй сотрудник и общий протокол ПТМ",
      );
    await roles.directorPage
      .getByRole("button", { name: "Согласовать эту редакцию", exact: true })
      .click();
    await expect
      .poll(async () => (await readPrintDetail(page, id)).approval?.status)
      .toBe("APPROVED");
    await page.reload();
    await page
      .getByRole("button", { name: "Сформировать документы", exact: true })
      .click();
    await expect
      .poll(async () => (await readPrintDetail(page, id)).status)
      .toBe("FINALIZED");
    await waitOriginalJobs(page, id);
    const issued = await readPrintDetail(page, id);
    expect(
      issued.documents.filter((item) => item.templateId === "ptm-card"),
    ).toHaveLength(2);
    expect(
      issued.documents.filter((item) => item.templateId === "ptm-protocol"),
    ).toHaveLength(1);
    expect(
      issued.documents.find((item) => item.templateId === "ptm-protocol")!
        .rowId,
    ).toBeNull();
    expect(issued.customerId).toBe(before.customerId);
    expect(issued.items).toEqual(before.items);
    const identity = (items: typeof before.items) => items.map((item) => ({
      id: item.id, fullNameRu: item.fullNameRu, fullNameKz: item.fullNameKz,
    }));
    expect(identity(issued.issuances[0].snapshot.draft.items)).toEqual(identity(before.items));
    const files = [];
    for (const artifact of issued.artifacts.filter(
      (item) =>
        item.provenance === "ORIGINAL" &&
        ["PDF", "DOCX"].includes(item.format || ""),
    )) {
      const response = await page.request.get(`/api/artifacts/${artifact.id}`);
      expect(response.ok()).toBe(true);
      const bytes = await response.body();
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        artifact.sha256,
      );
      const document = issued.documents.find(
        (item) => item.id === artifact.documentId,
      )!;
      if (artifact.format === "PDF")
        expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
      else {
        const text = documentText(bytes);
        expect(text).toContain(document.number);
        const recipient = before.items.find(
          (item) => item.id === document.rowId,
        );
        if (recipient) {
          expect(text).toContain(recipient.fullNameRu);
          expect(text).toContain(recipient.positionRu);
          expect(text).toContain(recipient.positionKz);
        } else for (const person of people) expect(text).toContain(person.ru);
      }
      const filename = `company-${artifact.id}-${artifact.fileName}`;
      await fs.writeFile(path.join(evidence, filename), bytes);
      files.push({
        id: artifact.id,
        documentId: artifact.documentId,
        fileName: filename,
        format: artifact.format,
        sha256: artifact.sha256,
      });
    }
    expect(files.filter((item) => item.format === "PDF")).toHaveLength(3);
    expect(files.filter((item) => item.format === "DOCX")).toHaveLength(3);
    await fs.writeFile(
      path.join(evidence, "company-cycle.json"),
      JSON.stringify(
        {
          status: "PASS",
          id,
          revision: issued.revision,
          customerId: issued.customerId,
          companyName,
          proposalId: pending.approval!.proposalId,
          issuanceIds: issued.issuances.map((item) => item.id),
          recipients: before.items.map((item) => ({
            id: item.id,
            fullNameRu: item.fullNameRu,
            fullNameKz: item.fullNameKz,
            sourceRow: item.sourceRow,
            importId: item.importId,
          })),
          previewTargets: [secondTarget, groupTarget],
          documents: issued.documents,
          files,
          syntheticOnly: true,
          managerInputThroughUi: true,
          explicitImportEmployerResolutionThroughUi: true,
          sharedEmployerSurvivesReload: true,
          previewDoesNotIssueOrChangeSource: true,
          directorPreviewAndDecisionThroughUi: true,
          printedPtmCardNameField: "FULL_NAME_RU (preserved reference form)",
          independentKzNamesPreservedInRawAndIssuedSnapshot: true,
          mappedRuKzPositionsVerifiedInPreviewAndOriginal: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await roles.close();
  }
});

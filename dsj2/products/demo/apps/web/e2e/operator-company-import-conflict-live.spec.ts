import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { loginIsolated } from "./operator-full-fix-session";
import { newRecipient, type Draft } from "../lib/types";

test.use({ trace: "off" });

async function read(page: Page, id: string) {
  const response = await page.request.get(`/api/print-requests/${id}`);
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as Draft & {
    jobs: unknown[];
    documents: unknown[];
    issuances: unknown[];
    artifacts: unknown[];
  };
}

test("COMPANY import can explicitly exclude employer conflicts without alignment and preserves the company and existing personal exceptions", async ({
  page,
}, testInfo) => {
  const headers = await loginIsolated(page);
  const stamp = randomUUID().slice(0, 8);
  const companyResponse = await page.request.post("/api/customers", {
    headers,
    data: {
      nameRu: `Синтетическая компания исключения ${stamp}`,
      nameKz: `Сақталған бөлек атау ${stamp}`,
      bin: "123456789012",
      addressRu: "Синтетический адрес компании",
      addressKz: "Компанияның синтетикалық мекенжайы",
    },
  });
  expect(companyResponse.status(), await companyResponse.text()).toBe(201);
  const company = await companyResponse.json();
  const existing = {
    ...newRecipient(),
    fullNameRu: `Сохранённый сотрудник ${stamp}`,
    fullNameKz: "Бөлек сақталған есім",
    positionRu: "Личная должность",
    positionKz: "Жеке лауазым",
    workplaceRu: "Историческое личное исключение работодателя",
    workplaceKz: "Сақталған жеке жұмыс беруші",
    employerBin: "999999999999",
    assignments: [],
  };
  const created = await page.request.post("/api/print-requests", {
    headers,
    data: {
      kind: "COMPANY",
      schemaVersion: 2,
      title: `Синтетическое исключение импорта ${stamp}`,
      demoMode: true,
      customerId: company.id,
      commonFields: {},
      items: [existing],
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const id = (await created.json()).id as string;
  const before = await read(page, id);
  const conflictingName = `Исключённый сотрудник ${stamp}`;
  const acceptedName = `Новый сотрудник компании ${stamp}`;
  const source = [
    "ФИО RU\tФИО KZ\tДолжность RU\tДолжность KZ\tМесто работы RU\tТабельный номер",
    `${conflictingName}\tАлып тасталған есім\tИная должность\tБасқа лауазым\tДругой синтетический работодатель\t00002`,
    `${acceptedName}\tЖаңа қызметкер\tЭлектрик\tЭлектрші\t\t00003`,
  ].join("\n");
  await page.goto(`/requests/${id}/edit`);
  await expect(page.locator("#request-customer")).toContainText(company.nameRu);
  await page.getByRole("button", { name: "Импорт", exact: true }).click();
  const modal = page.getByRole("dialog", {
    name: "Импорт получателей",
    exact: true,
  });
  await modal
    .getByLabel("Или вставьте таблицу с заголовками", { exact: true })
    .fill(source);
  await modal
    .getByRole("button", { name: "Проверить таблицу", exact: true })
    .click();
  const alignment = modal.getByRole("checkbox", {
    name: "Привести эти строки к компании заявки",
    exact: true,
  });
  await expect(alignment).not.toBeChecked();
  await expect(modal.getByText(/Строка 2:/)).toContainText(conflictingName);
  await expect(
    modal.getByRole("button", {
      name: "Добавить 2 строк в черновик",
      exact: true,
    }),
  ).toBeDisabled();
  await modal
    .getByRole("button", {
      name: "Исключить конфликтующие строки",
      exact: true,
    })
    .click();
  await expect(
    modal.getByLabel("Импортировать исходную строку 2", { exact: true }),
  ).not.toBeChecked();
  await expect(
    modal.getByLabel("Импортировать исходную строку 3", { exact: true }),
  ).toBeChecked();
  await expect(
    modal.getByRole("button", {
      name: "Добавить 1 строк в черновик",
      exact: true,
    }),
  ).toBeEnabled();
  // Reopening the excluded row proves exclusion did not silently opt into alignment.
  await modal
    .getByLabel("Импортировать исходную строку 2", { exact: true })
    .check();
  await expect(alignment).not.toBeChecked();
  await expect(
    modal.getByRole("button", {
      name: "Добавить 2 строк в черновик",
      exact: true,
    }),
  ).toBeDisabled();
  await modal
    .getByRole("button", {
      name: "Исключить конфликтующие строки",
      exact: true,
    })
    .click();
  await page.screenshot({
    path: testInfo.outputPath("conflict-excluded-without-alignment.png"),
  });
  const submittedPromise = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === `/api/print-requests/${id}/import`,
  );
  await modal
    .getByRole("button", { name: "Добавить 1 строк в черновик", exact: true })
    .click();
  const submitted = (await submittedPromise).postDataJSON();
  expect(submitted.rows).toHaveLength(1);
  expect(submitted.rows[0].sourceRow).toBe(3);
  expect(submitted.rows[0].fullNameRu).toBe(acceptedName);
  await expect(modal).toHaveCount(0);
  await page.reload();
  const after = await read(page, id);
  expect(after.customerId).toBe(company.id);
  expect(after.items).toHaveLength(2);
  expect(after.items.find((row) => row.id === before.items[0].id)).toEqual(
    before.items[0],
  );
  expect(after.items.some((row) => row.fullNameRu === conflictingName)).toBe(
    false,
  );
  const added = after.items.find((row) => row.fullNameRu === acceptedName)!;
  expect(added).toBeDefined();
  expect(added.fullNameKz).toBe("Жаңа қызметкер");
  expect(added.positionRu).toBe("Электрик");
  expect(added.positionKz).toBe("Электрші");
  expect(added.personnelNumber).toBe("00003");
  expect(added.sourceRow).toBe(3);
  expect(added.importId).toBeTruthy();
  expect(added.employerId || "").toBe("");
  expect(added.workplaceRu || "").toBe("");
  expect(added.workplaceKz || "").toBe("");
  const companies = await page.request.get(
    `/api/customers?search=${encodeURIComponent(company.nameRu)}`,
  );
  expect(companies.ok(), await companies.text()).toBe(true);
  const preservedCompany = (await companies.json()).items.find(
    (row: { id: string }) => row.id === company.id,
  );
  expect(preservedCompany).toBeDefined();
  for (const field of ["nameRu", "nameKz", "bin", "addressRu", "addressKz"])
    expect(preservedCompany[field]).toBe(company[field]);
  for (const field of ["jobs", "documents", "issuances", "artifacts"] as const)
    expect(after[field]).toHaveLength(0);
  await fs.writeFile(
    testInfo.outputPath("company-conflict-exclusion.json"),
    JSON.stringify(
      {
        status: "PASS",
        requestId: id,
        customerId: company.id,
        companyFieldsUnchanged: true,
        alignEmployerNeverSelected: true,
        excludedSourceRows: [2],
        appliedSourceRows: [3],
        sourceSha256: createHash("sha256").update(source).digest("hex"),
        existingRowPreserved: true,
        oldRowId: before.items[0].id,
        newRowId: added.id,
        existingIndependentLanguagesAndEmployerPreserved: true,
        inheritedEmployer: true,
        persistedAfterReload: true,
        noRenderOrIssuance: true,
      },
      null,
      2,
    ),
  );
});

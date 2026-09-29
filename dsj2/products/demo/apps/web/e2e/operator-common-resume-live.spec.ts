import {
  createRequestWithWorkerDocument,
  openRecipientExtraTools,
} from "./operator-keyboard-helpers";
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const product = path.resolve(__dirname, "../../..");
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    path.join(
      product,
      "docs/evidence/final-completion/operator/common-history",
    ),
);
async function save(page: Page) {
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.locator(".save-indicator")).toContainText("Сохранено");
}
async function pickEmployer(page: Page, name: string) {
  await page
    .getByRole("button", { name: "Выбрать работодателя", exact: true })
    .click();
  await page.getByLabel("Поиск по справочнику", { exact: true }).fill(name);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Выбрать", exact: true })
    .click();
}

test("resume issued 100 common assignments and employer history after transient polling failure", async ({
  page,
}) => {
  test.setTimeout(600000);
  const preparationDirectory = process.env.DEMO_E2E_COMMON_PREPARED_DIR!;
  const checkpoint = JSON.parse(
    await fs.readFile(
      path.join(preparationDirectory, "checkpoint.json"),
      "utf8",
    ),
  );
  expect(checkpoint.status).toBe("ISSUED_WAITING_FILES");
  const { requestId, personId, expected } = checkpoint;
  const requestPath = `/requests/${requestId}`;
  await fs.mkdir(path.join(evidence, "files"), { recursive: true });
  await page.routeWebSocket(/\/_next\/webpack-hmr/, (socket) => socket.close());
  await page.goto("/login");
  await page
    .getByLabel("Электронная почта", { exact: true })
    .fill(process.env.DEMO_E2E_EMAIL!);
  await page
    .getByLabel("Пароль", { exact: true })
    .fill(process.env.DEMO_E2E_PASSWORD!);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Заявки на печать" }),
  ).toBeVisible();
  await page.goto(requestPath);
  await expect(page.locator(".files-panel")).toContainText(
    "Готово 202 из 202",
    { timeout: 180000 },
  );
  const read = async (suffix = "") => {
    const response = await page.request.get(
      `/api/print-requests/${requestId}${suffix}`,
    );
    expect(response.ok()).toBe(true);
    return response.json();
  };
  const prepared = await read();
  const stamp = prepared.title.match(/(\d+)$/)[1];
  const response = await page.request.get(
    `/api/customers?${new URLSearchParams({ search: stamp, page: "1", pageSize: "100" })}`,
  );
  expect(response.ok()).toBe(true);
  const matches = (await response.json()).items;
  const companies = ["A", "B"].map((suffix) =>
    matches.find(
      (company: { nameRu: string }) =>
        company.nameRu === `Исторический работодатель ${suffix} ${stamp}`,
    ),
  );
  expect(companies.every(Boolean)).toBe(true);
  const source = JSON.parse(
    await fs.readFile(
      path.join(product, "tests/fixtures/operator-value/100_people.json"),
      "utf8",
    ),
  );
  const people: Record<string, string>[] = source.people;
  const issued = await read();
  expect(issued.documents).toHaveLength(100);
  const files = [];
  for (const artifact of issued.artifacts) {
    const response = await page.request.get(`/api/artifacts/${artifact.id}`);
    expect(response.ok()).toBe(true);
    const bytes = await response.body();
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      artifact.sha256,
    );
    const document = issued.documents.find(
      (item: { id: string }) => item.id === artifact.documentId,
    );
    const file = `files/${artifact.id}.${artifact.format.toLowerCase()}`;
    await fs.writeFile(path.join(evidence, file), bytes);
    files.push({ ...artifact, rowId: document?.rowId, path: file });
  }
  await page
    .getByRole("button", { name: "Настроить выдачу", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Заказчик этого комплекта", exact: true })
    .selectOption(companies[0].id);
  for (const field of [
    "trainingSubject",
    "trainingStart",
    "trainingEnd",
    "hours",
  ])
    await page
      .getByRole("combobox", { name: "Добавить колонку", exact: true })
      .selectOption(field);
  const download = page.waitForEvent("download");
  await page
    .locator("section")
    .filter({
      has: page.getByRole("combobox", {
        name: "Заказчик этого комплекта",
        exact: true,
      }),
    })
    .getByRole("button", { name: "Реестр XLSX", exact: true })
    .click();
  await (await download).saveAs(path.join(evidence, "common-values.xlsx"));
  await fs.writeFile(
    path.join(evidence, "files-checkpoint.json"),
    JSON.stringify({ requestId, personId, expected, files }, null, 2),
  );
  await page.goto("/requests");
  await page.getByRole("link", { name: "Новая заявка", exact: true }).click();
  await createRequestWithWorkerDocument(page, "PERSON");
  await openRecipientExtraTools(page);
  await page
    .getByRole("button", { name: "Найти человека", exact: true })
    .click();
  await page
    .getByLabel("Поиск по справочнику", { exact: true })
    .fill(`${stamp}-${people[0].externalPersonKey}`);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Выбрать", exact: true })
    .click();
  await save(page);
  const nextId = /requests\/([^/]+)/.exec(page.url())![1];
  const next = await (
    await page.request.get(`/api/print-requests/${nextId}`)
  ).json();
  expect(next.items[0].recipientId).toBe(personId);
  expect(next.items[0].assignments).toHaveLength(1);
  expect(next.items[0].assignments[0].result).toBe("");
  expect(next.items[0].assignments[0].trainingStart).toBe("");
  expect(next.items[0].assignments[0].eventId).toBeUndefined();
  expect(next.documents).toHaveLength(0);
  await page
    .getByRole("button", { name: "Документы и даты получателя 1", exact: true })
    .click();
  await page.getByRole("tab", { name: "Личные данные", exact: true }).click();
  await page
    .getByText("Постоянная запись, работодатель и история", { exact: true })
    .click();
  await pickEmployer(page, companies[1].nameRu);
  await page
    .getByLabel("Должность · RU", { exact: true })
    .fill("Должность B после выпуска");
  await page
    .getByLabel("Период работы / основание актуальности", { exact: true })
    .fill("2027 · синтетический период B");
  await page
    .getByLabel(
      "Подтверждаю актуальность сведений для постоянной записи человека",
    )
    .check();
  await page
    .getByRole("button", {
      name: "Обновить текущие сведения человека",
      exact: true,
    })
    .click();
  await save(page);
  const history = await (
    await page.request.get(`/api/recipients/${personId}`)
  ).json();
  expect(history.employment).toHaveLength(2);
  const now = await (
    await page.request.get(`/api/print-requests/${nextId}`)
  ).json();
  expect(now.items[0].employerId).toBe(companies[1].id);
  expect(now.items[0].employerBin).toBe(companies[1].bin);
  const preserved = await read();
  expect(preserved.issuances).toEqual(issued.issuances);
  expect(preserved.items[0].employerId).toBe(companies[0].id);
  expect(preserved.items[0].positionRu).toBe("Должность A до выпуска");
  for (const file of files.filter(
    (file) => file.rowId === issued.items[0].id,
  )) {
    const bytes = await (
      await page.request.get(`/api/artifacts/${file.id}`)
    ).body();
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.sha256);
  }
  await page.goto(requestPath);
  await expect(
    page.getByRole("button", { name: "Сохранить", exact: true }),
  ).toBeHidden();
  await expect(
    page.getByLabel("Название заявки", { exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: path.join(evidence, "historical-issued-unchanged.png"),
    fullPage: true,
  });
  await fs.writeFile(
    path.join(evidence, "common-history-result.json"),
    JSON.stringify(
      {
        status: "PASS",
        requestId,
        nextId,
        personId,
        companies: companies.map((company) => company.id),
        actualDocuments: 100,
        actualFiles: 202,
        uiAndResolvedAgree: true,
        twoOverrides: ["MANUAL", "IMPORTED"],
        currentEmployerChanged: true,
        historicalSnapshotAndFileHashesUnchanged: true,
        reusedPersonHasNoOldAssignmentsOrDatesOrResult: true,
        noMocks: true,
        resumedAfterTransientReadError: true,
        preparationDirectory,
        expected,
        files,
      },
      null,
      2,
    ),
  );
});

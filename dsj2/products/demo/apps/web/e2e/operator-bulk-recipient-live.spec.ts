import { openRecipientExtraTools } from "./operator-keyboard-helpers";
import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import { newAssignment, newRecipient, type Draft } from "../lib/types";
import { loginIsolated } from "./operator-full-fix-session";
test.use({ trace: "off" });

test("real API preserves selected-only workplace changes, individual exceptions, RU/KZ and undo after reload", async ({
  page,
}, testInfo) => {
  if (
    !process.env.DEMO_E2E_EMAIL ||
    !process.env.DEMO_E2E_PASSWORD ||
    process.env.DEMO_E2E_ISOLATED_TENANT !== "1"
  ) {
    throw new Error("An explicitly isolated synthetic tenant is required");
  }
  await page.routeWebSocket(/\/_next\/webpack-hmr/, (socket) => socket.close());
  await loginIsolated(page);
  const session = await page.request.get("/api/auth/session");
  expect(session.ok()).toBe(true);
  const csrf = (await session.json()).csrfToken;
  const response = await page.request.post("/api/print-requests", {
    headers: { origin: new URL(page.url()).origin, "x-csrf-token": csrf },
    data: {
      kind: "COMPANY",
      title: `Синтетическая общая организация · ${Date.now()}`,
      customerId: null,
      demoMode: true,
      schemaVersion: 2,
      commonFields: {},
      items: Array.from({ length: 10 }, (_, index) => ({
        ...newRecipient(),
        fullNameRu: `Синтетический Получатель ${index + 1}`,
        fullNameKz: `Синтетикалық алушы ${index + 1}`,
        positionRu: index % 2 ? "Мастер" : "Инженер",
        positionKz: index % 2 ? "Шебер" : "Инженер",
        workplaceRu: index === 1 ? "Индивидуальная организация" : "",
        workplaceKz: `Расталған ұйым ${index + 1}`,
        assignments: [newAssignment(index % 2 ? "ptm-card" : "pb-card")],
      })),
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const created = (await response.json()) as Draft;
  const read = async () => {
    const result = await page.request.get(`/api/print-requests/${created.id}`);
    expect(result.ok()).toBe(true);
    return (await result.json()) as Draft;
  };
  const before = await read();
  const expected = structuredClone(before.items);
  expected[0].workplaceRu = "Общая синтетическая организация";
  expected[2].workplaceRu = "Общая синтетическая организация";
  await page.goto(`/requests/${created.id}/edit`);
  await expect(page.locator(".operator-grid tbody tr")).toHaveCount(10);
  for (const row of [1, 2, 3])
    await page.getByLabel(`Выбрать строку ${row}`, { exact: true }).check();
  await page.getByLabel("Поиск в заявке", { exact: true }).fill("Получатель 3");
  await expect(page.locator(".selection-toolbar")).toContainText(
    "скрыто фильтрами: 2",
  );
  const open = page.getByRole("button", {
    name: "Изменить данные выбранных (3)",
    exact: true,
  });
  await openRecipientExtraTools(page);
  await open.click();
  const modal = page.getByRole("dialog");
  await modal.getByText("Должность и место работы", { exact: true }).click();
  await modal
    .getByRole("checkbox", { name: "Место работы RU", exact: true })
    .check();
  await modal
    .getByLabel("Общее значение: Место работы RU", { exact: true })
    .fill(expected[0].workplaceRu!);
  await expect(
    modal.getByRole("combobox", { name: "Направление", exact: true }),
  ).toHaveValue("");
  await modal
    .getByRole("button", { name: "Показать изменения", exact: true })
    .click();
  await expect(
    modal.getByRole("region", { name: "Предварительные изменения" }),
  ).toContainText("2 человек");
  await expect(
    modal.getByRole("region", { name: "Предварительные изменения" }),
  ).toBeFocused();
  await page.screenshot({
    path: testInfo.outputPath("live-person-bulk-preview.png"),
  });
  await modal
    .getByRole("button", { name: "Применить 2 изменений", exact: true })
    .click();
  await expect(modal).toHaveCount(0);
  expect((await read()).items).toEqual(expected);
  await openRecipientExtraTools(page);
  await open.click();
  await modal.getByText("Должность и место работы", { exact: true }).click();
  await modal
    .getByRole("checkbox", { name: "Место работы RU", exact: true })
    .check();
  await modal
    .getByLabel("Общее значение: Место работы RU", { exact: true })
    .fill("Подтверждённая замена");
  await modal
    .getByRole("combobox", { name: "Режим применения", exact: true })
    .selectOption("REPLACE");
  await modal
    .getByRole("button", { name: "Показать изменения", exact: true })
    .click();
  const apply = modal.getByRole("button", {
    name: "Применить 3 изменений",
    exact: true,
  });
  await expect(apply).toBeDisabled();
  await modal
    .getByRole("checkbox", { name: /Подтверждаю замену отмеченных полей/ })
    .check();
  await apply.click();
  await expect(modal).toHaveCount(0);
  const replaced = structuredClone(expected);
  for (const index of [0, 1, 2])
    replaced[index].workplaceRu = "Подтверждённая замена";
  expect((await read()).items).toEqual(replaced);
  await page
    .getByRole("button", { name: "Отменить массовое изменение", exact: true })
    .click();
  await expect.poll(async () => (await read()).items).toEqual(expected);
  await page.reload();
  await page
    .getByRole("button", { name: "Детали получателя 1", exact: true })
    .click();
  await page.getByRole("tab", { name: /^Личные данные/ }).click();
  await page.locator(".employer-document-wording > summary").click();
  await expect(
    page.getByRole("dialog").getByLabel("Место работы · RU", { exact: true }),
  ).toHaveValue(expected[0].workplaceRu!);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Вернуться к списку", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Детали получателя 2", exact: true })
    .click();
  await page.getByRole("tab", { name: /^Личные данные/ }).click();
  const employerDetails = page.locator(".employer-document-wording");
  if (
    !(await employerDetails.evaluate(
      (node) => (node as HTMLDetailsElement).open,
    ))
  )
    await employerDetails.locator(":scope > summary").click();
  await expect(
    page.getByRole("dialog").getByLabel("Место работы · RU", { exact: true }),
  ).toHaveValue("Индивидуальная организация");
  const after = await read();
  expect(after.items).toEqual(expected);
  expect(after.status).toBe("DRAFT");
  await fs.writeFile(
    testInfo.outputPath("real-bulk-result.json"),
    JSON.stringify(
      {
        status: "PASS",
        requestId: created.id,
        url: page.url(),
        rows: 10,
        selected: 3,
        hiddenSelected: 2,
        emptyChanges: 2,
        replacementChanges: 3,
        allRawFieldsRereadEqual: true,
        restoredAfterUndoAndReload: true,
        revision: after.revision,
        scope: "isolated synthetic tenant; no issuance or production",
      },
      null,
      2,
    ),
  );
});

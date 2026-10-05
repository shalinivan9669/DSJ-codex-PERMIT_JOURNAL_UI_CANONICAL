import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { trainingDirection } from "@demo/contracts";
import type { Draft } from "../lib/types";
import { loginRole } from "./operator-role-fixture";

async function readDraft(page: Page, id: string) {
  const response = await page.request.get(`/api/print-requests/${id}`);
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as Draft;
}

test("ordinary new request keeps positive BIOT PTM PB defaults and saved BIOT 10 plus 16 hours through real director approval", async ({
  page,
  browser,
}, testInfo) => {
  // This regression creates one synthetic request only in the prepared local
  // demoOnly tenant. It neither resets the profile nor creates role users.
  const configuredOrigin = new URL(
    process.env.DEMO_ORIGIN || "http://localhost:3100",
  );
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
    configuredOrigin.hostname,
  );
  expect(process.env.DEMO_E2E_ISOLATED_TENANT).toBe("1");
  const operator = await loginRole(page, "OPERATOR");
  const directorContext = await browser.newContext({
    baseURL: configuredOrigin.origin,
  });
  try {
    const directorPage = await directorContext.newPage();
    const director = await loginRole(directorPage, "DIRECTOR");
    expect(director.session.tenant.id).toBe(operator.session.tenant.id);

    // Exercise the actual ordinary creation form, including its empty initial
    // assignments. Supplying a ready API fixture would hide the regression.
    await page.goto("/requests/new");
    await page
      .getByRole("radio", { name: "Физическое лицо", exact: true })
      .check();
    await page.getByRole("button", { name: "Далее", exact: true }).click();
    await expect(page).toHaveURL(/\/requests\/[a-f0-9-]+\/edit$/);
    const id = /\/requests\/([a-f0-9-]+)\/edit$/.exec(page.url())![1];
    const initial = await readDraft(page, id);
    expect(initial.items).toHaveLength(1);
    expect(initial.items[0].assignments).toHaveLength(0);
    expect(initial.status).toBe("DRAFT");

    const name = `Синтетический Обычный Получатель ${randomUUID().slice(0, 8)}`;
    await page.getByLabel("ФИО, строка 1", { exact: true }).fill(name);
    await page
      .getByLabel("Должность · RU, строка 1", { exact: true })
      .fill("Электромонтёр");
    await page
      .getByLabel("Должность · KZ, строка 1", { exact: true })
      .fill("Электрмонтер");
    await page
      .getByRole("button", { name: "Детали получателя 1", exact: true })
      .click();
    const personal = page.getByRole("dialog");
    await personal.getByRole("tab", { name: /^Личные данные/ }).click();
    await personal.locator(".employer-document-wording > summary").click();
    await personal
      .getByLabel("Место работы · RU", { exact: true })
      .fill("СИНТЕТИЧЕСКОЕ предприятие локальной проверки");
    await personal
      .getByRole("button", { name: "Вернуться к списку", exact: true })
      .click();

    for (const course of ["БиОТ", "ПТМ", "ПБ"]) {
      await page
        .getByRole("button", {
          name: `${course}: добавить всем в заявке (1)`,
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("button", {
          name: `${course}: снять у этой группы (1)`,
          exact: true,
        }),
      ).toHaveAttribute("aria-pressed", "true");
    }
    // A configured centre calendar requires real programme hours. They are
    // entered once through the course UI only when that rule is active.
    for (const course of ["ПТМ", "ПБ"]) {
      const hours = page.getByLabel(`${course} · Часы программы`, {
        exact: true,
      });
      if (await hours.count()) await hours.fill("16");
    }
    await expect
      .poll(async () => {
        const saved = await readDraft(page, id);
        return {
          name: saved.items[0].fullNameRu,
          workplace: saved.items[0].workplaceRu,
          courses: [
            ...new Set(
              saved.items[0].assignments.map((assignment) =>
                trainingDirection(assignment.templateId),
              ),
            ),
          ].sort(),
          statuses: [
            ...new Set(
              saved.items[0].assignments.map(
                (assignment) => assignment.outcome?.status,
              ),
            ),
          ],
        };
      })
      .toEqual({
        name,
        workplace: "СИНТЕТИЧЕСКОЕ предприятие локальной проверки",
        courses: ["BIOT", "PB", "PTM"],
        statuses: ["PASSED"],
      });
    await page.reload();
    await expect(page.getByLabel("ФИО, строка 1", { exact: true })).toHaveValue(
      name,
    );
    const saved = await readDraft(page, id);
    expect(saved.revision).toBeGreaterThan(initial.revision);
    expect(saved.status).toBe("DRAFT");
    expect(saved.approval?.status).not.toBe("PENDING");
    const expectedResults = {
      BIOT: { result: "Өтті/прошел", resultKz: "Өтті" },
      PTM: { result: "Прошел/ Өтті", resultKz: "Өтті" },
      PB: { result: "Тапсырды/сдал", resultKz: "Тапсырды" },
    } as const;
    for (const assignment of saved.items[0].assignments) {
      const direction = trainingDirection(
        assignment.templateId,
      ) as keyof typeof expectedResults;
      expect(assignment).toMatchObject({
        ...expectedResults[direction],
        outcome: {
          status: "PASSED",
          source: "Стандартный положительный результат при создании назначения",
        },
      });
    }
    const biotEvent = saved.events!.find(
      (event) => trainingDirection(event.protocolTemplateId) === "BIOT",
    )!;
    expect(biotEvent.commonFields).toMatchObject({
      hours: "10",
      productionHours: "16",
    });
    const biotIndex = saved.items[0].assignments.findIndex(
      (assignment) => assignment.templateId === "biot-worker-card",
    );
    expect(biotIndex).toBeGreaterThanOrEqual(0);
    await page
      .getByRole("button", { name: "Детали получателя 1", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("tab", { name: /^Документы/ })
      .click();
    await expect(
      page
        .getByRole("dialog")
        .locator(`[data-field-path="items.0.assignments.${biotIndex}.hours"]`),
    ).toHaveValue("10");
    await expect(
      page
        .getByRole("dialog")
        .locator(
          `[data-field-path="items.0.assignments.${biotIndex}.productionHours"]`,
        ),
    ).toHaveValue("16");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Вернуться к списку", exact: true })
      .click();

    const panel = page.getByRole("region", {
      name: "Готовность и состав следующего выпуска",
    });
    await expect(
      panel.getByLabel("Все подтверждённые ещё не оформленные курсы (3)", {
        exact: true,
      }),
    ).toBeEnabled();
    await panel
      .getByLabel("Все подтверждённые ещё не оформленные курсы (3)", {
        exact: true,
      })
      .check();
    const validated = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/print-requests/${id}/approval/submit`),
      { timeout: 210000 },
    );
    await panel
      .getByRole("button", {
        name: "Проверить и передать директору (3 назначений, 1 человек)",
        exact: true,
      })
      .click();
    const validationResponse = await validated;
    expect(validationResponse.ok(), await validationResponse.text()).toBe(true);
    const validation = await validationResponse.json();
    expect(validation.approval.status).toBe("PENDING");
    expect(validation.approval.assignments).toHaveLength(
      saved.items.reduce((total, row) => total + row.assignments.length, 0),
    );
    await expect
      .poll(async () => (await readDraft(page, id)).approval?.status)
      .toBe("PENDING");
    const submitted = await readDraft(page, id);

    await directorPage.goto(
      `/approvals?proposal=${submitted.approval!.proposalId}`,
    );
    await directorPage
      .getByLabel("Комментарий к решению", { exact: true })
      .fill("СИНТЕТИЧЕСКАЯ локальная проверка обычных положительных defaults");
    const decided = directorPage.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response
          .url()
          .endsWith(`/approvals/${submitted.approval!.proposalId}/decision`),
    );
    await directorPage
      .getByRole("button", { name: "Согласовать эту редакцию", exact: true })
      .click();
    const decision = await decided;
    expect(decision.status(), await decision.text()).toBe(201);
    await expect
      .poll(async () => (await readDraft(page, id)).approval?.status)
      .toBe("APPROVED");
    const approved = await readDraft(page, id);
    expect(approved.items).toEqual(submitted.items);
    expect(approved.events).toEqual(submitted.events);
    await directorPage.screenshot({
      path: testInfo.outputPath("ordinary-defaults-director-approved.png"),
      fullPage: true,
    });
    await fs.writeFile(
      testInfo.outputPath("ordinary-defaults-readback.json"),
      JSON.stringify(
        {
          synthetic: true,
          mockedApi: false,
          createdThroughUi: true,
          submittedThroughUi: true,
          approvedThroughUi: true,
          requestId: id,
          rowId: saved.items[0].id,
          savedRevision: saved.revision,
          approvedRevision: approved.approvedRevision,
          approval: approved.approval,
          biotSavedCommonFields: biotEvent.commonFields,
          defaults: saved.items[0].assignments.map(
            ({ id, templateId, result, resultKz, outcome }) => ({
              id,
              templateId,
              result,
              resultKz,
              outcome,
            }),
          ),
          validation,
        },
        null,
        2,
      ),
    );
  } finally {
    await directorContext.close();
  }
});

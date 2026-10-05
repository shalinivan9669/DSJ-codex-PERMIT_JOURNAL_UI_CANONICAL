import { expect, test } from "@playwright/test";
import { resolveDraft } from "@demo/contracts";
import { newAssignment, newRecipient, type Draft } from "../lib/types";

test("conflict copy isolates events and safely retries a committed copy after a lost response", async ({
  page,
}) => {
  const original: Draft = {
    id: "copy-source",
    revision: 3,
    status: "DRAFT",
    kind: "COMPANY",
    title: "Синтетическая конфликтующая заявка",
    customerId: "company",
    demoMode: true,
    events: [
      {
        id: "root-event",
        title: "Рабочие",
        revision: 0,
        protocolTemplateId: "biot-protocol",
        commonFields: {},
      },
      {
        id: "derived-event",
        rootEventId: "root-event",
        title: "ИТР",
        revision: 0,
        protocolTemplateId: "biot-itr-protocol",
        commonFields: {},
      },
    ],
    trainingDefaults: [
      { direction: "BIOT", eventIds: ["root-event", "derived-event"] },
    ],
    items: [
      {
        ...newRecipient(),
        id: "person",
        fullNameRu: "Синтетический Получатель",
        positionRu: "Исходная должность",
        assignments: [
          {
            ...newAssignment("biot-itr-certificate"),
            id: "credential",
            eventId: "derived-event",
            fieldOrigins: { result: "CLEARED" },
            result: "",
          },
        ],
      },
    ],
  };
  const baseline = structuredClone(original);
  let copied: Draft | undefined;
  const creates: Array<{ key: string | undefined; body: string }> = [];
  let createdCount = 0;
  let releaseResponse = () => {};
  const delayed = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname.slice(4);
    let data: unknown = { items: [], total: 0 };
    if (path === "/auth/session") data = { csrfToken: "synthetic" };
    else if (path === "/context")
      data = {
        user: {
          id: "operator",
          role: "OPERATOR",
          displayName: "Оператор",
          email: "operator@example.invalid",
        },
        tenant: {
          id: "copy-test",
          name: "Синтетический центр",
          timezone: "Asia/Qyzylorda",
          demoOnly: true,
        },
        profile: {
          approved: true,
          nameRu: "Тест",
          nameKz: "Тест",
          cityRu: "Тест",
          cityKz: "Тест",
          addressRu: "",
          addressKz: "",
          approvalBasis: "",
          commission: [],
        },
        templates: [],
        numbering: {},
      };
    else if (path === "/customers")
      data = {
        items: [
          {
            id: "company",
            nameRu: "Синтетическая компания",
            nameKz: "Компания",
            bin: "",
            addressRu: "",
            addressKz: "",
            archived: false,
          },
        ],
        total: 1,
      };
    else if (path === "/print-requests" && request.method() === "POST") {
      creates.push({
        key: request.headers()["idempotency-key"],
        body: request.postData()!,
      });
      if (!copied) {
        const payload = JSON.parse(creates[0].body);
        copied = {
          ...payload,
          id: "copy-result",
          revision: 0,
          status: "DRAFT",
        };
        createdCount++;
        await delayed;
        await route.abort("failed");
        return;
      }
      expect(creates.at(-1)).toEqual(creates[0]);
      data = copied;
    } else if (path.endsWith("/resolved"))
      data = resolveDraft(path.includes("copy-result") ? copied! : original);
    else if (path.endsWith("/signing"))
      data = {
        status: null,
        archived: false,
        documents: [],
        missingBindings: [],
        providers: {
          EGOV_QR: { available: false },
          NCALAYER: { available: false },
        },
      };
    else if (path === "/print-requests/copy-source") {
      if (request.method() === "PATCH") {
        await route.fulfill({
          status: 409,
          json: {
            code: "REVISION_CONFLICT",
            message: "Синтетический конфликт редакций",
          },
        });
        return;
      }
      data = original;
    } else if (path === "/print-requests/copy-result") {
      if (request.method() === "PATCH") {
        copied = {
          ...copied!,
          ...request.postDataJSON().draft,
          revision: copied!.revision + 1,
        };
        data = { revision: copied!.revision };
      } else data = copied;
    }
    await route.fulfill({ json: data });
  });
  await page.goto("/requests/copy-source/edit");
  await page
    .getByLabel("Должность · RU, строка 1", { exact: true })
    .fill("Мой несохранённый ввод");
  const dialog = page.getByRole("dialog", {
    name: "Заявка изменена в другом окне",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  const copy = dialog.getByRole("button", {
    name: "Сохранить мой ввод в копию",
    exact: true,
  });
  await copy.dblclick();
  await expect.poll(() => creates.length).toBe(1);
  releaseResponse();
  await expect(copy).toBeEnabled();
  await copy.click();
  await expect(page).toHaveURL(/\/requests\/copy-result\/edit$/);
  expect(creates).toHaveLength(2);
  expect(creates[1]).toEqual(creates[0]);
  expect(createdCount).toBe(1);
  expect(original).toEqual(baseline);
  const payload = JSON.parse(creates[0].body);
  const ids = payload.events.map((event: { id: string }) => event.id);
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);
  expect(ids).not.toContain("root-event");
  expect(ids).not.toContain("derived-event");
  expect(payload.events[1].rootEventId).toBe(ids[0]);
  expect(payload.trainingDefaults[0].eventIds).toEqual(ids);
  expect(payload.items[0].assignments[0].eventId).toBe(ids[1]);
  expect(payload.items[0].assignments[0].result).toBe("");
  expect(payload.items[0].assignments[0].fieldOrigins.result).toBe("CLEARED");
  await expect(
    page.getByLabel("Должность · RU, строка 1", { exact: true }),
  ).toHaveValue("Мой несохранённый ввод");
  await page
    .getByLabel("Должность · RU, строка 1", { exact: true })
    .fill("Следующая правка копии");
  await expect
    .poll(() => copied?.items[0].positionRu)
    .toBe("Следующая правка копии");
  expect(original).toEqual(baseline);
});

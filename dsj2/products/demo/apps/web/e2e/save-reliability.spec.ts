import { expect, test, type Page, type Route } from "@playwright/test";
import { newRecipient, type Draft } from "../lib/types";

test.setTimeout(60000);
test.use({ trace: "off" });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

async function workspace(page: Page) {
  let draft: Draft = {
    id: "save-reliability",
    revision: 0,
    status: "DRAFT",
    kind: "PERSON",
    title: "Синтетическая проверка сохранения",
    customerId: null,
    demoMode: true,
    schemaVersion: 2,
    commonFields: {},
    items: [
      { ...newRecipient(), id: "row-1", fullNameRu: "Исходный Получатель" },
    ],
  };
  const saves: Array<{ expectedRevision: number; draft: Partial<Draft> }> = [];
  let patch: ((route: Route, index: number) => Promise<boolean>) | undefined;
  await page.routeWebSocket(/\/_next\/webpack-hmr/, (socket) => socket.close());
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname.slice(4);
    let value: unknown = { items: [], total: 0 };
    if (pathname === "/auth/session") value = { csrfToken: "fixture" };
    else if (pathname === "/context")
      value = {
        user: {
          id: "operator",
          displayName: "Оператор",
          role: "OPERATOR",
          email: "test@example.invalid",
        },
        tenant: {
          id: "synthetic",
          name: "Синтетический центр",
          timezone: "Asia/Almaty",
          demoOnly: true,
        },
        profile: {
          nameRu: "Тест",
          nameKz: "Тест",
          addressRu: "",
          addressKz: "",
          cityRu: "",
          cityKz: "",
          approvalBasis: "",
          commission: [],
          approved: true,
        },
        templates: [],
        numbering: {},
      };
    else if (pathname === "/print-requests")
      value = { items: [draft], total: 1, page: 1, pageSize: 20 };
    else if (pathname === "/print-requests/save-reliability") {
      if (route.request().method() === "PATCH") {
        const input = route.request().postDataJSON();
        saves.push(input);
        if (await patch?.(route, saves.length)) return;
        if (input.expectedRevision !== draft.revision) {
          await route.fulfill({
            status: 409,
            json: { message: "Редакция изменилась" },
          });
          return;
        }
        draft = { ...draft, ...input.draft, revision: draft.revision + 1 };
        value = { revision: draft.revision };
      } else value = draft;
    }
    await route.fulfill({ json: value });
  });
  await page.goto("/requests");
  await expect(
    page.getByRole("heading", { name: "Заявки на печать", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", {
      name: "Синтетическая проверка сохранения",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("ФИО", { exact: true })).toBeVisible();
  return {
    saves,
    getDraft: () => draft,
    setPatch: (handler: typeof patch) => {
      patch = handler;
    },
    foreignEdit: () => {
      draft = {
        ...draft,
        revision: draft.revision + 1,
        title: "Изменено в другом окне",
      };
    },
  };
}

test("slow saves serialize latest input without stale values, then survive reload", async ({
  page,
}) => {
  const model = await workspace(page);
  const first = deferred();
  model.setPatch(async (_route, index) => {
    if (index === 1) await first.promise;
    return false;
  });
  const name = page.getByLabel("ФИО", { exact: true });
  await name.fill("Первая редакция");
  await expect.poll(() => model.saves.length).toBe(1);
  await name.fill("Последняя редакция Ә Ғ Қ Ң Ө Ұ Ү Һ І");
  await page.waitForTimeout(850);
  expect(model.saves).toHaveLength(1);
  first.resolve();
  await expect(page.locator(".save-indicator")).toContainText(
    "Рабочая версия сохранена",
  );
  expect(model.saves.map((save) => save.expectedRevision)).toEqual([0, 1]);
  expect(model.getDraft().items[0].fullNameRu).toBe(
    "Последняя редакция Ә Ғ Қ Ң Ө Ұ Ү Һ І",
  );
  await page.reload();
  await expect(name).toHaveValue("Последняя редакция Ә Ғ Қ Ң Ө Ұ Ү Һ І");
});

test("late rejected payload keeps the review marked stale after newer local input", async ({
  page,
}) => {
  const model = await workspace(page);
  const rejected = deferred();
  model.setPatch(async (route, index) => {
    if (index > 1) return false;
    await rejected.promise;
    await route.fulfill({
      status: 400,
      json: {
        message: "Исправьте данные",
        details: [
          {
            path: "draft.items.0.fullNameRu",
            message: "ФИО из прежнего запроса некорректно",
            rowId: "row-1",
          },
        ],
      },
    });
    return true;
  });
  const name = page.getByLabel("ФИО", { exact: true });
  await name.fill("Прежняя ошибка");
  await expect.poll(() => model.saves.length).toBe(1);
  await name.fill("Исправленное Имя");
  rejected.resolve();
  await expect(page.locator(".validation-result")).toContainText(
    "Данные изменены",
  );
  await expect(name).toHaveValue("Исправленное Имя");
});

test("browser Back waits for saving before leaving the editor", async ({
  page,
}) => {
  const model = await workspace(page);
  const saved = deferred();
  model.setPatch(async () => {
    await saved.promise;
    return false;
  });
  await page.getByLabel("ФИО", { exact: true }).fill("Сохранить до возврата");
  await page.evaluate(() => history.back());
  await expect.poll(() => model.saves.length).toBe(1);
  await expect(page.getByLabel("ФИО", { exact: true })).toHaveValue(
    "Сохранить до возврата",
  );
  // Repeated Back while the first save is pending must not replay two traversals.
  await page.evaluate(() => history.back());
  await expect(page).toHaveURL(/\/requests\/save-reliability$/);
  expect(model.saves).toHaveLength(1);
  saved.resolve();
  await expect(
    page.getByRole("heading", { name: "Заявки на печать", exact: true }),
  ).toBeVisible();
  expect(model.getDraft().items[0].fullNameRu).toBe("Сохранить до возврата");
  await page
    .getByRole("link", {
      name: model.getDraft().title,
      exact: true,
    })
    .click();
  await expect(page.getByLabel("ФИО", { exact: true })).toHaveValue(
    "Сохранить до возврата",
  );
});

test("failed Back navigation and cancelled reload preserve input until retry", async ({
  page,
}) => {
  const model = await workspace(page);
  model.setPatch(async (route) => {
    await route.abort("failed");
    return true;
  });
  const name = page.getByLabel("ФИО", { exact: true });
  await name.fill("Остаться при ошибке связи");
  await page.evaluate(() => history.back());
  await expect(page.locator(".save-indicator")).toContainText("Не сохранено");
  await expect(name).toHaveValue("Остаться при ошибке связи");
  await expect(page).toHaveURL(/\/requests\/save-reliability(?:\/edit)?$/);
  const beforeUnload = page.waitForEvent("dialog");
  await page.evaluate(() => {
    setTimeout(() => location.reload(), 0);
  });
  const dialog = await beforeUnload;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss();
  await expect(name).toHaveValue("Остаться при ошибке связи");
  model.setPatch(undefined);
  await page
    .getByRole("button", { name: "Повторить сохранение", exact: true })
    .click();
  await expect(page.locator(".save-indicator")).toContainText(
    "Рабочая версия сохранена",
  );
  await page.reload();
  await expect(name).toHaveValue("Остаться при ошибке связи");
});

test("conflicting edit remains local and never overwrites the server version", async ({
  page,
}) => {
  const model = await workspace(page);
  model.foreignEdit();
  await page
    .getByLabel("ФИО", { exact: true })
    .fill("Локальный ввод при конфликте");
  await expect(
    page.getByRole("dialog", {
      name: "Заявка изменена в другом окне",
      exact: true,
    }),
  ).toBeVisible();
  expect(model.getDraft().items[0].fullNameRu).toBe("Исходный Получатель");
  expect(model.getDraft().title).toBe("Изменено в другом окне");
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("ФИО", { exact: true })).toHaveValue(
    "Локальный ввод при конфликте",
  );
  await expect(page.locator(".save-indicator")).toContainText(
    "Сохранение приостановлено",
  );
});

test("history fallback without Navigation API retains failed input and later leaves after a good save", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "navigation", { value: undefined }),
  );
  const model = await workspace(page);
  model.setPatch(async (route) => {
    await route.abort("failed");
    return true;
  });
  const name = page.getByLabel("ФИО", { exact: true });
  await name.fill("Сохранение в прежнем браузере");
  await page.evaluate(() => history.back());
  await expect(page.locator(".save-indicator")).toContainText("Не сохранено");
  await expect(name).toHaveValue("Сохранение в прежнем браузере");
  await expect(page).toHaveURL(/\/requests\/save-reliability$/);
  model.setPatch(undefined);
  await page.evaluate(() => history.back());
  await expect(
    page.getByRole("heading", { name: "Заявки на печать", exact: true }),
  ).toBeVisible();
  expect(model.getDraft().items[0].fullNameRu).toBe(
    "Сохранение в прежнем браузере",
  );
});

test("dirty hash traversal keeps input and permits the following guarded Back", async ({
  page,
}) => {
  const model = await workspace(page);
  await page.evaluate(() => {
    location.hash = "recipient-workspace";
  });
  await page.getByLabel("ФИО", { exact: true }).fill("Возврат после якоря");
  await page.evaluate(() => history.back());
  await expect(page).toHaveURL(/\/requests\/save-reliability$/);
  await expect(page.getByLabel("ФИО", { exact: true })).toHaveValue(
    "Возврат после якоря",
  );
  await page.evaluate(() => history.back());
  await expect(
    page.getByRole("heading", { name: "Заявки на печать", exact: true }),
  ).toBeVisible();
  expect(model.getDraft().items[0].fullNameRu).toBe("Возврат после якоря");
});

test("browser Forward also waits for a pending save and preserves history order", async ({
  page,
}) => {
  const model = await workspace(page);
  await page.getByRole("link", { name: "Работа центра", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Работа центра", exact: true }),
  ).toBeVisible();
  await page.goBack();
  const name = page.getByLabel("ФИО", { exact: true });
  await expect(name).toBeVisible();
  const saved = deferred();
  model.setPatch(async () => {
    await saved.promise;
    return false;
  });
  await name.fill("Сохранить перед переходом вперёд");
  await page.evaluate(() => history.forward());
  await expect.poll(() => model.saves.length).toBe(1);
  await expect(name).toHaveValue("Сохранить перед переходом вперёд");
  saved.resolve();
  await expect(
    page.getByRole("heading", { name: "Работа центра", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(name).toHaveValue("Сохранить перед переходом вперёд");
  expect(model.getDraft().items[0].fullNameRu).toBe(
    "Сохранить перед переходом вперёд",
  );
});

test("a final keystroke between successful flush and queued Back is saved too", async ({
  page,
}) => {
  const model = await workspace(page);
  await page.evaluate(() => {
    const original = history.go.bind(history);
    let deferredOnce = false;
    history.go = (delta?: number) => {
      if (delta === -1 && !deferredOnce) {
        deferredOnce = true;
        // Hold only the guard's replay, after the first save has completed.
        Object.assign(window, { resumeSaveNavigation: () => original(delta) });
      } else original(delta);
    };
  });
  const name = page.getByLabel("ФИО", { exact: true });
  await name.fill("Сначала сохранённое значение");
  await page.evaluate(() => history.back());
  await expect.poll(() => model.saves.length).toBe(1);
  await expect(page.locator(".save-indicator")).toContainText(
    "Рабочая версия сохранена",
  );
  await name.fill("Последние символы перед уходом");
  await page.evaluate(() =>
    (
      window as Window & { resumeSaveNavigation?: () => void }
    ).resumeSaveNavigation?.(),
  );
  await expect(
    page.getByRole("heading", { name: "Заявки на печать", exact: true }),
  ).toBeVisible();
  expect(model.saves).toHaveLength(2);
  expect(model.getDraft().items[0].fullNameRu).toBe(
    "Последние символы перед уходом",
  );
});

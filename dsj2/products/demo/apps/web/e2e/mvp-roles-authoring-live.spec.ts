import {
  test,
  expect,
  type Page,
  type Locator,
  type APIResponse,
} from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import type {
  CourseContent,
  RegulatoryProfile,
} from "../../../packages/contracts/src/lms";
import { pdfObjects, pdfStream } from "../../../tests/fixtures/pdf";
import { measureLmsActions } from "./lms-action-measurement";

type User = { email: string; password: string };
type Version = {
  id: string;
  revision: number;
  status: string;
  content: CourseContent;
  profile: RegulatoryProfile;
  review?: { state: string } | null;
  snapshotHash?: string;
};
type Readback = { course: { id: string }; versions: Version[] };
type Measure = ReturnType<typeof measureLmsActions>;
async function body<T>(
  response: Pick<APIResponse, "ok" | "status" | "text" | "json">,
): Promise<T> {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(
    true,
  );
  return response.json() as Promise<T>;
}
async function login(page: Page, user: User) {
  await page.goto("/login");
  await page.getByLabel("Электронная почта").fill(user.email);
  await page.getByLabel("Пароль", { exact: true }).fill(user.password);
  let response = page.waitForResponse(
    (r) => r.url().endsWith("/auth/login") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  let loginResult = await response;
  if (loginResult.status() === 429) {
    await page.waitForTimeout(30_000);
    await page.waitForTimeout(31_000);
    response = page.waitForResponse(
      (r) => r.url().endsWith("/auth/login") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    loginResult = await response;
  }
  expect(loginResult.ok(), `Login HTTP ${loginResult.status()}`).toBe(true);
  await expect(page).not.toHaveURL(/\/login/);
}
async function click(m: Measure, locator: Locator, label: string) {
  await m.action("click", label, () => locator.click());
}
async function fill(
  m: Measure,
  scope: Page | Locator,
  label: string,
  value: string,
) {
  await m.action("field", label, () =>
    scope
      .getByLabel(label, { exact: !label.startsWith("Описание ") })
      .fill(value),
  );
}
async function select(
  m: Measure,
  scope: Page | Locator,
  label: string,
  value: string,
) {
  await m.action(
    "select",
    label,
    () => scope.getByLabel(label).selectOption(value),
    { decision: true },
  );
}
async function details(m: Measure, scope: Locator) {
  if (!(await scope.evaluate((node) => (node as HTMLDetailsElement).open)))
    await click(m, scope.locator(":scope > summary"), "Раскрыть раздел");
}
async function tab(m: Measure, page: Page, label: string) {
  const retry = page.getByRole("button", {
    name: "Повторить соединение",
    exact: true,
  });
  if (await retry.isVisible())
    await click(m, retry, "Восстановить соединение после перезапуска API");
  await click(
    m,
    page
      .getByRole("navigation", { name: "Разделы программы" })
      .getByRole("button", { name: label, exact: true }),
    `Раздел: ${label}`,
  );
}
async function saved(page: Page) {
  await expect(page.locator(".lms-save-state")).toHaveText("Сохранено", {
    timeout: 30_000,
  });
}
async function question(
  m: Measure,
  scope: Locator,
  kind: string,
  label: string,
) {
  await click(
    m,
    scope.getByRole("button", { name: "Добавить вопрос", exact: true }),
    `Вопрос ${kind}`,
  );
  const item = scope
    .locator(":scope > .lms-assessment-author > details")
    .last();
  await details(m, item);
  await select(m, item, "Тип вопроса", kind);
  await fill(m, item, "Категория", "Синтетический MVP");
  await fill(m, item, "Вопрос RU", label);
  await fill(m, item, "Вопрос KZ", `Синтетикалық ${kind}`);
  if (kind === "TEXT") {
    await select(m, item, "Способ проверки", "EXACT");
    await fill(m, item, "Допустимые ответы — по одному на строку", "ключ");
    return item;
  }
  if (kind === "CASE") {
    await fill(
      m,
      item,
      "Ситуация RU",
      "Выберите безопасное действие из синтетического примера.",
    );
    await fill(
      m,
      item,
      "Ситуация KZ",
      "Синтетикалық мысалдан қауіпсіз әрекетті таңдаңыз.",
    );
  }
  for (let n = 1; n <= 2; n++) {
    const option = item.getByRole("group", {
      name: `${kind === "MATCHING" ? "Левая часть" : "Вариант"} ${n}`,
      exact: true,
    });
    await fill(m, option, "RU", `Вариант ${n}`);
    await fill(m, option, "KZ", `Нұсқа ${n}`);
  }
  if (["SINGLE", "MULTIPLE", "CASE"].includes(kind))
    await m.action("click", "Первый правильный ответ", () =>
      item
        .getByRole("group", { name: "Вариант 1", exact: true })
        .getByLabel("Правильный ответ")
        .check(),
    );
  if (kind === "MULTIPLE")
    await m.action("click", "Второй правильный ответ", () =>
      item
        .getByRole("group", { name: "Вариант 2", exact: true })
        .getByLabel("Правильный ответ")
        .check(),
    );
  if (kind === "MATCHING")
    for (let n = 1; n <= 2; n++) {
      await fill(m, item, `Правая часть ${n} RU`, `Соответствие ${n}`);
      await fill(m, item, `Правая часть ${n} KZ`, `Сәйкестік ${n}`);
      await m.action("select", `Пара ${n}`, () =>
        item
          .getByRole("group", { name: `Левая часть ${n}`, exact: true })
          .getByLabel("Соответствует")
          .selectOption({ label: `Соответствие ${n}` }),
      );
    }
  return item;
}

test("J02 METHODIST from an empty cabinet authors files/questions and ADMIN returns, approves and publishes through UI", async ({
  browser,
}) => {
  test.setTimeout(480_000);
  const fixturePath = process.env.DEMO_MVP_FIXTURE!;
  expect(fixturePath).toBeTruthy();
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
    baseUrl: string;
    tenantId: string;
    users: { authorMethodist: User; authorAdmin: User };
  };
  fixture.baseUrl = process.env.DEMO_ORIGIN!;
  expect(["localhost", "127.0.0.1"]).toContain(
    new URL(fixture.baseUrl).hostname,
  );
  expect(fixture.baseUrl).toBe(process.env.DEMO_ORIGIN);
  const output = path.resolve(process.env.DEMO_E2E_EVIDENCE!);
  const runtime = path.dirname(fixturePath),
    token = randomUUID().slice(0, 8);
  await mkdir(output, { recursive: true });
  const video = path.join(runtime, `author-${token}.mp4`),
    pdf = path.join(runtime, `author-${token}.pdf`);
  const generated = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=navy:s=640x360:r=20",
      "-t",
      "8",
      "-pix_fmt",
      "yuv420p",
      "-c:v",
      "libx264",
      "-movflags",
      "+faststart",
      "-y",
      video,
    ],
    { windowsHide: true },
  );
  expect(generated.status, generated.stderr?.toString()).toBe(0);
  await writeFile(
    pdf,
    pdfObjects([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
      pdfStream(
        Buffer.from(
          "BT /F1 18 Tf 40 780 Td (Synthetic local MVP training material) Tj ET",
        ),
      ),
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]),
  );
  const authorContext = await browser.newContext({ baseURL: fixture.baseUrl });
  const adminContext = await browser.newContext({ baseURL: fixture.baseUrl });
  const page = await authorContext.newPage(),
    admin = await adminContext.newPage();
  const report: Record<string, unknown> = {
    synthetic: true,
    role: "METHODIST -> ADMIN",
    setup:
      "Only accounts are seeded. Every programme, question, file, approval and publication mutation uses the UI.",
    startedAt: new Date().toISOString(),
  };
  try {
    await login(page, fixture.users.authorMethodist);
    await page.goto("/lms");
    let initialReads = 0;
    await page.route(/\/api\/lms\/courses\/[^/?]+$/, async (route) => {
      const read = ++initialReads;
      const response = await route.fetch();
      // Keep the real response and all writes unchanged; exercise a slow initial read.
      if (read === 1) await new Promise((resolve) => setTimeout(resolve, 800));
      await route.fulfill({ response });
    });
    const before = await body<{ total: number }>(
      await page.request.get("/api/lms/courses"),
    );
    report.initialCourseCount = before.total;
    const author = measureLmsActions(
      page,
      "J02-first-programme",
      "METHODIST",
      "First programme catalogue, no grant for this programme",
      [
        "Synthetic methodist account",
        "Local synthetic PDF and MP4 source files",
      ],
    );
    await click(
      author,
      page.getByRole("button", { name: "Создать программу", exact: true }),
      "Создать программу",
    );
    await expect(page).toHaveURL(/\/lms\/courses\//);
    const courseId = new URL(page.url()).pathname.split("/").at(-1)!;
    const title = `MVP с нуля ${token}`;
    await fill(author, page, "Название RU", title);
    await fill(author, page, "Название KZ", `MVP алғашқы ${token}`);
    await fill(
      author,
      page,
      "Описание RU",
      "Синтетическая программа приёмки всех авторских действий.",
    );
    await fill(
      author,
      page,
      "Описание KZ",
      "Барлық авторлық әрекеттерді тексеруге арналған синтетикалық бағдарлама.",
    );
    await fill(author, page, "Категория слушателей", "Синтетическая приёмка");
    await fill(author, page, "Часы", "8");
    await details(
      author,
      page
        .locator("details")
        .filter({
          has: page.locator(":scope > summary", {
            hasText: "Основание и оформление",
          }),
        })
        .first(),
    );
    await fill(
      author,
      page,
      "Название основания",
      "Синтетическое инженерное основание",
    );
    await select(author, page, "Проверка основания", "CONFIRMED");
    await select(author, page, "Оценка", "CENTER_EXAM");
    await select(author, page, "Вид документа", "PAPER_ORIGINAL");
    for (const document of ["Протокол", "Сертификат", "Удостоверение"])
      await mCheck(author, page, document, true);
    await fill(
      author,
      page,
      "Основание проверки",
      "Локальная инженерная приёмка; не правовая квалификация",
    );
    await fill(
      author,
      page,
      "Уполномоченный экзаменатор",
      "Синтетический учебный центр",
    );
    await fill(author, page, "Эмитент документа", "Синтетический центр А");
    await fill(author, page, "Действует с", "2026-10-01");
    await mCheck(author, page, "Синтетическая учебная программа", true);
    await mCheck(author, page, "Требуется согласование", false);
    await mCheck(author, page, "Требуется подпись слушателя", false);
    await mCheck(author, page, "Требуется прокторинг", true);
    await expect(page.locator("#local-proctoring-limit")).toContainText(
      "Прокторинг не подключён",
    );
    await mCheck(author, page, "Требуется прокторинг", false);
    await mCheck(author, page, "Требуется практика", true);
    await select(author, page, "Основание подтверждения практики", "IN_PERSON");
    await expect(
      page.getByText("Подтверждение очной практики пока не реализовано:", {
        exact: false,
      }),
    ).toBeVisible();
    await select(
      author,
      page,
      "Основание подтверждения практики",
      "REVIEWED_ASSIGNMENTS",
    );
    await click(
      author,
      page.getByRole("button", { name: "Добавить источник", exact: true }),
      "Редактируемое нормативное основание",
    );
    const source = page.getByRole("group", { name: "Источник 1", exact: true });
    await fill(
      author,
      source,
      "Название",
      "Синтетический приёмочный источник — не нормативный акт",
    );
    await fill(author, source, "Редакция", "1");
    await fill(author, source, "Номер НПА", "SYNTHETIC-MVP");
    await fill(author, source, "Орган", "Инженерная приёмка");
    await select(author, source, "Состояние источника", "CURRENT");
    await tab(author, page, "Содержание");
    const modules = page.getByRole("group", {
      name: "Модули и уроки",
      exact: true,
    });
    await click(
      author,
      modules.getByRole("button", { name: "Добавить модуль", exact: true }),
      "Первый модуль",
    );
    await fill(author, modules, "Модуль RU", "Безопасная работа");
    await fill(author, modules, "Модуль KZ", "Қауіпсіз жұмыс");
    for (const [index, kind] of [
      "TEXT",
      "PDF",
      "VIDEO",
      "ASSESSMENT",
      "ASSIGNMENT",
    ].entries()) {
      await click(
        author,
        modules.getByRole("button", { name: "Добавить урок", exact: true }),
        `Элемент ${kind}`,
      );
      const lesson = modules.getByRole("group", {
        name: `Урок ${index + 1}`,
        exact: true,
      });
      await fill(author, lesson, "Урок RU", `Учебный элемент ${kind}`);
      await fill(author, lesson, "Урок KZ", `Оқу элементі ${kind}`);
      await select(author, lesson, "Тип элемента", kind);
      await fill(
        author,
        lesson,
        "Текст RU",
        "Перед действием оцените условия и выполните безопасный порядок работы.",
      );
      await fill(
        author,
        lesson,
        "Текст KZ",
        "Әрекет алдында жағдайды бағалап, қауіпсіз жұмыс тәртібін орындаңыз.",
      );
      if (kind === "PDF" || kind === "VIDEO") {
        const library = lesson.locator(".lms-material-library").first();
        await details(author, library);
        await author.action("file", `Материал ${kind}`, () =>
          library
            .getByLabel("Загрузить файл", { exact: true })
            .setInputFiles(kind === "PDF" ? pdf : video),
        );
        await expect(
          library.getByLabel("Загрузить новую редакцию файла", { exact: true }),
        ).toBeEnabled();
      }
      if (kind === "VIDEO")
        await fill(author, lesson, "Длительность, секунд", "8");
      if (kind === "ASSESSMENT")
        await question(
          author,
          lesson,
          "SINGLE",
          `Промежуточный вопрос ${token}`,
        );
      if (kind === "ASSIGNMENT")
        for (const label of [
          "Инструкция RU",
          "Инструкция KZ",
          "Критерии приёмки RU",
          "Критерии приёмки KZ",
        ])
          await fill(
            author,
            lesson,
            label,
            label.endsWith("KZ")
              ? "Қауіпсіз әрекетті түсіндіріңіз."
              : "Объясните безопасное действие.",
          );
    }
    await tab(author, page, "Итоговая проверка");
    const exam = page.getByRole("group", {
      name: "Вопросы и оценка",
      exact: true,
    });
    for (const kind of [
      "SINGLE",
      "MULTIPLE",
      "MATCHING",
      "ORDERING",
      "TEXT",
      "CASE",
    ]) {
      const item = await question(
        author,
        exam,
        kind,
        `Итоговый ${kind} ${token}`,
      );
      if (kind === "SINGLE") {
        const bankSaved = page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            response.url().endsWith("/lms/questions"),
        );
        await click(
          author,
          item.getByRole("button", {
            name: "Добавить в банк вопросов",
            exact: true,
          }),
          "Сохранить собственный вопрос в банк",
        );
        await body(await bankSaved);
        await saved(page);
        await details(author, item);
        await expect(
          item.getByRole("button", {
            name: "Сохранить редакцию в банке",
            exact: true,
          }),
        ).toBeEnabled();
      }
    }
    await details(
      author,
      exam
        .locator("details")
        .filter({
          has: page.locator(":scope > summary", { hasText: "Параметры теста" }),
        })
        .first(),
    );
    await fill(author, exam, "Вопросов в попытке", "6");
    await tab(author, page, "Условия");
    const settings = page.getByRole("group", {
      name: "Учебные настройки",
      exact: true,
    });
    await details(
      author,
      settings
        .locator("details")
        .filter({
          has: page.locator(":scope > summary", {
            hasText: "Цели, аудитория и параметры программы",
          }),
        })
        .first(),
    );
    for (const [label, value] of [
      ["Цель RU", "Изучить безопасный порядок работы"],
      ["Цель KZ", "Қауіпсіз жұмыс тәртібін үйрену"],
      ["Аудитория RU", "Синтетические сотрудники"],
      ["Аудитория KZ", "Синтетикалық қызметкерлер"],
      ["Срок действия документа", "Один год в синтетическом сценарии"],
      ["Периодичность обучения", "По синтетической программе"],
      [
        "Источник параметров программы",
        "Инженерная приёмка; не нормативный источник",
      ],
    ])
      await fill(author, settings, label!, value!);
    await select(author, settings, "Итог программы", "REGULATED");
    await saved(page);
    const readback = () =>
      page.request.get(`/api/lms/courses/${courseId}`).then(body<Readback>);
    const draft = (await readback()).versions[0];
    expect(draft.content.titleRu).toBe(title);
    expect(draft.content.titleKz).toBe(`MVP алғашқы ${token}`);
    expect(draft.profile.requiresPractice).toBe(true);
    expect(draft.profile.practiceEvidenceMode).toBe("REVIEWED_ASSIGNMENTS");
    report.initialReadRace = {
      realResponses: true,
      delayedFirstReadMs: 800,
      reads: initialReads,
      metadataPreserved: true,
    };
    expect(draft.content.modules[0].lessons.map((row) => row.kind)).toEqual([
      "TEXT",
      "PDF",
      "VIDEO",
      "ASSESSMENT",
      "ASSIGNMENT",
    ]);
    expect(
      draft.content.exam.questions.map((row) => row.answerSpec?.kind),
    ).toEqual(["SINGLE", "MULTIPLE", "MATCHING", "ORDERING", "TEXT", "CASE"]);
    expect(draft.content.exam.questions[0].libraryRevisionId).toBeTruthy();
    await author.action("refresh", "Перезагрузка сохранённого курса", () =>
      page.reload(),
    );
    await expect(page.getByLabel("Название RU", { exact: true })).toHaveValue(
      title,
    );
    await tab(author, page, "Публикация");
    await expect(
      page.getByRole("button", { name: "Опубликовать", exact: true }),
    ).toHaveCount(0);
    await review(author, page, "Отправить на проверку", "SUBMIT");
    await expect(
      page.getByText("Согласование: На проверке", { exact: true }),
    ).toBeVisible();
    report.authorFirst = author.finish({
      courseId,
      versionId: draft.id,
      state: "PENDING",
    });
    await login(admin, fixture.users.authorAdmin);
    await admin.goto(`/lms/courses/${courseId}`);
    const approver = measureLmsActions(
      admin,
      "J02-review-publication",
      "ADMIN",
      "Submitted version",
      ["Programme authored through UI by METHODIST"],
    );
    await tab(approver, admin, "Публикация");
    await fill(
      approver,
      admin,
      "Комментарий к решению",
      "Уточните описание / Сипаттаманы нақтылаңыз",
    );
    await review(approver, admin, "Вернуть на доработку", "RETURN");
    await page.reload();
    const correction = measureLmsActions(
      page,
      "J02-correction",
      "METHODIST",
      "Returned programme",
      ["ADMIN feedback"],
    );
    await tab(correction, page, "Публикация");
    await expect(
      page.getByText("Уточните описание / Сипаттаманы нақтылаңыз", {
        exact: true,
      }),
    ).toBeVisible();
    await tab(correction, page, "Сведения");
    await fill(
      correction,
      page,
      "Описание RU",
      "Уточнено по замечанию администратора: безопасный порядок действий.",
    );
    await tab(correction, page, "Публикация");
    await review(correction, page, "Отправить на проверку", "SUBMIT");
    report.correction = correction.finish({
      state: "PENDING",
      repeatedFields: 0,
      note: "A changed description implements feedback; this is not re-entry of a known unchanged value.",
    });
    await approver.action("refresh", "Новая редакция после замечания", () =>
      admin.reload(),
    );
    await tab(approver, admin, "Публикация");
    await review(approver, admin, "Одобрить редакцию", "APPROVE");
    const publishing = admin.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().endsWith("/publish"),
    );
    await click(
      approver,
      admin.getByRole("button", { name: "Опубликовать", exact: true }),
      "Публикация администратором",
    );
    await body(await publishing);
    report.approval = approver.finish({ state: "PUBLISHED" });
    const published = (await readback()).versions.find(
      (row) => row.id === draft.id,
    )!;
    expect(published.status).toBe("PUBLISHED");
    const snapshot = createHash("sha256")
      .update(JSON.stringify(published))
      .digest("hex");
    await page.reload();
    const next = measureLmsActions(
      page,
      "J02-version",
      "METHODIST",
      "Published immutable version",
      ["ADMIN published through UI"],
    );
    await tab(next, page, "Публикация");
    await click(
      next,
      page.getByRole("button", { name: "Создать новую версию", exact: true }),
      "Новая редакция",
    );
    await tab(next, page, "Сведения");
    await fill(next, page, "Описание KZ", "Келесі нұсқаның бөлек сипаттамасы.");
    await saved(page);
    const versions = (await readback()).versions;
    expect(versions).toHaveLength(2);
    expect(versions[0].profile.status).toBe("NEEDS_LEGAL_REVIEW");
    expect(
      createHash("sha256")
        .update(JSON.stringify(versions.find((row) => row.id === draft.id)!))
        .digest("hex"),
    ).toBe(snapshot);
    report.newVersion = next.finish({
      state: "DRAFT",
      version: 2,
      oldSnapshotUnchanged: true,
    });
    const geometry = [];
    for (const language of ["RU", "KZ"]) {
      await page.getByRole("button", { name: language, exact: true }).click();
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
        const screenshot = `author-${language}-${width}.png`;
        await page.screenshot({
          path: path.join(output, screenshot),
          fullPage: true,
          animations: "disabled",
        });
        geometry.push({ language, width, overflow: false, screenshot });
      }
    }
    report.geometry = geometry;
    report.status = "PASS";
    report.courseId = courseId;
    report.versionId = published.id;
    report.boundary =
      "UI authoring/review/publication/versioning only. This does not assert that the learner completed this course or that its documents were issued.";
    await writeFile(
      path.join(runtime, "authoring-result.json"),
      JSON.stringify(
        {
          courseId,
          courseVersionId: published.id,
          content: published.content,
          profile: published.profile,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    report.status = "FAIL";
    report.failure = error instanceof Error ? error.message : String(error);
    await page
      .screenshot({
        path: path.join(output, "author-failure.png"),
        fullPage: true,
      })
      .catch(() => {});
    throw error;
  } finally {
    report.completedAt = new Date().toISOString();
    await writeFile(
      path.join(output, "UI_AUTHORING.json"),
      JSON.stringify(report, null, 2),
    );
    await Promise.race([
      Promise.all([authorContext.close(), adminContext.close()]),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  }
});

async function mCheck(m: Measure, page: Page, name: string, checked: boolean) {
  await m.action(
    "click",
    name,
    () => page.getByLabel(name, { exact: true }).setChecked(checked),
    { decision: true },
  );
}
async function review(m: Measure, page: Page, label: string, action: string) {
  const response = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      r.url().endsWith("/review") &&
      r.request().postDataJSON()?.action === action,
  );
  await click(m, page.getByRole("button", { name: label, exact: true }), label);
  await body(await response);
}

import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { provision } from "../../../scripts/setup";
import { db, type Context } from "../../../apps/api/src/core";
import { bootstrapSuperAdmin, saveUser } from "../../../apps/api/src/settings";
import {
  createCourse,
  publishVersion,
} from "../../../apps/api/src/lms/courses";
import { createTeachingEvent } from "../../../apps/api/src/lms/teaching-events";
import {
  createTeachingBinding,
  revokeTeachingBinding,
} from "../../../apps/api/src/lms/teaching-bindings";
import {
  lmsCourse,
  lmsLearner,
  LMS_PASSWORD,
} from "../../../tests/integration/lms-fixture";
import {
  saveSubmission,
  submitSubmission,
} from "../../../apps/api/src/lms/submissions";
import { assertTestDatabase } from "../../../tests/integration/test-database";

test.use({ trace: "off" });
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    "../../../.runtime/commission-flow/evidence/teacher-calendar",
);
const day = (offset: number) =>
  new Date(
    Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate() + offset,
    ),
  );
const dateValue = (offset: number) => day(offset).toISOString().slice(0, 10);

async function fixture(withEvents = true, withReview = false) {
  assertTestDatabase();
  expect(["127.0.0.1", "localhost"]).toContain(
    new URL(process.env.DATABASE_URL!).hostname,
  );
  const suffix = randomUUID();
  const password = `Synthetic-calendar-${suffix}!`;
  const owner = await provision({
    email: `calendar-owner-${suffix}@example.test`,
    password,
    name: "Синтетический календарь преподавателя",
    sample: true,
  });
  await db.tenant.update({
    where: { id: owner.tenantId },
    data: { timezone: "Asia/Qyzylorda" },
  });
  const context: Context = {
    ...owner,
    role: "DIRECTOR",
    sessionId: "synthetic",
    csrfHash: "synthetic",
    correlationId: suffix,
  };
  await bootstrapSuperAdmin(context, {
    currentPassword: password,
    confirm: true,
  });
  context.role = "SUPER_ADMIN";
  const teacher = await saveUser(context, {
    email: `calendar-teacher-${suffix}@example.test`,
    password,
    displayName: "Синтетический преподаватель",
    role: "TEACHER",
  });
  const base = {
    context,
    teacher,
    account: { email: teacher.email, password },
  };
  if (!withEvents)
    return {
      ...base,
      events: [] as Awaited<ReturnType<typeof createTeachingEvent>>[],
      hiddenEventId: "",
      foreignEventId: "",
      groupId: "",
      review: null as {
        id: string;
        notificationId: string;
        titleRu: string;
        href: string;
        learner: { email: string; password: string; enrollmentId: string };
      } | null,
    };
  const otherTeacher = await saveUser(context, {
    email: `calendar-other-${suffix}@example.test`,
    password,
    displayName: "Синтетический другой преподаватель",
    role: "TEACHER",
  });
  const definition = lmsCourse();
  if (withReview)
    definition.content.modules[0].lessons.push({
      ...definition.content.modules[0].lessons[0],
      id: "calendar-review-work",
      kind: "ASSIGNMENT",
      titleRu: "Синтетическая работа из уведомления",
      titleKz: "Хабарламадан синтетикалық жұмыс",
      required: false,
      assignment: {
        instructionsRu: "Опишите решение",
        instructionsKz: "Шешімді сипаттаңыз",
        criteriaRu: "Обоснование",
        criteriaKz: "Негіздеме",
        allowText: true,
        allowFiles: false,
        maxSubmissions: 3,
      },
    });
  const course = await createCourse(context, definition);
  await publishVersion(context, course.version.id, { revision: 0 });
  const group = await db.lmsGroup.create({
    data: {
      tenantId: context.tenantId,
      name: "Синтетическая назначенная группа",
      courseVersionId: course.version.id,
      createdBy: context.userId,
    },
  });
  const hiddenGroup = await db.lmsGroup.create({
    data: {
      tenantId: context.tenantId,
      name: "Синтетическая неназначенная группа",
      courseVersionId: course.version.id,
      createdBy: context.userId,
    },
  });
  for (const [userId, groupId] of [
    [teacher.id, group.id],
    [otherTeacher.id, hiddenGroup.id],
  ]) {
    await db.lmsTeachingBinding.create({
      data: {
        tenantId: context.tenantId,
        userId,
        courseId: course.course.id,
        groupId,
        role: "TEACHER",
        permissions: ["READ", "REVIEW", "SCHEDULE", "ATTENDANCE"],
        createdBy: context.userId,
      },
    });
  }
  const eventInput = (
    groupId: string,
    teacherUserId: string,
    offset: number,
    titleRu: string,
    titleKz: string,
  ) => ({
    groupId,
    teacherUserId,
    titleRu,
    titleKz,
    operationId: randomUUID(),
    timezone: "Asia/Qyzylorda",
    startsAt: new Date(day(offset).getTime() + 9 * 3600000).toISOString(),
    endsAt: new Date(day(offset).getTime() + 10 * 3600000).toISOString(),
    joinUrl: "https://example.invalid/synthetic-calendar-session",
    location: "Синтетическая аудитория",
  });
  const events = [
    await createTeachingEvent(
      context,
      eventInput(
        group.id,
        teacher.id,
        1,
        "Синтетическое занятие первого периода",
        "Бірінші кезеңдегі синтетикалық сабақ",
      ),
    ),
    await createTeachingEvent(
      context,
      eventInput(
        group.id,
        teacher.id,
        40,
        "Синтетическое занятие второго периода",
        "Екінші кезеңдегі синтетикалық сабақ",
      ),
    ),
  ];
  const hidden = await createTeachingEvent(
    context,
    eventInput(
      hiddenGroup.id,
      otherTeacher.id,
      1,
      "Скрытое занятие другой группы",
      "Басқа топтың жасырын сабағы",
    ),
  );
  const foreignOwner = await provision({
    email: `calendar-foreign-${suffix}@example.test`,
    password,
    name: "Синтетический чужой центр",
    sample: true,
  });
  const foreignContext: Context = {
    ...foreignOwner,
    role: "DIRECTOR",
    sessionId: "synthetic",
    csrfHash: "synthetic",
    correlationId: randomUUID(),
  };
  const foreignCourse = await createCourse(foreignContext, lmsCourse());
  const foreignGroup = await db.lmsGroup.create({
    data: {
      tenantId: foreignContext.tenantId,
      name: "Синтетическая чужая группа",
      courseVersionId: foreignCourse.version.id,
      createdBy: foreignContext.userId,
    },
  });
  const foreign = await createTeachingEvent(
    foreignContext,
    eventInput(
      foreignGroup.id,
      foreignContext.userId,
      1,
      "Скрытое занятие чужого центра",
      "Бөтен орталықтың жасырын сабағы",
    ),
  );
  let review: {
    id: string;
    notificationId: string;
    titleRu: string;
    href: string;
    learner: { email: string; password: string; enrollmentId: string };
  } | null = null;
  if (withReview) {
    const learner = await lmsLearner(context.tenantId, "calendar-notification");
    const enrollment = await db.enrollment.create({
      data: {
        tenantId: context.tenantId,
        courseVersionId: course.version.id,
        recipientId: learner.recipient.id,
        learnerUserId: learner.user.id,
        groupId: group.id,
        assignedBy: context.userId,
      },
    });
    await db.lmsGroupMember.create({
      data: {
        tenantId: context.tenantId,
        groupId: group.id,
        enrollmentId: enrollment.id,
      },
    });
    await saveSubmission(
      learner.context,
      enrollment.id,
      "calendar-review-work",
      {
        sequence: 1,
        text: "Синтетический ответ для проверки перехода из календаря",
        attachmentIds: [],
      },
    );
    const submitted = await submitSubmission(
      learner.context,
      enrollment.id,
      "calendar-review-work",
      { sequence: 1 },
    );
    if (!submitted.id) throw new Error("Submission ID missing");
    const outbox = await db.lmsNotificationEvent.findFirstOrThrow({
      where: {
        tenantId: context.tenantId,
        userId: teacher.id,
        sourceType: "REVIEW_SUBMISSION",
        sourceId: submitted.id,
      },
    });
    if (!outbox.href) throw new Error("Review notification href missing");
    // Inbox transport fixture for this exact real immutable submission only.
    // Do not drain the globally claimed outbox worker or touch other tenants.
    const inbox = await db.lmsLearningNotification.create({
      data: {
        tenantId: outbox.tenantId,
        userId: outbox.userId,
        sourceType: outbox.sourceType,
        sourceId: outbox.sourceId,
        enrollmentId: outbox.enrollmentId,
        kind: outbox.kind,
        deliveryKey: outbox.deliveryKey,
        titleRu: outbox.titleRu,
        titleKz: outbox.titleKz,
        href: outbox.href,
      },
    });
    review = {
      id: submitted.id,
      notificationId: inbox.id,
      titleRu: inbox.titleRu,
      href: outbox.href,
      learner: {
        email: learner.user.email,
        password: LMS_PASSWORD,
        enrollmentId: enrollment.id,
      },
    };
  }
  return {
    ...base,
    events,
    hiddenEventId: hidden.id,
    foreignEventId: foreign.id,
    groupId: group.id,
    review,
  };
}

async function login(
  page: Page,
  account: { email: string; password: string },
  expectedPath = /\/lms\/teaching$/,
) {
  await page.goto("/login");
  await page
    .getByLabel("Электронная почта", { exact: true })
    .fill(account.email);
  await page.getByLabel("Пароль", { exact: true }).fill(account.password);
  for (let attempt = 0; attempt < 3; attempt++) {
    const pending = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/auth/login") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    const response = await pending;
    if (response.status() === 429) {
      await page.waitForTimeout(31_000);
      continue;
    }
    expect(response.status()).toBe(201);
    await expect(page).toHaveURL(expectedPath);
    return;
  }
  throw new Error("Synthetic teacher login remained rate-limited");
}

test.beforeEach(async ({ page }) => {
  await fs.mkdir(evidence, { recursive: true });
  await page.routeWebSocket(/\/_next\/webpack-hmr/, (socket) => socket.close());
});
test.afterAll(async () => {
  await db.$disconnect();
});

async function openCalendar(
  page: Page,
  account: { email: string; password: string },
) {
  await login(page, account);
  const loaded = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/lms/calendar",
  );
  await page
    .getByRole("link", { name: "Вебинары и занятия", exact: true })
    .click();
  return loaded;
}

async function metrics(name: string, data: Record<string, unknown>) {
  await fs.writeFile(
    path.join(evidence, `${name}.json`),
    JSON.stringify(data, null, 2),
  );
}

async function overflow(page: Page) {
  const sizes = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    root: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(sizes.body).toBeLessThanOrEqual(sizes.viewport + 1);
  expect(sizes.root).toBeLessThanOrEqual(sizes.viewport + 1);
  return sizes;
}

test("TEACHER login opens its calendar and only bound own events and notifications are visible", async ({
  page,
}) => {
  const seeded = await fixture();
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, seeded.account);
  const loaded = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/lms/calendar",
  );
  const notified = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/lms/notifications",
  );
  await page
    .getByRole("link", { name: "Вебинары и занятия", exact: true })
    .click();
  await expect(page).toHaveURL(/\/lms\/calendar$/);
  const calendarResponse = await loaded;
  const calendar = await calendarResponse.json();
  const notificationResponse = await notified;
  const notifications = await notificationResponse.json();
  await fs.writeFile(
    path.join(evidence, "teacher-initial-responses.json"),
    JSON.stringify(
      {
        role: "TEACHER",
        calendarStatus: calendarResponse.status(),
        calendarCode: calendar.code || null,
        notificationStatus: notificationResponse.status(),
        notificationCode: notifications.code || null,
        visibleEventIds: calendar.items?.map((item: { id: string }) => item.id),
        notifications: notifications.total,
      },
      null,
      2,
    ),
  );
  expect(calendarResponse.status()).toBe(200);
  expect(notificationResponse.status()).toBe(200);
  expect(calendar.items.map((item: { id: string }) => item.id)).toEqual([
    `event:${seeded.events[0].id}`,
  ]);
  expect(notifications.total).toBe(2);
  expect(
    notifications.items.every((item: { eventId: string }) =>
      seeded.events.some((event) => event.id === item.eventId),
    ),
  ).toBe(true);
  const row = page
    .locator("article.lms-event-row")
    .filter({ hasText: seeded.events[0].titleRu });
  await expect(row).toBeVisible();
  await expect(
    page.getByText("Скрытое занятие другой группы", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Скрытое занятие чужого центра", { exact: true }),
  ).toHaveCount(0);
  await row.getByRole("button", { name: "Открыть", exact: true }).click();
  await expect(
    page
      .locator(".lms-event-detail")
      .getByRole("heading", { name: seeded.events[0].titleRu, exact: true }),
  ).toBeVisible();
  expect(
    (
      await page.request.get(`/api/lms/teaching-events/${seeded.hiddenEventId}`)
    ).status(),
  ).toBe(404);
  expect(
    (
      await page.request.get(
        `/api/lms/teaching-events/${seeded.foreignEventId}`,
      )
    ).status(),
  ).toBe(404);
  await page.screenshot({
    path: path.join(evidence, "teacher-bound-calendar-390-ru.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "KZ", exact: true }).first().click();
  await expect(
    page.getByRole("heading", { name: "Оқу күнтізбесі", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator("article.lms-event-row")
      .filter({ hasText: seeded.events[0].titleKz }),
  ).toBeVisible();
  const kazakhRow = page
    .locator("article.lms-event-row")
    .filter({ hasText: seeded.events[0].titleKz });
  await expect(kazakhRow).toContainText("14:00");
  await expect(kazakhRow).not.toContainText(
    /\b(?:AM|PM|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/,
  );
  await expect(page.locator(".lms-event-detail")).toContainText("14:00");
  await expect(page.locator(".lms-event-detail")).not.toContainText(
    /\b(?:AM|PM|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: path.join(evidence, "teacher-bound-calendar-390-kz.png"),
    fullPage: true,
  });
  expect(
    await db.lmsAttendance.count({
      where: { tenantId: seeded.context.tenantId },
    }),
  ).toBe(0);
  await metrics("teacher-routine-actions", {
    fixture: "synthetic separate setup",
    loginFields: 2,
    loginClicks: 1,
    calendarNavigationClicks: 1,
    preparedCalendarViewActions: 0,
    eventOpenClicks: 1,
    overflow: await overflow(page),
    browser: "Chromium; WebKit not installed; physical Safari unverified",
  });
});

test("closed real tenant gate explains both unavailable resources without a false empty calendar or zero notifications", async ({
  page,
}) => {
  const seeded = await fixture(false);
  await db.tenant.update({
    where: { id: seeded.context.tenantId },
    data: { demoOnly: false },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const requests: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/lms\/(calendar|notifications)/.test(request.url()))
      requests.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  const response = await openCalendar(page, seeded.account);
  expect(response.status()).toBe(503);
  expect((await response.json()).code).toBe("LMS_DEPLOYMENT_REVIEW_REQUIRED");
  const calendar = page.locator(".lms-calendar");
  const notices = page.locator(".lms-calendar-notifications");
  await expect(
    calendar.getByText("Не удалось загрузить календарь", { exact: true }),
  ).toBeVisible();
  await expect(calendar).toContainText(
    "Обучение пока недоступно. Обратитесь к администратору.",
  );
  await expect(
    page.getByText("В этом периоде событий нет", { exact: true }),
  ).toHaveCount(0);
  await expect(notices.locator(":scope > summary")).toHaveText(
    "Уведомления об обучении · Недоступны",
  );
  await notices.locator(":scope > summary").click();
  await expect(
    notices.getByText("Не удалось загрузить уведомления", { exact: true }),
  ).toBeVisible();
  await expect(
    notices.getByText("Уведомлений пока нет", { exact: true }),
  ).toHaveCount(0);
  const checked = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/lms/calendar",
  );
  await calendar
    .getByRole("button", { name: "Проверить доступ", exact: true })
    .click();
  expect((await checked).status()).toBe(503);
  await expect(
    calendar.getByRole("button", { name: "Проверить доступ", exact: true }),
  ).toBeEnabled();
  const ru = await overflow(page);
  await page.screenshot({
    path: path.join(evidence, "teacher-gate-390-ru.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "KZ", exact: true }).first().click();
  await expect(notices.locator(":scope > summary")).toHaveText(
    "Оқу туралы хабарламалар · Қолжетімсіз",
  );
  await expect(
    calendar.getByRole("button", {
      name: "Қолжетімділікті тексеру",
      exact: true,
    }),
  ).toBeVisible();
  const kz = await overflow(page);
  await page.screenshot({
    path: path.join(evidence, "teacher-gate-390-kz.png"),
    fullPage: true,
  });
  expect(requests.every((value) => value.startsWith("GET "))).toBe(true);
  await metrics("teacher-gate-checks", {
    status: 503,
    code: "LMS_DEPLOYMENT_REVIEW_REQUIRED",
    retryClicks: 1,
    requests,
    ru,
    kz,
  });
});

test("date clear, failed period retry and delayed older response retain the latest requested period", async ({
  page,
}) => {
  const seeded = await fixture();
  let releaseOld!: () => void;
  const held = new Promise<void>((resolve) => {
    releaseOld = resolve;
  });
  let heldRequests = 0;
  let shouldHold = false;
  let failNext = false;
  const calendarQueries: string[] = [];
  await page.route("**/api/lms/calendar?**", async (route) => {
    calendarQueries.push(route.request().url());
    if (failNext) {
      failNext = false;
      await route.fulfill({
        status: 500,
        json: {
          code: "SYNTHETIC_TRANSIENT",
          message: "Synthetic temporary error",
        },
      });
      return;
    }
    if (shouldHold) {
      shouldHold = false;
      heldRequests++;
      const result = await route.fetch();
      await held;
      await route.fulfill({ response: result });
      return;
    }
    await route.continue();
  });
  await openCalendar(page, seeded.account);
  const calendar = page.locator(".lms-calendar");
  const date = calendar.getByLabel(/^31 день начиная с/);
  await expect(
    calendar.getByText(seeded.events[0].titleRu, { exact: true }),
  ).toBeVisible();
  const beforeClear = calendarQueries.length;
  await date.fill("");
  await expect(date).toHaveValue("");
  await expect(date).toHaveAttribute("aria-invalid", "true");
  await expect(
    calendar.getByText("Выберите дату начала периода.", { exact: true }),
  ).toBeVisible();
  await expect(calendar.locator("article")).toHaveCount(0);
  await page.waitForTimeout(150);
  expect(calendarQueries.length).toBe(beforeClear);
  shouldHold = true;
  await date.fill(dateValue(1));
  await expect.poll(() => heldRequests).toBe(1);
  try {
    failNext = true;
    await date.fill(dateValue(35));
    await expect(
      calendar.getByText("Не удалось загрузить календарь", { exact: true }),
    ).toBeVisible();
    await expect(calendar.locator("article")).toHaveCount(0);
    await expect(date).toHaveValue(dateValue(35));
    const retry = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/lms/calendar" && r.status() === 200,
    );
    await calendar
      .getByRole("button", { name: "Повторить загрузку", exact: true })
      .click();
    await retry;
    await expect(
      calendar.getByText(seeded.events[1].titleRu, { exact: true }),
    ).toBeVisible();
    releaseOld();
    await page.waitForTimeout(200);
    await expect(
      calendar.getByText(seeded.events[1].titleRu, { exact: true }),
    ).toBeVisible();
    await expect(
      calendar.getByText(seeded.events[0].titleRu, { exact: true }),
    ).toHaveCount(0);
    const last = new URL(calendarQueries.at(-1)!);
    expect(last.searchParams.get("from")).toBe(
      new Date(day(35).getTime() - 5 * 3600000).toISOString(),
    );
    expect(last.searchParams.get("to")).toBe(
      new Date(day(66).getTime() - 5 * 3600000).toISOString(),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await overflow(page);
    await page.screenshot({
      path: path.join(evidence, "teacher-current-period-after-stale-390.png"),
      fullPage: true,
    });
    await metrics("teacher-date-recovery", {
      dateChangeFields: 1,
      retryClicks: 1,
      clearRequests: 0,
      olderResponseIgnored: true,
      latestFrom: last.searchParams.get("from"),
      latestTo: last.searchParams.get("to"),
    });
  } finally {
    releaseOld();
  }
});

test("calendar includes center-local 00:30 and excludes an event ending exactly at the first midnight", async ({
  page,
}) => {
  const seeded = await fixture();
  const boundary = day(4).getTime() - 5 * 3600000;
  const createBoundary = (titleRu: string, from: number, to: number) =>
    createTeachingEvent(seeded.context, {
      operationId: randomUUID(),
      groupId: seeded.groupId,
      teacherUserId: seeded.teacher.id,
      titleRu,
      titleKz: titleRu,
      timezone: "Asia/Qyzylorda",
      startsAt: new Date(from).toISOString(),
      endsAt: new Date(to).toISOString(),
    });
  const early = await createBoundary(
    "Синтетическое занятие 00:30",
    boundary + 30 * 60000,
    boundary + 90 * 60000,
  );
  const prior = await createBoundary(
    "Синтетическое занятие до полуночи",
    boundary - 60 * 60000,
    boundary,
  );
  const periodEnd = boundary + 31 * 24 * 3600000;
  const last = await createBoundary(
    "Синтетическое занятие последнего дня 23:30",
    periodEnd - 30 * 60000,
    periodEnd + 30 * 60000,
  );
  const next = await createBoundary(
    "Синтетическое занятие следующего периода",
    periodEnd,
    periodEnd + 60 * 60000,
  );
  await openCalendar(page, seeded.account);
  const loaded = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/lms/calendar" &&
      new URL(r.url()).searchParams.get("from") ===
        new Date(boundary).toISOString(),
  );
  await page.getByLabel(/^31 день начиная с/).fill(dateValue(4));
  const result = await (await loaded).json();
  expect(result.items.map((item: { id: string }) => item.id)).toContain(
    `event:${early.id}`,
  );
  expect(result.items.map((item: { id: string }) => item.id)).not.toContain(
    `event:${prior.id}`,
  );
  expect(result.items.map((item: { id: string }) => item.id)).toContain(
    `event:${last.id}`,
  );
  expect(result.items.map((item: { id: string }) => item.id)).not.toContain(
    `event:${next.id}`,
  );
  await expect(
    page.locator(".lms-calendar").getByText(early.titleRu, { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".lms-calendar").getByText(prior.titleRu, { exact: true }),
  ).toHaveCount(0);
  await metrics("teacher-timezone-boundary", {
    timezone: "Asia/Qyzylorda",
    input: dateValue(4),
    includedLocalTime: "00:30",
    boundary: new Date(boundary).toISOString(),
    excludesEndEqualFrom: true,
    includesLastDay2330: true,
    excludesStartEqualTo: true,
  });
});

test("revoked teacher binding denies a direct event link and restored binding recovers the same saved event", async ({
  page,
}) => {
  const seeded = await fixture();
  await openCalendar(page, seeded.account);
  await expect(
    page
      .locator(".lms-calendar")
      .getByText(seeded.events[0].titleRu, { exact: true }),
  ).toBeVisible();
  const binding = await db.lmsTeachingBinding.findFirstOrThrow({
    where: {
      tenantId: seeded.context.tenantId,
      userId: seeded.teacher.id,
      groupId: seeded.groupId,
      revokedAt: null,
    },
  });
  await revokeTeachingBinding(seeded.context, binding.id, {
    reason: "Синтетическая проверка отзыва полномочий",
  });
  await page.goto(`/lms/calendar?eventId=${seeded.events[0].id}`);
  await expect(page.locator(".lms-calendar article")).toHaveCount(0);
  const denied = await page.request.get(
    `/api/lms/teaching-events/${seeded.events[0].id}`,
  );
  expect(denied.status()).toBe(404);
  await expect(
    page
      .locator(".lms-event-detail")
      .getByRole("heading", { name: seeded.events[0].titleRu, exact: true }),
  ).toHaveCount(0);
  await createTeachingBinding(seeded.context, {
    userId: seeded.teacher.id,
    role: "TEACHER",
    courseId: binding.courseId,
    groupId: seeded.groupId,
  });
  await page.reload();
  await expect(
    page
      .locator(".lms-event-detail")
      .getByRole("heading", { name: seeded.events[0].titleRu, exact: true }),
  ).toBeVisible();
  expect(
    await db.lmsAttendance.count({
      where: { tenantId: seeded.context.tenantId },
    }),
  ).toBe(0);
  await metrics("teacher-revoked-binding-recovery", {
    directLinkDeniedStatus: 404,
    restoredSameEvent: true,
    attendanceWritten: 0,
  });
});

test("notification loading failure retries independently and a real review notification opens its immutable submission", async ({
  page,
}) => {
  const seeded = await fixture(true, true);
  if (!seeded.review) throw new Error("Review fixture missing");
  const review = seeded.review;
  let failList = true;
  let failMark = true;
  const invalidReads: string[] = [];
  page.on("request", (req) => {
    if (/\/teaching-events\/(null|undefined)/.test(req.url()))
      invalidReads.push(req.url());
  });
  await page.route("**/api/lms/notifications?**", async (route) => {
    if (failList) {
      await route.fulfill({
        status: 500,
        json: { code: "SYNTHETIC_TRANSIENT" },
      });
    } else await route.continue();
  });
  await page.route(
    `**/api/lms/notifications/${review.notificationId}/read`,
    async (route) => {
      if (failMark) {
        failMark = false;
        await route.fulfill({
          status: 500,
          json: { code: "SYNTHETIC_MARK_FAILURE" },
        });
      } else await route.continue();
    },
  );
  await openCalendar(page, seeded.account);
  const notifications = page.locator(".lms-calendar-notifications");
  await expect(notifications.locator(":scope > summary")).toHaveText(
    "Уведомления об обучении · Недоступны",
  );
  await notifications.locator(":scope > summary").click();
  failList = false;
  await notifications
    .getByRole("button", { name: "Повторить загрузку", exact: true })
    .click();
  const row = notifications
    .locator(".lms-event-row")
    .filter({ hasText: review.titleRu });
  await expect(row).toBeVisible();
  await expect(row).not.toContainText("Назначено занятие");
  await row
    .getByRole("button", { name: "Прочитать и открыть", exact: true })
    .click();
  await expect(
    row.getByText("Не удалось отметить уведомление прочитанным", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/lms\/calendar$/);
  expect(
    (
      await db.lmsLearningNotification.findUniqueOrThrow({
        where: { id: review.notificationId },
      })
    ).readAt,
  ).toBeNull();
  await row
    .getByRole("button", { name: "Прочитать и открыть", exact: true })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/lms/teaching\\?type=SUBMISSION&reviewId=${review.id}$`),
  );
  await expect(
    page.getByText("Синтетический ответ для проверки перехода из календаря", {
      exact: true,
    }),
  ).toBeVisible();
  expect(
    (
      await db.lmsLearningNotification.findUniqueOrThrow({
        where: { id: review.notificationId },
      })
    ).readAt,
  ).not.toBeNull();
  expect(invalidReads).toEqual([]);
  await page.screenshot({
    path: path.join(evidence, "teacher-notification-real-review-desktop.png"),
    fullPage: true,
  });
  await metrics("teacher-notification-recovery", {
    inboxFixture:
      "Exact own outbox copied after real submitSubmission; no worker drain",
    immutableSubmissionId: review.id,
    expandNotificationClicks: 1,
    retryListClicks: 1,
    notificationOpenClicks: 1,
    failedMarkRetainedPage: true,
    invalidEventReads: 0,
  });
});

test("a delayed notification mark cannot override a newer calendar event choice", async ({
  page,
}) => {
  const seeded = await fixture();
  const notification = await db.lmsLearningNotification.findFirstOrThrow({
    where: {
      tenantId: seeded.context.tenantId,
      userId: seeded.teacher.id,
      eventId: seeded.events[1].id,
    },
  });
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let committed = false;
  await page.route(
    `**/api/lms/notifications/${notification.id}/read`,
    async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      committed = true;
      await barrier;
      await route.fulfill({ response });
    },
  );
  await openCalendar(page, seeded.account);
  const notifications = page.locator(".lms-calendar-notifications");
  await notifications.locator(":scope > summary").click();
  await notifications
    .locator(".lms-event-row")
    .filter({ hasText: seeded.events[1].titleRu })
    .getByRole("button", { name: "Прочитать и открыть", exact: true })
    .click();
  await expect.poll(() => committed).toBe(true);
  try {
    await page
      .locator(".lms-calendar article")
      .filter({ hasText: seeded.events[0].titleRu })
      .getByRole("button", { name: "Открыть", exact: true })
      .click();
    const detail = page.locator(".lms-event-detail");
    await expect(
      detail.getByRole("heading", {
        name: seeded.events[0].titleRu,
        exact: true,
      }),
    ).toBeVisible();
    release();
    await expect(
      notifications
        .locator(".lms-event-row")
        .filter({ hasText: seeded.events[1].titleRu }),
    ).toContainText("Прочитано");
    await expect(
      detail.getByRole("heading", {
        name: seeded.events[0].titleRu,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      detail.getByRole("heading", {
        name: seeded.events[1].titleRu,
        exact: true,
      }),
    ).toHaveCount(0);
    expect(
      (
        await db.lmsLearningNotification.findUniqueOrThrow({
          where: { id: notification.id },
        })
      ).readAt,
    ).not.toBeNull();
  } finally {
    release();
  }
});

test("global inbox retains failed mark across a successful refresh, paginates real rows and opens the exact review", async ({
  page,
}) => {
  const seeded = await fixture(true, true);
  if (!seeded.review) throw new Error("Review fixture missing");
  const review = seeded.review;
  for (let index = 0; index < 25; index++)
    await createTeachingEvent(seeded.context, {
      operationId: randomUUID(),
      groupId: seeded.groupId,
      teacherUserId: seeded.teacher.id,
      titleRu: `Синтетическое занятие уведомления ${index + 1}`,
      titleKz: `Хабарламаның синтетикалық сабағы ${index + 1}`,
      timezone: "Asia/Qyzylorda",
      startsAt: new Date(day(2).getTime() + index * 60000).toISOString(),
      endsAt: new Date(day(2).getTime() + (index + 60) * 60000).toISOString(),
    });
  await login(page, seeded.account);
  await page.goto("/lms/notifications");
  const rows = page.locator("ul.lms-list > li");
  await expect(rows).toHaveCount(25);
  const firstHref = await rows
    .first()
    .getByRole("link", { name: "Открыть", exact: true })
    .getAttribute("href");
  let failMark = true;
  const markRequests: string[] = [];
  await page.route("**/api/lms/notifications/*/read", async (route) => {
    markRequests.push(route.request().url());
    if (failMark)
      await route.fulfill({
        status: 500,
        json: { code: "SYNTHETIC_INBOX_MARK_FAILURE" },
      });
    else await route.continue();
  });
  await rows
    .first()
    .getByRole("button", { name: "Отметить прочитанным", exact: true })
    .click();
  const markError = page
    .getByRole("alert")
    .filter({ hasText: "Не удалось отметить прочитанным" });
  await expect(markError).toBeVisible();
  const refresh = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/lms/notifications" &&
      new URL(r.url()).searchParams.get("pageSize") === "25",
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  expect((await refresh).status()).toBe(200);
  await expect(markError).toBeVisible();
  expect(markRequests).toHaveLength(1);
  failMark = false;
  await markError
    .getByRole("button", { name: "Повторить отметку", exact: true })
    .click();
  await expect(markError).toHaveCount(0);
  await expect(
    rows
      .first()
      .getByRole("button", { name: "Отметить прочитанным", exact: true }),
  ).toHaveCount(0);
  expect(markRequests).toHaveLength(2);
  expect(markRequests[1]).toBe(markRequests[0]);
  expect(
    await rows
      .first()
      .getByRole("link", { name: "Открыть", exact: true })
      .getAttribute("href"),
  ).toBe(firstHref);
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  await page.route(
    "**/api/lms/notifications?page=2&pageSize=25",
    async (route) => {
      const response = await route.fetch();
      held = true;
      await barrier;
      await route.fulfill({ response });
    },
  );
  await page
    .getByRole("navigation", { name: "Страницы уведомлений", exact: true })
    .getByRole("button", { name: "Далее", exact: true })
    .click();
  await expect.poll(() => held).toBe(true);
  try {
    await expect(rows).toHaveCount(0);
    await expect(
      page.getByText("Загружаем уведомления…", { exact: true }),
    ).toBeVisible();
    release();
    await expect(rows).toHaveCount(3);
    await page.setViewportSize({ width: 390, height: 844 });
    await overflow(page);
    await page.screenshot({
      path: path.join(evidence, "global-inbox-page2-390-ru.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "KZ", exact: true }).first().click();
    await expect(rows.first()).not.toContainText(
      /\b(?:AM|PM|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/,
    );
    await overflow(page);
    await page.screenshot({
      path: path.join(evidence, "global-inbox-page2-390-kz.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "RU", exact: true }).first().click();
    const reviewRow = rows.filter({ hasText: review.titleRu });
    await reviewRow.getByRole("link", { name: "Открыть", exact: true }).click();
    await expect(page).toHaveURL(
      new RegExp(`/lms/teaching\\?type=SUBMISSION&reviewId=${review.id}$`),
    );
    await expect(
      page.getByText("Синтетический ответ для проверки перехода из календаря", {
        exact: true,
      }),
    ).toBeVisible();
    await metrics("global-inbox-recovery", {
      listTotal: 28,
      pages: [25, 3],
      failedMarkRetainedAfterGet: true,
      retrySameNotification: true,
      exactReviewHref: review.href,
      noOldRowsDuringPageLoading: true,
    });
  } finally {
    release();
  }
});

test("teacher work queue and exact detail recover their own failed requests without inventing an empty queue", async ({
  page,
  browser,
}) => {
  const seeded = await fixture(true, true);
  if (!seeded.review) throw new Error("Review fixture missing");
  const review = seeded.review;
  let failQueue = true;
  let failDetail = true;
  await page.route("**/api/lms/reviews?**", async (route) => {
    if (failQueue)
      await route.fulfill({
        status: 500,
        json: { code: "SYNTHETIC_REVIEW_LIST_FAILURE" },
      });
    else await route.continue();
  });
  await page.route(
    `**/api/lms/reviews/SUBMISSION/${review.id}`,
    async (route) => {
      if (failDetail)
        await route.fulfill({
          status: 500,
          json: { code: "SYNTHETIC_REVIEW_DETAIL_FAILURE" },
        });
      else await route.continue();
    },
  );
  await login(page, seeded.account);
  await page
    .getByRole("button", { name: "Проверка работ", exact: true })
    .click();
  const queue = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Очередь проверки", exact: true }),
  });
  await expect(
    queue.getByRole("button", { name: "Повторить загрузку", exact: true }),
  ).toBeVisible();
  await expect(
    queue.getByText("Работ для проверки нет", { exact: true }),
  ).toHaveCount(0);
  failQueue = false;
  await queue
    .getByRole("button", { name: "Повторить загрузку", exact: true })
    .click();
  await queue
    .getByRole("button", { name: "Открыть работу", exact: true })
    .click();
  const retry = page.getByRole("button", {
    name: "Обновить данные",
    exact: true,
  });
  await expect(retry).toBeVisible();
  failDetail = false;
  await retry.click();
  await expect(
    page.getByText("Синтетический ответ для проверки перехода из календаря", {
      exact: true,
    }),
  ).toBeVisible();
  expect(
    (await db.lmsSubmission.findUniqueOrThrow({ where: { id: review.id } }))
      .state,
  ).toBe("SUBMITTED");
  await metrics("teacher-review-load-recovery", {
    queueRetryClicks: 1,
    detailRetryClicks: 1,
    submissionState: "SUBMITTED",
    noDecisionFabricated: true,
  });
  const feedback =
    "Синтетическое решение преподавателя: приведённое обоснование соответствует критериям";
  const decisionChoice = page.getByRole("combobox", {
    name: "Решение",
    exact: true,
  });
  const feedbackField = page.getByRole("textbox", {
    name: "Обратная связь слушателю",
    exact: true,
  });
  await decisionChoice.selectOption("ACCEPTED");
  const draftKey = `demo:lms:review-draft:${seeded.context.tenantId}:${seeded.teacher.id}:SUBMISSION:${review.id}`;
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    (
      window as unknown as { restoreReviewStorage: () => void }
    ).restoreReviewStorage = () => {
      Storage.prototype.setItem = original;
    };
    Storage.prototype.setItem = function (name, value) {
      if (this === sessionStorage && name === key)
        throw new DOMException(
          "Synthetic review draft storage failure",
          "QuotaExceededError",
        );
      original.call(this, name, value);
    };
  }, draftKey);
  await feedbackField.fill(feedback);
  const storageFailure = page
    .getByRole("alert")
    .filter({
      hasText:
        "Черновик решения не сохранён на устройстве. Не закрывайте страницу до сохранения черновика или решения.",
    });
  await expect(storageFailure).toBeVisible();
  await page.screenshot({
    path: path.join(evidence, "teacher-draft-storage-error.png"),
    fullPage: true,
  });
  await page.evaluate(() =>
    (
      window as unknown as { restoreReviewStorage: () => void }
    ).restoreReviewStorage(),
  );
  await page
    .getByRole("button", { name: "Сохранить черновик", exact: true })
    .click();
  await expect(storageFailure).toHaveCount(0);
  const readDraft = () =>
    page.evaluate((key) => {
      const value = sessionStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    }, draftKey);
  await expect
    .poll(readDraft)
    .toMatchObject({ feedback, decision: "ACCEPTED" });
  const beforeReloadDraft = await readDraft();
  await page.reload();
  await expect(decisionChoice).toHaveValue("ACCEPTED");
  await expect(feedbackField).toHaveValue(feedback);
  expect((await readDraft()).key).toBe(beforeReloadDraft.key);
  await page.getByRole("link", { name: "Мои курсы", exact: true }).click();
  await expect(page).toHaveURL(/\/lms$/);
  await page.goBack();
  await expect(decisionChoice).toHaveValue("ACCEPTED");
  await expect(feedbackField).toHaveValue(feedback);
  await page.screenshot({
    path: path.join(evidence, "teacher-draft-restored-after-navigation.png"),
    fullPage: true,
  });
  expect(
    await db.lmsReviewDecision.count({
      where: { tenantId: seeded.context.tenantId, targetId: review.id },
    }),
  ).toBe(0);
  expect(
    (await db.lmsSubmission.findUniqueOrThrow({ where: { id: review.id } }))
      .state,
  ).toBe("SUBMITTED");
  let decisionPosts = 0;
  page.on("request", (request) => {
    if (
      request.url().endsWith(`/lms/reviews/SUBMISSION/${review.id}/decision`) &&
      request.method() === "POST"
    )
      decisionPosts++;
  });
  const decision = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/lms/reviews/SUBMISSION/${review.id}/decision`) &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Принять работу", exact: true })
    .click();
  expect((await decision).status()).toBe(201);
  await expect(
    page.getByText("Решение сохранено", { exact: true }),
  ).toBeVisible();
  expect(
    (await db.lmsSubmission.findUniqueOrThrow({ where: { id: review.id } }))
      .state,
  ).toBe("ACCEPTED");
  const savedDecision = await db.lmsReviewDecision.findMany({
    where: { tenantId: seeded.context.tenantId, targetId: review.id },
  });
  expect(savedDecision).toHaveLength(1);
  expect(savedDecision[0]).toMatchObject({
    decision: "ACCEPTED",
    feedback,
    actorId: seeded.teacher.id,
    revision: 1,
  });
  await expect.poll(readDraft).toBeNull();
  await page.reload();
  await expect(
    page.getByText("Синтетический ответ для проверки перехода из календаря", {
      exact: true,
    }),
  ).toBeVisible();
  expect(decisionPosts).toBe(1);
  expect(
    await db.lmsReviewDecision.count({
      where: { tenantId: seeded.context.tenantId, targetId: review.id },
    }),
  ).toBe(1);
  expect(await readDraft()).toBeNull();
  await page.getByText("История проверки", { exact: true }).click();
  await expect(page.locator(".lms-review-history")).toContainText(feedback);
  await page.screenshot({
    path: path.join(evidence, "teacher-real-decision-history.png"),
    fullPage: true,
  });
  const learnerContext = await browser.newContext({
    baseURL: process.env.DEMO_ORIGIN,
    viewport: { width: 390, height: 844 },
  });
  try {
    const learner = await learnerContext.newPage();
    await learner.routeWebSocket(/\/_next\/webpack-hmr/, (socket) =>
      socket.close(),
    );
    await login(learner, review.learner, /\/learn$/);
    await learner.goto(
      `/learn/${review.learner.enrollmentId}?lessonId=calendar-review-work`,
    );
    await expect(
      learner.getByText("Работа принята", { exact: true }),
    ).toBeVisible();
    await expect(
      learner.getByText(feedback, { exact: true }).first(),
    ).toBeVisible();
    await overflow(learner);
    await learner.screenshot({
      path: path.join(evidence, "learner-accepted-work-390.png"),
      fullPage: true,
    });
  } finally {
    await learnerContext.close();
  }
  const foreignDraftKey = `demo:lms:review-draft:${seeded.context.tenantId}:other-user:SUBMISSION:${review.id}`;
  // Storage-only sentinel fixture: replay the old local draft after confirmed
  // acceptance to verify actual logout clears only this user's recovery data.
  await page.evaluate(
    ({ ownKey, foreignKey, prior }) => {
      sessionStorage.setItem(ownKey, JSON.stringify(prior));
      sessionStorage.setItem(foreignKey, "synthetic-foreign-scope-sentinel");
    },
    { ownKey: draftKey, foreignKey: foreignDraftKey, prior: beforeReloadDraft },
  );
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(await readDraft()).toBeNull();
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), foreignDraftKey),
  ).toBe("synthetic-foreign-scope-sentinel");
  await login(page, seeded.account);
  await page.goto(`/lms/teaching?type=SUBMISSION&reviewId=${review.id}`);
  await expect(
    page.getByText("Синтетический ответ для проверки перехода из календаря", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByText("История проверки", { exact: true }).click();
  await expect(page.locator(".lms-review-history")).toContainText(feedback);
  expect(await readDraft()).toBeNull();
  expect(decisionPosts).toBe(1);
  expect(
    await db.lmsReviewDecision.count({
      where: { tenantId: seeded.context.tenantId, targetId: review.id },
    }),
  ).toBe(1);
  await page.evaluate((key) => sessionStorage.removeItem(key), foreignDraftKey);
  await metrics("teacher-to-learner-result", {
    targetId: review.id,
    decision: "ACCEPTED",
    submittedRevision: 1,
    decisionCount: 1,
    teacherDecisionClicks: 1,
    decisionFields: 2,
    learnerSawDecisionAndFeedback: true,
    unsentFeedbackAndDecisionSurvivedReloadAndNavigationBack: true,
    decisionsBeforeExplicitSave: 0,
    decisionPostsIncludingPostSaveReload: decisionPosts,
    clearedOnlyConfirmedReviewDraft: true,
    storageSaveFailureExplicitlyRecovered: true,
    explicitLogoutClearsOnlyCurrentUserDrafts: true,
    confirmedDecisionSurvivesReloginWithoutDraftReplay: true,
    syntheticOnly: true,
  });
});

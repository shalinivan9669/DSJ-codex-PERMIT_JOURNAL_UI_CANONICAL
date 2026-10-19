import { test, expect, type Page, type APIResponse } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
const product = path.resolve(__dirname, "../../..");
const output = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    path.join(product, "docs/evidence/lms-full-tz-pass-01-20261018"),
);
type User = {
  id: string;
  email: string;
  password: string;
  recipientId?: string;
};
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
  await page.getByLabel("Пароль").fill(user.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
test("director assigns TEACHER to exact existing group through UI, authorized teacher scope excludes sibling group", async ({
  page,
  browser,
}) => {
  const fixture = JSON.parse(
    readFileSync(
      path.join(product, ".runtime/lms-pass01-20261018/browser-fixture.json"),
      "utf8",
    ),
  ) as { baseUrl: string; users: { director: User; teacher: User } };
  const prior = JSON.parse(
    readFileSync(
      path.join(
        product,
        "docs/evidence/lms-full-tz-pass-01-20261018/author-focused-run02/UX_BROWSER_author_focused.json",
      ),
      "utf8",
    ),
  ) as { courseId: string };
  const origin = fixture.baseUrl;
  expect(["localhost", "127.0.0.1"]).toContain(new URL(origin).hostname);
  const teacherContext = await browser.newContext({ baseURL: origin });
  try {
    await login(page, fixture.users.director);
    const session = await body<{ csrfToken: string }>(
      await page.request.get("/api/auth/session"),
    );
    const course = await body<{
      course: { titleRu: string };
      versions: { id: string; status: string }[];
    }>(await page.request.get(`/api/lms/courses/${prior.courseId}`));
    const version = course.versions.find(
      (value) => value.status === "PUBLISHED",
    )!;
    const names = [
      `Синтетическая группа scope ${randomUUID().slice(0, 6)}`,
      `Синтетическая соседняя группа ${randomUUID().slice(0, 6)}`,
    ];
    const groups: string[] = [];
    for (const [index, suffix] of ["03", "04"].entries()) {
      const recipients = JSON.parse(
        readFileSync(
          path.join(
            product,
            `.runtime/lms-pass01-20261018/browser-learner-fixture-${suffix}.json`,
          ),
          "utf8",
        ),
      ) as { users: { learner: User }; partnerRecipientId: string };
      const assigned = await body<{ groupId: string }>(
        await page.request.post("/api/lms/enrollments", {
          headers: { origin, "x-csrf-token": session.csrfToken },
          data: {
            courseVersionId: version.id,
            recipientIds: [
              recipients.users.learner.recipientId,
              recipients.partnerRecipientId,
            ],
            groupName: names[index],
            operationId: randomUUID(),
          },
        }),
      );
      expect(assigned.groupId).toBeTruthy();
      groups.push(assigned.groupId);
    }
    const teacher = await teacherContext.newPage();
    await login(teacher, fixture.users.teacher);
    expect([403, 404]).toContain(
      (await teacher.request.get(`/api/lms/groups/${groups[0]}`)).status(),
    );
    await page.goto("/lms/learning-roles");
    const form = page.locator("form").filter({
      has: page.getByRole("heading", {
        name: "Назначить учебную роль",
        exact: true,
      }),
    });
    await form
      .getByRole("searchbox", { name: "Поиск пользователя", exact: true })
      .fill(fixture.users.teacher.email);
    await expect(
      form.locator(`select option[value="${fixture.users.teacher.id}"]`),
    ).toHaveCount(1);
    await form
      .getByLabel(/^Пользователь/)
      .selectOption(fixture.users.teacher.id);
    await form.getByLabel(/^Роль/).selectOption("TEACHER");
    await form
      .getByRole("searchbox", { name: "Поиск курса", exact: true })
      .fill(course.course.titleRu);
    await expect(
      form.locator(`select option[value="${prior.courseId}"]`),
    ).toHaveCount(1);
    await form.getByLabel(/^Курс/).selectOption(prior.courseId);
    await form
      .getByRole("searchbox", { name: "Поиск группы", exact: true })
      .fill(names[0]);
    await expect(
      form.locator(`select option[value="${groups[0]}"]`),
    ).toHaveCount(1);
    await form.getByLabel(/^Область группы/).selectOption(groups[0]);
    const create = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/lms/learning-bindings"),
    );
    await form
      .getByRole("button", { name: "Назначить роль", exact: true })
      .click();
    const created = await body<{
      id: string;
      role: string;
      groupId: string;
      courseId: string;
    }>(await create);
    expect(created).toMatchObject({
      role: "TEACHER",
      groupId: groups[0],
      courseId: prior.courseId,
    });
    await teacher.goto("/lms/teaching");
    const choices = teacher
      .locator("details")
      .filter({
        has: teacher
          .locator(":scope > summary")
          .filter({ hasText: "Мои курсы и группы" }),
      })
      .first();
    await choices.locator(":scope > summary").click();
    await choices
      .getByRole("searchbox", { name: "Поиск группы", exact: true })
      .fill(names[0]);
    await expect(
      choices.getByRole("link", { name: names[0], exact: true }),
    ).toBeVisible();
    await expect(
      choices.getByRole("link", { name: names[1], exact: true }),
    ).toHaveCount(0);
    const visible = await body<{
      groups: { id: string }[];
      groupsTotal: number;
    }>(
      await teacher.request.get(
        `/api/lms/teaching-context?groupCourseId=${prior.courseId}&pageSize=25`,
      ),
    );
    expect(visible.groups.map((group) => group.id)).toEqual([groups[0]]);
    expect(visible.groupsTotal).toBe(1);
    expect(
      (await teacher.request.get(`/api/lms/groups/${groups[0]}`)).ok(),
    ).toBe(true);
    expect([403, 404]).toContain(
      (await teacher.request.get(`/api/lms/groups/${groups[1]}`)).status(),
    );
    await mkdir(output, { recursive: true });
    await page.screenshot({
      path: path.join(output, "director-group-binding.png"),
      fullPage: true,
    });
    await teacher.screenshot({
      path: path.join(output, "teacher-exact-group.png"),
      fullPage: true,
    });
    await writeFile(
      path.join(output, "UX_BROWSER_group_binding.json"),
      JSON.stringify(
        {
          result: "PASS",
          courseId: prior.courseId,
          groupId: groups[0],
          excludedSiblingGroupId: groups[1],
          bindingId: created.id,
          setup:
            "Two synthetic groups prepared through authenticated bulk assignment API using existing synthetic recipients.",
          observed:
            "Director actual UI user/course/group search and TEACHER exact-group grant; teacher UI link and server scope include only granted group; sibling group of same course denied before/after.",
        },
        null,
        2,
      ),
      "utf8",
    );
  } finally {
    await teacherContext.close();
  }
});

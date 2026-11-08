import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, type Context } from "../../apps/api/src/core";
import {
  createCourse,
  cloneVersion,
  getCourse,
  listCourses,
  publishVersion,
} from "../../apps/api/src/lms/courses";
import {
  courseContentSchema,
  regulatoryProfileSchema,
} from "../../packages/contracts/src/lms";
import { lmsCourse, lmsTenant } from "./lms-fixture";

test("methodist catalogue scopes counts and pages to live bindings and keeps the published version beside its editable draft", async () => {
  const center = await lmsTenant("methodist-catalogue");
  const foreign = await lmsTenant("methodist-catalogue-foreign");
  async function methodist(): Promise<Context> {
    const user = await db.user.create({
      data: {
        tenantId: center.tenant.id,
        role: "METHODIST",
        email: `${randomUUID()}@example.test`,
        displayName: "Synthetic methodist",
        passwordHash: "synthetic-not-for-login",
      },
    });
    return { ...center.context, userId: user.id, role: user.role };
  }
  try {
    const author = await methodist(),
      stranger = await methodist();
    assert.equal(
      (await listCourses(author, { page: "1", search: "" })).total,
      0,
    );
    const blank = await createCourse(author, {
      content: courseContentSchema.parse({
        titleRu: "Новый курс",
        titleKz: "Жаңа курс",
        modules: [],
        exam: { questions: [], questionCount: 1 },
      }),
      profile: regulatoryProfileSchema.parse({
        title: "Новое основание",
        issuer: "",
      }),
    });
    assert.equal(blank.version.status, "DRAFT");
    const created = await createCourse(author, lmsCourse({ questions: 1 }));
    await createCourse(stranger, lmsCourse({ questions: 1 }));
    await createCourse(foreign.context, lmsCourse({ questions: 1 }));
    const published = await publishVersion(center.context, created.version.id, {
      revision: 0,
    });
    const draft = await cloneVersion(author, created.course.id);
    const first = await listCourses(author, { pageSize: 1, page: 1 });
    const second = await listCourses(author, { pageSize: 1, page: 2 });
    assert.equal(first.total, 2);
    assert.equal(second.total, 2);
    assert.deepEqual(
      new Set([...first.items, ...second.items].map((item) => item.id)),
      new Set([created.course.id, blank.course.id]),
    );
    const matching = await listCourses(author, { search: "Синтетическая" });
    assert.equal(matching.total, 1);
    assert.equal(matching.items[0].latestVersion.id, draft.id);
    assert.equal(matching.items[0].publishedVersion?.id, published.id);
    assert.ok(matching.items[0].allowedActions.includes("edit"));
    assert.equal(matching.items[0].allowedActions.includes("publish"), false);
    assert.equal(matching.items[0].allowedActions.includes("assign"), false);
    assert.equal(JSON.stringify(matching).includes("correctOptionIds"), false);
    const original = await db.courseVersion.findUniqueOrThrow({
      where: { id: published.id },
    });
    await db.lmsTeachingBinding.updateMany({
      where: { tenantId: center.tenant.id, userId: author.userId },
      data: { revokedAt: new Date() },
    });
    assert.equal((await listCourses(author, {})).total, 0);
    await assert.rejects(
      getCourse(author, created.course.id),
      (error: unknown) =>
        !!error &&
        typeof error === "object" &&
        "getStatus" in error &&
        typeof error.getStatus === "function" &&
        error.getStatus() === 404,
    );
    assert.deepEqual(
      await db.courseVersion.findUniqueOrThrow({ where: { id: published.id } }),
      original,
    );
  } finally {
    await db.$disconnect();
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrap } from "../../apps/api/src/main";
import { db } from "../../apps/api/src/core";
import { personalDataLocations } from "../../packages/contracts/src/lms/deployment-gates";
import {
  lmsCourse,
  lmsHttp,
  lmsJson,
  lmsSession,
  lmsTenant,
} from "./lms-fixture";

test("non-demo content authoring works without learner-data evidence while tenant, roles, CSRF and learning gates remain enforced", async () => {
  const previous = process.env.DEMO_LMS_DEPLOYMENT_EVIDENCE;
  const directory = await mkdtemp(join(tmpdir(), "demo-lms-readiness-http-"));
  process.env.PORT = "0";
  process.env.DEMO_ORIGIN = "http://localhost:3159";
  delete process.env.DEMO_LMS_DEPLOYMENT_EVIDENCE;
  const center = await lmsTenant("readiness-real-mode-synthetic-data");
  const foreign = await lmsTenant("readiness-foreign-synthetic-data");
  await db.tenant.update({
    where: { id: center.tenant.id },
    data: { demoOnly: false },
  });
  await db.tenant.update({
    where: { id: foreign.tenant.id },
    data: { demoOnly: false },
  });
  const app = await bootstrap();
  const base = await app.getUrl();
  const session = await lmsSession(base, center.user.email);
  const director = lmsHttp(base, session);
  const foreignDirector = lmsHttp(
    base,
    await lmsSession(base, foreign.user.email),
  );
  const anonymous = lmsHttp(base, { origin: process.env.DEMO_ORIGIN });
  const path = "/settings/learning-readiness";
  try {
    assert.equal((await anonymous(path)).status, 401);
    const before = await db.tenant.findUniqueOrThrow({
      where: { id: center.tenant.id },
    });
    assert.deepEqual(await lmsJson(await director(path)), {
      available: false,
      reason: "NOT_CONFIGURED",
    });
    assert.deepEqual(
      await db.tenant.findUniqueOrThrow({ where: { id: center.tenant.id } }),
      before,
    );
    assert.deepEqual(
      await lmsJson(await director(`${path}?tenantId=${foreign.tenant.id}`)),
      { available: false, reason: "NOT_CONFIGURED" },
    );
    for (const method of ["POST", "PATCH", "DELETE"])
      assert.equal((await director(path, method, {})).status, 404);
    for (const role of [
      "SUPER_ADMIN",
      "ADMIN",
      "OPERATOR",
      "VIEWER",
      "METHODIST",
      "TEACHER",
      "EXPERT",
      "LEARNER",
      "EMPLOYER",
    ]) {
      // Session is unchanged; each request rechecks the current persisted role.
      await db.user.update({ where: { id: center.user.id }, data: { role } });
      assert.equal(
        (await director(path)).status,
        ["SUPER_ADMIN", "ADMIN"].includes(role) ? 200 : 403,
        role,
      );
    }
    await db.user.update({
      where: { id: center.user.id },
      data: { role: "METHODIST" },
    });
    assert.equal((await anonymous("/lms/courses")).status, 401);
    assert.equal((await lmsJson(await director("/lms/courses"))).total, 0);
    const noCsrf = lmsHttp(base, { ...session, "x-csrf-token": "" });
    assert.equal(
      (await noCsrf("/lms/courses", "POST", lmsCourse())).status,
      403,
    );
    const input = lmsCourse({ kind: "PRACTICE" });
    input.profile.synthetic = false;
    input.profile.status = "NEEDS_LEGAL_REVIEW";
    input.profile.sources = [];
    input.profile.reviewReference = "";
    const created = await lmsJson(
      await director("/lms/courses", "POST", input),
      201,
    );
    assert.equal((await lmsJson(await director("/lms/courses"))).total, 1);
    const options = await lmsJson(
      await director("/lms/course-options?pageSize=25"),
    );
    assert.deepEqual(
      options.courses.map((course: { id: string }) => course.id),
      [created.course.id],
    );
    assert.deepEqual(options.users, []);
    assert.deepEqual(options.groups, []);
    assert.equal(options.usersTotal, 0);
    assert.equal(options.groupsTotal, 0);
    assert.equal(JSON.stringify(options).includes(center.user.email), false);
    assert.equal(
      (
        await lmsJson(
          await director(
            `/lms/course-options?excludeCourseId=${created.course.id}`,
          ),
        )
      ).coursesTotal,
      0,
    );
    assert.equal(
      (await lmsJson(await foreignDirector("/lms/course-options")))
        .coursesTotal,
      0,
    );
    assert.equal(
      (await director("/lms/course-options?userPage=1")).status,
      400,
    );
    assert.equal(
      (await foreignDirector(`/lms/courses/${created.course.id}`)).status,
      404,
    );
    const revised = await lmsJson(
      await director(`/lms/course-versions/${created.version.id}`, "PUT", {
        revision: created.version.revision,
        content: {
          ...input.content,
          titleRu: "Сохранённая программа без данных слушателей",
        },
        profile: input.profile,
      }),
    );
    assert.equal(
      revised.content.titleRu,
      "Сохранённая программа без данных слушателей",
    );
    assert.equal(
      (
        await foreignDirector(
          `/lms/course-versions/${created.version.id}`,
          "PUT",
          {
            revision: revised.revision,
            content: revised.content,
            profile: input.profile,
          },
        )
      ).status,
      404,
    );
    const submitted = await lmsJson(
      await director(
        `/lms/course-versions/${created.version.id}/review`,
        "POST",
        {
          revision: revised.revision,
          action: "SUBMIT",
        },
      ),
      201,
    );
    assert.equal(submitted.review.state, "PENDING");
    assert.equal(
      (
        await director(
          `/lms/course-versions/${created.version.id}/review`,
          "POST",
          {
            revision: submitted.revision,
            action: "APPROVE",
          },
        )
      ).status,
      403,
    );
    await db.user.update({
      where: { id: center.user.id },
      data: { role: "DIRECTOR" },
    });
    const approved = await lmsJson(
      await director(
        `/lms/course-versions/${created.version.id}/review`,
        "POST",
        {
          revision: submitted.revision,
          action: "APPROVE",
        },
      ),
      201,
    );
    const published = await lmsJson(
      await director(
        `/lms/course-versions/${created.version.id}/publish`,
        "POST",
        {
          revision: approved.revision,
        },
      ),
      201,
    );
    assert.equal(published.status, "PUBLISHED");
    for (const [route, method, body] of [
      ["/lms/enrollments", "GET", undefined],
      ["/lms/enrollments", "POST", {}],
      [
        "/lms/calendar?from=2026-11-01T00:00:00.000Z&to=2026-12-01T00:00:00.000Z",
        "GET",
        undefined,
      ],
      ["/lms/material-library", "GET", undefined],
    ] as const) {
      const blocked = await lmsJson(await director(route, method, body), 503);
      assert.equal(blocked.code, "LMS_DEPLOYMENT_REVIEW_REQUIRED", route);
    }
    const evidence = {
      tenantId: center.tenant.id,
      operator: "SYNTHETIC PRIVATE OPERATOR",
      approvedBy: "SYNTHETIC PRIVATE REVIEWER",
      approvalReference: "SYNTHETIC-NOT-AUTHORIZATION",
      lawfulBasis: "SYNTHETIC BASIS",
      subjectAccountingReference: "SYNTHETIC ACCOUNTING",
      retentionPolicy: "SYNTHETIC RETENTION",
      incidentAndDeletionProcedure: "SYNTHETIC PROCEDURE",
      inventory: personalDataLocations.map((kind) => ({
        kind,
        applicable: true,
        country: "KZ",
        operatorOrProcessor: "SYNTHETIC",
        evidence: "SYNTHETIC",
        access: "SCOPED",
        retention: "DEFINED",
      })),
    };
    process.env.DEMO_LMS_DEPLOYMENT_EVIDENCE = join(
      directory,
      `${randomUUID()}.json`,
    );
    await writeFile(
      process.env.DEMO_LMS_DEPLOYMENT_EVIDENCE,
      JSON.stringify([evidence]),
    );
    assert.deepEqual(await lmsJson(await director(path)), {
      available: true,
      reason: "READY",
    });
    assert.deepEqual(
      await lmsJson(
        await foreignDirector(`${path}?tenantId=${center.tenant.id}`),
      ),
      { available: false, reason: "TENANT_MISSING" },
    );
    const courses = await lmsJson(
      await director("/lms/courses?page=1&search="),
    );
    assert.equal(courses.total, 1);
    assert.equal((await foreignDirector("/lms/enrollments")).status, 503);
    assert.equal(
      (await lmsJson(await foreignDirector("/lms/courses"))).total,
      0,
    );
    assert.equal(
      await db.course.count({ where: { tenantId: center.tenant.id } }),
      1,
    );
    assert.equal(
      await db.enrollment.count({ where: { tenantId: center.tenant.id } }),
      0,
    );
  } finally {
    if (previous === undefined) delete process.env.DEMO_LMS_DEPLOYMENT_EVIDENCE;
    else process.env.DEMO_LMS_DEPLOYMENT_EVIDENCE = previous;
    await app.close();
    await db.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});

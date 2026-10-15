import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { bootstrap } from "../../apps/api/src/main";
import { db } from "../../apps/api/src/core";
import { consentVersion } from "../../packages/contracts/src/lms";
import {
  lmsCourse,
  lmsTenant,
  lmsHttp,
  lmsJson,
  lmsSession,
  LMS_PASSWORD,
  LMS_FIXTURE_VERSION,
} from "./lms-fixture";

test("L10: immutable audit records actual HTTP registration, content, publication, enrollment, extension and permission changes across restart", async (t) => {
  process.env.PORT = "0";
  process.env.DEMO_ORIGIN = "http://localhost:3159";
  const tenant = await lmsTenant("Audit boundaries");
  const foreign = await lmsTenant("Audit foreign");
  process.env.DEMO_LMS_REGISTRATION_TENANT_ID = tenant.tenant.id;
  let app = await bootstrap();
  let base = await app.getUrl();
  const directorHeaders = await lmsSession(base, tenant.user.email);
  let director = lmsHttp(base, directorHeaders);
  const anonymous = lmsHttp(base, { origin: process.env.DEMO_ORIGIN });
  const startedAt = new Date();
  const checked: {
    action: string;
    actor: string;
    entityId: string;
    correlationId: string;
  }[] = [];
  async function event(
    response: Response,
    action: string,
    actor: string,
    entityId: string,
  ) {
    const correlationId = response.headers.get("x-correlation-id");
    assert.ok(correlationId);
    const found = await db.auditEvent.findMany({
      where: { tenantId: tenant.tenant.id, action, correlationId },
    });
    assert.equal(found.length, 1, action);
    const value = found[0];
    assert.equal(value.actorId, actor, action);
    assert.equal(value.entityId, entityId, action);
    assert.ok(value.createdAt >= startedAt && value.createdAt <= new Date());
    checked.push({ action, actor, entityId, correlationId });
    return value;
  }
  try {
    const email = `${randomUUID()}@example.test`;
    const registration = await anonymous("/learn/register", "POST", {
      email,
      displayName: "Синтетический аудит",
      password: LMS_PASSWORD,
      consentVersion,
      consent: true,
    });
    const registered = await lmsJson(registration.clone(), 201);
    const learnerUser = await db.user.findFirstOrThrow({
      where: { tenantId: tenant.tenant.id, email },
    });
    const learner = await db.learnerProfile.findUniqueOrThrow({
      where: {
        tenantId_userId: { tenantId: tenant.tenant.id, userId: learnerUser.id },
      },
    });
    const learnerHeaders = {
      origin: process.env.DEMO_ORIGIN,
      cookie: registration.headers
        .getSetCookie()
        .map((v) => v.split(";")[0])
        .join("; "),
      "x-csrf-token": registered.csrfToken as string,
    };
    let learnerHttp = lmsHttp(base, learnerHeaders);
    const registrationEvent = await event(
      registration,
      "LMS_REGISTERED",
      learnerUser.id,
      learnerUser.id,
    );
    assert.equal(
      (registrationEvent.metadata as { consentVersion: string }).consentVersion,
      consentVersion,
    );

    const fixture = lmsCourse({ kind: "PRACTICE" });
    const createdResponse = await director("/lms/courses", "POST", fixture);
    const created = await lmsJson(createdResponse.clone(), 201);
    await event(
      createdResponse,
      "LMS_COURSE_CREATED",
      tenant.user.id,
      created.course.id,
    );
    fixture.content.titleRu += " — редакция2";
    const savedResponse = await director(
      `/lms/course-versions/${created.version.id}`,
      "PUT",
      { ...fixture, revision: created.version.revision },
    );
    const saved = await lmsJson(savedResponse.clone());
    const savedEvent = await event(
      savedResponse,
      "LMS_COURSE_SAVED",
      tenant.user.id,
      saved.id,
    );
    assert.equal(
      (savedEvent.metadata as { revision: number }).revision,
      saved.revision,
    );
    assert.equal(saved.revision, created.version.revision + 1);
    const publishedResponse = await director(
      `/lms/course-versions/${saved.id}/publish`,
      "POST",
      { revision: saved.revision },
    );
    const published = await lmsJson(publishedResponse.clone(), 201);
    const publishedEvent = await event(
      publishedResponse,
      "LMS_VERSION_PUBLISHED",
      tenant.user.id,
      published.id,
    );
    assert.equal(
      (publishedEvent.metadata as { version: number }).version,
      published.version,
    );
    const frozenVersion = await db.courseVersion.findUniqueOrThrow({
      where: { id: published.id },
    });
    assert.equal(
      (publishedEvent.metadata as { snapshotHash: string }).snapshotHash,
      frozenVersion.snapshotHash,
    );

    const assignmentResponse = await director("/lms/enrollments", "POST", {
      courseVersionId: published.id,
      recipientIds: [learner.recipientId],
    });
    const assignments = await lmsJson(assignmentResponse.clone(), 201);
    assert.equal(assignments.created, 1);
    const assignedEvent = await event(
      assignmentResponse,
      "LMS_BULK_ASSIGNED",
      tenant.user.id,
      published.id,
    );
    assert.deepEqual(assignedEvent.metadata, {
      created: 1,
      duplicates: 0,
      errors: [],
    });
    const enrollmentId = assignments.items[0].id;
    const dueAt = new Date(Date.now() + 180 * 86400000).toISOString();
    const extensionResponse = await director(
      `/lms/enrollments/${enrollmentId}/extend`,
      "POST",
      { dueAt },
    );
    assert.equal(extensionResponse.status, 201);
    const extensionEvent = await event(
      extensionResponse,
      "LMS_ACCESS_EXTENDED",
      tenant.user.id,
      enrollmentId,
    );
    assert.equal((extensionEvent.metadata as { dueAt: string }).dueAt, dueAt);

    await t.test(
      "role changes are audit facts and invalidate the old persisted session",
      async () => {
        const colleagueEmail = `${randomUUID()}@example.test`;
        const createdUserResponse = await director("/users", "POST", {
          email: colleagueEmail,
          displayName: "Synthetic limited colleague",
          role: "OPERATOR",
          password: LMS_PASSWORD,
        });
        const colleague = await lmsJson(createdUserResponse.clone(), 201);
        await event(
          createdUserResponse,
          "USER_CREATED",
          tenant.user.id,
          colleague.id,
        );
        const prior = await db.user.findUniqueOrThrow({
          where: { id: colleague.id },
        });
        const oldHeaders = await lmsSession(base, colleagueEmail);
        const permissionResponse = await director(
          `/users/${colleague.id}`,
          "PATCH",
          { role: "VIEWER" },
        );
        assert.equal(permissionResponse.status, 200);
        const permissionEvent = await event(
          permissionResponse,
          "USER_UPDATED_SESSIONS_REVOKED",
          tenant.user.id,
          colleague.id,
        );
        const current = await db.user.findUniqueOrThrow({
          where: { id: colleague.id },
        });
        assert.equal(current.role, "VIEWER");
        assert.equal(current.sessionVersion, prior.sessionVersion + 1);
        assert.equal(
          (await lmsHttp(base, oldHeaders)("/auth/session")).status,
          401,
        );
        const viewer = lmsHttp(base, await lmsSession(base, colleagueEmail));
        assert.equal((await viewer("/print-requests")).status, 200);
        for (const [path, method] of [
          ["/print-requests", "POST"],
          ["/users", "POST"],
          ["/settings/profile", "POST"],
          ["/lms/courses", "GET"],
          ["/lms/courses", "POST"],
          ["/lms/enrollments", "GET"],
          ["/lms/enrollments", "POST"],
          ["/lms/materials/unknown", "GET"],
          ["/lms/sanitary", "GET"],
          ["/learn/enrollments", "GET"],
        ]) {
          const response = await viewer(
            path,
            method,
            method === "POST" ? {} : undefined,
          );
          assert.equal(response.status, 403, `${method} ${path}`);
        }
        const metadata = permissionEvent.metadata as {
          previous: { role: string; active: boolean; sessionVersion: number };
          current: { role: string; active: boolean; sessionVersion: number };
        };
        assert.deepEqual(metadata.previous, {
          role: prior.role,
          active: prior.active,
          sessionVersion: prior.sessionVersion,
        });
        assert.deepEqual(metadata.current, {
          role: current.role,
          active: current.active,
          sessionVersion: current.sessionVersion,
        });
      },
    );

    await t.test(
      "ordinary and foreign users cannot read/change audit, including direct database mutation protection",
      async () => {
        const before = await db.auditEvent.findMany({
          where: { tenantId: tenant.tenant.id },
          orderBy: { id: "asc" },
        });
        assert.equal((await learnerHttp("/audit")).status, 403);
        for (const method of ["PATCH", "DELETE"]) {
          const response = await learnerHttp(
            `/audit/${registrationEvent.id}`,
            method,
            { action: "FORGED" },
          );
          assert.ok([403, 404].includes(response.status));
        }
        const foreignCall = lmsHttp(
          base,
          await lmsSession(base, foreign.user.email),
        );
        const foreignAudit = await lmsJson(
          await foreignCall(`/audit?tenantId=${tenant.tenant.id}`),
        );
        assert.ok(
          foreignAudit.items.every(
            (item: { tenantId: string }) => item.tenantId === foreign.tenant.id,
          ),
        );
        assert.ok(
          !foreignAudit.items.some(
            (item: { id: string }) => item.id === registrationEvent.id,
          ),
        );
        await assert.rejects(
          db.auditEvent.update({
            where: { id: registrationEvent.id },
            data: { action: "FORGED" },
          }),
          /immutable/i,
        );
        await assert.rejects(
          db.auditEvent.delete({ where: { id: registrationEvent.id } }),
          /immutable/i,
        );
        assert.deepEqual(
          await db.auditEvent.findMany({
            where: { tenantId: tenant.tenant.id },
            orderBy: { id: "asc" },
          }),
          before,
        );
      },
    );

    await t.test(
      "audit/content/enrollment remain readable after actual API restart and Prisma reconnect without leaking secret fields",
      async () => {
        const before = await db.auditEvent.findMany({
          where: { tenantId: tenant.tenant.id },
          orderBy: { id: "asc" },
        });
        await app.close();
        await db.$disconnect();
        app = await bootstrap();
        base = await app.getUrl();
        director = lmsHttp(base, directorHeaders);
        learnerHttp = lmsHttp(base, learnerHeaders);
        const records = await lmsJson(await director("/audit"));
        assert.equal(records.total, before.length);
        assert.deepEqual(
          records.items.map((item: { id: string }) => item.id).sort(),
          before.map((item) => item.id).sort(),
        );
        const course = await lmsJson(
          await director(`/lms/courses/${created.course.id}`),
        );
        assert.equal(
          course.versions[0].content.titleRu,
          fixture.content.titleRu,
        );
        const enrollment = await lmsJson(
          await learnerHttp(`/learn/enrollments/${enrollmentId}`),
        );
        assert.equal(enrollment.id, enrollmentId);
        assert.equal(enrollment.dueAt, dueAt);
        const serialized = JSON.stringify(records);
        for (const forbidden of [
          LMS_PASSWORD,
          learnerUser.passwordHash,
          learnerHeaders.cookie,
          "correctOptionIds",
          '"answers"',
          email,
          "Синтетический аудит",
        ])
          assert.ok(!serialized.includes(forbidden));
      },
    );
    const output = resolve("docs/evidence/lms-one-run-20261015/agent-c");
    await mkdir(output, { recursive: true });
    await writeFile(
      resolve(output, "AUDIT_ACCEPTANCE.json"),
      JSON.stringify(
        {
          status: "PASS",
          checkedAt: new Date().toISOString(),
          fixtureVersion: LMS_FIXTURE_VERSION,
          tenantId: tenant.tenant.id,
          events: checked,
          databaseReconnect: true,
          actualApiRestart: true,
          auditImmutable: true,
          sensitiveAuditFieldsAbsent: true,
        },
        null,
        2,
      ),
    );
  } finally {
    delete process.env.DEMO_LMS_REGISTRATION_TENANT_ID;
    await app.close();
    await db.$disconnect();
  }
});

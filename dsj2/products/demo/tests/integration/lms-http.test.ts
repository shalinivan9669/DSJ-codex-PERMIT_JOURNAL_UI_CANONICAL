import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { resolve } from "node:path";
import { bootstrap } from "../../apps/api/src/main";
import { db, hash } from "../../apps/api/src/core";
import { createCourse, publishVersion } from "../../apps/api/src/lms/courses";
import { assignEnrollments } from "../../apps/api/src/lms/enrollments";
import { consentVersion } from "../../packages/contracts/src/lms";
import {
  lmsCourse,
  lmsTenant,
  lmsSession,
  lmsHttp,
  lmsJson,
  LMS_PASSWORD,
  LMS_FIXTURE_VERSION,
} from "./lms-fixture";

test("L01 L02 L03: actual Nest HTTP learner identity, one-time invitation, CSRF, scope and old-surface denial", async (t) => {
  process.env.PORT = "0";
  process.env.DEMO_ORIGIN = "http://localhost:3159";
  const app = await bootstrap();
  const base = await app.getUrl();
  const a = await lmsTenant("HTTP A");
  const b = await lmsTenant("HTTP B");
  process.env.DEMO_LMS_REGISTRATION_TENANT_ID = a.tenant.id;
  const director = lmsHttp(base, await lmsSession(base, a.user.email));
  const anonymous = lmsHttp(base, { origin: process.env.DEMO_ORIGIN });
  let learnerHeaders: Record<string, string>;
  let learnerId = "";
  try {
    await t.test(
      "registration rejects authority injection, false consent and foreign-person claim",
      async () => {
        const form = {
          email: `${randomUUID()}@example.test`,
          password: LMS_PASSWORD,
          displayName: "Синтетическая регистрация",
          consentVersion,
          consent: true,
        };
        assert.equal(
          (
            await anonymous("/learn/register", "POST", {
              ...form,
              role: "DIRECTOR",
              tenantId: b.tenant.id,
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await anonymous("/learn/register", "POST", {
              ...form,
              consent: false,
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await anonymous("/learn/register", "POST", {
              ...form,
              recipientId: randomUUID(),
            })
          ).status,
          400,
        );
        const response = await anonymous("/learn/register", "POST", form);
        const body = await lmsJson(response.clone(), 201);
        learnerHeaders = {
          origin: process.env.DEMO_ORIGIN!,
          cookie: response.headers
            .getSetCookie()
            .map((v) => v.split(";")[0])
            .join("; "),
          "x-csrf-token": body.csrfToken,
        };
        const session = await lmsJson(
          await lmsHttp(base, learnerHeaders)("/auth/session"),
        );
        assert.equal(session.user.role, "LEARNER");
        assert.equal(session.tenant.id, a.tenant.id);
        learnerId = session.user.id;
        const profile = await db.learnerProfile.findUniqueOrThrow({
          where: {
            tenantId_userId: { tenantId: a.tenant.id, userId: learnerId },
          },
        });
        assert.equal(profile.consentVersion, consentVersion);
        assert.equal(
          (await anonymous("/learn/register", "POST", form)).status,
          409,
        );
        assert.equal(
          (
            await anonymous("/learn/register", "POST", {
              ...form,
              email: `${randomUUID()}@example.test`,
            })
          ).status,
          429,
        );
      },
    );
    await t.test(
      "new learner role cannot read or mutate old printing/admin/files/jobs/approvals",
      async () => {
        const call = lmsHttp(base, learnerHeaders);
        for (const [path, method] of [
          ["/print-requests", "GET"],
          ["/print-requests", "POST"],
          ["/users", "GET"],
          ["/users", "POST"],
          ["/settings/profile", "GET"],
          ["/settings/profile", "POST"],
          ["/jobs", "GET"],
          ["/artifacts/unknown", "GET"],
          ["/photos/unknown", "GET"],
          ["/print-requests/unknown/approve", "POST"],
          ["/lms/invites", "POST"],
        ]) {
          const response = await call(
            path,
            method,
            method === "POST" ? {} : undefined,
          );
          assert.ok(
            [403, 404].includes(response.status),
            `${method} ${path}: ${response.status}`,
          );
        }
        assert.equal((await call("/learn/profile")).status, 200);
        assert.equal(
          (
            await lmsHttp(base, { ...learnerHeaders, "x-csrf-token": "wrong" })(
              "/auth/logout",
              "POST",
            )
          ).status,
          403,
        );
      },
    );
    await t.test(
      "invite has verified tenant/person scope and exactly one concurrent consumer",
      async () => {
        const recipient = await db.recipient.create({
          data: {
            tenantId: a.tenant.id,
            data: { fullNameRu: "Синтетический приглашённый" },
          },
        });
        const foreign = await db.recipient.create({
          data: {
            tenantId: b.tenant.id,
            data: { fullNameRu: "Synthetic foreign" },
          },
        });
        assert.equal(
          (
            await director("/lms/invites", "POST", {
              recipientId: foreign.id,
              email: `${randomUUID()}@example.test`,
            })
          ).status,
          404,
        );
        assert.equal((await director("/lms/invites", "POST", {recipientId:recipient.id,email:`${randomUUID()}@example.test`})).status,409);
        const inviteCourse=await createCourse(a.context,lmsCourse({kind:"PRACTICE",required:false}));
        await publishVersion(a.context,inviteCourse.version.id,{revision:0});
        await assignEnrollments(a.context,{courseVersionId:inviteCourse.version.id,recipientIds:[recipient.id]});
        const invite = await lmsJson(
          await director("/lms/invites", "POST", {
            recipientId: recipient.id,
            email: `${randomUUID()}@example.test`,
          }),
          201,
        );
        const inspect = await lmsJson(
          await anonymous("/learn/invite/inspect", "POST", {
            token: invite.token,
          }),
          201,
        );
        assert.equal(inspect.centerName, a.tenant.name);
        assert.equal(JSON.stringify(inspect).includes(recipient.id), false);
        const exchange = {
          token: invite.token,
          password: LMS_PASSWORD,
          consentVersion,
          consent: true,
        };
        const results = await Promise.all([
          anonymous("/learn/invite/exchange", "POST", exchange),
          anonymous("/learn/invite/exchange", "POST", exchange),
        ]);
        assert.deepEqual(results.map((r) => r.status).sort(), [201, 410]);
        assert.equal(
          await db.learnerProfile.count({
            where: { tenantId: a.tenant.id, recipientId: recipient.id },
          }),
          1,
        );
        assert.equal(
          (
            await anonymous("/learn/invite/inspect", "POST", {
              token: invite.token,
            })
          ).status,
          410,
        );
        const expiryRecipient = await db.recipient.create({
          data: { tenantId: a.tenant.id, data: {fullNameRu:"Синтетический срок приглашения"} },
        });
        await assignEnrollments(a.context,{courseVersionId:inviteCourse.version.id,recipientIds:[expiryRecipient.id]});
        const expired = await lmsJson(
          await director("/lms/invites", "POST", {
            recipientId: expiryRecipient.id,
            email: `${randomUUID()}@example.test`,
          }),
          201,
        );
        await db.learnerInvite.update({
          where: { id: expired.id },
          data: { expiresAt: new Date(0) },
        });
        assert.equal(
          (
            await anonymous("/learn/invite/exchange", "POST", {
              ...exchange,
              token: expired.token,
            })
          ).status,
          410,
        );
      },
    );
    await t.test(
      "logout and session version revocation invalidate real persisted cookies",
      async () => {
        const call = lmsHttp(base, learnerHeaders);
        assert.equal((await call("/auth/logout", "POST")).status, 201);
        assert.equal((await call("/learn/profile")).status, 401);
        const user = await db.user.findUniqueOrThrow({
          where: { id: learnerId },
        });
        const headers = await lmsSession(base, user.email);
        await db.user.update({
          where: { id: learnerId },
          data: { sessionVersion: { increment: 1 } },
        });
        assert.equal(
          (await lmsHttp(base, headers)("/learn/profile")).status,
          401,
        );
      },
    );
  } finally {
    delete process.env.DEMO_LMS_REGISTRATION_TENANT_ID;
    await app.close();
    await db.$disconnect();
  }
});

test("S11: 100 simultaneously active synthetic learners read and autosave through real authenticated HTTP", async () => {
  process.env.PORT = "0";
  process.env.DEMO_ORIGIN = "http://localhost:3159";
  const owner = await lmsTenant("100 concurrent learner load");
  const definition = lmsCourse();
  const course = await createCourse(owner.context, definition);
  await publishVersion(owner.context, course.version.id, { revision: 0 });
  const actors = Array.from({ length: 100 }, (_, index) => ({
    userId: randomUUID(),
    recipientId: randomUUID(),
    token: randomBytes(32).toString("hex"),
    csrf: randomBytes(32).toString("hex"),
    index,
  }));
  await db.recipient.createMany({
    data: actors.map((x) => ({
      id: x.recipientId,
      tenantId: owner.tenant.id,
      data: { fullNameRu: `Synthetic load ${x.index}` },
    })),
  });
  await db.user.createMany({
    data: actors.map((x) => ({
      id: x.userId,
      tenantId: owner.tenant.id,
      email: `${x.userId}@example.test`,
      displayName: `Synthetic ${x.index}`,
      role: "LEARNER",
      passwordHash: owner.user.passwordHash,
    })),
  });
  await db.learnerProfile.createMany({
    data: actors.map((x) => ({
      tenantId: owner.tenant.id,
      userId: x.userId,
      recipientId: x.recipientId,
      consentVersion,
      consentAt: new Date(),
    })),
  });
  await db.session.createMany({
    data: actors.map((x) => ({
      id: hash(x.token),
      tenantId: owner.tenant.id,
      userId: x.userId,
      csrfHash: hash(x.csrf),
      sessionVersion: 1,
      expiresAt: new Date(Date.now() + 3600000),
    })),
  });
  const assigned = await assignEnrollments(owner.context, {
    courseVersionId: course.version.id,
    recipientIds: actors.map((x) => x.recipientId),
  });
  const app = await bootstrap();
  const base = await app.getUrl();
  const samples: { operation: string; latencyMs: number; status: number }[] =
    [];
  let inFlight = 0;
  let maxInFlight = 0;
  const startedAt = new Date().toISOString();
  const started = performance.now();
  try {
    const calls = actors.map((actor) => ({
      enrollmentId: assigned.items.find(
        (item) => item.recipientId === actor.recipientId,
      )!.id,
      call: lmsHttp(base, {
        origin: process.env.DEMO_ORIGIN!,
        cookie: `demo_session=${actor.token}; demo_csrf=${actor.csrf}`,
        "x-csrf-token": actor.csrf,
      }),
    }));
    // Warm process and Prisma once. No artificial rate-limit exemption is installed.
    assert.equal(
      (await calls[0].call(`/learn/enrollments/${calls[0].enrollmentId}`))
        .status,
      200,
    );
    for (let round = 1; round <= 2; round++) {
      await Promise.all(
        calls.map(async ({ call, enrollmentId }) => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          try {
            for (const operation of ["read", "autosave"]) {
              const before = performance.now();
              const response =
                operation === "read"
                  ? await call(`/learn/enrollments/${enrollmentId}`)
                  : await call(
                      `/learn/enrollments/${enrollmentId}/lessons/lesson-1/progress`,
                      "POST",
                      { sequence: round, acknowledge: true },
                    );
              await response.text();
              samples.push({
                operation,
                latencyMs: performance.now() - before,
                status: response.status,
              });
            }
          } finally {
            inFlight--;
          }
        }),
      );
    }
    const sorted = samples.map((x) => x.latencyMs).sort((a, b) => a - b);
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
    const errors5xx = samples.filter((x) => x.status >= 500).length;
    const evidence = resolve("docs/evidence/lms-one-run-20261015/agent-c");
    await mkdir(evidence, { recursive: true });
    await writeFile(
      resolve(evidence, `load-${Date.now()}.json`),
      JSON.stringify(
        {
          fixtureVersion: LMS_FIXTURE_VERSION,
          startedAt,
          durationMs: performance.now() - started,
          cpu: cpus()[0]?.model,
          logicalCpuCount: cpus().length,
          memoryBytes: totalmem(),
          database: new URL(process.env.DATABASE_URL!).pathname.slice(1),
          dataset: { users: 100, enrollments: 100, courses: 1 },
          requestedConcurrency: 100,
          observedInFlight: maxInFlight,
          sampleCount: samples.length,
          p95Ms: p95,
          unexpected5xxPercent: (errors5xx / samples.length) * 100,
          samples,
        },
        null,
        2,
      ),
    );
    assert.equal(maxInFlight, 100);
    assert.equal(samples.length, 400);
    assert.equal(
      samples.filter((x) => ![200, 201].includes(x.status)).length,
      0,
      "All measured requests must succeed",
    );
    assert.ok(
      p95 <= 1000,
      `p95 ${p95.toFixed(2)}ms exceeds the agreed 1s budget`,
    );
    assert.ok(errors5xx / samples.length < 0.01);
  } finally {
    await app.close();
    await db.$disconnect();
  }
});

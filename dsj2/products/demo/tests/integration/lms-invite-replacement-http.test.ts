import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { bootstrap } from "../../apps/api/src/main";
import { db } from "../../apps/api/src/core";
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
} from "./lms-fixture";

test("J02: HTTP replacement revokes an unused invitation and preserves its assigned learner", async () => {
  const database = new URL(process.env.DATABASE_URL!);
  assert.equal(database.hostname, "127.0.0.1");
  assert.equal(database.port, "55489");
  assert.equal(database.pathname, "/demo_test_mvp_roles_20261019_run01_integration");
  process.env.PORT = "0";
  const startedAt = new Date().toISOString();
  const app = await bootstrap();
  try {
    const base = await app.getUrl();
    const fixture = await lmsTenant("J02 unused invitation replacement");
    const staff = lmsHttp(base, await lmsSession(base, fixture.user.email));
    const anonymous = lmsHttp(base, { origin: process.env.DEMO_ORIGIN! });
    const recipient = await db.recipient.create({
      data: {
        tenantId: fixture.tenant.id,
        data: { fullNameRu: "Синтетическая замена приглашения" },
      },
    });
    const course = await createCourse(
      fixture.context,
      lmsCourse({ kind: "PRACTICE", required: false, questions: 1 }),
    );
    await publishVersion(fixture.context, course.version.id, { revision: 0 });
    await assignEnrollments(fixture.context, {
      courseVersionId: course.version.id,
      recipientIds: [recipient.id],
    });
    const enrollmentBefore = await db.enrollment.findFirstOrThrow({
      where: { tenantId: fixture.tenant.id, recipientId: recipient.id },
    });
    assert.equal(enrollmentBefore.learnerUserId, null);
    const email = `${randomUUID()}@example.test`;
    const first = await lmsJson(
      await staff("/lms/invites", "POST", { recipientId: recipient.id, email }),
      201,
    );
    await lmsJson(
      await anonymous("/learn/invite/inspect", "POST", { token: first.token }),
      201,
    );
    const replacement = await lmsJson(
      await staff("/lms/invites", "POST", { recipientId: recipient.id, email }),
      201,
    );
    assert.notEqual(replacement.id, first.id);
    assert.notEqual(replacement.token, first.token);
    const replaced = await db.learnerInvite.findUniqueOrThrow({ where: { id: first.id } });
    assert.ok(replaced.revokedAt);
    assert.equal(replaced.usedAt, null);

    const exchange = { password: LMS_PASSWORD, consentVersion, consent: true };
    const deniedInspect = await lmsJson(
      await anonymous("/learn/invite/inspect", "POST", { token: first.token }),
      410,
    );
    const deniedExchange = await lmsJson(
      await anonymous("/learn/invite/exchange", "POST", { ...exchange, token: first.token }),
      410,
    );
    assert.equal(deniedInspect.code, "INVITE_INVALID");
    assert.equal(deniedExchange.code, "INVITE_INVALID");
    assert.equal(await db.user.count({ where: { email } }), 0);
    assert.equal(await db.learnerProfile.count({ where: { recipientId: recipient.id } }), 0);
    await lmsJson(
      await anonymous("/learn/invite/inspect", "POST", { token: replacement.token }),
      201,
    );
    const response = await anonymous("/learn/invite/exchange", "POST", {
      ...exchange,
      token: replacement.token,
    });
    const session = await lmsJson(response.clone(), 201);
    const learner = lmsHttp(base, {
      origin: process.env.DEMO_ORIGIN!,
      cookie: response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; "),
      "x-csrf-token": session.csrfToken,
    });
    const identity = await lmsJson(await learner("/auth/session"));
    assert.equal(identity.user.role, "LEARNER");
    assert.equal(identity.tenant.id, fixture.tenant.id);
    const profile = await db.learnerProfile.findUniqueOrThrow({
      where: { tenantId_userId: { tenantId: fixture.tenant.id, userId: identity.user.id } },
    });
    assert.equal(profile.recipientId, recipient.id);
    assert.equal(profile.consentVersion, consentVersion);
    const enrollments = await lmsJson(await learner("/learn/enrollments"));
    assert.deepEqual(enrollments.items.map((item: { id: string }) => item.id), [enrollmentBefore.id]);
    const enrollmentAfter = await db.enrollment.findUniqueOrThrow({ where: { id: enrollmentBefore.id } });
    assert.equal(enrollmentAfter.courseVersionId, enrollmentBefore.courseVersionId);
    assert.equal(enrollmentAfter.status, enrollmentBefore.status);
    assert.equal(enrollmentAfter.learnerUserId, identity.user.id);
    const replay = await lmsJson(
      await anonymous("/learn/invite/exchange", "POST", { ...exchange, token: replacement.token }),
      410,
    );
    assert.equal(replay.code, "INVITE_INVALID");
    const unusedOld = await db.learnerInvite.findUniqueOrThrow({ where: { id: first.id } });
    const usedNew = await db.learnerInvite.findUniqueOrThrow({ where: { id: replacement.id } });
    assert.ok(unusedOld.revokedAt);
    assert.equal(unusedOld.usedAt, null);
    assert.ok(usedNew.usedAt);
    assert.equal(usedNew.revokedAt, null);
    assert.equal(await db.user.count({ where: { email } }), 1);
    assert.equal(await db.learnerProfile.count({ where: { recipientId: recipient.id } }), 1);

    const evidence = resolve("docs/evidence/mvp-all-roles-20261019/run-01/entry/identity");
    await mkdir(evidence, { recursive: true });
    await writeFile(resolve(evidence, "J02-invite-replacement.json"), JSON.stringify({
      status: "PASS",
      startedAt,
      completedAt: new Date().toISOString(),
      database: { host: database.hostname, port: database.port, name: database.pathname.slice(1) },
      transport: "Actual Nest HTTP; invitation create/replacement/inspect/exchange and learner reads; no invite-state DB mutation",
      fixture: "Synthetic tenant, recipient and assigned PRACTICE course; prerequisite setup through fixture/services",
      tenantId: fixture.tenant.id,
      recipientId: recipient.id,
      enrollmentId: enrollmentBefore.id,
      oldInviteId: first.id,
      replacementInviteId: replacement.id,
      checks: {
        firstCreate: 201,
        firstInspectBeforeReplacement: 201,
        replacementCreate: 201,
        oldInspectAfterReplacement: 410,
        oldExchangeAfterReplacement: 410,
        rejectedCode: "INVITE_INVALID",
        rejectedOldExchangeCreatedNoAccountOrProfile: true,
        replacementInspect: 201,
        replacementExchange: 201,
        authenticatedSessionAndAssignedEnrollment: 200,
        replacementReplay: 410,
        oldInviteRevokedAndNeverUsed: true,
        replacementUsedAndNotRevoked: true,
        exactlyOneAccountAndProfile: true,
        originalEnrollmentIdVersionAndStatusPreserved: true,
        consentStored: true,
      },
      limits: "Local synthetic HTTP verification; no email delivery or external service was used",
    }, null, 2));
  } finally {
    await app.close();
    await db.$disconnect();
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { bootstrap } from "../../apps/api/src/main";
import { audit, db } from "../../apps/api/src/core";
import { saveLessonProgress } from "../../apps/api/src/lms/learning";
import {
  startAttempt,
  saveAnswers,
  submitAttempt,
} from "../../apps/api/src/lms/exams";
import {
  claimPreparation,
  prepareClaimedEvent,
} from "../../apps/api/src/regulatory-results/preparation";
import { lmsCourse, lmsTenant, lmsLearner, LMS_PASSWORD } from "./lms-fixture";

test(
  "F4: real HTTP audit records trusted browser actor/source and before-after digests; sanitary preparation records service actor without invented IP",
  { timeout: 60_000 },
  async (t) => {
    process.env.PORT = "0";
    process.env.DEMO_ORIGIN = "http://127.0.0.1:3315";
    process.env.DEMO_LMS_TEST_RUNTIME = "1";
    process.env.DEMO_PROXY_KEY = randomBytes(32).toString("hex");
    process.env.DEMO_TRUSTED_PROXY_IPS = "127.0.0.1,::1";
    const owner = await lmsTenant("scaling audit");
    const learners = [
      await lmsLearner(owner.tenant.id, "audit first"),
      await lmsLearner(owner.tenant.id, "audit second"),
    ];
    const app = await bootstrap();
    t.after(async () => {
      await app.close();
      await db.$disconnect();
    });
    const base = await app.getUrl();
    const started = new Date();
    const trustedIp = "203.0.113.55";
    const proxy = {
      origin: process.env.DEMO_ORIGIN,
      "x-demo-proxy-key": process.env.DEMO_PROXY_KEY,
      "x-demo-client-ip": trustedIp,
    };
    const login = await fetch(base + "/auth/login", {
      method: "POST",
      headers: { ...proxy, "content-type": "application/json" },
      body: JSON.stringify({ email: owner.user.email, password: LMS_PASSWORD }),
    });
    assert.equal(login.status, 201);
    const loginBody = await login.json();
    const cookie = login.headers
      .getSetCookie()
      .map((item) => item.split(";")[0])
      .join("; ");
    const headers = {
      ...proxy,
      cookie,
      "x-csrf-token": loginBody.csrfToken as string,
      "content-type": "application/json",
    };
    const call = (path: string, method = "POST", body?: unknown) =>
      fetch(base + path, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const checked: string[] = [];
    async function browserEvent(
      response: Response,
      action: string,
      entityId: string,
    ) {
      const correlationId = response.headers.get("x-correlation-id");
      assert.ok(correlationId, action);
      const events = await db.auditEvent.findMany({
        where: { tenantId: owner.tenant.id, correlationId, action },
      });
      assert.equal(events.length, 1, action);
      const event = events[0];
      assert.equal(event.actorId, owner.user.id, action);
      assert.equal(event.entityId, entityId, action);
      assert.ok(
        event.createdAt >= started && event.createdAt <= new Date(),
        action,
      );
      const metadata = event.metadata as Record<string, unknown>;
      assert.equal(metadata.source, "browser", action);
      assert.equal(metadata.requestSource, "browser", action);
      assert.equal(metadata.trustedIp, trustedIp, action);
      checked.push(action);
      return { event, metadata };
    }
    await browserEvent(login, "AUTH_LOGIN", owner.user.id);
    const definition = lmsCourse({ sanitary: true, questions: 1 });
    const createdResponse = await call("/lms/courses", "POST", definition);
    assert.equal(
      createdResponse.status,
      201,
      await createdResponse.clone().text(),
    );
    const created = await createdResponse.json();
    await browserEvent(
      createdResponse,
      "LMS_COURSE_CREATED",
      created.course.id,
    );
    const content = {
      ...created.version.content,
      descriptionRu: "Synthetic revised description for audit",
    };
    const savedResponse = await call(
      `/lms/course-versions/${created.version.id}`,
      "PUT",
      {
        revision: created.version.revision,
        content,
        profile: created.version.profile,
      },
    );
    assert.equal(savedResponse.status, 200, await savedResponse.clone().text());
    const saved = await savedResponse.json();
    const savedAudit = await browserEvent(
      savedResponse,
      "LMS_COURSE_SAVED",
      saved.id,
    );
    const change = savedAudit.metadata as {
      before: { revision: number; contentHash: string; profileHash: string };
      after: { revision: number; contentHash: string; profileHash: string };
    };
    assert.equal(change.after.revision, change.before.revision + 1);
    assert.notEqual(change.before.contentHash, change.after.contentHash);
    for (const digest of [
      change.before.contentHash,
      change.after.contentHash,
      change.before.profileHash,
      change.after.profileHash,
    ])
      assert.match(digest, /^[a-f0-9]{64}$/);
    const publishedResponse = await call(
      `/lms/course-versions/${saved.id}/publish`,
      "POST",
      { revision: saved.revision },
    );
    assert.equal(
      publishedResponse.status,
      201,
      await publishedResponse.clone().text(),
    );
    await browserEvent(publishedResponse, "LMS_VERSION_PUBLISHED", saved.id);
    const pause = await call(
      `/lms/courses/${created.course.id}/pause`,
      "POST",
      { paused: true, reason: "Synthetic manual pause" },
    );
    assert.equal(pause.status, 201, await pause.clone().text());
    const pauseAudit = await browserEvent(
      pause,
      "LMS_COURSE_PAUSED",
      created.course.id,
    );
    assert.deepEqual(pauseAudit.metadata.before, {
      paused: false,
      reason: null,
    });
    assert.deepEqual(pauseAudit.metadata.after, {
      paused: true,
      reason: "Synthetic manual pause",
    });
    const review = await call(
      `/lms/courses/${created.course.id}/regulatory-review`,
      "POST",
      { status: "CHANGED", note: "Synthetic human review" },
    );
    assert.equal(review.status, 201, await review.clone().text());
    const reviewAudit = await browserEvent(
      review,
      "LMS_REGULATORY_REVIEWED",
      created.course.id,
    );
    assert.equal(reviewAudit.metadata.before, null);
    assert.deepEqual(reviewAudit.metadata.after, {
      status: "CHANGED",
      note: "Synthetic human review",
    });
    const resume = await call(
      `/lms/courses/${created.course.id}/pause`,
      "POST",
      { paused: false, reason: "" },
    );
    assert.equal(resume.status, 201, await resume.clone().text());
    await browserEvent(resume, "LMS_COURSE_RESUMED", created.course.id);
    const operationId = randomUUID();
    const assignment = await call("/lms/enrollments", "POST", {
      courseVersionId: saved.id,
      recipientIds: learners.map((learner) => learner.recipient.id),
      operationId,
    });
    assert.equal(assignment.status, 201, await assignment.clone().text());
    const assigned = await assignment.json();
    assert.equal(assigned.created, 2);
    const chunkAudit = await browserEvent(
      assignment,
      "LMS_ASSIGNMENT_CHUNK",
      operationId,
    );
    assert.deepEqual(chunkAudit.metadata.before, { cursor: 0 });
    assert.deepEqual(chunkAudit.metadata.after, {
      cursor: 2,
      state: "COMPLETED",
    });
    assert.ok(assigned.groupId);
    await browserEvent(assignment, "LMS_GROUP_CREATED", assigned.groupId);
    const logout = await call("/auth/logout");
    assert.equal(logout.status, 201, await logout.clone().text());
    await browserEvent(logout, "AUTH_LOGOUT", owner.user.id);
    await assert.rejects(
      db.auditEvent.update({
        where: { id: savedAudit.event.id },
        data: { action: "FORGED" },
      }),
      /immutable/i,
    );
    await assert.rejects(
      db.auditEvent.delete({ where: { id: savedAudit.event.id } }),
      /immutable/i,
    );
    assert.deepEqual(
      await db.auditEvent.findUniqueOrThrow({
        where: { id: savedAudit.event.id },
      }),
      savedAudit.event,
    );

    // One real eligible result and one real lease claim; no worker lifecycle or provider connection.
    const enrollment = assigned.items.find(
      (item: { recipientId: string }) =>
        item.recipientId === learners[0].recipient.id,
    );
    await saveLessonProgress(learners[0].context, enrollment.id, "lesson-1", {
      sequence: 1,
      acknowledge: true,
    });
    const attempt = await startAttempt(learners[0].context, enrollment.id);
    await saveAnswers(learners[0].context, attempt.id, {
      sequence: 1,
      answers: { [attempt.questions[0].id]: ["a"] },
    });
    await submitAttempt(learners[0].context, attempt.id);
    const result = await db.verifiedExamResult.findFirstOrThrow({
      where: { tenantId: owner.tenant.id, attemptId: attempt.id },
    });
    assert.equal(result.eligible, true);
    const outbox = await db.regulatoryOutbox.findFirstOrThrow({
      where: { tenantId: owner.tenant.id, resultId: result.id },
    });
    const claimTime = new Date("1900-01-01T00:00:00Z");
    await db.regulatoryOutbox.update({
      where: { id: outbox.id },
      data: { availableAt: claimTime },
    });
    const claim = await claimPreparation(claimTime);
    assert.equal(claim?.id, outbox.id);
    const prepared = await prepareClaimedEvent(
      claim!.id,
      claim!.leaseToken,
      claimTime,
    );
    assert.ok("batchId" in prepared && prepared.batchId);
    const service = await db.auditEvent.findFirstOrThrow({
      where: {
        tenantId: owner.tenant.id,
        action: "SANITARY_PREPARED",
        correlationId: outbox.id,
      },
    });
    assert.equal(service.actorId, "service:integration-worker");
    assert.equal(service.entityId, prepared.batchId);
    assert.ok(service.createdAt >= started && service.createdAt <= new Date());
    const serviceMetadata = service.metadata as Record<string, unknown>;
    assert.equal(serviceMetadata.source, "integration-worker");
    assert.equal(serviceMetadata.requestSource, "integration-worker");
    assert.equal("trustedIp" in serviceMetadata, false);
    assert.deepEqual(serviceMetadata.resultIds, [result.id]);
    const businessCorrelation = randomUUID();
    await audit(
      db,
      {
        ...owner.context,
        source: "browser",
        trustedIp,
        correlationId: businessCorrelation,
      },
      "SYNTHETIC_BUSINESS_SOURCE_PRESERVED",
      assigned.groupId,
      {
        source: "PARTICIPANT_SCOPE",
        before: { count: 0 },
        after: { count: 2 },
      },
    );
    const businessEvent = await db.auditEvent.findFirstOrThrow({
      where: { tenantId: owner.tenant.id, correlationId: businessCorrelation },
    });
    assert.deepEqual(businessEvent.metadata, {
      source: "PARTICIPANT_SCOPE",
      requestSource: "browser",
      trustedIp,
      before: { count: 0 },
      after: { count: 2 },
    });
    const all = JSON.stringify(
      await db.auditEvent.findMany({ where: { tenantId: owner.tenant.id } }),
    );
    for (const secret of [
      LMS_PASSWORD,
      owner.user.passwordHash,
      cookie,
      loginBody.csrfToken,
      process.env.DEMO_PROXY_KEY,
      "correctOptionIds",
      '"answers"',
      "Synthetic revised description for audit",
    ])
      assert.ok(
        !all.includes(secret),
        "audit must exclude secrets and full teaching content",
      );
    t.diagnostic(
      `browser actions=${checked.join(",")}; service=SANITARY_PREPARED; businessSourcePreserved=true; appendOnly=true; sensitiveAuditFieldsAbsent=true; owner=lms-tz-scaling-20261015 apiPid=${process.pid}`,
    );
  },
);

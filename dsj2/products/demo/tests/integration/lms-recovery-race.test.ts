import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { passwordMatches } from "../../apps/api/src/auth";
import { db, hash, type DemoRequest } from "../../apps/api/src/core";
import {
  createLearnerRecovery,
  recoverLearner,
} from "../../apps/api/src/lms/identity";
import { lmsLearner, lmsTenant } from "./lms-fixture";

test(
  "two different recovery tokens cannot both replace the same learner password",
  { timeout: 30_000 },
  async () => {
    const { tenant, context } = await lmsTenant("recovery-race");
    const learner = await lmsLearner(tenant.id, "recovery-race");
    const tokens = await Promise.all([
      createLearnerRecovery(context, { userId: learner.user.id }),
      createLearnerRecovery(context, { userId: learner.user.id }),
    ]);
    await db.session.create({
      data: {
        id: hash(randomUUID()),
        tenantId: tenant.id,
        userId: learner.user.id,
        csrfHash: hash(randomUUID()),
        sessionVersion: learner.user.sessionVersion,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    let signalLocked!: () => void;
    let release!: () => void;
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });
    const releaseLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT id FROM "User" WHERE id=${learner.user.id} FOR UPDATE`;
        signalLocked();
        await releaseLock;
      },
      { timeout: 15_000 },
    );
    await locked;
    const passwords = [
      "Synthetic-recovery-first-20261015!",
      "Synthetic-recovery-second-20261015!",
    ];
    const requests = tokens.map(({ token }, i) =>
      recoverLearner(
        {
          ip: `synthetic-${randomUUID()}`,
          socket: {remoteAddress: "127.0.0.1"},
          headers: {},
          correlationId: randomUUID(),
        } as DemoRequest,
        { token, password: passwords[i] },
      ),
    );
    const resultsPromise = Promise.allSettled(requests);
    try {
      // Hold the shared user row while both independently hashed credentials reach
      // the transaction. This deterministically exercises overlapping recoveries.
      await delay(1000);
    } finally {
      release();
      await blocker;
    }
    const results = await resultsPromise;
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected?.status === "rejected");
    assert.equal(rejected.reason.getStatus(), 410);
    assert.equal(rejected.reason.getResponse().code, "RECOVERY_INVALID");
    const winner = results.findIndex((result) => result.status === "fulfilled");
    const saved = await db.user.findUniqueOrThrow({
      where: { id: learner.user.id },
    });
    assert.equal(saved.sessionVersion, learner.user.sessionVersion + 1);
    assert.equal(
      await passwordMatches(passwords[winner], saved.passwordHash),
      true,
    );
    assert.equal(
      await passwordMatches(passwords[1 - winner], saved.passwordHash),
      false,
    );
    assert.equal(
      await db.session.count({ where: { userId: learner.user.id } }),
      0,
    );
    assert.equal(
      await db.learnerRecovery.count({
        where: { userId: learner.user.id, usedAt: null },
      }),
      0,
    );
    assert.equal(
      await db.auditEvent.count({
        where: {
          tenantId: tenant.id,
          action: "LMS_PASSWORD_RECOVERED",
          entityId: learner.user.id,
        },
      }),
      1,
    );
  },
);

test.after(async () => {
  await db.$disconnect();
});

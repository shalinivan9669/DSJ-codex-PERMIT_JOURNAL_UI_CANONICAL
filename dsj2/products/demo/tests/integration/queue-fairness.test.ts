import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../apps/api/src/core";
import { claimJob, heartbeat } from "../../apps/render-worker/src/queue";
import { assertTestDatabase } from "./test-database";

test("older eligible deferred bundle precedes newer bulk while future schedules and fences remain enforced", async () => {
  assertTestDatabase();
  let testTenantId: string | undefined;
  try {
    const tenant = await db.tenant.create({
      data: { name: "Synthetic queue fairness" },
    });
    testTenantId = tenant.id;
    const user = await db.user.create({
      data: {
        tenantId: tenant.id,
        email: `${randomUUID()}@example.test`,
        displayName: "Test",
        role: "ADMIN",
        passwordHash: "not-a-login",
      },
    });
    const profile = await db.issuerProfileVersion.create({
      data: {
        tenantId: tenant.id,
        version: 1,
        profile: {},
        createdBy: user.id,
      },
    });
    const request = await db.printRequest.create({
      data: {
        tenantId: tenant.id,
        kind: "PERSON",
        draft: {},
        createdBy: user.id,
        demoMode: true,
      },
    });
    const snapshot = await db.renderInputSnapshot.create({
      data: {
        tenantId: tenant.id,
        requestId: request.id,
        revision: 0,
        profileVersionId: profile.id,
        input: {},
        inputHash: randomUUID(),
      },
    });
    const now = Date.now();
    async function job(kind: string, createdAgo: number, runOffset: number) {
      return db.generationJob.create({
        data: {
          tenantId: tenant.id,
          requestId: request.id,
          snapshotId: snapshot.id,
          kind,
          logicalKey: randomUUID(),
          createdAt: new Date(now - createdAgo),
          runAfter: new Date(now + runOffset),
        },
      });
    }
    const future = await job("PDF", 120000, 60000);
    const oldBundle = await job("ZIP", 90000, -1000);
    const bulk = await job("DOCX", 20000, -20000);
    const first = await claimJob(db, "fair-first", tenant.id);
    assert.equal(first?.id, oldBundle.id);
    assert.equal(first.attempts, 1);
    assert.equal(first.fencingToken, 1);
    assert.equal(await heartbeat(db, first, "fair-first"), true);
    assert.equal(
      await heartbeat(db, { ...first, fencingToken: 0 }, "fair-first"),
      false,
    );
    const second = await claimJob(db, "fair-second", tenant.id);
    assert.equal(second?.id, bulk.id);
    assert.equal(await claimJob(db, "nothing-ready", tenant.id), null);
    await db.generationJob.update({
      where: { id: future.id },
      data: { runAfter: new Date(0) },
    });
    assert.equal(
      (await claimJob(db, "future-now-ready", tenant.id))?.id,
      future.id,
    );
  } finally {
    // These claims test scheduling without running a renderer. Release only
    // this fixture's leases so later global GC checks see their own workers.
    if (testTenantId)
      await db.generationJob.updateMany({
        where: { tenantId: testTenantId, status: "RUNNING" },
        data: {
          status: "FAILED",
          errorCode: "TEST_COMPLETE",
          leaseOwner: null,
          leaseUntil: null,
        },
      });
    await db.$disconnect();
  }
});

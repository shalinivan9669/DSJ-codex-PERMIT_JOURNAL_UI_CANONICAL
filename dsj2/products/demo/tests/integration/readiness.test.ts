import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { bootstrap } from "../../apps/api/src/main";
import { db } from "../../apps/api/src/core";
import { provision } from "../../scripts/setup";
import { RENDERER_VERSION } from "../../packages/printing/src";
import { assertTestDatabase } from "./test-database";

test("readiness verifies the latest installed template, including multi-digit version labels", async () => {
  assertTestDatabase();
  process.env.PORT = "0";
  process.env.DEMO_ORIGIN = "http://localhost:3100";
  const password = "Synthetic-Readiness-Password!";
  const user = await provision({
    email: `ready-${randomUUID()}@example.test`,
    password,
    name: "Синтетическая проверка готовности",
    sample: true,
  });
  const app = await bootstrap();
  const owner = `ready-test-${randomUUID()}`;
  try {
    await db.workerHeartbeat.create({
      data: { id: owner, version: RENDERER_VERSION, seenAt: new Date() },
    });
    const origin = await app.getUrl();
    const login = await fetch(`${origin}/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: process.env.DEMO_ORIGIN,
      },
      body: JSON.stringify({ email: user.email, password }),
    });
    assert.equal(login.status, 201);
    const cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const ready = () => fetch(`${origin}/ready`, { headers: { cookie } });
    assert.equal((await ready()).status, 200);
    const templates = await db.templateVersion.findMany({
      where: { tenantId: user.tenantId },
    });
    const current = templates.find((row) => Number(row.version) >= 10);
    assert.ok(
      current,
      "The regression requires a multi-digit installed version",
    );
    const old = await db.templateVersion.create({
      data: {
        tenantId: user.tenantId,
        templateId: current.templateId,
        version: "7",
        checksum: current.checksum,
        storageKey: `synthetic-missing-old-${randomUUID()}`,
        approved: true,
        contract: {},
        createdAt: new Date(current.createdAt.getTime() - 1000),
      },
    });
    assert.equal(
      (await ready()).status,
      200,
      "An older label7 must not shadow the readable current multi-digit template",
    );
    await db.templateVersion.create({
      data: {
        tenantId: user.tenantId,
        templateId: current.templateId,
        version: "2",
        checksum: current.checksum,
        storageKey: `synthetic-missing-current-${randomUUID()}`,
        approved: true,
        contract: { previousVersionId: old.id },
        createdAt: new Date(current.createdAt.getTime() + 1000),
      },
    });
    const missingLatest = await ready();
    assert.equal(missingLatest.status, 503);
    assert.equal((await missingLatest.json()).code, "STORAGE_NOT_READY");
  } finally {
    await db.workerHeartbeat.deleteMany({ where: { id: owner } });
    await app.close();
    await db.$disconnect();
  }
});

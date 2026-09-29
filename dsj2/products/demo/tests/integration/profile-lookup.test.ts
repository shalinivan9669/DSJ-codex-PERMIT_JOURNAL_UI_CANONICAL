import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { bootstrap } from "../../apps/api/src/main";
import { db, hash } from "../../apps/api/src/core";
import { assertTestDatabase } from "./test-database";

test("pinned profile lookup reaches older versions and keeps existing role and tenant boundaries", async () => {
  assertTestDatabase();
  process.env.PORT = "0";
  const app = await bootstrap();
  const base = await app.getUrl();
  try {
    const tenant = await db.tenant.create({
      data: { name: "Synthetic pinned profile lookup", demoOnly: true },
    });
    const foreign = await db.tenant.create({
      data: { name: "Synthetic foreign profile lookup", demoOnly: true },
    });
    const profile = {
      nameRu: "Synthetic issuer",
      nameKz: "",
      cityRu: "",
      cityKz: "",
      addressRu: "",
      addressKz: "",
      approvalBasis: "",
      commission: [],
      approved: false,
    };
    const sessions = new Map<string, string>();
    for (const role of ["ADMIN", "OPERATOR", "VIEWER", "EMPLOYER"]) {
      const user = await db.user.create({
        data: {
          tenantId: tenant.id,
          email: `profile-${role}-${randomUUID()}@example.test`,
          displayName: `Synthetic ${role}`,
          passwordHash: "unused in session fixture",
          role,
        },
      });
      const token = randomBytes(32).toString("hex");
      await db.session.create({
        data: {
          id: hash(token),
          tenantId: tenant.id,
          userId: user.id,
          sessionVersion: user.sessionVersion,
          csrfHash: hash(randomBytes(32).toString("hex")),
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      sessions.set(role, `demo_session=${token}`);
    }
    const versions = Array.from({ length: 105 }, (_, index) => ({
      id: randomUUID(),
      tenantId: tenant.id,
      version: index + 1,
      profile: { ...profile, commissionTitle: `Version ${index + 1}` },
      createdBy: "synthetic fixture",
    }));
    await db.issuerProfileVersion.createMany({ data: versions });
    const foreignProfile = await db.issuerProfileVersion.create({
      data: {
        tenantId: foreign.id,
        version: 1,
        profile,
        createdBy: "synthetic fixture",
      },
    });
    const call = (query: string, role?: string) =>
      fetch(`${base}/settings/profiles${query}`, {
        headers: role ? { cookie: sessions.get(role)! } : {},
      });
    for (const role of ["ADMIN", "OPERATOR", "VIEWER"]) {
      const list = await call("", role);
      assert.equal(list.status, 200);
      const recent = await list.json();
      assert.equal(recent.items.length, 100);
      assert.equal(
        recent.items.some((item: { id: string }) => item.id === versions[0].id),
        false,
      );
      const old = await call(`?versionId=${versions[0].id}`, role);
      assert.equal(old.status, 200);
      const result = await old.json();
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].id, versions[0].id);
      assert.equal(result.items[0].version, 1);
      assert.equal(result.items[0].profile.commissionTitle, "Version 1");
      for (const id of [foreignProfile.id, randomUUID()]) {
        const denied = await call(`?versionId=${id}`, role);
        assert.equal(denied.status, 404);
        const body = await denied.json();
        assert.equal(body.code, "PROFILE_NOT_FOUND");
        assert.equal(body.items, undefined);
      }
    }
    assert.equal((await call(`?versionId=${versions[0].id}`)).status, 401);
    assert.equal(
      (await call(`?versionId=${versions[0].id}`, "EMPLOYER")).status,
      403,
    );
    for (const query of [
      "?versionId=not-a-uuid",
      `?versionId=${versions[0].id}&tenantId=${foreign.id}`,
      `?versionId=${versions[0].id}&versionId=${versions[1].id}`,
    ]) {
      const response = await call(query, "ADMIN");
      assert.equal(response.status, 400);
      assert.equal((await response.json()).code, "VALIDATION");
    }
    assert.equal(
      await db.issuerProfileVersion.count({ where: { tenantId: tenant.id } }),
      105,
    );
  } finally {
    // Immutable test profiles remain in this UUID-scoped disposable tenant.
    await app.close();
    await db.$disconnect();
  }
});

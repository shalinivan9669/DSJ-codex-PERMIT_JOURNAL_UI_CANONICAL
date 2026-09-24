import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { bootstrap } from "../../apps/api/src/main";
import { db } from "../../apps/api/src/core";
import { passwordHash } from "../../apps/api/src/auth";
import { staffDirectorySchema } from "../../packages/contracts/src/staff-directory";
import { assertTestDatabase } from "./test-database";

test("staff directory exposes only active own staff names to operators and preserves admin user management", async (t) => {
  assertTestDatabase();
  process.env.PORT = "0";
  process.env.DEMO_ORIGIN = "http://localhost:3100";
  const app = await bootstrap();
  t.after(async () => {
    await app.close();
    await db.$disconnect();
  });
  const base = await app.getUrl();
  const own = await db.tenant.create({
    data: { name: "Staff directory test" },
  });
  const foreign = await db.tenant.create({
    data: { name: "Foreign private staff" },
  });
  const password = "Staff-directory-synthetic-test!";
  const digest = await passwordHash(password);
  const definitions = [
    ["ownAdmin", own.id, "ADMIN", true],
    ["ownOperator", own.id, "OPERATOR", true],
    ["inactiveAdmin", own.id, "ADMIN", false],
    ["inactiveOperator", own.id, "OPERATOR", false],
    ["ownViewer", own.id, "VIEWER", true],
    ["ownEmployer", own.id, "EMPLOYER", true],
    ["foreignAdmin", foreign.id, "ADMIN", true],
    ["foreignOperator", foreign.id, "OPERATOR", true],
  ] as const;
  const users = await Promise.all(
    definitions.map(([displayName, tenantId, role, active]) =>
      db.user.create({
        data: {
          tenantId,
          email: `${randomUUID()}@example.test`,
          displayName,
          role,
          active,
          passwordHash: digest,
        },
      }),
    ),
  );
  const [admin, operator, , , viewer, employer, foreignAdmin, foreignOperator] =
    users;
  async function login(user: (typeof users)[number]) {
    const result = await fetch(base + "/auth/login", {
      method: "POST",
      headers: {
        origin: process.env.DEMO_ORIGIN!,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: user.email, password }),
    });
    assert.equal(result.status, 201);
    return result.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
  }
  const adminCookie = await login(admin);
  const operatorCookie = await login(operator);
  const request = (path: string, cookie: string) =>
    fetch(base + path, { headers: { cookie } });
  const expected = [admin, operator].map(({ id, displayName }) => ({
    id,
    displayName,
  }));
  for (const cookie of [operatorCookie, adminCookie]) {
    const result = await request("/staff-directory", cookie);
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("cache-control"), "no-store");
    const body = await result.json();
    assert.deepEqual(staffDirectorySchema.parse(body), { items: expected });
    assert.deepEqual(Object.keys(body), ["items"]);
    assert.ok(
      body.items.every(
        (row: Record<string, unknown>) =>
          Object.keys(row).sort().join(",") === "displayName,id",
      ),
    );
  }
  const forged = await request(
    `/staff-directory?tenantId=${foreign.id}&role=ADMIN&active=false`,
    operatorCookie,
  );
  assert.equal(forged.status, 200);
  assert.deepEqual(await forged.json(), { items: expected });
  const opposite = await request(
    "/staff-directory",
    await login(foreignOperator),
  );
  assert.equal(opposite.status, 200);
  assert.deepEqual(await opposite.json(), {
    items: [foreignAdmin, foreignOperator].map(({ id, displayName }) => ({
      id,
      displayName,
    })),
  });
  for (const user of [viewer, employer]) {
    const denied = await request("/staff-directory", await login(user));
    assert.equal(denied.status, 403);
    const error = JSON.stringify(await denied.json());
    assert.ok(!users.some((staff) => error.includes(staff.email)));
    assert.ok(!error.includes(admin.id));
  }
  assert.equal((await request("/staff-directory", "")).status, 401);
  assert.equal((await request("/users", operatorCookie)).status, 403);
  const managed = await request("/users", adminCookie);
  assert.equal(managed.status, 200);
  const managedBody = await managed.json();
  const ownUsers = users.filter((user) => user.tenantId === own.id);
  assert.deepEqual(
    managedBody.items.map((user: { id: string }) => user.id).sort(),
    ownUsers.map((user) => user.id).sort(),
  );
  for (const user of ownUsers) {
    assert.deepEqual(
      managedBody.items.find((row: { id: string }) => row.id === user.id),
      {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        active: user.active,
        disabled: !user.active,
      },
    );
  }
  assert.equal(
    (
      await fetch(base + "/staff-directory", {
        method: "POST",
        headers: { cookie: operatorCookie, origin: process.env.DEMO_ORIGIN! },
      })
    ).status,
    404,
  );
});

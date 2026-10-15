import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { db, hash } from "../../apps/api/src/core";
import { bootstrap } from "../../apps/api/src/main";
import {
  lmsTenant,
  lmsHttp,
  lmsJson,
  LMS_PASSWORD,
} from "../../tests/integration/lms-fixture";
import { assertTestDatabase } from "../../tests/integration/test-database";

async function main() {
  assertTestDatabase();
  const current = new URL(process.env.DATABASE_URL!);
  assert.equal(current.hostname, "127.0.0.1");
  assert.equal(current.port, "55449");
  assert.equal(current.password, "");
  if (process.argv[2] !== "run") {
    const database = `demo_test_lms_unknown_role_${randomUUID().replaceAll("-", "")}`;
    const admin = new URL(current);
    admin.pathname = "/postgres";
    admin.search = "";
    const target = new URL(current);
    target.pathname = `/${database}`;
    assert.match(database, /^demo_test_lms_unknown_role_[a-f0-9]{32}$/);
    execFileSync(
      process.env.DEMO_PSQL!,
      [
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-d",
        admin.toString(),
        "-c",
        `CREATE DATABASE "${database}"`,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    const env = {
      ...process.env,
      DATABASE_URL: target.toString(),
      LMS_UNKNOWN_ROLE_CREATED: database,
    };
    execFileSync(
      process.execPath,
      [
        path.resolve("packages/database/node_modules/prisma/build/index.js"),
        "migrate",
        "deploy",
        "--schema",
        "packages/database/prisma/schema.prisma",
      ],
      { env, encoding: "utf8", windowsHide: true, timeout: 120_000 },
    );
    const output = execFileSync(
      process.execPath,
      [
        "node_modules/tsx/dist/cli.mjs",
        "--tsconfig",
        "tsconfig.base.json",
        "scripts/verification/lms-unknown-role.ts",
        "run",
      ],
      { env, encoding: "utf8", windowsHide: true, timeout: 60_000 },
    );
    console.log(output.trim());
    return;
  }
  assert.match(current.pathname, /^\/demo_test_lms_unknown_role_[a-f0-9]{32}$/);
  assert.equal(current.pathname.slice(1), process.env.LMS_UNKNOWN_ROLE_CREATED);
  const center = await lmsTenant("unknown role isolated HTTP");
  const userData = {
    tenantId: center.tenant.id,
    email: `${randomUUID()}@example.test`,
    displayName: "Synthetic unknown role",
    passwordHash: center.user.passwordHash,
    role: "FUTURE_UNKNOWN_ROLE",
  };
  let roleCheckRejected = false;
  await assert.rejects(db.user.create({ data: userData }), (error: any) => {
    roleCheckRejected =
      String(error).includes("23514") && String(error).includes("user_role");
    return roleCheckRejected;
  });
  const constraints = await db.$queryRaw<
    Array<{ definition: string }>
  >`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='"User"'::regclass AND conname='user_role'`;
  assert.equal(constraints.length, 1);
  await db.$executeRawUnsafe('ALTER TABLE "User" DROP CONSTRAINT "user_role"');
  let unknownId: string | undefined;
  let app: Awaited<ReturnType<typeof bootstrap>> | undefined;
  const routes: { method: string; route: string; status: number }[] = [];
  try {
    const unknown = await db.user.create({ data: userData });
    unknownId = unknown.id;
    process.env.PORT = "0";
    process.env.HOST = "127.0.0.1";
    process.env.DEMO_ORIGIN = "http://127.0.0.1:31996";
    app = await bootstrap();
    const base = await app.getUrl();
    const login = await lmsHttp(base, { origin: process.env.DEMO_ORIGIN })(
      "/auth/login",
      "POST",
      { email: unknown.email, password: LMS_PASSWORD },
    );
    assert.equal(login.status, 401);
    routes.push({ method: "POST", route: "/auth/login", status: login.status });
    const token = randomBytes(32).toString("hex"),
      csrf = randomBytes(32).toString("hex");
    await db.session.create({
      data: {
        id: hash(token),
        tenantId: center.tenant.id,
        userId: unknown.id,
        csrfHash: hash(csrf),
        sessionVersion: unknown.sessionVersion,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const call = lmsHttp(base, {
      origin: process.env.DEMO_ORIGIN,
      cookie: `demo_session=${token}`,
      "x-csrf-token": csrf,
    });
    for (const route of [
      "/context",
      "/lms/courses",
      "/lms/sanitary/subjects",
      "/learn/enrollments",
      "/recipients",
      "/print-requests",
      "/settings/profile",
      `/artifacts/${randomUUID()}`,
    ]) {
      const response = await call(route);
      assert.equal(response.status, 403, route);
      routes.push({ method: "GET", route, status: response.status });
    }
    await lmsJson(await call("/lms/courses", "POST", {}), 403);
    routes.push({ method: "POST", route: "/lms/courses", status: 403 });
    assert.equal(
      await db.course.count({ where: { tenantId: center.tenant.id } }),
      0,
    );
  } finally {
    await app?.close();
    if (unknownId) {
      await db.session.deleteMany({ where: { userId: unknownId } });
      await db.user.delete({ where: { id: unknownId } });
    }
    await db.$executeRawUnsafe(
      `ALTER TABLE "User" ADD CONSTRAINT "user_role" ${constraints[0].definition}`,
    );
  }
  const restored = await db.$queryRaw<
    Array<{ definition: string }>
  >`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='"User"'::regclass AND conname='user_role'`;
  assert.deepEqual(restored, constraints);
  console.log(
    JSON.stringify({
      status: "PASS",
      measuredAt: new Date().toISOString(),
      database: current.pathname.slice(1),
      freshMigrations:
        await db.$queryRaw`SELECT count(*)::int AS count FROM "_prisma_migrations"`,
      roleCheckRejected23514: roleCheckRejected,
      fixtureBoundary:
        "Only the newly created named disposable DB temporarily removed user_role to exercise unsupported-role HTTP defense; no shared database or migration was altered. Unknown user/session removed and original constraint restored in finally.",
      roleCheckRestored: true,
      routes,
    }),
  );
}
main()
  .finally(() => db.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

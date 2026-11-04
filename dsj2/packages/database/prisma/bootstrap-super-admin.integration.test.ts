import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { compare } from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { bootstrapSuperAdmin, isVerifiedFreshBaseline, readBootstrapCredentials } from "./bootstrap-super-admin-lib";

test("bootstrap validates credentials without displaying their values", () => {
  assert.throws(() => readBootstrapCredentials({ BOOTSTRAP_ADMIN_EMAIL: "bad" }));
  assert.throws(() => readBootstrapCredentials({
    BOOTSTRAP_ADMIN_EMAIL: "admin@example.test",
    BOOTSTRAP_ADMIN_PASSWORD: "weak",
  }));
  assert.throws(() => readBootstrapCredentials({
    BOOTSTRAP_ADMIN_EMAIL: "admin@example.test",
    BOOTSTRAP_ADMIN_PASSWORD: "A1!" + "a".repeat(70),
  }));
});

test("bootstrap rejects old, altered, incomplete, rolled-back, or additional migration history", () => {
  const good = { migration_name: "202611040000_fresh_baseline", checksum: "match", finished_at: new Date(), rolled_back_at: null };
  assert.equal(isVerifiedFreshBaseline([good], "match"), true);
  assert.equal(isVerifiedFreshBaseline([], "match"), false);
  assert.equal(isVerifiedFreshBaseline([{ ...good, migration_name: "old-history" }], "match"), false);
  assert.equal(isVerifiedFreshBaseline([good], "different"), false);
  assert.equal(isVerifiedFreshBaseline([{ ...good, finished_at: null }], "match"), false);
  assert.equal(isVerifiedFreshBaseline([{ ...good, rolled_back_at: new Date() }], "match"), false);
  assert.equal(isVerifiedFreshBaseline([good, good], "match"), false);
});

const testDatabaseUrl = process.env.BOOTSTRAP_TEST_DATABASE_URL;

test("only a fresh empty database admits one bootstrap and rejects business data or concurrent attempts", { skip: !testDatabaseUrl }, async () => {
  const parsed = new URL(testDatabaseUrl!);
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname) || parsed.pathname !== "/codex_bootstrap_test_guard") {
    throw new Error("Bootstrap integration test requires the explicitly named local disposable database.");
  }

  const prisma = new PrismaClient({ datasourceUrl: testDatabaseUrl });
  const credentials = readBootstrapCredentials({
    BOOTSTRAP_ADMIN_EMAIL: `bootstrap-${randomBytes(8).toString("hex")}@example.test`,
    BOOTSTRAP_ADMIN_PASSWORD: `Aa1!${randomBytes(24).toString("hex")}`,
  });
  let mayCleanUpOwnTestUser = false;
  const testCompanyId = `bootstrap-guard-${randomBytes(8).toString("hex")}`;
  const fakeMigrationId = randomUUID();
  let companyCreated = false;
  let fakeMigrationCreated = false;
  try {
    assert.equal(await prisma.user.count(), 0, "test database must start with no users");
    mayCleanUpOwnTestUser = true;
    await prisma.$executeRaw`INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, started_at, applied_steps_count) VALUES (${fakeMigrationId}, ${"0".repeat(64)}, now(), ${"synthetic_foreign_history"}, now(), 1)`;
    fakeMigrationCreated = true;
    await assert.rejects(() => bootstrapSuperAdmin(prisma, credentials), /migration history/);
    assert.equal(await prisma.user.count(), 0);
    await prisma.$executeRaw`DELETE FROM "_prisma_migrations" WHERE id = ${fakeMigrationId}`;
    fakeMigrationCreated = false;
    await prisma.company.create({ data: { id: testCompanyId, name: "Synthetic bootstrap guard" } });
    companyCreated = true;
    await assert.rejects(() => bootstrapSuperAdmin(prisma, credentials), /contains application data/);
    assert.equal(await prisma.user.count(), 0);
    await prisma.company.delete({ where: { id: testCompanyId } });
    companyCreated = false;
    const outcomes = await Promise.allSettled([
      bootstrapSuperAdmin(prisma, credentials),
      bootstrapSuperAdmin(prisma, credentials),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);

    const created = await prisma.user.findUniqueOrThrow({ where: { email: credentials.email } });
    assert.equal(created.role, "SUPER_ADMIN");
    assert.equal(created.companyId, null);
    assert.equal(await compare(credentials.password, created.passwordHash), true);
    await assert.rejects(() => bootstrapSuperAdmin(prisma, credentials), /contains application data/);
    assert.equal(await prisma.user.count(), 1);
    const unchanged = await prisma.user.findUniqueOrThrow({ where: { email: credentials.email } });
    assert.equal(unchanged.passwordHash, created.passwordHash);
  } finally {
    if (fakeMigrationCreated) {
      await prisma.$executeRaw`DELETE FROM "_prisma_migrations" WHERE id = ${fakeMigrationId}`;
    }
    if (companyCreated) {
      await prisma.company.delete({ where: { id: testCompanyId } });
    }
    if (mayCleanUpOwnTestUser) {
      await prisma.user.deleteMany({ where: { email: credentials.email } });
    }
    await prisma.$disconnect();
  }
});

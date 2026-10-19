import { randomBytes } from "node:crypto";
import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { db } from "../../apps/api/src/core";
import { passwordHash } from "../../apps/api/src/auth";
import { lmsLearner, lmsTenant } from "../../tests/integration/lms-fixture";

async function main() {
  const target = new URL(process.env.DATABASE_URL || "");
  if (
    target.hostname !== "127.0.0.1" ||
    target.port !== "55479" ||
    target.pathname !== "/demo_test_lms_pass01_browser"
  )
    throw new Error("OWNED_BROWSER_DATABASE_REQUIRED");
  const output = resolve(
    process.env.DEMO_LMS_PASS01_FIXTURE ||
      ".runtime/lms-pass01-20261018/browser-fixture.json",
  );
  try {
    await access(output);
    throw new Error("FIXTURE_ALREADY_EXISTS");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const { tenant, user } = await lmsTenant("Pass01 browser synthetic"),
    learner = await lmsLearner(tenant.id, "Pass01 browser");
  const users: Record<
    string,
    { id: string; email: string; password: string; recipientId?: string }
  > = {};
  for (const [key, existing, role] of [
    ["director", user, "DIRECTOR"],
    ["learner", learner.user, "LEARNER"],
    ["teacher", null, "TEACHER"],
    ["methodist", null, "METHODIST"],
    ["expert", null, "EXPERT"],
  ] as const) {
    const password = `Local-${randomBytes(20).toString("hex")}!`;
    const account = existing
      ? await db.user.update({
          where: { id: existing.id },
          data: { passwordHash: await passwordHash(password) },
        })
      : await db.user.create({
          data: {
            tenantId: tenant.id,
            role,
            email: `${key}-${randomBytes(6).toString("hex")}@example.test`,
            displayName: `Учебная проверка · ${key}`,
            passwordHash: await passwordHash(password),
          },
        });
    users[key] = {
      id: account.id,
      email: account.email,
      password,
      ...(key === "learner" ? { recipientId: learner.recipient.id } : {}),
    };
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        baseUrl: process.env.DEMO_ORIGIN,
        apiBase: process.env.DEMO_API_ORIGIN,
        tenantId: tenant.id,
        users,
      },
      null,
      2,
    ),
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      fixture: output,
      synthetic: true,
      credentials: "private file only",
    }),
  );
}
main().finally(() => db.$disconnect());

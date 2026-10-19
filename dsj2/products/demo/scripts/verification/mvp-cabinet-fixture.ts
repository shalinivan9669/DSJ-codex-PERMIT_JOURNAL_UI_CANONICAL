import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../../apps/api/src/core";
import { passwordHash } from "../../apps/api/src/auth";

const url = new URL(process.env.DATABASE_URL || "");
if (url.hostname !== "127.0.0.1" || url.port !== "55489" || url.pathname !== "/demo_test_mvp_roles_20261019_run01_browser") throw new Error("OWN_MVP_BROWSER_DATABASE_REQUIRED");
async function main() {
  const sourcePath = path.resolve(process.env.DEMO_MVP_FIXTURE || ".runtime/mvp-all-roles-20261019/run-01/browser-fixture.json");
  const source = JSON.parse(await readFile(sourcePath, "utf8"));
  const output = path.join(path.dirname(sourcePath), "cabinet-fixture.json");
  const users: Record<string, { id: string; email: string; role: string; password: string }> = {};
  // Dedicated disposable accounts: changing passwords never revokes another acceptance run's session.
  for (const key of ["superAdmin", "admin", "director", "operator", "viewer", "methodist", "teacher", "expert", "learner", "employer"]) {
    const role = source.users[key].role;
    const email = `mvp-cabinet-${key.toLowerCase()}@example.test`;
    const password = `Cabinet-${randomBytes(18).toString("base64url")}!`;
    const digest = await passwordHash(password);
    const user = await db.user.upsert({ where: { email }, create: { tenantId: source.tenantId, email, passwordHash: digest, displayName: `Приёмка кабинета ${role}`, role }, update: { passwordHash: digest, active: true, sessionVersion: { increment: 1 } } });
    await db.session.deleteMany({ where: { userId: user.id, tenantId: source.tenantId } });
    users[key] = { id: user.id, email, role, password };
    if (role === "LEARNER") {
      const linked = await db.learnerProfile.findUnique({ where: { tenantId_userId: { tenantId: source.tenantId, userId: user.id } } });
      if (!linked) {
        const recipient = await db.recipient.create({ data: { tenantId: source.tenantId, data: { fullNameRu: "Синтетический слушатель кабинета", fullNameKz: "Кабинеттің синтетикалық тыңдаушысы" } } });
        await db.learnerProfile.create({ data: { tenantId: source.tenantId, userId: user.id, recipientId: recipient.id, consentVersion: "lms-personal-data-2026-10-15-v1", consentAt: new Date() } });
      }
    }
    if (role === "EMPLOYER" && !await db.employerMembership.findFirst({ where: { tenantId: source.tenantId, userId: user.id, customerId: source.organizations.a1 } })) {
      await db.employerMembership.create({ data: { tenantId: source.tenantId, userId: user.id, customerId: source.organizations.a1, permissions: ["READ", "ASSIGN_TRAINING", "DOWNLOAD"], createdBy: source.users.superAdmin.id } });
    }
  }
  await writeFile(output, JSON.stringify({ tenantId: source.tenantId, users }, null, 2));
  console.log(JSON.stringify({ fixture: output, syntheticAccounts: Object.keys(users).length }));
}
void main().finally(() => db.$disconnect());

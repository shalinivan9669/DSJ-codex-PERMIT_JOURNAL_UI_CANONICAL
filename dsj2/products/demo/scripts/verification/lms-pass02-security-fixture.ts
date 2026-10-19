import { writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "../../apps/api/src/core";
import { passwordHash } from "../../apps/api/src/auth";
import { lmsTenant, LMS_PASSWORD } from "../../tests/integration/lms-fixture";
const target = new URL(process.env.DATABASE_URL || "");
if (
  target.hostname !== "127.0.0.1" ||
  target.pathname !== "/demo_test_lms_pass02_browser"
)
  throw new Error("OWN_BROWSER_DATABASE_REQUIRED");
async function main() {
  const fixture = await lmsTenant(`pass02 MFA browser ${Date.now()}`);
  const operator = await db.user.create({
    data: {
      tenantId: fixture.tenant.id,
      email: `${randomUUID()}@example.test`,
      displayName: "Synthetic MFA operator",
      role: "OPERATOR",
      passwordHash: await passwordHash(LMS_PASSWORD),
    },
  });
  const output = path.resolve(
    ".runtime/lms-pass02-operations-20261018/security-browser-fixture.json",
  );
  await writeFile(
    output,
    JSON.stringify(
      {
        tenantId: fixture.tenant.id,
        users: {
          director: { email: fixture.user.email, password: LMS_PASSWORD },
          operator: { email: operator.email, password: LMS_PASSWORD },
        },
      },
      null,
      2,
    ),
  );
  process.stdout.write(
    JSON.stringify({
      fixturePath: output,
      syntheticTenantId: fixture.tenant.id,
    }) + "\n",
  );
}
void main().finally(() => db.$disconnect());

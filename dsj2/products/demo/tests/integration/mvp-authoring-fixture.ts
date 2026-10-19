import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { db } from "../../apps/api/src/core";
import { passwordHash } from "../../apps/api/src/auth";
import { assertTestDatabase } from "./test-database";

async function main() {
  assertTestDatabase();
  const url = new URL(process.env.DATABASE_URL!);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55489" ||
    url.pathname !== "/demo_test_mvp_roles_20261019_run01_browser"
  )
    throw new Error("ISOLATED_MVP_BROWSER_ONLY");
  const file = process.env.DEMO_MVP_FIXTURE!;
  const fixture = JSON.parse(await readFile(file, "utf8"));
  for (const [key, role] of [
    ["authorMethodist", "METHODIST"],
    ["authorAdmin", "ADMIN"],
  ] as const) {
    const password = `Synthetic-author-${randomUUID()}!`;
    const row = await db.user.create({
      data: {
        tenantId: fixture.tenantId,
        email: `author-${role.toLowerCase()}-${randomUUID()}@example.test`,
        displayName: `Синтетический автор ${role}`,
        role,
        passwordHash: await passwordHash(password),
      },
    });
    fixture.users[key] = { id: row.id, email: row.email, password, role };
  }
  await writeFile(file, JSON.stringify(fixture, null, 2));
  console.log(
    "Isolated authoring accounts prepared; credentials retained only in the private fixture.",
  );
}
void main().finally(() => db.$disconnect());

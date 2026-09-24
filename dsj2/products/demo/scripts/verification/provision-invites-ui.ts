import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { provision } from "../setup";
import { db } from "../../apps/api/src/core";
import { assertTestDatabase } from "../../tests/integration/test-database";
async function main() {
  assertTestDatabase();
  const email = `invites-ui-${randomUUID()}@example.test`;
  const password = `Synthetic-${randomUUID()}!`;
  const user = await provision({
    email,
    password,
    name: "Синтетическая проверка приглашений",
    sample: true,
  });
  await mkdir(resolve(".runtime"), { recursive: true });
  await writeFile(
    resolve(".runtime/invites-ui-auth.json"),
    JSON.stringify({ email, password, tenantId: user.tenantId }),
  );
  console.log(JSON.stringify({ status: "READY", tenantId: user.tenantId }));
}
void main().finally(() => db.$disconnect());

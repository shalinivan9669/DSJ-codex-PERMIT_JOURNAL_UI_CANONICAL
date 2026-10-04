import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { provision } from "../setup";
import { db } from "../../apps/api/src/core";
import { assertTestDatabase } from "../../tests/integration/test-database";
import { finalApprovalActors } from "./final-approval-actors";

async function main() {
  assertTestDatabase();
  const email = `final-service-${randomUUID()}@example.test`;
  const password = `Synthetic-${randomUUID()}!`;
  const user = await provision({
    email,
    password,
    name: "Синтетический центр финальной проверки услуг",
    sample: true,
  });
  const directory = process.argv.includes("--directory");
  const director = await finalApprovalActors({
    ...user,
    role: "DIRECTOR",
    sessionId: "fixture",
    csrfHash: "fixture",
    correlationId: randomUUID(),
  });
  let directoryData: Record<string, unknown> = {};
  if (directory) {
    const customers = Array.from({ length: 101 }, (_, index) => ({
      id: randomUUID(),
      tenantId: user.tenantId,
      nameRu: `Поиск компании ${String(index + 1).padStart(3, "0")}`,
      bin: String(index + 1).padStart(12, "0"),
    }));
    await db.customerOrganization.createMany({ data: customers });
    const people = customers.map((customer, index) => ({
      id: randomUUID(),
      tenantId: user.tenantId,
      data: {
        fullNameRu: `Поиск человека ${String(index + 1).padStart(3, "0")}`,
        fullNameKz: "Ә Ғ Қ Ң Ө Ұ Ү Һ І",
        employerId: customer.id,
        workplaceRu: customer.nameRu,
        personnelNumber: String(index + 1).padStart(6, "0"),
        assignments: [],
      },
    }));
    await db.recipient.createMany({ data: people });
    directoryData = { customer: customers[100], person: people[100] };
  }
  const file = resolve(
    directory
      ? ".runtime/final-directory-ui-auth.json"
      : ".runtime/final-service-ui-auth.json",
  );
  await mkdir(resolve(".runtime"), { recursive: true });
  await writeFile(
    file,
    JSON.stringify({
      email,
      password,
      tenantId: user.tenantId,
      userId: user.userId,
      director,
      ...directoryData,
    }),
  );
  console.log(JSON.stringify({ status: "READY", tenantId: user.tenantId }));
}
void main().finally(() => db.$disconnect());

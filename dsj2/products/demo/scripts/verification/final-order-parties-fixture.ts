import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { provision } from "../setup";
import { db, type Context } from "../../apps/api/src/core";
import { createRequest } from "../../apps/api/src/requests";
import { createServiceOrder } from "../../apps/api/src/operator-value";
import { draftSchema } from "../../packages/contracts/src";
import { assertTestDatabase } from "../../tests/integration/test-database";
import { finalApprovalActors } from "./final-approval-actors";

async function main() {
  assertTestDatabase();
  const email = `order-parties-${randomUUID()}@example.test`,
    password = `Synthetic-${randomUUID()}!`;
  const identity = await provision({
    email,
    password,
    name: "Синтетический центр проверки сторон заказа",
    sample: true,
  });
  const c: Context = {
    ...identity,
    role: "DIRECTOR",
    sessionId: "fixture",
    csrfHash: "fixture",
    correlationId: randomUUID(),
  };
  await finalApprovalActors(c);
  const parties = await Promise.all(
    [
      "Заказчик А — три стороны",
      "Плательщик Б — три стороны",
      "Работодатель В — три стороны",
      "Другой работодатель Г — отказ",
    ].map((nameRu) =>
      db.customerOrganization.create({
        data: { tenantId: identity.tenantId, nameRu },
      }),
    ),
  );
  const eventId = randomUUID();
  const request = await createRequest(
    c,
    draftSchema.parse({
      kind: "COMPANY",
      demoMode: true,
      schemaVersion: 2,
      title: "Три отдельные организации",
      customerId: parties[0].id,
      events: [
        {
          id: eventId,
          title: "Событие работодателя В",
          protocolTemplateId: "pb-protocol",
          commonFields: { trainingSubject: "Синтетическая программа" },
        },
      ],
      items: [
        {
          id: randomUUID(),
          employerId: parties[2].id,
          fullNameRu: "Синтетический сотрудник работодателя В",
          assignments: [
            {
              id: randomUUID(),
              templateId: "pb-card",
              protocolMode: "GROUP",
              eventId,
              outcome: { status: "UNKNOWN", source: "" },
            },
          ],
        },
      ],
    }),
  );
  const order = await createServiceOrder(c, {
    title: "Заказ А для работодателя В",
    customerId: parties[0].id,
    requestIds: [request.id],
  });
  await writeFile(
    ".runtime/final-order-parties-auth.json",
    JSON.stringify(
      {
        email,
        password,
        ...identity,
        parties,
        requestId: request.id,
        orderId: order.id,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      status: "PREPARED",
      tenantId: identity.tenantId,
      requestId: request.id,
      orderId: order.id,
    }),
  );
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

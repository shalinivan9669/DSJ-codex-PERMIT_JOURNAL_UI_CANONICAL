import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db, type Context } from "../../apps/api/src/core";
import { createCourse, publishVersion } from "../../apps/api/src/lms/courses";
import {
  lmsCourse,
  LMS_FIXTURE_VERSION,
} from "../../tests/integration/lms-fixture";
import { assertTestDatabase } from "../../tests/integration/test-database";
import { draftSchema } from "../../packages/contracts/src";

async function main() {
  assertTestDatabase();
  const target = new URL(process.env.DATABASE_URL!);
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.pathname, "/demo_test_lms_browser_20261015");
  const user = await db.user.findUniqueOrThrow({
    where: {
      email:
        process.env.DEMO_ADMIN_EMAIL || "lms-director-20261015@example.test",
    },
  });
  const tenant = await db.tenant.findUniqueOrThrow({
    where: { id: user.tenantId },
  });
  assert.equal(tenant.demoOnly, true);
  const context: Context = {
    tenantId: tenant.id,
    userId: user.id,
    role: user.role,
    sessionId: "synthetic-setup",
    csrfHash: "",
    correlationId: randomUUID(),
  };
  const course = await createCourse(context, lmsCourse());
  await publishVersion(context, course.version.id, { revision: 0 });
  const groups = [];
  for (const count of [1, 10, 100, 250]) {
    const organization = await db.customerOrganization.create({
      data: {
        tenantId: tenant.id,
        nameRu: `Синтетическая группа ${count} ${randomUUID().slice(0, 8)}`,
      },
    });
    const people = Array.from({ length: count }, (_, index) => ({
      id: randomUUID(),
      name: `Синтетический ${count} Участник ${String(index + 1).padStart(3, "0")}`,
    }));
    await db.recipient.createMany({
      data: people.map((person) => ({
        id: person.id,
        tenantId: tenant.id,
        data: {
          id: person.id,
          fullNameRu: person.name,
          fullNameKz: `Синтетикалық ${person.name}`,
          positionRu: "Работник",
          positionKz: "Қызметкер",
          assignments: [],
        },
      })),
    });
    if (count > 1)
      await db.recipientEmployment.createMany({
        data: people.slice(0, -1).map((person) => ({
          tenantId: tenant.id,
          recipientId: person.id,
          employerId: organization.id,
          createdBy: user.id,
        })),
      });
    const draft = draftSchema.parse({
      kind: "COMPANY",
      customerId: organization.id,
      title: `Синтетическое назначение ${count}`,
      demoMode: true,
      items: people.map((person) => ({
        id: randomUUID(),
        recipientId: person.id,
        fullNameRu: person.name,
        positionRu: "Работник",
        positionKz: "Қызметкер",
        assignments: [],
      })),
    });
    const request = await db.printRequest.create({
      data: {
        tenantId: tenant.id,
        kind: "COMPANY",
        customerId: organization.id,
        title: draft.title,
        draft: JSON.parse(JSON.stringify(draft)),
        itemCount: count,
        demoMode: true,
        createdBy: user.id,
      },
    });
    groups.push({
      count,
      requestId: request.id,
      customerId: organization.id,
      people,
      errorPerson: people.at(-1)!,
    });
  }
  const directory = path.resolve(".runtime/lms-one-run");
  const ambiguousName = `Синтетический однофамилец ${randomUUID().slice(0, 8)}`;
  const ambiguousPeople = [
    { id: randomUUID(), position: "Электрик" },
    { id: randomUUID(), position: "Сварщик" },
  ];
  await db.recipient.createMany({
    data: ambiguousPeople.map((person) => ({
      id: person.id,
      tenantId: tenant.id,
      data: {
        id: person.id,
        fullNameRu: ambiguousName,
        fullNameKz: ambiguousName,
        positionRu: person.position,
        assignments: [],
      },
    })),
  });
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "assignment-fixture.json"),
    JSON.stringify(
      {
        fixtureVersion: LMS_FIXTURE_VERSION,
        tenantId: tenant.id,
        courseVersionId: course.version.id,
        groups,
        ambiguous: { name: ambiguousName, people: ambiguousPeople },
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      fixtureVersion: LMS_FIXTURE_VERSION,
      groups: groups.map((group) => group.count),
      preparedRecipients: 361,
      expectedErrors: 4,
    }),
  );
}
main().finally(() => db.$disconnect());

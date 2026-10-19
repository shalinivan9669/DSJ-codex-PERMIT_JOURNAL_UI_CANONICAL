import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { db } from "../../apps/api/src/core";
import { passwordHash } from "../../apps/api/src/auth";
import { createCourse, publishVersion } from "../../apps/api/src/lms/courses";
import {
  lmsTenant,
  lmsCourse,
  lmsLearner,
  LMS_PASSWORD,
} from "../../tests/integration/lms-fixture";
const target = new URL(process.env.DATABASE_URL || "");
if (
  target.hostname !== "127.0.0.1" ||
  !/^\/demo_test_lms_pass02_(?:browser|employer)$/.test(target.pathname)
)
  throw new Error("OWN_PASS02_DISPOSABLE_DATABASE_REQUIRED");
async function main() {
  const center = await lmsTenant("pass02 employer browser");
  const customer = await db.customerOrganization.create({
    data: {
      tenantId: center.tenant.id,
      nameRu: "Синтетический работодатель для проверки",
      nameKz: "Тексеруге арналған синтетикалық жұмыс беруші",
    },
  });
  const employer = await db.user.create({
    data: {
      tenantId: center.tenant.id,
      email: `${randomUUID()}@example.test`,
      displayName: "Synthetic employer browser",
      role: "EMPLOYER",
      passwordHash: await passwordHash(LMS_PASSWORD),
    },
  });
  await db.employerMembership.create({
    data: {
      tenantId: center.tenant.id,
      customerId: customer.id,
      userId: employer.id,
      permissions: ["READ", "ASSIGN_TRAINING", "DOWNLOAD"],
      createdBy: center.user.id,
    },
  });
  const learner = await lmsLearner(center.tenant.id, "operations browser");
  const people = Array.from({ length: 300 }, (_, index) => ({
    id: randomUUID(),
    tenantId: center.tenant.id,
    data: {
      fullNameRu: `Synthetic existing ${String(index).padStart(3, "0")}`,
      positionRu: "Synthetic worker",
    },
  }));
  await db.recipient.createMany({ data: people });
  await db.recipientEmployment.createMany({
    data: people.map((person) => ({
      tenantId: center.tenant.id,
      recipientId: person.id,
      employerId: customer.id,
      createdBy: center.user.id,
    })),
  });
  const course = await createCourse(
    center.context,
    lmsCourse({ questions: 1, required: false }),
  );
  const version = await publishVersion(center.context, course.version.id, {
    revision: 0,
  });
  const output = path.resolve(
    ".runtime/lms-pass02-operations-20261018/employer-browser-fixture.json",
  );
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(
    output,
    JSON.stringify(
      {
        baseUrl: process.env.DEMO_ORIGIN,
        tenantId: center.tenant.id,
        customerId: customer.id,
        courseVersionId: version.id,
        knownRecipientId: people[0].id,
        users: {
          employer: {
            id: employer.id,
            email: employer.email,
            password: LMS_PASSWORD,
          },
          director: {
            id: center.user.id,
            email: center.user.email,
            password: LMS_PASSWORD,
          },
          learner: {
            id: learner.user.id,
            email: learner.user.email,
            password: LMS_PASSWORD,
          },
        },
      },
      null,
      2,
    ),
  );
  process.stdout.write(
    JSON.stringify({
      fixturePath: output,
      tenantId: center.tenant.id,
      syntheticPeople: 301,
    }) + "\n",
  );
}
void main().finally(() => db.$disconnect());

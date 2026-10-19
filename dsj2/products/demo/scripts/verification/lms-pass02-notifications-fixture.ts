import { writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "../../apps/api/src/core";
import { passwordHash } from "../../apps/api/src/auth";
import { createCourse, publishVersion } from "../../apps/api/src/lms/courses";
import { runAssignmentChunk } from "../../apps/api/src/lms/assignment-operations";
import {
  lmsTenant,
  lmsLearner,
  lmsCourse,
  LMS_PASSWORD,
} from "../../tests/integration/lms-fixture";
const target = new URL(process.env.DATABASE_URL || "");
if (
  target.hostname !== "127.0.0.1" ||
  target.pathname !== "/demo_test_lms_pass02_browser"
)
  throw new Error("OWN_BROWSER_DATABASE_REQUIRED");
async function main() {
  const center = await lmsTenant(`pass02 inbox browser ${Date.now()}`),
    learner = await lmsLearner(center.tenant.id, "notification browser");
  const course = await createCourse(center.context, lmsCourse());
  await publishVersion(center.context, course.version.id, { revision: 0 });
  const customer = await db.customerOrganization.create({
    data: {
      tenantId: center.tenant.id,
      nameRu: "Synthetic inbox browser customer",
    },
  });
  const employer = await db.user.create({
    data: {
      tenantId: center.tenant.id,
      email: `${randomUUID()}@example.test`,
      displayName: "Synthetic inbox browser employer",
      role: "EMPLOYER",
      passwordHash: await passwordHash(LMS_PASSWORD),
    },
  });
  const membership = await db.employerMembership.create({
    data: {
      tenantId: center.tenant.id,
      userId: employer.id,
      customerId: customer.id,
      permissions: ["READ"],
      createdBy: center.user.id,
    },
  });
  await db.recipientEmployment.create({
    data: {
      tenantId: center.tenant.id,
      recipientId: learner.recipient.id,
      employerId: customer.id,
      createdBy: center.user.id,
    },
  });
  const assigned = await runAssignmentChunk(center.context, {
    courseVersionId: course.version.id,
    recipientIds: [learner.recipient.id],
    customerId: customer.id,
    operationId: randomUUID(),
  });
  if (assigned.errors.length || assigned.conflicts)
    throw new Error("SYNTHETIC_INBOX_ASSIGNMENT_NOT_CREATED");
  const enrollment = await db.enrollment.findFirstOrThrow({
    where: { tenantId: center.tenant.id, recipientId: learner.recipient.id },
  });
  // Explicit synthetic inbox history makes pagination measurable; actual ASSIGNED still comes through the real worker.
  await db.lmsLearningNotification.createMany({
    data: [learner.user, employer].flatMap((user) =>
      Array.from({ length: 26 }, (_, index) => ({
        tenantId: center.tenant.id,
        userId: user.id,
        enrollmentId: enrollment.id,
        sourceType: "ENROLLMENT",
        sourceId: enrollment.id,
        kind: "ASSIGNED",
        deliveryKey: `SYNTHETIC-PAGINATION:${index}:${enrollment.id}`,
        titleRu: `Синтетическое событие ${String(index + 1).padStart(2, "0")}`,
        titleKz: `Синтетикалық оқиға ${String(index + 1).padStart(2, "0")}`,
        href:
          user.role === "LEARNER"
            ? `/learn/${enrollment.id}`
            : `/lms/results?courseVersionId=${course.version.id}`,
      })),
    ),
  });
  const output = path.resolve(
    ".runtime/lms-pass02-operations-20261018/notifications-browser-fixture.json",
  );
  await writeFile(
    output,
    JSON.stringify(
      {
        tenantId: center.tenant.id,
        enrollmentId: enrollment.id,
        membershipId: membership.id,
        users: {
          director: { email: center.user.email, password: LMS_PASSWORD },
          employer: { email: employer.email, password: LMS_PASSWORD },
          learner: { email: learner.user.email, password: LMS_PASSWORD },
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
      syntheticPaginationRows: 52,
      actualAssignmentEvents: 2,
    }) + "\n",
  );
}
void main().finally(() => db.$disconnect());

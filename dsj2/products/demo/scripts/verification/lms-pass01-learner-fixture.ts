import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "../../apps/api/src/core";
import { lmsLearner, LMS_PASSWORD } from "../../tests/integration/lms-fixture";

async function main() {
  const target = new URL(process.env.DATABASE_URL || "");
  if (
    target.hostname !== "127.0.0.1" ||
    target.port !== "55479" ||
    target.pathname !== "/demo_test_lms_pass01_browser"
  )
    throw new Error("OWNED_BROWSER_DATABASE_REQUIRED");
  const source = resolve(process.env.DEMO_LMS_PASS01_FIXTURE!);
  const fixture = JSON.parse(await readFile(source, "utf8"));
  if (process.argv.includes("--expire-completed")) {
    const learned = JSON.parse(
      await readFile(
        resolve(".runtime/lms-pass01-20261018/browser-learner.json"),
        "utf8",
      ),
    );
    const enrollment = await db.enrollment.findFirstOrThrow({
      where: {
        id: learned.enrollmentId,
        tenantId: fixture.tenantId,
        recipientId: fixture.users.learner.recipientId,
      },
    });
    await db.lmsLearningCompletion.findUniqueOrThrow({
      where: {
        tenantId_enrollmentId: {
          tenantId: fixture.tenantId,
          enrollmentId: enrollment.id,
        },
      },
    });
    const dueAt = new Date(Date.now() - 60000);
    await db.enrollment.update({
      where: { id: enrollment.id },
      data: { dueAt, dueAtOverride: true },
    });
    console.log(
      JSON.stringify({
        synthetic: true,
        phase: "controlled expired historical read setup",
        enrollmentId: enrollment.id,
        dueAt,
      }),
    );
    return;
  }
  const runId = randomUUID().slice(0, 8);
  const own = await lmsLearner(fixture.tenantId, `full-chain-${runId}`),
    partner = await lmsLearner(fixture.tenantId, `group-partner-${runId}`);
  const output = resolve(
    process.env.DEMO_LMS_PASS01_LEARNER_OUTPUT ||
      ".runtime/lms-pass01-20261018/browser-learner-fixture.json",
  );
  await writeFile(
    output,
    JSON.stringify(
      {
        ...fixture,
        users: {
          ...fixture.users,
          learner: {
            id: own.user.id,
            email: own.user.email,
            password: LMS_PASSWORD,
            recipientId: own.recipient.id,
          },
        },
        partnerRecipientId: partner.recipient.id,
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

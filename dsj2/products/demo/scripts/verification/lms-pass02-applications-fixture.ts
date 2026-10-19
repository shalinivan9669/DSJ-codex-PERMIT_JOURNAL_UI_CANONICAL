import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { db, type Context } from "../../apps/api/src/core";
import { coursePublicity } from "../../apps/api/src/lms/applications";
import { lmsLearner, LMS_PASSWORD } from "../../tests/integration/lms-fixture";
const target = new URL(process.env.DATABASE_URL || "");
if (
  target.hostname !== "127.0.0.1" ||
  target.pathname !== "/demo_test_lms_pass02_browser"
)
  throw new Error("OWN_BROWSER_DATABASE_REQUIRED");
async function main() {
  const base = path.resolve(".runtime/lms-pass02-operations-20261018");
  const fixture = JSON.parse(
    await readFile(path.join(base, "employer-browser-fixture.json"), "utf8"),
  );
  const user = await db.user.findFirstOrThrow({
    where: { id: fixture.users.director.id, tenantId: fixture.tenantId },
  });
  const c: Context = {
    tenantId: fixture.tenantId,
    userId: user.id,
    role: user.role,
    sessionId: "",
    csrfHash: "",
    correlationId: "applications-browser-fixture",
    source: "SYNTHETIC_LOCAL_FIXTURE",
  };
  const version = await db.courseVersion.findFirstOrThrow({
    where: { id: fixture.courseVersionId, tenantId: fixture.tenantId },
  });
  await coursePublicity(c, version.courseId, {
    enabled: true,
    summaryRu: "Синтетический локальный набор для проверки заявки",
    summaryKz: "Өтінімді тексеруге арналған синтетикалық жергілікті қабылдау",
  });
  const learner = await lmsLearner(
    fixture.tenantId,
    `application browser ${Date.now()}`,
  );
  const result = {
    ...fixture,
    users: {
      ...fixture.users,
      learner: {
        id: learner.user.id,
        email: learner.user.email,
        password: LMS_PASSWORD,
      },
    },
    anonymousBin: String(Date.now()).slice(-12),
  };
  const output = path.join(base, "applications-browser-fixture.json");
  await writeFile(output, JSON.stringify(result, null, 2));
  process.stdout.write(
    JSON.stringify({
      fixturePath: output,
      tenantId: fixture.tenantId,
      publicCourseVersionId: version.id,
    }) + "\n",
  );
}
void main().finally(() => db.$disconnect());

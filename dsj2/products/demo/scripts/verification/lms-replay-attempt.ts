import assert from "node:assert/strict";
import { db } from "../../apps/api/src/core";
import { submitAttempt } from "../../apps/api/src/lms/exams";
import { assertTestDatabase } from "../../tests/integration/test-database";
async function main() {
  assertTestDatabase();
  const input = JSON.parse(process.env.LMS_REPLAY_INPUT || "{}");
  const result = await submitAttempt(input.context, input.attemptId);
  assert.equal(result.result?.id, input.resultId);
  assert.equal(result.finishedAt?.toISOString(), input.deadlineAt);
  const resultCount = await db.verifiedExamResult.count({
    where: { attemptId: input.attemptId },
  });
  const outboxCount = await db.regulatoryOutbox.count({
    where: { resultId: input.resultId },
  });
  console.log(
    JSON.stringify({
      resultId: result.result?.id,
      resultCount,
      outboxCount,
      processId: process.pid,
    }),
  );
}
main()
  .finally(() => db.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

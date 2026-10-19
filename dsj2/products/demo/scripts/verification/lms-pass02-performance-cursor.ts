import { createRequire } from "node:module";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const databaseUrl = new URL(process.env.DATABASE_URL || "postgresql://invalid");
assert.equal(databaseUrl.hostname, "127.0.0.1");
assert.equal(databaseUrl.port, "55479");
assert.match(databaseUrl.pathname, /^\/demo_test_lms_pass02_performance_/);
const root = resolve(process.env.PERF_SOURCE!);
const load = createRequire(resolve(root, "package.json"));
const { db } = load(resolve(root, "apps/api/src/core.ts"));
const { scopedEnrollmentIds } = load(
  resolve(root, "apps/api/src/lms/enrollment-query.ts"),
);
const f = JSON.parse(
  readFileSync(
    resolve(".runtime/lms-pass02-operations-20261018/performance/fixture.json"),
    "utf8",
  ),
);
async function main() {
  let after;
  for (let i = 0; i < 4; i++) {
    const page = await scopedEnrollmentIds(
      f.context,
      { courseVersionId: f.courseVersionId, pageSize: 100 },
      after,
    );
    console.log(
      JSON.stringify({
        i,
        first: page[0],
        last: page.at(-1),
        length: page.length,
      }),
    );
    after = page.at(-1);
  }
  console.log(await db.$queryRaw`SHOW timezone`);
  await db.$disconnect();
}
main();

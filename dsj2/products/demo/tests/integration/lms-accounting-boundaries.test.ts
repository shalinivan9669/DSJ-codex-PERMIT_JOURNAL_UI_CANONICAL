import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import test from "node:test";
import { bootstrap } from "../../apps/api/src/main";
import { db } from "../../apps/api/src/core";
import {
  lmsLearner,
  lmsTenant,
  lmsSession,
  lmsHttp,
  lmsJson,
} from "./lms-fixture";

test("OPS02/L02: confirmed subject accounting and unknown-role denial are enforced through real HTTP", async (t) => {
  process.env.PORT = "0";
  process.env.HOST = "127.0.0.1";
  process.env.DEMO_ORIGIN = "http://127.0.0.1:31995";
  const app = await bootstrap();
  try {
    const base = await app.getUrl();
    const a = await lmsTenant("subject accounting A");
    const b = await lmsTenant("subject accounting B");
    const learner = await lmsLearner(a.tenant.id, "known");
    await lmsLearner(a.tenant.id, "known-second");
    await lmsLearner(b.tenant.id, "foreign-known");
    // Equal names and unknown identity are separate recipient records. They do
    // not become confirmed subjects merely by resembling an existing person.
    await db.recipient.createMany({
      data: Array.from({ length: 3 }, () => ({
        tenantId: a.tenant.id,
        data: learner.recipient.data,
      })),
    });
    await db.recipient.createMany({
      data: Array.from({ length: 7 }, () => ({
        tenantId: b.tenant.id,
        data: { fullNameRu: "Синтетический чужой человек" },
      })),
    });
    const aCall = lmsHttp(base, await lmsSession(base, a.user.email));
    const bCall = lmsHttp(base, await lmsSession(base, b.user.email));
    await t.test(
      "counts use confirmed links only, cannot be redirected to another tenant, and have no people directory",
      async () => {
        const own = await lmsJson(await aCall("/lms/sanitary/subjects"));
        assert.deepEqual(own, {
          operatorName: a.tenant.name,
          confirmedUniqueLearnerSubjects: 2,
          recipientRecords: 5,
          unlinkedRecipientRecords: 3,
          operatorConsolidation: "REQUIRES_OWNER_CONFIRMATION",
        });
        const foreign = await lmsJson(await bCall("/lms/sanitary/subjects"));
        assert.equal(foreign.confirmedUniqueLearnerSubjects, 1);
        assert.equal(foreign.recipientRecords, 8);
        assert.equal(foreign.unlinkedRecipientRecords, 7);
        const redirected = await lmsJson(
          await aCall(
            `/lms/sanitary/subjects?tenantId=${b.tenant.id}&operatorId=${b.tenant.id}`,
          ),
        );
        assert.deepEqual(redirected, own);
        assert.equal(JSON.stringify(own).includes(learner.user.email), false);
        assert.equal(JSON.stringify(own).includes(learner.recipient.id), false);
        const learnerCall = lmsHttp(
          base,
          await lmsSession(base, learner.user.email),
        );
        await lmsJson(await learnerCall("/lms/sanitary/subjects"), 403);
        const employer = await db.user.create({
          data: {
            tenantId: a.tenant.id,
            email: `${randomUUID()}@example.test`,
            displayName: "Synthetic employer",
            passwordHash: a.user.passwordHash,
            role: "EMPLOYER",
          },
        });
        const employerCall = lmsHttp(
          base,
          await lmsSession(base, employer.email),
        );
        await lmsJson(await employerCall("/lms/sanitary/subjects"), 403);
      },
    );
    await t.test(
      "unknown role cannot log in or reuse a valid stored session on new or legacy surfaces",
      async () => {
        const output = execFileSync(
          process.execPath,
          [
            "node_modules/tsx/dist/cli.mjs",
            "--tsconfig",
            "tsconfig.base.json",
            "scripts/verification/lms-unknown-role.ts",
          ],
          {
            cwd: process.cwd(),
            env: process.env,
            encoding: "utf8",
            windowsHide: true,
            timeout: 180_000,
            maxBuffer: 4 * 1024 * 1024,
          },
        );
        const report = JSON.parse(output.trim());
        assert.equal(report.status, "PASS");
        assert.equal(report.roleCheckRestored, true);
        await writeFile(
          "docs/evidence/lms-one-run-20261015/agent-a/UNKNOWN_ROLE_ACCEPTANCE.json",
          JSON.stringify(report, null, 2),
        );
      },
    );
  } finally {
    await app.close();
    await db.$disconnect();
  }
});

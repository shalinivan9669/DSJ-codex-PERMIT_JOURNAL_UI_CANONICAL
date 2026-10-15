import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { bootstrap } from "../../apps/api/src/main";
import { db } from "../../apps/api/src/core";
import {
  lmsCourse,
  lmsTenant,
  lmsLearner,
  lmsSession,
  lmsHttp,
  lmsJson,
} from "./lms-fixture";

test("L08: identical names remain two confirmed people; only explicitly selected Recipient IDs are enrolled", async () => {
  process.env.PORT = "0";
  process.env.DEMO_ORIGIN = "http://localhost:3159";
  const app = await bootstrap();
  const base = await app.getUrl();
  const tenant = await lmsTenant("Ambiguous explicit selection");
  const suffix = randomUUID().slice(0, 8);
  const first = await lmsLearner(tenant.tenant.id, suffix);
  const second = await lmsLearner(tenant.tenant.id, suffix);
  const title = `Синтетический слушатель ${suffix}`;
  try {
    for (const [person, position] of [
      [first, "Электрик"],
      [second, "Сварщик"],
    ] as const) {
      await db.recipient.update({
        where: { id: person.recipient.id },
        data: {
          data: {
            fullNameRu: title,
            fullNameKz: title,
            positionRu: position,
            assignments: [],
          },
        },
      });
    }
    const director = lmsHttp(base, await lmsSession(base, tenant.user.email));
    const created = await lmsJson(
      await director("/lms/courses", "POST", lmsCourse({ kind: "PRACTICE" })),
      201,
    );
    await lmsJson(
      await director(
        `/lms/course-versions/${created.version.id}/publish`,
        "POST",
        { revision: 0 },
      ),
      201,
    );
    const context = await lmsJson(
      await director(
        `/lms/assignment-context?search=${encodeURIComponent(title)}`,
      ),
    );
    assert.equal(context.recipients.length, 2);
    assert.deepEqual(
      new Set(context.recipients.map((r: { id: string }) => r.id)),
      new Set([first.recipient.id, second.recipient.id]),
    );
    assert.deepEqual(
      new Set(
        context.recipients.map(
          (r: { data: { positionRu: string } }) => r.data.positionRu,
        ),
      ),
      new Set(["Электрик", "Сварщик"]),
    );
    const guessed = await director("/lms/enrollments", "POST", {
      courseVersionId: created.version.id,
      fullNameRu: title,
    });
    assert.equal(guessed.status, 400);
    assert.equal(
      await db.enrollment.count({ where: { tenantId: tenant.tenant.id } }),
      0,
    );
    const choose = async (recipientId: string) =>
      lmsJson(
        await director("/lms/enrollments", "POST", {
          courseVersionId: created.version.id,
          recipientIds: [recipientId],
        }),
        201,
      );
    const one = await choose(first.recipient.id);
    assert.equal(one.created, 1);
    assert.equal(one.items[0].learnerUserId, first.user.id);
    assert.equal(
      await db.enrollment.count({
        where: { tenantId: tenant.tenant.id, recipientId: second.recipient.id },
      }),
      0,
    );
    const two = await choose(second.recipient.id);
    assert.equal(two.created, 1);
    assert.equal(two.items[0].learnerUserId, second.user.id);
    assert.notEqual(one.items[0].id, two.items[0].id);
    const replay = await choose(first.recipient.id);
    assert.equal(replay.created, 0);
    assert.equal(replay.duplicates, 1);
    assert.equal(replay.items[0].id, one.items[0].id);
    assert.equal(
      await db.enrollment.count({ where: { tenantId: tenant.tenant.id } }),
      2,
    );
    assert.equal(
      await db.learnerProfile.count({ where: { tenantId: tenant.tenant.id } }),
      2,
    );
    const learner = lmsHttp(base, await lmsSession(base, first.user.email));
    assert.equal(
      (await learner(`/learn/enrollments/${two.items[0].id}`)).status,
      404,
    );
    const directory = resolve("docs/evidence/lms-one-run-20261015/agent-c");
    await mkdir(directory, { recursive: true });
    await writeFile(
      resolve(directory, "AMBIGUOUS_SELECTION_ACCEPTANCE.json"),
      JSON.stringify(
        {
          status: "PASS",
          checkedAt: new Date().toISOString(),
          identicalNames: true,
          explicitDistinctRecipientIds: true,
          availableDisambiguatingField: "positionRu",
          confirmedProfiles: 2,
          guessedNameRequestStatus: guessed.status,
          enrollments: 2,
          replayCreated: 0,
          foreignSameNameEnrollmentStatus: 404,
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
    await db.$disconnect();
  }
});

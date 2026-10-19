import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { Response } from "express";
import { Prisma } from "../../packages/database/src";
import { db } from "../../apps/api/src/core";
import { createCourse } from "../../apps/api/src/lms/courses";
import {
  enrollmentJoins,
  enrollmentPredicate,
  parseEnrollmentQuery,
  scopedEnrollmentIds,
} from "../../apps/api/src/lms/enrollment-query";
import { lmsTenant, lmsCourse } from "./lms-fixture";
import { exportResults } from "../../apps/api/src/lms/results-export";

test("UTC enrollment filters resist non-UTC sessions; real keyset and closed CSV make progress", async (t) => {
  t.after(() => db.$disconnect());
  const { context: c } = await lmsTenant("enrollment-timezone");
  const course = await createCourse(c, lmsCourse({ questions: 1 }));
  const instant = new Date("2026-10-18T05:00:00.000Z");
  const recipients = Array.from({ length: 205 }, () => ({
    id: randomUUID(),
    tenantId: c.tenantId,
    data: { fullNameRu: "Синтетическая проверка UTC" },
  }));
  await db.recipient.createMany({ data: recipients });
  await db.enrollment.createMany({
    data: recipients.map((r) => ({
      tenantId: c.tenantId,
      recipientId: r.id,
      courseVersionId: course.version.id,
      assignedBy: c.userId,
      assignedAt: instant,
      dueAt: instant,
    })),
  });
  for (const timezone of ["UTC", "Asia/Qyzylorda", "America/Los_Angeles"]) {
    await db.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT set_config('TimeZone',${timezone},true)`,
      );
      for (const [filters, expected] of [
        [
          {
            dateFrom: "2026-10-18T05:00:00.000Z",
            dateTo: "2026-10-18T05:00:00.000Z",
          },
          205,
        ],
        [{ dateFrom: "2026-10-18T05:00:00.001Z" }, 0],
        [{ dateTo: "2026-10-18T04:59:59.999Z" }, 0],
        [
          {
            dueFrom: "2026-10-18T05:00:00.000Z",
            dueTo: "2026-10-18T05:00:00.000Z",
          },
          205,
        ],
        [{ dueFrom: "2026-10-18T05:00:00.001Z" }, 0],
        [{ dueTo: "2026-10-18T04:59:59.999Z" }, 0],
      ] as const) {
        const result = await tx.$queryRaw<{ count: bigint }[]>(
          Prisma.sql`SELECT count(*) ${enrollmentJoins} WHERE ${enrollmentPredicate(c, parseEnrollmentQuery(filters))}`,
        );
        assert.equal(
          Number(result[0].count),
          expected,
          `${timezone}: ${JSON.stringify(filters)}`,
        );
      }
    });
  }
  // Exercise the real page function and duplicate prevention under the runner's
  // configured PostgreSQL timezone; filters above explicitly cover three zones.
  let after: { assignedAt: Date; id: string } | undefined;
  const ids = new Set<string>();
  for (let i = 0; i < 4; i++) {
    const page = await scopedEnrollmentIds(
      c,
      { courseVersionId: course.version.id, pageSize: 100 },
      after,
    );
    for (const row of page) {
      assert.equal(ids.has(row.id), false, "cursor must make progress");
      ids.add(row.id);
    }
    if (!page.length) break;
    after = page.at(-1)!;
  }
  assert.equal(ids.size, 205);
  await db.enrollment.updateMany({
    where: { tenantId: c.tenantId, recipientId: recipients[0].id },
    data: { completedAt: instant },
  });
  await db.enrollment.updateMany({
    where: { tenantId: c.tenantId, recipientId: recipients[1].id },
    data: { status: "CANCELLED", completedAt: instant },
  });
  for (const [status, expected] of [
    ["ACTIVE", 203],
    ["COMPLETED", 1],
    ["CANCELLED", 1],
  ] as const) {
    const result = await db.$queryRaw<{ count: bigint }[]>(
      Prisma.sql`SELECT count(*) ${enrollmentJoins} WHERE ${enrollmentPredicate(c, parseEnrollmentQuery({ status }))}`,
    );
    assert.equal(Number(result[0].count), expected, `derived status ${status}`);
  }
  class ClosingResponse extends EventEmitter {
    destroyed = false;
    writes = 0;
    type() {
      return this;
    }
    setHeader() {
      return this;
    }
    write() {
      this.writes++;
      if (this.writes === 1) return true;
      setImmediate(() => {
        this.destroyed = true;
        this.emit("close");
      });
      return false;
    }
    end() {
      this.destroyed = true;
    }
  }
  const response = new ClosingResponse();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      exportResults(
        c,
        {
          filters: { courseVersionId: course.version.id },
          format: "CSV",
          language: "ru",
        },
        response as unknown as Response,
      ),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("CLOSED_EXPORT_DID_NOT_RELEASE")),
          5000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  assert.equal(response.writes, 2, "closed consumer stops the current page");
  assert.equal(response.listenerCount("drain"), 0);
  assert.equal(response.listenerCount("close"), 0);
});

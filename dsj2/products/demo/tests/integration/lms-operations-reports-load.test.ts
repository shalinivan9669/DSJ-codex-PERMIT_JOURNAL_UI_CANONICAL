import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { Prisma } from "../../packages/database/src";
import { ArtifactStore } from "../../packages/printing/src";
import { db, json } from "../../apps/api/src/core";
import { createCourse, publishVersion } from "../../apps/api/src/lms/courses";
import { createReport, reportStatus } from "../../apps/api/src/lms/reports";
import { queryReport } from "../../apps/api/src/lms/report-query";
import {
  claimReport,
  executeReport,
} from "../../apps/api/src/lms/report-worker";
import { lmsCourse, lmsTenant } from "./lms-fixture";
import {
  enrollmentJoins,
  enrollmentPredicate,
  parseEnrollmentQuery,
} from "../../apps/api/src/lms/enrollment-query";

test(
  "N07: bounded 5000-row snapshots and multipage PDF/XLSX/CSV",
  { timeout: 600000 },
  async (t) => {
    t.after(() => db.$disconnect());
    const database = new URL(process.env.DATABASE_URL!);
    assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
    assert.match(database.pathname, /^\/(?:demo_test_lms_pass02_reports|demo_test_mvp_roles_\d{8}_run\d+_integration)$/);
    const directory = resolve(
      process.env.DEMO_REPORTS_TEST_EVIDENCE || ".runtime/lms-pass02-operations-20261018/reports-evidence",
    );
    await mkdir(directory, { recursive: true });
    const center = await lmsTenant("reports-5000"),
      c = center.context,
      course = await createCourse(
        c,
        lmsCourse({ questions: 1, required: false }),
      );
    await publishVersion(c, course.version.id, { revision: 0 });
    const org = await db.customerOrganization.create({
      data: {
        tenantId: c.tenantId,
        nameRu: "Синтетическая организация 5000",
        nameKz: "Синтетикалық ұйым 5000",
        bin: "000000005000",
        city: "Қызылорда",
        citySource: "SYNTHETIC",
      },
    });
    const recipients = Array.from({ length: 5000 }, (_, i) => ({
      id: randomUUID(),
      tenantId: c.tenantId,
      data: json({
        fullNameRu:
          (i === 0 ? "=" : "") +
          `Сотрудник ${String(i).padStart(5, "0")} ӘҒҚҢӨҰҮҺІ`,
        fullNameKz: `Қызметкер ${String(i).padStart(5, "0")} ӘҒҚҢӨҰҮҺІ`,
        positionRu: "Инженер",
      }),
    }));
    for (let offset = 0; offset < recipients.length; offset += 500) {
      const batch = recipients.slice(offset, offset + 500);
      await db.recipient.createMany({ data: batch });
      await db.enrollment.createMany({
        data: batch.map((r) => ({
          tenantId: c.tenantId,
          recipientId: r.id,
          courseVersionId: course.version.id,
          customerId: org.id,
          assignedBy: c.userId,
        })),
      });
    }
    const timings = [];
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      const value = await queryReport(c, {
        kind: "TRAINING",
        filters: { customerId: org.id },
        page: i + 1,
      });
      timings.push(performance.now() - start);
      assert.equal(value.total, 5000);
      assert.equal(value.items.length, 30);
    }
    const predicate = enrollmentPredicate(
      c,
      parseEnrollmentQuery({ customerId: org.id }),
    );
    const plan = await db.$queryRaw(
      Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT e.id ${enrollmentJoins} WHERE ${predicate} ORDER BY e."assignedAt" DESC,e.id DESC LIMIT 30`,
    );
    const exports = [];
    const store = new ArtifactStore();
    for (const format of ["CSV", "XLSX", "PDF"]) {
      const start = performance.now();
      const input = {
        kind: "TRAINING",
        format,
        language: "ru",
        filters: { customerId: org.id },
        requestKey: randomUUID(),
      };
      const [job, duplicate] = await Promise.all([
        createReport(c, input),
        createReport(c, input),
      ]);
      assert.equal(job.id, duplicate.id);
      assert.equal(job.total, 5000);
      const claim = await claimReport("load-" + randomUUID());
      assert.equal(claim?.id, job.id);
      await executeReport(claim!);
      const done = await reportStatus(c, job.id);
      assert.equal(done.status, "READY", JSON.stringify(done));
      const record = await db.lmsReportJob.findUniqueOrThrow({
          where: { id: job.id },
        }),
        bytes = await store.read(record.storageKey!, record.sha256!);
      const file = join(directory, `TRAINING-5000.${format.toLowerCase()}`);
      await writeFile(file, bytes);
      let inspection: unknown;
      if (format === "CSV") {
        assert.equal(
          bytes.toString("utf8").split("\r\n").filter(Boolean).length,
          5001,
        );
        assert.ok(bytes.toString("utf8").includes("'=Сотрудник 00000"));
        inspection = { rows: 5000 };
      } else {
        const script =
          format === "XLSX"
            ? "import sys,json,zipfile,xml.etree.ElementTree as E;z=zipfile.ZipFile(sys.argv[1]);s=E.fromstring(z.read('xl/worksheets/sheet1.xml'));n={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'};print(json.dumps({'rows':len(s.findall('.//s:row',n))-1,'formulas':len(s.findall('.//s:f',n))}))"
            : "import sys,json;from pypdf import PdfReader;r=PdfReader(sys.argv[1]);texts=[p.extract_text() for p in r.pages];text=''.join(texts);print(json.dumps({'pages':len(r.pages),'first':'00000' in text,'last':'04999' in text,'kazakh':'ӘҒҚҢӨҰҮҺІ' in text,'repeatedHeader':sum('Слушатель' in t for t in texts)}))";
        const probe = spawnSync(
          process.env.DEMO_PYTHON!,
          ["-I", "-c", script, file],
          { maxBuffer: 2 * 1024 * 1024 },
        );
        assert.equal(probe.status, 0, probe.stderr.toString());
        inspection = JSON.parse(probe.stdout.toString());
        if (format === "XLSX")
          assert.deepEqual(inspection, { rows: 5000, formulas: 0 });
        else {
          const p = inspection as {
            pages: number;
            first: boolean;
            last: boolean;
            kazakh: boolean;
            repeatedHeader: number;
          };
          assert.ok(p.pages > 1 && p.first && p.last && p.kazakh);
          assert.ok(p.repeatedHeader >= p.pages - 1);
        }
      }
      exports.push({
        format,
        rows: 5000,
        bytes: bytes.length,
        elapsedMs: performance.now() - start,
        sha256: record.sha256,
        inspection,
        file,
      });
    }
    await writeFile(
      join(directory, "load-5000.json"),
      JSON.stringify(
        {
          runAt: new Date(),
          tenantId: c.tenantId,
          organizationId: org.id,
          courseVersionId: course.version.id,
          workload: 5000,
          listQueryTimingsMs: timings,
          plan,
          exports,
          limits: {
            rows: 50000,
            workerChunk: 200,
            outputBytes: 104857600,
            renderTimeoutMs: 120000,
          },
        },
        null,
        2,
      ),
    );
  },
);

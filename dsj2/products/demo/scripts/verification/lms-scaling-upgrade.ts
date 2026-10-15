import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { lmsCourse } from "../../tests/integration/lms-fixture";

const product = process.cwd();
const name = "demo_test_lms_scaling_upgrade2_20261015";
const port = "55449";
const cli = resolve(product, ".runtime/postgresql/pgsql/bin/psql.exe");
const stage = resolve(product, ".runtime/lms-scaling/upgrade2-prisma");
assert.ok(existsSync(cli));
const resumeEmpty = process.argv.includes("--resume-empty");
const resumeBaseline = process.argv.includes("--resume-baseline");
assert.ok(
  !existsSync(stage) || resumeEmpty || resumeBaseline,
  "A retry of the owned staging area requires an explicit resume mode",
);
assert.match(name, /^demo_test_[a-z0-9_]+$/);
const sql = (database: string, query: string) =>
  execFileSync(
    cli,
    [
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-h",
      "127.0.0.1",
      "-p",
      port,
      "-U",
      "postgres",
      "-d",
      database,
      "-t",
      "-A",
      "-f",
      "-",
    ],
    {
      input: query,
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, PGCLIENTENCODING: "UTF8" },
    },
  );
const databaseExists =
  sql(
    "postgres",
    `SELECT count(*) FROM pg_database WHERE datname='${name}'`,
  ).trim() === "1";
if (databaseExists) {
  assert.ok(
    (resumeEmpty || resumeBaseline) && existsSync(stage),
    "Disposable database name must be unused",
  );
  if (resumeEmpty)
    assert.equal(
      sql(
        name,
        "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'",
      ).trim(),
      "0",
      "Empty retry refuses any populated database",
    );
  if (resumeBaseline) {
    assert.equal(
      sql(
        name,
        "SELECT count(*) FROM \"_prisma_migrations\" WHERE migration_name='202610150025_lms_scaling'",
      ).trim(),
      "0",
    );
    assert.equal(
      sql(
        name,
        "SELECT count(*) FROM \"Tenant\" WHERE id='upgrade2-tenant'",
      ).trim(),
      "0",
    );
  }
} else sql("postgres", `CREATE DATABASE "${name}"`);
mkdirSync(stage, { recursive: true });
writeFileSync(
  join(stage, "schema.prisma"),
  execFileSync(
    "git",
    ["show", "HEAD:dsj2/products/demo/packages/database/prisma/schema.prisma"],
    { encoding: "utf8", windowsHide: true },
  ),
);
mkdirSync(join(stage, "migrations"), { recursive: true });
const migrations = resolve(product, "packages/database/prisma/migrations");
for (const item of readdirSync(migrations, { withFileTypes: true })) {
  if (item.name === "202610150025_lms_scaling") continue;
  cpSync(join(migrations, item.name), join(stage, "migrations", item.name), {
    recursive: item.isDirectory(),
  });
}
process.env.DATABASE_URL = `postgresql://postgres@127.0.0.1:${port}/${name}?connection_limit=6`;
const prismaCli = resolve(
  product,
  "packages/database/node_modules/prisma/build/index.js",
);
const migrate = (schema: string) =>
  execFileSync(
    process.execPath,
    [prismaCli, "migrate", "deploy", "--schema", schema],
    { encoding: "utf8", windowsHide: true, env: process.env },
  );
const baselineLog = migrate(join(stage, "schema.prisma"));
const definition = lmsCourse({ questions: 1 });
const literal = (value: unknown) =>
  "'" + JSON.stringify(value).replace(/'/g, "''") + "'::jsonb";
const fixture = `BEGIN;
  INSERT INTO "Tenant" (id,name) VALUES ('upgrade2-tenant','Synthetic upgrade2');
  INSERT INTO "User" (id,"tenantId",email,"displayName","passwordHash",role) VALUES ('upgrade2-user','upgrade2-tenant','upgrade2@example.test','Synthetic','unused','DIRECTOR');
  INSERT INTO "Recipient" (id,"tenantId",data) VALUES ('upgrade2-recipient','upgrade2-tenant','{"fullNameRu":"Synthetic legacy learner"}');
  INSERT INTO "Course" (id,"tenantId","titleRu","titleKz","createdBy") VALUES ('upgrade2-course','upgrade2-tenant','Synthetic old course','Synthetic old course','upgrade2-user');
  INSERT INTO "RegulatoryProfileVersion" (id,"tenantId","courseId",version,status,definition,"snapshotHash") VALUES ('upgrade2-profile','upgrade2-tenant','upgrade2-course',1,'CONFIRMED',${literal(definition.profile)},'legacy-profile-hash');
  INSERT INTO "CourseVersion" (id,"tenantId","courseId",version,status,content,"regulatoryProfileVersionId","snapshotHash","createdBy") VALUES ('upgrade2-version','upgrade2-tenant','upgrade2-course',1,'PUBLISHED',${literal(definition.content)},'upgrade2-profile','legacy-course-hash','upgrade2-user');
  INSERT INTO "Enrollment" (id,"tenantId","courseVersionId","recipientId","groupKey","dueAt","assignedBy") VALUES ('upgrade2-enrollment','upgrade2-tenant','upgrade2-version','upgrade2-recipient','Legacy free text group','2030-01-01','upgrade2-user');
  INSERT INTO "ExamAttempt" (id,"tenantId","enrollmentId","courseVersionId","regulatoryProfileVersionId","assessmentKind",ordinal,state,snapshot,"deadlineAt") VALUES ('upgrade2-attempt','upgrade2-tenant','upgrade2-enrollment','upgrade2-version','upgrade2-profile','PRACTICE',1,'FINISHED',${literal({ questions: definition.content.exam.questions, policy: definition.content.exam, profile: definition.profile })},'2026-10-15');
COMMIT;`;
sql(name, fixture);
const oldFacts = sql(
  name,
  `SELECT json_build_object('course',v.content,'courseHash',v."snapshotHash",'profile',p.definition,'profileHash',p."snapshotHash",'attempt',a.snapshot,'groupKey',e."groupKey")::text FROM "Enrollment" e JOIN "CourseVersion" v ON v.id=e."courseVersionId" JOIN "RegulatoryProfileVersion" p ON p.id=v."regulatoryProfileVersionId" JOIN "ExamAttempt" a ON a."enrollmentId"=e.id WHERE e.id='upgrade2-enrollment'`,
).trim();
const upgradeLog = migrate(
  resolve(product, "packages/database/prisma/schema.prisma"),
);
const newFacts = sql(
  name,
  `SELECT json_build_object('course',v.content,'courseHash',v."snapshotHash",'profile',p.definition,'profileHash',p."snapshotHash",'attempt',a.snapshot,'groupKey',e."groupKey")::text FROM "Enrollment" e JOIN "CourseVersion" v ON v.id=e."courseVersionId" JOIN "RegulatoryProfileVersion" p ON p.id=v."regulatoryProfileVersionId" JOIN "ExamAttempt" a ON a."enrollmentId"=e.id WHERE e.id='upgrade2-enrollment'`,
).trim();
assert.equal(
  oldFacts,
  newFacts,
  "Historical snapshots and legacy group text must remain unchanged",
);
const additive = JSON.parse(
  sql(
    name,
    `SELECT row_to_json(e) FROM (SELECT "groupId","sourceRequestId","sourceOrderId","dueAtOverride" FROM "Enrollment" WHERE id='upgrade2-enrollment') e`,
  ).trim(),
);
assert.deepEqual(additive, {
  groupId: null,
  sourceRequestId: null,
  sourceOrderId: null,
  dueAtOverride: false,
});
assert.equal(sql(name, 'SELECT count(*) FROM "LmsGroup"').trim(), "0");
const evidence = {
  database: name,
  host: "127.0.0.1",
  port,
  result: "PASS",
  baselineMigrations: baselineLog,
  upgradeMigrations: upgradeLog,
  preserved: [
    "CourseVersion.content/snapshotHash",
    "RegulatoryProfileVersion.definition/snapshotHash",
    "ExamAttempt.snapshot",
    "Enrollment.groupKey",
  ],
  additive,
};
writeFileSync(
  join(stage, "upgrade-result.json"),
  JSON.stringify(evidence, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    result: "PASS",
    database: name,
    historicalEnrollment: "preserved",
    snapshots: "preserved",
    inventedOriginsOrGroups: 0,
    evidence: join(stage, "upgrade-result.json"),
  }),
);

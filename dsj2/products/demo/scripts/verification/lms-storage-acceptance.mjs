import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const connection = new URL(process.env.DATABASE_URL || "");
assert.ok(["127.0.0.1", "localhost"].includes(connection.hostname));
assert.equal(
  connection.port,
  "55449",
  "This acceptance targets the separately verified local LMS test server only",
);
assert.match(connection.pathname, /^\/demo_test/);
const stamp = Date.now().toString(36);
const runtime = path.join(
  root,
  ".runtime",
  "lms-one-run",
  `agent-a-storage-${stamp}`,
);
const evidence = path.join(root, "docs/evidence/lms-one-run-20261015/agent-a");
await fs.mkdir(runtime, { recursive: true });
await fs.mkdir(evidence, { recursive: true });
const bin = path.join(root, ".runtime/lms-one-run/postgresql/pgsql/bin");
const env = {
  ...process.env,
  CI: "true",
  DEMO_MAINTENANCE: "1",
  DEMO_PSQL: path.join(bin, "psql.exe"),
  DEMO_PG_DUMP: path.join(bin, "pg_dump.exe"),
  DEMO_PG_RESTORE: path.join(bin, "pg_restore.exe"),
};
const commands = [];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function run(executable, args, extra = {}, capture = true) {
  const startedAt = new Date().toISOString();
  const result = await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: root,
      env: { ...env, ...extra },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = [],
      error = [];
    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => error.push(chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({
        code,
        stdout: Buffer.concat(output),
        stderr: Buffer.concat(error).toString(),
      }),
    );
  });
  commands.push({
    executable: path.basename(executable),
    args: args.map((arg) =>
      arg.length > 300 ? "[bounded synthetic SQL]" : arg,
    ),
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode: result.code,
  });
  if (result.code !== 0)
    throw new Error(
      `${path.basename(executable)} failed: ${result.stderr.slice(0, 1500)}`,
    );
  return capture ? result.stdout.toString().trim() : result.stdout;
}
function urlFor(database) {
  const url = new URL(connection);
  url.pathname = "/" + database;
  return url.toString();
}
function pgEnv(database) {
  return {
    PGHOST: connection.hostname,
    PGPORT: connection.port,
    PGUSER: decodeURIComponent(connection.username),
    PGPASSWORD: decodeURIComponent(connection.password),
    PGDATABASE: database,
  };
}
async function sql(database, statement) {
  return run(
    env.DEMO_PSQL,
    ["-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", statement],
    pgEnv(database),
  );
}
async function createDatabase(name) {
  assert.match(name, /^demo_test_lms_[a-z0-9_]+$/);
  assert.equal(
    await sql(
      "postgres",
      `SELECT count(*) FROM pg_database WHERE datname='${name}'`,
    ),
    "0",
    "Never replace an existing test database",
  );
  await sql("postgres", `CREATE DATABASE "${name}"`);
}
async function migrate(database, schema) {
  return run(
    process.execPath,
    [
      path.join(root, "packages/database/node_modules/prisma/build/index.js"),
      "migrate",
      "deploy",
      "--schema",
      schema,
    ],
    { DATABASE_URL: urlFor(database) },
  );
}
async function oldRowHashes(database) {
  const result = {};
  for (const table of ["Tenant", "User", "Recipient"])
    result[table] = hash(
      await sql(
        database,
        `SELECT to_jsonb(t)::text FROM "${table}" t ORDER BY id`,
      ),
    );
  return result;
}
const report = {
  startedAt: new Date().toISOString(),
  host: connection.hostname,
  port: connection.port,
  baselineRef: "f8a9a663a5fb26454917f84ed8bb8ca62d503e1b",
  syntheticOnly: true,
  checks: [],
};
try {
  // The isolated server is PostgreSQL 16. Use its matching local WSL tools;
  // pg_dump 17 emits transaction_timeout, which PostgreSQL 16 cannot restore.
  // Keep this bridge confined to the disposable acceptance databases.
  assert.equal(
    connection.password,
    "",
    "Local acceptance uses passwordless loopback only",
  );
  const wrapperSource = path.join(runtime, "PgWslTestWrapper.cs");
  await fs.writeFile(
    wrapperSource,
    String.raw`
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
class PgWslTestWrapper {
  static string Quote(string value) {
    if (Regex.IsMatch(value, "^[A-Za-z0-9_./:=+-]+$")) return value;
    var output = new StringBuilder("\""); int slashes = 0;
    foreach (char c in value) {
      if (c == '\\') { slashes++; continue; }
      if (c == '"') { output.Append('\\', slashes * 2 + 1); output.Append(c); slashes = 0; continue; }
      output.Append('\\', slashes); slashes = 0; output.Append(c);
    }
    output.Append('\\', slashes * 2); output.Append('"'); return output.ToString();
  }
  static int Main(string[] args) {
    string tool = Path.GetFileNameWithoutExtension(Environment.GetCommandLineArgs()[0]).Contains("restore") ? "pg_restore" : "pg_dump";
    string host = Environment.GetEnvironmentVariable("PGHOST");
    string port = Environment.GetEnvironmentVariable("PGPORT");
    string database = Environment.GetEnvironmentVariable("PGDATABASE");
    if ((host != "127.0.0.1" && host != "localhost") || port != "55449" || !Regex.IsMatch(database ?? "", "^demo_test_lms_[a-z0-9_]+$") || !String.IsNullOrEmpty(Environment.GetEnvironmentVariable("PGPASSWORD"))) return 90;
    var passed = new List<string> { "--exec", "/usr/bin/env" };
    foreach (string key in new [] { "PGHOST", "PGPORT", "PGUSER", "PGDATABASE", "PGSSLMODE" }) passed.Add(key + "=" + Environment.GetEnvironmentVariable(key));
    passed.Add("/usr/lib/postgresql/16/bin/" + tool);
    foreach (string arg in args) passed.Add(Regex.IsMatch(arg, "^[A-Za-z]:[\\\\/]") ? "/mnt/" + Char.ToLowerInvariant(arg[0]) + arg.Substring(2).Replace('\\', '/') : arg);
    var quoted = new List<string>(); foreach (string arg in passed) quoted.Add(Quote(arg));
    var start = new ProcessStartInfo("wsl.exe", String.Join(" ", quoted.ToArray()));
    start.UseShellExecute = false; start.CreateNoWindow = true;
    start.RedirectStandardOutput = true; start.RedirectStandardError = true;
    using (var process = Process.Start(start)) {
      process.OutputDataReceived += (s, e) => { if (e.Data != null) Console.Out.WriteLine(e.Data); };
      process.ErrorDataReceived += (s, e) => { if (e.Data != null) Console.Error.WriteLine(e.Data); };
      process.BeginOutputReadLine(); process.BeginErrorReadLine();
      process.WaitForExit(); return process.ExitCode;
    }
  }
}
`,
  );
  const compiler = path.join(
    process.env.SystemRoot || "C:\\Windows",
    "Microsoft.NET/Framework64/v4.0.30319/csc.exe",
  );
  env.DEMO_PG_DUMP = path.join(runtime, "pg_dump_wsl16.exe");
  env.DEMO_PG_RESTORE = path.join(runtime, "pg_restore_wsl16.exe");
  await run(compiler, [
    "/nologo",
    "/target:exe",
    `/out:${env.DEMO_PG_DUMP}`,
    wrapperSource,
  ]);
  await fs.copyFile(env.DEMO_PG_DUMP, env.DEMO_PG_RESTORE);
  report.dumpTool = await run("wsl.exe", [
    "--exec",
    "/usr/lib/postgresql/16/bin/pg_dump",
    "--version",
  ]);
  report.restoreTool = await run("wsl.exe", [
    "--exec",
    "/usr/lib/postgresql/16/bin/pg_restore",
    "--version",
  ]);
  const upgradeDb = `demo_test_lms_upgrade_a_${stamp}`;
  const sourceDb = `demo_test_lms_backup_a_${stamp}`;
  const restoreDb = `demo_test_lms_restore_a_${stamp}`;
  const prefix = "dsj2/products/demo/packages/database/prisma/";
  const files = (
    await run("git", [
      "-C",
      path.resolve(root, "../../.."),
      "ls-tree",
      "-r",
      "--name-only",
      report.baselineRef,
      "--",
      prefix,
    ])
  )
    .split(/\r?\n/)
    .filter(Boolean);
  assert.ok(files.length > 10);
  const baselineRoot = path.join(runtime, "baseline-prisma");
  for (const name of files) {
    assert.ok(name.startsWith(prefix));
    const target = path.resolve(baselineRoot, name.slice(prefix.length));
    assert.ok(target.startsWith(path.resolve(baselineRoot) + path.sep));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(
      target,
      await run("git", ["show", `${report.baselineRef}:${name}`], {}, false),
    );
  }
  await createDatabase(upgradeDb);
  await migrate(upgradeDb, path.join(baselineRoot, "schema.prisma"));
  assert.equal(
    await sql(
      upgradeDb,
      "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='Course'",
    ),
    "0",
  );
  const tenant = randomUUID(),
    user = randomUUID(),
    recipient = randomUUID();
  await sql(
    upgradeDb,
    `INSERT INTO "Tenant" (id,name) VALUES ('${tenant}','SYNTHETIC UPGRADE PRESERVATION'); INSERT INTO "User" (id,"tenantId",email,"displayName","passwordHash",role) VALUES ('${user}','${tenant}','${user}@example.test','Synthetic baseline','not-a-login-hash','ADMIN'); INSERT INTO "Recipient" (id,"tenantId",data) VALUES ('${recipient}','${tenant}','{"fullNameRu":"Synthetic baseline recipient","origin":"MANUAL","assessment":"PASSED/AUTO-PRINT-ONLY"}'::jsonb);`,
  );
  const before = await oldRowHashes(upgradeDb);
  const priorMigrations = Number(
    await sql(upgradeDb, 'SELECT count(*) FROM "_prisma_migrations"'),
  );
  await migrate(
    upgradeDb,
    path.join(root, "packages/database/prisma/schema.prisma"),
  );
  const after = await oldRowHashes(upgradeDb);
  assert.deepEqual(after, before);
  assert.equal(
    await sql(upgradeDb, 'SELECT count(*) FROM "VerifiedExamResult"'),
    "0",
  );
  const currentMigrations = Number(
    await sql(upgradeDb, 'SELECT count(*) FROM "_prisma_migrations"'),
  );
  report.checks.push({
    id: "UPGRADE_FROM_F8A9A66",
    status: "PASS",
    database: upgradeDb,
    priorMigrations,
    currentMigrations,
    preservedRowHashes: after,
    automaticHistoricalExamBackfill: 0,
  });

  await createDatabase(sourceDb);
  await createDatabase(restoreDb);
  await migrate(
    sourceDb,
    path.join(root, "packages/database/prisma/schema.prisma"),
  );
  const sourceStore = path.join(runtime, "source-files"),
    restoreStore = path.join(runtime, "restored-files"),
    backupDir = path.join(runtime, "backup");
  const privateBytes = Buffer.from(
    "%PDF-1.4\nSYNTHETIC LMS BACKUP MATERIAL\n%%EOF",
  );
  const storageKey = "objects/synthetic-lms-backup.pdf";
  await fs.mkdir(path.join(sourceStore, "objects"), { recursive: true });
  await fs.writeFile(path.join(sourceStore, storageKey), privateBytes);
  const ids = Object.fromEntries(
    [
      "tenant",
      "user",
      "recipient",
      "profile",
      "course",
      "policy",
      "version",
      "enrollment",
      "progress",
      "attempt",
      "result",
      "material",
      "outbox",
    ].map((key) => [key, randomUUID()]),
  );
  await sql(
    sourceDb,
    `
    INSERT INTO "Tenant" (id,name,"demoOnly") VALUES ('${ids.tenant}','SYNTHETIC BACKUP FIXTURE',true);
    INSERT INTO "User" (id,"tenantId",email,"displayName","passwordHash",role) VALUES ('${ids.user}','${ids.tenant}','${ids.user}@example.test','Synthetic learner','not-a-login-hash','LEARNER');
    INSERT INTO "Recipient" (id,"tenantId",data) VALUES ('${ids.recipient}','${ids.tenant}','{"fullNameRu":"Synthetic backup learner"}');
    INSERT INTO "LearnerProfile" (id,"tenantId","userId","recipientId","consentVersion","consentAt") VALUES ('${ids.profile}','${ids.tenant}','${ids.user}','${ids.recipient}','synthetic-consent-v1',now());
    INSERT INTO "Course" (id,"tenantId","titleRu","createdBy") VALUES ('${ids.course}','${ids.tenant}','SYNTHETIC BACKUP COURSE','${ids.user}');
    INSERT INTO "RegulatoryProfileVersion" (id,"tenantId","courseId",version,definition,"snapshotHash") VALUES ('${ids.policy}','${ids.tenant}','${ids.course}',1,'{"synthetic":true}','synthetic-policy-hash');
    INSERT INTO "CourseVersion" (id,"tenantId","courseId",version,status,content,"regulatoryProfileVersionId","createdBy") VALUES ('${ids.version}','${ids.tenant}','${ids.course}',1,'PUBLISHED','{"synthetic":true}','${ids.policy}','${ids.user}');
    INSERT INTO "Enrollment" (id,"tenantId","courseVersionId","recipientId","learnerUserId","dueAt","assignedBy") VALUES ('${ids.enrollment}','${ids.tenant}','${ids.version}','${ids.recipient}','${ids.user}',now()+interval '10 days','${ids.user}');
    INSERT INTO "LessonProgress" (id,"tenantId","enrollmentId","lessonId",sequence,"completedAt","updatedAt") VALUES ('${ids.progress}','${ids.tenant}','${ids.enrollment}','synthetic-lesson',3,now(),now());
    INSERT INTO "ExamAttempt" (id,"tenantId","enrollmentId","courseVersionId","regulatoryProfileVersionId","assessmentKind",ordinal,state,snapshot,"deadlineAt","finishedAt",score,maximum,verdict) VALUES ('${ids.attempt}','${ids.tenant}','${ids.enrollment}','${ids.version}','${ids.policy}','CENTER_EXAM',1,'FINISHED','{"synthetic":true}',now(),now(),9,10,'PASSED');
    INSERT INTO "VerifiedExamResult" (id,"tenantId","enrollmentId","attemptId","assessmentKind","regulatoryProfileVersionId","courseVersionId","recipientId",verdict,score,maximum,eligible,"examAt",snapshot,"snapshotHash","createdBy") VALUES ('${ids.result}','${ids.tenant}','${ids.enrollment}','${ids.attempt}','CENTER_EXAM','${ids.policy}','${ids.version}','${ids.recipient}','PASSED',9,10,false,now(),'{"syntheticBackupFixture":true}','synthetic-result-hash','${ids.user}');
    INSERT INTO "LmsMaterial" (id,"tenantId","courseId","storageKey",sha256,size,"mimeType","originalName","createdBy") VALUES ('${ids.material}','${ids.tenant}','${ids.course}','${storageKey}','${hash(privateBytes)}',${privateBytes.length},'application/pdf','synthetic.pdf','${ids.user}');
    INSERT INTO "RegulatoryOutbox" (id,"tenantId","resultId") VALUES ('${ids.outbox}','${ids.tenant}','${ids.result}');
  `,
  );
  const backupOutput = await run(
    process.execPath,
    ["deployment/backup.mjs", "backup", backupDir],
    { DATABASE_URL: urlFor(sourceDb), DEMO_ARTIFACT_ROOT: sourceStore },
  );
  const restoreOutput = await run(
    process.execPath,
    ["deployment/backup.mjs", "restore", backupDir],
    { DATABASE_URL: urlFor(restoreDb), DEMO_ARTIFACT_ROOT: restoreStore },
  );
  const verifyOutput = await run(
    process.execPath,
    ["deployment/backup.mjs", "verify", backupDir],
    { DATABASE_URL: urlFor(restoreDb), DEMO_ARTIFACT_ROOT: restoreStore },
  );
  const manifest = JSON.parse(
    await fs.readFile(path.join(backupDir, "manifest.json"), "utf8"),
  );
  assert.equal(
    hash(await fs.readFile(path.join(restoreStore, storageKey))),
    hash(privateBytes),
  );
  for (const table of [
    "LearnerProfile",
    "Course",
    "CourseVersion",
    "RegulatoryProfileVersion",
    "Enrollment",
    "LessonProgress",
    "ExamAttempt",
    "VerifiedExamResult",
    "LmsMaterial",
    "RegulatoryOutbox",
  ])
    assert.equal(manifest.databaseCounts[table], 1);
  report.checks.push({
    id: "FRESH_INSTALL_BACKUP_RESTORE",
    status: "PASS",
    sourceDatabase: sourceDb,
    restoredDatabase: restoreDb,
    tables: Object.keys(manifest.databaseCounts).length,
    privateFiles: Object.keys(manifest.files).length,
    privateFileHash: hash(privateBytes),
    databaseRowHashesVerified: true,
    pendingOutboxRestored: await sql(
      restoreDb,
      "SELECT count(*) FROM \"RegulatoryOutbox\" WHERE status='PENDING'",
    ),
    backupOutput: JSON.parse(backupOutput),
    restoreOutput: JSON.parse(restoreOutput),
    verifyOutput: JSON.parse(verifyOutput),
    backupManifest: path.join(backupDir, "manifest.json"),
  });
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.error = String(error);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  report.commands = commands;
  await fs.writeFile(
    path.join(evidence, "STORAGE_ACCEPTANCE.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      status: report.status,
      checks: report.checks.map(({ id, status }) => ({ id, status })),
      evidence: path.join(evidence, "STORAGE_ACCEPTANCE.json"),
      error: report.error,
    }),
  );
}

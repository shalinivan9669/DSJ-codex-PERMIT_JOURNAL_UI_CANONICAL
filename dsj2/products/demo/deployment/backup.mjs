import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const productRoot = fileURLToPath(new URL("../", import.meta.url));
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error(
    "DATABASE_URL is required (use an empty disposable target for restore).",
  );
const db = new URL(databaseUrl);
if (!["postgres:", "postgresql:"].includes(db.protocol))
  throw new Error("PostgreSQL is required.");
const pgEnv = {
  ...process.env,
  PGHOST: db.hostname,
  PGPORT: db.port || "5432",
  PGUSER: decodeURIComponent(db.username),
  PGPASSWORD: decodeURIComponent(db.password),
  PGDATABASE: db.pathname.slice(1),
  PGSSLMODE: db.searchParams.get("sslmode") || "prefer",
};
delete pgEnv.DATABASE_URL;
const [mode, destination] = process.argv.slice(2);
if (!["backup", "restore", "verify"].includes(mode) || !destination)
  throw new Error(
    "Usage: node deployment/backup.mjs backup|restore|verify ABSOLUTE_BACKUP_DIRECTORY",
  );
const backupRoot = path.resolve(destination);
const dataRoot = path.resolve(
  process.env.DEMO_ARTIFACT_ROOT || path.join(productRoot, "data", "artifacts"),
);
const assetsRoot = path.join(productRoot, "assets");
if (
  !path.isAbsolute(destination) ||
  backupRoot === path.parse(backupRoot).root ||
  dataRoot === path.parse(dataRoot).root ||
  backupRoot === dataRoot ||
  backupRoot.startsWith(dataRoot + path.sep) ||
  dataRoot.startsWith(backupRoot + path.sep)
)
  throw new Error(
    "Use separate absolute backup and private storage directories.",
  );

function pg(tool, args, hashOutput = false) {
  return new Promise((resolve, reject) => {
    const executable = process.env[`DEMO_${tool.toUpperCase()}`] || tool;
    const child = spawn(executable, args, {
      env: pgEnv,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let result = "";
    const outputHash = hashOutput ? createHash("sha256") : null;
    let error = "";
    child.stdout.on("data", (b) => {
      if (outputHash) outputHash.update(b);
      else result += b;
    });
    child.stderr.on("data", (b) => {
      error += b;
    });
    child.on("error", () =>
      reject(
        new Error(
          `${tool} cannot start; configure DEMO_${tool.toUpperCase()}.`,
        ),
      ),
    );
    child.on("close", (code) =>
      code === 0
        ? resolve(outputHash ? outputHash.digest("hex") : result.trim())
        : reject(
            new Error(
              `${tool} failed (${code}); ${(pgEnv.PGPASSWORD ? error.replaceAll(pgEnv.PGPASSWORD, "[redacted]") : error).slice(0, 600)}`,
            ),
          ),
    );
  });
}
const sql = (query) =>
  pg("psql", ["-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", query]);
async function counts() {
  const names = (
    await sql(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    )
  )
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const result = {};
  for (const name of names)
    result[name] = Number(
      await sql(`SELECT count(*) FROM "${name.replaceAll('"', '""')}"`),
    );
  return result;
}
async function databaseHashes(tableCounts) {
  const result = {};
  // Stream canonical sorted rows into SHA256; no row data or personal fields enter logs/manifests.
  for (const name of Object.keys(tableCounts).sort()) {
    const quoted = name.replaceAll('"', '""');
    result[name] = await pg(
      "psql",
      [
        "-X",
        "-q",
        "-A",
        "-t",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        `SELECT to_jsonb(t)::text FROM "${quoted}" t ORDER BY to_jsonb(t)::text COLLATE "C"`,
      ],
      true,
    );
  }
  return result;
}
async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
async function inventory(root, relative = "") {
  const result = {};
  const entries = await fs
    .readdir(path.join(root, relative), { withFileTypes: true })
    .catch((e) => {
      if (e.code === "ENOENT" && relative === "") return [];
      throw e;
    });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const next = path.join(relative, entry.name);
    if (entry.isSymbolicLink())
      throw new Error("Private store backup refuses symbolic links.");
    if (entry.isDirectory()) Object.assign(result, await inventory(root, next));
    else if (entry.isFile())
      result[next.split(path.sep).join("/")] = await sha256(
        path.join(root, next),
      );
  }
  return result;
}
function same(actual, expected, label) {
  if (
    JSON.stringify(Object.entries(actual).sort()) !==
    JSON.stringify(Object.entries(expected).sort())
  )
    throw new Error(`${label} reconciliation failed.`);
}
async function copyTree(source, target, entries) {
  await fs.mkdir(target, { recursive: true, mode: 0o700 });
  for (const relative of Object.keys(entries)) {
    if (
      relative.includes("\\") ||
      relative.split("/").some((p) => !p || p === "." || p === "..") ||
      path.isAbsolute(relative)
    )
      throw new Error("Unsafe backup path.");
    const dest = path.join(target, relative);
    await fs.mkdir(path.dirname(dest), { recursive: true, mode: 0o700 });
    await fs.copyFile(path.join(source, relative), dest);
    await fs.chmod(dest, 0o600);
  }
}

// Shared with the storage collector. Sibling location keeps the lock outside file inventories.
await fs.mkdir(path.dirname(dataRoot), { recursive: true });
const maintenanceLockPath = `${dataRoot}.maintenance.lock`;
const maintenanceLock = await fs
  .open(maintenanceLockPath, "wx", 0o600)
  .catch((error) => {
    if (error.code === "EEXIST")
      throw new Error(
        "Storage maintenance lock already held; inspect its owner before retrying. No automatic stale-lock removal.",
      );
    throw error;
  });
try {
  await maintenanceLock.writeFile(
    JSON.stringify({
      operation: mode,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    }),
  );
  if (mode === "backup") {
    if (process.env.DEMO_MAINTENANCE !== "1")
      throw new Error(
        "Stop web/API/worker first, then set DEMO_MAINTENANCE=1 to acknowledge a consistent offline backup.",
      );
    await fs.mkdir(backupRoot, { recursive: false, mode: 0o700 });
    const databaseCounts = await counts();
    const databaseTimezone = await sql("SHOW timezone");
    const rowHashes = await databaseHashes(databaseCounts);
    await pg("pg_dump", [
      "--format=custom",
      "--no-owner",
      "--no-acl",
      "--file",
      path.join(backupRoot, "database.dump"),
    ]);
    await fs.chmod(path.join(backupRoot, "database.dump"), 0o600);
    const files = await inventory(dataRoot);
    const assets = await inventory(assetsRoot);
    await copyTree(dataRoot, path.join(backupRoot, "files"), files);
    await copyTree(assetsRoot, path.join(backupRoot, "assets"), assets);
    same(await inventory(dataRoot), files, "Live files changed during backup");
    same(await counts(), databaseCounts, "Database changed during backup");
    same(
      await databaseHashes(databaseCounts),
      rowHashes,
      "Database row contents changed during backup",
    );
    same(
      await inventory(assetsRoot),
      assets,
      "Release assets changed during backup",
    );
    const manifest = {
      version: 2,
      product: "DEMO",
      createdAt: new Date().toISOString(),
      databaseCounts,
      databaseTimezone,
      databaseRowHashes: rowHashes,
      databaseSha256: await sha256(path.join(backupRoot, "database.dump")),
      files,
      assets,
      secrets:
        "Not embedded. Restore separately from the secret manager; invalidate sessions when rotating credentials.",
    };
    await fs.writeFile(
      path.join(backupRoot, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        backup: backupRoot,
        tables: Object.keys(databaseCounts).length,
        files: Object.keys(files).length,
        assets: Object.keys(assets).length,
      }),
    );
  } else {
    const manifest = JSON.parse(
      await fs.readFile(path.join(backupRoot, "manifest.json"), "utf8"),
    );
    if (![1, 2].includes(manifest.version) || manifest.product !== "DEMO")
      throw new Error("Unsupported backup manifest.");
    if (
      (await sha256(path.join(backupRoot, "database.dump"))) !==
      manifest.databaseSha256
    )
      throw new Error("Database backup hash mismatch.");
    same(
      await inventory(path.join(backupRoot, "files")),
      manifest.files,
      "Backup files",
    );
    same(
      await inventory(path.join(backupRoot, "assets")),
      manifest.assets,
      "Backup assets",
    );
    if (mode === "restore") {
      if (Object.keys(await counts()).length)
        throw new Error(
          "Restore requires an EMPTY target database; no existing tables are removed.",
        );
      if (Object.keys(await inventory(dataRoot)).length)
        throw new Error("Restore requires an EMPTY private storage directory.");
      if (manifest.databaseTimezone) {
        if (
          typeof manifest.databaseTimezone !== "string" ||
          !/^[A-Za-z0-9_+\-/]+$/.test(manifest.databaseTimezone)
        )
          throw new Error("Invalid database timezone in backup manifest.");
        // pg_dump without --create omits ALTER DATABASE settings. Preserve UTC lease semantics after restore.
        await sql(
          `ALTER DATABASE "${pgEnv.PGDATABASE.replaceAll('"', '""')}" SET timezone TO '${manifest.databaseTimezone}'`,
        );
      }
      await pg("pg_restore", [
        "--exit-on-error",
        "--no-owner",
        "--no-acl",
        "--dbname",
        pgEnv.PGDATABASE,
        path.join(backupRoot, "database.dump"),
      ]);
      await copyTree(path.join(backupRoot, "files"), dataRoot, manifest.files);
      // Pinned source assets are part of the release image, so verify instead of silently replacing them.
    }
    same(await counts(), manifest.databaseCounts, "Database counts");
    if (
      manifest.databaseTimezone &&
      (await sql("SHOW timezone")) !== manifest.databaseTimezone
    )
      throw new Error("Database timezone reconciliation failed.");
    if (manifest.version === 2)
      same(
        await databaseHashes(manifest.databaseCounts),
        manifest.databaseRowHashes,
        "Database row hashes",
      );
    same(await inventory(dataRoot), manifest.files, "Restored file hashes");
    same(
      await inventory(assetsRoot),
      manifest.assets,
      "Release template/font hashes",
    );
    console.log(
      JSON.stringify({
        verified: true,
        databaseContentsVerified: manifest.version === 2,
        tables: Object.keys(manifest.databaseCounts).length,
        files: Object.keys(manifest.files).length,
        assets: Object.keys(manifest.assets).length,
      }),
    );
  }
} finally {
  await maintenanceLock.close();
  await fs.unlink(maintenanceLockPath);
}

import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
const [companyId, output] = process.argv.slice(2);
if (!companyId || !/^[A-Za-z0-9_-]{1,128}$/.test(companyId) || !output)
  throw new Error(
    "Usage: node scripts/migration/export-legacy.mjs SOURCE_COMPANY_ID OUTPUT.json; LEGACY_DATABASE_URL must be an explicitly authorized readonly connection",
  );
const connection = process.env.LEGACY_DATABASE_URL;
if (!connection)
  throw new Error(
    "LEGACY_DATABASE_URL required; source DSJ is never inferred from DEMO DATABASE_URL",
  );
const url = new URL(connection);
if (!["postgres:", "postgresql:"].includes(url.protocol))
  throw new Error("PostgreSQL source required");
const env = {
  ...process.env,
  PGHOST: url.hostname,
  PGPORT: url.port || "5432",
  PGUSER: decodeURIComponent(url.username),
  PGPASSWORD: decodeURIComponent(url.password),
  PGDATABASE: url.pathname.slice(1),
  PGSSLMODE: url.searchParams.get("sslmode") || "prefer",
  PGOPTIONS: "-c default_transaction_read_only=on -c statement_timeout=60000",
};
delete env.DATABASE_URL;
delete env.LEGACY_DATABASE_URL;
const query = `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT json_build_object('version',1,'sourceSystem','DSJ','sourceCompanyId','${companyId}','requests',COALESCE((SELECT json_agg(to_jsonb(r)||jsonb_build_object('items',COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i."createdAt",i.id) FROM "CardGenerationRequestItem" i WHERE i."requestId"=r.id),'[]'::jsonb)) ORDER BY r."createdAt",r.id) FROM "CardGenerationRequest" r WHERE r."companyId"='${companyId}'),'[]'::json),'audit',COALESCE((SELECT json_agg(to_jsonb(a) ORDER BY a."createdAt",a.id) FROM "AuditLog" a WHERE a."companyId"='${companyId}' AND a.action LIKE 'biot_card.%'),'[]'::json));
ROLLBACK;`;
const text = await new Promise((resolveResult, reject) => {
  const child = spawn(
    process.env.DEMO_PSQL || "psql",
    ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"],
    { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  let out = "";
  child.stdout.on("data", (b) => (out += b));
  child.stderr.on("data", () => {});
  child.on("error", () => reject(new Error("psql unavailable")));
  child.on("close", (code) =>
    code === 0
      ? resolveResult(out.trim())
      : reject(
          new Error(`Readonly export failed (${code}); no source data written`),
        ),
  );
  child.stdin.end(query);
});
const envelope = JSON.parse(text);
envelope.originalFiles = "NOT_EXPORTED_LEGACY_DID_NOT_PERSIST_ORIGINALS";
envelope.coverage =
  "Current stored printing requests/items and all remaining biot_card audit rows. Previously deleted source data cannot be recovered by this export.";
envelope.counts = {
  requests: envelope.requests.length,
  items: envelope.requests.reduce((n, r) => n + r.items.length, 0),
  audit: envelope.audit.length,
};
const canonical = (v) =>
  v === null || typeof v !== "object"
    ? JSON.stringify(v)
    : Array.isArray(v)
      ? "[" + v.map(canonical).join(",") + "]"
      : "{" +
        Object.entries(v)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => JSON.stringify(k) + ":" + canonical(x))
          .join(",") +
        "}";
envelope.checksum = createHash("sha256")
  .update(canonical(envelope))
  .digest("hex");
const target = resolve(output);
await mkdir(dirname(target), { recursive: true, mode: 0o700 });
await writeFile(target, JSON.stringify(envelope, null, 2), {
  flag: "wx",
  mode: 0o600,
});
console.log(
  JSON.stringify({
    exported: true,
    counts: envelope.counts,
    checksum: envelope.checksum,
    originalFiles: envelope.originalFiles,
  }),
);

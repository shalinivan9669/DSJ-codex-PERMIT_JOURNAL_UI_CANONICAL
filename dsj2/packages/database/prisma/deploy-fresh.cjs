// Separate migration history for new installations. Never use it to adopt an
// existing database: the missing historical migrations cannot be reconstructed.
const { PrismaClient } = require('@prisma/client');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const source = path.join(__dirname, 'fresh-migrations');
const baseline = '202611040000_fresh_baseline';

function fail(message) { throw new Error(message); }
function checksum(file) { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function deploy(schema) {
  return new Promise((resolve, reject) => {
    // Prisma/driver diagnostics may contain a connection URL. Suppress child
    // output rather than risk exposing credentials in deployment logs.
    const child = spawn(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', schema], {
      stdio: 'ignore', env: process.env, timeout: 540000,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Prisma migration failed (${signal || code}).`)));
  });
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) fail('DATABASE_URL is required.');
  let parsed;
  try { parsed = new URL(url); } catch { fail('DATABASE_URL must be a valid PostgreSQL URL.'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || (parsed.searchParams.get('schema') || 'public') !== 'public' || parsed.searchParams.has('options')) {
    fail('The fresh migration history requires the public PostgreSQL schema.');
  }
  const migrations = fs.readdirSync(source, { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  if (migrations[0] !== baseline) fail('The fresh baseline is missing or is not the first migration.');
  const checksums = new Map(migrations.map(name => [name, checksum(path.join(source, name, 'migration.sql'))]));
  const db = new PrismaClient();
  let temp;
  try {
    await db.$transaction(async tx => {
      // Serialize guard + deployment for all users of this entrypoint.
      await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(7622453512201)::text');
      const schema = await tx.$queryRawUnsafe('SELECT current_schema() AS name');
      if (schema[0]?.name !== 'public') fail('Unexpected PostgreSQL search path.');
      const found = await tx.$queryRawUnsafe(`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present`);
      if (!found[0].present) {
        const objects = await tx.$queryRawUnsafe(`SELECT
          (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')) +
          (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public') +
          (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public') +
          (SELECT count(*) FROM pg_depend d WHERE d.refclassid='pg_namespace'::regclass AND d.refobjid='public'::regnamespace AND d.deptype='n') AS count`);
        if (BigInt(objects[0].count) !== 0n) fail('Refusing: the public schema is not empty.');
      } else {
        const applied = await tx.$queryRawUnsafe('SELECT migration_name, checksum, finished_at, rolled_back_at FROM public._prisma_migrations ORDER BY started_at');
        if (!applied.length || applied.some((row, i) => row.migration_name !== migrations[i] || !row.finished_at || row.rolled_back_at || row.checksum !== checksums.get(row.migration_name))) {
          fail('Refusing: migration history is not the verified fresh history.');
        }
      }
      temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsj-fresh-migrate-'));
      fs.copyFileSync(path.join(__dirname, 'schema.prisma'), path.join(temp, 'schema.prisma'));
      fs.cpSync(source, path.join(temp, 'migrations'), { recursive: true });
      await deploy(path.join(temp, 'schema.prisma'));
      console.log('Fresh migrations applied or already up to date.');
    }, { timeout: 600000, maxWait: 10000 });
  } finally {
    await db.$disconnect();
    if (temp) fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch(error => {
  // Avoid logging database credentials from driver errors.
  const safe = /^(DATABASE_URL|The fresh|Unexpected|Refusing:|Prisma migration failed)/.test(error.message || '') ? error.message : 'Fresh migration failed; check database connectivity and server logs.';
  console.error(safe);
  process.exitCode = 1;
});

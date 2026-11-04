import { hash } from "bcryptjs";
import { Prisma, type PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type BootstrapCredentials = {
  email: string;
  password: string;
  fullName: string;
};

type MigrationRecord = {
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
};

export function isVerifiedFreshBaseline(history: MigrationRecord[], checksum: string) {
  return history.length === 1 &&
    history[0].migration_name === "202611040000_fresh_baseline" &&
    history[0].checksum === checksum &&
    history[0].finished_at !== null &&
    history[0].rolled_back_at === null;
}

export function readBootstrapCredentials(env: NodeJS.ProcessEnv): BootstrapCredentials {
  const email = env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase() ?? "";
  const password = env.BOOTSTRAP_ADMIN_PASSWORD ?? "";
  const fullName = env.BOOTSTRAP_ADMIN_NAME?.trim() || "Администратор платформы";

  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("BOOTSTRAP_ADMIN_EMAIL must be a valid email address.");
  }

  // bcrypt only uses the first 72 bytes. Refuse silent truncation.
  if (
    password.length < 20 ||
    Buffer.byteLength(password, "utf8") > 72 ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/[0-9]/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  ) {
    throw new Error("BOOTSTRAP_ADMIN_PASSWORD must be at least 20 characters, at most 72 UTF-8 bytes, and contain lowercase, uppercase, number, and symbol characters.");
  }

  if (fullName.length > 128) {
    throw new Error("BOOTSTRAP_ADMIN_NAME must be at most 128 characters.");
  }

  return { email, password, fullName };
}

export async function bootstrapSuperAdmin(prisma: PrismaClient, credentials: BootstrapCredentials) {
  const passwordHash = await hash(credentials.password, 12);
  const baseline = "202611040000_fresh_baseline";
  const checksum = createHash("sha256")
    .update(readFileSync(join(__dirname, "fresh-migrations", baseline, "migration.sql")))
    .digest("hex");

  await prisma.$transaction(async (tx) => {
    const schemas = await tx.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT nspname AS name FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname NOT IN ('public', 'information_schema')`,
    );
    const current = await tx.$queryRawUnsafe<Array<{ name: string }>>("SELECT current_schema() AS name");
    if (current[0]?.name !== "public" || schemas.length !== 0) {
      throw new Error("Bootstrap refused: unexpected database schema.");
    }

    const tables = await tx.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname`,
    );
    const expected = [...Prisma.dmmf.datamodel.models.map((model) => model.dbName ?? model.name), "_prisma_migrations"].sort();
    if (tables.map(({ name }) => name).sort().join("\0") !== expected.join("\0")) {
      throw new Error("Bootstrap refused: database tables do not match this version.");
    }

    // All identifiers come from the database catalog and are double-quote escaped.
    // The lock excludes concurrent writers until validation and creation commit.
    const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
    const qualifiedTables = tables.map(({ name }) => `"public".${quote(name)}`);
    await tx.$executeRawUnsafe(`LOCK TABLE ${qualifiedTables.join(", ")} IN SHARE ROW EXCLUSIVE MODE`);

    const history = await tx.$queryRawUnsafe<MigrationRecord[]>(
      'SELECT migration_name, checksum, finished_at, rolled_back_at FROM "public"."_prisma_migrations"',
    );
    if (!isVerifiedFreshBaseline(history, checksum)) {
      throw new Error("Bootstrap refused: migration history is not the verified fresh baseline.");
    }

    const dataTables = tables.filter(({ name }) => name !== "_prisma_migrations");
    const predicates = dataTables.map(({ name }) => `EXISTS (SELECT 1 FROM "public".${quote(name)})`);
    const rows = await tx.$queryRawUnsafe<Array<{ has_data: boolean }>>(`SELECT ${predicates.join(" OR ")} AS has_data`);
    if (rows[0]?.has_data !== false) {
      throw new Error("Bootstrap refused: the database contains application data.");
    }

    await tx.user.create({
      data: {
        email: credentials.email,
        passwordHash,
        fullName: credentials.fullName,
        role: "SUPER_ADMIN",
      },
    });
  }, { timeout: 60000 });
}

# New installations: separate migration history

The migrations in `fresh-migrations/` are a separate history for a **new,
empty PostgreSQL database**. They do not repair or replace the historical
`migrations/` history and must not be used to adopt an existing installation.
The missing historical migrations and any objects or data they created remain
unknown. `docs/migration-recovery-notes.md` describes that limitation.

Use `pnpm --filter @dsj/database db:deploy:fresh` with `DATABASE_URL` set to
the new database. The command accepts only the `public` schema, checks that
it contains no objects in `public` before the first
run, and subsequently accepts only its own completed, checksum-matching
migration history. It serializes checks and deployments from this command
using a PostgreSQL advisory lock; other database clients do not use that lock.
An interrupted or failed migration requires investigation;
do not manually mark migrations as applied to bypass the check.

The baseline was generated from the current Prisma model and augmented with
the SQL-only participant checks and historical enum order. The model also
describes four historical user foreign keys and three historical indexes so
that Prisma does not propose removing them. Prisma's schema diff does not
verify SQL CHECK constraints or PostgreSQL enum ordering; explicitly verify
them when changing the schema. The baseline does not import old data or run
historical backfills. The destructive demo seed is for disposable local
databases only and is not part of deployment.

After this history has been used, do not edit its applied migration files.
Put future migrations for installations using this baseline in
`fresh-migrations/` and test a fresh install and an upgrade from a copy of a
baseline installation. Deployments still using `migrations/` require their own
separately reviewed migration strategy; adding a migration to one history does
not update the other. Test backups and restoration for the actual hosting
environment before relying on them.

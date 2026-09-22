-- Prisma stores timestamps as UTC timestamp-without-time-zone. New connections
-- must not inherit a host-specific timezone for SQL defaults and comparisons.
DO $$ BEGIN
 EXECUTE format('ALTER DATABASE %I SET timezone TO %L',current_database(),'UTC');
END $$;
SET timezone TO 'UTC';

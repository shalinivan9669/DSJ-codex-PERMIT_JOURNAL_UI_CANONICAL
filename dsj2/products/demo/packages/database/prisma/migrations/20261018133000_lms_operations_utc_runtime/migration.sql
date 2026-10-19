-- Reassert the established UTC storage contract after an older database was
-- restored into a new database without its database-level configuration.
-- No historical values are rewritten. Restore tooling must also copy this
-- setting when restoring a dump whose migration history already includes it.
DO $$ BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'UTC');
END $$;
SET timezone TO 'UTC';

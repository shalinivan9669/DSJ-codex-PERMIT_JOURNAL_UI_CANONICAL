-- Existing ADMIN accounts retain director authority without changing users,
-- passwords, proposal decisions, issued documents or their immutable history.
CREATE OR REPLACE FUNCTION demo_director_decision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM "User" WHERE id=NEW."decidedBy" AND "tenantId"=NEW."tenantId" AND active AND role IN ('DIRECTOR','ADMIN')) THEN
   RAISE EXCEPTION 'DEMO_DIRECTOR_REQUIRED'; END IF;
 RETURN NEW;
END $$;

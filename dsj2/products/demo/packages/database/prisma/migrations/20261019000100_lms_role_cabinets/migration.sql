-- Add the specification's system owner without rewriting existing accounts.
ALTER TABLE "User" DROP CONSTRAINT user_role;
ALTER TABLE "User" ADD CONSTRAINT user_role CHECK (
  role IN ('SUPER_ADMIN','ADMIN','DIRECTOR','OPERATOR','VIEWER','EMPLOYER','LEARNER','TEACHER','METHODIST','EXPERT')
);

-- Preserve existing approval authority and allow the new system owner.
CREATE OR REPLACE FUNCTION demo_director_decision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM "User" WHERE id=NEW."decidedBy" AND "tenantId"=NEW."tenantId" AND active AND role IN ('SUPER_ADMIN','DIRECTOR','ADMIN')) THEN
   RAISE EXCEPTION 'DEMO_DIRECTOR_REQUIRED'; END IF;
 RETURN NEW;
END $$;

-- Invitations and memberships carry the same explicit training delegation.
-- Older installations had an unnamed four-permission CHECK on invitations.
DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid='"EmployerInvite"'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%permissions%'
      AND pg_get_constraintdef(oid) LIKE '%APPROVE_DATA%'
  LOOP
    EXECUTE format('ALTER TABLE "EmployerInvite" DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;
ALTER TABLE "EmployerInvite" ADD CONSTRAINT "EmployerInvite_permissions_allowed"
CHECK (jsonb_typeof("permissions") = 'array' AND "permissions" ? 'READ'
  AND "permissions" <@ '["READ","PROPOSE","APPROVE_DATA","DOWNLOAD","ASSIGN_TRAINING"]');

-- Add an explicit teacher signing capacity for new manual BIOT/PB workflows.
-- Existing binding records and frozen issuance policies remain unchanged.
ALTER TABLE "SignatoryBinding" DROP CONSTRAINT "SignatoryBinding_kind_check";
ALTER TABLE "SignatoryBinding" ADD CONSTRAINT "SignatoryBinding_kind_check"
  CHECK (kind IN ('DIRECTOR','CHAIR','MEMBER','TEACHER'));

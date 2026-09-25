-- Additive opt-in naming model. Existing free-text names and issued snapshots
-- remain unchanged; legal form is never inferred from legacy organization text.
ALTER TABLE "CustomerOrganization"
  ADD COLUMN "legalForm" TEXT,
  ADD COLUMN "ownNameRu" TEXT,
  ADD COLUMN "ownNameKz" TEXT;

ALTER TABLE "CustomerOrganization"
  ADD CONSTRAINT "CustomerOrganization_legalForm_check"
  CHECK ("legalForm" IS NULL OR "legalForm" IN ('TOO', 'IP', 'AO', 'NONE'));

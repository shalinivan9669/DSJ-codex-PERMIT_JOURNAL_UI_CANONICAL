-- NULL retains an explicitly configured installation registration center.
-- A center administrator can explicitly open or close registration in the UI.
ALTER TABLE "Tenant" ADD COLUMN "learnerRegistrationEnabled" BOOLEAN;

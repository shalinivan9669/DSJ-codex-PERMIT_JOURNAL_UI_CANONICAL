CREATE TABLE "EmployerInvite" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  "customerId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "secretHash" TEXT NOT NULL UNIQUE CHECK ("secretHash" ~ '^[a-f0-9]{64}$'),
  "existingUserId" TEXT,
  "userSessionVersion" INTEGER,
  "permissions" JSONB NOT NULL,
  "recipientIds" JSONB NOT NULL DEFAULT '[]',
  "accessExpiresAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "membershipId" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("tenantId", "id"),
  FOREIGN KEY ("tenantId", "customerId") REFERENCES "CustomerOrganization"("tenantId", "id") ON DELETE RESTRICT,
  FOREIGN KEY ("tenantId", "existingUserId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT,
  FOREIGN KEY ("tenantId", "createdBy") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT,
  FOREIGN KEY ("tenantId", "membershipId") REFERENCES "EmployerMembership"("tenantId", "id") ON DELETE RESTRICT,
  CHECK (("existingUserId" IS NULL) = ("userSessionVersion" IS NULL)),
  CHECK (("consumedAt" IS NULL) = ("membershipId" IS NULL)),
  CHECK ("accessExpiresAt" >= "expiresAt"),
  CHECK (jsonb_typeof("permissions") = 'array' AND "permissions" ? 'READ' AND "permissions" <@ '["READ","PROPOSE","APPROVE_DATA","DOWNLOAD"]'),
  CHECK (jsonb_typeof("recipientIds") = 'array')
);
CREATE INDEX "EmployerInvite_tenantId_createdAt_idx" ON "EmployerInvite"("tenantId", "createdAt");
CREATE FUNCTION demo_invite_recipient_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(NEW."recipientIds") candidate(id)
    WHERE NOT EXISTS (SELECT 1 FROM "Recipient" r WHERE r.id = candidate.id AND r."tenantId" = NEW."tenantId")
  ) THEN RAISE EXCEPTION 'Invite recipient tenant mismatch' USING ERRCODE = '23503'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "EmployerInvite_recipient_scope" BEFORE INSERT OR UPDATE ON "EmployerInvite" FOR EACH ROW EXECUTE FUNCTION demo_invite_recipient_scope();

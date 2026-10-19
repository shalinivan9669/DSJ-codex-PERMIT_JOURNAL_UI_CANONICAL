-- Existing issued documents remain immutable. New LMS documents receive a
-- private, stable verification URL before rendering; public lookup uses its hash.
ALTER TABLE "LmsDocumentLink"
  ADD COLUMN "verificationUrl" TEXT,
  ADD COLUMN "verificationTokenHash" TEXT,
  ADD COLUMN "verificationRevokedAt" TIMESTAMP(3),
  ADD COLUMN "verificationExpiresAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "LmsDocumentLink_verificationTokenHash_key"
  ON "LmsDocumentLink"("verificationTokenHash");

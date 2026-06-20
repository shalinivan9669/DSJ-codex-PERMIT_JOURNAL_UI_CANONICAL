ALTER TABLE "SigningSession"
  ADD COLUMN "initiatedByUserId" TEXT;

ALTER TABLE "ProviderCallbackEvent"
  ADD COLUMN "callbackKey" TEXT,
  ADD COLUMN "rawPayloadEncrypted" TEXT,
  ADD COLUMN "rawPayloadHash" TEXT;

CREATE INDEX "SigningSession_initiatedByUserId_idx"
  ON "SigningSession"("initiatedByUserId");

CREATE UNIQUE INDEX "ProviderCallbackEvent_callbackKey_key"
  ON "ProviderCallbackEvent"("callbackKey");

ALTER TABLE "SigningSession"
  ADD CONSTRAINT "SigningSession_initiatedByUserId_fkey"
  FOREIGN KEY ("initiatedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

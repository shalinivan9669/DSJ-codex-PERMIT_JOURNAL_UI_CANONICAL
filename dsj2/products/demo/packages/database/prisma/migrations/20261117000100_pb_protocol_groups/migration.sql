DROP INDEX "IssuedDocument_issuanceId_groupEventId_key";
CREATE INDEX "IssuedDocument_issuanceId_groupEventId_idx" ON "IssuedDocument"("issuanceId", "groupEventId");

-- Additive minimal public registry links; no token or PII added to immutable issued snapshots.
CREATE TABLE "PublicDocumentVerification" (
  id TEXT PRIMARY KEY NOT NULL,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE RESTRICT,
  "documentId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  "expiresAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("tenantId", id),
  FOREIGN KEY("tenantId","documentId") REFERENCES "IssuedDocument"("tenantId",id) ON DELETE RESTRICT,
  FOREIGN KEY("tenantId","createdBy") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT,
  CONSTRAINT verification_token_hash CHECK("tokenHash" ~ '^[a-f0-9]{64}$')
);
CREATE INDEX "PublicDocumentVerification_tenantId_documentId_idx" ON "PublicDocumentVerification"("tenantId","documentId");
CREATE TABLE "DocumentCorrectionRequest" (
  id TEXT PRIMARY KEY NOT NULL,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE RESTRICT,
  "verificationId" TEXT NOT NULL,
  message TEXT NOT NULL,
  "replyContact" TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'NEW' CHECK(status IN ('NEW','REVIEWED','CLOSED')),
  resolution TEXT NOT NULL DEFAULT '',
  "resolvedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("tenantId",id),
  FOREIGN KEY("tenantId","verificationId") REFERENCES "PublicDocumentVerification"("tenantId",id) ON DELETE RESTRICT,
  FOREIGN KEY("tenantId","resolvedBy") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT
);
CREATE INDEX "DocumentCorrectionRequest_tenantId_status_createdAt_idx" ON "DocumentCorrectionRequest"("tenantId",status,"createdAt");

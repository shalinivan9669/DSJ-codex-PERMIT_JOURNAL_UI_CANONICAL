ALTER TABLE "Tenant" ADD COLUMN "demoOnly" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "ImportBatch_tenantId_checksum_key" ON "ImportBatch"("tenantId","checksum");

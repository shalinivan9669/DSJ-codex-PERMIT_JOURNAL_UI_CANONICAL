CREATE TABLE "ImportMapping" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE RESTRICT,
 "name" TEXT NOT NULL,
 "columns" JSONB NOT NULL,
 "mapping" JSONB NOT NULL,
 "createdBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ImportMapping_tenant_creator_fk" FOREIGN KEY ("tenantId","createdBy") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "ImportMapping_tenantId_name_key" ON "ImportMapping"("tenantId","name");

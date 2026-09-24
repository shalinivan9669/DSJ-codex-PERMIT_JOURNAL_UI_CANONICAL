-- Additive OT Center ownership. Existing snapshots and reservations are unchanged.
ALTER TABLE "User" DROP CONSTRAINT user_role;
ALTER TABLE "User" ADD CONSTRAINT user_role CHECK(role IN ('ADMIN','OPERATOR','VIEWER','EMPLOYER'));
CREATE TABLE "TrainingEvent" (
 "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id),
 "requestId" TEXT NOT NULL, "revision" INTEGER NOT NULL DEFAULT 0 CHECK (revision>=0),
 "title" TEXT NOT NULL, "protocolTemplateId" TEXT NOT NULL, "data" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("tenantId",id), FOREIGN KEY("tenantId","requestId") REFERENCES "PrintRequest"("tenantId",id)
);
CREATE INDEX "TrainingEvent_tenantId_requestId_idx" ON "TrainingEvent"("tenantId","requestId");
ALTER TABLE "IssuedDocument" ALTER COLUMN "rowId" DROP NOT NULL, ALTER COLUMN "assignmentId" DROP NOT NULL;
ALTER TABLE "IssuedDocument" ADD COLUMN "ownerKind" TEXT NOT NULL DEFAULT 'INDIVIDUAL', ADD COLUMN "groupEventId" TEXT, ADD COLUMN "groupEventRevision" INTEGER;
ALTER TABLE "IssuedDocument" ADD CONSTRAINT document_owner CHECK (
 ("ownerKind"='INDIVIDUAL' AND "rowId" IS NOT NULL AND "assignmentId" IS NOT NULL AND "groupEventId" IS NULL AND "groupEventRevision" IS NULL) OR
 ("ownerKind"='GROUP' AND "rowId" IS NULL AND "assignmentId" IS NULL AND "groupEventId" IS NOT NULL AND "groupEventRevision">=0)
), ADD CONSTRAINT document_group_fk FOREIGN KEY("tenantId","groupEventId") REFERENCES "TrainingEvent"("tenantId",id);
CREATE UNIQUE INDEX "IssuedDocument_tenantId_groupEventId_groupEventRevision_key" ON "IssuedDocument"("tenantId","groupEventId","groupEventRevision");
CREATE TABLE "GroupDocumentMember" (
 "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id), "documentId" TEXT NOT NULL,
 "requestId" TEXT NOT NULL, "rowId" TEXT NOT NULL, "assignmentId" TEXT NOT NULL,
 "recipientId" TEXT, "employerId" TEXT, "position" INTEGER NOT NULL CHECK(position>=0), "outcome" JSONB NOT NULL,
 UNIQUE("documentId","requestId","rowId","assignmentId"),
 FOREIGN KEY("tenantId","documentId") REFERENCES "IssuedDocument"("tenantId",id),
 FOREIGN KEY("tenantId","requestId") REFERENCES "PrintRequest"("tenantId",id),
 FOREIGN KEY("tenantId","recipientId") REFERENCES "Recipient"("tenantId",id),
 FOREIGN KEY("tenantId","employerId") REFERENCES "CustomerOrganization"("tenantId",id)
);
CREATE INDEX "GroupDocumentMember_tenantId_recipientId_idx" ON "GroupDocumentMember"("tenantId","recipientId");
CREATE TRIGGER demo_immutable BEFORE UPDATE OR DELETE ON "GroupDocumentMember" FOR EACH ROW EXECUTE FUNCTION demo_immutable();
CREATE FUNCTION demo_group_members_required() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW."ownerKind"='GROUP' AND NOT EXISTS(SELECT 1 FROM "GroupDocumentMember" WHERE "documentId"=NEW.id AND "tenantId"=NEW."tenantId") THEN RAISE EXCEPTION 'GROUP_MEMBERS_REQUIRED'; END IF; RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER demo_group_members_required AFTER INSERT ON "IssuedDocument" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION demo_group_members_required();
CREATE TABLE "RecipientEmployment" (
 "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id), "recipientId" TEXT NOT NULL, "employerId" TEXT NOT NULL,
 "personnelNumber" TEXT NOT NULL DEFAULT '', "positionRu" TEXT NOT NULL DEFAULT '', "period" TEXT NOT NULL DEFAULT '',
 "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("tenantId","recipientId") REFERENCES "Recipient"("tenantId",id),
 FOREIGN KEY("tenantId","employerId") REFERENCES "CustomerOrganization"("tenantId",id),
 FOREIGN KEY("tenantId","createdBy") REFERENCES "User"("tenantId",id)
);
CREATE INDEX "RecipientEmployment_tenantId_recipientId_idx" ON "RecipientEmployment"("tenantId","recipientId");
CREATE TRIGGER demo_immutable BEFORE UPDATE OR DELETE ON "RecipientEmployment" FOR EACH ROW EXECUTE FUNCTION demo_immutable();
CREATE TABLE "CustomerExportProfile" (
 "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id), "customerId" TEXT, "name" TEXT NOT NULL, "profile" JSONB NOT NULL,
 "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 UNIQUE("tenantId",name), UNIQUE("tenantId",id),
 FOREIGN KEY("tenantId","customerId") REFERENCES "CustomerOrganization"("tenantId",id),
 FOREIGN KEY("tenantId","createdBy") REFERENCES "User"("tenantId",id)
);

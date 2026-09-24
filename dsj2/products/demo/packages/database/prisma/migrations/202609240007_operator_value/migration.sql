-- Additive service workflow schema. No mutation of issued history or counters.

CREATE TABLE "ServiceOrder" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "customerId" TEXT,
  "payerId" TEXT,
  "contact" TEXT NOT NULL DEFAULT '',
  "ownerId" TEXT,
  "dueDate" TEXT,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "commercial" JSONB NOT NULL DEFAULT '{}',
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "ServiceOrder_tenantId_id_key" ON "ServiceOrder"("tenantId","id");

CREATE INDEX "ServiceOrder_tenantId_status_createdAt_idx" ON "ServiceOrder"("tenantId","status","createdAt");

ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE RESTRICT;

CREATE TABLE "ServiceOrderRequest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL
);

CREATE UNIQUE INDEX "ServiceOrderRequest_tenantId_orderId_requestId_key" ON "ServiceOrderRequest"("tenantId","orderId","requestId");

CREATE INDEX "ServiceOrderRequest_tenantId_requestId_idx" ON "ServiceOrderRequest"("tenantId","requestId");

ALTER TABLE "ServiceOrderRequest" ADD CONSTRAINT "ServiceOrderRequest_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE RESTRICT;

CREATE TABLE "OrderMilestone" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "sourceReference" TEXT NOT NULL,
  "ownerId" TEXT,
  "dueDate" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "evidence" TEXT NOT NULL DEFAULT '',
  "reason" TEXT NOT NULL DEFAULT '',
  "completedBy" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "OrderMilestone_tenantId_id_key" ON "OrderMilestone"("tenantId","id");

CREATE INDEX "OrderMilestone_tenantId_orderId_status_idx" ON "OrderMilestone"("tenantId","orderId","status");

ALTER TABLE "OrderMilestone" ADD CONSTRAINT "OrderMilestone_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE RESTRICT;

CREATE TABLE "RenewalNeed" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "customerId" TEXT,
  "recipientId" TEXT,
  "sourceRequestId" TEXT NOT NULL,
  "sourceRowId" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "policySource" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "basisDate" TEXT NOT NULL,
  "documentValidUntil" TEXT,
  "nextCheckDate" TEXT,
  "contactAfter" TEXT,
  "confirmed" BOOLEAN NOT NULL DEFAULT false,
  "state" TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
  "reason" TEXT NOT NULL DEFAULT '',
  "ownerId" TEXT,
  "newRequestId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "RenewalNeed_tenantId_id_key" ON "RenewalNeed"("tenantId","id");

CREATE UNIQUE INDEX "RenewalNeed_tenantId_sourceKey_key" ON "RenewalNeed"("tenantId","sourceKey");

CREATE INDEX "RenewalNeed_tenantId_state_contactAfter_idx" ON "RenewalNeed"("tenantId","state","contactAfter");

ALTER TABLE "RenewalNeed" ADD CONSTRAINT "RenewalNeed_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE RESTRICT;

CREATE TABLE "RenewalContact" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "renewalId" TEXT NOT NULL,
  "occurredOn" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "RenewalContact_tenantId_renewalId_idx" ON "RenewalContact"("tenantId","renewalId");

ALTER TABLE "RenewalContact" ADD CONSTRAINT "RenewalContact_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE RESTRICT;

CREATE TABLE "ExternalEvidence" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "program" TEXT NOT NULL,
  "issuer" TEXT NOT NULL,
  "originalNumber" TEXT NOT NULL,
  "documentDate" TEXT NOT NULL,
  "validUntil" TEXT,
  "source" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'UNVERIFIED',
  "verificationNote" TEXT NOT NULL DEFAULT '',
  "verifiedBy" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "ExternalEvidence_tenantId_id_key" ON "ExternalEvidence"("tenantId","id");

CREATE INDEX "ExternalEvidence_tenantId_customerId_recipientId_idx" ON "ExternalEvidence"("tenantId","customerId","recipientId");

ALTER TABLE "ExternalEvidence" ADD CONSTRAINT "ExternalEvidence_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE RESTRICT;

CREATE TABLE "ServiceRuleVersion" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "serviceKey" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "source" TEXT NOT NULL,
  "applicability" TEXT NOT NULL,
  "checkedOn" TEXT,
  "checkedBy" TEXT,
  "effectiveFrom" TEXT,
  "effectiveTo" TEXT,
  "definition" JSONB NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "ServiceRuleVersion_tenantId_id_key" ON "ServiceRuleVersion"("tenantId","id");

CREATE UNIQUE INDEX "ServiceRuleVersion_tenantId_serviceKey_version_key" ON "ServiceRuleVersion"("tenantId","serviceKey","version");

ALTER TABLE "ServiceRuleVersion" ADD CONSTRAINT "ServiceRuleVersion_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE RESTRICT;

CREATE TABLE "DossierRecord" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "applicability" TEXT NOT NULL,
  "validUntil" TEXT,
  "ownerId" TEXT NOT NULL,
  "customerVisible" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "DossierRecord_tenantId_id_key" ON "DossierRecord"("tenantId","id");

CREATE INDEX "DossierRecord_tenantId_category_idx" ON "DossierRecord"("tenantId","category");

ALTER TABLE "DossierRecord" ADD CONSTRAINT "DossierRecord_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE RESTRICT;

CREATE TABLE "EmployerMembership" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "permissions" JSONB NOT NULL,
  "recipientIds" JSONB NOT NULL DEFAULT '[]',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "expiresAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "EmployerMembership_tenantId_id_key" ON "EmployerMembership"("tenantId","id");

CREATE UNIQUE INDEX "EmployerMembership_tenantId_customerId_userId_key" ON "EmployerMembership"("tenantId","customerId","userId");

ALTER TABLE "EmployerMembership" ADD CONSTRAINT "EmployerMembership_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE RESTRICT;

CREATE TABLE "PortalProposal" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "requestRevision" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "changes" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "resolution" TEXT NOT NULL DEFAULT '',
  "resolvedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "PortalProposal_tenantId_id_key" ON "PortalProposal"("tenantId","id");

CREATE INDEX "PortalProposal_tenantId_orderId_status_idx" ON "PortalProposal"("tenantId","orderId","status");

ALTER TABLE "PortalProposal" ADD CONSTRAINT "PortalProposal_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE RESTRICT;

CREATE TABLE "PaymentEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "amountMinor" TEXT NOT NULL,
  "occurredOn" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "reconciliationRequired" BOOLEAN NOT NULL DEFAULT false,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "PaymentEvent_tenantId_orderId_idx" ON "PaymentEvent"("tenantId","orderId");

ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE RESTRICT;

CREATE TABLE "FinancialDocument" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "documentDate" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "FinancialDocument_tenantId_id_key" ON "FinancialDocument"("tenantId","id");

CREATE UNIQUE INDEX "FinancialDocument_tenantId_type_number_key" ON "FinancialDocument"("tenantId","type","number");

ALTER TABLE "FinancialDocument" ADD CONSTRAINT "FinancialDocument_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE RESTRICT;

CREATE TABLE "ValueAttachment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "orderId" TEXT,
  "evidenceId" TEXT,
  "dossierId" TEXT,
  "financialDocumentId" TEXT,
  "category" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL UNIQUE,
  "sha256" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "customerVisible" BOOLEAN NOT NULL DEFAULT false,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "ValueAttachment_tenantId_id_key" ON "ValueAttachment"("tenantId","id");

ALTER TABLE "ValueAttachment" ADD CONSTRAINT "ValueAttachment_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE RESTRICT;

ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_customerId_fk" FOREIGN KEY ("tenantId","customerId") REFERENCES "CustomerOrganization"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_payerId_fk" FOREIGN KEY ("tenantId","payerId") REFERENCES "CustomerOrganization"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_ownerId_fk" FOREIGN KEY ("tenantId","ownerId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_createdBy_fk" FOREIGN KEY ("tenantId","createdBy") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "ServiceOrderRequest" ADD CONSTRAINT "ServiceOrderRequest_orderId_fk" FOREIGN KEY ("tenantId","orderId") REFERENCES "ServiceOrder"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "ServiceOrderRequest" ADD CONSTRAINT "ServiceOrderRequest_requestId_fk" FOREIGN KEY ("tenantId","requestId") REFERENCES "PrintRequest"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "OrderMilestone" ADD CONSTRAINT "OrderMilestone_orderId_fk" FOREIGN KEY ("tenantId","orderId") REFERENCES "ServiceOrder"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "OrderMilestone" ADD CONSTRAINT "OrderMilestone_ownerId_fk" FOREIGN KEY ("tenantId","ownerId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "OrderMilestone" ADD CONSTRAINT "OrderMilestone_completedBy_fk" FOREIGN KEY ("tenantId","completedBy") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "RenewalNeed" ADD CONSTRAINT "RenewalNeed_customerId_fk" FOREIGN KEY ("tenantId","customerId") REFERENCES "CustomerOrganization"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "RenewalNeed" ADD CONSTRAINT "RenewalNeed_recipientId_fk" FOREIGN KEY ("tenantId","recipientId") REFERENCES "Recipient"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "RenewalNeed" ADD CONSTRAINT "RenewalNeed_sourceRequestId_fk" FOREIGN KEY ("tenantId","sourceRequestId") REFERENCES "PrintRequest"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "RenewalNeed" ADD CONSTRAINT "RenewalNeed_newRequestId_fk" FOREIGN KEY ("tenantId","newRequestId") REFERENCES "PrintRequest"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "RenewalNeed" ADD CONSTRAINT "RenewalNeed_ownerId_fk" FOREIGN KEY ("tenantId","ownerId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "RenewalContact" ADD CONSTRAINT "RenewalContact_renewalId_fk" FOREIGN KEY ("tenantId","renewalId") REFERENCES "RenewalNeed"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "RenewalContact" ADD CONSTRAINT "RenewalContact_actorId_fk" FOREIGN KEY ("tenantId","actorId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "ExternalEvidence" ADD CONSTRAINT "ExternalEvidence_customerId_fk" FOREIGN KEY ("tenantId","customerId") REFERENCES "CustomerOrganization"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "ExternalEvidence" ADD CONSTRAINT "ExternalEvidence_recipientId_fk" FOREIGN KEY ("tenantId","recipientId") REFERENCES "Recipient"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "ExternalEvidence" ADD CONSTRAINT "ExternalEvidence_createdBy_fk" FOREIGN KEY ("tenantId","createdBy") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "ExternalEvidence" ADD CONSTRAINT "ExternalEvidence_verifiedBy_fk" FOREIGN KEY ("tenantId","verifiedBy") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "ServiceRuleVersion" ADD CONSTRAINT "ServiceRuleVersion_createdBy_fk" FOREIGN KEY ("tenantId","createdBy") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "ServiceRuleVersion" ADD CONSTRAINT "ServiceRuleVersion_checkedBy_fk" FOREIGN KEY ("tenantId","checkedBy") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "DossierRecord" ADD CONSTRAINT "DossierRecord_ownerId_fk" FOREIGN KEY ("tenantId","ownerId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "EmployerMembership" ADD CONSTRAINT "EmployerMembership_customerId_fk" FOREIGN KEY ("tenantId","customerId") REFERENCES "CustomerOrganization"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "EmployerMembership" ADD CONSTRAINT "EmployerMembership_userId_fk" FOREIGN KEY ("tenantId","userId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "EmployerMembership" ADD CONSTRAINT "EmployerMembership_createdBy_fk" FOREIGN KEY ("tenantId","createdBy") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "PortalProposal" ADD CONSTRAINT "PortalProposal_orderId_fk" FOREIGN KEY ("tenantId","orderId") REFERENCES "ServiceOrder"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "PortalProposal" ADD CONSTRAINT "PortalProposal_requestId_fk" FOREIGN KEY ("tenantId","requestId") REFERENCES "PrintRequest"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "PortalProposal" ADD CONSTRAINT "PortalProposal_membershipId_fk" FOREIGN KEY ("tenantId","membershipId") REFERENCES "EmployerMembership"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "PortalProposal" ADD CONSTRAINT "PortalProposal_resolvedBy_fk" FOREIGN KEY ("tenantId","resolvedBy") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_orderId_fk" FOREIGN KEY ("tenantId","orderId") REFERENCES "ServiceOrder"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_createdBy_fk" FOREIGN KEY ("tenantId","createdBy") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "FinancialDocument" ADD CONSTRAINT "FinancialDocument_orderId_fk" FOREIGN KEY ("tenantId","orderId") REFERENCES "ServiceOrder"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "FinancialDocument" ADD CONSTRAINT "FinancialDocument_createdBy_fk" FOREIGN KEY ("tenantId","createdBy") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "ValueAttachment" ADD CONSTRAINT "ValueAttachment_orderId_fk" FOREIGN KEY ("tenantId","orderId") REFERENCES "ServiceOrder"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "ValueAttachment" ADD CONSTRAINT "ValueAttachment_evidenceId_fk" FOREIGN KEY ("tenantId","evidenceId") REFERENCES "ExternalEvidence"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "ValueAttachment" ADD CONSTRAINT "ValueAttachment_dossierId_fk" FOREIGN KEY ("tenantId","dossierId") REFERENCES "DossierRecord"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "ValueAttachment" ADD CONSTRAINT "ValueAttachment_financialDocumentId_fk" FOREIGN KEY ("tenantId","financialDocumentId") REFERENCES "FinancialDocument"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "ValueAttachment" ADD CONSTRAINT "ValueAttachment_createdBy_fk" FOREIGN KEY ("tenantId","createdBy") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;

ALTER TABLE "ServiceOrder" ADD CONSTRAINT order_status CHECK(status IN ('OPEN','COMPLETED','CANCELLED'));

ALTER TABLE "OrderMilestone" ADD CONSTRAINT milestone_source CHECK(source IN ('NORMATIVE','CONTRACT','RECOMMENDATION')), ADD CONSTRAINT milestone_status CHECK(status IN ('PENDING','DONE','WAIVED')), ADD CONSTRAINT normative_cannot_be_waived CHECK(NOT(source='NORMATIVE' AND status='WAIVED'));

ALTER TABLE "RenewalNeed" ADD CONSTRAINT renewal_state CHECK(state IN ('NEEDS_REVIEW','CONFIRMED','CONTACTED','IRRELEVANT','DEFERRED','ORDER_AGREED'));

ALTER TABLE "ExternalEvidence" ADD CONSTRAINT external_evidence_status CHECK(status IN ('UNVERIFIED','VERIFIED','SUPERSEDED'));

ALTER TABLE "PaymentEvent" ADD CONSTRAINT payment_integer CHECK("amountMinor" ~ '^-?(0|[1-9][0-9]{0,15})$');

ALTER TABLE "ValueAttachment" ADD CONSTRAINT attachment_one_owner CHECK(num_nonnulls("orderId","evidenceId","dossierId","financialDocumentId")=1), ADD CONSTRAINT attachment_bounds CHECK(size>0 AND size<=1048576);

ALTER TABLE "User" DROP CONSTRAINT user_role;
ALTER TABLE "User" ADD CONSTRAINT user_role CHECK(role IN ('ADMIN','OPERATOR','VIEWER','EMPLOYER'));

CREATE TRIGGER demo_immutable BEFORE UPDATE OR DELETE ON "RenewalContact" FOR EACH ROW EXECUTE FUNCTION demo_immutable();
CREATE TRIGGER demo_immutable BEFORE UPDATE OR DELETE ON "PaymentEvent" FOR EACH ROW EXECUTE FUNCTION demo_immutable();
CREATE TRIGGER demo_immutable BEFORE UPDATE OR DELETE ON "ServiceRuleVersion" FOR EACH ROW EXECUTE FUNCTION demo_immutable();
CREATE TRIGGER demo_immutable BEFORE UPDATE OR DELETE ON "FinancialDocument" FOR EACH ROW EXECUTE FUNCTION demo_immutable();
CREATE TRIGGER demo_immutable BEFORE UPDATE OR DELETE ON "ValueAttachment" FOR EACH ROW EXECUTE FUNCTION demo_immutable();

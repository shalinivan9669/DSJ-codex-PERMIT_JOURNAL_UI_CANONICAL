-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Almaty',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'VIEWER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sessionVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "csrfHash" TEXT NOT NULL,
    "sessionVersion" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssuerProfileVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "profile" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssuerProfileVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerOrganization" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nameRu" TEXT NOT NULL,
    "nameKz" TEXT NOT NULL DEFAULT '',
    "bin" TEXT NOT NULL DEFAULT '',
    "addressRu" TEXT NOT NULL DEFAULT '',
    "addressKz" TEXT NOT NULL DEFAULT '',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerOrganization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recipient" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "customerId" TEXT,
    "demoMode" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "draft" JSONB NOT NULL,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "searchText" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "correctsIssuanceId" TEXT,
    "correctionReason" TEXT,
    "legacySourceId" TEXT,

    CONSTRAINT "PrintRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "RequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contract" JSONB NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Issuance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "sourceRevision" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "inputHash" TEXT NOT NULL,
    "profileVersionId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correctsIssuanceId" TEXT,
    "correctionReason" TEXT,
    "legacySourceId" TEXT,

    CONSTRAINT "Issuance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssuanceEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "issuanceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "relatedIssuanceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssuanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssuedDocument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "issuanceId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "templateVersionId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "registrationNumber" TEXT,
    "documentDate" TEXT NOT NULL,
    "replacesDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssuedDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NumberSequence" (
    "tenantId" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "prefix" TEXT NOT NULL DEFAULT '',
    "suffix" TEXT NOT NULL DEFAULT '',
    "padding" INTEGER NOT NULL DEFAULT 5,
    "policyVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "NumberSequence_pkey" PRIMARY KEY ("tenantId","namespace")
);

-- CreateTable
CREATE TABLE "NumberReservation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "formattedNumber" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NumberReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RenderInputSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "issuanceId" TEXT,
    "templateVersionId" TEXT,
    "profileVersionId" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "inputHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RenderInputSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "issuanceId" TEXT,
    "documentId" TEXT,
    "snapshotId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "logicalKey" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "leaseOwner" TEXT,
    "fencingToken" INTEGER NOT NULL DEFAULT 0,
    "heartbeatAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "correlationId" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "artifactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GenerationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "issuanceId" TEXT,
    "documentId" TEXT,
    "format" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "templateVersion" TEXT,
    "rendererVersion" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "provenance" TEXT NOT NULL DEFAULT 'ORIGINAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoAsset" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalStorageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'image/png',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhotoAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyOperation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "rows" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "id" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" TEXT NOT NULL,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegacyMapping" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "provenance" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegacyMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_id_key" ON "User"("tenantId", "id");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "IssuerProfileVersion_tenantId_version_key" ON "IssuerProfileVersion"("tenantId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "IssuerProfileVersion_tenantId_id_key" ON "IssuerProfileVersion"("tenantId", "id");

-- CreateIndex
CREATE INDEX "CustomerOrganization_tenantId_nameRu_idx" ON "CustomerOrganization"("tenantId", "nameRu");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerOrganization_tenantId_id_key" ON "CustomerOrganization"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Recipient_tenantId_id_key" ON "Recipient"("tenantId", "id");

-- CreateIndex
CREATE INDEX "PrintRequest_tenantId_status_createdAt_idx" ON "PrintRequest"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrintRequest_tenantId_id_key" ON "PrintRequest"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PrintRequest_tenantId_legacySourceId_key" ON "PrintRequest"("tenantId", "legacySourceId");

-- CreateIndex
CREATE INDEX "RequestItem_tenantId_requestId_idx" ON "RequestItem"("tenantId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "RequestItem_requestId_rowId_key" ON "RequestItem"("requestId", "rowId");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateVersion_tenantId_templateId_version_key" ON "TemplateVersion"("tenantId", "templateId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateVersion_tenantId_id_key" ON "TemplateVersion"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Issuance_requestId_sourceRevision_key" ON "Issuance"("requestId", "sourceRevision");

-- CreateIndex
CREATE UNIQUE INDEX "Issuance_tenantId_id_key" ON "Issuance"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Issuance_tenantId_legacySourceId_key" ON "Issuance"("tenantId", "legacySourceId");

-- CreateIndex
CREATE INDEX "IssuanceEvent_tenantId_issuanceId_idx" ON "IssuanceEvent"("tenantId", "issuanceId");

-- CreateIndex
CREATE UNIQUE INDEX "IssuedDocument_tenantId_id_key" ON "IssuedDocument"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "IssuedDocument_issuanceId_rowId_assignmentId_key" ON "IssuedDocument"("issuanceId", "rowId", "assignmentId");

-- CreateIndex
CREATE INDEX "NumberReservation_tenantId_documentId_idx" ON "NumberReservation"("tenantId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "NumberReservation_tenantId_namespace_sequence_key" ON "NumberReservation"("tenantId", "namespace", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "NumberReservation_tenantId_namespace_formattedNumber_key" ON "NumberReservation"("tenantId", "namespace", "formattedNumber");

-- CreateIndex
CREATE UNIQUE INDEX "RenderInputSnapshot_tenantId_id_key" ON "RenderInputSnapshot"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "GenerationJob_logicalKey_key" ON "GenerationJob"("logicalKey");

-- CreateIndex
CREATE INDEX "GenerationJob_status_runAfter_leaseUntil_idx" ON "GenerationJob"("status", "runAfter", "leaseUntil");

-- CreateIndex
CREATE INDEX "GenerationJob_tenantId_requestId_idx" ON "GenerationJob"("tenantId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "GenerationJob_tenantId_id_key" ON "GenerationJob"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Artifact_storageKey_key" ON "Artifact"("storageKey");

-- CreateIndex
CREATE INDEX "Artifact_tenantId_requestId_idx" ON "Artifact"("tenantId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "Artifact_tenantId_id_key" ON "Artifact"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoAsset_storageKey_key" ON "PhotoAsset"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoAsset_tenantId_id_key" ON "PhotoAsset"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyOperation_tenantId_command_idempotencyKey_key" ON "IdempotencyOperation"("tenantId", "command", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_tenantId_id_key" ON "ImportBatch"("tenantId", "id");

-- CreateIndex
CREATE INDEX "AuditEvent_tenantId_createdAt_idx" ON "AuditEvent"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LegacyMapping_tenantId_sourceSystem_sourceId_key" ON "LegacyMapping"("tenantId", "sourceSystem", "sourceId");

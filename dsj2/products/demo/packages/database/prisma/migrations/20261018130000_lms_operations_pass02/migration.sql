-- DropIndex
DROP INDEX "Enrollment_tenantId_courseVersionId_recipientId_key";

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "mfaRequiredStaff" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "publicCatalogEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publicSummaryKz" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "publicSummaryRu" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Enrollment" ADD COLUMN     "attemptCycle" TEXT NOT NULL DEFAULT 'INITIAL';

-- AlterTable
ALTER TABLE "LmsLearningNotification" ADD COLUMN     "deliveryKey" TEXT,
ADD COLUMN     "enrollmentId" TEXT,
ADD COLUMN     "href" TEXT,
ADD COLUMN     "sourceId" TEXT,
ADD COLUMN     "sourceType" TEXT NOT NULL DEFAULT 'SESSION',
ADD COLUMN     "titleKz" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "titleRu" TEXT NOT NULL DEFAULT '',
ALTER COLUMN "eventId" DROP NOT NULL,
ALTER COLUMN "eventRevision" DROP NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lmsPreferences" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "mfaVerifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CustomerOrganization" ADD COLUMN     "city" TEXT,
ADD COLUMN     "citySource" TEXT;

-- CreateTable
CREATE TABLE "LmsApplication" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "courseVersionId" TEXT NOT NULL,
    "actorId" TEXT,
    "recipientId" TEXT,
    "customerId" TEXT,
    "contact" JSONB NOT NULL,
    "quantity" INTEGER NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "state" TEXT NOT NULL DEFAULT 'NEW',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "assignedTo" TEXT,
    "reason" TEXT,
    "orderId" TEXT,
    "operationId" TEXT,
    "enrollmentId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LmsApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsEmployerImport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "confirmedBy" TEXT,
    "courseVersionId" TEXT NOT NULL,
    "sourceOrderId" TEXT,
    "sourceRequestId" TEXT,
    "groupId" TEXT,
    "groupName" TEXT NOT NULL DEFAULT '',
    "dueAt" TIMESTAMP(3),
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "input" JSONB NOT NULL,
    "inputHash" TEXT NOT NULL,
    "operationId" TEXT,
    "cursor" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LmsEmployerImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsEmployerImportRow" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "sourceRow" INTEGER NOT NULL,
    "recipientId" TEXT,
    "outcome" TEXT NOT NULL,
    "errorCode" TEXT,

    CONSTRAINT "LmsEmployerImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsReportJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "requestedRole" TEXT NOT NULL,
    "scopePolicy" JSONB NOT NULL,
    "reportKind" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "requestKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "leaseOwner" TEXT,
    "fencingToken" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "storageKey" TEXT,
    "sha256" TEXT,
    "size" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LmsReportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsReportRow" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "enrollmentId" TEXT,
    "payload" JSONB NOT NULL,

    CONSTRAINT "LmsReportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsReportScope" (
    "tenantId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,

    CONSTRAINT "LmsReportScope_pkey" PRIMARY KEY ("jobId","enrollmentId")
);

-- CreateTable
CREATE TABLE "MfaFactor" (
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "secretCiphertext" TEXT,
    "pendingCiphertext" TEXT,
    "pendingExpiresAt" TIMESTAMP(3),
    "enabledAt" TIMESTAMP(3),
    "lastTotpStep" INTEGER NOT NULL DEFAULT -1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MfaFactor_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "MfaRecoveryCode" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MfaRecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MfaChallenge" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionVersion" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MfaChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MfaReauth" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MfaReauth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsNotificationEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "kind" TEXT NOT NULL,
    "deliveryKey" TEXT NOT NULL,
    "titleRu" TEXT NOT NULL,
    "titleKz" TEXT NOT NULL,
    "href" TEXT,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "leaseOwner" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LmsNotificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsNotificationCheckpoint" (
    "tenantId" TEXT NOT NULL,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enrollmentCursor" TEXT NOT NULL DEFAULT '',
    "scannedAt" TIMESTAMP(3),

    CONSTRAINT "LmsNotificationCheckpoint_pkey" PRIMARY KEY ("tenantId")
);

-- CreateIndex
CREATE INDEX "LmsApplication_tenantId_state_createdAt_id_idx" ON "LmsApplication"("tenantId", "state", "createdAt", "id");

-- CreateIndex
CREATE INDEX "LmsApplication_tenantId_actorId_createdAt_id_idx" ON "LmsApplication"("tenantId", "actorId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "LmsApplication_tenantId_orderId_idx" ON "LmsApplication"("tenantId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "LmsApplication_tenantId_id_key" ON "LmsApplication"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LmsApplication_tenantId_idempotencyKey_key" ON "LmsApplication"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "LmsEmployerImport_tenantId_actorId_updatedAt_idx" ON "LmsEmployerImport"("tenantId", "actorId", "updatedAt");

-- CreateIndex
CREATE INDEX "LmsEmployerImport_state_leaseUntil_idx" ON "LmsEmployerImport"("state", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "LmsEmployerImport_tenantId_id_key" ON "LmsEmployerImport"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LmsEmployerImportRow_tenantId_importId_sourceRow_key" ON "LmsEmployerImportRow"("tenantId", "importId", "sourceRow");

-- CreateIndex
CREATE INDEX "LmsReportJob_status_runAfter_leaseUntil_idx" ON "LmsReportJob"("status", "runAfter", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "LmsReportJob_tenantId_requestedBy_requestKey_key" ON "LmsReportJob"("tenantId", "requestedBy", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "LmsReportJob_tenantId_id_key" ON "LmsReportJob"("tenantId", "id");

-- CreateIndex
CREATE INDEX "LmsReportRow_tenantId_jobId_enrollmentId_idx" ON "LmsReportRow"("tenantId", "jobId", "enrollmentId");

-- CreateIndex
CREATE UNIQUE INDEX "LmsReportRow_jobId_ordinal_key" ON "LmsReportRow"("jobId", "ordinal");

-- CreateIndex
CREATE INDEX "LmsReportScope_tenantId_jobId_idx" ON "LmsReportScope"("tenantId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "MfaFactor_tenantId_userId_key" ON "MfaFactor"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "MfaRecoveryCode_userId_codeHash_key" ON "MfaRecoveryCode"("userId", "codeHash");

-- CreateIndex
CREATE INDEX "MfaChallenge_userId_createdAt_idx" ON "MfaChallenge"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LmsNotificationEvent_state_runAfter_leaseUntil_idx" ON "LmsNotificationEvent"("state", "runAfter", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "LmsNotificationEvent_tenantId_userId_deliveryKey_key" ON "LmsNotificationEvent"("tenantId", "userId", "deliveryKey");

-- CreateIndex
CREATE UNIQUE INDEX "Enrollment_tenantId_courseVersionId_recipientId_attemptCycl_key" ON "Enrollment"("tenantId", "courseVersionId", "recipientId", "attemptCycle");

-- CreateIndex
CREATE UNIQUE INDEX "LmsLearningNotification_tenantId_userId_deliveryKey_key" ON "LmsLearningNotification"("tenantId", "userId", "deliveryKey");
-- Cross-tenant references remain impossible at storage boundary.
DO $$ DECLARE spec text[]; BEGIN
 FOREACH spec SLICE 1 IN ARRAY ARRAY[
 ['LmsApplication','courseVersionId','CourseVersion'],['LmsApplication','actorId','User'],['LmsApplication','recipientId','Recipient'],['LmsApplication','customerId','CustomerOrganization'],['LmsApplication','orderId','ServiceOrder'],
 ['LmsEmployerImport','customerId','CustomerOrganization'],['LmsEmployerImport','actorId','User'],['LmsEmployerImport','courseVersionId','CourseVersion'],['LmsEmployerImportRow','importId','LmsEmployerImport'],
 ['LmsReportJob','requestedBy','User'],['LmsReportRow','jobId','LmsReportJob'],['LmsReportScope','jobId','LmsReportJob'],['LmsReportScope','enrollmentId','Enrollment'],
 ['MfaFactor','userId','User'],['MfaRecoveryCode','userId','User'],['MfaChallenge','userId','User'],['MfaReauth','userId','User'],
 ['LmsNotificationEvent','userId','User'],['LmsNotificationEvent','enrollmentId','Enrollment'],['LmsLearningNotification','enrollmentId','Enrollment']
 ] LOOP EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("tenantId", %I) REFERENCES %I ("tenantId",id) ON DELETE RESTRICT',spec[1],spec[1]||'_'||spec[2]||'_scope_fk',spec[2],spec[3]); END LOOP;
END $$;
ALTER TABLE "LmsNotificationCheckpoint" ADD CONSTRAINT "LmsNotificationCheckpoint_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE RESTRICT;
ALTER TABLE "LmsApplication" ADD CONSTRAINT "LmsApplication_quantity_check" CHECK (quantity BETWEEN 1 AND 5000);
ALTER TABLE "LmsReportRow" ADD CONSTRAINT "LmsReportRow_ordinal_check" CHECK (ordinal >= 0);

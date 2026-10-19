-- AlterTable
ALTER TABLE "LessonProgress" ADD COLUMN     "activeSeconds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastInteractionAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "LmsTeachingEvent" ADD COLUMN     "location" TEXT,
ADD COLUMN     "practiceCriteria" JSONB;

-- AlterTable
ALTER TABLE "RegulatoryManualEvidence" ADD COLUMN     "requestKey" TEXT,
ADD COLUMN     "supersedesId" TEXT;

-- AlterTable
ALTER TABLE "PaymentEvent" ADD COLUMN     "requestKey" TEXT;

-- CreateTable
CREATE TABLE "RegulatorySource" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegulatorySource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegulatorySourceRevision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedBy" TEXT,
    "checkedAt" TIMESTAMP(3),
    "reviewNote" TEXT,

    CONSTRAINT "RegulatorySourceRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegulatorySourceTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceRevisionId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "dueAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "note" TEXT NOT NULL DEFAULT '',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegulatorySourceTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsReportEntityScope" (
    "tenantId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "entityKind" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,

    CONSTRAINT "LmsReportEntityScope_pkey" PRIMARY KEY ("jobId","entityKind","entityId")
);

-- CreateTable
CREATE TABLE "EmployerAccessRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationName" TEXT NOT NULL,
    "bin" TEXT NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "activeKey" TEXT,
    "requestKey" TEXT NOT NULL,
    "decisionNote" TEXT,
    "customerId" TEXT,
    "membershipId" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployerAccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RegulatorySource_tenantId_title_idx" ON "RegulatorySource"("tenantId", "title");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatorySource_tenantId_id_key" ON "RegulatorySource"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatorySourceRevision_tenantId_id_key" ON "RegulatorySourceRevision"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatorySourceRevision_tenantId_sourceId_version_key" ON "RegulatorySourceRevision"("tenantId", "sourceId", "version");

-- CreateIndex
CREATE INDEX "RegulatorySourceTask_tenantId_status_dueAt_idx" ON "RegulatorySourceTask"("tenantId", "status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatorySourceTask_tenantId_id_key" ON "RegulatorySourceTask"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatorySourceTask_tenantId_sourceRevisionId_courseId_key" ON "RegulatorySourceTask"("tenantId", "sourceRevisionId", "courseId");

-- CreateIndex
CREATE INDEX "LmsReportEntityScope_tenantId_jobId_idx" ON "LmsReportEntityScope"("tenantId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployerAccessRequest_activeKey_key" ON "EmployerAccessRequest"("activeKey");

-- CreateIndex
CREATE INDEX "EmployerAccessRequest_tenantId_userId_createdAt_idx" ON "EmployerAccessRequest"("tenantId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "EmployerAccessRequest_tenantId_status_createdAt_idx" ON "EmployerAccessRequest"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmployerAccessRequest_tenantId_requestKey_key" ON "EmployerAccessRequest"("tenantId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatoryManualEvidence_tenantId_requestKey_key" ON "RegulatoryManualEvidence"("tenantId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatoryManualEvidence_tenantId_id_key" ON "RegulatoryManualEvidence"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEvent_tenantId_orderId_requestKey_key" ON "PaymentEvent"("tenantId", "orderId", "requestKey");

-- Preserve immutable history while admitting explicit in-person reviews.
ALTER TABLE "LmsReviewDecision" DROP CONSTRAINT learning_review_target;
ALTER TABLE "LmsReviewDecision" ADD CONSTRAINT learning_review_target CHECK (
  ("targetType"='PRACTICE' AND "attemptId" IS NULL AND "submissionRevisionId" IS NULL)
  OR ("targetType"<>'PRACTICE' AND ("attemptId" IS NOT NULL)::int + ("submissionRevisionId" IS NOT NULL)::int = 1)
);
ALTER TABLE "LessonProgress" ADD CONSTRAINT learning_active_seconds CHECK ("activeSeconds">=0);
ALTER TABLE "EmployerAccessRequest" ADD CONSTRAINT employer_access_state CHECK (
  status IN ('PENDING','APPROVED','REJECTED') AND (status='PENDING')=("activeKey" IS NOT NULL)
);
ALTER TABLE "RegulatorySourceTask" ADD CONSTRAINT regulatory_source_task_state CHECK (status IN ('OPEN','IN_REVIEW','RESOLVED','DISMISSED'));
DO $$ DECLARE spec TEXT[]; BEGIN
 FOREACH spec SLICE 1 IN ARRAY ARRAY[
 ['RegulatorySource','createdBy','User'],
 ['RegulatorySourceRevision','sourceId','RegulatorySource'],['RegulatorySourceRevision','createdBy','User'],['RegulatorySourceRevision','checkedBy','User'],
 ['RegulatorySourceTask','sourceId','RegulatorySource'],['RegulatorySourceTask','sourceRevisionId','RegulatorySourceRevision'],['RegulatorySourceTask','courseId','Course'],['RegulatorySourceTask','assigneeId','User'],['RegulatorySourceTask','createdBy','User'],
 ['RegulatoryManualEvidence','supersedesId','RegulatoryManualEvidence'],['LmsReportEntityScope','jobId','LmsReportJob'],
 ['EmployerAccessRequest','userId','User'],['EmployerAccessRequest','customerId','CustomerOrganization'],['EmployerAccessRequest','membershipId','EmployerMembership'],['EmployerAccessRequest','resolvedBy','User']
 ] LOOP EXECUTE format('ALTER TABLE %I ADD FOREIGN KEY ("tenantId",%I) REFERENCES %I ("tenantId",id) ON DELETE RESTRICT',spec[1],spec[2],spec[3]); END LOOP;
END $$;
CREATE TRIGGER regulatory_source_revision_immutable BEFORE UPDATE OR DELETE ON "RegulatorySourceRevision" FOR EACH ROW EXECUTE FUNCTION demo_lms_immutable();

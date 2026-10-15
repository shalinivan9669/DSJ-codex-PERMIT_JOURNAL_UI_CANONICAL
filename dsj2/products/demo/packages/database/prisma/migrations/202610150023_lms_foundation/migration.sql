-- CreateTable
CREATE TABLE "LearnerProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearnerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearnerInvite" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "customerId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearnerInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearnerRecovery" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearnerRecovery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "titleRu" TEXT NOT NULL,
    "titleKz" TEXT NOT NULL DEFAULT '',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegulatoryProfileVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEEDS_LEGAL_REVIEW',
    "definition" JSONB NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegulatoryProfileVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "content" JSONB NOT NULL,
    "regulatoryProfileVersionId" TEXT NOT NULL,
    "snapshotHash" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsMaterial" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LmsMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enrollment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "courseVersionId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "learnerUserId" TEXT,
    "customerId" TEXT,
    "groupKey" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "assignedBy" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonProgress" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "positionSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "intervals" JSONB NOT NULL DEFAULT '[]',
    "lastSeenAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LessonProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamAttempt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "courseVersionId" TEXT NOT NULL,
    "regulatoryProfileVersionId" TEXT NOT NULL,
    "assessmentKind" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "activeKey" TEXT,
    "snapshot" JSONB NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "score" INTEGER,
    "maximum" INTEGER,
    "verdict" TEXT,

    CONSTRAINT "ExamAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsExternalEvidence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "documentDate" TEXT NOT NULL,
    "examAt" TIMESTAMP(3),
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewMethod" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LmsExternalEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerifiedExamResult" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "supersedesResultId" TEXT,
    "attemptId" TEXT,
    "externalEvidenceId" TEXT,
    "assessmentKind" TEXT NOT NULL,
    "regulatoryProfileVersionId" TEXT NOT NULL,
    "courseVersionId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "score" INTEGER,
    "maximum" INTEGER,
    "eligible" BOOLEAN NOT NULL DEFAULT false,
    "examAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot" JSONB NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "VerifiedExamResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsResultEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LmsResultEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsDocumentLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "legalForm" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "issuanceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PREPARED',
    "originalReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LmsDocumentLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "timezone" TEXT NOT NULL,
    "coverageFrom" TEXT NOT NULL,
    "coverageUntil" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "approvedBy" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegulatoryOutbox" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PREPARE',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "leaseToken" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "RegulatoryOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SanitaryJournalEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "signatureState" TEXT NOT NULL DEFAULT 'AWAITING_SIGNATURE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SanitaryJournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegulatoryBatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "regulatoryProfileVersionId" TEXT NOT NULL,
    "calendarVersionId" TEXT,
    "destination" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "dueDate" TEXT,
    "slaBasis" TEXT NOT NULL DEFAULT 'INTERNAL_SLA',

    CONSTRAINT "RegulatoryBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegulatoryBatchItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "resultRevision" INTEGER NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "snapshotHash" TEXT NOT NULL,

    CONSTRAINT "RegulatoryBatchItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'NOT_CONNECTED',
    "contractVersion" TEXT,
    "capabilities" JSONB NOT NULL DEFAULT '{}',
    "dataAccessPolicy" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationDelivery" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "batchItemId" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "resultRevision" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "contractVersion" TEXT NOT NULL DEFAULT 'internal-v1',
    "state" TEXT NOT NULL DEFAULT 'READY',
    "lmkState" TEXT NOT NULL DEFAULT 'NOT_CONFIRMED',
    "externalId" TEXT,
    "correlationId" TEXT NOT NULL,
    "leaseToken" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryAttempt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "leaseToken" INTEGER NOT NULL,
    "operation" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "transportStatus" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationReceipt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegulatoryManualEvidence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'OPERATOR_ATTESTED',
    "storageKey" TEXT,
    "sha256" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegulatoryManualEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LearnerProfile_tenantId_userId_key" ON "LearnerProfile"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "LearnerProfile_tenantId_recipientId_key" ON "LearnerProfile"("tenantId", "recipientId");

-- CreateIndex
CREATE UNIQUE INDEX "LearnerProfile_tenantId_id_key" ON "LearnerProfile"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LearnerInvite_tokenHash_key" ON "LearnerInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "LearnerInvite_tenantId_recipientId_idx" ON "LearnerInvite"("tenantId", "recipientId");

-- CreateIndex
CREATE UNIQUE INDEX "LearnerRecovery_tokenHash_key" ON "LearnerRecovery"("tokenHash");

-- CreateIndex
CREATE INDEX "Course_tenantId_archived_createdAt_idx" ON "Course"("tenantId", "archived", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Course_tenantId_id_key" ON "Course"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatoryProfileVersion_tenantId_courseId_version_key" ON "RegulatoryProfileVersion"("tenantId", "courseId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatoryProfileVersion_tenantId_id_key" ON "RegulatoryProfileVersion"("tenantId", "id");

-- CreateIndex
CREATE INDEX "CourseVersion_tenantId_status_createdAt_idx" ON "CourseVersion"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CourseVersion_tenantId_courseId_version_key" ON "CourseVersion"("tenantId", "courseId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CourseVersion_tenantId_id_key" ON "CourseVersion"("tenantId", "id");

-- CreateIndex
CREATE INDEX "LmsMaterial_tenantId_courseId_idx" ON "LmsMaterial"("tenantId", "courseId");

-- CreateIndex
CREATE UNIQUE INDEX "LmsMaterial_tenantId_id_key" ON "LmsMaterial"("tenantId", "id");

-- CreateIndex
CREATE INDEX "Enrollment_tenantId_learnerUserId_status_idx" ON "Enrollment"("tenantId", "learnerUserId", "status");

-- CreateIndex
CREATE INDEX "Enrollment_tenantId_customerId_status_idx" ON "Enrollment"("tenantId", "customerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Enrollment_tenantId_courseVersionId_recipientId_key" ON "Enrollment"("tenantId", "courseVersionId", "recipientId");

-- CreateIndex
CREATE UNIQUE INDEX "Enrollment_tenantId_id_key" ON "Enrollment"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LessonProgress_tenantId_enrollmentId_lessonId_key" ON "LessonProgress"("tenantId", "enrollmentId", "lessonId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamAttempt_activeKey_key" ON "ExamAttempt"("activeKey");

-- CreateIndex
CREATE INDEX "ExamAttempt_state_deadlineAt_idx" ON "ExamAttempt"("state", "deadlineAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExamAttempt_tenantId_enrollmentId_ordinal_key" ON "ExamAttempt"("tenantId", "enrollmentId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "ExamAttempt_tenantId_id_key" ON "ExamAttempt"("tenantId", "id");

-- CreateIndex
CREATE INDEX "LmsExternalEvidence_tenantId_enrollmentId_idx" ON "LmsExternalEvidence"("tenantId", "enrollmentId");

-- CreateIndex
CREATE UNIQUE INDEX "LmsExternalEvidence_tenantId_id_key" ON "LmsExternalEvidence"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "VerifiedExamResult_attemptId_key" ON "VerifiedExamResult"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "VerifiedExamResult_externalEvidenceId_key" ON "VerifiedExamResult"("externalEvidenceId");

-- CreateIndex
CREATE INDEX "VerifiedExamResult_tenantId_eligible_confirmedAt_idx" ON "VerifiedExamResult"("tenantId", "eligible", "confirmedAt");

-- CreateIndex
CREATE UNIQUE INDEX "VerifiedExamResult_tenantId_enrollmentId_revision_key" ON "VerifiedExamResult"("tenantId", "enrollmentId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "VerifiedExamResult_tenantId_id_key" ON "VerifiedExamResult"("tenantId", "id");

-- CreateIndex
CREATE INDEX "LmsResultEvent_tenantId_resultId_idx" ON "LmsResultEvent"("tenantId", "resultId");

-- CreateIndex
CREATE INDEX "LmsDocumentLink_tenantId_requestId_idx" ON "LmsDocumentLink"("tenantId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "LmsDocumentLink_tenantId_resultId_documentType_key" ON "LmsDocumentLink"("tenantId", "resultId", "documentType");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarVersion_tenantId_name_version_key" ON "CalendarVersion"("tenantId", "name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarVersion_tenantId_id_key" ON "CalendarVersion"("tenantId", "id");

-- CreateIndex
CREATE INDEX "RegulatoryOutbox_status_availableAt_lockedUntil_idx" ON "RegulatoryOutbox"("status", "availableAt", "lockedUntil");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatoryOutbox_tenantId_resultId_kind_key" ON "RegulatoryOutbox"("tenantId", "resultId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "SanitaryJournalEntry_tenantId_resultId_key" ON "SanitaryJournalEntry"("tenantId", "resultId");

-- CreateIndex
CREATE UNIQUE INDEX "SanitaryJournalEntry_tenantId_id_key" ON "SanitaryJournalEntry"("tenantId", "id");

-- CreateIndex
CREATE INDEX "RegulatoryBatch_tenantId_state_dueAt_idx" ON "RegulatoryBatch"("tenantId", "state", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatoryBatch_tenantId_id_key" ON "RegulatoryBatch"("tenantId", "id");

-- CreateIndex
CREATE INDEX "RegulatoryBatchItem_tenantId_batchId_idx" ON "RegulatoryBatchItem"("tenantId", "batchId");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatoryBatchItem_tenantId_resultId_key" ON "RegulatoryBatchItem"("tenantId", "resultId");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatoryBatchItem_tenantId_id_key" ON "RegulatoryBatchItem"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConnection_tenantId_destination_key" ON "IntegrationConnection"("tenantId", "destination");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationDelivery_idempotencyKey_key" ON "IntegrationDelivery"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationDelivery_correlationId_key" ON "IntegrationDelivery"("correlationId");

-- CreateIndex
CREATE INDEX "IntegrationDelivery_state_availableAt_lockedUntil_idx" ON "IntegrationDelivery"("state", "availableAt", "lockedUntil");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationDelivery_tenantId_destination_resultId_resultRev_key" ON "IntegrationDelivery"("tenantId", "destination", "resultId", "resultRevision");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationDelivery_tenantId_id_key" ON "IntegrationDelivery"("tenantId", "id");

-- CreateIndex
CREATE INDEX "DeliveryAttempt_tenantId_deliveryId_idx" ON "DeliveryAttempt"("tenantId", "deliveryId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationReceipt_tenantId_deliveryId_receiptId_key" ON "IntegrationReceipt"("tenantId", "deliveryId", "receiptId");

-- CreateIndex
CREATE INDEX "RegulatoryManualEvidence_tenantId_deliveryId_idx" ON "RegulatoryManualEvidence"("tenantId", "deliveryId");

-- Existing account roles are preserved; newly introduced roles have no legacy privileges.
ALTER TABLE "User" DROP CONSTRAINT user_role;
ALTER TABLE "User" ADD CONSTRAINT user_role CHECK (role IN ('ADMIN','DIRECTOR','OPERATOR','VIEWER','EMPLOYER','LEARNER'));
ALTER TABLE "CourseVersion" ADD CONSTRAINT lms_course_state CHECK (status IN ('DRAFT','PUBLISHED'));
ALTER TABLE "ExamAttempt" ADD CONSTRAINT lms_attempt_state CHECK (state IN ('IN_PROGRESS','FINISHED'));
ALTER TABLE "ExamAttempt" ADD CONSTRAINT lms_attempt_active CHECK ((state='IN_PROGRESS')=("activeKey" IS NOT NULL));
ALTER TABLE "VerifiedExamResult" ADD CONSTRAINT lms_result_source CHECK (
  ("assessmentKind" IN ('PRACTICE','CENTER_EXAM') AND "attemptId" IS NOT NULL AND "externalEvidenceId" IS NULL) OR
  ("assessmentKind"='EXTERNAL_AUTHORIZED' AND "attemptId" IS NULL AND "externalEvidenceId" IS NOT NULL));
ALTER TABLE "VerifiedExamResult" ADD CONSTRAINT lms_result_practice CHECK (NOT eligible OR ("assessmentKind"<>'PRACTICE' AND verdict='PASSED'));

DO $$
DECLARE spec TEXT[];
BEGIN
  FOREACH spec SLICE 1 IN ARRAY ARRAY[
    ['LearnerProfile','userId','User'], ['LearnerProfile','recipientId','Recipient'],
    ['LearnerInvite','recipientId','Recipient'], ['LearnerInvite','customerId','CustomerOrganization'],
    ['LearnerRecovery','userId','User'], ['CourseVersion','courseId','Course'],
    ['CourseVersion','regulatoryProfileVersionId','RegulatoryProfileVersion'], ['RegulatoryProfileVersion','courseId','Course'],
    ['LmsMaterial','courseId','Course'], ['Enrollment','courseVersionId','CourseVersion'],
    ['Enrollment','recipientId','Recipient'], ['Enrollment','learnerUserId','User'], ['Enrollment','customerId','CustomerOrganization'],
    ['LessonProgress','enrollmentId','Enrollment'], ['ExamAttempt','enrollmentId','Enrollment'],
    ['ExamAttempt','courseVersionId','CourseVersion'], ['ExamAttempt','regulatoryProfileVersionId','RegulatoryProfileVersion'],
    ['LmsExternalEvidence','enrollmentId','Enrollment'], ['VerifiedExamResult','enrollmentId','Enrollment'],
    ['VerifiedExamResult','attemptId','ExamAttempt'], ['VerifiedExamResult','externalEvidenceId','LmsExternalEvidence'],
    ['VerifiedExamResult','recipientId','Recipient'], ['VerifiedExamResult','courseVersionId','CourseVersion'],
    ['VerifiedExamResult','regulatoryProfileVersionId','RegulatoryProfileVersion'], ['VerifiedExamResult','supersedesResultId','VerifiedExamResult'],
    ['LmsResultEvent','resultId','VerifiedExamResult'], ['LmsDocumentLink','resultId','VerifiedExamResult'],
    ['LmsDocumentLink','requestId','PrintRequest'], ['LmsDocumentLink','issuanceId','Issuance'],
    ['RegulatoryOutbox','resultId','VerifiedExamResult'], ['SanitaryJournalEntry','resultId','VerifiedExamResult'],
    ['SanitaryJournalEntry','enrollmentId','Enrollment'], ['RegulatoryBatch','regulatoryProfileVersionId','RegulatoryProfileVersion'],
    ['RegulatoryBatch','calendarVersionId','CalendarVersion'], ['RegulatoryBatchItem','batchId','RegulatoryBatch'],
    ['RegulatoryBatchItem','resultId','VerifiedExamResult'], ['RegulatoryBatchItem','journalEntryId','SanitaryJournalEntry'],
    ['IntegrationDelivery','batchItemId','RegulatoryBatchItem'], ['IntegrationDelivery','resultId','VerifiedExamResult'],
    ['DeliveryAttempt','deliveryId','IntegrationDelivery'], ['IntegrationReceipt','deliveryId','IntegrationDelivery'],
    ['RegulatoryManualEvidence','deliveryId','IntegrationDelivery']
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD FOREIGN KEY ("tenantId",%I) REFERENCES %I ("tenantId",id) ON DELETE RESTRICT',spec[1],spec[2],spec[3]);
  END LOOP;
END $$;

CREATE FUNCTION demo_lms_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'LMS_IMMUTABLE_HISTORY'; END $$;
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['VerifiedExamResult','LmsResultEvent','CalendarVersion','RegulatoryBatch','RegulatoryBatchItem','IntegrationReceipt','DeliveryAttempt','RegulatoryManualEvidence'] LOOP
    EXECUTE format('CREATE TRIGGER lms_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION demo_lms_immutable()',t);
  END LOOP;
END $$;
CREATE FUNCTION demo_lms_published_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='PUBLISHED' THEN RAISE EXCEPTION 'LMS_PUBLISHED_IMMUTABLE'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lms_course_immutable BEFORE UPDATE OR DELETE ON "CourseVersion" FOR EACH ROW EXECUTE FUNCTION demo_lms_published_immutable();
CREATE FUNCTION demo_lms_profile_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM "CourseVersion" WHERE "regulatoryProfileVersionId"=OLD.id AND status='PUBLISHED') THEN RAISE EXCEPTION 'LMS_PROFILE_IMMUTABLE'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lms_profile_immutable BEFORE UPDATE OR DELETE ON "RegulatoryProfileVersion" FOR EACH ROW EXECUTE FUNCTION demo_lms_profile_immutable();
CREATE FUNCTION demo_lms_delivery_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'LMS_DELIVERY_IMMUTABLE'; END IF;
  IF ROW(NEW."tenantId",NEW."batchItemId",NEW."resultId",NEW."resultRevision",NEW.destination,NEW."payloadHash",NEW.payload,NEW."idempotencyKey",NEW."contractVersion",NEW."correlationId")
     IS DISTINCT FROM ROW(OLD."tenantId",OLD."batchItemId",OLD."resultId",OLD."resultRevision",OLD.destination,OLD."payloadHash",OLD.payload,OLD."idempotencyKey",OLD."contractVersion",OLD."correlationId") THEN RAISE EXCEPTION 'LMS_DELIVERY_IMMUTABLE'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lms_delivery_immutable BEFORE UPDATE OR DELETE ON "IntegrationDelivery" FOR EACH ROW EXECUTE FUNCTION demo_lms_delivery_immutable();

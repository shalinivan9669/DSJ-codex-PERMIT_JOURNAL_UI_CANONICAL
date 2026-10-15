-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "assignmentPauseReason" TEXT,
ADD COLUMN     "assignmentPaused" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Enrollment" ADD COLUMN     "dueAtOverride" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "groupId" TEXT,
ADD COLUMN     "sourceOrderId" TEXT,
ADD COLUMN     "sourceRequestId" TEXT;

-- AlterTable
ALTER TABLE "WorkerHeartbeat" ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "stoppedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LmsGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "courseVersionId" TEXT NOT NULL,
    "customerId" TEXT,
    "sourceRequestId" TEXT,
    "sourceOrderId" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LmsGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsGroupMember" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "excludedAt" TIMESTAMP(3),
    "excludedBy" TEXT,

    CONSTRAINT "LmsGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsAssignmentOperation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "groupId" TEXT,
    "cursor" INTEGER NOT NULL DEFAULT 0,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LmsAssignmentOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsAssignmentRow" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "outcome" TEXT NOT NULL,
    "errorCode" TEXT,

    CONSTRAINT "LmsAssignmentRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionBank" (
    "searchText" TEXT NOT NULL DEFAULT '',
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "topic" TEXT NOT NULL DEFAULT '',
    "originCourseId" TEXT,
    "originQuestionId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionBank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionRevision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "questionBankId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "semanticHash" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegulatoryReview" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegulatoryReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LmsGroup_tenantId_createdAt_id_idx" ON "LmsGroup"("tenantId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LmsGroup_tenantId_id_key" ON "LmsGroup"("tenantId", "id");

-- CreateIndex
CREATE INDEX "LmsGroupMember_tenantId_groupId_excludedAt_idx" ON "LmsGroupMember"("tenantId", "groupId", "excludedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LmsGroupMember_tenantId_groupId_enrollmentId_key" ON "LmsGroupMember"("tenantId", "groupId", "enrollmentId");

-- CreateIndex
CREATE UNIQUE INDEX "LmsAssignmentOperation_tenantId_id_key" ON "LmsAssignmentOperation"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LmsAssignmentRow_tenantId_operationId_recipientId_key" ON "LmsAssignmentRow"("tenantId", "operationId", "recipientId");

-- CreateIndex
CREATE INDEX "QuestionBank_tenantId_category_topic_idx" ON "QuestionBank"("tenantId", "category", "topic");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionBank_tenantId_id_key" ON "QuestionBank"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionRevision_tenantId_id_key" ON "QuestionRevision"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionRevision_tenantId_questionBankId_version_key" ON "QuestionRevision"("tenantId", "questionBankId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatoryReview_tenantId_courseId_key" ON "RegulatoryReview"("tenantId", "courseId");

-- CreateIndex
CREATE INDEX "CourseVersion_tenantId_courseId_version_idx" ON "CourseVersion"("tenantId", "courseId", "version");

-- CreateIndex
CREATE INDEX "Enrollment_tenantId_assignedAt_id_idx" ON "Enrollment"("tenantId", "assignedAt", "id");

-- CreateIndex
CREATE INDEX "Enrollment_tenantId_groupId_assignedAt_id_idx" ON "Enrollment"("tenantId", "groupId", "assignedAt", "id");

-- CreateIndex
CREATE INDEX "Enrollment_tenantId_sourceOrderId_assignedAt_id_idx" ON "Enrollment"("tenantId", "sourceOrderId", "assignedAt", "id");

-- CreateIndex
CREATE INDEX "Enrollment_tenantId_sourceRequestId_idx" ON "Enrollment"("tenantId", "sourceRequestId");

-- CreateIndex
CREATE INDEX "Enrollment_tenantId_dueAt_id_idx" ON "Enrollment"("tenantId", "dueAt", "id");

-- CreateIndex
CREATE INDEX "LmsDocumentLink_tenantId_resultId_idx" ON "LmsDocumentLink"("tenantId", "resultId");

-- Nullable legacy origins stay unknown. New references retain the composite tenant boundary.
DO $$ DECLARE spec TEXT[]; BEGIN
  FOREACH spec SLICE 1 IN ARRAY ARRAY[
    ['Enrollment','groupId','LmsGroup'],['Enrollment','sourceRequestId','PrintRequest'],['Enrollment','sourceOrderId','ServiceOrder'],
    ['LmsGroup','courseVersionId','CourseVersion'],['LmsGroup','customerId','CustomerOrganization'],['LmsGroup','sourceRequestId','PrintRequest'],['LmsGroup','sourceOrderId','ServiceOrder'],
    ['LmsGroupMember','groupId','LmsGroup'],['LmsGroupMember','enrollmentId','Enrollment'],
    ['LmsAssignmentOperation','groupId','LmsGroup'],['LmsAssignmentRow','operationId','LmsAssignmentOperation'],['LmsAssignmentRow','enrollmentId','Enrollment'],
    ['QuestionBank','originCourseId','Course'],['QuestionRevision','questionBankId','QuestionBank'],['RegulatoryReview','courseId','Course']
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD FOREIGN KEY ("tenantId",%I) REFERENCES %I ("tenantId",id) ON DELETE RESTRICT',spec[1],spec[2],spec[3]);
  END LOOP;
END $$;
CREATE TRIGGER question_revision_immutable BEFORE UPDATE OR DELETE ON "QuestionRevision" FOR EACH ROW EXECUTE FUNCTION demo_lms_immutable();
CREATE TRIGGER assignment_row_immutable BEFORE UPDATE OR DELETE ON "LmsAssignmentRow" FOR EACH ROW EXECUTE FUNCTION demo_lms_immutable();
ALTER TABLE "RegulatoryReview" ADD CONSTRAINT regulatory_review_state CHECK (status IN ('CURRENT','CHANGES_EXPECTED','CHANGED','REPEALED','REVIEW_REQUIRED'));
ALTER TABLE "LmsAssignmentOperation" ADD CONSTRAINT assignment_operation_state CHECK (state IN ('PENDING','PAUSED','COMPLETED'));
CREATE FUNCTION demo_lms_enrollment_origin_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF ROW(NEW."tenantId",NEW."courseVersionId",NEW."recipientId",NEW."groupId",NEW."sourceRequestId",NEW."sourceOrderId")
  IS DISTINCT FROM ROW(OLD."tenantId",OLD."courseVersionId",OLD."recipientId",OLD."groupId",OLD."sourceRequestId",OLD."sourceOrderId") THEN RAISE EXCEPTION 'LMS_ENROLLMENT_ORIGIN_IMMUTABLE'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER enrollment_origin_immutable BEFORE UPDATE ON "Enrollment" FOR EACH ROW EXECUTE FUNCTION demo_lms_enrollment_origin_immutable();

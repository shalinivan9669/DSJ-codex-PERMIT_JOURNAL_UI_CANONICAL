-- DropIndex
DROP INDEX "ExamAttempt_tenantId_enrollmentId_ordinal_key";

-- AlterTable
ALTER TABLE "Enrollment" ADD COLUMN     "accessPolicy" JSONB,
ADD COLUMN     "startsAt" TIMESTAMP(3),
ALTER COLUMN "dueAt" DROP NOT NULL;

-- AlterTable
ALTER TABLE "LmsGroup" ADD COLUMN     "accessPolicy" JSONB,
ADD COLUMN     "startsAt" TIMESTAMP(3),
ALTER COLUMN "dueAt" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ExamAttempt" ADD COLUMN     "assessmentId" TEXT NOT NULL DEFAULT 'FINAL',
ADD COLUMN     "gradedAt" TIMESTAMP(3),
ADD COLUMN     "grading" JSONB,
ADD COLUMN     "purpose" TEXT NOT NULL DEFAULT 'FINAL',
ADD COLUMN     "submittedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LmsTeachingBinding" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "groupId" TEXT,
    "permissions" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedBy" TEXT,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "LmsTeachingBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsSubmission" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "elementId" TEXT NOT NULL,
    "currentRevision" INTEGER NOT NULL DEFAULT 0,
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "draft" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LmsSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsSubmissionRevision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "snapshot" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LmsSubmissionRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsSubmissionAttachment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "elementId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LmsSubmissionAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsReviewDecision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "decisionKey" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "questionScores" JSONB,
    "feedback" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot" JSONB NOT NULL,
    "attemptId" TEXT,
    "submissionRevisionId" TEXT,

    CONSTRAINT "LmsReviewDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsLearningCompletion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "courseVersionId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LmsLearningCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsTeachingEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "courseVersionId" TEXT NOT NULL,
    "requirementId" TEXT,
    "titleRu" TEXT NOT NULL,
    "titleKz" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "teacherUserId" TEXT NOT NULL,
    "joinUrl" TEXT,
    "recordingUrl" TEXT,
    "recordingMaterialId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "operationId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LmsTeachingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsTeachingEventChange" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "commandId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LmsTeachingEventChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsAttendance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'MANUAL',
    "actorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LmsAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsLearningNotification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventRevision" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LmsLearningNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsMaterialBinding" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LmsMaterialBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsMaterialState" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "familyId" TEXT NOT NULL,
    "supersedesMaterialId" TEXT,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LmsMaterialState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsCourseReview" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "courseVersionId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "feedback" TEXT NOT NULL DEFAULT '',
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LmsCourseReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LmsTeachingBinding_tenantId_userId_courseId_revokedAt_idx" ON "LmsTeachingBinding"("tenantId", "userId", "courseId", "revokedAt");

-- CreateIndex
CREATE INDEX "LmsTeachingBinding_tenantId_groupId_revokedAt_idx" ON "LmsTeachingBinding"("tenantId", "groupId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LmsTeachingBinding_tenantId_id_key" ON "LmsTeachingBinding"("tenantId", "id");

-- CreateIndex
CREATE INDEX "LmsSubmission_tenantId_state_updatedAt_idx" ON "LmsSubmission"("tenantId", "state", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LmsSubmission_tenantId_id_key" ON "LmsSubmission"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LmsSubmission_tenantId_enrollmentId_elementId_key" ON "LmsSubmission"("tenantId", "enrollmentId", "elementId");

-- CreateIndex
CREATE UNIQUE INDEX "LmsSubmissionRevision_tenantId_id_key" ON "LmsSubmissionRevision"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LmsSubmissionRevision_tenantId_submissionId_revision_key" ON "LmsSubmissionRevision"("tenantId", "submissionId", "revision");

-- CreateIndex
CREATE INDEX "LmsSubmissionAttachment_tenantId_enrollmentId_elementId_idx" ON "LmsSubmissionAttachment"("tenantId", "enrollmentId", "elementId");

-- CreateIndex
CREATE UNIQUE INDEX "LmsSubmissionAttachment_tenantId_id_key" ON "LmsSubmissionAttachment"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LmsReviewDecision_tenantId_id_key" ON "LmsReviewDecision"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LmsReviewDecision_tenantId_decisionKey_key" ON "LmsReviewDecision"("tenantId", "decisionKey");

-- CreateIndex
CREATE UNIQUE INDEX "LmsReviewDecision_tenantId_targetType_targetId_revision_key" ON "LmsReviewDecision"("tenantId", "targetType", "targetId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "LmsLearningCompletion_tenantId_id_key" ON "LmsLearningCompletion"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LmsLearningCompletion_tenantId_enrollmentId_key" ON "LmsLearningCompletion"("tenantId", "enrollmentId");

-- CreateIndex
CREATE INDEX "LmsTeachingEvent_tenantId_groupId_startsAt_idx" ON "LmsTeachingEvent"("tenantId", "groupId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "LmsTeachingEvent_tenantId_id_key" ON "LmsTeachingEvent"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LmsTeachingEvent_tenantId_operationId_key" ON "LmsTeachingEvent"("tenantId", "operationId");

-- CreateIndex
CREATE UNIQUE INDEX "LmsTeachingEventChange_tenantId_id_key" ON "LmsTeachingEventChange"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LmsTeachingEventChange_tenantId_eventId_revision_key" ON "LmsTeachingEventChange"("tenantId", "eventId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "LmsTeachingEventChange_tenantId_commandId_key" ON "LmsTeachingEventChange"("tenantId", "commandId");

-- CreateIndex
CREATE INDEX "LmsAttendance_tenantId_enrollmentId_eventId_revision_idx" ON "LmsAttendance"("tenantId", "enrollmentId", "eventId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "LmsAttendance_tenantId_id_key" ON "LmsAttendance"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LmsAttendance_tenantId_eventId_enrollmentId_revision_key" ON "LmsAttendance"("tenantId", "eventId", "enrollmentId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "LmsAttendance_tenantId_commandId_enrollmentId_key" ON "LmsAttendance"("tenantId", "commandId", "enrollmentId");

-- CreateIndex
CREATE INDEX "LmsLearningNotification_tenantId_userId_createdAt_idx" ON "LmsLearningNotification"("tenantId", "userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LmsLearningNotification_tenantId_id_key" ON "LmsLearningNotification"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LmsLearningNotification_tenantId_userId_eventId_eventRevisi_key" ON "LmsLearningNotification"("tenantId", "userId", "eventId", "eventRevision");

-- CreateIndex
CREATE INDEX "LmsMaterialBinding_tenantId_courseId_idx" ON "LmsMaterialBinding"("tenantId", "courseId");

-- CreateIndex
CREATE UNIQUE INDEX "LmsMaterialBinding_tenantId_materialId_courseId_key" ON "LmsMaterialBinding"("tenantId", "materialId", "courseId");

-- CreateIndex
CREATE INDEX "LmsMaterialState_tenantId_familyId_idx" ON "LmsMaterialState"("tenantId", "familyId");

-- CreateIndex
CREATE UNIQUE INDEX "LmsMaterialState_tenantId_materialId_key" ON "LmsMaterialState"("tenantId", "materialId");

-- CreateIndex
CREATE INDEX "LmsCourseReview_tenantId_courseVersionId_revision_createdAt_idx" ON "LmsCourseReview"("tenantId", "courseVersionId", "revision", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LmsCourseReview_tenantId_id_key" ON "LmsCourseReview"("tenantId", "id");

-- CreateIndex
CREATE INDEX "ExamAttempt_tenantId_enrollmentId_assessmentId_state_idx" ON "ExamAttempt"("tenantId", "enrollmentId", "assessmentId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "ExamAttempt_tenantId_enrollmentId_assessmentId_ordinal_key" ON "ExamAttempt"("tenantId", "enrollmentId", "assessmentId", "ordinal");

-- Additive learning wave. Old snapshots and dueAt values are deliberately untouched.
ALTER TABLE "User" DROP CONSTRAINT user_role;
ALTER TABLE "User" ADD CONSTRAINT user_role CHECK (role IN ('ADMIN','DIRECTOR','OPERATOR','VIEWER','EMPLOYER','LEARNER','TEACHER','METHODIST','EXPERT'));
ALTER TABLE "ExamAttempt" DROP CONSTRAINT lms_attempt_state;
ALTER TABLE "ExamAttempt" DROP CONSTRAINT lms_attempt_active;
ALTER TABLE "ExamAttempt" ADD CONSTRAINT lms_attempt_state CHECK (state IN ('IN_PROGRESS','AWAITING_REVIEW','FINISHED'));
ALTER TABLE "ExamAttempt" ADD CONSTRAINT lms_attempt_active CHECK ((state IN ('IN_PROGRESS','AWAITING_REVIEW'))=("activeKey" IS NOT NULL));
ALTER TABLE "ExamAttempt" ADD CONSTRAINT learning_attempt_purpose CHECK (purpose IN ('FINAL','LEARNING_FINAL','INTERMEDIATE'));
ALTER TABLE "LmsTeachingBinding" ADD CONSTRAINT learning_binding_role CHECK (role IN ('TEACHER','METHODIST','EXPERT'));
ALTER TABLE "LmsSubmission" ADD CONSTRAINT learning_submission_state CHECK (state IN ('DRAFT','SUBMITTED','RETURNED','REJECTED','ACCEPTED'));
ALTER TABLE "LmsReviewDecision" ADD CONSTRAINT learning_review_target CHECK (("attemptId" IS NOT NULL)::int + ("submissionRevisionId" IS NOT NULL)::int = 1);
ALTER TABLE "LmsTeachingEvent" ADD CONSTRAINT learning_event_period CHECK ("endsAt">"startsAt");
ALTER TABLE "LmsTeachingEvent" ADD CONSTRAINT learning_event_state CHECK (status IN ('SCHEDULED','CANCELLED'));
ALTER TABLE "LmsAttendance" ADD CONSTRAINT learning_attendance_state CHECK (status IN ('PRESENT','ABSENT') AND method='MANUAL');
ALTER TABLE "LmsCourseReview" ADD CONSTRAINT learning_course_review_state CHECK (state IN ('PENDING','APPROVED','RETURNED'));
ALTER TABLE "Enrollment" ADD CONSTRAINT learning_access_period CHECK ("startsAt" IS NULL OR "dueAt" IS NULL OR "dueAt">"startsAt");
ALTER TABLE "LmsGroup" ADD CONSTRAINT learning_group_access_period CHECK ("startsAt" IS NULL OR "dueAt" IS NULL OR "dueAt">"startsAt");
DO $$ DECLARE spec TEXT[]; BEGIN
 FOREACH spec SLICE 1 IN ARRAY ARRAY[
 ['LmsTeachingBinding','userId','User'],['LmsTeachingBinding','courseId','Course'],['LmsTeachingBinding','groupId','LmsGroup'],
 ['LmsSubmission','enrollmentId','Enrollment'],['LmsSubmissionRevision','submissionId','LmsSubmission'],
 ['LmsSubmissionAttachment','enrollmentId','Enrollment'],['LmsSubmissionAttachment','uploadedBy','User'],
 ['LmsReviewDecision','actorId','User'],['LmsReviewDecision','attemptId','ExamAttempt'],['LmsReviewDecision','submissionRevisionId','LmsSubmissionRevision'],
 ['LmsLearningCompletion','enrollmentId','Enrollment'],['LmsLearningCompletion','courseVersionId','CourseVersion'],
 ['LmsTeachingEvent','groupId','LmsGroup'],['LmsTeachingEvent','courseVersionId','CourseVersion'],['LmsTeachingEvent','teacherUserId','User'],['LmsTeachingEvent','recordingMaterialId','LmsMaterial'],
 ['LmsTeachingEventChange','eventId','LmsTeachingEvent'],['LmsTeachingEventChange','actorId','User'],
 ['LmsAttendance','eventId','LmsTeachingEvent'],['LmsAttendance','enrollmentId','Enrollment'],['LmsAttendance','actorId','User'],
 ['LmsLearningNotification','userId','User'],['LmsLearningNotification','eventId','LmsTeachingEvent'],
 ['LmsMaterialBinding','materialId','LmsMaterial'],['LmsMaterialBinding','courseId','Course'],
 ['LmsMaterialState','materialId','LmsMaterial'],['LmsMaterialState','supersedesMaterialId','LmsMaterial'],
 ['LmsCourseReview','courseVersionId','CourseVersion'],['LmsCourseReview','actorId','User']
 ] LOOP EXECUTE format('ALTER TABLE %I ADD FOREIGN KEY ("tenantId",%I) REFERENCES %I ("tenantId",id) ON DELETE RESTRICT',spec[1],spec[2],spec[3]); END LOOP;
END $$;
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['LmsSubmissionRevision','LmsSubmissionAttachment','LmsReviewDecision','LmsLearningCompletion','LmsTeachingEventChange','LmsAttendance','LmsCourseReview','LmsMaterial'] LOOP
 EXECUTE format('CREATE TRIGGER learning_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION demo_lms_immutable()',t);
 END LOOP;
END $$;
CREATE FUNCTION demo_learning_attempt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'LEARNING_ATTEMPT_HISTORY_IMMUTABLE'; END IF;
 IF ROW(OLD."tenantId",OLD."enrollmentId",OLD."courseVersionId",OLD."regulatoryProfileVersionId",OLD."assessmentKind",OLD."assessmentId",OLD.purpose,OLD.ordinal,OLD.snapshot,OLD."startedAt",OLD."deadlineAt") IS DISTINCT FROM ROW(NEW."tenantId",NEW."enrollmentId",NEW."courseVersionId",NEW."regulatoryProfileVersionId",NEW."assessmentKind",NEW."assessmentId",NEW.purpose,NEW.ordinal,NEW.snapshot,NEW."startedAt",NEW."deadlineAt") THEN RAISE EXCEPTION 'LEARNING_ATTEMPT_SNAPSHOT_IMMUTABLE'; END IF;
 IF OLD.state='FINISHED' AND OLD IS DISTINCT FROM NEW THEN RAISE EXCEPTION 'LEARNING_FINAL_GRADE_IMMUTABLE'; END IF;
 IF OLD.state='AWAITING_REVIEW' AND (OLD.answers IS DISTINCT FROM NEW.answers OR OLD.sequence IS DISTINCT FROM NEW.sequence) THEN RAISE EXCEPTION 'LEARNING_SUBMITTED_ANSWERS_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER learning_attempt_immutable BEFORE UPDATE OR DELETE ON "ExamAttempt" FOR EACH ROW EXECUTE FUNCTION demo_learning_attempt_immutable();
CREATE FUNCTION demo_learning_result_purpose() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW."attemptId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ExamAttempt" a WHERE a."tenantId"=NEW."tenantId" AND a.id=NEW."attemptId" AND a.purpose='FINAL' AND a.state='FINISHED') THEN RAISE EXCEPTION 'LEARNING_RESULT_REQUIRES_FINAL'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER learning_result_purpose BEFORE INSERT ON "VerifiedExamResult" FOR EACH ROW EXECUTE FUNCTION demo_learning_result_purpose();
CREATE FUNCTION demo_learning_attendance_scope() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM "LmsTeachingEvent" event JOIN "Enrollment" e ON e."tenantId"=event."tenantId" AND e."courseVersionId"=event."courseVersionId" AND e."groupId"=event."groupId" WHERE event."tenantId"=NEW."tenantId" AND event.id=NEW."eventId" AND e.id=NEW."enrollmentId") THEN RAISE EXCEPTION 'LEARNING_ATTENDANCE_SCOPE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER learning_attendance_scope BEFORE INSERT ON "LmsAttendance" FOR EACH ROW EXECUTE FUNCTION demo_learning_attendance_scope();

-- A supervisor rejection closes the attempt without creating a verified result.
ALTER TABLE "ExamAttempt" DROP CONSTRAINT lms_attempt_state;
ALTER TABLE "ExamAttempt" ADD CONSTRAINT lms_attempt_state CHECK (state IN ('IN_PROGRESS','AWAITING_REVIEW','FINISHED','INVALIDATED'));
CREATE OR REPLACE FUNCTION demo_learning_attempt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'LEARNING_ATTEMPT_HISTORY_IMMUTABLE'; END IF;
 IF ROW(OLD."tenantId",OLD."enrollmentId",OLD."courseVersionId",OLD."regulatoryProfileVersionId",OLD."assessmentKind",OLD."assessmentId",OLD.purpose,OLD.ordinal,OLD.snapshot,OLD."startedAt",OLD."deadlineAt") IS DISTINCT FROM ROW(NEW."tenantId",NEW."enrollmentId",NEW."courseVersionId",NEW."regulatoryProfileVersionId",NEW."assessmentKind",NEW."assessmentId",NEW.purpose,NEW.ordinal,NEW.snapshot,NEW."startedAt",NEW."deadlineAt") THEN RAISE EXCEPTION 'LEARNING_ATTEMPT_SNAPSHOT_IMMUTABLE'; END IF;
 IF OLD.state IN ('FINISHED','INVALIDATED') AND OLD IS DISTINCT FROM NEW THEN RAISE EXCEPTION 'LEARNING_FINAL_GRADE_IMMUTABLE'; END IF;
 IF OLD.state='AWAITING_REVIEW' AND (OLD.answers IS DISTINCT FROM NEW.answers OR OLD.sequence IS DISTINCT FROM NEW.sequence) THEN RAISE EXCEPTION 'LEARNING_SUBMITTED_ANSWERS_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;

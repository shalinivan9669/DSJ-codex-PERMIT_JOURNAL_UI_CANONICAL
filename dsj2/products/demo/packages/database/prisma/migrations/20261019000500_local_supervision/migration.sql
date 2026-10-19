-- Add a distinct immutable manual-supervision journal; never a provider signature.
ALTER TABLE "LmsReviewDecision" DROP CONSTRAINT learning_review_target;
ALTER TABLE "LmsReviewDecision" ADD CONSTRAINT learning_review_target CHECK (
  ("targetType" IN ('PRACTICE','PROCTORING') AND "attemptId" IS NULL AND "submissionRevisionId" IS NULL)
  OR ("targetType" NOT IN ('PRACTICE','PROCTORING') AND ("attemptId" IS NOT NULL)::int + ("submissionRevisionId" IS NOT NULL)::int = 1)
);

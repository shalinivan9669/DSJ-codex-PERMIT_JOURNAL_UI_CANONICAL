-- Keep the original result per source unique while allowing immutable correction revisions.
DROP INDEX "VerifiedExamResult_attemptId_key";
DROP INDEX "VerifiedExamResult_externalEvidenceId_key";
CREATE UNIQUE INDEX "VerifiedExamResult_original_attempt_key" ON "VerifiedExamResult" ("attemptId") WHERE "supersedesResultId" IS NULL;
CREATE UNIQUE INDEX "VerifiedExamResult_original_external_key" ON "VerifiedExamResult" ("externalEvidenceId") WHERE "supersedesResultId" IS NULL;
ALTER TABLE "VerifiedExamResult" ADD CONSTRAINT "VerifiedExamResult_supersedes_tenant_fk" FOREIGN KEY ("tenantId","supersedesResultId") REFERENCES "VerifiedExamResult" ("tenantId",id);

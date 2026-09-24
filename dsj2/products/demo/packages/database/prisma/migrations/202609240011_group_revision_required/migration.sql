-- PostgreSQL CHECK accepts UNKNOWN; the GROUP branch must explicitly reject NULL.
ALTER TABLE "IssuedDocument" DROP CONSTRAINT document_owner;
ALTER TABLE "IssuedDocument" ADD CONSTRAINT document_owner CHECK (
  ("ownerKind"='INDIVIDUAL' AND "rowId" IS NOT NULL AND "assignmentId" IS NOT NULL AND "groupEventId" IS NULL AND "groupEventRevision" IS NULL)
  OR
  ("ownerKind"='GROUP' AND "rowId" IS NULL AND "assignmentId" IS NULL AND "groupEventId" IS NOT NULL AND "groupEventRevision" IS NOT NULL AND "groupEventRevision">=0)
);

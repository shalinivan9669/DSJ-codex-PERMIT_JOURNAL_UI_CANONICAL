-- Autosave is persisted preparation, never an implicit director submission.
ALTER TABLE "RequestProposal" DROP CONSTRAINT "RequestProposal_status_check";
ALTER TABLE "RequestProposal" ADD CONSTRAINT "RequestProposal_status_check" CHECK (status IN ('DRAFT','PENDING','APPROVED','REJECTED','SUPERSEDED'));

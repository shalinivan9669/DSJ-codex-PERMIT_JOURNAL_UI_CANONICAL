-- Approval and signature targets remain fixed even if an application write path regresses.
BEGIN;
CREATE FUNCTION demo_request_lifecycle_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.status='FINALIZED' AND OLD.status='DRAFT' AND NEW."approvalPolicy" AND NOT EXISTS(
   SELECT 1 FROM "RequestProposal" p JOIN "ProposalDecision" d ON d."tenantId"=p."tenantId" AND d."proposalId"=p.id
   WHERE p.id=NEW."approvedProposalId" AND p."tenantId"=NEW."tenantId" AND p."requestId"=NEW.id
     AND p.status='APPROVED' AND p.operation='SAVE' AND p.payload=NEW.draft AND p.revision=NEW.revision
     AND d.decision='APPROVE' AND d."proposalHash"=p."proposalHash"
     AND NOT EXISTS(SELECT 1 FROM "RequestProposal" n WHERE n."requestId"=p."requestId" AND n.revision>p.revision)) THEN
   RAISE EXCEPTION 'DEMO_APPROVAL_REQUIRED'; END IF;
 IF NEW.status='CANCELLED' AND OLD.status<>'CANCELLED' AND NOT EXISTS(
   SELECT 1 FROM "RequestProposal" p JOIN "ProposalDecision" d ON d."tenantId"=p."tenantId" AND d."proposalId"=p.id
   WHERE p.id=NEW."approvedProposalId" AND p."tenantId"=NEW."tenantId" AND p."requestId"=NEW.id
     AND p.status='APPROVED' AND p.operation='CANCEL' AND d.decision='APPROVE' AND d."proposalHash"=p."proposalHash") THEN
   RAISE EXCEPTION 'DEMO_APPROVAL_REQUIRED'; END IF;
 IF NEW."archivedAt" IS DISTINCT FROM OLD."archivedAt" AND NEW."archivedAt" IS NOT NULL AND NOT (
   EXISTS(SELECT 1 FROM "IssuanceWorkflow" w WHERE w."tenantId"=NEW."tenantId" AND w."requestId"=NEW.id AND w.status='ISSUED' AND w."completedAt" IS NOT NULL)
   OR EXISTS(SELECT 1 FROM "RequestProposal" p JOIN "ProposalDecision" d ON d."tenantId"=p."tenantId" AND d."proposalId"=p.id
     WHERE p.id=NEW."approvedProposalId" AND p."tenantId"=NEW."tenantId" AND p."requestId"=NEW.id
       AND p.status='APPROVED' AND p.operation='ARCHIVE' AND d.decision='APPROVE' AND d."proposalHash"=p."proposalHash")) THEN
   RAISE EXCEPTION 'DEMO_ARCHIVE_NOT_COMPLETE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER demo_request_lifecycle_guard BEFORE UPDATE ON "PrintRequest" FOR EACH ROW EXECUTE FUNCTION demo_request_lifecycle_guard();
CREATE FUNCTION demo_signing_session_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['status','providerReference'])<>(to_jsonb(OLD)-ARRAY['status','providerReference'])
   OR (OLD.status<>'PENDING' AND to_jsonb(NEW)<>to_jsonb(OLD))
   OR (OLD."providerReference" IS NOT NULL AND NEW."providerReference" IS DISTINCT FROM OLD."providerReference") THEN
   RAISE EXCEPTION 'DEMO_SIGNING_SESSION_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER demo_signing_session_guard BEFORE UPDATE OR DELETE ON "SigningSession" FOR EACH ROW EXECUTE FUNCTION demo_signing_session_guard();
COMMIT;

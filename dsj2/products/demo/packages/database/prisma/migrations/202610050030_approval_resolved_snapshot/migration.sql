-- Additive: historical proposal bytes and decisions stay untouched.
ALTER TABLE "RequestProposal" ADD COLUMN "resolvedSnapshot" JSONB;
CREATE OR REPLACE FUNCTION demo_proposal_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'DEMO_PROPOSAL_IMMUTABLE'; END IF;
 IF OLD.status='DRAFT' AND NEW.status='PENDING' AND OLD."resolvedSnapshot" IS NULL AND
   (to_jsonb(NEW)-ARRAY['status','assignments','scopeHash','proposalHash','submittedBy','submittedAt','resolvedSnapshot'])=(to_jsonb(OLD)-ARRAY['status','assignments','scopeHash','proposalHash','submittedBy','submittedAt','resolvedSnapshot']) THEN RETURN NEW; END IF;
 IF (to_jsonb(NEW)-'status')<>(to_jsonb(OLD)-'status') OR
   NOT (OLD.status='PENDING' AND NEW.status IN ('APPROVED','REJECTED','SUPERSEDED') OR OLD.status='APPROVED' AND NEW.status='SUPERSEDED') THEN
   RAISE EXCEPTION 'DEMO_PROPOSAL_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;

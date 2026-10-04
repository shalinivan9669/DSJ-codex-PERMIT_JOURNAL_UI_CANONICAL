CREATE OR REPLACE FUNCTION demo_issuance_approval_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 -- Pre-scope, imported historical issuances keep their original insertion contract.
 -- The scoped finalize API always supplies scopeHash and cannot select this path.
 IF NEW."scopeHash" IS NULL THEN RETURN NEW; END IF;
 -- Explicit existing migration identity admits frozen historical imports only.
 IF NEW."legacySourceId" IS NOT NULL AND EXISTS(SELECT 1 FROM "PrintRequest" r WHERE r.id=NEW."requestId" AND r."tenantId"=NEW."tenantId" AND r."legacySourceId"=NEW."legacySourceId" AND r.status='FINALIZED') THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM "PrintRequest" r JOIN "RequestProposal" p ON p."tenantId"=r."tenantId" AND p."requestId"=r.id
 JOIN "ProposalDecision" d ON d."tenantId"=p."tenantId" AND d."proposalId"=p.id
 WHERE r.id=NEW."requestId" AND r."tenantId"=NEW."tenantId" AND r.revision=NEW."sourceRevision" AND r.status='DRAFT'
 AND p.status='APPROVED' AND p.operation='SAVE' AND d.decision='APPROVE' AND d."proposalHash"=p."proposalHash"
 AND (p."scopeHash"=NEW."scopeHash" AND demo_approval_scope(p.payload,p.assignments)=demo_approval_scope(r.draft,p.assignments)
 OR p."scopeHash" IS NULL AND p.id=r."approvedProposalId" AND p.revision=r.revision AND p.payload=r.draft)) THEN RAISE EXCEPTION 'DEMO_APPROVAL_REQUIRED'; END IF;
 RETURN NEW;
END $$;

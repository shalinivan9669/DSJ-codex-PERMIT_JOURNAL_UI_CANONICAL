-- Every batch freezes its own document set and selected row/course assignments.
ALTER TABLE "RequestProposal" ADD COLUMN "assignments" JSONB, ADD COLUMN "scopeHash" TEXT;
CREATE TABLE "IssuanceAssignment" (
 "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "requestId" TEXT NOT NULL,
 "issuanceId" TEXT NOT NULL, "rowId" TEXT NOT NULL, "assignmentId" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "IssuanceAssignment_tenantId_requestId_rowId_assignmentId_key" ON "IssuanceAssignment"("tenantId","requestId","rowId","assignmentId");
CREATE INDEX "IssuanceAssignment_tenantId_issuanceId_idx" ON "IssuanceAssignment"("tenantId","issuanceId");
-- Historical full issuances stay immutable. Backfill only ownership identities.
INSERT INTO "IssuanceAssignment" ("id","tenantId","requestId","issuanceId","rowId","assignmentId")
SELECT md5(d."tenantId" || ':' || d."requestId" || ':' || d."rowId" || ':' || d."assignmentId"), d."tenantId",d."requestId",d."issuanceId",d."rowId",d."assignmentId"
FROM "IssuedDocument" d WHERE d."rowId" IS NOT NULL AND d."assignmentId" IS NOT NULL
ON CONFLICT ("tenantId","requestId","rowId","assignmentId") DO NOTHING;
INSERT INTO "IssuanceAssignment" ("id","tenantId","requestId","issuanceId","rowId","assignmentId")
SELECT md5(m."tenantId" || ':' || m."requestId" || ':' || m."rowId" || ':' || m."assignmentId"), m."tenantId",m."requestId",d."issuanceId",m."rowId",m."assignmentId"
FROM "GroupDocumentMember" m JOIN "IssuedDocument" d ON d.id=m."documentId" AND d."tenantId"=m."tenantId"
ON CONFLICT ("tenantId","requestId","rowId","assignmentId") DO NOTHING;
DROP INDEX "IssuedDocument_tenantId_groupEventId_groupEventRevision_key";
CREATE UNIQUE INDEX "IssuedDocument_issuanceId_groupEventId_key" ON "IssuedDocument"("issuanceId","groupEventId");

ALTER TABLE "Issuance" ADD COLUMN "scopeHash" TEXT;
DROP INDEX "Issuance_requestId_sourceRevision_key";
CREATE INDEX "Issuance_requestId_sourceRevision_idx" ON "Issuance"("requestId","sourceRevision");

ALTER TABLE "IssuanceAssignment" ADD CONSTRAINT issuance_assignment_owner_fk FOREIGN KEY("tenantId","issuanceId") REFERENCES "Issuance"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "IssuanceAssignment" ADD CONSTRAINT issuance_assignment_request_fk FOREIGN KEY("tenantId","requestId") REFERENCES "PrintRequest"("tenantId",id) ON DELETE RESTRICT;
CREATE TRIGGER demo_immutable BEFORE UPDATE OR DELETE ON "IssuanceAssignment" FOR EACH ROW EXECUTE FUNCTION demo_immutable();
CREATE OR REPLACE FUNCTION demo_proposal_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'DEMO_PROPOSAL_IMMUTABLE'; END IF;
 IF OLD.status='DRAFT' AND NEW.status='PENDING' AND
   (to_jsonb(NEW)-ARRAY['status','assignments','scopeHash','proposalHash','submittedBy','submittedAt'])=(to_jsonb(OLD)-ARRAY['status','assignments','scopeHash','proposalHash','submittedBy','submittedAt']) THEN RETURN NEW; END IF;
 IF (to_jsonb(NEW)-'status')<>(to_jsonb(OLD)-'status') OR
   NOT (OLD.status='PENDING' AND NEW.status IN ('APPROVED','REJECTED','SUPERSEDED') OR OLD.status='APPROVED' AND NEW.status='SUPERSEDED') THEN
   RAISE EXCEPTION 'DEMO_PROPOSAL_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION demo_request_approval_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.draft<>OLD.draft AND NEW."approvalPolicy" AND NOT EXISTS(
   SELECT 1 FROM "RequestProposal" p WHERE p."tenantId"=NEW."tenantId" AND p."requestId"=NEW.id
   AND p.operation='SAVE' AND p.payload=NEW.draft AND p.revision=NEW.revision AND p."baseRevision"=OLD.revision
   AND (p.status='DRAFT' OR (p.id=NEW."approvedProposalId" AND p.status='APPROVED' AND EXISTS(
     SELECT 1 FROM "ProposalDecision" d WHERE d."tenantId"=p."tenantId" AND d."proposalId"=p.id AND d.decision='APPROVE')))) THEN
   RAISE EXCEPTION 'DEMO_APPROVAL_REQUIRED'; END IF;
 IF OLD."approvalPolicy" AND NOT NEW."approvalPolicy" THEN RAISE EXCEPTION 'DEMO_APPROVAL_BYPASS'; END IF;
 RETURN NEW;
END $$;
-- TrainingEvent is the current preparation context; all previously issued bytes
-- continue to use immutable RenderInputSnapshot / Issuance snapshots.
CREATE OR REPLACE FUNCTION demo_registered_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' AND EXISTS (SELECT 1 FROM "IssuedDocument" WHERE "tenantId"=OLD."tenantId" AND "groupEventId"=OLD.id) THEN RAISE EXCEPTION 'GROUP_EVENT_IMMUTABLE'; END IF;
 IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW."tenantId"<>OLD."tenantId" OR NEW."requestId"<>OLD."requestId") THEN RAISE EXCEPTION 'GROUP_EVENT_IMMUTABLE'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE FUNCTION demo_approval_scope(value jsonb, selection jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object(
 'common',value-ARRAY['title','items','events','organizationSnapshots','trainingDefaults'],
 'items',COALESCE((SELECT jsonb_agg((item-ARRAY['assignments','sourceRow','sourceOrder']) || jsonb_build_object('assignments',
   (SELECT jsonb_agg(a ORDER BY a->>'id') FROM jsonb_array_elements(item->'assignments') a WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(selection) k WHERE k->>'rowId'=item->>'id' AND k->>'assignmentId'=a->>'id')))
   ORDER BY item->>'id') FROM jsonb_array_elements(value->'items') item WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(selection) k WHERE k->>'rowId'=item->>'id')),'[]'::jsonb),
 'events',COALESCE((SELECT jsonb_agg(e-'title' ORDER BY e->>'id') FROM jsonb_array_elements(COALESCE(value->'events','[]'::jsonb)) e WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(value->'items') i, jsonb_array_elements(i->'assignments') a, jsonb_array_elements(selection) k WHERE k->>'rowId'=i->>'id' AND k->>'assignmentId'=a->>'id' AND a->>'eventId'=e->>'id')),'[]'::jsonb),
 'organizations',COALESCE((SELECT jsonb_agg(o ORDER BY o->>'id') FROM jsonb_array_elements(COALESCE(value->'organizationSnapshots','[]'::jsonb)) o WHERE o->>'id'=value->>'customerId' OR EXISTS(SELECT 1 FROM jsonb_array_elements(value->'items') i,jsonb_array_elements(selection) k WHERE i->>'id'=k->>'rowId' AND i->>'employerId'=o->>'id')),'[]'::jsonb)
 );
$$;
CREATE FUNCTION demo_issuance_approval_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
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
CREATE TRIGGER demo_issuance_approval_guard BEFORE INSERT ON "Issuance" FOR EACH ROW EXECUTE FUNCTION demo_issuance_approval_guard();
CREATE OR REPLACE FUNCTION demo_request_lifecycle_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.status='FINALIZED' AND OLD.status='DRAFT' AND NEW."approvalPolicy" AND NOT EXISTS(
   SELECT 1 FROM "RequestProposal" p JOIN "ProposalDecision" d ON d."tenantId"=p."tenantId" AND d."proposalId"=p.id
   WHERE p.id=NEW."approvedProposalId" AND p."tenantId"=NEW."tenantId" AND p."requestId"=NEW.id
     AND p.status='APPROVED' AND p.operation='SAVE' AND (p."scopeHash" IS NOT NULL AND demo_approval_scope(p.payload,p.assignments)=demo_approval_scope(NEW.draft,p.assignments) AND EXISTS(SELECT 1 FROM "Issuance" i WHERE i."tenantId"=NEW."tenantId" AND i."requestId"=NEW.id AND i."scopeHash"=p."scopeHash") OR p."scopeHash" IS NULL AND p.payload=NEW.draft AND p.revision=NEW.revision)
     AND d.decision='APPROVE' AND d."proposalHash"=p."proposalHash"
     AND (p."scopeHash" IS NOT NULL OR NOT EXISTS(SELECT 1 FROM "RequestProposal" n WHERE n."requestId"=p."requestId" AND n.revision>p.revision))) THEN
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

CREATE FUNCTION demo_issuance_assignment_owner() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM "Issuance" i JOIN "RequestItem" r ON r."tenantId"=i."tenantId" AND r."requestId"=i."requestId" WHERE i.id=NEW."issuanceId" AND i."tenantId"=NEW."tenantId" AND i."requestId"=NEW."requestId" AND r."rowId"=NEW."rowId" AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.payload->'assignments') a WHERE a->>'id'=NEW."assignmentId")) THEN RAISE EXCEPTION 'DEMO_ISSUANCE_ASSIGNMENT_OWNER'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER demo_issuance_assignment_owner BEFORE INSERT ON "IssuanceAssignment" FOR EACH ROW EXECUTE FUNCTION demo_issuance_assignment_owner();

-- Additive approval/signature boundary. Existing issued snapshots and files remain untouched.
BEGIN;
ALTER TABLE "User" DROP CONSTRAINT user_role;
ALTER TABLE "User" ADD CONSTRAINT user_role CHECK(role IN ('ADMIN','DIRECTOR','OPERATOR','VIEWER','EMPLOYER'));
ALTER TABLE "PrintRequest" ADD COLUMN "workingRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "approvalPolicy" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "approvedProposalId" TEXT,
  ADD COLUMN "archivedAt" TIMESTAMPTZ;
-- A legacy issued record is historical evidence, never retroactively declared signed.
ALTER TABLE "PrintRequest" DISABLE TRIGGER demo_request_immutable;
UPDATE "PrintRequest" SET "approvalPolicy"=false WHERE status<>'DRAFT';
UPDATE "PrintRequest" SET "workingRevision"=revision;
ALTER TABLE "PrintRequest" ENABLE TRIGGER demo_request_immutable;

CREATE TABLE "RequestProposal" (
  id TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "requestId" TEXT NOT NULL,
  revision INTEGER NOT NULL, "baseRevision" INTEGER NOT NULL,
  operation TEXT NOT NULL DEFAULT 'SAVE' CHECK(operation IN ('SAVE','CANCEL','ARCHIVE')),
  payload JSONB NOT NULL, "before" JSONB NOT NULL, diff JSONB NOT NULL,
  "proposalHash" TEXT NOT NULL CHECK("proposalHash" ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED','SUPERSEDED')),
  "submittedBy" TEXT NOT NULL, "submittedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason TEXT NOT NULL DEFAULT '', UNIQUE("tenantId",id), UNIQUE("requestId",revision),
  FOREIGN KEY ("tenantId","requestId") REFERENCES "PrintRequest"("tenantId",id) ON DELETE RESTRICT,
  FOREIGN KEY ("tenantId","submittedBy") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT
);
CREATE INDEX "RequestProposal_tenant_status_time" ON "RequestProposal"("tenantId",status,"submittedAt");
CREATE TABLE "ProposalDecision" (
  id TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "proposalId" TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('APPROVE','REJECT')), comment TEXT NOT NULL,
  "proposalHash" TEXT NOT NULL, "decidedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE("tenantId","proposalId"),
  FOREIGN KEY ("tenantId","proposalId") REFERENCES "RequestProposal"("tenantId",id) ON DELETE RESTRICT,
  FOREIGN KEY ("tenantId","decidedBy") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT
);
ALTER TABLE "PrintRequest" ADD CONSTRAINT request_approved_proposal_fk FOREIGN KEY("tenantId","approvedProposalId") REFERENCES "RequestProposal"("tenantId",id) ON DELETE RESTRICT;
CREATE TABLE "IssuanceWorkflow" (
  id TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "requestId" TEXT NOT NULL,
  "issuanceId" TEXT NOT NULL, "proposalId" TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'RENDERING' CHECK(status IN ('RENDERING','AWAITING_SIGNATURE','ISSUED','FAILED')),
  "requiredSigners" JSONB NOT NULL, "completedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("tenantId","issuanceId"), UNIQUE("tenantId",id),
  FOREIGN KEY ("tenantId","requestId") REFERENCES "PrintRequest"("tenantId",id) ON DELETE RESTRICT,
  FOREIGN KEY ("tenantId","issuanceId") REFERENCES "Issuance"("tenantId",id) ON DELETE RESTRICT,
  FOREIGN KEY ("tenantId","proposalId") REFERENCES "RequestProposal"("tenantId",id) ON DELETE RESTRICT
);
CREATE TABLE "SignatoryBinding" (
  id TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  iin TEXT NOT NULL CHECK(iin ~ '^[0-9]{12}$'), bin TEXT CHECK(bin ~ '^[0-9]{12}$'),
  "displayName" TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('DIRECTOR','CHAIR','MEMBER')),
  active BOOLEAN NOT NULL DEFAULT true, "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE("tenantId",id),
  FOREIGN KEY ("tenantId","userId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT,
  FOREIGN KEY ("tenantId","createdBy") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX active_signatory_user_kind ON "SignatoryBinding"("tenantId","userId",kind) WHERE active;
CREATE TABLE "SigningSession" (
  id TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "issuanceId" TEXT NOT NULL,
  "artifactId" TEXT NOT NULL, "bindingId" TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('EGOV_QR','NCALAYER')),
  "providerReference" TEXT, "documentSha256" TEXT NOT NULL, "inputHash" TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','VERIFIED','FAILED')),
  "createdBy" TEXT NOT NULL, "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE("tenantId",id),
  FOREIGN KEY ("tenantId","issuanceId") REFERENCES "Issuance"("tenantId",id) ON DELETE RESTRICT,
  FOREIGN KEY ("tenantId","artifactId") REFERENCES "Artifact"("tenantId",id) ON DELETE RESTRICT,
  FOREIGN KEY ("tenantId","bindingId") REFERENCES "SignatoryBinding"("tenantId",id) ON DELETE RESTRICT
);
CREATE TABLE "DocumentSignature" (
  id TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "issuanceId" TEXT NOT NULL,
  "artifactId" TEXT NOT NULL, "bindingId" TEXT NOT NULL, "signingSessionId" TEXT NOT NULL UNIQUE,
  "documentSha256" TEXT NOT NULL, "signatureSha256" TEXT NOT NULL, "signatureStorageKey" TEXT NOT NULL UNIQUE,
  "signerIin" TEXT NOT NULL, "signerBin" TEXT, "certificateSerial" TEXT NOT NULL,
  "certificateFingerprint" TEXT NOT NULL, provider TEXT NOT NULL,
  verification JSONB NOT NULL, "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("tenantId",id), UNIQUE("tenantId","artifactId","bindingId"),
  FOREIGN KEY ("tenantId","issuanceId") REFERENCES "Issuance"("tenantId",id) ON DELETE RESTRICT,
  FOREIGN KEY ("tenantId","artifactId") REFERENCES "Artifact"("tenantId",id) ON DELETE RESTRICT,
  FOREIGN KEY ("tenantId","bindingId") REFERENCES "SignatoryBinding"("tenantId",id) ON DELETE RESTRICT,
  FOREIGN KEY ("tenantId","signingSessionId") REFERENCES "SigningSession"("tenantId",id) ON DELETE RESTRICT
);
CREATE TRIGGER demo_immutable BEFORE UPDATE OR DELETE ON "ProposalDecision" FOR EACH ROW EXECUTE FUNCTION demo_immutable();
CREATE TRIGGER demo_immutable BEFORE UPDATE OR DELETE ON "DocumentSignature" FOR EACH ROW EXECUTE FUNCTION demo_immutable();

CREATE FUNCTION demo_proposal_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-'status')<>(to_jsonb(OLD)-'status') OR OLD.status<>'PENDING' THEN
   RAISE EXCEPTION 'DEMO_PROPOSAL_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER demo_proposal_immutable BEFORE UPDATE OR DELETE ON "RequestProposal" FOR EACH ROW EXECUTE FUNCTION demo_proposal_immutable();
CREATE FUNCTION demo_director_decision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM "User" WHERE id=NEW."decidedBy" AND "tenantId"=NEW."tenantId" AND active AND role='DIRECTOR') THEN
   RAISE EXCEPTION 'DEMO_DIRECTOR_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER demo_director_decision BEFORE INSERT ON "ProposalDecision" FOR EACH ROW EXECUTE FUNCTION demo_director_decision();

-- Keep the old registered-data invariant while permitting additive workflow metadata.
CREATE OR REPLACE FUNCTION demo_request_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.status<>'DRAFT' AND (TG_OP='DELETE' OR
   (to_jsonb(NEW)-ARRAY['status','updatedAt','workingRevision','approvedProposalId','archivedAt'])<>
   (to_jsonb(OLD)-ARRAY['status','updatedAt','workingRevision','approvedProposalId','archivedAt']) OR NEW.status='DRAFT') THEN
   RAISE EXCEPTION 'DEMO_REGISTERED_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION demo_request_approval_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.draft<>OLD.draft AND NEW."approvalPolicy" AND NOT EXISTS(
   SELECT 1 FROM "RequestProposal" p JOIN "ProposalDecision" d ON d."tenantId"=p."tenantId" AND d."proposalId"=p.id
   WHERE p.id=NEW."approvedProposalId" AND p."tenantId"=NEW."tenantId" AND p."requestId"=NEW.id
     AND p.status='APPROVED' AND p.operation='SAVE' AND p.payload=NEW.draft
     AND p.revision=NEW.revision AND p."baseRevision"=OLD.revision AND d.decision='APPROVE') THEN
   RAISE EXCEPTION 'DEMO_APPROVAL_REQUIRED'; END IF;
 IF OLD."approvalPolicy" AND NOT NEW."approvalPolicy" THEN RAISE EXCEPTION 'DEMO_APPROVAL_BYPASS'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER demo_request_approval_guard BEFORE UPDATE ON "PrintRequest" FOR EACH ROW EXECUTE FUNCTION demo_request_approval_guard();
CREATE FUNCTION demo_signing_binding_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-'active')<>(to_jsonb(OLD)-'active') OR (NOT OLD.active AND NEW.active) THEN
   RAISE EXCEPTION 'DEMO_SIGNATORY_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER demo_signing_binding_immutable BEFORE UPDATE OR DELETE ON "SignatoryBinding" FOR EACH ROW EXECUTE FUNCTION demo_signing_binding_immutable();
CREATE FUNCTION demo_workflow_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['status','completedAt'])<>(to_jsonb(OLD)-ARRAY['status','completedAt']) OR
   (OLD."completedAt" IS NOT NULL AND to_jsonb(NEW)<>to_jsonb(OLD)) THEN RAISE EXCEPTION 'DEMO_SIGNING_POLICY_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER demo_workflow_immutable BEFORE UPDATE OR DELETE ON "IssuanceWorkflow" FOR EACH ROW EXECUTE FUNCTION demo_workflow_immutable();
COMMIT;

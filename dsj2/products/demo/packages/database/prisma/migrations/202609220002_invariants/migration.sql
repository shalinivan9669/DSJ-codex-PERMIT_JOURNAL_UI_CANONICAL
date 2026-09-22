-- Tenant ownership is also enforced by PostgreSQL, independently of controllers.
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['User','Session','IssuerProfileVersion','CustomerOrganization','Recipient','PrintRequest','RequestItem','TemplateVersion','Issuance','IssuanceEvent','IssuedDocument','NumberSequence','NumberReservation','RenderInputSnapshot','GenerationJob','Artifact','PhotoAsset','IdempotencyOperation','ImportBatch','AuditEvent','LegacyMapping'] LOOP
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE RESTRICT',tab,tab||'_tenant_fk');
 END LOOP;
END $$;
ALTER TABLE "Session" ADD CONSTRAINT session_user_fk FOREIGN KEY ("tenantId","userId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "PrintRequest" ADD CONSTRAINT request_customer_fk FOREIGN KEY ("tenantId","customerId") REFERENCES "CustomerOrganization"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "RequestItem" ADD CONSTRAINT item_request_fk FOREIGN KEY ("tenantId","requestId") REFERENCES "PrintRequest"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "Issuance" ADD CONSTRAINT issuance_request_fk FOREIGN KEY ("tenantId","requestId") REFERENCES "PrintRequest"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "Issuance" ADD CONSTRAINT issuance_profile_fk FOREIGN KEY ("tenantId","profileVersionId") REFERENCES "IssuerProfileVersion"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "Issuance" ADD CONSTRAINT issuance_correction_fk FOREIGN KEY ("tenantId","correctsIssuanceId") REFERENCES "Issuance"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "PrintRequest" ADD CONSTRAINT request_correction_fk FOREIGN KEY ("tenantId","correctsIssuanceId") REFERENCES "Issuance"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "IssuanceEvent" ADD CONSTRAINT event_issuance_fk FOREIGN KEY ("tenantId","issuanceId") REFERENCES "Issuance"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "IssuanceEvent" ADD CONSTRAINT event_related_fk FOREIGN KEY ("tenantId","relatedIssuanceId") REFERENCES "Issuance"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "IssuedDocument" ADD CONSTRAINT document_issuance_fk FOREIGN KEY ("tenantId","issuanceId") REFERENCES "Issuance"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "IssuedDocument" ADD CONSTRAINT document_request_fk FOREIGN KEY ("tenantId","requestId") REFERENCES "PrintRequest"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "IssuedDocument" ADD CONSTRAINT document_template_fk FOREIGN KEY ("tenantId","templateVersionId") REFERENCES "TemplateVersion"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "IssuedDocument" ADD CONSTRAINT document_replaces_fk FOREIGN KEY ("tenantId","replacesDocumentId") REFERENCES "IssuedDocument"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "NumberReservation" ADD CONSTRAINT reservation_document_fk FOREIGN KEY ("tenantId","documentId") REFERENCES "IssuedDocument"("tenantId",id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "NumberReservation" ADD CONSTRAINT reservation_sequence_fk FOREIGN KEY ("tenantId",namespace) REFERENCES "NumberSequence"("tenantId",namespace) ON DELETE RESTRICT;
ALTER TABLE "RenderInputSnapshot" ADD CONSTRAINT snapshot_request_fk FOREIGN KEY ("tenantId","requestId") REFERENCES "PrintRequest"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "RenderInputSnapshot" ADD CONSTRAINT snapshot_profile_fk FOREIGN KEY ("tenantId","profileVersionId") REFERENCES "IssuerProfileVersion"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "RenderInputSnapshot" ADD CONSTRAINT snapshot_template_fk FOREIGN KEY ("tenantId","templateVersionId") REFERENCES "TemplateVersion"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "RenderInputSnapshot" ADD CONSTRAINT snapshot_issuance_fk FOREIGN KEY ("tenantId","issuanceId") REFERENCES "Issuance"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "GenerationJob" ADD CONSTRAINT job_snapshot_fk FOREIGN KEY ("tenantId","snapshotId") REFERENCES "RenderInputSnapshot"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "GenerationJob" ADD CONSTRAINT job_request_fk FOREIGN KEY ("tenantId","requestId") REFERENCES "PrintRequest"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "GenerationJob" ADD CONSTRAINT job_issuance_fk FOREIGN KEY ("tenantId","issuanceId") REFERENCES "Issuance"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "GenerationJob" ADD CONSTRAINT job_document_fk FOREIGN KEY ("tenantId","documentId") REFERENCES "IssuedDocument"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "GenerationJob" ADD CONSTRAINT job_artifact_fk FOREIGN KEY ("tenantId","artifactId") REFERENCES "Artifact"("tenantId",id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Artifact" ADD CONSTRAINT artifact_job_fk FOREIGN KEY ("tenantId","jobId") REFERENCES "GenerationJob"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "Artifact" ADD CONSTRAINT artifact_request_fk FOREIGN KEY ("tenantId","requestId") REFERENCES "PrintRequest"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "Artifact" ADD CONSTRAINT artifact_issuance_fk FOREIGN KEY ("tenantId","issuanceId") REFERENCES "Issuance"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "Artifact" ADD CONSTRAINT artifact_document_fk FOREIGN KEY ("tenantId","documentId") REFERENCES "IssuedDocument"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "PhotoAsset" ADD CONSTRAINT photo_owner_fk FOREIGN KEY ("tenantId","ownerId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "User" ADD CONSTRAINT user_role CHECK(role IN ('ADMIN','OPERATOR','VIEWER'));
ALTER TABLE "PrintRequest" ADD CONSTRAINT request_kind CHECK(kind IN ('PERSON','COMPANY')), ADD CONSTRAINT request_status CHECK(status IN ('DRAFT','FINALIZED','CANCELLED')), ADD CONSTRAINT request_rows CHECK("itemCount" BETWEEN 0 AND 100);
ALTER TABLE "GenerationJob" ADD CONSTRAINT job_status CHECK(status IN ('PENDING','RUNNING','RETRY','SUCCEEDED','FAILED')), ADD CONSTRAINT job_kind CHECK(kind IN ('DOCX','PDF','XLSX','ZIP')), ADD CONSTRAINT job_attempts CHECK(attempts>=0 AND "maxAttempts" BETWEEN 1 AND 10), ADD CONSTRAINT job_fence CHECK("fencingToken">=0);
ALTER TABLE "NumberSequence" ADD CONSTRAINT positive_sequence CHECK(value>=0 AND padding BETWEEN 1 AND 12);
ALTER TABLE "NumberReservation" ADD CONSTRAINT reservation_positive CHECK(sequence>0);

CREATE FUNCTION demo_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'DEMO_IMMUTABLE: %',TG_TABLE_NAME; END $$;
DO $$ DECLARE tab text; BEGIN FOREACH tab IN ARRAY ARRAY['IssuerProfileVersion','Issuance','IssuanceEvent','IssuedDocument','NumberReservation','RenderInputSnapshot','Artifact','PhotoAsset','IdempotencyOperation','AuditEvent','LegacyMapping'] LOOP
 EXECUTE format('CREATE TRIGGER demo_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION demo_immutable()',tab);
END LOOP; END $$;
CREATE FUNCTION demo_template_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-'approved')<>(to_jsonb(OLD)-'approved') THEN RAISE EXCEPTION 'DEMO_TEMPLATE_VERSION_IMMUTABLE'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER demo_template_immutable BEFORE UPDATE OR DELETE ON "TemplateVersion" FOR EACH ROW EXECUTE FUNCTION demo_template_immutable();
CREATE FUNCTION demo_counter_monotonic() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR NEW.value<OLD.value OR NEW."tenantId"<>OLD."tenantId" OR NEW.namespace<>OLD.namespace THEN RAISE EXCEPTION 'DEMO_COUNTER_MONOTONIC'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER demo_counter_monotonic BEFORE UPDATE OR DELETE ON "NumberSequence" FOR EACH ROW EXECUTE FUNCTION demo_counter_monotonic();
CREATE FUNCTION demo_request_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.status<>'DRAFT' AND (TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['status','updatedAt'])<>(to_jsonb(OLD)-ARRAY['status','updatedAt']) OR NEW.status='DRAFT') THEN RAISE EXCEPTION 'DEMO_REGISTERED_IMMUTABLE'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER demo_request_immutable BEFORE UPDATE OR DELETE ON "PrintRequest" FOR EACH ROW EXECUTE FUNCTION demo_request_immutable();

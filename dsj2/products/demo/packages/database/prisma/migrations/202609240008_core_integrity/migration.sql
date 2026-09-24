-- Reinforce group ownership independently of API validation.
CREATE FUNCTION demo_group_member_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d "IssuedDocument"; BEGIN
 SELECT * INTO d FROM "IssuedDocument" WHERE id=NEW."documentId" AND "tenantId"=NEW."tenantId";
 IF NOT FOUND OR d."ownerKind"<>'GROUP' OR d."requestId"<>NEW."requestId" THEN RAISE EXCEPTION 'GROUP_MEMBER_OWNER'; END IF;
 IF NOT EXISTS (SELECT 1 FROM "RequestItem" WHERE "tenantId"=NEW."tenantId" AND "requestId"=NEW."requestId" AND "rowId"=NEW."rowId") THEN RAISE EXCEPTION 'GROUP_MEMBER_ROW'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER demo_group_member_owner BEFORE INSERT ON "GroupDocumentMember" FOR EACH ROW EXECUTE FUNCTION demo_group_member_owner();
CREATE FUNCTION demo_registered_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS (SELECT 1 FROM "IssuedDocument" WHERE "tenantId"=OLD."tenantId" AND "groupEventId"=OLD.id) AND (TG_OP='DELETE' OR to_jsonb(NEW)<>to_jsonb(OLD)) THEN RAISE EXCEPTION 'GROUP_EVENT_IMMUTABLE'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER demo_registered_event_immutable BEFORE UPDATE OR DELETE ON "TrainingEvent" FOR EACH ROW EXECUTE FUNCTION demo_registered_event_immutable();

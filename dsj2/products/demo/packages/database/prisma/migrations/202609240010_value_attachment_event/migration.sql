ALTER TABLE "ValueAttachment" ADD COLUMN "eventId" TEXT;
ALTER TABLE "ValueAttachment" ADD CONSTRAINT "value_attachment_event_tenant_fk"
  FOREIGN KEY ("tenantId", "eventId") REFERENCES "TrainingEvent" ("tenantId", id);
ALTER TABLE "ValueAttachment" ADD CONSTRAINT "value_attachment_event_requires_order"
  CHECK ("eventId" IS NULL OR "orderId" IS NOT NULL);
CREATE INDEX "ValueAttachment_tenantId_eventId_idx" ON "ValueAttachment" ("tenantId", "eventId");

CREATE FUNCTION value_attachment_linked_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."eventId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "TrainingEvent" event
    JOIN "ServiceOrderRequest" link ON link."tenantId" = event."tenantId" AND link."requestId" = event."requestId"
    WHERE event."tenantId" = NEW."tenantId" AND event.id = NEW."eventId" AND link."orderId" = NEW."orderId"
  ) THEN
    RAISE EXCEPTION 'Attachment event must belong to a request linked to its order' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER value_attachment_linked_event_guard BEFORE INSERT ON "ValueAttachment"
  FOR EACH ROW EXECUTE FUNCTION value_attachment_linked_event_guard();

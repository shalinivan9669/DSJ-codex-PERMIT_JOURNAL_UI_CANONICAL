-- Begin future operational notifications without backfilling historic inbox facts.
INSERT INTO "LmsNotificationCheckpoint" ("tenantId","activatedAt","enrollmentCursor") SELECT id,CURRENT_TIMESTAMP,'' FROM "Tenant" ON CONFLICT ("tenantId") DO NOTHING;

-- Contractual customer, payer and participant employer are independent parties.
ALTER TABLE "ServiceOrder" ADD COLUMN "employerId" TEXT;
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_employer_tenant_fk"
  FOREIGN KEY ("tenantId", "employerId")
  REFERENCES "CustomerOrganization" ("tenantId", "id") ON DELETE RESTRICT;
CREATE INDEX "ServiceOrder_tenantId_employerId_idx" ON "ServiceOrder"("tenantId", "employerId");

-- Pin an unambiguous existing three-party scope once. Never change snapshots,
-- numbers, mixed-employer scopes, empty orders, or out-of-tenant references.
WITH participant_scopes AS (
  SELECT link."tenantId", link."orderId",
    MIN(COALESCE(NULLIF(item.value->>'employerId', ''), request."customerId")) AS employer_id
  FROM "ServiceOrderRequest" link
  JOIN "PrintRequest" request ON request."id" = link."requestId" AND request."tenantId" = link."tenantId"
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(request."draft"->'items') = 'array' THEN request."draft"->'items' ELSE '[]'::jsonb END
  ) AS item(value)
  GROUP BY link."tenantId", link."orderId"
  HAVING COUNT(DISTINCT COALESCE(NULLIF(item.value->>'employerId', ''), request."customerId")) = 1
    AND COUNT(*) FILTER (WHERE COALESCE(NULLIF(item.value->>'employerId', ''), request."customerId") IS NULL) = 0
)
UPDATE "ServiceOrder" target
SET "employerId" = scopes.employer_id
FROM participant_scopes scopes
JOIN "CustomerOrganization" employer ON employer."id" = scopes.employer_id AND employer."tenantId" = scopes."tenantId"
WHERE target."tenantId" = scopes."tenantId" AND target."id" = scopes."orderId"
  AND target."employerId" IS NULL AND target."customerId" IS DISTINCT FROM scopes.employer_id;

import { Prisma } from "@demo/database";
import { db, fail, type Context } from "../core";

/** Download requires both permissions on the same current, recipient-scoped membership. */
export async function employerDownloadableResultIds(
  c: Context,
  resultIds: readonly string[],
  tx: Prisma.TransactionClient = db,
): Promise<string[]> {
  if (c.role !== "EMPLOYER" || !resultIds.length) return [...resultIds];
  const ids = [...new Set(resultIds)];
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT result.id
    FROM "VerifiedExamResult" result
    JOIN "Enrollment" enrollment
      ON enrollment."tenantId"=result."tenantId"
      AND enrollment.id=result."enrollmentId"
      AND enrollment."recipientId"=result."recipientId"
    WHERE result."tenantId"=${c.tenantId}
      AND result.id IN (${Prisma.join(ids)})
      AND EXISTS (
        SELECT 1 FROM "EmployerMembership" membership
        WHERE membership."tenantId"=result."tenantId"
          AND membership."userId"=${c.userId}
          AND membership."customerId"=enrollment."customerId"
          AND membership.active
          AND (membership."expiresAt" IS NULL OR membership."expiresAt">CURRENT_TIMESTAMP)
          AND membership.permissions @> '["READ","DOWNLOAD"]'::jsonb
          AND (membership."recipientIds"='[]'::jsonb
            OR membership."recipientIds" @> jsonb_build_array(result."recipientId"))
      )`);
  return rows.map((row) => row.id);
}

export async function assertEmployerDocumentDownload(
  c: Context,
  resultIds: readonly string[],
  tx: Prisma.TransactionClient = db,
): Promise<void> {
  if (c.role !== "EMPLOYER" || !resultIds.length) return;
  const ids = [...new Set(resultIds)];
  const allowed = await employerDownloadableResultIds(c, ids, tx);
  if (allowed.length !== ids.length)
    fail(
      403,
      "EMPLOYER_DOCUMENT_DOWNLOAD_DENIED",
      "Нет действующего права скачивать документы выбранных сотрудников. Обратитесь в учебный центр",
    );
}

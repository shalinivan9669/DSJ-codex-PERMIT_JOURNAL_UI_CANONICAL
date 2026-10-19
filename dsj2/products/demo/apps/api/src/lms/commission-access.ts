import { Prisma } from "@demo/database";
import { canManageLearning } from "@demo/contracts";
import { db, fail, type Context } from "../core";
import { teachingBindingPermissionSql } from "./learning-permissions";

/** A commission may see a complete issuance only when every included result is in its scope. */
export function commissionScopeSql(c: Context, alias = "w") {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error("INVALID_SQL_ALIAS");
  const w = Prisma.raw(`"${alias}"`);
  const scope = canManageLearning(c.role) && !c.learningMode
    ? Prisma.sql`TRUE`
    : c.learningMode ? Prisma.sql`FALSE`
      : Prisma.sql`EXISTS (SELECT 1 FROM "LmsTeachingBinding" b
          WHERE b."tenantId"=e."tenantId" AND b."userId"=${c.userId}
          AND b.role='EXPERT' AND b."courseId"=v."courseId" AND b."revokedAt" IS NULL
          AND b.permissions @> '["READ"]'::jsonb AND ${teachingBindingPermissionSql("REVIEW")}
          AND (b."groupId" IS NULL OR (b."groupId"=e."groupId" AND EXISTS (
            SELECT 1 FROM "LmsGroupMember" gm WHERE gm."tenantId"=e."tenantId"
            AND gm."groupId"=b."groupId" AND gm."enrollmentId"=e.id AND gm."excludedAt" IS NULL))))
          AND NOT EXISTS (SELECT 1 FROM "LearnerProfile" p WHERE p."tenantId"=e."tenantId"
            AND p."userId"=${c.userId} AND p."recipientId"=e."recipientId")`;
  return Prisma.sql`${w}."tenantId"=${c.tenantId}
    AND EXISTS (SELECT 1 FROM "LmsDocumentLink" l WHERE l."tenantId"=${w}."tenantId" AND l."issuanceId"=${w}."issuanceId")
    AND NOT EXISTS (SELECT 1 FROM "IssuedDocument" d WHERE d."tenantId"=${w}."tenantId" AND d."issuanceId"=${w}."issuanceId"
      AND NOT EXISTS (SELECT 1 FROM "LmsDocumentLink" l WHERE l."tenantId"=d."tenantId" AND l."issuanceId"=d."issuanceId"
        AND d."assignmentId"=l."resultId"||'-'||l."documentType"))
    AND NOT EXISTS (SELECT 1 FROM "LmsDocumentLink" l
      LEFT JOIN "VerifiedExamResult" r ON r."tenantId"=l."tenantId" AND r.id=l."resultId"
      LEFT JOIN "Enrollment" e ON e."tenantId"=r."tenantId" AND e.id=r."enrollmentId"
      LEFT JOIN "CourseVersion" v ON v."tenantId"=e."tenantId" AND v.id=e."courseVersionId"
      WHERE l."tenantId"=${w}."tenantId" AND l."issuanceId"=${w}."issuanceId"
      AND (r.id IS NULL OR e.id IS NULL OR v.id IS NULL OR NOT (${scope})))`;
}

export async function assertCommissionAccess(c: Context, issuanceId: string, tx: Prisma.TransactionClient = db) {
  const rows = await tx.$queryRaw<Array<{ issuanceId: string; requestId: string; status: string }>>(
    Prisma.sql`SELECT w."issuanceId",w."requestId",w.status FROM "IssuanceWorkflow" w
      WHERE w."issuanceId"=${issuanceId} AND ${commissionScopeSql(c)}`,
  );
  if (!rows[0]) fail(404, "NOT_FOUND", "Протокол не найден в назначениях комиссии");
  return rows[0];
}

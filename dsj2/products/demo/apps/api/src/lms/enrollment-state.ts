import { Prisma, type Enrollment } from "@demo/database";

/** Regulatory completions historically retain ACTIVE; completion is a separate fact.
 * Cancellation still wins. This describes learning, not payment or document validity. */
export function effectiveEnrollmentStatus(
  enrollment: Pick<Enrollment, "status" | "completedAt">,
) {
  return enrollment.status !== "CANCELLED" && enrollment.completedAt
    ? "COMPLETED"
    : enrollment.status;
}
export function enrollmentStatusSql(alias = "e") {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error("INVALID_SQL_ALIAS");
  const e = Prisma.raw(`"${alias}"`);
  return Prisma.sql`CASE WHEN ${e}.status<>'CANCELLED' AND ${e}."completedAt" IS NOT NULL THEN 'COMPLETED' ELSE ${e}.status END`;
}

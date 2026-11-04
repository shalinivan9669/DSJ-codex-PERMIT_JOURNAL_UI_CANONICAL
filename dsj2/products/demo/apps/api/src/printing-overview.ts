import { db, type Context } from "./core";
import { assertStaff } from "./approvals";

/** Counts the entire authorized center; document versions are not unique people. */
export async function printingOverview(c: Context) {
  assertStaff(c);
  const tenantId = c.tenantId;
  const [requests, active, archived, documents] = await db.$transaction(
    [
      db.printRequest.count({ where: { tenantId } }),
      db.printRequest.count({
        where: { tenantId, archivedAt: null, status: { not: "CANCELLED" } },
      }),
      db.printRequest.count({ where: { tenantId, archivedAt: { not: null } } }),
      db.issuedDocument.count({ where: { tenantId } }),
    ],
    { isolationLevel: "RepeatableRead" },
  );
  return { requests, active, archived, documents };
}

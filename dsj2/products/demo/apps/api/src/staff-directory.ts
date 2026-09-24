import { staffDirectorySchema } from "@demo/contracts/src/staff-directory";
import { db, fail, type Context } from "./core";

export async function staffDirectory(c: Context) {
  if (c.role !== "ADMIN" && c.role !== "OPERATOR")
    fail(
      403,
      "ROLE_DENIED",
      "Справочник сотрудников доступен оператору центра",
    );
  const items = await db.user.findMany({
    where: {
      tenantId: c.tenantId,
      active: true,
      role: { in: ["ADMIN", "OPERATOR"] },
    },
    select: { id: true, displayName: true },
    orderBy: [{ displayName: "asc" }, { id: "asc" }],
  });
  return staffDirectorySchema.parse({ items });
}

import {
  draftSchema,
  initialImportScaffoldId,
  type Draft,
} from "@demo/contracts";
import type { Prisma } from "@demo/database";
import type { Context } from "./core";

/** A visually empty row is replaceable only if all retained SAVE history agrees. */
export async function replaceableImportScaffoldId(
  tx: Prisma.TransactionClient,
  c: Context,
  requestId: string,
  draft: Draft,
  approvedRevision: number,
) {
  const scaffoldId = initialImportScaffoldId({ ...draft, approvedRevision });
  if (!scaffoldId) return null;
  const history = await tx.requestProposal.findMany({
    where: { tenantId: c.tenantId, requestId, operation: "SAVE" },
    select: { payload: true },
  });
  return history.length &&
    history.every(({ payload }) => {
      const prior = draftSchema.safeParse(payload);
      return (
        prior.success &&
        initialImportScaffoldId({ ...prior.data, approvedRevision: 0 }) ===
          scaffoldId
      );
    })
    ? scaffoldId
    : null;
}

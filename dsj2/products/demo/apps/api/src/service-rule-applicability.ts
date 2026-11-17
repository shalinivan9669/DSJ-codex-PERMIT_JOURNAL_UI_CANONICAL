import type { Draft } from "@demo/contracts";
import type { Prisma } from "@demo/database";
import type { Context } from "./core";

export { ruleApplicabilityIssues } from "@demo/contracts";

/** Load only the immutable versions referenced by this tenant's selected events. */
export async function pinnedServiceRules(
  c: Context,
  draft: Pick<Draft, "events">,
  tx: Prisma.TransactionClient,
) {
  const ids = [
    ...new Set(
      (draft.events || []).flatMap((event) =>
        event.serviceRuleVersionId ? [event.serviceRuleVersionId] : [],
      ),
    ),
  ];
  if (!ids.length) return [];
  return tx.serviceRuleVersion.findMany({
    where: { tenantId: c.tenantId, id: { in: ids } },
  });
}

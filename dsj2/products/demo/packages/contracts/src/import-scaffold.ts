import type { Draft } from "./index";

/** Only the untouched single starter row of a never-approved live draft. */
export function initialImportScaffoldId(
  draft: Pick<
    Draft,
    "items" | "events" | "schemaVersion" | "businessRuleVersion"
  > & {
    approvedRevision?: number;
  },
): string | undefined {
  if (
    draft.approvedRevision !== 0 ||
    draft.schemaVersion !== 2 ||
    draft.businessRuleVersion !== "LIVE_V1" ||
    draft.items.length !== 1 ||
    draft.events?.length
  )
    return undefined;
  const row = draft.items[0];
  const emptyTextFields = new Set([
    "fullNameRu",
    "fullNameKz",
    "positionRu",
    "positionKz",
    "workplaceRu",
    "workplaceKz",
  ]);
  for (const [key, value] of Object.entries(row)) {
    if (key === "id") continue;
    if (
      key === "employeeCategory" &&
      (value === undefined || value === "WORKER")
    )
      continue;
    if (key === "photoAssetId" && value === null) continue;
    if (key === "assignments" && Array.isArray(value) && value.length === 0)
      continue;
    if (emptyTextFields.has(key) && value === "") continue;
    // Imported identities, employer exceptions, explicit extra fields and future
    // schema additions are preserved, even when their current value is empty.
    return undefined;
  }
  return row.id;
}

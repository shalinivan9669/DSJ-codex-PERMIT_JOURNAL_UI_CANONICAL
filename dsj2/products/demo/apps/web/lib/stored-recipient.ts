import { isBlankText, itemSchema } from "@demo/contracts";
import { type Recipient } from "./types";
import { canSupplementRecipientEmployer } from "./recipient-employer";

export type StoredRecipient = {
  id: string;
  data: Recipient;
  archived?: boolean;
};

/** Reuse personal data, including legacy rows missing optional editor fields. */
export function reuseRecipient(record: StoredRecipient): Recipient {
  const {
    assignments: _oldAssignments,
    importId: _importId,
    sourceRow: _sourceRow,
    ...person
  } = record.data;
  // The current item contract supplies missing text fields without changing
  // existing values. Keep other stored personal metadata; training facts belong
  // to the old request and must never become defaults for the new request.
  return itemSchema.passthrough().parse({
    ...person,
    id: crypto.randomUUID(),
    recipientId: record.id,
    assignments: [],
  });
}

/** Use the selected person's data in this unlinked row without carrying over prior training. */
export function fillFromStoredRecipient(
  row: Recipient,
  record: StoredRecipient,
  useStoredCategory: boolean,
): Recipient {
  if (row.recipientId || record.archived) return row;
  const saved = reuseRecipient(record);
  if (
    (["iin", "externalId"] as const).some((field) => {
      return (
        row[field]?.trim() &&
        saved[field]?.trim() &&
        row[field]?.trim() !== saved[field]?.trim()
      );
    })
  )
    return row;
  const next = {
    ...row,
    recipientId: saved.recipientId,
    fullNameRu: saved.fullNameRu || saved.fullNameKz,
  };
  for (const key of [
    "fullNameKz",
    "fullNameEn",
    "iin",
    "phone",
    "email",
    "externalId",
    "photoAssetId",
  ] as const) {
    if (!row[key]?.trim() && saved[key]?.trim())
      Object.assign(next, { [key]: saved[key] });
  }
  if (
    canSupplementRecipientEmployer(row, {
      id: saved.employerId,
      nameRu: saved.workplaceRu,
      nameKz: saved.workplaceKz,
      bin: saved.employerBin,
    })
  ) {
    const positionKeys = ["positionRu", "positionKz", "positionEn"] as const;
    const fieldGroups = [
      positionKeys,
      ["departmentRu", "departmentKz", "departmentEn"],
      ["workplaceRu", "workplaceKz", "workplaceEn"],
      ["employerAddressRu", "employerAddressKz", "employerAddressEn"],
      ["employerId"],
      ["employerBin"],
      ["personnelNumber"],
      ["employmentPeriod"],
    ] as const;
    const conflicts = (key: (typeof fieldGroups)[number][number]) =>
      !isBlankText(row[key]) && row[key]?.trim() !== saved[key]?.trim();
    for (const group of fieldGroups) {
      // A locally entered job, branch address or department can describe a
      // different posting from the one in the directory.
      if (group.some(conflicts)) continue;
      for (const key of group) {
        if (isBlankText(row[key]) && !isBlankText(saved[key]))
          Object.assign(next, { [key]: saved[key] });
      }
    }
    if (
      !row.workplaceNaming &&
      !row.workplaceRu.trim() &&
      !row.workplaceKz.trim() &&
      saved.workplaceNaming
    )
      next.workplaceNaming = saved.workplaceNaming;
    if (
      useStoredCategory &&
      !row.assignments.length &&
      saved.employeeCategory &&
      !positionKeys.some(conflicts)
    )
      next.employeeCategory = saved.employeeCategory;
  }
  return next;
}

export function undoStoredRecipient(
  row: Recipient,
  before: Recipient,
  filled: Recipient,
): Recipient {
  if (row.id !== before.id || row.recipientId !== filled.recipientId)
    return row;
  const restored = { ...row };
  for (const key of Object.keys(filled) as (keyof Recipient)[]) {
    if (key === "assignments" || filled[key] === before[key]) continue;
    if (JSON.stringify(row[key]) === JSON.stringify(filled[key])) {
      if (before[key] === undefined) delete restored[key];
      else Object.assign(restored, { [key]: before[key] });
    }
  }
  return restored;
}

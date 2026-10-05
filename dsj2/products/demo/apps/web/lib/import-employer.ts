import type { Customer, Recipient } from "./types";
import { canSupplementRecipientEmployer } from "./recipient-employer";

/** A row must not mix identity or requisites from a different employer. */
export type ImportCompany = Pick<
  Customer,
  "id" | "nameRu" | "nameKz" | "bin" | "addressRu" | "addressKz"
>;
export function importEmployerConflict(
  row: Recipient,
  company?: ImportCompany | null,
): boolean {
  if (!company) return false;
  const explicit = [
    row.employerId,
    row.workplaceRu,
    row.workplaceKz,
    row.employerBin,
    row.employerAddressRu,
    row.employerAddressKz,
  ].some((value) => value?.trim());
  return (
    explicit &&
    !canSupplementRecipientEmployer(row, { ...company, archived: false })
  );
}

/** Only an explicit conflict resolution clears imported employer exceptions. */
export function inheritImportEmployer(row: Recipient): Recipient {
  return {
    ...row,
    employerId: undefined,
    workplaceRu: "",
    workplaceKz: "",
    employerBin: "",
    employerAddressRu: "",
    employerAddressKz: "",
  };
}

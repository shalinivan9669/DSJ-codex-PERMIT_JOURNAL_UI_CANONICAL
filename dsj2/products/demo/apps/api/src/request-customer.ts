import type { Draft } from "@demo/contracts";

/** The person ordering their documents is never an organization-directory entry. */
export function personCustomerName(draft: Draft): string {
  if (draft.kind !== "PERSON") return "";
  const person = draft.items.find(
    (item) => item.fullNameRu.trim() || item.fullNameKz.trim(),
  );
  return person?.fullNameRu.trim() || person?.fullNameKz.trim() || "";
}

export function withCustomerIdentity(draft: Draft): Draft {
  const name = personCustomerName(draft);
  return name ? { ...draft, title: name.slice(0, 255) } : draft;
}

/** Keep legacy customer references, but inherit an employer only in company requests. */
export function companyEmployerId(draft: Draft): string | null {
  return draft.kind === "COMPANY" ? draft.customerId : null;
}

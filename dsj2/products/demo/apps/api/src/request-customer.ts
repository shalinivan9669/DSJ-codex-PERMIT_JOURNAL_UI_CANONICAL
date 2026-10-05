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
  // Keep the stored title independent from the person's current name. Callers
  // derive customerName/display title without rewriting historical snapshots
  // or turning a new generic title into a stale name on its next save.
  return draft;
}

/** Keep legacy customer references, but inherit an employer only in company requests. */
export function companyEmployerId(draft: Draft): string | null {
  return draft.kind === "COMPANY" ? draft.customerId : null;
}

const genericRequestTitles = new Set([
  "",
  "Новая заявка",
  "Новая заявка на человека",
  "Новая заявка организации",
]);

/** Display identity without turning it into a stored or historical title. */
export function requestDisplayTitle(
  title: string,
  customerName: string | null,
): string {
  return genericRequestTitles.has(title.trim()) ? customerName || title : title;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const nameValue = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

/** A director reads the submitted identity, never the current directory name. */
export function proposalDisplayTitle(
  proposal: { operation: string; payload: unknown; before?: unknown },
  fallbackTitle: string,
): string {
  const draft = objectValue(
    proposal.operation === "SAVE" ? proposal.payload : proposal.before,
  );
  const title = typeof draft?.title === "string" ? draft.title : fallbackTitle;
  if (!genericRequestTitles.has(title.trim())) return title;
  let customerName = "";
  if (draft?.kind === "PERSON" && Array.isArray(draft.items)) {
    for (const value of draft.items) {
      const person = objectValue(value);
      customerName =
        nameValue(person?.fullNameRu) || nameValue(person?.fullNameKz);
      if (customerName) break;
    }
  } else if (
    draft?.kind === "COMPANY" &&
    typeof draft.customerId === "string" &&
    Array.isArray(draft.organizationSnapshots)
  ) {
    const organization = draft.organizationSnapshots
      .map(objectValue)
      .find((entry) => entry?.id === draft.customerId);
    customerName =
      nameValue(organization?.nameRu) || nameValue(organization?.nameKz);
  }
  return (
    requestDisplayTitle(title, customerName) || fallbackTitle || "Новая заявка"
  );
}

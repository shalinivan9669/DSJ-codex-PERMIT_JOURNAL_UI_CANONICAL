import { customerSchema, type OrganizationNames } from "@demo/contracts";
import type { Customer, Recipient } from "./types";

/** Both languages describe one effective employer; a local exception never borrows the other employer's name. */
export function effectiveRecipientEmployer(
  recipient: Recipient,
  employer:
    | {
        id?: string;
        nameRu: string;
        nameKz?: string | null;
        bin?: string | null;
        addressRu?: string | null;
        addressKz?: string | null;
      }
    | null
    | undefined,
) {
  const localName = !!(
    recipient.workplaceRu?.trim() || recipient.workplaceKz?.trim()
  );
  const knownNames = [
    employerText(employer?.nameRu),
    employerText(employer?.nameKz),
  ].filter(Boolean);
  const localNames = [
    employerText(recipient.workplaceRu),
    employerText(recipient.workplaceKz),
  ].filter(Boolean);
  const binConflict = !!(
    recipient.employerBin?.trim() &&
    employer?.bin?.trim() &&
    recipient.employerBin.trim() !== employer.bin.trim()
  );
  const matches =
    !binConflict &&
    (recipient.employerId
      ? recipient.employerId === employer?.id
      : localNames.length
        ? localNames.every((name) => knownNames.includes(name))
        : recipient.employerBin?.trim()
          ? recipient.employerBin.trim() === employer?.bin?.trim()
          : !recipient.employerAddressRu?.trim() &&
            !recipient.employerAddressKz?.trim());
  const inherited = matches ? employer : undefined;
  return {
    ...recipient,
    workplaceRu: localName
      ? recipient.workplaceRu || recipient.workplaceKz
      : inherited?.nameRu || inherited?.nameKz || "",
    workplaceKz: localName
      ? recipient.workplaceKz || recipient.workplaceRu
      : inherited?.nameKz || inherited?.nameRu || "",
    employerBin: recipient.employerBin || inherited?.bin || "",
    employerAddressRu:
      recipient.employerAddressRu ||
      inherited?.addressRu ||
      inherited?.addressKz ||
      "",
    employerAddressKz:
      recipient.employerAddressKz ||
      inherited?.addressKz ||
      inherited?.addressRu ||
      "",
  };
}

/** Selecting an employer is explicit; no form or company is inferred from text. */
export function patchRecipientEmployer(
  recipient: Recipient,
  employer: Customer,
): Recipient {
  return {
    ...recipient,
    employerId: employer.id,
    workplaceRu: employer.nameRu,
    workplaceKz: employer.nameKz,
    employerBin: employer.bin,
    employerAddressRu: employer.addressRu,
    employerAddressKz: employer.addressKz,
  };
}

const employerText = (value?: string | null) =>
  (value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");

/** A partial name is not permission to combine two different companies. */
export function canSupplementRecipientEmployer(
  recipient: Recipient,
  employer: Customer,
): boolean {
  if (recipient.employerId && recipient.employerId !== employer.id)
    return false;
  if (
    recipient.employerBin?.trim() &&
    employer.bin?.trim() &&
    recipient.employerBin.trim() !== employer.bin.trim()
  )
    return false;
  if (recipient.employerId === employer.id) return true;
  const names = [
    employerText(employer.nameRu),
    employerText(employer.nameKz),
  ].filter(Boolean);
  const localNames = [
    employerText(recipient.workplaceRu),
    employerText(recipient.workplaceKz),
  ].filter(Boolean);
  if (localNames.length)
    return localNames.every((name) => names.includes(name));
  if (recipient.employerBin?.trim())
    return recipient.employerBin.trim() === employer.bin?.trim();
  // An address alone cannot establish the identity of an organization.
  return (
    !recipient.employerAddressRu?.trim() && !recipient.employerAddressKz?.trim()
  );
}

/** Fill missing details only after matching identity; keep every local exception. */
export function supplementRecipientEmployer(
  recipient: Recipient,
  employer: Customer,
): Recipient {
  if (!canSupplementRecipientEmployer(recipient, employer)) return recipient;
  const next = { ...recipient, employerId: employer.id };
  for (const [field, value] of [
    ["workplaceRu", employer.nameRu],
    ["workplaceKz", employer.nameKz],
    ["employerBin", employer.bin],
    ["employerAddressRu", employer.addressRu],
    ["employerAddressKz", employer.addressKz],
  ] as const) {
    if (!recipient[field]?.trim() && value?.trim()) next[field] = value;
  }
  return JSON.stringify(next) === JSON.stringify(recipient) ? recipient : next;
}

/** Existing document wording is an immutable starting point until Apply. */
export function recipientOrganizationDraft(
  recipient: Recipient,
): OrganizationNames {
  const hasName = !!(recipient.workplaceRu || recipient.workplaceKz);
  return {
    legalForm: hasName ? null : "NONE",
    ownNameRu: hasName ? null : "",
    ownNameKz: hasName ? null : "",
    nameRu: recipient.workplaceRu,
    nameKz: recipient.workplaceKz,
  };
}

/** A document name override does not change the directory record or its identity. */
export function applyRecipientOrganization(
  recipient: Recipient,
  value: OrganizationNames,
): Recipient {
  const names = customerSchema.parse(value);
  return { ...recipient, workplaceRu: names.nameRu, workplaceKz: names.nameKz };
}

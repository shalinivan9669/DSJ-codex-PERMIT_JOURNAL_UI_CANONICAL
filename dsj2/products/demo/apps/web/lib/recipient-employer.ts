import { customerSchema, type OrganizationNames } from "@demo/contracts";
import type { Customer, Recipient } from "./types";

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

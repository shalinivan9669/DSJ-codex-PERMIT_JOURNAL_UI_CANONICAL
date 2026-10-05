import type { Recipient } from "./types";

export type RequestEmployer = {
  id: string;
  nameRu: string;
  nameKz?: string | null;
  bin?: string | null;
  addressRu?: string | null;
  addressKz?: string | null;
};

const text = (value?: string | null) =>
  (value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");

/** A legacy exception is visible without repeating the ordinary company fields. */
export function hasRecipientEmployerException(
  person: Recipient,
  company: RequestEmployer,
) {
  if (person.employerId && person.employerId !== company.id) return true;
  const knownNames = [text(company.nameRu), text(company.nameKz)].filter(
    Boolean,
  );
  if (
    [person.workplaceRu, person.workplaceKz].some(
      (value) => text(value) && !knownNames.includes(text(value)),
    )
  )
    return true;
  return (
    [
      [person.employerBin, company.bin],
      [person.employerAddressRu, company.addressRu || company.addressKz],
      [person.employerAddressKz, company.addressKz || company.addressRu],
    ] as const
  ).some(
    ([local, inherited]) => !!text(local) && text(local) !== text(inherited),
  );
}

import type { Customer } from "./types";

/** Prefilled complete names stay verbatim until a legal form is explicitly selected. */
export function initialCustomerDraft(customer: Partial<Customer>) {
  const legacy =
    !customer.legalForm &&
    Boolean(customer.id || customer.nameRu || customer.nameKz);
  return {
    nameRu: "",
    nameKz: "",
    bin: "",
    addressRu: "",
    addressKz: "",
    city: "",
    archived: false,
    ...customer,
    legalForm: legacy ? null : (customer.legalForm ?? "NONE"),
    ownNameRu: legacy ? null : (customer.ownNameRu ?? customer.nameRu ?? ""),
    ownNameKz: legacy ? null : (customer.ownNameKz ?? customer.nameKz ?? ""),
  };
}

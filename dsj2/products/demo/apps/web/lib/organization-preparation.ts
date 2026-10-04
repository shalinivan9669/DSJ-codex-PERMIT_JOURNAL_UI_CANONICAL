import type { OrganizationNames } from "@demo/contracts";
import type { Customer } from "./types";

export type OrganizationPreparation = {
  version: 1;
  names: OrganizationNames;
  operationKey: string;
  customer?: Customer;
};
export function organizationPreparationKey(
  tenantId: string,
  userId: string,
  requestId: string,
) {
  return `demo:organization:v1:${[tenantId, userId, requestId].map(encodeURIComponent).join(":")}`;
}
/** Incomplete company text is a saved preparation, never an automatic directory record. */
export function parseOrganizationPreparation(
  raw: string | null,
): OrganizationPreparation | null {
  if (!raw) return null;
  const record = JSON.parse(raw) as OrganizationPreparation;
  if (
    record?.version !== 1 ||
    typeof record.operationKey !== "string" ||
    !/^[a-zA-Z0-9_-]{16,128}$/.test(record.operationKey) ||
    !record.names ||
    ![
      record.names.nameRu,
      record.names.nameKz,
      record.names.ownNameRu,
      record.names.ownNameKz,
    ].every(
      (value) =>
        value === null || value === undefined || typeof value === "string",
    ) ||
    (record.customer && typeof record.customer.id !== "string")
  )
    throw new Error(
      "Сохранённый ввод компании повреждён. Проверьте название и сохраните его повторно.",
    );
  return record;
}

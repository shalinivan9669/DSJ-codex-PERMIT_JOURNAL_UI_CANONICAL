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
export class OrganizationPreparationConflictError extends Error {
  constructor() {
    super(
      "Ввод компании изменён в другой вкладке. Ваш текст остаётся на экране. Загрузите сохранённый ввод перед продолжением.",
    );
  }
}

export function assertOrganizationPreparationCurrent(
  storage: Pick<Storage, "getItem">,
  key: string,
  expectedRaw: string | null,
) {
  if (storage.getItem(key) !== expectedRaw)
    throw new OrganizationPreparationConflictError();
}

/** Never overwrite or clear a newer candidate, including after a late POST. */
export function writeOrganizationPreparation(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  key: string,
  record: OrganizationPreparation | null,
  expectedRaw: string | null,
) {
  assertOrganizationPreparationCurrent(storage, key, expectedRaw);
  const raw = record ? JSON.stringify(record) : null;
  if (raw !== null) storage.setItem(key, raw);
  else storage.removeItem(key);
  if (storage.getItem(key) !== raw)
    throw new Error("Браузер не сохранил ввод компании. Повторите сохранение.");
  return raw;
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

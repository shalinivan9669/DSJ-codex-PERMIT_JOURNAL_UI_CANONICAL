import type { TrainingEventInput } from "@demo/contracts";
import type { Draft } from "./types";

export type PreparationOwner = { tenantId: string; userId: string };
export type PreparationIdentity = PreparationOwner & {
  requestId: string;
  targetId: string;
  kind: "outcome" | "calendar";
};
export type PreparationRecord<T> = {
  version: 1;
  identity: PreparationIdentity;
  title: string;
  requestRevision: number;
  context: string;
  savedAt: string;
  value: T;
};
export type OutcomePreparation = {
  status: "UNKNOWN" | "PASSED" | "FAILED" | "ABSENT";
  source: string;
  knowledge: string;
  proctoring: string;
  scope: "event" | "selected";
};
export const emptyOutcomePreparation: OutcomePreparation = {
  status: "UNKNOWN",
  source: "",
  knowledge: "",
  proctoring: "",
  scope: "event",
};
export function preparationKey(identity: PreparationIdentity) {
  return (
    "demo:preparation:v1:" +
    [
      identity.tenantId,
      identity.userId,
      identity.requestId,
      identity.kind,
      identity.targetId,
    ]
      .map(encodeURIComponent)
      .join(":")
  );
}
export function preparationPrefix(owner: PreparationOwner, requestId: string) {
  return (
    "demo:preparation:v1:" +
    [owner.tenantId, owner.userId, requestId]
      .map(encodeURIComponent)
      .join(":") +
    ":"
  );
}
export function parsePreparation<T>(
  raw: string | null,
  identity: PreparationIdentity,
  validate: (value: unknown) => value is T,
): PreparationRecord<T> | null {
  if (!raw) return null;
  const record = JSON.parse(raw) as PreparationRecord<T>;
  if (
    record?.version !== 1 ||
    preparationKey(record.identity) !== preparationKey(identity) ||
    typeof record.title !== "string" ||
    typeof record.context !== "string" ||
    !Number.isSafeInteger(record.requestRevision) ||
    !validate(record.value)
  )
    throw new Error(
      "Сохранённая подготовка не соответствует этой заявке. Скопируйте ввод и отмените повреждённую подготовку.",
    );
  return record;
}
export function validOutcomePreparation(
  value: unknown,
): value is OutcomePreparation {
  if (!value || typeof value !== "object") return false;
  const row = value as OutcomePreparation;
  return (
    ["UNKNOWN", "PASSED", "FAILED", "ABSENT"].includes(row.status) &&
    ["event", "selected"].includes(row.scope) &&
    [row.source, row.knowledge, row.proctoring].every(
      (v) => typeof v === "string",
    ) &&
    Object.keys(row).every((key) => Object.hasOwn(emptyOutcomePreparation, key))
  );
}
/** Review depends on training and affected facts, never on unrelated title/name edits. */
export function eventPreparationContext(
  draft: Draft,
  event: TrainingEventInput | undefined,
  recipientIds?: string[],
) {
  if (!event) return "REMOVED";
  return JSON.stringify({
    eventId: event.id,
    protocolTemplateId: event.protocolTemplateId,
    commonFields: event.commonFields,
    requestCommon: draft.commonFields,
    serviceRuleVersionId: event.serviceRuleVersionId,
    profileVersionId: event.profileVersionId,
    members: draft.items
      .filter((row) => !recipientIds || recipientIds.includes(row.id))
      .flatMap((row) =>
        row.assignments
          .filter((a) => a.eventId === event.id)
          .map((a) => [
            row.id,
            row.employeeCategory,
            a.id,
            a.templateId,
            a.protocolMode,
            a.fieldOrigins,
            a.outcome,
            a.result,
            a.biotKnowledgeResult,
            a.biotProctoringResult,
            a.documentDate,
            a.trainingStart,
            a.trainingEnd,
            a.protocolDate,
            a.trainingSubject,
            a.hours,
            a.productionHours,
            a.trainingDateRule,
          ]),
      )
      .sort((a, b) => String(a[2]).localeCompare(String(b[2]))),
  });
}
export function writePreparation<T>(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  key: string,
  record: PreparationRecord<T> | null,
  expectedRaw: string | null,
) {
  if (storage.getItem(key) !== expectedRaw)
    throw new Error(
      "Подготовка изменена в другом окне. Загрузите сохранённый вариант; ваш ввод остаётся на экране.",
    );
  const raw = record ? JSON.stringify(record) : null;
  if (raw) storage.setItem(key, raw);
  else storage.removeItem(key);
  if (storage.getItem(key) !== raw)
    throw new Error(
      "Браузер не сохранил подготовку. Повторите сохранение перед выходом.",
    );
  return raw;
}

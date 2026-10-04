import { updateAssignment } from "./assignment-presets";
import type { Assignment, Recipient } from "./types";
import { isBlankText } from "./blank-text";
import { validDate } from "@demo/contracts";

export const bulkFields = [
  ["documentDate", "Дата документа", "date"],
  ["trainingStart", "Начало обучения", "date"],
  ["trainingEnd", "Окончание обучения", "date"],
  ["protocolDate", "Дата проверки / протокола", "date"],
  ["trainingSubject", "Программа / тема", "text"],
  ["hours", "Объём обучения, часов", "text"],
  ["externalBasisNumber", "Внешнее основание", "text"],
  ["reason", "Причина проверки", "text"],
] as const;
export const bulkRecipientFields = [
  ["positionRu", "Должность RU", "text"],
  ["positionKz", "Должность KZ", "text"],
  ["workplaceRu", "Место работы RU", "text"],
  ["workplaceKz", "Место работы KZ", "text"],
] as const;
export type BulkField =
  | (typeof bulkFields)[number][0]
  | (typeof bulkRecipientFields)[number][0];
export type BulkMode = "EMPTY" | "INHERITED" | "REPLACE";
export type BulkChange = {
  recipientId: string;
  name: string;
  assignmentId: string;
  templateId: string;
  field: BulkField;
  before: string;
  rawBefore?: string;
  beforeSource?: "INDIVIDUAL" | "EFFECTIVE" | "LANGUAGE";
  beforeSourceLabel?: string;
  after: string;
};
export function bulkPatchIssues(
  patch: Partial<Record<BulkField, string>>,
): Partial<Record<BulkField, string>> {
  const issues: Partial<Record<BulkField, string>> = {};
  for (const [field, value] of Object.entries(patch) as [BulkField, string][]) {
    const limit =
      field === "hours" ? 30 : field === "externalBasisNumber" ? 100 : 500;
    if (value.length > limit)
      issues[field] =
        `Максимум ${limit} символов. Введённый текст сохранён; проверьте его без потери обязательных данных.`;
    if (
      ["documentDate", "trainingStart", "trainingEnd", "protocolDate"].includes(
        field,
      ) &&
      !isBlankText(value) &&
      !validDate(value)
    )
      issues[field] = "Укажите существующую календарную дату.";
  }
  return issues;
}
/** A preview is also the exact patch. Explicit field mask prevents unrelated results or directions being changed. */
export function previewBulk(
  items: Recipient[],
  selectedIds: string[],
  direction: string,
  patch: Partial<Record<BulkField, string>>,
  mode: BulkMode,
  resolvedItems?: Recipient[],
  eventId?: string,
) {
  const selected = new Set(selectedIds);
  const changes: BulkChange[] = [];
  let skipped = 0;
  const next = items.map((item) => {
    if (!selected.has(item.id)) return item;
    const recipientPatch: Partial<Recipient> = {};
    // Person fields have no inheritance metadata. Never reinterpret a stored
    // individual or imported value as an inherited document default.
    if (mode !== "INHERITED") {
      for (const [field] of bulkRecipientFields) {
        if (!Object.hasOwn(patch, field)) continue;
        const rawBefore = item[field] || "";
        const before =
          resolvedItems?.find((row) => row.id === item.id)?.[field] ||
          rawBefore;
        const after = patch[field] || "";
        if (
          (mode === "EMPTY" && !isBlankText(rawBefore)) ||
          rawBefore === after
        )
          continue;
        recipientPatch[field] = after;
        const counterpart = field.endsWith("Ru")
          ? field.replace(/Ru$/, "Kz")
          : field.replace(/Kz$/, "Ru");
        const otherLanguage = (item as unknown as Record<string, string>)[
          counterpart
        ];
        const beforeSource =
          isBlankText(rawBefore) && !isBlankText(before)
            ? !isBlankText(otherLanguage)
              ? "LANGUAGE"
              : "EFFECTIVE"
            : "INDIVIDUAL";
        changes.push({
          recipientId: item.id,
          name: item.fullNameRu || item.fullNameKz || "Без имени",
          assignmentId: "",
          templateId: "",
          field,
          before,
          rawBefore,
          beforeSource,
          beforeSourceLabel:
            beforeSource === "EFFECTIVE"
              ? "Действующее общее значение; индивидуальное поле пусто"
              : beforeSource === "LANGUAGE"
                ? "Использовано введённое написание другого языка; индивидуальное поле пусто"
                : "Индивидуальное значение",
          after,
        });
      }
    }
    return {
      ...item,
      ...recipientPatch,
      assignments: item.assignments.map((assignment) => {
        if (
          !direction ||
          !assignment.templateId.startsWith(direction + "-") ||
          (eventId !== undefined && (assignment.eventId || "") !== eventId)
        ) {
          skipped += 1;
          return assignment;
        }
        const allowed: Partial<Assignment> = {};
        for (const [field] of bulkFields) {
          if (!Object.hasOwn(patch, field)) continue;
          const effective = resolvedItems
            ?.find((row) => row.id === item.id)
            ?.assignments.find((a) => a.id === assignment.id);
          const before = String((effective || assignment)[field] || "");
          const after = patch[field] || "";
          const origin = assignment.fieldOrigins?.[field];
          const inherited =
            origin === "INHERITED" || (!origin && !assignment[field]);
          if (mode === "INHERITED" && !inherited) continue;
          if ((mode === "EMPTY" && !isBlankText(before)) || before === after)
            continue;
          allowed[field] = after;
          changes.push({
            recipientId: item.id,
            name: item.fullNameRu || item.fullNameKz || "Без имени",
            assignmentId: assignment.id,
            templateId: assignment.templateId,
            field,
            before,
            after,
            beforeSourceLabel:
              (
                {
                  MANUAL: "Ручное значение",
                  IMPORTED: "Импортированное значение",
                  CLEARED: "Явно очищенное значение",
                  AUTO: "Рассчитанное значение",
                  INHERITED: "Общие действующие сведения (наследование)",
                } as Record<string, string>
              )[origin || ""] ||
              (inherited
                ? "Общие действующие сведения (наследование)"
                : "Индивидуальное значение"),
          });
        }
        return Object.keys(allowed).length
          ? updateAssignment(assignment, allowed)
          : assignment;
      }),
    };
  });
  return {
    items: next,
    changes,
    skipped,
    people: new Set(changes.map((c) => c.recipientId)).size,
    assignments: new Set(changes.map((c) => c.assignmentId).filter(Boolean))
      .size,
  };
}

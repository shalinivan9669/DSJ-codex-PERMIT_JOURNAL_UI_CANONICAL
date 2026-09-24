import { updateAssignment } from "./assignment-presets";
import type { Assignment, Recipient } from "./types";

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
export type BulkField = (typeof bulkFields)[number][0];
export type BulkMode = "EMPTY" | "INHERITED" | "REPLACE";
export type BulkChange = {
  recipientId: string;
  name: string;
  assignmentId: string;
  templateId: string;
  field: BulkField;
  before: string;
  after: string;
};
/** A preview is also the exact patch. Explicit field mask prevents unrelated results or directions being changed. */
export function previewBulk(
  items: Recipient[],
  selectedIds: string[],
  direction: string,
  patch: Partial<Record<BulkField, string>>,
  mode: BulkMode,
  resolvedItems?: Recipient[],
) {
  const selected = new Set(selectedIds);
  const changes: BulkChange[] = [];
  let skipped = 0;
  const next = items.map((item) => {
    if (!selected.has(item.id)) return item;
    return {
      ...item,
      assignments: item.assignments.map((assignment) => {
        if (!direction || !assignment.templateId.startsWith(direction + "-")) {
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
          if ((mode === "EMPTY" && before) || before === after) continue;
          allowed[field] = after;
          changes.push({
            recipientId: item.id,
            name: item.fullNameRu || "Без имени",
            assignmentId: assignment.id,
            templateId: assignment.templateId,
            field,
            before,
            after,
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
    assignments: new Set(changes.map((c) => c.assignmentId)).size,
  };
}

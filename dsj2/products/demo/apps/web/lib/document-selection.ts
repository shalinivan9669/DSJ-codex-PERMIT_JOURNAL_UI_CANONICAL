import { LIMITS, protocolTemplateFor, templateIds } from "@demo/contracts";
import { newAssignment, type Assignment, type Recipient } from "./types";

export type DocumentTemplateId = Assignment["templateId"];
export const MAX_RECIPIENT_DOCUMENTS = LIMITS.documents;

export const documentChoices: readonly {
  templateId: DocumentTemplateId;
  label: string;
  shortLabel: string;
  additional?: boolean;
}[] = [
  {
    templateId: "biot-worker-card",
    label: "БиОТ — удостоверение рабочего",
    shortLabel: "БиОТ · рабочий",
  },
  {
    templateId: "biot-itr-certificate",
    label: "БиОТ — сертификат ИТР",
    shortLabel: "БиОТ · ИТР",
  },
  { templateId: "ptm-card", label: "ПТМ — удостоверение", shortLabel: "ПТМ" },
  { templateId: "pb-card", label: "ПБ — удостоверение", shortLabel: "ПБ" },
  { templateId: "ps-card", label: "ПС — удостоверение", shortLabel: "ПС" },
  {
    templateId: "ps-witness",
    label: "ПС — свидетельство",
    shortLabel: "ПС · свидетельство",
    additional: true,
  },
  {
    templateId: "biot-protocol",
    label: "БиОТ рабочих — отдельный протокол",
    shortLabel: "БиОТ · протокол",
    additional: true,
  },
  {
    templateId: "biot-itr-protocol",
    label: "БиОТ ИТР — отдельный протокол",
    shortLabel: "ИТР · протокол",
    additional: true,
  },
  {
    templateId: "ptm-protocol",
    label: "ПТМ — отдельный протокол",
    shortLabel: "ПТМ · протокол",
    additional: true,
  },
  {
    templateId: "pb-protocol",
    label: "ПБ — отдельный протокол",
    shortLabel: "ПБ · протокол",
    additional: true,
  },
  {
    templateId: "ps-protocol",
    label: "ПС — отдельный протокол",
    shortLabel: "ПС · протокол",
    additional: true,
  },
];

/** A shared event already supplies its protocol; do not add a second copy. */
export function assignedDocumentTemplates(recipient: Recipient) {
  const assigned = new Set(
    recipient.assignments.map((item) => item.templateId),
  );
  for (const assignment of recipient.assignments) {
    if (assignment.protocolMode !== "GROUP" || !assignment.eventId) continue;
    const protocol = protocolTemplateFor(assignment.templateId);
    if (templateIds.includes(protocol as DocumentTemplateId))
      assigned.add(protocol as DocumentTemplateId);
  }
  return assigned;
}

export function previewDocumentSelection(
  items: Recipient[],
  selectedIds: readonly string[],
  chosenTemplates: readonly DocumentTemplateId[],
) {
  const selected = new Set(selectedIds);
  const templates = [...new Set(chosenTemplates)];
  const recipients = items.filter((item) => selected.has(item.id));
  const additions = recipients.map((recipient) => {
    const assigned = assignedDocumentTemplates(recipient);
    return {
      recipient,
      templates: templates.filter((template) => !assigned.has(template)),
    };
  });
  const addedDocuments = additions.reduce(
    (count, entry) => count + entry.templates.length,
    0,
  );
  const totalDocuments =
    items.reduce(
      (count, recipient) => count + recipient.assignments.length,
      0,
    ) + addedDocuments;
  const overLimit =
    totalDocuments > LIMITS.documents
      ? additions.filter((entry) => entry.templates.length)
      : [];
  return {
    recipients,
    additions,
    people: additions.filter((entry) => entry.templates.length).length,
    documents: addedDocuments,
    overLimit,
  };
}

/** Add missing forms only. Existing IDs, manual values and event links survive. */
export function addSelectedDocuments(
  items: Recipient[],
  selectedIds: readonly string[],
  chosenTemplates: readonly DocumentTemplateId[],
): Recipient[] {
  const preview = previewDocumentSelection(items, selectedIds, chosenTemplates);
  if (preview.overLimit.length)
    throw new Error(
      `Превышен технический объём заявки: ${LIMITS.documents} назначений. Состав сохранён; обратитесь к администратору центра.`,
    );
  const additions = new Map(
    preview.additions.map(({ recipient, templates }) => [
      recipient.id,
      templates,
    ]),
  );
  return items.map((recipient) => {
    const missing = additions.get(recipient.id);
    if (!missing?.length) return recipient;
    return {
      ...recipient,
      assignments: [
        ...recipient.assignments,
        ...missing.map((templateId) => newAssignment(templateId)),
      ],
    };
  });
}

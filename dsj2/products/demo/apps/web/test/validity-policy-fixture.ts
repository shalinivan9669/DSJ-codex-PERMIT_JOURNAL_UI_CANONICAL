import {
  BIOT_CATEGORIES,
  applyBusinessRules,
  biotCategoryIds,
  businessValidUntil,
  draftSchema,
  eventProtocolAssignment,
  mandatoryTemplates,
  resolveDraft,
  type BiotCategory,
  type EmployeeCategory,
  type TrainingDirection,
} from "@demo/contracts";
import {
  biotCategoryDescription,
  liveValidityDescription,
  presetValidityLabel,
} from "../lib/validity-display";

export function measuredValidityRows(
  origin: "MANUAL" | "IMPORTED" | "INHERITED" | "CLEARED" = "MANUAL",
) {
  const specs: {
    category: EmployeeCategory;
    direction: TrainingDirection;
    biot?: BiotCategory;
  }[] = [
    ...biotCategoryIds.map((biot) => ({
      category: BIOT_CATEGORIES[biot].form,
      direction: "BIOT" as const,
      biot,
    })),
    ...(["PB", "PTM", "PS"] as const).flatMap((direction) =>
      (["WORKER", "ITR"] as const).map((category) => ({ category, direction })),
    ),
  ];
  const result = [];
  for (const spec of specs) {
    for (const grouped of [false, true]) {
      const templates = mandatoryTemplates(spec.direction, spec.category);
      const eventId = spec.direction + "-" + (spec.biot || spec.category);
      const primaryId = "assignment-" + eventId;
      const source = draftSchema.parse({
        kind: "PERSON",
        schemaVersion: 2,
        commonFields: { documentDate: "2026-10-03" },
        ...(grouped
          ? {
              events: [
                {
                  id: eventId,
                  title: "Синтетическое " + eventId,
                  protocolMode: "GROUP",
                  protocolTemplateId: templates.find((t) =>
                    t.endsWith("-protocol"),
                  ),
                  commonFields: {
                    documentDate: "2026-10-03",
                    ...(spec.biot ? { biotCategory: spec.biot } : {}),
                  },
                },
              ],
            }
          : {}),
        items: [
          {
            id: "synthetic-person",
            fullNameRu: "Синтетический Получатель",
            employeeCategory: spec.category,
            assignments: [
              {
                id: primaryId,
                templateId: templates[0],
                ...(spec.biot ? { biotCategory: spec.biot } : {}),
                eventId: grouped ? eventId : undefined,
                protocolMode: grouped ? "GROUP" : "INDIVIDUAL",
                documentDate:
                  origin === "CLEARED" || origin === "INHERITED"
                    ? ""
                    : "2026-10-03",
                validUntil: "2035-12-31",
                fieldOrigins: { documentDate: origin, validUntil: "MANUAL" },
                outcome: { status: "UNKNOWN", source: "" },
              },
            ],
          },
        ],
      });
      const saved = applyBusinessRules(source);
      const resolved = resolveDraft(saved);
      const item = resolved.draft.items[0];
      const rows = item.assignments.map((assignment) => ({
        assignment,
        groupProtocol: false,
      }));
      if (grouped)
        rows.push({
          assignment: eventProtocolAssignment(
            resolved.draft.events!.find((e) => e.id === eventId)!,
            item.assignments[0],
            true,
          ),
          groupProtocol: true,
        });
      for (const { assignment, groupProtocol } of rows) {
        const raw = saved.items[0].assignments.find(
          (a) => a.id === assignment.id,
        );
        const provenance =
          resolved.provenance[
            item.id + ":" + (groupProtocol ? primaryId : assignment.id)
          ];
        result.push({
          selectedCategory: spec.biot || spec.category,
          employeeCategory: spec.category,
          direction: spec.direction,
          templateId: assignment.templateId,
          scope: groupProtocol
            ? "GROUP_PROTOCOL"
            : grouped
              ? "GROUP_MEMBER"
              : "INDIVIDUAL",
          hint: spec.biot
            ? biotCategoryDescription(spec.biot, true)
            : liveValidityDescription(item, assignment),
          presetValidity: spec.biot
            ? presetValidityLabel(spec.biot)
            : "Не задаётся preset БиОТ",
          liveRule: liveValidityDescription(item, assignment),
          issueDate: assignment.documentDate,
          requestedIssueOrigin: origin,
          effectiveIssueOrigin: provenance?.documentDate,
          displayedUntil: assignment.validUntil,
          resolvedUntil: assignment.validUntil,
          savedUntil:
            raw?.validUntil ?? saved.items[0].assignments[0].validUntil,
          savedOrigin:
            raw?.fieldOrigins?.validUntil ??
            saved.items[0].assignments[0].fieldOrigins?.validUntil,
          resolvedOrigin: provenance?.validUntil,
          validityMode: assignment.validityMode,
          expectedUntil:
            spec.direction === "PS"
              ? ""
              : businessValidUntil(
                  groupProtocol
                    ? item.assignments[0].documentDate
                    : assignment.documentDate,
                  spec.category,
                ),
          legalApproval: false,
        });
      }
    }
  }
  return result;
}

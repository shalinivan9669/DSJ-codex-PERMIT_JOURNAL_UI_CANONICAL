import {
  applyBusinessRules,
  commonFieldKeys,
  employeeCategoryFor,
  mandatoryTemplates,
  trainingDirection,
  type TrainingDirection,
  type TrainingEventInput,
} from "@demo/contracts";
import {
  newAssignment,
  newRecipient,
  type Draft,
  type Recipient,
} from "./types";

export const requestBundles = {
  WORKER: {
    label: "Рабочие",
    card: "biot-worker-card",
    protocol: "biot-protocol",
    description: "Удостоверение рабочего и общий протокол БиОТ",
  },
  ITR: {
    label: "ИТР",
    card: "biot-itr-certificate",
    protocol: "biot-itr-protocol",
    description: "Сертификат ИТР и общий протокол специальных компетенций",
  },
} as const;
export type RequestBundle = keyof typeof requestBundles;

export function bundleAssignment(event: TrainingEventInput) {
  const bundle = Object.values(requestBundles).find(
    (entry) => entry.protocol === event.protocolTemplateId,
  );
  if (!bundle) throw new Error("Неизвестный комплект БиОТ");
  return {
    ...newAssignment(bundle.card),
    eventId: event.id,
    protocolMode: event.protocolMode || ("GROUP" as const),
    fieldOrigins: Object.fromEntries(
      commonFieldKeys.map((key) => [key, "INHERITED" as const]),
    ),
    outcome: { status: "UNKNOWN" as const, source: "" },
  };
}

/** One event owns the protocol; selecting a bundle never registers documents. */
export function newRequestBundle(category: RequestBundle) {
  const choice = requestBundles[category];
  const defaults = newAssignment(choice.card);
  const event: TrainingEventInput = {
    id: crypto.randomUUID(),
    title: choice.label,
    protocolTemplateId: choice.protocol,
    revision: 0,
    protocolMode: "INDIVIDUAL",
    protocolModeSource: "AUTO",
    commonFields: {
      biotCategory: defaults.biotCategory,
      biotCheckType: "PERIODIC",
      hours: defaults.hours,
      ...(defaults.productionHours
        ? { productionHours: defaults.productionHours }
        : {}),
    },
  };
  const person = newRecipient();
  person.employeeCategory = category;
  person.assignments = [bundleAssignment(event)];
  const draft = applyBusinessRules({
    kind: "PERSON",
    title: "",
    customerId: null,
    demoMode: false,
    events: [event],
    items: [person],
  });
  return {
    events: draft.events!,
    items: draft.items,
    businessRuleVersion: draft.businessRuleVersion,
  };
}

/** New rows join only an unambiguous single bundle, never a different event. */
export function recipientForRequest(
  draft: Pick<Draft, "events">,
  person = newRecipient(),
): Recipient {
  if (draft.events?.length !== 1) return person;
  const event = draft.events[0];
  if (
    !Object.values(requestBundles).some(
      (bundle) => bundle.protocol === event.protocolTemplateId,
    )
  )
    return person;
  return {
    ...person,
    employeeCategory:
      event.protocolTemplateId === "biot-itr-protocol" ? "ITR" : "WORKER",
    assignments: [bundleAssignment(event)],
  };
}

/** Assign a complete training kit; compatible selected rows share one event. */
export function assignTrainingBundle<T extends Draft>(
  input: T,
  selectedIds: readonly string[],
  direction: TrainingDirection,
  protocolMode?: "GROUP" | "INDIVIDUAL",
): T {
  const draft = structuredClone(input);
  draft.events ||= [];
  const selected = new Set(selectedIds);
  const partitions = new Map<string, Recipient[]>();
  for (const item of draft.items.filter((row) => selected.has(row.id))) {
    const key = direction === "BIOT" ? employeeCategoryFor(item) : direction;
    const group = partitions.get(key) || [];
    group.push(item);
    partitions.set(key, group);
  }
  for (const recipients of partitions.values()) {
    const category = employeeCategoryFor(recipients[0]);
    const templates = mandatoryTemplates(direction, category);
    const protocolTemplateId = templates.at(
      -1,
    ) as TrainingEventInput["protocolTemplateId"];
    const existingAssignments = recipients.flatMap((item) =>
      item.assignments.filter(
        (a) =>
          trainingDirection(a.templateId) === direction &&
          !a.templateId.endsWith("-protocol") &&
          a.templateId !== "ps-witness",
      ),
    );
    const eventIds = new Set(
      existingAssignments.map((a) => a.eventId).filter(Boolean),
    );
    // Re-selection never moves an existing training to a different event.
    let event =
      eventIds.size === 1
        ? draft.events.find(
            (candidate) =>
              candidate.id === [...eventIds][0] &&
              candidate.protocolTemplateId === protocolTemplateId,
          )
        : undefined;
    if (!event) {
      const defaults = newAssignment(templates[0]);
      event = {
        id: crypto.randomUUID(),
        title: `${direction}${direction === "BIOT" ? (category === "ITR" ? " — ИТР" : " — Рабочие") : ""}`,
        protocolTemplateId,
        protocolMode:
          protocolMode || (recipients.length >= 2 ? "GROUP" : "INDIVIDUAL"),
        protocolModeSource: protocolMode ? "MANUAL" : "AUTO",
        revision: 0,
        commonFields: {
          ...(defaults.biotCategory
            ? {
                biotCategory: defaults.biotCategory,
                biotCheckType: "PERIODIC" as const,
              }
            : {}),
          ...(defaults.hours ? { hours: defaults.hours } : {}),
          ...(defaults.productionHours
            ? { productionHours: defaults.productionHours }
            : {}),
        },
      };
      draft.events.push(event);
    } else if (protocolMode) {
      event.protocolMode = protocolMode;
      event.protocolModeSource = "MANUAL";
    }
    for (const item of recipients) {
      item.employeeCategory = employeeCategoryFor(item);
      const existing = item.assignments.find(
        (assignment) => trainingDirection(assignment.templateId) === direction,
      );
      if (existing) {
        if (!existing.eventId)
          for (const assignment of item.assignments.filter(
            (candidate) =>
              !candidate.eventId &&
              trainingDirection(candidate.templateId) === direction,
          )) {
            assignment.eventId = event.id;
            assignment.protocolMode = assignment.templateId.endsWith(
              "-protocol",
            )
              ? "INDIVIDUAL"
              : event.protocolMode || "GROUP";
            if (!assignment.templateId.endsWith("-protocol"))
              assignment.outcome ||= { status: "UNKNOWN", source: "" };
          }
        continue;
      }
      const primary = newAssignment(
        mandatoryTemplates(direction, item.employeeCategory)[0],
      );
      primary.eventId = event.id;
      primary.protocolMode = event.protocolMode || "GROUP";
      primary.fieldOrigins = Object.fromEntries(
        commonFieldKeys.map((key) => [key, "INHERITED" as const]),
      );
      primary.outcome = { status: "UNKNOWN", source: "" };
      item.assignments.push(primary);
    }
  }
  // An idempotent repeat with no additions must not leave a new empty event.
  draft.events = draft.events.filter(
    (event) =>
      input.events?.some((old) => old.id === event.id) ||
      draft.items.some((item) =>
        item.assignments.some((assignment) => assignment.eventId === event.id),
      ),
  );
  return applyBusinessRules(draft);
}

export function setTrainingProtocolMode<T extends Draft>(
  input: T,
  eventId: string,
  mode: "GROUP" | "INDIVIDUAL",
): T {
  const draft = structuredClone(input);
  const event = draft.events?.find((candidate) => candidate.id === eventId);
  if (!event) throw new Error("Событие обучения не найдено");
  event.protocolMode = mode;
  event.protocolModeSource = "MANUAL";
  return applyBusinessRules(draft);
}

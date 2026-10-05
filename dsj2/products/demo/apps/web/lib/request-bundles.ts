import {
  applyBusinessRules,
  commonFieldKeys,
  employeeCategoryFor,
  mandatoryTemplates,
  positiveAssignmentDefaults,
  trainingDirection,
  trainingDirections,
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
    description: "Сертификат ИТР и общий протокол ИТР",
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
    ...positiveAssignmentDefaults(bundle.card),
    fieldOrigins: {
      ...Object.fromEntries(
        commonFieldKeys.map((key) => [key, "INHERITED" as const]),
      ),
      ...positiveAssignmentDefaults(bundle.card).fieldOrigins,
    },
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

/** Only an explicit common assignment is a default for subsequent recipients. */
export function recipientForRequest(
  draft: Pick<Draft, "events" | "trainingDefaults">,
  person?: Recipient,
): Recipient {
  const recipient = person ?? { ...newRecipient(), assignments: [] };
  // Callers pass empty assignments for freshly added, pasted or directory rows.
  // A supplied assignment may contain dates/results or represent a separate course.
  if (person?.assignments.length) return person;
  const events = trainingDirections.flatMap((direction) => {
    const policy = draft.trainingDefaults?.find(
      (entry) => entry.direction === direction,
    );
    if (!policy) return [];
    const candidates = (draft.events || []).filter(
      (event) =>
        policy.eventIds.includes(event.id) &&
        trainingDirection(event.protocolTemplateId) === direction,
    );
    return candidates;
  });
  if (!events.length) return recipient;
  const category = employeeCategoryFor(recipient);
  const matchesCategory = (event: TrainingEventInput) =>
    event.protocolTemplateId ===
    mandatoryTemplates(
      trainingDirection(event.protocolTemplateId),
      category,
    ).at(-1);
  const compatibleEvents = events.filter(
    (event) =>
      matchesCategory(event) ||
      !events.some(
        (candidate) =>
          trainingDirection(candidate.protocolTemplateId) ===
            trainingDirection(event.protocolTemplateId) &&
          matchesCategory(candidate),
      ),
  );
  if (!compatibleEvents.length) return recipient;
  return {
    ...recipient,
    employeeCategory: category,
    // edit() and submitProposal() apply the existing business-rule engine to
    // the complete request. A missing category variant is derived there with
    // preserved lineage; never silently drop an explicitly common direction.
    assignments: compatibleEvents.map((event) => ({
      ...newAssignment(
        mandatoryTemplates(
          trainingDirection(event.protocolTemplateId),
          category,
        )[0],
      ),
      eventId: event.id,
      protocolMode: event.protocolMode || ("GROUP" as const),
      ...positiveAssignmentDefaults(
        mandatoryTemplates(
          trainingDirection(event.protocolTemplateId),
          category,
        )[0],
      ),
      fieldOrigins: {
        ...Object.fromEntries(
          commonFieldKeys.map((key) => [key, "INHERITED" as const]),
        ),
        ...positiveAssignmentDefaults(
          mandatoryTemplates(
            trainingDirection(event.protocolTemplateId),
            category,
          )[0],
        ).fieldOrigins,
      },
    })),
  };
}

/** Assign a complete training kit; compatible selected rows share one event. */
export function assignTrainingBundle<T extends Draft>(
  input: T,
  selectedIds: readonly string[],
  direction: TrainingDirection,
  protocolMode?: "GROUP" | "INDIVIDUAL",
  commonForNewRecipients = false,
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
        // Adding a missing kit is not consent to move an existing independent
        // course into a shared event. An explicit protocol mode selection is
        // the only action here that may enroll an unbound existing kit.
        if (!existing.eventId && protocolMode)
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
      primary.fieldOrigins = {
        ...primary.fieldOrigins,
        ...positiveAssignmentDefaults(primary.templateId).fieldOrigins,
      };
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
  if (commonForNewRecipients) {
    const eventIds = [
      ...new Set(
        draft.items.flatMap((item) =>
          item.assignments
            .filter(
              (assignment) =>
                trainingDirection(assignment.templateId) === direction,
            )
            .flatMap((assignment) =>
              assignment.eventId ? [assignment.eventId] : [],
            ),
        ),
      ),
    ];
    draft.trainingDefaults = [
      ...(draft.trainingDefaults || []).filter(
        (entry) => entry.direction !== direction,
      ),
      { direction, eventIds },
    ];
  }
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

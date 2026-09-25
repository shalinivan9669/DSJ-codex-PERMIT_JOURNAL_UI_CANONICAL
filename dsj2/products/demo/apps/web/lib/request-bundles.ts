import { commonFieldKeys, type TrainingEventInput } from "@demo/contracts";
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
    protocolMode: "GROUP" as const,
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
  person.assignments = [bundleAssignment(event)];
  return { events: [event], items: [person] };
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
  return { ...person, assignments: [bundleAssignment(event)] };
}

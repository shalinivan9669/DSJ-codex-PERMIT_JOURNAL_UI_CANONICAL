import { draftSchema, today } from "@demo/contracts";
import { newRecipient, type AppContext } from "./types";

export type NewRequestAttempt = {
  version: 1;
  kind: "PERSON" | "COMPANY";
  key: string;
  body: string;
};

export function newRequestStorageKey(context: AppContext) {
  return `demo:new-request:${context.tenant.id}:${context.user.id}`;
}

/** Keep the exact body as well as the key: row IDs and the date must not change on retry. */
export function prepareNewRequest(
  context: AppContext,
  kind: NewRequestAttempt["kind"],
): NewRequestAttempt {
  return {
    version: 1,
    kind,
    key: crypto.randomUUID(),
    body: JSON.stringify({
      kind,
      schemaVersion: 2,
      businessRuleVersion: "LIVE_V1",
      englishAppendix: false,
      commonFields: { documentDate: today(context.tenant.timezone) },
      title:
        kind === "PERSON"
          ? "Новая заявка на человека"
          : "Новая заявка организации",
      customerId: null,
      demoMode: !!context.tenant.demoOnly,
      items: [{ ...newRecipient(), assignments: [] }],
    }),
  };
}

export function restoreNewRequest(
  raw: string | null,
): NewRequestAttempt | null {
  if (!raw) return null;
  const value = JSON.parse(raw) as NewRequestAttempt;
  if (
    value?.version !== 1 ||
    !["PERSON", "COMPANY"].includes(value.kind) ||
    typeof value.key !== "string" ||
    !/^[a-zA-Z0-9_-]{16,128}$/.test(value.key) ||
    typeof value.body !== "string" ||
    value.body.length > 20000
  )
    throw new Error(
      "Не удалось восстановить создание заявки. Проверьте список заявок перед новой попыткой.",
    );
  const draft = draftSchema.parse(JSON.parse(value.body));
  if (draft.kind !== value.kind)
    throw new Error("Не удалось восстановить тип заявки.");
  return value;
}

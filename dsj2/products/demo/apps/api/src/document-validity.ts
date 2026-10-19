type Fields = Record<string, unknown>;
function object(value: unknown): Fields {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Fields)
    : {};
}

/** Issued dates take precedence over later reminder data. A missing date does
 * not invent a validity period; explicit unlimited validity stays unlimited. */
export function issuedDocumentValidity(
  snapshot: unknown,
  document: {
    rowId: string | null;
    assignmentId: string | null;
    groupEventId: string | null;
  },
  confirmedRenewalDate: string | null,
): string | null {
  const draft = object(object(snapshot).draft);
  const items = Array.isArray(draft.items) ? draft.items : [];
  const person = object(
    items.find((item) => object(item).id === document.rowId),
  );
  const assignments = Array.isArray(person.assignments)
    ? person.assignments
    : [];
  const assignment = object(
    assignments.find((item) => object(item).id === document.assignmentId),
  );
  const events = Array.isArray(draft.events) ? draft.events : [];
  const event = object(
    events.find((item) => object(item).id === document.groupEventId),
  );
  const fields = document.groupEventId
    ? object(event.commonFields)
    : assignment;
  if (fields.validityMode === "UNLIMITED") return null;
  const value =
    typeof fields.validUntil === "string" && fields.validUntil
      ? fields.validUntil
      : confirmedRenewalDate;
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

export function publicDocumentStatus(input: {
  replaced: boolean;
  revoked: boolean;
  validUntil: string | null;
  today: string;
}) {
  if (input.replaced) return "REPLACED";
  if (input.revoked) return "REVOKED";
  return input.validUntil && input.validUntil < input.today
    ? "EXPIRED"
    : "ACTIVE_RECORD";
}

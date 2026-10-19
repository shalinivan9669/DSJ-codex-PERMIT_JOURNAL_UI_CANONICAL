import { isIP } from "node:net";

type SafeValue = string | number | boolean | null;
type SafeFields = Record<string, SafeValue>;
const safeKeys = new Set([
  "role", "active", "status", "state", "version", "revision", "sessionVersion",
  "archived", "hidden", "dueAt", "startsAt", "endsAt", "effectiveFrom",
  "effectiveUntil", "cursor", "count", "total", "approved", "enabled",
  "contentHash", "semanticHash", "definitionHash", "courseVersionId",
  "regulatoryProfileVersionId", "documentType", "legalForm", "verdict",
  "sourceType", "requestSource", "sessionsRevoked", "consentVersion",
]);
function record(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown> : {};
}
function safeFields(input: unknown): SafeFields | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "boolean" || typeof input === "number") return { value: input };
  // Scalar before/after values are permitted only for state identifiers, not
  // arbitrary text (names, answers, reasons, credentials or personal data).
  if (typeof input === "string") return /^[A-Z][A-Z_]{0,59}$/.test(input) ? { value: input } : null;
  const result: SafeFields = {};
  for (const [key, value] of Object.entries(record(input))) {
    if (!safeKeys.has(key)) continue;
    if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) result[key] = value;
    else if (typeof value === "string" && value.length <= 150 && !Array.from(value).some(character => character.charCodeAt(0) < 32)) result[key] = value;
  }
  return Object.keys(result).length ? result : null;
}

/** Public API projection for the authorized audit viewer; never return metadata. */
export function auditDetails(metadata: unknown) {
  const data = record(metadata);
  const ip = typeof data.trustedIp === "string" && isIP(data.trustedIp) ? data.trustedIp : null;
  return {
    ip,
    before: safeFields(data.before ?? data.previous ?? (data.previousRole ? { role: data.previousRole } : null)),
    after: safeFields(data.after ?? data.current ?? (data.currentRole ? { role: data.currentRole } : null)),
    details: safeFields(data),
  };
}

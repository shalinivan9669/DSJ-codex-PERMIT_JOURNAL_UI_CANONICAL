import { artifactUrl } from "./api";
import type { SigningTestContext } from "./signing-mode";

export type SignatureEvidenceRecord = SigningTestContext & {
  artifactId: string;
  requestId: string;
  documentNumber: string;
  templateId: string;
  sourcePdfSha256: string;
  localTest: boolean;
  signers: {
    role: string;
    displayName: string;
    receivedAt: string;
    identityNote: string;
  }[];
  pendingRoles: string[];
  signatureSetHash: string;
  originalDownloadUrl: string;
};

/** This link always returns the exact PDF bytes to which the signatures belong. */
export function signatureEvidenceOriginalUrl(relativeUrl: string) {
  const match = /^\/artifacts\/([A-Za-z0-9_-]+)$/.exec(relativeUrl);
  return match ? artifactUrl(match[1], { original: true }) : null;
}

export function signatureEvidenceReceivedAt(value: string, timezone: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  let selectedTimezone = timezone;
  try {
    new Intl.DateTimeFormat("ru-RU", { timeZone: selectedTimezone }).format(
      date,
    );
  } catch {
    selectedTimezone = "UTC";
  }
  return `${new Intl.DateTimeFormat("ru-RU", {
    timeZone: selectedTimezone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date)} (${selectedTimezone})`;
}

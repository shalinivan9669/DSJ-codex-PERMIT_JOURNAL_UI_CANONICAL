/** Transferable business data excludes credentials and short-lived login state. */
export const TENANT_EXPORT_EXCLUDED_MODELS = new Set([
  "Session",
  "MfaFactor",
  "MfaRecoveryCode",
  "MfaChallenge",
  "MfaReauth",
]);

const SECRET_FIELDS = new Set([
  "passwordHash",
  "tokenHash",
  "verificationTokenHash",
  "csrfHash",
  "secretHash",
  "codeHash",
  "secretCiphertext",
  "pendingCiphertext",
]);

export function tenantExportSelect(
  fields: ReadonlyArray<{ name: string; kind: string }>,
) {
  return Object.fromEntries(
    fields
      .filter(
        (field) => field.kind !== "object" && !SECRET_FIELDS.has(field.name),
      )
      .map((field) => [field.name, true]),
  );
}

/** Signature evidence uses different column names from generated documents. */
export function tenantExportFileReferences(row: Record<string, unknown>) {
  return ["storageKey", "originalStorageKey", "signatureStorageKey"].flatMap(
    (field) => {
      const key = row[field];
      if (typeof key !== "string" || !key) return [];
      const digest =
        field === "signatureStorageKey"
          ? row.signatureSha256
          : field === "originalStorageKey"
            ? undefined
            : row.sha256 || row.checksum;
      return [
        {
          field,
          key,
          expectedHash: typeof digest === "string" ? digest : undefined,
          expectedSize:
            field === "storageKey" && typeof row.size === "number"
              ? row.size
              : undefined,
        },
      ];
    },
  );
}

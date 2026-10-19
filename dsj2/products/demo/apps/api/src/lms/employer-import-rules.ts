import { z } from "@demo/contracts";

export const EMPLOYER_IMPORT_LIMIT = 5000;
export const EMPLOYER_IMPORT_CHUNK = 50;
export const employerImportFields = [
  "fullNameRu",
  "iin",
  "phone",
  "email",
  "positionRu",
  "course",
  "recipientId",
] as const;
export const employerImportRowSchema = z
  .object({
    sourceRow: z.number().int().min(1).max(10002),
    fullNameRu: z.string().trim().max(500).default(""),
    iin: z.string().trim().max(30).default(""),
    phone: z.string().trim().max(80).default(""),
    email: z.string().trim().max(255).default(""),
    positionRu: z.string().trim().max(500).default(""),
    course: z.string().trim().max(500).default(""),
    recipientId: z.string().max(100).default(""),
    resolution: z.enum(["AUTO", "REUSE", "NEW", "SKIP"]).default("AUTO"),
    sourceErrors: z.array(z.string().max(80)).max(20).default([]),
  })
  .strict();
export type EmployerImportRow = z.infer<typeof employerImportRowSchema>;
export type EmployerImportCandidate = {
  id: string;
  data: Record<string, unknown>;
};
export function normalizeImportValue(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("ru");
}
export function importRowErrors(
  row: EmployerImportRow,
  courseTitles: string[] = [],
) {
  if (row.resolution === "SKIP") return [];
  const errors = row.sourceErrors.filter((code) => code !== "DUPLICATE_ROW");
  if (!row.fullNameRu && !row.recipientId) errors.push("NAME_REQUIRED");
  if (row.iin && !/^\d{12}$/.test(row.iin)) errors.push("IIN_INVALID");
  if (row.email && !z.email().safeParse(row.email).success)
    errors.push("EMAIL_INVALID");
  if (
    employerImportFields.some(
      (field) =>
        (/^[=+@]|^-\D/.test(row[field]) ||
          [...row[field]].some((character) => {
            const code = character.charCodeAt(0);
            return code < 32 && ![9, 10, 13].includes(code);
          })) &&
        !(field === "phone" && /^\+?[\d ()-]+$/.test(row[field])),
    )
  )
    errors.push("UNSAFE_CELL");
  if (
    row.course &&
    courseTitles.length &&
    !courseTitles.some(
      (title) =>
        normalizeImportValue(title) === normalizeImportValue(row.course),
    )
  )
    errors.push("COURSE_MISMATCH");
  if (row.resolution === "REUSE" && !row.recipientId)
    errors.push("MATCH_REQUIRED");
  return [...new Set(errors)];
}
/** Weak names/contacts produce choices, never an account link or an implicit merge. */
export function reconcileEmployerRows(
  rows: EmployerImportRow[],
  candidates: EmployerImportCandidate[],
  courseTitles: string[] = [],
) {
  const byId = new Map(
    candidates.map((candidate) => [candidate.id, candidate]),
  );
  const indexes = new Map<string, EmployerImportCandidate[]>();
  for (const candidate of candidates)
    for (const field of ["fullNameRu", "iin", "email", "phone"]) {
      const value = normalizeImportValue(candidate.data[field]);
      if (value)
        indexes.set(`${field}:${value}`, [
          ...(indexes.get(`${field}:${value}`) || []),
          candidate,
        ]);
    }
  const duplicateKeys = new Map<string, number>();
  for (const row of rows.filter((item) => item.resolution !== "SKIP")) {
    const keys = [
      row.recipientId && `id:${row.recipientId}`,
      row.iin && `iin:${row.iin}`,
      `row:${JSON.stringify([row.fullNameRu, row.phone, row.email, row.positionRu].map(normalizeImportValue))}`,
    ].filter(Boolean) as string[];
    for (const key of keys)
      duplicateKeys.set(key, (duplicateKeys.get(key) || 0) + 1);
  }
  return rows.map((row) => {
    const errors = importRowErrors(row, courseTitles);
    if (row.resolution === "SKIP")
      return {
        row,
        errors,
        candidates: [],
        recipientId: null,
        outcome: "SKIPPED",
      };
    const keys = [
      row.recipientId && `id:${row.recipientId}`,
      row.iin && `iin:${row.iin}`,
      `row:${JSON.stringify([row.fullNameRu, row.phone, row.email, row.positionRu].map(normalizeImportValue))}`,
    ].filter(Boolean) as string[];
    if (keys.some((key) => (duplicateKeys.get(key) || 0) > 1))
      errors.push("DUPLICATE_ROW");
    const matches = [
      ...new Map(
        ["fullNameRu", "iin", "email", "phone"]
          .flatMap(
            (field) =>
              indexes.get(
                `${field}:${normalizeImportValue(row[field as keyof EmployerImportRow])}`,
              ) || [],
          )
          .map((candidate) => [candidate.id, candidate]),
      ).values(),
    ];
    const explicit = row.recipientId ? byId.get(row.recipientId) : undefined;
    if (row.recipientId && !explicit) errors.push("RECIPIENT_UNAVAILABLE");
    if (
      row.resolution === "NEW" &&
      matches.some((candidate) => row.iin && candidate.data.iin === row.iin)
    )
      errors.push("MATCH_REQUIRED");
    if (!row.recipientId && row.resolution !== "NEW" && matches.length)
      errors.push("MATCH_REQUIRED");
    return {
      row,
      errors: [...new Set(errors)],
      candidates: matches.map((candidate) => ({
        id: candidate.id,
        fullNameRu: String(candidate.data.fullNameRu || ""),
        positionRu: String(candidate.data.positionRu || ""),
      })),
      recipientId: explicit?.id || null,
      outcome: explicit ? "REUSED" : "NEW",
    };
  });
}

export function mapImportRows(
  headers: string[],
  rawRows: { rowNumber: number; values: string[]; errors?: string[] }[],
  mapping: Record<string, string>,
) {
  return rawRows.map((raw) =>
    employerImportRowSchema.parse({
      ...Object.fromEntries(
        employerImportFields.map((field) => [
          field,
          raw.values[headers.indexOf(mapping[field] || "")] || "",
        ]),
      ),
      sourceRow: raw.rowNumber,
      sourceErrors: raw.errors || [],
    }),
  );
}

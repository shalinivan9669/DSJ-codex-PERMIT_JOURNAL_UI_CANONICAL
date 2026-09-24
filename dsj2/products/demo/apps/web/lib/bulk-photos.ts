import type { Recipient } from "./types";
export type PhotoFile = { name: string; size: number; type: string };
export type PhotoMatch = {
  fileIndex: number;
  fileName: string;
  key: string;
  category: "matched" | "missing" | "ambiguous" | "invalid";
  rowId?: string;
  candidates: string[];
  reason?: string;
};
export function photoEmployerScope(
  item: Recipient,
  customerId?: string | null,
) {
  const employer = item.employerId || item.employerBin || customerId;
  return employer
    ? JSON.stringify([employer, item.employmentPeriod || ""])
    : "";
}
/** File stems must equal explicit stable keys. Names are never treated as identifiers. */
export function matchBulkPhotos(
  items: Recipient[],
  files: PhotoFile[],
  options: {
    mode: "EXTERNAL_ID" | "PERSONNEL_NUMBER";
    employerScope?: string;
    customerId?: string | null;
  },
) {
  const errors: string[] = [];
  if (files.length > 100)
    errors.push(
      "Выберите не более 100 фотографий за один раз. Файлы не обрезаны.",
    );
  if (files.reduce((size, file) => size + file.size, 0) > 50 * 1024 * 1024)
    errors.push("Общий размер фотографий превышает 50 МиБ.");
  if (options.mode === "PERSONNEL_NUMBER" && !options.employerScope)
    errors.push("Выберите работодателя и период для табельных номеров.");
  const eligible = items.filter(
    (item) =>
      options.mode === "EXTERNAL_ID" ||
      photoEmployerScope(item, options.customerId) === options.employerScope,
  );
  const rows: PhotoMatch[] = files.map((file, fileIndex) => {
    const key = file.name.replace(/\.(png|jpe?g)$/i, "");
    const candidates = eligible
      .filter(
        (item) =>
          (options.mode === "EXTERNAL_ID"
            ? item.externalId
            : item.personnelNumber) === key,
      )
      .map((item) => item.id);
    const invalid =
      !/\.(png|jpe?g)$/i.test(file.name) ||
      !["", "image/png", "image/jpeg"].includes(file.type) ||
      file.size > 5 * 1024 * 1024;
    return {
      fileIndex,
      fileName: file.name,
      key,
      candidates,
      category: invalid
        ? "invalid"
        : candidates.length > 1
          ? "ambiguous"
          : candidates.length
            ? "matched"
            : "missing",
      rowId: candidates.length === 1 ? candidates[0] : undefined,
      reason: invalid ? "Допустимы PNG/JPEG до 5 МиБ" : undefined,
    };
  });
  for (const row of rows)
    if (
      row.category === "matched" &&
      rows.filter(
        (candidate) =>
          candidate.rowId === row.rowId && candidate.category !== "invalid",
      ).length > 1
    )
      row.category = "ambiguous";
  const matchedIds = new Set(
    rows.filter((row) => row.category === "matched").map((row) => row.rowId),
  );
  return {
    rows,
    errors,
    matched: rows.filter((row) => row.category === "matched").length,
    ambiguous: rows.filter((row) => row.category === "ambiguous").length,
    missing: eligible
      .filter((item) => !matchedIds.has(item.id))
      .map((item) => item.id),
  };
}

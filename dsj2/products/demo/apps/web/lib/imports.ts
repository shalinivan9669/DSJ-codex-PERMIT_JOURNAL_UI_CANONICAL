import { newAssignment, type Recipient } from "./types";
export type ImportRow = {
  sourceRow: number;
  values: string[];
  errors?: string[];
  duplicate?: boolean;
};
export type ImportPreview = {
  importId: string;
  checksum?: string;
  columns: string[];
  rows: ImportRow[];
  total: number;
  sheets?: string[];
  sheet?: string;
  errors?: (
    | string
    | { code?: string; message?: string; count?: number; limit?: number }
  )[];
};
export function importIssueText(
  issue: NonNullable<ImportPreview["errors"]>[number],
): string {
  if (typeof issue === "string") return issue;
  if (issue.code === "ROW_LIMIT")
    return `В исходном листе ${issue.count ?? "более 100"} строк. Для одной заявки выберите не более ${issue.limit ?? 100} получателей.`;
  return (
    issue.message ||
    "Проверьте исходный файл и отмеченные строки перед импортом."
  );
}
export function importRowIssueText(code: string): string {
  if (code === "FORMULA_NOT_ALLOWED")
    return "Формула не импортируется. Замените её обычным значением в исходном файле.";
  if (code === "DUPLICATE_ROW") return "Возможный дубль исходной строки.";
  if (code === "NAME_REQUIRED")
    return "Укажите ФИО на русском или заполните его в черновике.";
  if (code.endsWith(":INVALID_DATE"))
    return "Проверьте календарную дату в исходной строке.";
  return "Строка содержит неподдерживаемые данные. Исправьте исходный файл.";
}
export const importFields: [string, string][] = [
  ["fullNameRu", "ФИО RU"],
  ["fullNameKz", "ФИО KZ"],
  ["positionRu", "Должность RU"],
  ["positionKz", "Должность KZ"],
  ["workplaceRu", "Место работы RU"],
  ["workplaceKz", "Место работы KZ"],
  ["documentDate", "Дата документа"],
  ["trainingStart", "Начало обучения"],
  ["trainingEnd", "Окончание обучения"],
  ["protocolDate", "Дата протокола"],
  ["trainingSubject", "Программа / тема"],
  ["result", "Результат / оценка"],
  ["hours", "Часы"],
  ["reason", "Причина проверки знаний"],
  ["education", "Образование"],
  ["validUntil", "Действителен до"],
  ["externalBasisNumber", "Внешний номер основания"],
];
export function inferMapping(columns: string[]): string[] {
  const used = new Set<string>();
  return columns.map((column) => {
    const lower = column
      .toLowerCase()
      .replace(/[_\s·—-]+/g, " ")
      .trim();
    const match = importFields.find(
      ([field, title]) =>
        field.toLowerCase() === lower || title.toLowerCase() === lower,
    );
    let field =
      match?.[0] ||
      (/фио|full.?name|аты.?жөні|ф\.и\.о/.test(lower)
        ? /kz|каз|қаз|аты/.test(lower)
          ? "fullNameKz"
          : "fullNameRu"
        : /должност/.test(lower)
          ? /kz|каз/.test(lower)
            ? "positionKz"
            : "positionRu"
          : "");
    if (used.has(field)) field = "";
    if (field) used.add(field);
    return field;
  });
}
export function mapImportRow(
  preview: ImportPreview,
  row: ImportRow,
  mapping: string[],
  templateId: Parameters<typeof newAssignment>[0],
): Recipient {
  const id = `${preview.importId.slice(0, 55)}-${row.sourceRow}`;
  const assignment = { ...newAssignment(templateId), id: `${id}-doc` };
  const result: Recipient = {
    id,
    importId: preview.importId,
    sourceRow: row.sourceRow,
    fullNameRu: "",
    fullNameKz: "",
    positionRu: "",
    positionKz: "",
    workplaceRu: "",
    workplaceKz: "",
    photoAssetId: null,
    assignments: [assignment],
  };
  mapping.forEach((field, index) => {
    const value = String(row.values[index] ?? "");
    if (
      [
        "fullNameRu",
        "fullNameKz",
        "positionRu",
        "positionKz",
        "workplaceRu",
        "workplaceKz",
      ].includes(field)
    )
      (result as unknown as Record<string, unknown>)[field] = value;
    else if (importFields.some(([key]) => key === field))
      (assignment as unknown as Record<string, unknown>)[field] = value;
  });
  return result;
}

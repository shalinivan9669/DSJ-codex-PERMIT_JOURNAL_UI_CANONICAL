import { newAssignment, type Assignment, type Recipient } from "./types";
import { ApiError, errorText } from "./api";
import {
  BIOT_CATEGORIES,
  biotValidUntil,
  commonFieldKeys,
  LIMITS,
  itemSchema,
  nonPassedResultKz,
  validDate,
  type BiotCategory,
  type EmployeeCategory,
  type TrainingEventInput,
} from "@demo/contracts";
import {
  biotCategoriesForTemplate,
  updateAssignment,
} from "./assignment-presets";
import { isBlankText } from "./blank-text";
export class ImportMappingError extends Error {
  constructor(
    public field: string,
    message: string,
  ) {
    super(message);
  }
}
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
export function importApplyErrorText(
  error: unknown,
  starterCandidate: boolean,
): string {
  const details = error instanceof ApiError ? error.details : undefined;
  const retainedStarterLimit =
    starterCandidate &&
    details &&
    typeof details === "object" &&
    "code" in details &&
    details.code === "ROW_LIMIT";
  return retainedStarterLimit
    ? `${errorText(error)} Ранее заполненная, затем очищенная строка не удаляется автоматически. Состав сохранён; проверьте эту строку или обратитесь к администратору центра.`
    : errorText(error);
}
export function importIssueText(
  issue: NonNullable<ImportPreview["errors"]>[number],
): string {
  if (typeof issue === "string") return issue;
  if (issue.code === "ROW_LIMIT")
    return `В исходном листе ${issue.count ?? `более ${LIMITS.rows}`} строк. Технический объём одной заявки — ${issue.limit ?? LIMITS.rows} получателей. Строки не обрезаны; обратитесь к администратору центра.`;
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
  ["externalId", "Внешний ID"],
  ["personnelNumber", "Табельный номер"],
  ["employerId", "ID работодателя"],
  ["employeeCategory", "Категория сотрудника"],
  ["fullNameRu", "ФИО RU"],
  ["fullNameKz", "ФИО KZ"],
  ["fullNameEn", "ФИО EN"],
  ["positionRu", "Должность RU"],
  ["positionKz", "Должность KZ"],
  ["positionEn", "Должность EN"],
  ["workplaceRu", "Место работы RU"],
  ["workplaceKz", "Место работы KZ"],
  ["workplaceEn", "Место работы EN"],
  ["departmentRu", "Подразделение RU"],
  ["departmentKz", "Подразделение KZ"],
  ["departmentEn", "Подразделение EN"],
  ["employerBin", "БИН работодателя"],
  ["employerAddressRu", "Юридический адрес работодателя RU"],
  ["employerAddressKz", "Юридический адрес работодателя KZ"],
  ["employerAddressEn", "Юридический адрес работодателя EN"],
  ["documentDate", "Дата документа"],
  ["trainingStart", "Начало обучения"],
  ["trainingEnd", "Окончание обучения"],
  ["protocolDate", "Дата протокола"],
  ["trainingSubject", "Программа / тема"],
  ["trainingSubjectEn", "Программа / тема EN"],
  ["result", "Результат / оценка"],
  ["resultEn", "Результат / оценка EN"],
  ["hours", "Часы"],
  ["productionHours", "Производственное обучение, часов"],
  ["biotCategory", "Категория обучения БиОТ"],
  ["biotIndustryRu", "Отрасль специальных компетенций RU"],
  ["biotIndustryKz", "Отрасль специальных компетенций KZ"],
  ["biotIndustryEn", "Отрасль специальных компетенций EN"],
  ["biotCheckType", "Вид проверки знаний БиОТ"],
  ["biotKnowledgeResult", "Фактический результат проверки знаний"],
  ["biotKnowledgeResultEn", "Фактический результат проверки знаний EN"],
  ["biotProctoringResult", "Фактический результат прокторинга"],
  ["biotProctoringResultEn", "Фактический результат прокторинга EN"],
  ["biotUniqueNumber", "Уникальный номер сертификата БиОТ"],
  ["biotNotes", "Примечание к протоколу БиОТ"],
  ["biotNotesEn", "Примечание к протоколу БиОТ EN"],
  ["reason", "Причина проверки знаний"],
  ["reasonEn", "Причина проверки знаний EN"],
  ["education", "Образование"],
  ["educationEn", "Образование EN"],
  ["validUntil", "Действителен до"],
  ["externalBasisNumber", "Внешний номер основания"],
];
export type SavedImportMapping = {
  id: string;
  name: string;
  columns: string[];
  mapping: Record<string, string>;
};
/** Reuse only an exact, unambiguous header set; conflicting rules need review. */
export function recognizedImportMapping(
  columns: string[],
  saved: SavedImportMapping[],
) {
  const normalize = (value: string) =>
    value.normalize("NFKC").trim().toLocaleLowerCase("ru").replace(/\s+/g, " ");
  const headers = columns.map(normalize);
  const uniqueHeaders = new Set(headers).size === headers.length;
  const allowed = new Set(importFields.map(([field]) => field));
  const candidates = uniqueHeaders
    ? saved.flatMap((rule) => {
        const known = rule.columns.map(normalize);
        if (
          known.length !== headers.length ||
          new Set(known).size !== known.length ||
          headers.some((header) => !known.includes(header))
        )
          return [];
        const mapping = headers.map(
          (header) => rule.mapping[rule.columns[known.indexOf(header)]] || "",
        );
        const fields = mapping.filter(Boolean);
        return fields.length &&
          fields.every((field) => allowed.has(field)) &&
          new Set(fields).size === fields.length
          ? [{ rule, mapping }]
          : [];
      })
    : [];
  const variants = new Set(
    candidates.map((candidate) => JSON.stringify(candidate.mapping)),
  );
  if (variants.size === 1)
    return {
      mapping: candidates[0].mapping,
      savedName: candidates[0].rule.name,
      needsReview: false,
      conflictingSavedRules: false,
    };
  const mapping = inferMapping(columns);
  return {
    mapping,
    savedName: "",
    needsReview:
      !uniqueHeaders || variants.size > 1 || mapping.some((field) => !field),
    conflictingSavedRules: variants.size > 1,
  };
}
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
      (lower === "externalpersonkey" ? "externalId" : "") ||
      ([
        "категория работника",
        "worker itr",
        "рабочий итр",
        "қызметкер санаты",
        "employee category",
      ].includes(lower)
        ? "employeeCategory"
        : "") ||
      match?.[0] ||
      (/фио|full.?name|аты.?жөні|ф\.и\.о/.test(lower)
        ? /\ben\b|eng|англ/.test(lower)
          ? "fullNameEn"
          : /kz|каз|қаз|аты/.test(lower)
            ? "fullNameKz"
            : "fullNameRu"
        : /должност|position|лауазым/.test(lower)
          ? /\ben\b|eng|англ/.test(lower)
            ? "positionEn"
            : /kz|каз|лауазым/.test(lower)
              ? "positionKz"
              : "positionRu"
          : "");
    if (used.has(field)) field = "";
    if (field) used.add(field);
    return field;
  });
}

export function importedEmployeeCategory(
  value: string,
  sourceRow: number,
): EmployeeCategory | undefined {
  const normalized = value.trim().toLocaleUpperCase("ru");
  if (!normalized) return undefined;
  if (
    ["WORKER", "РАБОЧИЙ", "РАБОЧАЯ", "РАБОЧИЕ", "ЖҰМЫСШЫ"].includes(normalized)
  )
    return "WORKER";
  if (["ITR", "ИТР", "ИТҚ"].includes(normalized)) return "ITR";
  throw new ImportMappingError(
    "employeeCategory",
    `Исходная строка ${sourceRow}: категория сотрудника должна быть «Рабочий» (WORKER) или «ИТР» (ITR). Должность не определяет категорию автоматически.`,
  );
}
const recipientImportFields = [
  "externalId",
  "personnelNumber",
  "employerId",
  "fullNameRu",
  "fullNameKz",
  "fullNameEn",
  "positionRu",
  "positionKz",
  "positionEn",
  "workplaceRu",
  "workplaceKz",
  "workplaceEn",
  "departmentRu",
  "departmentKz",
  "departmentEn",
  "employerBin",
  "employerAddressRu",
  "employerAddressKz",
  "employerAddressEn",
];

export function initialImportTemplate(
  event?: TrainingEventInput,
): Assignment["templateId"] | "" {
  if (event?.protocolTemplateId === "biot-protocol") return "biot-worker-card";
  if (event?.protocolTemplateId === "biot-itr-protocol")
    return "biot-itr-certificate";
  return "";
}

/** Only exact standard status words change the default fact; grades and
 * free text remain independent imported assessments. */
function importedNonPassedStatus(value: string) {
  const known: Record<string, "UNKNOWN" | "FAILED" | "ABSENT"> = {
    неподтверждено: "UNKNOWN",
    расталмаған: "UNKNOWN",
    несдал: "FAILED",
    тапсырмады: "FAILED",
    неявился: "ABSENT",
    келмеді: "ABSENT",
  };
  const parts = value
    .normalize("NFKC")
    .toLocaleLowerCase("ru")
    .replace(/\s+/g, "")
    .split("/");
  const statuses = parts.map((part) =>
    Object.hasOwn(known, part) ? known[part] : undefined,
  );
  return statuses.every(Boolean) && new Set(statuses).size === 1
    ? statuses[0]
    : undefined;
}

export function mapImportRow(
  preview: ImportPreview,
  row: ImportRow,
  mapping: string[],
  templateId: Assignment["templateId"] | "",
  category?: BiotCategory,
): Recipient {
  const id = `${preview.importId.slice(0, 55)}-${row.sourceRow}`;
  const employeeColumn = mapping.indexOf("employeeCategory");
  const employeeCategory = importedEmployeeCategory(
    employeeColumn < 0 ? "" : String(row.values[employeeColumn] ?? ""),
    row.sourceRow,
  );
  if (!templateId) {
    const trainingColumn = mapping.findIndex(
      (field, index) =>
        field !== "employeeCategory" &&
        !recipientImportFields.includes(field) &&
        importFields.some(([key]) => key === field) &&
        String(row.values[index] ?? "").trim(),
    );
    if (trainingColumn >= 0)
      throw new ImportMappingError(
        mapping[trainingColumn],
        `Исходная строка ${row.sourceRow}: выберите документ для переноса учебных данных из колонки «${preview.columns[trainingColumn]}».`,
      );
  }
  const resolvedTemplate =
    employeeCategory && templateId?.startsWith("biot-")
      ? templateId.endsWith("-protocol")
        ? employeeCategory === "ITR"
          ? "biot-itr-protocol"
          : "biot-protocol"
        : employeeCategory === "ITR"
          ? "biot-itr-certificate"
          : "biot-worker-card"
      : templateId;
  let assignment = {
    ...newAssignment(resolvedTemplate || undefined),
    id: `${id}-doc`,
  };
  const categoryColumn = mapping.indexOf("biotCategory");
  const importedCategory =
    categoryColumn < 0 ? "" : String(row.values[categoryColumn] ?? "").trim();
  const selectedCategory =
    importedCategory ||
    (employeeCategory &&
    category &&
    BIOT_CATEGORIES[category].form !== employeeCategory
      ? assignment.biotCategory
      : category);
  if (templateId && selectedCategory) {
    const known = (Object.keys(BIOT_CATEGORIES) as BiotCategory[]).find(
      (key) =>
        key === selectedCategory ||
        BIOT_CATEGORIES[key].label === selectedCategory,
    );
    if (
      !known ||
      !biotCategoriesForTemplate(assignment.templateId).includes(known)
    ) {
      throw new ImportMappingError(
        "biotCategory",
        `Исходная строка ${row.sourceRow}: категория БиОТ не соответствует выбранной форме. Проверьте категорию и документ.`,
      );
    }
    assignment = updateAssignment(assignment, { biotCategory: known });
  }
  const result: Recipient = {
    id,
    importId: preview.importId,
    sourceRow: row.sourceRow,
    employeeCategory:
      employeeCategory ||
      (templateId && assignment.biotCategory
        ? BIOT_CATEGORIES[assignment.biotCategory].form
        : "WORKER"),
    fullNameRu: "",
    fullNameKz: "",
    positionRu: "",
    positionKz: "",
    workplaceRu: "",
    workplaceKz: "",
    photoAssetId: null,
    assignments: templateId ? [assignment] : [],
  };
  mapping.forEach((field, index) => {
    const value = String(row.values[index] ?? "");
    if (recipientImportFields.includes(field))
      (result as unknown as Record<string, unknown>)[field] = value;
    else if (field === "biotCheckType") {
      const checkType = (
        {
          PERIODIC: "PERIODIC",
          REPEAT: "REPEAT",
          Периодическая: "PERIODIC",
          Повторная: "REPEAT",
        } as const
      )[value as "PERIODIC" | "REPEAT" | "Периодическая" | "Повторная"];
      if (value && !checkType)
        throw new ImportMappingError(
          "biotCheckType",
          `Исходная строка ${row.sourceRow}: выберите периодическую или повторную проверку знаний.`,
        );
      assignment.biotCheckType = checkType;
    } else if (
      field !== "biotCategory" &&
      field !== "employeeCategory" &&
      importFields.some(([key]) => key === field)
    )
      (assignment as unknown as Record<string, unknown>)[field] = value;
  });
  if (!mapping.includes("validUntil") && assignment.biotCategory) {
    assignment.validUntil =
      biotValidUntil(assignment.documentDate, assignment.biotCategory) || "";
  }
  const manualFields = (
    ["hours", "productionHours", "validUntil"] as const
  ).filter((field) => mapping.includes(field));
  if (manualFields.length) assignment.biotManualFields = manualFields;
  assignment.fieldOrigins = {
    ...assignment.fieldOrigins,
    ...Object.fromEntries(
      commonFieldKeys
        .filter(
          (field) =>
            mapping.includes(field) &&
            row.values[mapping.indexOf(field)]?.trim(),
        )
        .map((field) => [field, "IMPORTED" as const]),
    ),
  };
  const resultColumn = mapping.indexOf("result");
  if (templateId && resultColumn >= 0) {
    const importedResult = String(row.values[resultColumn] ?? "");
    const clearedResult = isBlankText(importedResult);
    assignment.fieldOrigins.result = clearedResult ? "CLEARED" : "IMPORTED";
    const status = clearedResult
      ? "UNKNOWN"
      : importedNonPassedStatus(importedResult);
    if (status) {
      assignment.outcome = {
        status,
        source: `Импортированный результат, строка ${row.sourceRow}`,
      };
      assignment.resultKz = nonPassedResultKz(status);
      assignment.fieldOrigins = {
        ...assignment.fieldOrigins,
        outcome: "IMPORTED",
        result: clearedResult ? "CLEARED" : "IMPORTED",
        resultKz: "COURSE",
      };
    }
  }
  return result;
}

export type MappedImportIssue = {
  field?: string;
  column?: number;
  message: string;
};
/** Validate the mapped draft, not document readiness. Missing draft text remains allowed. */
export function validateMappedImportRow(
  preview: ImportPreview,
  row: ImportRow,
  mapping: string[],
  templateId: Assignment["templateId"] | "",
  category?: BiotCategory,
): { item?: Recipient; issues: MappedImportIssue[]; incomplete: boolean } {
  const issues: MappedImportIssue[] = [];
  const add = (field: string | undefined, message: string) => {
    const column = field ? mapping.indexOf(field) : -1;
    issues.push({ field, column: column >= 0 ? column : undefined, message });
  };
  if (row.errors?.length) {
    row.errors.forEach((code) => add(undefined, importRowIssueText(code)));
    return { issues, incomplete: false };
  }
  let item: Recipient | undefined;
  try {
    item = mapImportRow(preview, row, mapping, templateId, category);
  } catch (caught) {
    add(
      caught instanceof ImportMappingError ? caught.field : undefined,
      caught instanceof Error
        ? caught.message
        : "Проверьте сопоставленные данные.",
    );
  }
  for (const field of [
    "documentDate",
    "trainingStart",
    "trainingEnd",
    "protocolDate",
    "validUntil",
  ]) {
    const column = mapping.indexOf(field);
    if (column < 0) continue;
    const value = String(row.values[column] ?? "");
    if (!isBlankText(value) && !validDate(value))
      add(
        field,
        "Укажите существующую календарную дату в формате ГГГГ-ММ-ДД. Исходное значение сохранено.",
      );
  }
  if (item) {
    const parsed = itemSchema.safeParse(item);
    if (!parsed.success)
      parsed.error.issues.forEach((issue) => {
        const field = String(issue.path.at(-1) ?? "");
        add(
          field,
          issue.code === "too_big"
            ? `Максимум ${issue.maximum} символов. Исходное значение сохранено; исправьте поле без потери обязательных данных.`
            : issue.message,
        );
      });
  }
  return {
    item,
    issues,
    incomplete:
      !!item && isBlankText(item.fullNameRu) && isBlankText(item.fullNameKz),
  };
}

export function importedSourceRows(
  items: Recipient[],
  importId: string,
): Set<number> {
  return new Set(
    items.flatMap((item) =>
      item.importId === importId && item.sourceRow ? [item.sourceRow] : [],
    ),
  );
}

/** A correction entered in preview is manual input; the original batch stays immutable. */
export function applyImportCorrections(
  item: Recipient,
  mapping: string[],
  corrections: Record<number, string>,
): Recipient {
  const origins = Object.fromEntries(
    Object.entries(corrections).flatMap(([column, value]) => {
      const field = mapping[Number(column)];
      return commonFieldKeys.some((key) => key === field)
        ? [
            [
              field,
              isBlankText(value) ? ("CLEARED" as const) : ("MANUAL" as const),
            ],
          ]
        : [];
    }),
  );
  return {
    ...item,
    assignments: item.assignments.map((assignment) => ({
      ...assignment,
      fieldOrigins: { ...assignment.fieldOrigins, ...origins },
    })),
  };
}

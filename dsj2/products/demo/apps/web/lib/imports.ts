import { newAssignment, type Recipient } from "./types";
import {
  BIOT_CATEGORIES,
  biotValidUntil,
  commonFieldKeys,
  LIMITS,
  type BiotCategory,
  type EmployeeCategory,
} from "@demo/contracts";
import {
  biotCategoriesForTemplate,
  updateAssignment,
} from "./assignment-presets";
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
    return `В исходном листе ${issue.count ?? `более ${LIMITS.rows}`} строк. Для одной заявки выберите не более ${issue.limit ?? LIMITS.rows} получателей.`;
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
  throw new Error(
    `Исходная строка ${sourceRow}: категория сотрудника должна быть «Рабочий» (WORKER) или «ИТР» (ITR). Должность не определяет категорию автоматически.`,
  );
}
export function mapImportRow(
  preview: ImportPreview,
  row: ImportRow,
  mapping: string[],
  templateId: Parameters<typeof newAssignment>[0],
  category?: BiotCategory,
): Recipient {
  const id = `${preview.importId.slice(0, 55)}-${row.sourceRow}`;
  const employeeColumn = mapping.indexOf("employeeCategory");
  const employeeCategory = importedEmployeeCategory(
    employeeColumn < 0 ? "" : String(row.values[employeeColumn] ?? ""),
    row.sourceRow,
  );
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
  let assignment = { ...newAssignment(resolvedTemplate), id: `${id}-doc` };
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
  if (selectedCategory) {
    const known = (Object.keys(BIOT_CATEGORIES) as BiotCategory[]).find(
      (key) =>
        key === selectedCategory ||
        BIOT_CATEGORIES[key].label === selectedCategory,
    );
    if (
      !known ||
      !biotCategoriesForTemplate(assignment.templateId).includes(known)
    ) {
      throw new Error(
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
      (assignment.biotCategory
        ? BIOT_CATEGORIES[assignment.biotCategory].form
        : "WORKER"),
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
      ].includes(field)
    )
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
        throw new Error(
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
  return result;
}

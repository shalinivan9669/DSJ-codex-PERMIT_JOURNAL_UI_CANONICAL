import { z } from "zod";
import { BIOT_CATEGORIES, biotCategoryIds, biotValidUntil } from "./biot";
export { z } from "zod";
export * from "./biot";
export const LIMITS = {
  rows: 100,
  documents: 1000,
  jsonBytes: 2 * 1024 * 1024,
  photoBytes: 5 * 1024 * 1024,
  imagePixels: 20_000_000,
  importBytes: 5 * 1024 * 1024,
} as const;
export const PRINT_LIMITS = { maxUnbroken: 80 } as const;
export const templateIds = [
  "biot-worker-card",
  "biot-itr-certificate",
  "biot-protocol",
  "biot-itr-protocol",
  "ptm-card",
  "ptm-protocol",
  "pb-card",
  "pb-protocol",
  "ps-card",
  "ps-protocol",
  "ps-witness",
] as const;
export const roleSchema = z.enum(["ADMIN", "OPERATOR", "VIEWER"]);
export type Role = z.infer<typeof roleSchema>;
const text = z
  .string()
  .max(
    500,
    "Максимум 500 символов. Проверьте поле без сокращения обязательных данных",
  )
  .default("");
const optionalText = z.string().max(500, "Максимум 500 символов").optional();
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T12:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
export function today(timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return ["year", "month", "day"]
    .map((k) => parts.find((p) => p.type === k)!.value)
    .join("-");
}
const date = z.string().max(10).default("");
export const assignmentSchema = z
  .object({
    id: z.string().min(1).max(80),
    templateId: z.enum(templateIds),
    documentDate: date,
    trainingStart: date,
    trainingEnd: date,
    protocolDate: date,
    validUntil: date,
    trainingSubject: text,
    result: text,
    reason: text,
    education: text,
    hours: z.string().max(30).default(""),
    productionHours: z.string().max(30).optional(),
    biotCategory: z.enum(biotCategoryIds).optional(),
    biotManualFields: z
      .array(z.enum(["hours", "productionHours", "validUntil"]))
      .max(3)
      .optional(),
    biotCheckType: z.enum(["", "PERIODIC", "REPEAT"]).optional(),
    biotIndustryRu: optionalText,
    biotIndustryKz: optionalText,
    biotKnowledgeResult: optionalText,
    biotProctoringResult: optionalText,
    biotUniqueNumber: optionalText,
    biotNotes: optionalText,
    externalBasisNumber: z.string().max(100).default(""),
    protocolMode: z
      .enum(["INDIVIDUAL", "EXTERNAL_REFERENCE"])
      .default("INDIVIDUAL"),
  })
  .strict();
export const itemSchema = z
  .object({
    id: z.string().min(1).max(80),
    fullNameRu: text,
    fullNameKz: text,
    positionRu: text,
    positionKz: text,
    workplaceRu: text,
    workplaceKz: text,
    departmentRu: optionalText,
    departmentKz: optionalText,
    employerBin: z.string().max(50).optional(),
    employerAddressRu: optionalText,
    employerAddressKz: optionalText,
    photoAssetId: z.string().max(80).nullable().default(null),
    assignments: z.array(assignmentSchema).max(10).default([]),
    sourceRow: z.number().int().positive().optional(),
    importId: z.string().max(100).optional(),
  })
  .strict();
export const draftSchema = z
  .object({
    kind: z.enum(["PERSON", "COMPANY"]),
    title: z.string().max(255).default(""),
    customerId: z.string().max(80).nullable().default(null),
    demoMode: z.boolean().default(false),
    items: z.array(itemSchema).max(LIMITS.rows).default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
    const ids = v.items.map((i) => i.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({
        code: "custom",
        path: ["items"],
        message: "Идентификаторы строк повторяются",
      });
    for (const [n, item] of v.items.entries()) {
      if (
        new Set(item.assignments.map((a) => a.id)).size !==
        item.assignments.length
      )
        ctx.addIssue({
          code: "custom",
          path: ["items", n, "assignments"],
          message: "Идентификаторы документов повторяются",
        });
    }
  });
export const patchSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    draft: draftSchema,
  })
  .strict();
export const finalizeSchema = z
  .object({ expectedRevision: z.number().int().nonnegative() })
  .strict();
export const customerSchema = z
  .object({
    nameRu: z
      .string()
      .min(1, "Введите название на русском")
      .max(500, "Максимум 500 символов в названии"),
    nameKz: text,
    bin: z.string().max(50).default(""),
    addressRu: text,
    addressKz: text,
    archived: z.boolean().default(false),
  })
  .strict();
export const profileSchema = z
  .object({
    nameRu: z
      .string()
      .min(1, "Введите название на русском")
      .max(500, "Максимум 500 символов в названии"),
    nameKz: text,
    addressRu: text,
    addressKz: text,
    cityRu: text,
    cityKz: text,
    approvalBasis: text,
    headName: optionalText,
    bin: z.string().max(50).optional(),
    commission: z
      .array(
        z
          .object({
            name: z.string().min(1).max(255),
            position: z.string().max(255),
          })
          .strict(),
      )
      .max(12),
    approved: z.boolean().default(false),
  })
  .strict();
export type Draft = z.infer<typeof draftSchema>;
export type RequestItemInput = z.infer<typeof itemSchema>;
export type Assignment = z.infer<typeof assignmentSchema>;
export type IssuerProfile = z.infer<typeof profileSchema>;
export type ValidationIssue = {
  code: string;
  path: string;
  rowId?: string;
  message: string;
};
export function validateDraft(
  draft: Draft,
  profile: IssuerProfile | null,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (code: string, path: string, message: string, rowId?: string) =>
    issues.push({ code, path, message, rowId });
  const printable = (value: unknown, path: string, rowId?: string) => {
    if (
      typeof value === "string" &&
      value.split(/\s+/u).some((part) => part.length > PRINT_LIMITS.maxUnbroken)
    )
      add(
        "PRINT_UNBROKEN_VALUE",
        path,
        "Непрерывное значение длиннее 80 символов не помещается в печатную форму. Проверьте поле и расставьте допустимые пробелы или переносы без сокращения исходных данных",
        rowId,
      );
  };
  if (profile) {
    for (const [key, value] of Object.entries(profile))
      printable(value, `profile.${key}`);
    for (const [index, member] of profile.commission.entries())
      for (const [key, value] of Object.entries(member))
        printable(value, `profile.commission.${index}.${key}`);
  }
  if (!profile?.approved)
    add(
      "ISSUER_NOT_APPROVED",
      "profile",
      "Подтвердите реквизиты и комиссию центра в настройках",
    );
  if (!draft.items.length) add("NO_RECIPIENTS", "items", "Добавьте получателя");
  if (draft.kind === "COMPANY" && !draft.customerId)
    add("CUSTOMER_REQUIRED", "customerId", "Выберите заказчика");
  let count = 0;
  for (const [n, item] of draft.items.entries()) {
    for (const key of [
      "fullNameRu",
      "fullNameKz",
      "positionRu",
      "positionKz",
      "workplaceRu",
      "workplaceKz",
    ] as const)
      printable(item[key], `items.${n}.${key}`, item.id);
    const protocols = item.assignments.filter((a) =>
      a.templateId.endsWith("-protocol"),
    );
    if (new Set(protocols.map((a) => a.templateId)).size !== protocols.length)
      add(
        "AMBIGUOUS_PROTOCOL",
        `items.${n}.assignments`,
        "Для получателя выберите один индивидуальный протокол по каждому направлению",
        item.id,
      );
    if (!item.fullNameRu.trim())
      add(
        "NAME_REQUIRED",
        `items.${n}.fullNameRu`,
        "Введите ФИО на русском",
        item.id,
      );
    if (!item.assignments.length)
      add(
        "DOCUMENT_REQUIRED",
        `items.${n}.assignments`,
        "Выберите документ",
        item.id,
      );
    for (const [a, assignment] of item.assignments.entries()) {
      count++;
      const path = `items.${n}.assignments.${a}`;
      for (const key of [
        "trainingSubject",
        "result",
        "reason",
        "education",
        "externalBasisNumber",
      ] as const)
        printable(assignment[key], `${path}.${key}`, item.id);
      for (const key of [
        "documentDate",
        "trainingStart",
        "trainingEnd",
        "protocolDate",
        "validUntil",
      ] as const) {
        if (
          (key === "documentDate" || assignment[key]) &&
          !validDate(assignment[key])
        )
          add(
            "DATE_INVALID",
            `${path}.${key}`,
            "Введите действительную календарную дату",
            item.id,
          );
      }
      if (assignment.templateId.startsWith("biot-") && !assignment.biotCategory)
        add(
          "BIOT_CATEGORY_REQUIRED",
          `${path}.biotCategory`,
          "Выберите категорию обучения БиОТ: от неё зависят форма, часы и срок",
          item.id,
        );
      if (assignment.biotCategory) {
        const category = BIOT_CATEGORIES[assignment.biotCategory];
        const expectedTemplate =
          category.form === "WORKER"
            ? "biot-worker-card"
            : "biot-itr-certificate";
        const expectedProtocol =
          category.form === "WORKER" ? "biot-protocol" : "biot-itr-protocol";
        if (
          assignment.templateId !== expectedTemplate &&
          assignment.templateId !== expectedProtocol
        )
          add(
            "BIOT_CATEGORY_TEMPLATE",
            `${path}.biotCategory`,
            "Категория обучения не соответствует выбранной форме БиОТ",
            item.id,
          );
        if (category.requiresExternalCertificate)
          add(
            "BIOT_ECS_REQUIRED",
            `${path}.biotCategory`,
            "Для этой категории требуется оригинал сертификата из ЕЦС. DEMO не присваивает номер ЕЦС и не заменяет выдачу в ЕЦС.",
            item.id,
          );
        const numericHours = (value: string | undefined) =>
          value && /^\d+(?:[.,]\d+)?$/.test(value.trim())
            ? Number(value.replace(",", "."))
            : NaN;
        if (!(numericHours(assignment.hours) >= category.minimumHours))
          add(
            "BIOT_HOURS_MIN",
            `${path}.hours`,
            `${category.hoursLabel}: не менее ${category.minimumHours}`,
            item.id,
          );
        if (
          category.minimumProductionHours &&
          !(
            numericHours(assignment.productionHours) >=
            category.minimumProductionHours
          )
        )
          add(
            "BIOT_PRODUCTION_HOURS_MIN",
            `${path}.productionHours`,
            `Производственное обучение: не менее ${category.minimumProductionHours} часов`,
            item.id,
          );
        const until = biotValidUntil(
          assignment.documentDate,
          assignment.biotCategory,
        );
        if (
          until &&
          !assignment.validUntil &&
          !assignment.templateId.endsWith("-protocol")
        )
          add(
            "BIOT_VALID_UNTIL_REQUIRED",
            `${path}.validUntil`,
            "Укажите срок действия документа БиОТ",
            item.id,
          );
        if (
          validDate(assignment.documentDate) &&
          validDate(assignment.validUntil) &&
          ((until && assignment.validUntil > until) ||
            assignment.validUntil < assignment.documentDate)
        )
          add(
            "BIOT_VALID_UNTIL_RANGE",
            `${path}.validUntil`,
            until
              ? `Срок должен быть от ${assignment.documentDate} до ${until}; более ранняя повторная проверка допустима`
              : "Окончание срока не может быть раньше даты выдачи",
            item.id,
          );
        const requireField = (
          value: string | undefined,
          field: string,
          message: string,
        ) => {
          if (!value?.trim())
            add("BIOT_FIELD_REQUIRED", field, message, item.id);
        };
        const isProtocol = assignment.templateId.endsWith("-protocol");
        if (isProtocol && !category.requiresExternalCertificate) {
          if (
            item.assignments.filter(
              (linked) => linked.templateId === expectedTemplate,
            ).length > 1
          )
            add(
              "BIOT_CREDENTIAL_AMBIGUOUS",
              `${path}.biotUniqueNumber`,
              "К протоколу подходят несколько удостоверений или сертификатов этой строки. Оставьте один связанный документ или оформите отдельные строки получателя",
              item.id,
            );
          if (!assignment.biotCheckType)
            add(
              "BIOT_CHECK_TYPE_REQUIRED",
              `${path}.biotCheckType`,
              "Укажите вид проверки: периодическая или повторная",
              item.id,
            );
          if (!profile || profile.commission.length < 3)
            add(
              "BIOT_COMMISSION_REQUIRED",
              "issuer.commission",
              "Для протокола БиОТ нужны председатель и не менее двух членов комиссии",
              item.id,
            );
          requireField(
            item.workplaceRu,
            `items.${n}.workplaceRu`,
            "Укажите наименование предприятия",
          );
          requireField(
            item.positionRu,
            `items.${n}.positionRu`,
            "Укажите профессию или должность",
          );
          if (category.form === "WORKER")
            requireField(
              profile?.cityRu,
              "issuer.cityRu",
              "Укажите город учебной организации",
            );
        }
        if (category.program === "SPECIAL") {
          requireField(
            assignment.biotIndustryRu,
            `${path}.biotIndustryRu`,
            "Укажите отрасль для специальных компетенций",
          );
          requireField(
            profile?.headName,
            "issuer.headName",
            "Укажите ФИО руководителя учебной организации",
          );
          if (!/^\d{12}$/.test(profile?.bin?.trim() || ""))
            add(
              "BIOT_BIN_REQUIRED",
              "issuer.bin",
              "Укажите БИН учебной организации: 12 цифр",
              item.id,
            );
          if (assignment.templateId === "biot-itr-protocol") {
            const hasLinkedCertificate = item.assignments.some(
              (linked) => linked.templateId === "biot-itr-certificate",
            );
            if (!/^\d{12}$/.test(item.employerBin?.trim() || ""))
              add(
                "BIOT_BIN_REQUIRED",
                `items.${n}.employerBin`,
                "Укажите БИН предприятия: 12 цифр",
                item.id,
              );
            requireField(
              item.employerAddressRu,
              `items.${n}.employerAddressRu`,
              "Укажите адрес предприятия",
            );
            requireField(
              assignment.biotKnowledgeResult,
              `${path}.biotKnowledgeResult`,
              "Укажите фактический результат проверки знаний",
            );
            requireField(
              assignment.biotProctoringResult,
              `${path}.biotProctoringResult`,
              "Укажите фактический результат прокторинга",
            );
            if (!assignment.biotUniqueNumber?.trim() && !hasLinkedCertificate)
              add(
                "BIOT_UNIQUE_NUMBER_REQUIRED",
                `${path}.biotUniqueNumber`,
                "Укажите подтверждённый уникальный номер либо добавьте связанный сертификат специальных компетенций",
                item.id,
              );
            if (assignment.biotUniqueNumber?.trim() && hasLinkedCertificate)
              add(
                "BIOT_UNIQUE_NUMBER_CONFLICT",
                `${path}.biotUniqueNumber`,
                "Выберите одно основание: уникальный номер ранее выданного сертификата или связанный сертификат этой заявки",
                item.id,
              );
          }
        }
      }
      if (!assignment.trainingSubject.trim())
        add(
          "SUBJECT_REQUIRED",
          `${path}.trainingSubject`,
          "Укажите программу/тему обучения",
          item.id,
        );
      if (!assignment.result.trim())
        add(
          "RESULT_REQUIRED",
          `${path}.result`,
          "Введите подтверждённый результат",
          item.id,
        );
      if (
        assignment.trainingStart &&
        assignment.trainingEnd &&
        assignment.trainingStart > assignment.trainingEnd
      )
        add(
          "DATE_ORDER",
          `${path}.trainingEnd`,
          "Окончание раньше начала обучения",
          item.id,
        );
      if (
        assignment.protocolMode === "EXTERNAL_REFERENCE" &&
        !assignment.externalBasisNumber.trim()
      )
        add(
          "BASIS_REQUIRED",
          `${path}.externalBasisNumber`,
          "Укажите внешний номер основания",
          item.id,
        );
      if (
        assignment.templateId.endsWith("-protocol") &&
        assignment.protocolMode !== "INDIVIDUAL"
      )
        add(
          "EXTERNAL_NOT_GENERATED",
          `${path}.protocolMode`,
          "Внешнее основание не создаёт внутренний протокол",
          item.id,
        );
    }
  }
  if (count > LIMITS.documents)
    add("DOCUMENT_LIMIT", "items", "Слишком много документов");
  return issues;
}
export const TEMPLATE_LABELS: Record<(typeof templateIds)[number], string> = {
  "biot-worker-card": "БиОТ — удостоверение рабочего",
  "biot-itr-certificate": "БиОТ — сертификат ИТР",
  "biot-protocol": "БиОТ — индивидуальный протокол",
  "biot-itr-protocol": "БиОТ — протокол специальных компетенций ИТР",
  "ptm-card": "ПТМ — удостоверение",
  "ptm-protocol": "ПТМ — индивидуальный протокол",
  "pb-card": "ПБ — удостоверение",
  "pb-protocol": "ПБ — индивидуальный протокол",
  "ps-card": "ПС — удостоверение",
  "ps-protocol": "ПС — индивидуальный протокол",
  "ps-witness": "ПС — свидетельство",
};

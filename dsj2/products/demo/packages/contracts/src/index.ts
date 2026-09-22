import { z } from "zod";
export { z } from "zod";
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
  "ptm-card": "ПТМ — удостоверение",
  "ptm-protocol": "ПТМ — индивидуальный протокол",
  "pb-card": "ПБ — удостоверение",
  "pb-protocol": "ПБ — индивидуальный протокол",
  "ps-card": "ПС — удостоверение",
  "ps-protocol": "ПС — индивидуальный протокол",
  "ps-witness": "ПС — свидетельство",
};

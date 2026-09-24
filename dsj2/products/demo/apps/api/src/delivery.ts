import {
  z,
  templateIds,
  validDate,
  protocolTemplateFor,
} from "@demo/contracts";
import { audit, db, fail, hash, json, parse, type Context } from "./core";

export const exportFields = [
  "sourceRow",
  "sourceOrder",
  "personnelNumber",
  "externalId",
  "fullNameRu",
  "fullNameKz",
  "positionRu",
  "positionKz",
  "workplaceRu",
  "workplaceKz",
  "departmentRu",
  "departmentKz",
  "employerBin",
  "programLabel",
  "templateLabel",
  "templateId",
  "documentNumber",
  "number",
  "registrationNumber",
  "protocolNumber",
  "documentDate",
  "protocolDate",
  "trainingStart",
  "trainingEnd",
  "validUntil",
  "trainingSubject",
  "hours",
  "result",
  "status",
] as const;
export const customerExportProfileSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    name: z.string().trim().min(1).max(100),
    customerId: z.string().max(80).nullable().optional(),
    contact: z.string().max(500).default(""),
    rowMode: z.enum(["PER_ASSIGNMENT", "PER_PERSON"]).default("PER_ASSIGNMENT"),
    sort: z
      .enum(["SOURCE_ORDER", "NAME", "PERSONNEL_NUMBER", "DEPARTMENT"])
      .default("SOURCE_ORDER"),
    dateFormat: z.enum(["YYYY-MM-DD", "DD.MM.YYYY"]).default("YYYY-MM-DD"),
    language: z.enum(["ru", "kz"]).default("ru"),
    columns: z
      .array(
        z
          .object({
            field: z.enum(exportFields),
            title: z.string().trim().min(1).max(100),
            type: z.enum(["TEXT", "DATE_ONLY"]).default("TEXT"),
            program: z.enum(templateIds).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(60),
    files: z
      .object({
        grouping: z
          .enum(["FLAT", "BY_PERSON", "BY_PROGRAM", "BY_DEPARTMENT"])
          .default("BY_PERSON"),
        nameFields: z
          .array(
            z.enum([
              "personnelNumber",
              "fullNameRu",
              "fullNameKz",
              "templateLabel",
              "documentNumber",
            ]),
          )
          .min(1)
          .max(5)
          .default([
            "personnelNumber",
            "fullNameRu",
            "templateLabel",
            "documentNumber",
          ]),
        includeRegistry: z.boolean().default(true),
        includeInventory: z.boolean().default(true),
        includeCoverText: z.boolean().default(true),
      })
      .strict()
      .default({
        grouping: "BY_PERSON",
        nameFields: [
          "personnelNumber",
          "fullNameRu",
          "templateLabel",
          "documentNumber",
        ],
        includeRegistry: true,
        includeInventory: true,
        includeCoverText: true,
      }),
  })
  .strict()
  .superRefine((profile, ctx) => {
    if (
      new Set(profile.columns.map((column) => column.title)).size !==
      profile.columns.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["columns"],
        message: "Заголовки колонок должны различаться",
      });
  });
export type CustomerExportProfile = z.infer<typeof customerExportProfileSchema>;
export type ExportRow = Record<string, unknown> & {
  assignment?: Record<string, unknown>;
};
const labels: Record<string, string> = {
  "biot-worker-card": "Удостоверение БиОТ (рабочие)",
  "biot-itr-certificate": "Сертификат БиОТ (ИТР)",
  "biot-protocol": "Протокол БиОТ (рабочие)",
  "biot-itr-protocol": "Протокол БиОТ (ИТР)",
  "ptm-card": "Удостоверение ПТМ",
  "ptm-protocol": "Протокол ПТМ",
  "pb-card": "Удостоверение ПБ",
  "pb-protocol": "Протокол ПБ",
  "ps-card": "Удостоверение ПС",
  "ps-protocol": "Протокол ПС",
  "ps-witness": "Свидетельство ПС",
};
export function flattenExportRow(source: ExportRow): Record<string, unknown> {
  const row = { ...source, ...source.assignment };
  return {
    ...row,
    documentNumber: row.number || "",
    programLabel: labels[String(row.templateId)] || row.templateId || "",
    templateLabel: labels[String(row.templateId)] || row.templateId || "",
  };
}
function sortedRows(rows: ExportRow[], profile: CustomerExportProfile) {
  return rows
    .map((row, index) => ({ row: flattenExportRow(row), index }))
    .sort((a, b) => {
      if (profile.sort === "SOURCE_ORDER")
        return (
          Number(a.row.sourceOrder ?? a.row.sourceRow ?? a.index) -
            Number(b.row.sourceOrder ?? b.row.sourceRow ?? b.index) ||
          a.index - b.index
        );
      const field =
        profile.sort === "NAME"
          ? "fullNameRu"
          : profile.sort === "DEPARTMENT"
            ? "departmentRu"
            : "personnelNumber";
      return (
        String(a.row[field] || "").localeCompare(
          String(b.row[field] || ""),
          profile.language === "kz" ? "kk" : "ru",
          { numeric: false },
        ) || a.index - b.index
      );
    })
    .map(({ row }) => row);
}
export function projectCustomerRegistry(
  rows: ExportRow[],
  profile: CustomerExportProfile,
) {
  const ordered = sortedRows(rows, profile);
  const groups = new Map<string, Record<string, unknown>[]>();
  ordered.forEach((row, index) => {
    const key =
      profile.rowMode === "PER_ASSIGNMENT"
        ? String(index)
        : JSON.stringify([row.requestId, row.id]);
    groups.set(key, [...(groups.get(key) || []), row]);
  });
  const items = [...groups.values()].map((group) =>
    Object.fromEntries(
      profile.columns.map((column, columnIndex) => {
        const selected = column.program
          ? group.filter((row) => row.templateId === column.program)
          : group;
        const values = [
          ...new Set(selected.map((row) => String(row[column.field] ?? ""))),
        ];
        if (profile.rowMode === "PER_PERSON" && values.length > 1)
          fail(
            422,
            "EXPORT_AMBIGUOUS",
            "В строке человека несколько значений документа или события. Выберите подробный вид «строка на назначение»",
            { column: column.title },
          );
        let value = values[0] || "";
        if (column.type === "DATE_ONLY" && value) {
          if (!validDate(value))
            fail(
              422,
              "EXPORT_DATE",
              "В реестре обнаружена некорректная календарная дата",
              { column: column.title },
            );
          if (profile.dateFormat === "DD.MM.YYYY")
            value = value.split("-").reverse().join(".");
        }
        return [`column${columnIndex}`, value];
      }),
    ),
  );
  return {
    items,
    columns: profile.columns.map((column, index) => ({
      field: `column${index}`,
      title: column.title,
    })),
  };
}
/** Spreadsheet injection protection is an export transformation, never a stored-name mutation. */
export function safeTsvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[\s\p{Cc}]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text))
    text = "'" + text;
  return /[\t\r\n"]/u.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
export function registryTsv(projected: {
  items: Record<string, unknown>[];
  columns: { field: string; title: string }[];
}) {
  return (
    [
      projected.columns.map((column) => safeTsvCell(column.title)).join("\t"),
      ...projected.items.map((row) =>
        projected.columns
          .map((column) => safeTsvCell(row[column.field]))
          .join("\t"),
      ),
    ].join("\r\n") + "\r\n"
  );
}
export function safeFilePart(value: unknown, maximum = 100): string {
  let name = String(value ?? "")
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\p{Cc}]/gu, " ")
    .replace(/\.\./g, " ")
    .replace(/\s+/gu, " ")
    .replace(/^[ .]+|[ .]+$/gu, "");
  if (/^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)/iu.test(name))
    name = "_" + name;
  name = [...name]
    .slice(0, maximum)
    .join("")
    .replace(/[ .]+$/gu, "");
  return name || "Документ";
}
export function deliveryFileNames(
  artifacts: {
    id: string;
    documentId: string | null;
    format: string;
    fileName: string;
  }[],
  rows: ExportRow[],
  profile: CustomerExportProfile,
) {
  const used = new Set<string>([
    "manifest.json",
    "status.txt",
    "реестр.xlsx",
    "сопроводительное письмо.txt",
    "опись.tsv",
    "тізілім.xlsx",
    "ілеспе хат.txt",
    "тізімдеме.tsv",
  ]);
  return [...artifacts]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((artifact) => {
      const ownRow = rows.find(
        (source) => source.documentId === artifact.documentId,
      );
      const groupMember = ownRow
        ? undefined
        : rows.find(
            (source) => source.protocolDocumentId === artifact.documentId,
          );
      const row = flattenExportRow(
        ownRow ||
          (groupMember
            ? {
                fullNameRu: "Групповой протокол",
                number: groupMember.protocolNumber,
                assignment: {
                  templateId: protocolTemplateFor(
                    String(groupMember.assignment?.templateId || ""),
                  ),
                },
              }
            : {}),
      );
      const parts = profile.files.nameFields
        .map((field) => row[field])
        .filter(Boolean);
      const base = safeFilePart(
        parts.join(" — ") || artifact.fileName.replace(/\.[^.]+$/, ""),
        130,
      );
      let folder = "";
      if (profile.files.grouping === "BY_PERSON" && row.fullNameRu)
        folder = safeFilePart(
          [row.personnelNumber, row.fullNameRu].filter(Boolean).join(" — "),
          65,
        );
      if (profile.files.grouping === "BY_PROGRAM")
        folder = safeFilePart(row.programLabel, 65);
      if (profile.files.grouping === "BY_DEPARTMENT")
        folder = safeFilePart(row.departmentRu || "Без подразделения", 65);
      const prefix = folder ? folder + "/" : "";
      const extension = /^[a-z0-9]{1,8}$/i.test(artifact.format)
        ? artifact.format.toLowerCase()
        : "bin";
      let fileName = prefix + base + "." + extension;
      if (used.has(fileName.toLocaleLowerCase("ru")))
        fileName =
          prefix +
          base +
          " — " +
          hash(artifact.id).slice(0, 12) +
          "." +
          extension;
      used.add(fileName.toLocaleLowerCase("ru"));
      return { ...artifact, fileName };
    });
}
export async function listExportProfiles(c: Context) {
  return {
    items: await db.customerExportProfile.findMany({
      where: { tenantId: c.tenantId },
      orderBy: { name: "asc" },
    }),
  };
}
export async function saveExportProfile(c: Context, input: unknown) {
  const profile = parse(customerExportProfileSchema, input);
  if (
    profile.customerId &&
    !(await db.customerOrganization.findFirst({
      where: { id: profile.customerId, tenantId: c.tenantId },
    }))
  )
    fail(404, "CUSTOMER_NOT_FOUND", "Заказчик не найден");
  return db.$transaction(async (tx) => {
    const result = await tx.customerExportProfile.upsert({
      where: { tenantId_name: { tenantId: c.tenantId, name: profile.name } },
      create: {
        tenantId: c.tenantId,
        customerId: profile.customerId,
        name: profile.name,
        profile: json(profile),
        createdBy: c.userId,
      },
      update: { customerId: profile.customerId, profile: json(profile) },
    });
    await audit(tx, c, "EXPORT_PROFILE_SAVED", result.id);
    return result;
  });
}
export async function resolveExportProfile(
  c: Context,
  profileId?: string,
  inline?: unknown,
): Promise<CustomerExportProfile | undefined> {
  if (profileId && inline)
    fail(400, "EXPORT_PROFILE", "Выберите один профиль реестра");
  if (inline) {
    const profile = parse(customerExportProfileSchema, inline);
    if (
      profile.customerId &&
      !(await db.customerOrganization.findFirst({
        where: { id: profile.customerId, tenantId: c.tenantId },
      }))
    )
      fail(404, "CUSTOMER_NOT_FOUND", "Заказчик не найден");
    return profile;
  }
  if (!profileId) return undefined;
  const saved = await db.customerExportProfile.findFirst({
    where: { id: profileId, tenantId: c.tenantId },
  });
  if (!saved)
    fail(404, "EXPORT_PROFILE_NOT_FOUND", "Профиль реестра не найден");
  return parse(customerExportProfileSchema, saved.profile);
}

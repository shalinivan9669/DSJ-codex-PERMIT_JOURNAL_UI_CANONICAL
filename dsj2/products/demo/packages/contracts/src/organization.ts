import { z } from "zod";

// Formatting follows the original DSJ biot-card-generator legalFormOptions:
// the RU designation is a prefix and the KZ designation is a suffix.
// Selecting a form is always explicit; a free-text name never selects one.
export const ORGANIZATION_FORMS = [
  { value: "TOO", label: "ТОО / ЖШС", ruPrefix: "ТОО", kzSuffix: "ЖШС" },
  { value: "IP", label: "ИП / ЖК", ruPrefix: "ИП", kzSuffix: "ЖК" },
  { value: "AO", label: "АО / АҚ", ruPrefix: "АО", kzSuffix: "АҚ" },
  {
    value: "NONE",
    label: "Без формы / другая — как введено",
    ruPrefix: "",
    kzSuffix: "",
  },
] as const;
export const organizationFormSchema = z.enum(["TOO", "IP", "AO", "NONE"]);
export type OrganizationForm = z.infer<typeof organizationFormSchema>;
export type OrganizationNames = {
  legalForm?: OrganizationForm | null;
  ownNameRu?: string | null;
  ownNameKz?: string | null;
  nameRu: string;
  nameKz: string;
};

const formToken = "ТОО|ЖШС|ИП|ЖК|АО|АҚ";
const prefixPattern = new RegExp(`^(${formToken})\\s+`, "iu");
const suffixPattern = new RegExp(`\\s+(${formToken})$`, "iu");
const tokenOnlyPattern = new RegExp(`^(${formToken})$`, "iu");
const combinedPattern = new RegExp(
  `^(?:${formToken})\\s*[-/–—]\\s*(?:${formToken})(?=\\s|$)|(?:^|\\s)(?:${formToken})\\s*[-/–—]\\s*(?:${formToken})$`,
  "iu",
);

/** Only remove a separate edge designation matching an explicitly chosen form. */
export function organizationOwnName(
  value: string,
  legalForm: OrganizationForm,
) {
  const original = value.trim();
  const form = ORGANIZATION_FORMS.find((option) => option.value === legalForm)!;
  if (legalForm === "NONE" || !original)
    return { value: original, changed: false, issue: "" };
  const prefix = original.match(prefixPattern);
  const suffix = original.match(suffixPattern);
  const allowed = [form.ruPrefix, form.kzSuffix] as string[];
  if (
    combinedPattern.test(original) ||
    [prefix?.[1], suffix?.[1]].some(
      (token) => token && !allowed.includes(token.toLocaleUpperCase("ru")),
    )
  )
    return {
      value: original,
      changed: false,
      issue:
        "В названии есть другая или неоднозначная форма. Уточните собственное наименование либо сохраните строку без преобразования.",
    };
  const stripped = original
    .replace(prefixPattern, "")
    .replace(suffixPattern, "")
    .trim();
  if (
    !stripped ||
    tokenOnlyPattern.test(stripped) ||
    prefixPattern.test(stripped) ||
    suffixPattern.test(stripped)
  )
    return {
      value: original,
      changed: false,
      issue:
        "Проверьте собственное наименование: повторяющиеся обозначения формы не удаляются автоматически.",
    };
  return { value: stripped, changed: stripped !== original, issue: "" };
}

export function formatOrganizationNames(
  legalForm: OrganizationForm,
  ownNameRu: string,
  ownNameKz = "",
) {
  const form = ORGANIZATION_FORMS.find((option) => option.value === legalForm)!;
  const ru = organizationOwnName(ownNameRu, legalForm);
  const kz = organizationOwnName(ownNameKz, legalForm);
  const kzName = kz.value || ru.value;
  const issue = ru.issue || kz.issue;
  return {
    legalForm,
    ownNameRu: ru.value,
    // An empty optional KZ own name means "use the same proper name".
    ownNameKz: kz.value,
    nameRu: issue
      ? ownNameRu
      : ru.value
        ? [form.ruPrefix, ru.value].filter(Boolean).join(" ")
        : "",
    nameKz: issue
      ? ownNameKz
      : kzName
        ? [kzName, form.kzSuffix].filter(Boolean).join(" ")
        : "",
    issue,
    normalized: ru.changed || kz.changed,
  };
}

const organizationText = z
  .string()
  .max(500, "Максимум 500 символов")
  .default("");
export const customerSchema = z
  .object({
    nameRu: organizationText,
    nameKz: organizationText,
    legalForm: organizationFormSchema.nullable().optional(),
    ownNameRu: z.string().max(500).nullable().optional(),
    ownNameKz: z.string().max(500).nullable().optional(),
    bin: z.string().max(50).default(""),
    addressRu: organizationText,
    addressKz: organizationText,
    archived: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.legalForm) {
      if (!value.nameRu.trim())
        ctx.addIssue({
          code: "custom",
          path: ["nameRu"],
          message: "Введите название на русском",
        });
      if (value.ownNameRu || value.ownNameKz)
        ctx.addIssue({
          code: "custom",
          path: ["legalForm"],
          message: "Выберите форму организации или вариант без формы",
        });
      return;
    }
    if (!value.ownNameRu?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["ownNameRu"],
        message: "Введите собственное наименование",
      });
      return;
    }
    const names = formatOrganizationNames(
      value.legalForm,
      value.ownNameRu,
      value.ownNameKz || "",
    );
    if (names.issue)
      ctx.addIssue({
        code: "custom",
        path: ["ownNameRu"],
        message: names.issue,
      });
    if (names.nameRu.length > 500 || names.nameKz.length > 500)
      ctx.addIssue({
        code: "custom",
        path: ["ownNameRu"],
        message: "Полное название с формой не должно превышать 500 символов",
      });
  })
  .transform((value) => {
    if (!value.legalForm) return value;
    const {
      issue: _issue,
      normalized: _normalized,
      ...names
    } = formatOrganizationNames(
      value.legalForm,
      value.ownNameRu || "",
      value.ownNameKz || "",
    );
    return { ...value, ...names };
  });

import {
  BIOT_CATEGORIES,
  biotValidUntil,
  commonFieldKeys,
  hasProtectedValidity,
  isProtectedField,
  trainingDirection,
  trainingHoursPrograms,
  withCourseProgram,
  type Assignment,
  type BiotCategory,
  type CalculatedDateKey,
  type CommonFields,
} from "@demo/contracts";

function canRefreshHours(
  value: string | undefined,
  origin: string | undefined,
  previousHours: number | undefined,
): boolean {
  return (
    !isProtectedField(origin) &&
    (!value?.trim() ||
      (!!origin &&
        previousHours !== undefined &&
        value === String(previousHours)))
  );
}

/** An explicit course selection refreshes only unprotected preset hours. */
export function updateCommonBiotCategory(
  fields: CommonFields,
  category: BiotCategory,
): CommonFields {
  const previous = fields.biotCategory
    ? BIOT_CATEGORIES[fields.biotCategory]
    : undefined;
  const preset = BIOT_CATEGORIES[category];
  const next: CommonFields = {
    ...fields,
    biotCategory: category,
    fieldOrigins: { ...fields.fieldOrigins, biotCategory: "MANUAL" },
  };
  for (const [key, previousValue, nextValue] of [
    ["hours", previous?.defaultHours, preset.defaultHours],
    [
      "productionHours",
      previous?.defaultProductionHours,
      preset.defaultProductionHours,
    ],
  ] as const) {
    if (
      canRefreshHours(fields[key], fields.fieldOrigins?.[key], previousValue)
    ) {
      next[key] = nextValue ? String(nextValue) : "";
      next.fieldOrigins![key] = "AUTO";
    }
  }
  return next;
}

export function restoreAssignmentDate(
  assignment: Assignment,
  key: CalculatedDateKey,
): Assignment {
  return {
    ...assignment,
    [key]: "",
    fieldOrigins: {
      ...assignment.fieldOrigins,
      [key]: assignment.protocolMode === "GROUP" ? "INHERITED" : "AUTO",
    },
    biotManualFields: assignment.biotManualFields?.filter(
      (field) => field !== key,
    ),
  };
}

export function biotCategoriesForTemplate(
  templateId: Assignment["templateId"],
): BiotCategory[] {
  if (!templateId.startsWith("biot-")) return [];
  return (Object.keys(BIOT_CATEGORIES) as BiotCategory[]).filter(
    (category) =>
      BIOT_CATEGORIES[category].form ===
      (["biot-worker-card", "biot-protocol"].includes(templateId)
        ? "WORKER"
        : "ITR"),
  );
}

export function defaultBiotCategory(
  templateId: Assignment["templateId"],
): BiotCategory | undefined {
  if (
    templateId === "biot-itr-certificate" ||
    templateId === "biot-itr-protocol"
  )
    return "ITR_STANDARD";
  if (templateId === "biot-worker-card" || templateId === "biot-protocol")
    return "WORKER";
  return undefined;
}

export function biotAssignmentDefaults(
  templateId: Assignment["templateId"],
): Partial<Assignment> {
  const category = defaultBiotCategory(templateId);
  const preset = category ? BIOT_CATEGORIES[category] : undefined;
  return preset
    ? {
        biotCategory: category,
        ...(category === "WORKER" || templateId === "biot-itr-protocol"
          ? { biotCheckType: "PERIODIC" as const }
          : {}),
        hours: String(preset.defaultHours),
        fieldOrigins: {
          biotCategory: "AUTO",
          hours: "AUTO",
          ...(preset.defaultProductionHours
            ? { productionHours: "AUTO" as const }
            : {}),
        },
        ...(preset.defaultProductionHours
          ? { productionHours: String(preset.defaultProductionHours) }
          : {}),
      }
    : {};
}

/** Use the same category and origins in the event editor and quick course selection. */
export function eventCourseDefaults(
  templateId: Assignment["templateId"],
): CommonFields {
  const defaults = biotAssignmentDefaults(templateId);
  if (!defaults.biotCategory) return {};
  return {
    biotCategory: defaults.biotCategory,
    biotCheckType: "PERIODIC",
    hours: defaults.hours,
    ...(defaults.productionHours
      ? { productionHours: defaults.productionHours }
      : {}),
    fieldOrigins: defaults.fieldOrigins,
  };
}

/** Refresh empty or sourced preset fields and retain saved operator input. */
export function updateAssignment(
  assignment: Assignment,
  patch: Partial<Assignment>,
): Assignment {
  const next = { ...assignment, ...patch };
  if (Object.hasOwn(patch, "outcome"))
    next.fieldOrigins = { ...next.fieldOrigins, outcome: "MANUAL" };
  for (const field of [
    ...commonFieldKeys,
    "result",
    "resultKz",
    "resultEn",
    "professionRu",
    "professionKz",
    "psQualificationRu",
    "psQualificationKz",
  ] as const) {
    if (Object.hasOwn(patch, field))
      next.fieldOrigins = {
        ...next.fieldOrigins,
        [field]:
          patch[field] === "" || (field === "hoursProgram" && !patch[field])
            ? "CLEARED"
            : "MANUAL",
      };
  }
  const manuallyEdited = new Set(next.biotManualFields || []);
  for (const field of ["hours", "productionHours", "validUntil"] as const) {
    if (Object.hasOwn(patch, field)) manuallyEdited.add(field);
  }
  if (manuallyEdited.size) next.biotManualFields = [...manuallyEdited];
  if (patch.templateId && patch.templateId !== assignment.templateId) {
    const directionChanged =
      trainingDirection(assignment.templateId) !==
      trainingDirection(patch.templateId);
    if (directionChanged && !assignment.templateId.startsWith("biot-")) {
      for (const key of ["hours", "productionHours"] as const) {
        if (
          !manuallyEdited.has(key) &&
          ["AUTO", "COURSE", "INHERITED"].includes(
            assignment.fieldOrigins?.[key] || "",
          )
        ) {
          next[key] = "";
        }
      }
    }
    if (
      next.hoursProgram &&
      !trainingHoursPrograms(patch.templateId).some(
        (program) => program.id === next.hoursProgram,
      )
    ) {
      delete next.hoursProgram;
      next.fieldOrigins = { ...next.fieldOrigins };
      delete next.fieldOrigins.hoursProgram;
    }
    const allowed = biotCategoriesForTemplate(patch.templateId);
    next.biotCategory =
      assignment.biotCategory && allowed.includes(assignment.biotCategory)
        ? assignment.biotCategory
        : defaultBiotCategory(patch.templateId);
    if (patch.templateId.endsWith("-protocol"))
      next.protocolMode = "INDIVIDUAL";
  }
  const previousPreset = assignment.biotCategory
    ? BIOT_CATEGORIES[assignment.biotCategory]
    : undefined;
  const preset = next.biotCategory
    ? BIOT_CATEGORIES[next.biotCategory]
    : undefined;
  const categoryChanged = next.biotCategory !== assignment.biotCategory;
  if (categoryChanged && next.biotCategory === "WORKER" && !next.biotCheckType)
    next.biotCheckType = "PERIODIC";
  if (patch.templateId === "biot-itr-protocol" && !next.biotCheckType)
    next.biotCheckType = "PERIODIC";
  if (
    categoryChanged &&
    !Object.hasOwn(patch, "hours") &&
    !manuallyEdited.has("hours") &&
    canRefreshHours(
      assignment.hours,
      assignment.fieldOrigins?.hours,
      previousPreset?.defaultHours,
    )
  ) {
    next.hours = preset ? String(preset.defaultHours) : "";
    next.fieldOrigins = { ...next.fieldOrigins, hours: "AUTO" };
  }
  if (
    categoryChanged &&
    !Object.hasOwn(patch, "productionHours") &&
    !manuallyEdited.has("productionHours") &&
    canRefreshHours(
      assignment.productionHours,
      assignment.fieldOrigins?.productionHours,
      previousPreset?.defaultProductionHours,
    )
  ) {
    next.productionHours = preset?.defaultProductionHours
      ? String(preset.defaultProductionHours)
      : "";
    next.fieldOrigins = { ...next.fieldOrigins, productionHours: "AUTO" };
  }
  if (
    (categoryChanged || Object.hasOwn(patch, "documentDate")) &&
    !Object.hasOwn(patch, "validUntil") &&
    !hasProtectedValidity(assignment)
  ) {
    const previousUntil = assignment.biotCategory
      ? biotValidUntil(assignment.documentDate, assignment.biotCategory)
      : null;
    if (
      !assignment.validUntil ||
      (previousUntil && assignment.validUntil === previousUntil)
    ) {
      next.validUntil = next.biotCategory
        ? biotValidUntil(next.documentDate, next.biotCategory) || ""
        : "";
      next.fieldOrigins = { ...next.fieldOrigins, validUntil: "AUTO" };
    }
  }
  if (!next.biotCategory) delete next.biotCategory;
  return withCourseProgram(next);
}

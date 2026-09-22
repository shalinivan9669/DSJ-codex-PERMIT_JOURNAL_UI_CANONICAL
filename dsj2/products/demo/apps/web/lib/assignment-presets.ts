import {
  BIOT_CATEGORIES,
  biotValidUntil,
  type Assignment,
  type BiotCategory,
} from "@demo/contracts";

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
    return "OHS_SPECIALIST_SPECIAL";
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
        ...(preset.defaultProductionHours
          ? { productionHours: String(preset.defaultProductionHours) }
          : {}),
      }
    : {};
}

/** Change only empty or recognisable previous preset values, never other input. */
export function updateAssignment(
  assignment: Assignment,
  patch: Partial<Assignment>,
  manuallyEdited: {
    hours?: boolean;
    productionHours?: boolean;
    validUntil?: boolean;
  } = {},
): Assignment {
  const next = { ...assignment, ...patch };
  if (patch.templateId && patch.templateId !== assignment.templateId) {
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
    !manuallyEdited.hours &&
    (!assignment.hours ||
      (previousPreset &&
        assignment.hours === String(previousPreset.defaultHours)))
  ) {
    next.hours = preset ? String(preset.defaultHours) : "";
  }
  if (
    categoryChanged &&
    !Object.hasOwn(patch, "productionHours") &&
    !manuallyEdited.productionHours &&
    (!assignment.productionHours ||
      (previousPreset?.defaultProductionHours &&
        assignment.productionHours ===
          String(previousPreset.defaultProductionHours)))
  ) {
    next.productionHours = preset?.defaultProductionHours
      ? String(preset.defaultProductionHours)
      : "";
  }
  if (
    (categoryChanged || Object.hasOwn(patch, "documentDate")) &&
    !Object.hasOwn(patch, "validUntil") &&
    !manuallyEdited.validUntil
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
    }
  }
  if (!next.biotCategory) delete next.biotCategory;
  return next;
}

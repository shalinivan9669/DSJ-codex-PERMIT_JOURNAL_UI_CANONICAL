import { BIOT_CATEGORIES } from "./biot";
import { courseProgramKeys, withCourseProgram } from "./course-defaults";
import type {
  Assignment,
  Draft,
  IssuerProfile,
  RequestItemInput,
  ValidationIssue,
  TrainingEventInput,
} from "./index";

/** Agreed centre policy. This version is not a statement of regulatory approval. */
export const BUSINESS_RULE_VERSION = "LIVE_V1" as const;
export type EmployeeCategory = "WORKER" | "ITR";
export type TrainingDirection = "BIOT" | "PTM" | "PB" | "PS";
export const trainingDirections = ["BIOT", "PTM", "PB", "PS"] as const;

export function trainingDirection(template: string): TrainingDirection {
  return template.split("-")[0].toUpperCase() as TrainingDirection;
}

export function employeeCategoryFor(
  item: Pick<RequestItemInput, "employeeCategory" | "assignments">,
): EmployeeCategory {
  return (
    item.employeeCategory ||
    (item.assignments.some(
      (assignment) =>
        assignment.templateId.startsWith("biot-itr") ||
        (assignment.biotCategory &&
          BIOT_CATEGORIES[assignment.biotCategory].form === "ITR"),
    )
      ? "ITR"
      : "WORKER")
  );
}

export function mandatoryTemplates(
  direction: TrainingDirection,
  category: EmployeeCategory,
): Assignment["templateId"][] {
  if (direction === "BIOT")
    return category === "ITR"
      ? ["biot-itr-certificate", "biot-itr-protocol"]
      : ["biot-worker-card", "biot-protocol"];
  if (direction === "PS") return ["ps-card", "ps-witness", "ps-protocol"];
  return direction === "PB"
    ? ["pb-card", "pb-protocol"]
    : ["ptm-card", "ptm-protocol"];
}

export function businessValidUntil(
  documentDate: string,
  category: EmployeeCategory,
): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(documentDate)) return "";
  const date = new Date(`${documentDate}T12:00:00Z`);
  if (isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== documentDate)
    return "";
  const year = date.getUTCFullYear() + (category === "ITR" ? 3 : 1);
  if (year > 9999) return "";
  const month = date.getUTCMonth();
  const last = new Date(date);
  last.setUTCFullYear(year, month + 1, 0);
  return `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(Math.min(date.getUTCDate(), last.getUTCDate())).padStart(2, "0")}`;
}

function cloneForTemplate(
  source: Assignment,
  templateId: Assignment["templateId"],
): Assignment {
  return {
    ...structuredClone(source),
    id: `${source.id.slice(0, 54)}-${templateId}`,
    templateId,
  };
}
/** Category lineage is by identity, never by a user-visible group title. */
export function trainingEventContext(event: TrainingEventInput): string {
  const ordered = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(ordered)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, child]) => [key, ordered(child)]),
          )
        : value;
  return JSON.stringify(
    ordered({
      commonFields: event.commonFields,
      profileVersionId: event.profileVersionId,
      serviceRuleVersionId: event.serviceRuleVersionId,
    }),
  );
}
function rootForEvent(events: TrainingEventInput[], event: TrainingEventInput) {
  if (event.rootEventId)
    return events.find((entry) => entry.id === event.rootEventId) || event;
  // Support drafts produced by the old deterministic category suffix without
  // guessing from names or merging independent events with the same title.
  const originalId = event.id.replace(/(?:-(?:ITR|WORKER))+$/, "");
  return events.find((entry) => entry.id === originalId) || event;
}

/** Apply only to editable/proposed drafts. Never invoke on issued snapshots. */
export function applyBusinessRules<T extends Draft>(input: T): T & Draft {
  const draft = structuredClone(input);
  draft.businessRuleVersion = BUSINESS_RULE_VERSION;
  draft.englishAppendix ??= false;
  draft.events ||= [];
  for (const item of draft.items) {
    const category = employeeCategoryFor(item);
    item.employeeCategory = category;
    const training = new Map<string, Assignment[]>();
    for (const assignment of item.assignments) {
      const direction = trainingDirection(assignment.templateId);
      const key = assignment.eventId || direction;
      const entries = training.get(key) || [];
      entries.push(assignment);
      training.set(key, entries);
    }
    const normalized: Assignment[] = [];
    for (const entries of training.values()) {
      const original =
        entries.find(
          (a) =>
            !a.templateId.endsWith("-protocol") &&
            a.templateId !== "ps-witness",
        ) || entries[0];
      const direction = trainingDirection(original.templateId);
      const templates = mandatoryTemplates(direction, category);
      const protocolTemplate = templates[templates.length - 1];
      let event = draft.events.find(
        (candidate) => candidate.id === original.eventId,
      );
      if (event && event.protocolTemplateId !== protocolTemplate) {
        const previous = event;
        const root = rootForEvent(draft.events, previous);
        const rootCompatible = root.protocolTemplateId === protocolTemplate;
        const confirmed =
          (original.outcome?.status && original.outcome.status !== "UNKNOWN") ||
          !!original.result.trim();
        const conflict =
          rootCompatible &&
          previous.rootEventId &&
          previous.lineageContext !== trainingEventContext(root) &&
          confirmed;
        if (conflict) {
          // Keep the full old fact in its former context until the operator
          // resolves the incompatible category; changing the select is not a
          // new confirmation of a different program or group.
          normalized.push(...entries);
          continue;
        }
        const id = `${root.id.slice(0, 64)}-${category}`;
        event = rootCompatible
          ? root
          : draft.events.find(
              (candidate) =>
                candidate.id === id &&
                (!candidate.rootEventId || candidate.rootEventId === root.id),
            );
        if (!event) {
          event = {
            ...structuredClone(root),
            id,
            title: `${root.title.replace(/(?: — (?:ИТР|Рабочие))+$/, "")} — ${category === "ITR" ? "ИТР" : "Рабочие"}`,
            rootEventId: root.id,
            derivedCategory: category,
            lineageContext: trainingEventContext(root),
            protocolTemplateId:
              protocolTemplate as typeof previous.protocolTemplateId,
          };
          draft.events.push(event);
        }
        if (
          direction === "BIOT" &&
          (!event.commonFields.biotCategory ||
            BIOT_CATEGORIES[event.commonFields.biotCategory].form !== category)
        ) {
          const previousPreset = event.commonFields.biotCategory
            ? BIOT_CATEGORIES[event.commonFields.biotCategory]
            : undefined;
          event.commonFields.biotCategory =
            category === "ITR" ? "OHS_SPECIALIST_SPECIAL" : "WORKER";
          const preset = BIOT_CATEGORIES[event.commonFields.biotCategory];
          if (
            !event.commonFields.hours ||
            event.commonFields.hours === String(previousPreset?.defaultHours)
          )
            event.commonFields.hours = String(preset.defaultHours);
          if (
            !event.commonFields.productionHours ||
            event.commonFields.productionHours ===
              String(previousPreset?.defaultProductionHours)
          )
            event.commonFields.productionHours = preset.defaultProductionHours
              ? String(preset.defaultProductionHours)
              : "";
        }
        if (event.rootEventId && !event.lineageOwnContext)
          event.lineageOwnContext = trainingEventContext(event);
      }
      const mode =
        event?.protocolMode ||
        (original.protocolMode === "GROUP" ? "GROUP" : "INDIVIDUAL");
      const primary = withCourseProgram({
        ...original,
        id:
          original.templateId !== templates[0] &&
          templates.includes(original.templateId)
            ? `${original.id.slice(0, 54)}-${templates[0]}`
            : original.id,
        templateId: templates[0],
        eventId: event?.id || original.eventId,
        protocolMode: mode,
      });
      if (
        direction === "BIOT" &&
        (!primary.biotCategory ||
          BIOT_CATEGORIES[primary.biotCategory].form !== category)
      ) {
        const previousPreset = primary.biotCategory
          ? BIOT_CATEGORIES[primary.biotCategory]
          : undefined;
        primary.biotCategory =
          category === "ITR" ? "OHS_SPECIALIST_SPECIAL" : "WORKER";
        const preset = BIOT_CATEGORIES[primary.biotCategory];
        if (
          !primary.biotManualFields?.includes("hours") &&
          (!primary.hours ||
            primary.hours === String(previousPreset?.defaultHours))
        )
          primary.hours = String(preset.defaultHours);
        if (
          !primary.biotManualFields?.includes("productionHours") &&
          (!primary.productionHours ||
            primary.productionHours ===
              String(previousPreset?.defaultProductionHours))
        )
          primary.productionHours = preset.defaultProductionHours
            ? String(preset.defaultProductionHours)
            : "";
        primary.biotCheckType = "PERIODIC";
      }
      for (const templateId of templates) {
        const isProtocol = templateId.endsWith("-protocol");
        if (isProtocol && mode === "GROUP") continue;
        const old =
          entries.find((a) => a.templateId === templateId) ||
          (isProtocol
            ? entries.find((a) => a.templateId.endsWith("-protocol"))
            : undefined);
        const assignment: Assignment =
          templateId === primary.templateId
            ? primary
            : old
              ? { ...old, templateId }
              : cloneForTemplate(primary, templateId);
        if (templateId !== primary.templateId) {
          for (const key of [
            ...courseProgramKeys,
            "professionRu",
            "professionKz",
            "psQualificationRu",
            "psQualificationKz",
            "trainingSubjectEn",
            "trainingStart",
            "trainingEnd",
            "result",
            "resultKz",
            "resultEn",
            "outcome",
          ] as const) {
            (assignment as unknown as Record<string, unknown>)[key] =
              primary[key];
          }
          assignment.fieldOrigins = {
            ...assignment.fieldOrigins,
            ...Object.fromEntries(
              ["result", "resultKz", "resultEn"].map((key) => [
                key,
                primary.fieldOrigins?.[key] ||
                  (primary[key as "result" | "resultKz" | "resultEn"]
                    ? "MANUAL"
                    : "COURSE"),
              ]),
            ),
            ...Object.fromEntries(
              courseProgramKeys.map((key) => [
                key,
                primary.fieldOrigins?.[key] ||
                  (primary[key] ? "MANUAL" : "INHERITED"),
              ]),
            ),
            trainingSubject:
              primary.fieldOrigins?.trainingSubject ||
              (primary.trainingSubject ? "MANUAL" : "INHERITED"),
            trainingSubjectEn:
              primary.fieldOrigins?.trainingSubjectEn ||
              (primary.trainingSubjectEn ? "MANUAL" : "INHERITED"),
            trainingStart:
              primary.fieldOrigins?.trainingStart ||
              (primary.trainingStart ? "MANUAL" : "INHERITED"),
            trainingEnd:
              primary.fieldOrigins?.trainingEnd ||
              (primary.trainingEnd ? "MANUAL" : "INHERITED"),
          };
        }
        assignment.eventId = primary.eventId;
        assignment.protocolMode = isProtocol ? "INDIVIDUAL" : mode;
        // Every personal form in one training kit uses the same issue date.
        if (!isProtocol) {
          assignment.documentDate = primary.documentDate;
          assignment.fieldOrigins = {
            ...assignment.fieldOrigins,
            documentDate:
              primary.fieldOrigins?.documentDate ||
              (primary.documentDate ? "MANUAL" : "INHERITED"),
          };
        } else {
          const dateOrigin = primary.fieldOrigins?.protocolDate;
          const explicitProtocolDate =
            dateOrigin === "MANUAL" ||
            dateOrigin === "IMPORTED" ||
            dateOrigin === "CLEARED" ||
            (!dateOrigin && !!primary.protocolDate);
          assignment.documentDate = explicitProtocolDate
            ? primary.protocolDate
            : event?.commonFields.protocolDate ||
              draft.commonFields?.protocolDate ||
              draft.presetFields?.protocolDate ||
              primary.protocolDate ||
              primary.documentDate;
          assignment.protocolDate = assignment.documentDate;
          const protocolDateOrigin = explicitProtocolDate
            ? dateOrigin || "MANUAL"
            : dateOrigin === "AUTO"
              ? "AUTO"
              : "INHERITED";
          assignment.fieldOrigins = {
            ...assignment.fieldOrigins,
            documentDate: protocolDateOrigin,
            protocolDate: protocolDateOrigin,
          };
        }
        if (direction === "BIOT") {
          assignment.biotCategory = primary.biotCategory;
          assignment.hours = primary.hours;
          assignment.productionHours = primary.productionHours;
          assignment.biotCheckType = primary.biotCheckType || "PERIODIC";
          assignment.fieldOrigins = {
            ...assignment.fieldOrigins,
            biotCheckType:
              primary.fieldOrigins?.biotCheckType ||
              (primary.biotCheckType ? "MANUAL" : "INHERITED"),
          };
        }
        assignment.validityMode = direction === "PS" ? "UNLIMITED" : "FIXED";
        assignment.validUntil =
          direction === "PS"
            ? ""
            : businessValidUntil(assignment.documentDate, category);
        assignment.fieldOrigins = {
          ...assignment.fieldOrigins,
          validUntil: "AUTO",
        };
        normalized.push(assignment);
      }
    }
    item.assignments = normalized;
  }
  // Only automatically derived, untouched empty containers are disposable.
  // Independently created events and edited derived facts remain available.
  draft.events = draft.events.filter(
    (event) =>
      !event.rootEventId ||
      draft.items.some((item) =>
        item.assignments.some((assignment) => assignment.eventId === event.id),
      ) ||
      (!!event.lineageOwnContext &&
        event.lineageOwnContext !== trainingEventContext(event)),
  );
  let modeChanged = false;
  for (const event of draft.events) {
    if (event.protocolModeSource !== "AUTO") continue;
    const count = draft.items.filter((item) =>
      item.assignments.some(
        (assignment) =>
          assignment.eventId === event.id &&
          !assignment.templateId.endsWith("-protocol"),
      ),
    ).length;
    const mode = count >= 2 ? "GROUP" : "INDIVIDUAL";
    if (event.protocolMode !== mode) {
      event.protocolMode = mode;
      modeChanged = true;
    }
  }
  if (modeChanged) return applyBusinessRules(draft);
  return draft;
}

export function validateBusinessRules(
  draft: Draft,
  profile?: IssuerProfile | null,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (code: string, path: string, message: string, rowId?: string) =>
    issues.push({ code, path, message, rowId });
  if (draft.businessRuleVersion !== BUSINESS_RULE_VERSION) return issues;
  for (const [row, item] of draft.items.entries()) {
    const itemPath = `items.${row}`;
    if (!item.employeeCategory)
      add(
        "EMPLOYEE_CATEGORY_REQUIRED",
        `${itemPath}.employeeCategory`,
        "Выберите категорию сотрудника: рабочий или ИТР",
        item.id,
      );
    for (const [column, assignment] of item.assignments.entries()) {
      const path = `${itemPath}.assignments.${column}`;
      const direction = trainingDirection(assignment.templateId);
      const event = draft.events?.find(
        (entry) => entry.id === assignment.eventId,
      );
      const root = event?.rootEventId
        ? draft.events?.find((entry) => entry.id === event.rootEventId)
        : undefined;
      if (
        event &&
        root &&
        root.protocolTemplateId ===
          mandatoryTemplates(direction, employeeCategoryFor(item)).at(-1) &&
        event.protocolTemplateId !== root.protocolTemplateId &&
        event.lineageContext !== trainingEventContext(root) &&
        ((assignment.outcome?.status &&
          assignment.outcome.status !== "UNKNOWN") ||
          assignment.result.trim())
      )
        issues.push({
          code: "CATEGORY_LINEAGE_CONFLICT",
          path: `${itemPath}.employeeCategory`,
          rowId: item.id,
          recipientId: item.id,
          eventId: event.id,
          assignmentId: assignment.id,
          field: "employeeCategory",
          message:
            "Исходная группа изменилась, пока человек был в другой категории. Подтверждённый факт сохранён в прежнем событии; выберите совместимую группу и проверьте результат по источнику.",
        });
      const templates = mandatoryTemplates(
        direction,
        employeeCategoryFor(item),
      );
      const sameTraining = item.assignments.filter((a) =>
        assignment.eventId
          ? a.eventId === assignment.eventId
          : !a.eventId && trainingDirection(a.templateId) === direction,
      );
      if (!templates.includes(assignment.templateId))
        add(
          "EMPLOYEE_TEMPLATE_MISMATCH",
          `${path}.templateId`,
          "Форма не соответствует категории сотрудника",
          item.id,
        );
      for (const template of templates) {
        const suppliedByEvent =
          template.endsWith("-protocol") &&
          assignment.protocolMode === "GROUP" &&
          draft.events?.some(
            (event) =>
              event.id === assignment.eventId &&
              event.protocolTemplateId === template,
          );
        if (
          !suppliedByEvent &&
          !sameTraining.some((a) => a.templateId === template)
        )
          add(
            "MANDATORY_DOCUMENT_MISSING",
            path,
            "В комплекте обучения отсутствует обязательный документ или протокол",
            item.id,
          );
        if (
          suppliedByEvent &&
          sameTraining.some((a) => a.templateId === template)
        )
          add(
            "DUPLICATE_GROUP_PROTOCOL",
            path,
            "Общий протокол уже включён в событие: отдельная копия не требуется",
            item.id,
          );
        if (sameTraining.filter((a) => a.templateId === template).length > 1)
          add(
            "DUPLICATE_TRAINING_DOCUMENT",
            path,
            "Документ этого обучения назначен дважды",
            item.id,
          );
      }
      if (assignment.protocolMode === "EXTERNAL_REFERENCE")
        add(
          "MANDATORY_PROTOCOL_REQUIRED",
          `${path}.protocolMode`,
          "В комплект этой заявки должен входить собственный протокол",
          item.id,
        );
      const expected =
        direction === "PS"
          ? ""
          : businessValidUntil(
              assignment.documentDate,
              employeeCategoryFor(item),
            );
      if (
        assignment.validityMode !==
          (direction === "PS" ? "UNLIMITED" : "FIXED") ||
        assignment.validUntil !== expected
      )
        add(
          "BUSINESS_VALIDITY_MISMATCH",
          `${path}.validUntil`,
          direction === "PS"
            ? "ПС выдаётся бессрочно, дата окончания не указывается"
            : "Срок рассчитывается от даты выдачи: рабочий — один год, ИТР — три года",
          item.id,
        );
      if (draft.englishAppendix && !assignment.trainingSubjectEn?.trim())
        add(
          "ENGLISH_REQUIRED",
          `${path}.trainingSubjectEn`,
          "Проверьте и заполните программу обучения на английском",
          item.id,
        );
      if (draft.englishAppendix) {
        if (
          !assignment.resultEn?.trim() &&
          (!assignment.outcome || assignment.outcome.status === "UNKNOWN")
        )
          add(
            "ENGLISH_REQUIRED",
            `${path}.resultEn`,
            "Заполните результат на английском или подтвердите стандартный исход обучения",
            item.id,
          );
        for (const key of [
          "reason",
          "education",
          "biotKnowledgeResult",
          "biotProctoringResult",
          "biotNotes",
        ] as const)
          if (assignment[key]?.trim() && !assignment[`${key}En`]?.trim())
            add(
              "ENGLISH_REQUIRED",
              `${path}.${key}En`,
              "Заполните английский перевод заполненного поля документа",
              item.id,
            );
        if (
          (assignment.biotIndustryRu?.trim() ||
            assignment.biotIndustryKz?.trim()) &&
          !assignment.biotIndustryEn?.trim()
        )
          add(
            "ENGLISH_REQUIRED",
            `${path}.biotIndustryEn`,
            "Заполните отрасль специальных компетенций на английском",
            item.id,
          );
      }
    }
    if (draft.englishAppendix)
      for (const key of ["fullNameEn", "positionEn", "workplaceEn"] as const)
        if (!item[key]?.trim())
          add(
            "ENGLISH_REQUIRED",
            `${itemPath}.${key}`,
            "Для английской страницы заполните проверенные ФИО, должность и организацию на английском",
            item.id,
          );
    if (draft.englishAppendix)
      for (const key of ["department", "employerAddress"] as const)
        if (
          (item[`${key}Ru`]?.trim() || item[`${key}Kz`]?.trim()) &&
          !item[`${key}En`]?.trim()
        )
          add(
            "ENGLISH_REQUIRED",
            `${itemPath}.${key}En`,
            "Заполните английский перевод подразделения и адреса работодателя",
            item.id,
          );
  }
  if (draft.englishAppendix && profile) {
    for (const key of [
      "nameEn",
      "cityEn",
      ...(profile.addressRu || profile.addressKz ? ["addressEn" as const] : []),
      ...(profile.headName?.trim() ? ["headNameEn" as const] : []),
      ...(profile.approvalBasis?.trim() ? ["approvalBasisEn" as const] : []),
    ] as const)
      if (!profile[key]?.trim())
        add(
          "ENGLISH_ISSUER_REQUIRED",
          `profile.${key}`,
          "Заполните английские реквизиты учебного центра",
          undefined,
        );
    for (const [index, member] of profile.commission.entries())
      for (const key of ["name", "position"] as const)
        if (member[key].trim() && !member[`${key}En`]?.trim())
          add(
            "ENGLISH_ISSUER_REQUIRED",
            `profile.commission.${index}.${key}En`,
            "Заполните проверенные ФИО и должность члена комиссии на английском",
          );
  }
  return issues;
}

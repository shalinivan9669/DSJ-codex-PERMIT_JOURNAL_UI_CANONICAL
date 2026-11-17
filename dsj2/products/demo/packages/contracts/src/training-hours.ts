import { BIOT_CATEGORIES, type BiotCategory } from "./biot";

const industrialSafetyRules = "https://adilet.zan.kz/rus/docs/V2100023461";
const fireSafetyRules = "https://adilet.zan.kz/rus/docs/V1400009510";
const occupationTrainingLaw = "https://adilet.zan.kz/rus/docs/Z070000319_";
const occupationalSafetyRules = "https://adilet.zan.kz/rus/docs/V1500012665";
const previousOccupationalSafetyRules =
  "https://old.adilet.zan.kz/rus/archive/docs/V1500012665/30.05.2026";

const previousWorkerPrograms = [
  {
    id: "BIOT_PREVIOUS_WORKER",
    label: "Программа работодателя · ред. 30.05.2026",
  },
] as const;

// Clauses 26–27 apply to responsible staff. Business size is a deliberate
// choice: neither the recipient's job title nor the centre classifies it.
const previousResponsiblePrograms = [
  {
    id: "BIOT_PREVIOUS_GENERAL_SMALL",
    label: "Общие компетенции · малый и микробизнес · ред. 30.05.2026",
    hours: 24,
    clause: 26,
  },
  {
    id: "BIOT_PREVIOUS_GENERAL_MEDIUM",
    label: "Общие компетенции · средний бизнес · ред. 30.05.2026",
    hours: 40,
    clause: 26,
  },
  {
    id: "BIOT_PREVIOUS_GENERAL_LARGE",
    label: "Общие компетенции · крупный бизнес · ред. 30.05.2026",
    hours: 72,
    clause: 26,
  },
  {
    id: "BIOT_PREVIOUS_SPECIAL_SMALL",
    label: "Специальные компетенции · малый и микробизнес · ред. 30.05.2026",
    hours: 16,
    clause: 27,
  },
  {
    id: "BIOT_PREVIOUS_SPECIAL_MEDIUM",
    label: "Специальные компетенции · средний бизнес · ред. 30.05.2026",
    hours: 24,
    clause: 27,
  },
  {
    id: "BIOT_PREVIOUS_SPECIAL_LARGE",
    label: "Специальные компетенции · крупный бизнес · ред. 30.05.2026",
    hours: 40,
    clause: 27,
  },
] as const;

const industrialPrograms = [
  { id: "PB_RETRAINING", label: "Переподготовка по основаниям п. 5 ст. 79" },
] as const;

// Totals include the practical lessons and assessment in each plan.
// Appendix 4 to order 276, in force from 1 August 2026 (amendment 277).
const firePrograms = [
  {
    id: "PTM_DIRECTOR",
    label: "Руководитель организации",
    hours: 8,
    clause: "z777",
  },
  {
    id: "PTM_FIRE_RESPONSIBLE",
    label: "Ответственный за пожарную безопасность",
    hours: 12,
    clause: "z829",
  },
  {
    id: "PTM_HAZARDOUS_AB",
    label: "Работник объекта категории А или Б (основной персонал)",
    hours: 12,
    clause: "z902",
  },
  {
    id: "PTM_HOT_WORK",
    label: "Работник, выполняющий огневые работы",
    hours: 12,
    clause: "z964",
  },
  {
    id: "PTM_FIRE_AUTOMATION",
    label: "Ответственный за пожарную автоматику",
    hours: 12,
    clause: "z1025",
  },
  {
    id: "PTM_CROWDED_RESPONSIBLE",
    label:
      "Ответственный за пожарную безопасность объекта с массовым пребыванием людей",
    hours: 12,
    clause: "z1104",
  },
] as const;

const programs = [
  ...industrialPrograms,
  ...firePrograms,
  ...previousWorkerPrograms,
  ...previousResponsiblePrograms,
] as const;
export type TrainingHoursProgram = (typeof programs)[number]["id"];
export const trainingHoursProgramIds = programs.map((program) => program.id);
type ProgramOption = { id: TrainingHoursProgram; label: string };

export function isPreviousBiotHoursProgram(program?: TrainingHoursProgram) {
  return program?.startsWith("BIOT_PREVIOUS_") === true;
}

export function trainingHoursPrograms(
  templateId: string,
): readonly ProgramOption[] {
  if (templateId.startsWith("pb-")) return industrialPrograms;
  if (templateId.startsWith("ptm-")) return firePrograms;
  if (templateId.startsWith("biot-itr-")) return previousResponsiblePrograms;
  if (templateId.startsWith("biot-")) return previousWorkerPrograms;
  return [];
}

type HoursRule = {
  hours?: string;
  productionHours?: string;
  minimumHours?: number;
  source: string;
  url?: string;
};

export function trainingHoursRule(
  templateId: string,
  employeeCategory: "WORKER" | "ITR" | undefined,
  fields: { biotCategory?: BiotCategory; hoursProgram?: TrainingHoursProgram },
): HoursRule {
  if (templateId.startsWith("pb-")) {
    if (fields.hoursProgram === "PB_RETRAINING") {
      return {
        hours: "10",
        source:
          "МЧС № 332, п. 8. Переподготовка по основаниям п. 5 ст. 79 Закона «О гражданской защите» — 10 часов.",
        url: industrialSafetyRules,
      };
    }
    if (!employeeCategory) {
      return {
        source:
          "Для подготовки по промышленной безопасности укажите категорию слушателя.",
        url: industrialSafetyRules,
      };
    }
    const minimumHours = employeeCategory === "ITR" ? 40 : 10;
    return {
      hours: String(minimumHours),
      minimumHours,
      source: `МЧС № 332, п. 7. Минимальная продолжительность программы — ${minimumHours} часов.`,
      url: industrialSafetyRules,
    };
  }
  if (templateId.startsWith("ptm-")) {
    const program = firePrograms.find(
      (entry) => entry.id === fields.hoursProgram,
    );
    return program
      ? {
          hours: String(program.hours),
          source: `МЧС № 276, приложение 4. ${program.label} — ${program.hours} ч. по типовому плану учебного центра.`,
          url: `${fireSafetyRules}#${program.clause}`,
        }
      : {
          source:
            "Продолжительность ПТМ зависит от программы слушателя. МЧС № 276, приложение 4.",
          url: `${fireSafetyRules}#z40`,
        };
  }
  if (templateId.startsWith("ps-")) {
    return {
      source:
        "Работодатель определяет часы по учебной программе конкретной профессии. Закон «Об образовании», ст. 32-1.",
      url: occupationTrainingLaw,
    };
  }
  if (templateId.startsWith("biot-")) {
    if (isPreviousBiotHoursProgram(fields.hoursProgram)) {
      if (
        !templateId.startsWith("biot-itr-") &&
        fields.hoursProgram === "BIOT_PREVIOUS_WORKER"
      ) {
        return {
          source:
            "Продолжительность обучения рабочих устанавливает работодатель. Правила № 1019, редакция на 30.05.2026.",
          url: previousOccupationalSafetyRules,
        };
      }
      const program =
        templateId.startsWith("biot-itr-") &&
        previousResponsiblePrograms.find(
          (entry) => entry.id === fields.hoursProgram,
        );
      if (program) {
        return {
          hours: String(program.hours),
          minimumHours: program.hours,
          source: `Правила № 1019, п. ${program.clause}, редакция на 30.05.2026. Для ответственных работников — не менее ${program.hours} академических часов.`,
          url: previousOccupationalSafetyRules,
        };
      }
    }
    const category =
      fields.biotCategory ??
      (templateId.startsWith("biot-itr-") || employeeCategory === "ITR"
        ? "ITR_STANDARD"
        : "WORKER");
    const preset = BIOT_CATEGORIES[category];
    return {
      hours: String(preset.defaultHours),
      ...(preset.defaultProductionHours === undefined
        ? {}
        : { productionHours: String(preset.defaultProductionHours) }),
      source:
        category === "ITR_STANDARD"
          ? "Объём стандартной программы БиОТ для ИТР задаёт учебный центр."
          : `Предустановка программы БиОТ «${preset.label}». Правила № 1019, редакция приказа № 223.`,
      url: occupationalSafetyRules,
    };
  }
  return { source: "" };
}

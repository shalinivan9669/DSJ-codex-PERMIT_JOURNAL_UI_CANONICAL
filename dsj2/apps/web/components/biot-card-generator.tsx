"use client";

import { useEffect, useRef, useState } from "react";
import type {
  ChangeEvent,
  ClipboardEvent as ReactClipboardEvent,
  ReactNode,
} from "react";
import type {
  BiotDocumentKind,
  BiotCardDefaults,
  CardGenerationRequestDetail,
  CardGenerationRequestSummary,
  SafetyCardType,
} from "@dsj/types";
import {
  Badge,
  Button,
  Input,
  Select,
  Table,
  TableWrapper,
  Td,
  Textarea,
  Th,
} from "@dsj/ui";
import { requestKazakhJobTitleTranslation } from "../lib/job-title-translation";
import { readBiotWorkbook, validateBiotPhoto, type BiotImportResult } from "../lib/biot-xlsx-import";
import { canReuseImportPlaceholder } from "../lib/biot-import-placeholder";
import { serializeBiotRequest } from "../lib/biot-request-size";
import { BiotGroupSubmissionError, confirmedBiotHistoryLinks, describeBiotGroupFailure, submitBiotGroups } from "../lib/biot-group-submission";
import { PhotoUploadInput } from "./photo-upload-input";

type EmployeeOption = {
  id: string;
  fullName: string;
  employeeNumber: string;
  jobTitle: string;
  jobTitleKz: string | null;
  photoDataUrl: string | null;
  photoFileName: string | null;
  employeeKind: string;
  contractorCompany: {
    name: string;
  } | null;
};

type TrainingOption = {
  id: string;
  employeeId: string;
  status: string;
  trainingProgram: {
    title: string;
  };
};

type BiotCardGeneratorProps = {
  companyId: string | null;
  companyName: string | null;
  employees: EmployeeOption[];
  trainingAssignments: TrainingOption[];
  initialDefaults: BiotCardDefaults;
  initialRequests: CardGenerationRequestSummary[];
  editorMode?: "create" | "edit";
  initialRequest?: CardGenerationRequestDetail | null;
  returnHref?: string;
  canManageSavedRequests?: boolean;
};

type TrainingSubjectMode = "preset" | "custom";

type TrainingSubjectSettings = {
  trainingSubjectMode: TrainingSubjectMode;
  trainingSubjectPreset: string;
  trainingSubjectCustom: string;
};

type RowDocumentSettings = TrainingSubjectSettings & {
  selectedCertificateTypes: SafetyCardType[];
  certificateType: SafetyCardType;
  biotDocumentKind: BiotDocumentKind;
  psDocumentKind: BiotDocumentKind;
  issueDate: string;
  seriesNumber: string;
  psIncludeCard: boolean;
  psIncludeProtocol: boolean;
  psIncludeWitness: boolean;
};

type RowDocumentNumberSettings = TrainingSubjectSettings & {
  issueDate: string;
  certificateNumber: string;
  protocolNumber: string;
  witnessCertificateNumber: string;
  witnessRegistrationNumber: string;
  isCertificateManual: boolean;
  isProtocolManual: boolean;
  isWitnessCertificateManual: boolean;
  isWitnessRegistrationManual: boolean;
};

type GeneratorRow = RowDocumentSettings & {
  id: string;
  employeeId: string;
  trainingAssignmentId: string;
  fullName: string;
  fullNameKz: string;
  issuedTo: string;
  positionRu: string;
  positionKz: string;
  workplaceRu: string;
  workplaceKz: string;
  certificateNumber: string;
  protocolNumber: string;
  witnessCertificateNumber: string;
  witnessRegistrationNumber: string;
  isCertificateManual: boolean;
  isProtocolManual: boolean;
  isWitnessCertificateManual: boolean;
  isWitnessRegistrationManual: boolean;
  documentNumbers: Partial<Record<SafetyCardType, RowDocumentNumberSettings>>;
  photoDataUrl: string;
  photoFileName: string;
  isPhotoProcessing: boolean;
};

type ImportPhoto = {
  status: "processing" | "ready" | "error";
  source: "excel" | "file";
  dataUrl?: string;
  fileName?: string;
  message?: string;
};

type GenerationGroup = {
  key: string;
  certificateType: SafetyCardType;
  biotDocumentKind: BiotDocumentKind;
  issueDate: string;
  seriesNumber: string;
  trainingSubject: string;
  includeCard?: boolean;
  includeProtocol?: boolean;
  includeWitness?: boolean;
  requestCompanyRu?: string;
  requestCompanyKz?: string;
  rows: GeneratorRow[];
};

type CompanyLegalForm = "TOO" | "IP" | "AO";
type BulkPasteColumnKey =
  | "fullName"
  | "positionRu"
  | "positionKz"
  | "certificateNumber"
  | "protocolNumber"
  | "witnessCertificateNumber"
  | "witnessRegistrationNumber";

type BulkPasteColumn = {
  key: BulkPasteColumnKey;
  label: string;
};

type EditableCellKey = BulkPasteColumnKey | "photo";

type ActiveCellEditor = {
  rowId: string;
  field: EditableCellKey;
} | null;

type ActiveRowSettingsEditor = string | null;

type EditorSectionProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  compact?: boolean;
  tone?: "default" | "muted";
};

type SummaryStatProps = {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
};

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function EditorSection({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
  compact = false,
  tone = "default",
}: EditorSectionProps) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border border-[var(--line)]",
        tone === "muted"
          ? "bg-[color:rgba(255,255,255,0.82)]"
          : "bg-[var(--surface)]",
        className,
      )}
    >
      <div
        className={cn(
          "flex flex-col gap-3 border-b border-[var(--line)] px-5 py-4 sm:flex-row sm:items-start sm:justify-between",
          compact && "gap-2 px-4 py-3",
        )}
      >
        <div className="min-w-0 space-y-1.5">
          <h2
            className={cn(
              "text-base font-semibold text-[var(--ink)]",
              compact && "text-[15px]",
            )}
          >
            {title}
          </h2>
          {description ? (
            <p
              className={cn(
                "max-w-3xl text-sm leading-6 text-[var(--muted)]",
                compact && "text-[13px] leading-5",
              )}
            >
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className={cn("px-5 py-5", compact && "px-4 py-4", bodyClassName)}>
        {children}
      </div>
    </section>
  );
}

function SummaryStat({ label, value, hint }: SummaryStatProps) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
        {label}
      </p>
      <div className="mt-1.5 text-sm font-semibold text-[var(--ink)]">
        {value}
      </div>
      {hint ? (
        <div className="mt-1 text-xs leading-5 text-[var(--muted)]">{hint}</div>
      ) : null}
    </div>
  );
}

const CUSTOM_SUBJECT_VALUE = "__custom__";
const MAX_SOURCE_PHOTO_SIZE_BYTES = 10 * 1024 * 1024;
const certificateTypeLabels: Record<SafetyCardType, string> = {
  BIOT: "БиОТ",
  PTM: "ПТМ",
  PB: "ПБ",
  PS: "ПС",
};
const certificateTypeDescriptions: Record<SafetyCardType, string> = {
  BIOT: "Охрана труда",
  PTM: "Пожарный минимум",
  PB: "Промбезопасность",
  PS: "Профессии",
};
const certificateTypeOrder: SafetyCardType[] = ["BIOT", "PB", "PTM", "PS"];
const legalFormOptions: Array<{
  value: CompanyLegalForm;
  label: string;
  ruPrefix: string;
  kzSuffix: string;
}> = [
  { value: "TOO", label: "ТОО / ЖШС", ruPrefix: "ТОО", kzSuffix: "ЖШС" },
  { value: "IP", label: "ИП / ЖК", ruPrefix: "ИП", kzSuffix: "ЖК" },
  { value: "AO", label: "АО / АҚ", ruPrefix: "АО", kzSuffix: "АҚ" },
];

function todayValue() {
  return new Date().toISOString().slice(0, 10);
}

function createRowId() {
  return `biot-row-${Math.random().toString(36).slice(2, 10)}`;
}

function extractYears(issueDate: string) {
  const [year = "2026"] = issueDate.split("-");
  return {
    fullYear: year,
    shortYear: year.slice(-2),
  };
}

function formatCertificateNumber(
  certificateType: SafetyCardType,
  issueDate: string,
  sequence: number,
  biotDocumentKind: BiotDocumentKind = "WORKER_CARD",
) {
  if (certificateType === "BIOT" && biotDocumentKind === "ITR_CERTIFICATE") {
    return `БТ-СРТ-${String(sequence).padStart(5, "0")}`;
  }

  if (certificateType === "PS" && biotDocumentKind === "ITR_CERTIFICATE") {
    return `${extractYears(issueDate).shortYear}/ПС/СВ-${String(sequence).padStart(6, "0")}`;
  }

  const { shortYear } = extractYears(issueDate);
  const prefix =
    certificateType === "PTM"
      ? "ПТМ"
      : certificateType === "PB"
        ? "ПБ"
        : certificateType === "PS"
          ? "ПС"
          : "БТ";
  return `${prefix}/${shortYear}-${String(sequence).padStart(5, "0")}`;
}

function formatProtocolNumber(
  certificateType: SafetyCardType,
  issueDate: string,
  sequence: number,
  biotDocumentKind: BiotDocumentKind = "WORKER_CARD",
) {
  if (certificateType === "PS" && biotDocumentKind === "ITR_CERTIFICATE") {
    return String(sequence).padStart(5, "0");
  }

  const { fullYear } = extractYears(issueDate);
  const prefix =
    certificateType === "PTM"
      ? "ПТМ"
      : certificateType === "PB"
        ? "ПБ"
        : certificateType === "PS"
          ? "ПС"
          : "БТ";
  return `${prefix}/${fullYear}-ПТ-${String(sequence).padStart(5, "0")}`;
}

function formatPsWitnessCertificateNumber(issueDate: string, sequence: number) {
  return `${extractYears(issueDate).shortYear}/ПС/СВ-${String(sequence).padStart(6, "0")}`;
}

function formatPsWitnessRegistrationNumber(sequence: number) {
  return String(sequence).padStart(5, "0");
}

function normalizeBiotDocumentKind(
  certificateType: SafetyCardType,
  biotDocumentKind: BiotDocumentKind,
) {
  void certificateType;

  return biotDocumentKind === "ITR_CERTIFICATE"
    ? "ITR_CERTIFICATE"
    : "WORKER_CARD";
}

function getDocumentKindForType(
  certificateType: SafetyCardType,
  biotDocumentKind: BiotDocumentKind,
  psDocumentKind: BiotDocumentKind,
) {
  if (certificateType === "PS") {
    return normalizeBiotDocumentKind(certificateType, psDocumentKind);
  }

  return normalizeBiotDocumentKind(certificateType, biotDocumentKind);
}

function normalizeSelectedCertificateTypes(
  values: SafetyCardType[],
  fallback: SafetyCardType,
) {
  const normalized = certificateTypeOrder.filter((type) =>
    values.includes(type),
  );

  return normalized.length ? normalized : [fallback];
}

function getPrimaryCertificateType(
  selectedCertificateTypes: SafetyCardType[],
  fallback: SafetyCardType,
) {
  const normalized = normalizeSelectedCertificateTypes(
    selectedCertificateTypes,
    fallback,
  );

  return normalized.includes(fallback) ? fallback : normalized[0];
}

function getRowDocumentKindForType(
  row: RowDocumentSettings,
  certificateType: SafetyCardType,
) {
  return getDocumentKindForType(
    certificateType,
    row.biotDocumentKind,
    row.psDocumentKind,
  );
}

function getDefaultsCacheKey(
  certificateType: SafetyCardType,
  biotDocumentKind: BiotDocumentKind,
  issueDate: string,
) {
  return `${certificateType}:${biotDocumentKind}:${issueDate}`;
}

function getEffectiveTrainingSubject(settings: TrainingSubjectSettings) {
  return settings.trainingSubjectMode === "custom"
    ? settings.trainingSubjectCustom.trim()
    : settings.trainingSubjectPreset;
}

function createRowDocumentSettings(args: {
  selectedCertificateTypes?: SafetyCardType[];
  certificateType: SafetyCardType;
  biotDocumentKind: BiotDocumentKind;
  psDocumentKind: BiotDocumentKind;
  issueDate: string;
  seriesNumber: string;
  trainingSubjectMode: TrainingSubjectMode;
  trainingSubjectPreset: string;
  trainingSubjectCustom: string;
  psIncludeCard: boolean;
  psIncludeProtocol: boolean;
  psIncludeWitness: boolean;
}): RowDocumentSettings {
  const selectedCertificateTypes = normalizeSelectedCertificateTypes(
    args.selectedCertificateTypes ?? [args.certificateType],
    args.certificateType,
  );
  const certificateType = getPrimaryCertificateType(
    selectedCertificateTypes,
    args.certificateType,
  );

  return {
    selectedCertificateTypes,
    certificateType,
    biotDocumentKind: args.biotDocumentKind,
    psDocumentKind: args.psDocumentKind,
    issueDate: args.issueDate,
    seriesNumber: args.seriesNumber,
    trainingSubjectMode: args.trainingSubjectMode,
    trainingSubjectPreset: args.trainingSubjectPreset,
    trainingSubjectCustom: args.trainingSubjectCustom,
    psIncludeCard: args.psIncludeCard,
    psIncludeProtocol: args.psIncludeProtocol,
    psIncludeWitness: args.psIncludeWitness,
  };
}

function createEmptyDocumentNumberSettings(
  certificateType: SafetyCardType,
  biotDocumentKind: BiotDocumentKind,
  issueDate: string,
  index: number,
  defaults: BiotCardDefaults,
  includeWitness: boolean,
  trainingSubjectSettings?: TrainingSubjectSettings,
): RowDocumentNumberSettings {
  const subjectSettings = trainingSubjectSettings ?? {
    trainingSubjectMode: "preset" as const,
    trainingSubjectPreset: defaults.defaultTrainingSubject,
    trainingSubjectCustom: "",
  };

  return {
    ...subjectSettings,
    issueDate,
    certificateNumber: formatCertificateNumber(
      certificateType,
      issueDate,
      defaults.nextCertificateSequence + index,
      biotDocumentKind,
    ),
    protocolNumber: formatProtocolNumber(
      certificateType,
      issueDate,
      defaults.nextProtocolSequence + index,
      biotDocumentKind,
    ),
    witnessCertificateNumber:
      certificateType === "PS" &&
      biotDocumentKind !== "ITR_CERTIFICATE" &&
      includeWitness
        ? formatPsWitnessCertificateNumber(
            issueDate,
            (defaults.nextWitnessCertificateSequence ?? 1) + index,
          )
        : "",
    witnessRegistrationNumber:
      certificateType === "PS" &&
      biotDocumentKind !== "ITR_CERTIFICATE" &&
      includeWitness
        ? formatPsWitnessRegistrationNumber(
            (defaults.nextWitnessRegistrationSequence ?? 1) + index,
          )
        : "",
    isCertificateManual: false,
    isProtocolManual: false,
    isWitnessCertificateManual: false,
    isWitnessRegistrationManual: false,
  };
}

function isBiotItrCertificate(
  certificateType: SafetyCardType,
  biotDocumentKind: BiotDocumentKind,
) {
  return (
    certificateType === "BIOT" &&
    normalizeBiotDocumentKind(certificateType, biotDocumentKind) ===
      "ITR_CERTIFICATE"
  );
}

function isPsWitnessCertificate(
  certificateType: SafetyCardType,
  biotDocumentKind: BiotDocumentKind,
) {
  return (
    certificateType === "PS" &&
    normalizeBiotDocumentKind(certificateType, biotDocumentKind) ===
      "ITR_CERTIFICATE"
  );
}

function getCertificateTypeLabel(
  certificateType: SafetyCardType,
  biotDocumentKind: BiotDocumentKind = "WORKER_CARD",
) {
  if (isBiotItrCertificate(certificateType, biotDocumentKind)) {
    return "БиОТ Сертификат ИТР";
  }

  if (isPsWitnessCertificate(certificateType, biotDocumentKind)) {
    return "ПС Свидетельство";
  }

  return certificateTypeLabels[certificateType];
}

function usesSeriesNumber(
  certificateType: SafetyCardType,
  biotDocumentKind: BiotDocumentKind = "WORKER_CARD",
) {
  if (isBiotItrCertificate(certificateType, biotDocumentKind)) {
    return false;
  }

  if (isPsWitnessCertificate(certificateType, biotDocumentKind)) {
    return false;
  }

  return certificateType === "BIOT" || certificateType === "PS";
}

function usesWorkplace(
  certificateType: SafetyCardType,
  _biotDocumentKind: BiotDocumentKind = "WORKER_CARD",
) {
  return certificateType !== "PS";
}

function usesRequestCompany(
  certificateType: SafetyCardType,
  _biotDocumentKind: BiotDocumentKind = "WORKER_CARD",
) {
  return certificateType !== "PS";
}

function usesPhoto(
  certificateType: SafetyCardType,
  biotDocumentKind: BiotDocumentKind = "WORKER_CARD",
) {
  if (isPsWitnessCertificate(certificateType, biotDocumentKind)) {
    return false;
  }

  return (
    certificateType === "PB" ||
    certificateType === "PTM" ||
    certificateType === "PS"
  );
}

function usesTrainingSubject(
  certificateType: SafetyCardType,
  biotDocumentKind: BiotDocumentKind = "WORKER_CARD",
) {
  if (isBiotItrCertificate(certificateType, biotDocumentKind)) {
    return false;
  }

  return certificateType !== "PS";
}

function usesProtocolNumber(
  certificateType: SafetyCardType,
  biotDocumentKind: BiotDocumentKind = "WORKER_CARD",
) {
  void certificateType;
  void biotDocumentKind;
  return true;
}

function getCertificateNumberLabel(
  certificateType: SafetyCardType,
  biotDocumentKind: BiotDocumentKind = "WORKER_CARD",
) {
  return isBiotItrCertificate(certificateType, biotDocumentKind)
    ? "Номер сертификата"
    : isPsWitnessCertificate(certificateType, biotDocumentKind)
      ? "Номер КБ"
      : "Номер удостоверения";
}

function getProtocolNumberLabel(
  certificateType: SafetyCardType,
  biotDocumentKind: BiotDocumentKind = "WORKER_CARD",
) {
  return isPsWitnessCertificate(certificateType, biotDocumentKind)
    ? "Регистрационный номер"
    : "Протокол № / основание";
}

function getDocumentDownloadLabel(request: CardGenerationRequestSummary) {
  if (
    request.certificateType === "BIOT" &&
    request.biotDocumentKind === "ITR_CERTIFICATE"
  ) {
    return "Сертификат DOCX";
  }

  if (
    request.certificateType === "PS" &&
    request.biotDocumentKind === "ITR_CERTIFICATE"
  ) {
    return "Свидетельство DOCX";
  }

  if (
    request.certificateType === "PS" &&
    !request.includeCard &&
    request.includeWitness
  ) {
    return "Свидетельство DOCX";
  }

  return "Корочки DOCX";
}

function getDocumentCategoryLabel(biotDocumentKind: BiotDocumentKind) {
  return biotDocumentKind === "ITR_CERTIFICATE" ? "ИТР" : "Рабочий";
}

function getValidityYears(biotDocumentKind: BiotDocumentKind) {
  return biotDocumentKind === "ITR_CERTIFICATE" ? 3 : 1;
}

function formatValidityLabel(biotDocumentKind: BiotDocumentKind) {
  const years = getValidityYears(biotDocumentKind);

  return `${years} ${years === 1 ? "год" : years < 5 ? "года" : "лет"}`;
}

function getRequestTypeLabel(request: CardGenerationRequestSummary) {
  if (
    request.certificateType === "PS" &&
    request.biotDocumentKind === "ITR_CERTIFICATE"
  ) {
    return "ПС Свидетельство";
  }

  if (
    request.certificateType === "PS" &&
    request.includeWitness &&
    request.includeCard
  ) {
    return "ПС комплект";
  }

  if (
    request.certificateType === "PS" &&
    request.includeWitness &&
    !request.includeCard
  ) {
    return "ПС Свидетельство";
  }

  const baseLabel = getCertificateTypeLabel(
    request.certificateType,
    request.biotDocumentKind,
  );

  if (
    request.biotDocumentKind === "ITR_CERTIFICATE" &&
    request.certificateType !== "BIOT" &&
    request.certificateType !== "PS"
  ) {
    return `${baseLabel} · ИТР`;
  }

  return baseLabel;
}

function getRequestBundleLabel(request: CardGenerationRequestSummary) {
  if (request.certificateType !== "PS") {
    return null;
  }

  const parts = [
    request.includeCard ? "Корочка" : null,
    request.includeProtocol ? "Протокол" : null,
    request.includeWitness ? "Свидетельство" : null,
  ].filter((value): value is string => Boolean(value));

  return parts.length ? parts.join(", ") : null;
}

function buildScopedDownloadHref(path: string, companyId: string | null) {
  if (!companyId) {
    return path;
  }

  const params = new URLSearchParams({ companyId });
  return `${path}?${params.toString()}`;
}

async function readResponseError(response: Response, fallback: string) {
  const text = await response.text();

  if (!text) {
    return fallback;
  }

  try {
    const payload = JSON.parse(text) as {
      message?: string | string[];
      error?: string;
    };

    if (Array.isArray(payload.message)) {
      return payload.message.join(", ");
    }

    if (typeof payload.message === "string") {
      return payload.message;
    }

    if (typeof payload.error === "string") {
      return payload.error;
    }
  } catch {
    return text;
  }

  return fallback;
}

function getTrainingSubjectLabel(certificateType: SafetyCardType) {
  if (certificateType === "PTM") {
    return "Поле «В том, что»";
  }

  if (certificateType === "PB") {
    return "Поле «Прослушал(а) курс»";
  }

  return "Строка «В том, что он»";
}

function getRoleFieldLabel(
  certificateType: SafetyCardType,
  biotDocumentKind: BiotDocumentKind = "WORKER_CARD",
) {
  if (isPsWitnessCertificate(certificateType, biotDocumentKind)) {
    return "Профессия / Кәсіп";
  }

  return certificateType === "PS"
    ? "Квалификация / Біліктілік"
    : "Должность / Лауазымы";
}

function getRoleFieldPlaceholderRu(
  certificateType: SafetyCardType,
  biotDocumentKind: BiotDocumentKind = "WORKER_CARD",
) {
  if (isPsWitnessCertificate(certificateType, biotDocumentKind)) {
    return "Профессия";
  }

  return certificateType === "PS" ? "Квалификация" : "Должность";
}

function getRoleFieldPlaceholderKz(
  certificateType: SafetyCardType,
  biotDocumentKind: BiotDocumentKind = "WORKER_CARD",
) {
  if (isPsWitnessCertificate(certificateType, biotDocumentKind)) {
    return "Кәсіп (если пусто, будет взято русское значение)";
  }

  return certificateType === "PS"
    ? "Біліктілік (если пусто, будет взято русское значение)"
    : "Лауазымы (если пусто, будет взято русское значение)";
}

function getRoleRequiredLabel(
  certificateType: SafetyCardType,
  biotDocumentKind: BiotDocumentKind = "WORKER_CARD",
) {
  if (isPsWitnessCertificate(certificateType, biotDocumentKind)) {
    return "профессию";
  }

  return certificateType === "PS" ? "квалификацию" : "должность";
}

function getRoleTableLabelRu(
  certificateType: SafetyCardType,
  biotDocumentKind: BiotDocumentKind = "WORKER_CARD",
) {
  if (isPsWitnessCertificate(certificateType, biotDocumentKind)) {
    return "Профессия (рус)";
  }

  return certificateType === "PS" ? "Квалификация (рус)" : "Должность (рус)";
}

function getRoleTableLabelKz(
  certificateType: SafetyCardType,
  biotDocumentKind: BiotDocumentKind = "WORKER_CARD",
) {
  if (isPsWitnessCertificate(certificateType, biotDocumentKind)) {
    return "Кәсіп (қаз)";
  }

  return certificateType === "PS" ? "Біліктілік (қаз)" : "Лауазымы (қаз)";
}

function needsIssuedToField(
  certificateType: SafetyCardType,
  biotDocumentKind: BiotDocumentKind,
) {
  return isPsWitnessCertificate(certificateType, biotDocumentKind);
}

function usesPsCard(psDocumentKind: BiotDocumentKind, includeCard: boolean) {
  return psDocumentKind !== "ITR_CERTIFICATE" && includeCard;
}

function usesPsWitness(
  psDocumentKind: BiotDocumentKind,
  includeWitness: boolean,
) {
  return psDocumentKind === "ITR_CERTIFICATE" || includeWitness;
}

function usesSeriesNumberWithSelection(
  certificateType: SafetyCardType,
  biotDocumentKind: BiotDocumentKind,
  psIncludeCard: boolean,
) {
  if (certificateType !== "PS") {
    return usesSeriesNumber(certificateType, biotDocumentKind);
  }

  return usesPsCard(biotDocumentKind, psIncludeCard);
}

function usesPhotoWithSelection(
  certificateType: SafetyCardType,
  biotDocumentKind: BiotDocumentKind,
  psIncludeCard: boolean,
) {
  if (certificateType !== "PS") {
    return usesPhoto(certificateType, biotDocumentKind);
  }

  return usesPsCard(biotDocumentKind, psIncludeCard);
}

function needsFullNameKzWithSelection(
  certificateType: SafetyCardType,
  biotDocumentKind: BiotDocumentKind,
  psIncludeWitness: boolean,
) {
  void certificateType;
  void biotDocumentKind;
  void psIncludeWitness;
  return false;
}

function normalizeCompanyBaseName(value: string | null) {
  if (!value) {
    return "";
  }

  return value
    .replace(/^(ТОО|ИП|АО)\s+/u, "")
    .replace(/\s+(ЖШС|ЖК|АҚ)$/u, "")
    .trim();
}

function detectLegalForm(value: string | null): CompanyLegalForm {
  if (!value) {
    return "TOO";
  }

  if (/^(ИП)\s+/u.test(value) || /\s+(ЖК)$/u.test(value)) {
    return "IP";
  }

  if (/^(АО)\s+/u.test(value) || /\s+(АҚ)$/u.test(value)) {
    return "AO";
  }

  return "TOO";
}

function buildCompanyNames(baseName: string, legalForm: CompanyLegalForm) {
  const normalizedName = baseName.trim();

  if (!normalizedName) {
    return {
      requestCompanyRu: "",
      requestCompanyKz: "",
    };
  }

  const option =
    legalFormOptions.find((item) => item.value === legalForm) ??
    legalFormOptions[0];
  return {
    requestCompanyRu: `${option.ruPrefix} ${normalizedName}`,
    requestCompanyKz: `${normalizedName} ${option.kzSuffix}`,
  };
}

function formatHumanDate(value: string) {
  return new Date(value).toLocaleDateString("ru-RU");
}

function formatHumanDateTime(value: string) {
  return new Date(value).toLocaleString("ru-RU");
}

function normalizePasteCell(value: string) {
  return value.replace(/\r/g, "").trim();
}

function parseBulkPasteText(value: string) {
  return value
    .split(/\n/u)
    .map((line) => line.replace(/\r/g, ""))
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split("\t").map(normalizePasteCell));
}

function looksLikeBulkPasteHeader(row: string[]) {
  if (row.length < 2) {
    return false;
  }

  const firstCell = normalizePasteCell(row[0]).toLowerCase();
  const secondCell = normalizePasteCell(row[1]).toLowerCase();

  return (
    firstCell.includes("фио") &&
    (secondCell.includes("долж") || secondCell.includes("проф"))
  );
}

function formatRequestPosition(
  request: CardGenerationRequestSummary["items"][number],
) {
  if (
    request.positionRu &&
    request.positionKz &&
    request.positionRu !== request.positionKz
  ) {
    return `${request.positionRu} / ${request.positionKz}`;
  }

  return request.positionRu ?? request.positionKz ?? "-";
}

function loadImageFromFile(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Не удалось обработать фото."));
    };
    image.src = objectUrl;
  });
}

async function preparePhotoDataUrl(file: File) {
  const image = await loadImageFromFile(file);
  if (!image.width || !image.height || image.width * image.height > 40_000_000) {
    throw new Error("Размер изображения превышает 40 миллионов пикселей или изображение повреждено.");
  }
  const canvas = document.createElement("canvas");
  const targetWidth = 180;
  const targetHeight = 240;
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Браузер не поддерживает обработку фото.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, targetWidth, targetHeight);

  const scale = Math.max(
    targetWidth / image.width,
    targetHeight / image.height,
  );
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const offsetX = (targetWidth - drawWidth) / 2;
  const offsetY = (targetHeight - drawHeight) / 2;

  context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
  return canvas.toDataURL("image/jpeg", 0.82);
}

function toJpegFileName(value: string) {
  return value.replace(/\.[^.]+$/u, "") + ".jpg";
}

function createEmptyRow(
  certificateType: SafetyCardType,
  biotDocumentKind: BiotDocumentKind,
  includeWitness: boolean,
  index: number,
  issueDate: string,
  defaults: BiotCardDefaults,
  companyName: string | null,
  rowSettings?: Partial<RowDocumentSettings>,
): GeneratorRow {
  const selectedCertificateTypes = normalizeSelectedCertificateTypes(
    rowSettings?.selectedCertificateTypes ?? [certificateType],
    rowSettings?.certificateType ?? certificateType,
  );
  const rowCertificateType = getPrimaryCertificateType(
    selectedCertificateTypes,
    rowSettings?.certificateType ?? certificateType,
  );
  const rowBiotDocumentKind =
    rowSettings?.biotDocumentKind ??
    (rowCertificateType === "PS" ? "WORKER_CARD" : biotDocumentKind);
  const rowPsDocumentKind =
    rowSettings?.psDocumentKind ??
    (rowCertificateType === "PS" ? biotDocumentKind : "WORKER_CARD");
  const rowIssueDate = rowSettings?.issueDate ?? issueDate;
  const rowPrimaryDocumentKind = getDocumentKindForType(
    rowCertificateType,
    rowBiotDocumentKind,
    rowPsDocumentKind,
  );
  const rowPsIncludeWitness =
    rowSettings?.psIncludeWitness ??
    (rowCertificateType === "PS" ? includeWitness : false);
  const rowTrainingSubjectSettings: TrainingSubjectSettings = {
    trainingSubjectMode: rowSettings?.trainingSubjectMode ?? "preset",
    trainingSubjectPreset:
      rowSettings?.trainingSubjectPreset ?? defaults.defaultTrainingSubject,
    trainingSubjectCustom: rowSettings?.trainingSubjectCustom ?? "",
  };
  const primaryNumberSettings = createEmptyDocumentNumberSettings(
    rowCertificateType,
    rowPrimaryDocumentKind,
    rowIssueDate,
    index,
    defaults,
    rowPsIncludeWitness,
    rowTrainingSubjectSettings,
  );

  return {
    ...createRowDocumentSettings({
      selectedCertificateTypes,
      certificateType: rowCertificateType,
      biotDocumentKind: rowBiotDocumentKind,
      psDocumentKind: rowPsDocumentKind,
      issueDate: rowIssueDate,
      seriesNumber: rowSettings?.seriesNumber ?? "1",
      ...rowTrainingSubjectSettings,
      psIncludeCard: rowSettings?.psIncludeCard ?? true,
      psIncludeProtocol: rowSettings?.psIncludeProtocol ?? true,
      psIncludeWitness: rowPsIncludeWitness,
    }),
    id: createRowId(),
    employeeId: "",
    trainingAssignmentId: "",
    fullName: "",
    fullNameKz: "",
    issuedTo: "",
    positionRu: "",
    positionKz: "",
    workplaceRu: companyName ?? "",
    workplaceKz: companyName ?? "",
    certificateNumber: primaryNumberSettings.certificateNumber,
    protocolNumber: primaryNumberSettings.protocolNumber,
    witnessCertificateNumber: primaryNumberSettings.witnessCertificateNumber,
    witnessRegistrationNumber: primaryNumberSettings.witnessRegistrationNumber,
    isCertificateManual: primaryNumberSettings.isCertificateManual,
    isProtocolManual: primaryNumberSettings.isProtocolManual,
    isWitnessCertificateManual:
      primaryNumberSettings.isWitnessCertificateManual,
    isWitnessRegistrationManual:
      primaryNumberSettings.isWitnessRegistrationManual,
    documentNumbers: {
      [rowCertificateType]: primaryNumberSettings,
    },
    photoDataUrl: "",
    photoFileName: "",
    isPhotoProcessing: false,
  };
}

function createRowFromRequestItem(
  item: CardGenerationRequestDetail["items"][number],
  rowSettings: RowDocumentSettings,
): GeneratorRow {
  const itemNumbers: RowDocumentNumberSettings = {
    issueDate: rowSettings.issueDate,
    trainingSubjectMode: rowSettings.trainingSubjectMode,
    trainingSubjectPreset: rowSettings.trainingSubjectPreset,
    trainingSubjectCustom: rowSettings.trainingSubjectCustom,
    certificateNumber: item.certificateNumber,
    protocolNumber: item.protocolNumber,
    witnessCertificateNumber: item.witnessCertificateNumber ?? "",
    witnessRegistrationNumber: item.witnessRegistrationNumber ?? "",
    isCertificateManual: item.certificateNumber.trim().length > 0,
    isProtocolManual: item.protocolNumber.trim().length > 0,
    isWitnessCertificateManual:
      (item.witnessCertificateNumber ?? "").trim().length > 0,
    isWitnessRegistrationManual:
      (item.witnessRegistrationNumber ?? "").trim().length > 0,
  };

  return {
    ...rowSettings,
    id: item.id,
    employeeId: item.employeeId ?? "",
    trainingAssignmentId: item.trainingAssignmentId ?? "",
    fullName: item.fullName,
    fullNameKz: item.fullNameKz ?? "",
    issuedTo: item.issuedTo ?? item.fullName,
    positionRu: item.positionRu ?? "",
    positionKz: item.positionKz ?? "",
    workplaceRu: item.workplaceRu ?? "",
    workplaceKz: item.workplaceKz ?? "",
    certificateNumber: itemNumbers.certificateNumber,
    protocolNumber: itemNumbers.protocolNumber,
    witnessCertificateNumber: itemNumbers.witnessCertificateNumber,
    witnessRegistrationNumber: itemNumbers.witnessRegistrationNumber,
    isCertificateManual: itemNumbers.isCertificateManual,
    isProtocolManual: itemNumbers.isProtocolManual,
    isWitnessCertificateManual: itemNumbers.isWitnessCertificateManual,
    isWitnessRegistrationManual: itemNumbers.isWitnessRegistrationManual,
    documentNumbers: {
      [rowSettings.certificateType]: itemNumbers,
    },
    photoDataUrl: item.photoDataUrl ?? "",
    photoFileName: item.photoFileName ?? "",
    isPhotoProcessing: false,
  };
}

export function BiotCardGenerator({
  companyId,
  companyName,
  initialDefaults,
  initialRequests,
  editorMode = "create",
  initialRequest = null,
  returnHref,
  canManageSavedRequests = false,
}: BiotCardGeneratorProps) {
  const isEditMode = editorMode === "edit" && initialRequest !== null;
  const initialIssueDate =
    initialRequest?.issueDate.slice(0, 10) ?? todayValue();
  const initialCertificateType =
    initialRequest?.certificateType ?? initialDefaults.certificateType;
  const initialBiotDocumentKind =
    initialRequest?.certificateType === "PS"
      ? "WORKER_CARD"
      : (initialRequest?.biotDocumentKind ?? initialDefaults.biotDocumentKind);
  const initialPsDocumentKind =
    initialRequest?.certificateType === "PS"
      ? initialRequest.biotDocumentKind
      : "WORKER_CARD";
  const initialActiveDocumentKind =
    initialCertificateType === "PS"
      ? initialPsDocumentKind
      : initialBiotDocumentKind;
  const initialPsIncludeCard =
    initialRequest?.certificateType === "PS"
      ? initialRequest.includeCard
      : true;
  const initialPsIncludeProtocol =
    initialRequest?.certificateType === "PS"
      ? initialRequest.includeProtocol
      : true;
  const initialPsIncludeWitness =
    initialRequest?.certificateType === "PS"
      ? initialRequest.includeWitness
      : false;
  const initialTrainingSubject =
    initialRequest?.trainingSubject ?? initialDefaults.defaultTrainingSubject;
  const initialTrainingSubjectMode =
    usesTrainingSubject(initialCertificateType, initialActiveDocumentKind) &&
    !initialDefaults.trainingSubjectPresets.includes(initialTrainingSubject)
      ? "custom"
      : "preset";
  const initialRequestCompanyName =
    initialRequest?.requestCompanyRu ?? companyName;
  const initialRowSettings = createRowDocumentSettings({
    selectedCertificateTypes: [initialCertificateType],
    certificateType: initialCertificateType,
    biotDocumentKind: initialBiotDocumentKind,
    psDocumentKind: initialPsDocumentKind,
    issueDate: initialIssueDate,
    seriesNumber: initialRequest?.seriesNumber ?? "1",
    trainingSubjectMode: initialTrainingSubjectMode,
    trainingSubjectPreset:
      initialTrainingSubjectMode === "preset"
        ? initialTrainingSubject
        : initialDefaults.defaultTrainingSubject,
    trainingSubjectCustom:
      initialTrainingSubjectMode === "custom" ? initialTrainingSubject : "",
    psIncludeCard: initialPsIncludeCard,
    psIncludeProtocol: initialPsIncludeProtocol,
    psIncludeWitness: initialPsIncludeWitness,
  });
  const [issueDate, setIssueDate] = useState(initialIssueDate);
  const [certificateType, setCertificateType] = useState<SafetyCardType>(
    initialCertificateType,
  );
  const [biotDocumentKind, setBiotDocumentKind] = useState<BiotDocumentKind>(
    initialBiotDocumentKind,
  );
  const [psDocumentKind, setPsDocumentKind] = useState<BiotDocumentKind>(
    initialPsDocumentKind,
  );
  const [psIncludeCard, setPsIncludeCard] = useState(initialPsIncludeCard);
  const [psIncludeProtocol, setPsIncludeProtocol] = useState(
    initialPsIncludeProtocol,
  );
  const [psIncludeWitness, setPsIncludeWitness] = useState(
    initialPsIncludeWitness,
  );
  const [selectedCertificateTypes, setSelectedCertificateTypes] = useState<
    SafetyCardType[]
  >([initialCertificateType]);
  const [seriesNumber, setSeriesNumber] = useState(
    initialRequest?.seriesNumber ?? "1",
  );
  const [defaults, setDefaults] = useState(initialDefaults);
  const [typeDefaultsCache, setTypeDefaultsCache] = useState<
    Record<string, BiotCardDefaults>
  >({
    [getDefaultsCacheKey(
      initialCertificateType,
      initialActiveDocumentKind,
      initialIssueDate,
    )]: initialDefaults,
  });
  const [trainingSubjectMode, setTrainingSubjectMode] =
    useState<TrainingSubjectMode>(initialTrainingSubjectMode);
  const [trainingSubjectPreset, setTrainingSubjectPreset] = useState(
    initialTrainingSubjectMode === "preset"
      ? initialTrainingSubject
      : initialDefaults.defaultTrainingSubject,
  );
  const [trainingSubjectCustom, setTrainingSubjectCustom] = useState(
    initialTrainingSubjectMode === "custom" ? initialTrainingSubject : "",
  );
  const [requestCompanyBaseName, setRequestCompanyBaseName] = useState(
    normalizeCompanyBaseName(initialRequestCompanyName),
  );
  const [requestCompanyLegalForm, setRequestCompanyLegalForm] =
    useState<CompanyLegalForm>(detectLegalForm(initialRequestCompanyName));
  const [rows, setRows] = useState<GeneratorRow[]>(
    initialRequest?.items.length
      ? initialRequest.items.map((item) =>
          createRowFromRequestItem(item, initialRowSettings),
        )
      : [
          createEmptyRow(
            initialCertificateType,
            initialActiveDocumentKind,
            initialPsIncludeWitness,
            0,
            initialIssueDate,
            initialDefaults,
            null,
            initialRowSettings,
          ),
        ],
  );
  const [isRefreshingDefaults, setIsRefreshingDefaults] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [importPreview, setImportPreview] = useState<BiotImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isReadingImport, setIsReadingImport] = useState(false);
  const [isImportApplied, setIsImportApplied] = useState(false);
  const importReadVersion = useRef(0);
  const importApplied = useRef(false);
  const [importPhotos, setImportPhotos] = useState<Record<number, ImportPhoto>>({});
  const importPhotosRef = useRef<Record<number, ImportPhoto>>({});
  const importPhotoVersions = useRef<Record<number, number>>({});
  const importPhotoQueue = useRef<Promise<void>>(Promise.resolve());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmedRequestLinks, setConfirmedRequestLinks] = useState<Array<{ label: string; requestId: string }>>([]);
  const historyDetailsRef = useRef<HTMLDetailsElement>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [savedRequests, setSavedRequests] =
    useState<CardGenerationRequestSummary[]>(initialRequests);
  const [currentRequestId] = useState(initialRequest?.id ?? null);
  const [deletingRequestId, setDeletingRequestId] = useState<string | null>(
    null,
  );
  const [translatingRowIds, setTranslatingRowIds] = useState<
    Record<string, boolean>
  >({});
  const [rowTranslationErrors, setRowTranslationErrors] = useState<
    Record<string, string>
  >({});
  const [activeCellEditor, setActiveCellEditor] =
    useState<ActiveCellEditor>(null);
  const [activeRowSettingsEditor, setActiveRowSettingsEditor] =
    useState<ActiveRowSettingsEditor>(null);

  const effectiveTrainingSubject = getEffectiveTrainingSubject({
    trainingSubjectMode,
    trainingSubjectPreset,
    trainingSubjectCustom,
  });
  const isMultiTypeSelection = selectedCertificateTypes.length > 1;
  const hasRoleSelection = selectedCertificateTypes.some(
    (type) => type !== "PS",
  );
  const hasBiotSelection = selectedCertificateTypes.includes("BIOT");
  const hasPsSelection = selectedCertificateTypes.includes("PS");
  const usesWorkplaceForSelection = selectedCertificateTypes.some((type) =>
    usesWorkplace(
      type,
      getDocumentKindForType(type, biotDocumentKind, psDocumentKind),
    ),
  );
  const usesRequestCompanyForSelection = selectedCertificateTypes.some((type) =>
    usesRequestCompany(
      type,
      getDocumentKindForType(type, biotDocumentKind, psDocumentKind),
    ),
  );
  const companyNames = buildCompanyNames(
    requestCompanyBaseName,
    requestCompanyLegalForm,
  );
  const requestWorkplaceRu = companyNames.requestCompanyRu;
  const requestWorkplaceKz = companyNames.requestCompanyKz;
  const selectedTypesLabel = selectedCertificateTypes
    .map((type) =>
      getCertificateTypeLabel(
        type,
        getDocumentKindForType(type, biotDocumentKind, psDocumentKind),
      ),
    )
    .join(", ");
  const activeBiotDocumentKind = getDocumentKindForType(
    certificateType,
    biotDocumentKind,
    psDocumentKind,
  );
  const roleFieldPlaceholderRu = isMultiTypeSelection
    ? "Должность или профессия"
    : getRoleFieldPlaceholderRu(certificateType, activeBiotDocumentKind);
  const roleFieldPlaceholderKz = isMultiTypeSelection
    ? "Лауазымы / біліктілік (если пусто, будет взято русское значение)"
    : getRoleFieldPlaceholderKz(certificateType, activeBiotDocumentKind);
  const roleTableLabelRu = isMultiTypeSelection
    ? "Должность / профессия (рус)"
    : getRoleTableLabelRu(certificateType, activeBiotDocumentKind);
  const roleTableLabelKz = isMultiTypeSelection
    ? "Должность / профессия (қаз)"
    : getRoleTableLabelKz(certificateType, activeBiotDocumentKind);
  const roleRequiredLabel = isMultiTypeSelection
    ? "должность или профессию"
    : getRoleRequiredLabel(certificateType, activeBiotDocumentKind);
  const psProfessionSuggestions = Array.from(
    new Map(
      savedRequests
        .filter((request) => request.certificateType === "PS")
        .flatMap((request) =>
          request.items
            .filter((item) => item.positionRu || item.positionKz)
            .map((item) => [
              `${item.positionRu ?? ""}:::${item.positionKz ?? ""}`,
              {
                positionRu: item.positionRu ?? "",
                positionKz: item.positionKz ?? "",
              },
            ]),
        ),
    ).values(),
  );
  const singleSelectionUsesTrainingSubject =
    !isMultiTypeSelection &&
    usesTrainingSubject(certificateType, activeBiotDocumentKind);
  const singleSelectionUsesProtocol =
    !isMultiTypeSelection &&
    usesProtocolNumber(certificateType, activeBiotDocumentKind);
  const singleSelectionUsesWitness =
    !isMultiTypeSelection &&
    certificateType === "PS" &&
    usesPsWitness(activeBiotDocumentKind, psIncludeWitness);
  const singleSelectionCertificateNumberLabel = getCertificateNumberLabel(
    certificateType,
    activeBiotDocumentKind,
  );
  const requestSpreadsheetInputClass =
    "block h-10 w-full border-0 bg-transparent px-3.5 text-sm text-[var(--ink)] outline-none placeholder:text-slate-400 focus:bg-white";
  const requestSpreadsheetFileClass =
    "block w-full border-0 bg-transparent px-3.5 py-2 text-xs text-[var(--muted)] outline-none file:mr-2 file:rounded-md file:border-0 file:bg-slate-100 file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-slate-700";
  const translateActionButtonClass =
    "inline-flex h-8 shrink-0 items-center rounded-md border border-[var(--line)] bg-[var(--surface)] px-2.5 text-[11px] font-medium text-[var(--ink)] transition-colors duration-150 hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-60";
  const tablePasteColumns: BulkPasteColumn[] = [
    { key: "fullName", label: "ФИО" },
    { key: "positionRu", label: roleFieldPlaceholderRu },
    { key: "positionKz", label: roleFieldPlaceholderKz },
    {
      key: "certificateNumber",
      label: singleSelectionCertificateNumberLabel,
    },
    {
      key: "protocolNumber",
      label: getProtocolNumberLabel(certificateType, activeBiotDocumentKind),
    },
    { key: "witnessCertificateNumber", label: "Номер КБ" },
    {
      key: "witnessRegistrationNumber",
      label: "Регистрационный номер",
    },
  ];
  const generationModeLabel = "Отдельная заявка";
  const summaryContextLabel = usesRequestCompanyForSelection
    ? requestWorkplaceRu || requestWorkplaceKz || "Компания не указана"
    : "Компания не требуется";
  const summaryContextHint = usesRequestCompanyForSelection
    ? requestWorkplaceKz && requestWorkplaceRu !== requestWorkplaceKz
      ? requestWorkplaceKz
      : "Общие данные будут подставлены всем участникам."
    : "Заполняются только участники и номера документов.";
  const workspaceSurfaceClass =
    "overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]";
  const denseInfoClass =
    "rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3 text-sm leading-6 text-[var(--muted)]";
  const tableSectionHeaderText = "Состав заявки";
  const activeEditorRow = activeCellEditor
    ? (rows.find((row) => row.id === activeCellEditor.rowId) ?? null)
    : null;
  const activeSettingsRow = activeRowSettingsEditor
    ? (rows.find((row) => row.id === activeRowSettingsEditor) ?? null)
    : null;

  function getCurrentRowSettings(): RowDocumentSettings {
    return createRowDocumentSettings({
      selectedCertificateTypes,
      certificateType,
      biotDocumentKind,
      psDocumentKind,
      issueDate,
      seriesNumber,
      trainingSubjectMode,
      trainingSubjectPreset,
      trainingSubjectCustom,
      psIncludeCard,
      psIncludeProtocol,
      psIncludeWitness,
    });
  }

  function getRowSelectedTypes(row: RowDocumentSettings) {
    return normalizeSelectedCertificateTypes(
      row.selectedCertificateTypes,
      row.certificateType,
    );
  }

  function rowHasSingleDocumentType(row: RowDocumentSettings) {
    return getRowSelectedTypes(row).length === 1;
  }

  function getRowTypesLabel(row: RowDocumentSettings) {
    return getRowSelectedTypes(row)
      .map((type) =>
        getCertificateTypeLabel(type, getRowDocumentKindForType(row, type)),
      )
      .join(", ");
  }

  function rowUsesPhoto(row: RowDocumentSettings) {
    return getRowSelectedTypes(row).some((type) =>
      usesPhotoWithSelection(
        type,
        getRowDocumentKindForType(row, type),
        row.psIncludeCard,
      ),
    );
  }

  function rowUsesProtocol(row: RowDocumentSettings) {
    return getRowSelectedTypes(row).some((type) =>
      usesProtocolNumber(type, getRowDocumentKindForType(row, type)),
    );
  }

  function rowUsesTrainingSubject(row: RowDocumentSettings) {
    return getRowSelectedTypes(row).some((type) =>
      usesTrainingSubject(type, getRowDocumentKindForType(row, type)),
    );
  }

  function rowUsesSeriesNumber(row: RowDocumentSettings) {
    return getRowSelectedTypes(row).some((type) =>
      usesSeriesNumberWithSelection(
        type,
        getRowDocumentKindForType(row, type),
        row.psIncludeCard,
      ),
    );
  }

  function rowUsesRequestCompany(row: RowDocumentSettings) {
    return getRowSelectedTypes(row).some((type) =>
      usesRequestCompany(type, getRowDocumentKindForType(row, type)),
    );
  }

  function rowUsesPsWitness(row: RowDocumentSettings) {
    return (
      getRowSelectedTypes(row).includes("PS") &&
      row.psDocumentKind !== "ITR_CERTIFICATE" &&
      row.psIncludeWitness
    );
  }

  function getRowDocumentNumberState(
    row: GeneratorRow,
    type: SafetyCardType = row.certificateType,
    index = rows.findIndex((item) => item.id === row.id),
    typeDefaults: BiotCardDefaults = defaults,
  ): RowDocumentNumberSettings {
    const savedNumbers = row.documentNumbers[type];

    if (savedNumbers) {
      return {
        ...savedNumbers,
        issueDate: savedNumbers.issueDate || row.issueDate,
        trainingSubjectMode:
          savedNumbers.trainingSubjectMode || row.trainingSubjectMode,
        trainingSubjectPreset:
          savedNumbers.trainingSubjectPreset || row.trainingSubjectPreset,
        trainingSubjectCustom:
          savedNumbers.trainingSubjectCustom ?? row.trainingSubjectCustom,
      };
    }

    if (type === row.certificateType) {
      return {
        issueDate: row.issueDate,
        trainingSubjectMode: row.trainingSubjectMode,
        trainingSubjectPreset: row.trainingSubjectPreset,
        trainingSubjectCustom: row.trainingSubjectCustom,
        certificateNumber: row.certificateNumber,
        protocolNumber: row.protocolNumber,
        witnessCertificateNumber: row.witnessCertificateNumber,
        witnessRegistrationNumber: row.witnessRegistrationNumber,
        isCertificateManual: row.isCertificateManual,
        isProtocolManual: row.isProtocolManual,
        isWitnessCertificateManual: row.isWitnessCertificateManual,
        isWitnessRegistrationManual: row.isWitnessRegistrationManual,
      };
    }

    return createEmptyDocumentNumberSettings(
      type,
      getRowDocumentKindForType(row, type),
      row.issueDate,
      Math.max(index, 0),
      typeDefaults,
      type === "PS" &&
        row.psDocumentKind !== "ITR_CERTIFICATE" &&
        row.psIncludeWitness,
      {
        trainingSubjectMode: row.trainingSubjectMode,
        trainingSubjectPreset: typeDefaults.defaultTrainingSubject,
        trainingSubjectCustom:
          row.trainingSubjectMode === "custom" ? row.trainingSubjectCustom : "",
      },
    );
  }

  function getRowTypeIssueDate(
    row: GeneratorRow,
    type: SafetyCardType,
    index = rows.findIndex((item) => item.id === row.id),
    typeDefaults: BiotCardDefaults = defaults,
  ) {
    return (
      getRowDocumentNumberState(row, type, index, typeDefaults).issueDate ||
      row.issueDate
    );
  }

  function getRowTypeTrainingSubject(
    row: GeneratorRow,
    type: SafetyCardType,
    index = rows.findIndex((item) => item.id === row.id),
    typeDefaults: BiotCardDefaults = defaults,
  ) {
    const numbers = getRowDocumentNumberState(row, type, index, typeDefaults);

    if (numbers.trainingSubjectMode === "custom") {
      return numbers.trainingSubjectCustom.trim();
    }

    return typeDefaults.trainingSubjectPresets.includes(
      numbers.trainingSubjectPreset,
    )
      ? numbers.trainingSubjectPreset
      : typeDefaults.defaultTrainingSubject;
  }

  function withUpdatedRowDocumentNumberState(
    row: GeneratorRow,
    type: SafetyCardType,
    index: number,
    updater: (current: RowDocumentNumberSettings) => RowDocumentNumberSettings,
  ): GeneratorRow {
    const nextNumbers = updater(getRowDocumentNumberState(row, type, index));
    const nextDocumentNumbers = {
      ...row.documentNumbers,
      [type]: nextNumbers,
    };

    if (type !== row.certificateType) {
      return {
        ...row,
        documentNumbers: nextDocumentNumbers,
      };
    }

    return {
      ...row,
      issueDate: nextNumbers.issueDate,
      trainingSubjectMode: nextNumbers.trainingSubjectMode,
      trainingSubjectPreset: nextNumbers.trainingSubjectPreset,
      trainingSubjectCustom: nextNumbers.trainingSubjectCustom,
      certificateNumber: nextNumbers.certificateNumber,
      protocolNumber: nextNumbers.protocolNumber,
      witnessCertificateNumber: nextNumbers.witnessCertificateNumber,
      witnessRegistrationNumber: nextNumbers.witnessRegistrationNumber,
      isCertificateManual: nextNumbers.isCertificateManual,
      isProtocolManual: nextNumbers.isProtocolManual,
      isWitnessCertificateManual: nextNumbers.isWitnessCertificateManual,
      isWitnessRegistrationManual: nextNumbers.isWitnessRegistrationManual,
      documentNumbers: nextDocumentNumbers,
    };
  }

  function applyRowAutoNumbers(
    row: GeneratorRow,
    index: number,
    typeDefaults: BiotCardDefaults = defaults,
  ): GeneratorRow {
    const normalizedTypes = getRowSelectedTypes(row);
    const primaryType = getPrimaryCertificateType(
      normalizedTypes,
      row.certificateType,
    );
    const baseRow = {
      ...row,
      selectedCertificateTypes: normalizedTypes,
      certificateType: primaryType,
    };
    const primaryKind = getRowDocumentKindForType(baseRow, primaryType);
    const primaryNumbers = getRowDocumentNumberState(
      baseRow,
      primaryType,
      index,
      typeDefaults,
    );
    const nextPrimaryNumbers = createEmptyDocumentNumberSettings(
      primaryType,
      primaryKind,
      baseRow.issueDate,
      index,
      typeDefaults,
      primaryType === "PS" &&
        baseRow.psDocumentKind !== "ITR_CERTIFICATE" &&
        baseRow.psIncludeWitness,
      primaryNumbers,
    );
    const mergedPrimaryNumbers: RowDocumentNumberSettings = {
      issueDate: baseRow.issueDate,
      trainingSubjectMode: primaryNumbers.trainingSubjectMode,
      trainingSubjectPreset: primaryNumbers.trainingSubjectPreset,
      trainingSubjectCustom: primaryNumbers.trainingSubjectCustom,
      certificateNumber: primaryNumbers.isCertificateManual
        ? primaryNumbers.certificateNumber
        : nextPrimaryNumbers.certificateNumber,
      protocolNumber: primaryNumbers.isProtocolManual
        ? primaryNumbers.protocolNumber
        : nextPrimaryNumbers.protocolNumber,
      witnessCertificateNumber:
        primaryType === "PS" &&
        baseRow.psDocumentKind !== "ITR_CERTIFICATE" &&
        baseRow.psIncludeWitness
          ? primaryNumbers.isWitnessCertificateManual
            ? primaryNumbers.witnessCertificateNumber
            : nextPrimaryNumbers.witnessCertificateNumber
          : "",
      witnessRegistrationNumber:
        primaryType === "PS" &&
        baseRow.psDocumentKind !== "ITR_CERTIFICATE" &&
        baseRow.psIncludeWitness
          ? primaryNumbers.isWitnessRegistrationManual
            ? primaryNumbers.witnessRegistrationNumber
            : nextPrimaryNumbers.witnessRegistrationNumber
          : "",
      isCertificateManual: primaryNumbers.isCertificateManual,
      isProtocolManual: primaryNumbers.isProtocolManual,
      isWitnessCertificateManual: primaryNumbers.isWitnessCertificateManual,
      isWitnessRegistrationManual: primaryNumbers.isWitnessRegistrationManual,
    };

    return {
      ...baseRow,
      certificateNumber: mergedPrimaryNumbers.certificateNumber,
      protocolNumber: mergedPrimaryNumbers.protocolNumber,
      witnessCertificateNumber: mergedPrimaryNumbers.witnessCertificateNumber,
      witnessRegistrationNumber: mergedPrimaryNumbers.witnessRegistrationNumber,
      isCertificateManual: mergedPrimaryNumbers.isCertificateManual,
      isProtocolManual: mergedPrimaryNumbers.isProtocolManual,
      isWitnessCertificateManual:
        mergedPrimaryNumbers.isWitnessCertificateManual,
      isWitnessRegistrationManual:
        mergedPrimaryNumbers.isWitnessRegistrationManual,
      documentNumbers: {
        ...baseRow.documentNumbers,
        [primaryType]: mergedPrimaryNumbers,
      },
    };
  }

  function updateRowDocumentSettings(
    rowId: string,
    updater: (row: GeneratorRow) => GeneratorRow,
  ) {
    setRows((current) =>
      current.map((row, index) =>
        row.id === rowId ? applyRowAutoNumbers(updater(row), index) : row,
      ),
    );
  }

  function getCachedDefaultsForType(
    type: SafetyCardType,
    typeIssueDate: string,
    typeDocumentKind: BiotDocumentKind,
  ) {
    return (
      typeDefaultsCache[
        getDefaultsCacheKey(type, typeDocumentKind, typeIssueDate)
      ] ?? defaults
    );
  }

  function primeRowTypeDefaults(row: GeneratorRow) {
    const rowIndex = rows.findIndex((item) => item.id === row.id);

    getRowSelectedTypes(row).forEach((type) => {
      const typeDocumentKind = getRowDocumentKindForType(row, type);
      const typeIssueDate = getRowTypeIssueDate(
        row,
        type,
        rowIndex,
        getCachedDefaultsForType(type, row.issueDate, typeDocumentKind),
      );
      const cacheKey = getDefaultsCacheKey(
        type,
        typeDocumentKind,
        typeIssueDate,
      );

      if (typeDefaultsCache[cacheKey]) {
        return;
      }

      void fetchDefaultsForType(type, typeIssueDate, typeDocumentKind).catch(
        () => undefined,
      );
    });
  }

  function openRowSettings(rowId: string) {
    const row = rows.find((item) => item.id === rowId);
    if (row) {
      primeRowTypeDefaults(row);
    }

    setActiveRowSettingsEditor(rowId);
  }

  function updateRowIssueDate(rowId: string, value: string) {
    updateRowDocumentSettings(rowId, (row) => ({
      ...row,
      issueDate: value,
    }));
    setErrorMessage(null);
    setSuccessMessage(null);
  }

  const tableUsesPhoto = rows.some((row) => rowUsesPhoto(row));
  const tableUsesProtocol = rows.some((row) => rowUsesProtocol(row));
  const tableUsesWitness = rows.some((row) => rowUsesPsWitness(row));
  function resetRows(nextType: SafetyCardType = certificateType) {
    const nextDocumentKind = getDocumentKindForType(
      nextType,
      biotDocumentKind,
      psDocumentKind,
    );
    const nextRowSettings =
      nextType === certificateType
        ? getCurrentRowSettings()
        : createRowDocumentSettings({
            selectedCertificateTypes: [nextType],
            certificateType: nextType,
            biotDocumentKind,
            psDocumentKind,
            issueDate,
            seriesNumber,
            trainingSubjectMode,
            trainingSubjectPreset,
            trainingSubjectCustom,
            psIncludeCard,
            psIncludeProtocol,
            psIncludeWitness,
          });
    setRows([
      createEmptyRow(
        nextType,
        nextDocumentKind,
        nextType === "PS" ? psIncludeWitness : false,
        0,
        issueDate,
        defaults,
        null,
        nextRowSettings,
      ),
    ]);
    setTranslatingRowIds({});
    setRowTranslationErrors({});
  }

  async function fetchDefaultsForType(
    nextType: SafetyCardType,
    nextIssueDate: string,
    nextBiotDocumentKind: BiotDocumentKind = getDocumentKindForType(
      nextType,
      biotDocumentKind,
      psDocumentKind,
    ),
  ) {
    const params = new URLSearchParams({
      certificateType: nextType,
      issueDate: nextIssueDate,
    });

    if (nextType === "BIOT" || nextType === "PS") {
      params.set("biotDocumentKind", nextBiotDocumentKind);
    }

    if (companyId) {
      params.set("companyId", companyId);
    }

    const response = await fetch(
      `/api/biot-cards/defaults?${params.toString()}`,
      {
        cache: "no-store",
      },
    );

    if (!response.ok) {
      throw new Error(
        await readResponseError(
          response,
          "Не удалось обновить шаблонные значения.",
        ),
      );
    }

    const nextDefaults = (await response.json()) as BiotCardDefaults;
    setTypeDefaultsCache((current) => ({
      ...current,
      [getDefaultsCacheKey(nextType, nextBiotDocumentKind, nextIssueDate)]:
        nextDefaults,
    }));

    return nextDefaults;
  }

  async function loadRequests() {
    const params = new URLSearchParams();

    if (companyId) {
      params.set("companyId", companyId);
    }

    const response = await fetch(
      `/api/biot-cards/requests?${params.toString()}`,
      {
        cache: "no-store",
      },
    );

    if (!response.ok) {
      throw new Error(
        await readResponseError(response, "Не удалось обновить список заявок."),
      );
    }

    const nextRequests =
      (await response.json()) as CardGenerationRequestSummary[];
    setSavedRequests(nextRequests);
    return nextRequests;
  }

  function clearRowTranslationError(rowId: string) {
    setRowTranslationErrors((current) => {
      if (!(rowId in current)) {
        return current;
      }

      const next = { ...current };
      delete next[rowId];
      return next;
    });
  }

  function setRowTranslating(rowId: string, isTranslating: boolean) {
    setTranslatingRowIds((current) => {
      if (isTranslating) {
        return {
          ...current,
          [rowId]: true,
        };
      }

      if (!(rowId in current)) {
        return current;
      }

      const next = { ...current };
      delete next[rowId];
      return next;
    });
  }

  async function handleTranslatePosition(rowId: string, positionRu: string) {
    const trimmedValue = positionRu.trim();

    if (!trimmedValue || translatingRowIds[rowId]) {
      return;
    }

    setRowTranslating(rowId, true);
    clearRowTranslationError(rowId);

    try {
      const translatedText =
        await requestKazakhJobTitleTranslation(trimmedValue);
      updateRow(rowId, (current) => ({
        ...current,
        positionKz: translatedText,
      }));
    } catch (error) {
      setRowTranslationErrors((current) => ({
        ...current,
        [rowId]:
          error instanceof Error
            ? error.message
            : "Не удалось перевести должность на казахский.",
      }));
    } finally {
      setRowTranslating(rowId, false);
    }
  }

  async function handleDeleteRequest(requestId: string, title: string) {
    if (!canManageSavedRequests || deletingRequestId) {
      return;
    }

    const confirmed = window.confirm(
      `Удалить сохранённую заявку «${title}»? Это очистит её из списка и уберёт лишний тестовый мусор.`,
    );

    if (!confirmed) {
      return;
    }

    setDeletingRequestId(requestId);

    try {
      const params = new URLSearchParams();

      if (companyId) {
        params.set("companyId", companyId);
      }

      const response = await fetch(
        `/api/biot-cards/requests/${requestId}${params.toString() ? `?${params.toString()}` : ""}`,
        {
          method: "DELETE",
          cache: "no-store",
        },
      );

      if (!response.ok) {
        throw new Error(
          await readResponseError(
            response,
            "Не удалось удалить сохранённую заявку.",
          ),
        );
      }

      setSavedRequests((current) =>
        current.filter((request) => request.id !== requestId),
      );
      setSuccessMessage("Сохранённая заявка удалена.");
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Не удалось удалить сохранённую заявку.",
      );
    } finally {
      setDeletingRequestId(null);
    }
  }

  async function refreshDefaults(nextIssueDate: string, showSuccess = false) {
    setIsRefreshingDefaults(true);

    try {
      const nextDefaults = await fetchDefaultsForType(
        certificateType,
        nextIssueDate,
        activeBiotDocumentKind,
      );

      setDefaults(nextDefaults);
      setRows((current) => {
        if (current.length > 0) {
          return current;
        }

        const nextRowSettings = createRowDocumentSettings({
          selectedCertificateTypes,
          certificateType,
          biotDocumentKind,
          psDocumentKind,
          issueDate: nextIssueDate,
          seriesNumber,
          trainingSubjectMode,
          trainingSubjectPreset:
            trainingSubjectMode === "preset" &&
            nextDefaults.trainingSubjectPresets.includes(trainingSubjectPreset)
              ? trainingSubjectPreset
              : nextDefaults.defaultTrainingSubject,
          trainingSubjectCustom,
          psIncludeCard,
          psIncludeProtocol,
          psIncludeWitness,
        });

        return [
          createEmptyRow(
            certificateType,
            activeBiotDocumentKind,
            certificateType === "PS" ? psIncludeWitness : false,
            0,
            nextIssueDate,
            nextDefaults,
            null,
            nextRowSettings,
          ),
        ];
      });

      if (
        trainingSubjectMode === "preset" &&
        !nextDefaults.trainingSubjectPresets.includes(trainingSubjectPreset)
      ) {
        setTrainingSubjectPreset(nextDefaults.defaultTrainingSubject);
      }

      if (showSuccess) {
        setSuccessMessage("Автонумерация обновлена.");
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Не удалось обновить шаблонные значения.",
      );
    } finally {
      setIsRefreshingDefaults(false);
    }
  }

  useEffect(() => () => {
    importReadVersion.current += 1;
  }, []);

  useEffect(() => {
    setSuccessMessage(null);
    setErrorMessage(null);
    void refreshDefaults(issueDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    certificateType,
    biotDocumentKind,
    psDocumentKind,
    psIncludeWitness,
    companyId,
    issueDate,
  ]);

  useEffect(() => {
    if (!activeRowSettingsEditor) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setActiveRowSettingsEditor(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeRowSettingsEditor]);

  function updateRow(
    rowId: string,
    updater: (row: GeneratorRow) => GeneratorRow,
  ) {
    setRows((current) =>
      current.map((row) => (row.id === rowId ? updater(row) : row)),
    );
  }

  function getEditableCellValue(row: GeneratorRow, field: EditableCellKey) {
    if (field === "photo") {
      return row.photoFileName || row.photoDataUrl;
    }

    return row[field];
  }

  function getEditableCellLabel(field: EditableCellKey) {
    if (field === "fullName") {
      return "ФИО";
    }

    if (field === "positionRu") {
      return roleTableLabelRu;
    }

    if (field === "positionKz") {
      return roleTableLabelKz;
    }

    if (field === "certificateNumber") {
      return singleSelectionCertificateNumberLabel;
    }

    if (field === "protocolNumber") {
      return getProtocolNumberLabel(certificateType, activeBiotDocumentKind);
    }

    if (field === "witnessCertificateNumber") {
      return "Номер КБ";
    }

    if (field === "witnessRegistrationNumber") {
      return "Регистрационный номер";
    }

    return "Фото";
  }

  function getEditableCellPlaceholder(field: EditableCellKey) {
    if (field === "fullName") {
      return "ФИО";
    }

    if (field === "positionRu") {
      return roleFieldPlaceholderRu;
    }

    if (field === "positionKz") {
      return roleFieldPlaceholderKz;
    }

    if (field === "protocolNumber") {
      return isPsWitnessCertificate(certificateType, activeBiotDocumentKind)
        ? "Регистрационный номер"
        : "Протокол № / основание";
    }

    return getEditableCellLabel(field);
  }

  function updateCellEditorValue(
    rowId: string,
    field: EditableCellKey,
    value: string,
  ) {
    if (field === "photo") {
      return;
    }

    if (field === "positionRu" || field === "positionKz") {
      clearRowTranslationError(rowId);
    }

    if (
      field === "certificateNumber" ||
      field === "protocolNumber" ||
      field === "witnessCertificateNumber" ||
      field === "witnessRegistrationNumber"
    ) {
      setRows((current) =>
        current.map((row, index) => {
          if (row.id !== rowId) {
            return row;
          }

          return withUpdatedRowDocumentNumberState(
            row,
            row.certificateType,
            index,
            (numbers) => ({
              ...numbers,
              [field]: value,
              isCertificateManual:
                field === "certificateNumber"
                  ? true
                  : numbers.isCertificateManual,
              isProtocolManual:
                field === "protocolNumber" ? true : numbers.isProtocolManual,
              isWitnessCertificateManual:
                field === "witnessCertificateNumber"
                  ? true
                  : numbers.isWitnessCertificateManual,
              isWitnessRegistrationManual:
                field === "witnessRegistrationNumber"
                  ? true
                  : numbers.isWitnessRegistrationManual,
            }),
          );
        }),
      );
      return;
    }

    updateRow(rowId, (current) => {
      if (field === "fullName") {
        return {
          ...current,
          fullName: value,
          issuedTo:
            !current.issuedTo.trim() || current.issuedTo === current.fullName
              ? value
              : current.issuedTo,
        };
      }

      return {
        ...current,
        [field]: value,
      };
    });
  }

  function renderEditableCell(
    row: GeneratorRow,
    field: EditableCellKey,
    placeholder?: string,
  ) {
    const isNumberField =
      field === "certificateNumber" ||
      field === "protocolNumber" ||
      field === "witnessCertificateNumber" ||
      field === "witnessRegistrationNumber";
    const isSingleRowType = rowHasSingleDocumentType(row);
    const primaryDocumentKind = getRowDocumentKindForType(
      row,
      row.certificateType,
    );

    if (field === "photo" && !rowUsesPhoto(row)) {
      return (
        <span className="block min-h-10 w-full px-3.5 py-2.5 text-sm leading-5 text-slate-400">
          Не требуется
        </span>
      );
    }

    if (isNumberField && !isSingleRowType) {
      return (
        <button
          type="button"
          className="block min-h-10 w-full px-3.5 py-2.5 text-left text-sm leading-5 text-[var(--muted)] outline-none transition-colors duration-150 hover:bg-[var(--surface-muted)] focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]"
          onClick={() => openRowSettings(row.id)}
        >
          Авто по видам
        </button>
      );
    }

    if (
      field === "protocolNumber" &&
      !usesProtocolNumber(row.certificateType, primaryDocumentKind)
    ) {
      return (
        <span className="block min-h-10 w-full px-3.5 py-2.5 text-sm leading-5 text-slate-400">
          Не требуется
        </span>
      );
    }

    if (
      (field === "witnessCertificateNumber" ||
        field === "witnessRegistrationNumber") &&
      !rowUsesPsWitness(row)
    ) {
      return (
        <span className="block min-h-10 w-full px-3.5 py-2.5 text-sm leading-5 text-slate-400">
          Не требуется
        </span>
      );
    }

    const value = getEditableCellValue(row, field);
    const displayValue =
      field === "photo"
        ? row.photoFileName ||
          (row.isPhotoProcessing ? "Фото обрабатывается..." : "")
        : value.trim();
    const cellPlaceholder = placeholder ?? getEditableCellPlaceholder(field);

    if (field === "photo") {
      return (
        <div className="space-y-2 px-2 py-2">
          <PhotoUploadInput
            inputClassName={cn(requestSpreadsheetFileClass, "px-1 py-1")}
            pasteAreaClassName="rounded-md border border-dashed border-[var(--line)] bg-transparent px-2.5 py-2 text-xs leading-5 text-[var(--muted)] outline-none transition-colors duration-150 hover:bg-[var(--surface-muted)] focus:border-[var(--focus-border)] focus:ring-2 focus:ring-[var(--focus-ring)]"
            pasteHint={displayValue || cellPlaceholder}
            onFileSelected={(file) => handlePhotoPasteTarget(row.id, file)}
          />
          {row.photoFileName ? (
            <div className="flex items-center justify-between gap-2 rounded-md bg-[var(--surface-muted)] px-2.5 py-1.5 text-xs text-[var(--muted)]">
              <span className="truncate">{row.photoFileName}</span>
              <button
                type="button"
                className="shrink-0 font-medium text-[var(--ink)]"
                onClick={() =>
                  updateRow(row.id, (current) => ({
                    ...current,
                    photoDataUrl: "",
                    photoFileName: "",
                    isPhotoProcessing: false,
                  }))
                }
              >
                Очистить
              </button>
            </div>
          ) : null}
        </div>
      );
    }

    return (
      <div className="min-h-10" data-filled={displayValue ? "true" : "false"}>
        <Input
          className={requestSpreadsheetInputClass}
          value={value}
          aria-label={getEditableCellLabel(field)}
          placeholder={cellPlaceholder}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            updateCellEditorValue(row.id, field, event.target.value)
          }
          onPaste={(event) =>
            handleCellPaste(row.id, field as BulkPasteColumnKey, event)
          }
        />
        {field === "positionKz" ? (
          <div className="flex flex-wrap items-center gap-2 px-3.5 pb-2">
            <button
              type="button"
              className={translateActionButtonClass}
              disabled={
                !row.positionRu.trim() || Boolean(translatingRowIds[row.id])
              }
              onClick={() =>
                void handleTranslatePosition(row.id, row.positionRu)
              }
            >
              {translatingRowIds[row.id] ? "Перевод..." : "Перевести в KZ"}
            </button>
            {rowTranslationErrors[row.id] ? (
              <p className="text-xs text-rose-600">
                {rowTranslationErrors[row.id]}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  function renderRowSettingsModal() {
    if (!activeSettingsRow) {
      return null;
    }

    const settingsRow = activeSettingsRow;
    const rowIndex = rows.findIndex((row) => row.id === settingsRow.id);
    const selectedTypes = getRowSelectedTypes(settingsRow);
    const hasRowRoleSelection = selectedTypes.some((type) => type !== "PS");
    const hasRowPsSelection = selectedTypes.includes("PS");
    const rowTrainingSubjectTypes = selectedTypes.filter((type) =>
      usesTrainingSubject(type, getRowDocumentKindForType(settingsRow, type)),
    );
    const rowTrainingSubjectLabel =
      rowTrainingSubjectTypes.length === 1
        ? getTrainingSubjectLabel(rowTrainingSubjectTypes[0])
        : "Тема обучения";
    const isSingleRowType = rowHasSingleDocumentType(settingsRow);

    function updateActiveRowSettings(
      updater: (row: GeneratorRow) => GeneratorRow,
    ) {
      updateRowDocumentSettings(settingsRow.id, updater);
    }

    function updateActiveRowDocumentNumbers(
      type: SafetyCardType,
      updater: (
        current: RowDocumentNumberSettings,
      ) => RowDocumentNumberSettings,
    ) {
      setRows((current) =>
        current.map((row, index) =>
          row.id === settingsRow.id
            ? withUpdatedRowDocumentNumberState(row, type, index, updater)
            : row,
        ),
      );
    }

    function updateActiveRowTypeIssueDate(type: SafetyCardType, value: string) {
      setRows((current) =>
        current.map((row, index) => {
          if (row.id !== settingsRow.id) {
            return row;
          }

          return withUpdatedRowDocumentNumberState(
            row,
            type,
            index,
            (numbers) => {
              const typeDocumentKind = getRowDocumentKindForType(row, type);
              const nextAutoNumbers = createEmptyDocumentNumberSettings(
                type,
                typeDocumentKind,
                value,
                index,
                getCachedDefaultsForType(type, value, typeDocumentKind),
                type === "PS" &&
                  typeDocumentKind !== "ITR_CERTIFICATE" &&
                  row.psIncludeWitness,
                numbers,
              );

              return {
                ...numbers,
                issueDate: value,
                certificateNumber: numbers.isCertificateManual
                  ? numbers.certificateNumber
                  : nextAutoNumbers.certificateNumber,
                protocolNumber: numbers.isProtocolManual
                  ? numbers.protocolNumber
                  : nextAutoNumbers.protocolNumber,
                witnessCertificateNumber: numbers.isWitnessCertificateManual
                  ? numbers.witnessCertificateNumber
                  : nextAutoNumbers.witnessCertificateNumber,
                witnessRegistrationNumber: numbers.isWitnessRegistrationManual
                  ? numbers.witnessRegistrationNumber
                  : nextAutoNumbers.witnessRegistrationNumber,
              };
            },
          );
        }),
      );

      void fetchDefaultsForType(
        type,
        value,
        getRowDocumentKindForType(settingsRow, type),
      ).catch(() => undefined);
      setErrorMessage(null);
      setSuccessMessage(null);
    }

    function renderNumberInputs(type: SafetyCardType) {
      const typeDocumentKind = getRowDocumentKindForType(settingsRow, type);
      const fallbackNumbers = getRowDocumentNumberState(
        settingsRow,
        type,
        Math.max(rowIndex, 0),
      );
      const typeDefaults = getCachedDefaultsForType(
        type,
        fallbackNumbers.issueDate || settingsRow.issueDate,
        typeDocumentKind,
      );
      const numbers = getRowDocumentNumberState(
        settingsRow,
        type,
        Math.max(rowIndex, 0),
        typeDefaults,
      );
      const usesTypeProtocol = usesProtocolNumber(type, typeDocumentKind);
      const usesTypeTrainingSubject = usesTrainingSubject(
        type,
        typeDocumentKind,
      );
      const trainingSubjectPreset =
        typeDefaults.trainingSubjectPresets.includes(
          numbers.trainingSubjectPreset,
        )
          ? numbers.trainingSubjectPreset
          : typeDefaults.defaultTrainingSubject;
      const usesTypeWitness =
        type === "PS" &&
        typeDocumentKind !== "ITR_CERTIFICATE" &&
        settingsRow.psIncludeWitness;

      return (
        <div
          key={type}
          className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] px-3.5 py-3"
        >
          {!isSingleRowType ? (
            <p className="mb-3 text-sm font-semibold text-[var(--ink)]">
              {getCertificateTypeLabel(type, typeDocumentKind)}
            </p>
          ) : null}
          <div className="mb-3 grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium text-[var(--ink)]">
                Дата выдачи
              </label>
              <Input
                type="date"
                className="h-9"
                value={numbers.issueDate}
                disabled={isEditMode}
                onInput={(event) =>
                  updateActiveRowTypeIssueDate(type, event.currentTarget.value)
                }
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  updateActiveRowTypeIssueDate(type, event.target.value)
                }
              />
            </div>

            {usesTypeTrainingSubject ? (
              <div className="space-y-1">
                <label className="text-sm font-medium text-[var(--ink)]">
                  {getTrainingSubjectLabel(type)}
                </label>
                <Select
                  className="h-9"
                  value={
                    numbers.trainingSubjectMode === "custom"
                      ? CUSTOM_SUBJECT_VALUE
                      : trainingSubjectPreset
                  }
                  disabled={isEditMode}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    updateActiveRowDocumentNumbers(type, (current) =>
                      event.target.value === CUSTOM_SUBJECT_VALUE
                        ? {
                            ...current,
                            trainingSubjectMode: "custom",
                          }
                        : {
                            ...current,
                            trainingSubjectMode: "preset",
                            trainingSubjectPreset: event.target.value,
                          },
                    )
                  }
                >
                  {typeDefaults.trainingSubjectPresets.map((preset) => (
                    <option key={preset} value={preset}>
                      {preset}
                    </option>
                  ))}
                  <option value={CUSTOM_SUBJECT_VALUE}>Свое значение</option>
                </Select>
              </div>
            ) : null}

            {usesTypeTrainingSubject ? (
              <div className="space-y-1 md:col-span-2">
                <label className="text-sm font-medium text-[var(--ink)]">
                  Собственное значение
                </label>
                <Input
                  className={cn(
                    "h-9",
                    numbers.trainingSubjectMode !== "custom"
                      ? "bg-[var(--surface-muted)] text-[var(--muted)]"
                      : "",
                  )}
                  value={numbers.trainingSubjectCustom}
                  disabled={
                    isEditMode || numbers.trainingSubjectMode !== "custom"
                  }
                  placeholder={typeDefaults.defaultTrainingSubject}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    updateActiveRowDocumentNumbers(type, (current) => ({
                      ...current,
                      trainingSubjectCustom: event.target.value,
                    }))
                  }
                />
              </div>
            ) : null}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium text-[var(--ink)]">
                {getCertificateNumberLabel(type, typeDocumentKind)}
              </label>
              <Input
                className="h-9"
                value={numbers.certificateNumber}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  updateActiveRowDocumentNumbers(type, (current) => ({
                    ...current,
                    certificateNumber: event.target.value,
                    isCertificateManual: true,
                  }))
                }
              />
            </div>

            {usesTypeProtocol ? (
              <div className="space-y-1">
                <label className="text-sm font-medium text-[var(--ink)]">
                  {getProtocolNumberLabel(type, typeDocumentKind)}
                </label>
                <Input
                  className="h-9"
                  value={numbers.protocolNumber}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    updateActiveRowDocumentNumbers(type, (current) => ({
                      ...current,
                      protocolNumber: event.target.value,
                      isProtocolManual: true,
                    }))
                  }
                />
              </div>
            ) : null}

            {usesTypeWitness ? (
              <>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-[var(--ink)]">
                    Номер КБ
                  </label>
                  <Input
                    className="h-9"
                    value={numbers.witnessCertificateNumber}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      updateActiveRowDocumentNumbers(type, (current) => ({
                        ...current,
                        witnessCertificateNumber: event.target.value,
                        isWitnessCertificateManual: true,
                      }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-[var(--ink)]">
                    Регистрационный номер
                  </label>
                  <Input
                    className="h-9"
                    value={numbers.witnessRegistrationNumber}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      updateActiveRowDocumentNumbers(type, (current) => ({
                        ...current,
                        witnessRegistrationNumber: event.target.value,
                        isWitnessRegistrationManual: true,
                      }))
                    }
                  />
                </div>
              </>
            ) : null}
          </div>
        </div>
      );
    }

    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 py-6"
        role="presentation"
        onMouseDown={() => setActiveRowSettingsEditor(null)}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="biot-row-settings-title"
          className="max-h-[88vh] w-full max-w-4xl overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-2xl"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4">
            <div className="min-w-0">
              <h2
                id="biot-row-settings-title"
                className="text-base font-semibold text-[var(--ink)]"
              >
                Настройки строки
              </h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Строка {rowIndex + 1}
                {activeSettingsRow.fullName.trim()
                  ? `: ${activeSettingsRow.fullName.trim()}`
                  : ""}
              </p>
            </div>
            <button
              type="button"
              className="inline-flex size-8 items-center justify-center rounded-md border border-[var(--line)] text-lg leading-none text-[var(--muted)] transition-colors duration-150 hover:bg-[var(--surface-muted)]"
              onClick={() => setActiveRowSettingsEditor(null)}
              aria-label="Закрыть"
            >
              ×
            </button>
          </div>

          <div className="max-h-[calc(88vh-132px)] space-y-5 overflow-y-auto px-5 py-5">
            <section className="space-y-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-[var(--ink)]">
                    Шаблоны строки
                  </p>
                  <p className="text-[13px] leading-5 text-[var(--muted)]">
                    Эти настройки применяются только к выбранной строке.
                  </p>
                </div>
                {isEditMode ? (
                  <p className="text-xs text-amber-700">
                    В режиме редактирования тип заявки фиксирован.
                  </p>
                ) : null}
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {certificateTypeOrder.map((type) => {
                  const checked = selectedTypes.includes(type);

                  return (
                    <label
                      key={type}
                      className={cn(
                        "flex min-h-16 cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2.5 transition-colors",
                        checked
                          ? "border-[var(--surface-strong)] bg-[var(--surface-muted)]"
                          : "border-[var(--line)] bg-[var(--surface)] hover:bg-[var(--surface-muted)]",
                        isEditMode && "cursor-not-allowed opacity-60",
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-[var(--ink)]">
                          {certificateTypeLabels[type]}
                        </span>
                        <span className="block truncate text-xs text-[var(--muted)]">
                          {certificateTypeDescriptions[type]}
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        className="size-4 rounded border-slate-300 accent-[var(--accent)]"
                        checked={checked}
                        disabled={isEditMode}
                        onChange={() => {
                          const nextTypes = checked
                            ? selectedTypes.filter((item) => item !== type)
                            : [...selectedTypes, type];
                          const normalizedTypes =
                            normalizeSelectedCertificateTypes(nextTypes, type);
                          const nextPrimaryType = getPrimaryCertificateType(
                            normalizedTypes,
                            activeSettingsRow.certificateType,
                          );

                          updateActiveRowSettings((row) => ({
                            ...row,
                            selectedCertificateTypes: normalizedTypes,
                            certificateType: nextPrimaryType,
                          }));

                          if (!checked) {
                            void fetchDefaultsForType(
                              type,
                              activeSettingsRow.issueDate,
                              getRowDocumentKindForType(
                                activeSettingsRow,
                                type,
                              ),
                            ).catch(() => undefined);
                          }
                        }}
                      />
                    </label>
                  );
                })}
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-1">
                <label className="text-sm font-medium text-[var(--ink)]">
                  Дата выдачи
                </label>
                <Input
                  type="date"
                  className="h-9"
                  value={activeSettingsRow.issueDate}
                  disabled={isEditMode}
                  onInput={(event) =>
                    updateRowIssueDate(
                      activeSettingsRow.id,
                      event.currentTarget.value,
                    )
                  }
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    updateRowIssueDate(activeSettingsRow.id, event.target.value)
                  }
                />
              </div>

              {rowUsesSeriesNumber(activeSettingsRow) ? (
                <div className="space-y-1">
                  <label className="text-sm font-medium text-[var(--ink)]">
                    Серия
                  </label>
                  <Input
                    className="h-9"
                    value={activeSettingsRow.seriesNumber}
                    disabled={isEditMode}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      updateActiveRowSettings((row) => ({
                        ...row,
                        seriesNumber: event.target.value,
                      }))
                    }
                  />
                </div>
              ) : null}
            </section>

            {hasRowRoleSelection ? (
              <section className="space-y-2">
                <p className="text-sm font-semibold text-[var(--ink)]">
                  Категория удостоверения
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(
                    ["WORKER_CARD", "ITR_CERTIFICATE"] as BiotDocumentKind[]
                  ).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      disabled={isEditMode}
                      className={cn(
                        "rounded-lg border px-3.5 py-3 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60",
                        activeSettingsRow.biotDocumentKind === kind
                          ? "border-[var(--surface-strong)] bg-[var(--surface-strong)] text-white"
                          : "border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--surface-muted)]",
                      )}
                      onClick={() =>
                        updateActiveRowSettings((row) => ({
                          ...row,
                          biotDocumentKind: kind,
                        }))
                      }
                    >
                      <span className="block text-sm font-semibold">
                        {getDocumentCategoryLabel(kind)}
                      </span>
                      <span className="mt-1 block text-xs opacity-80">
                        Срок действия {formatValidityLabel(kind)}.
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {hasRowPsSelection ? (
              <section className="space-y-3">
                <p className="text-sm font-semibold text-[var(--ink)]">
                  ПС-комплект
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(
                    ["WORKER_CARD", "ITR_CERTIFICATE"] as BiotDocumentKind[]
                  ).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      disabled={isEditMode}
                      className={cn(
                        "rounded-lg border px-3.5 py-3 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60",
                        activeSettingsRow.psDocumentKind === kind
                          ? "border-[var(--surface-strong)] bg-[var(--surface-strong)] text-white"
                          : "border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--surface-muted)]",
                      )}
                      onClick={() =>
                        updateActiveRowSettings((row) => ({
                          ...row,
                          psDocumentKind: kind,
                        }))
                      }
                    >
                      <span className="block text-sm font-semibold">
                        {kind === "ITR_CERTIFICATE"
                          ? "Свидетельство"
                          : "Корочка / протокол / свидетельство"}
                      </span>
                      <span className="mt-1 block text-xs opacity-80">
                        {kind === "ITR_CERTIFICATE"
                          ? "Legacy-режим ПС без комплекта."
                          : "Можно выбрать нужные документы комплекта."}
                      </span>
                    </button>
                  ))}
                </div>

                {activeSettingsRow.psDocumentKind !== "ITR_CERTIFICATE" ? (
                  <div className="grid gap-2 sm:grid-cols-3">
                    {[
                      ["psIncludeCard", "Корочка"],
                      ["psIncludeProtocol", "Протокол"],
                      ["psIncludeWitness", "Свидетельство"],
                    ].map(([key, label]) => (
                      <label
                        key={key}
                        className="flex items-center justify-between rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2.5 text-sm font-medium text-[var(--ink)]"
                      >
                        <span>{label}</span>
                        <input
                          type="checkbox"
                          className="size-4 rounded border-slate-300 accent-[var(--accent)]"
                          checked={Boolean(
                            activeSettingsRow[
                              key as
                                | "psIncludeCard"
                                | "psIncludeProtocol"
                                | "psIncludeWitness"
                            ],
                          )}
                          disabled={isEditMode}
                          onChange={(event) =>
                            updateActiveRowSettings((row) => ({
                              ...row,
                              [key]: event.target.checked,
                            }))
                          }
                        />
                      </label>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}

            {rowUsesTrainingSubject(activeSettingsRow) ? (
              <section className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-[var(--ink)]">
                    {rowTrainingSubjectLabel}
                  </label>
                  <Select
                    className="h-9"
                    value={
                      activeSettingsRow.trainingSubjectMode === "custom"
                        ? CUSTOM_SUBJECT_VALUE
                        : activeSettingsRow.trainingSubjectPreset
                    }
                    disabled={isEditMode}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                      updateActiveRowSettings((row) =>
                        event.target.value === CUSTOM_SUBJECT_VALUE
                          ? {
                              ...row,
                              trainingSubjectMode: "custom",
                            }
                          : {
                              ...row,
                              trainingSubjectMode: "preset",
                              trainingSubjectPreset: event.target.value,
                            },
                      )
                    }
                  >
                    {defaults.trainingSubjectPresets.map((preset) => (
                      <option key={preset} value={preset}>
                        {preset}
                      </option>
                    ))}
                    <option value={CUSTOM_SUBJECT_VALUE}>Свое значение</option>
                  </Select>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium text-[var(--ink)]">
                    Собственное значение
                  </label>
                  <Input
                    className={cn(
                      "h-9",
                      activeSettingsRow.trainingSubjectMode !== "custom"
                        ? "bg-[var(--surface-muted)] text-[var(--muted)]"
                        : "",
                    )}
                    value={activeSettingsRow.trainingSubjectCustom}
                    disabled={
                      isEditMode ||
                      activeSettingsRow.trainingSubjectMode !== "custom"
                    }
                    placeholder={defaults.defaultTrainingSubject}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      updateActiveRowSettings((row) => ({
                        ...row,
                        trainingSubjectCustom: event.target.value,
                      }))
                    }
                  />
                </div>
              </section>
            ) : null}

            <section className="space-y-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-[var(--ink)]">
                    Номера документов
                  </p>
                  <p className="text-[13px] leading-5 text-[var(--muted)]">
                    {isSingleRowType
                      ? "Эти значения также доступны напрямую в таблице."
                      : "Для строки с несколькими видами номера задаются по каждому документу."}
                  </p>
                </div>
              </div>
              <div className="space-y-3">
                {selectedTypes.map((type) => renderNumberInputs(type))}
              </div>
            </section>
          </div>

          <div className="flex justify-end border-t border-[var(--line)] px-5 py-4">
            <Button
              type="button"
              size="sm"
              onClick={() => setActiveRowSettingsEditor(null)}
            >
              Готово
            </Button>
          </div>
        </div>
      </div>
    );
  }

  function renderAdditionalSettings() {
    return (
      <details className="rounded-lg border border-[var(--line)] bg-[var(--surface)]">
        <summary className="flex cursor-pointer list-none flex-col gap-1 px-4 py-3 text-sm font-medium text-[var(--ink)] sm:flex-row sm:items-center sm:justify-between [&::-webkit-details-marker]:hidden">
          <span>Дополнительные параметры</span>
          <span className="text-xs font-normal text-[var(--muted)]">
            {selectedTypesLabel || "Шаблон не выбран"} ·{" "}
            {formatHumanDate(issueDate)}
          </span>
        </summary>
        <div className="space-y-4 border-t border-[var(--line)] px-4 py-4">
          <div className="flex flex-wrap justify-end gap-2">
            {!isEditMode ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={handleStartNewRequest}
              >
                Очистить заявку
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => refreshDefaults(issueDate, true)}
              disabled={isRefreshingDefaults}
            >
              {isRefreshingDefaults ? "Обновление..." : "Обновить номера"}
            </Button>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-[var(--ink)]">
              Шаблоны удостоверений
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {certificateTypeOrder.map((type) => {
                const checked = selectedCertificateTypes.includes(type);

                return (
                  <label
                    key={type}
                    className={cn(
                      "flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2.5 transition-colors",
                      checked
                        ? "border-[var(--surface-strong)] bg-[var(--surface-muted)]"
                        : "border-[var(--line)] bg-[var(--surface)] hover:bg-[var(--surface-muted)]",
                      isEditMode && "cursor-not-allowed opacity-60",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-[var(--ink)]">
                        {certificateTypeLabels[type]}
                      </span>
                      <span className="block truncate text-xs text-[var(--muted)]">
                        {certificateTypeDescriptions[type]}
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      className="size-4 rounded border-slate-300 accent-[var(--accent)]"
                      checked={checked}
                      disabled={isEditMode}
                      onChange={() => handleTypeToggle(type)}
                    />
                  </label>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--ink)]">
                Дата выдачи
              </label>
              <Input
                type="date"
                className="h-9"
                value={issueDate}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setIssueDate(event.target.value)
                }
                required
              />
            </div>

            {hasRoleSelection ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-[var(--ink)]">
                  Категория удостоверения
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setBiotDocumentKind("WORKER_CARD")}
                    disabled={isEditMode}
                    className={cn(
                      "rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                      biotDocumentKind === "WORKER_CARD"
                        ? "border-[var(--surface-strong)] bg-[var(--surface-strong)] text-white"
                        : "border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--surface-muted)]",
                      isEditMode && "cursor-not-allowed opacity-60",
                    )}
                  >
                    Рабочий
                  </button>
                  <button
                    type="button"
                    onClick={() => setBiotDocumentKind("ITR_CERTIFICATE")}
                    disabled={isEditMode}
                    className={cn(
                      "rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                      biotDocumentKind === "ITR_CERTIFICATE"
                        ? "border-[var(--surface-strong)] bg-[var(--surface-strong)] text-white"
                        : "border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--surface-muted)]",
                      isEditMode && "cursor-not-allowed opacity-60",
                    )}
                  >
                    ИТР
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {hasPsSelection ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-[var(--ink)]">
                Документы ПС
              </p>
              {psDocumentKind === "ITR_CERTIFICATE" ? (
                <div className={denseInfoClass}>
                  Открыта legacy-заявка ПС Свидетельство.
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-3">
                  <label className="flex items-center justify-between rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2.5 text-sm font-medium text-[var(--ink)]">
                    <span>Корочка</span>
                    <input
                      type="checkbox"
                      className="size-4 rounded border-slate-300 accent-[var(--accent)]"
                      checked={psIncludeCard}
                      onChange={(event) =>
                        setPsIncludeCard(event.target.checked)
                      }
                    />
                  </label>
                  <label className="flex items-center justify-between rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2.5 text-sm font-medium text-[var(--ink)]">
                    <span>Протокол</span>
                    <input
                      type="checkbox"
                      className="size-4 rounded border-slate-300 accent-[var(--accent)]"
                      checked={psIncludeProtocol}
                      onChange={(event) =>
                        setPsIncludeProtocol(event.target.checked)
                      }
                    />
                  </label>
                  <label className="flex items-center justify-between rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2.5 text-sm font-medium text-[var(--ink)]">
                    <span>Свидетельство</span>
                    <input
                      type="checkbox"
                      className="size-4 rounded border-slate-300 accent-[var(--accent)]"
                      checked={psIncludeWitness}
                      onChange={(event) =>
                        setPsIncludeWitness(event.target.checked)
                      }
                    />
                  </label>
                </div>
              )}
            </div>
          ) : null}

          {singleSelectionUsesTrainingSubject ? (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-sm font-medium text-[var(--ink)]">
                  {getTrainingSubjectLabel(certificateType)}
                </label>
                <Select
                  className="h-9"
                  value={
                    trainingSubjectMode === "custom"
                      ? CUSTOM_SUBJECT_VALUE
                      : trainingSubjectPreset
                  }
                  onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                    if (event.target.value === CUSTOM_SUBJECT_VALUE) {
                      setTrainingSubjectMode("custom");
                      return;
                    }

                    setTrainingSubjectMode("preset");
                    setTrainingSubjectPreset(event.target.value);
                  }}
                >
                  {defaults.trainingSubjectPresets.map((preset) => (
                    <option key={preset} value={preset}>
                      {preset}
                    </option>
                  ))}
                  <option value={CUSTOM_SUBJECT_VALUE}>Свое значение</option>
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium text-[var(--ink)]">
                  Собственное значение
                </label>
                <Input
                  className={cn(
                    "h-9",
                    trainingSubjectMode !== "custom"
                      ? "bg-[var(--surface-muted)] text-[var(--muted)]"
                      : "",
                  )}
                  value={trainingSubjectCustom}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setTrainingSubjectCustom(event.target.value)
                  }
                  placeholder={defaults.defaultTrainingSubject}
                  disabled={trainingSubjectMode !== "custom"}
                />
              </div>
            </div>
          ) : null}
        </div>
      </details>
    );
  }

  function handleTypeToggle(type: SafetyCardType) {
    if (isEditMode) {
      return;
    }

    const next = selectedCertificateTypes.includes(type)
      ? selectedCertificateTypes.filter((item) => item !== type)
      : [...selectedCertificateTypes, type].sort(
          (left, right) =>
            certificateTypeOrder.indexOf(left) -
            certificateTypeOrder.indexOf(right),
        );
    const normalized = next.length ? next : [type];
    const nextPrimary = normalized.includes(certificateType)
      ? certificateType
      : normalized[0];

    setSelectedCertificateTypes(normalized);
    if (nextPrimary !== certificateType) {
      setCertificateType(nextPrimary);
      setTrainingSubjectMode("preset");
      setTrainingSubjectCustom("");
    }
    setErrorMessage(null);
    setSuccessMessage(null);
  }

  function handleStartNewRequest() {
    if (isEditMode) {
      return;
    }

    setRequestCompanyBaseName("");
    setRequestCompanyLegalForm("TOO");
    setErrorMessage(null);
    setSuccessMessage(null);
    resetRows();
  }

  function handleAddRow() {
    const rowSettings = getCurrentRowSettings();

    setRows((current) => [
      ...current,
      createEmptyRow(
        certificateType,
        activeBiotDocumentKind,
        certificateType === "PS" ? psIncludeWitness : false,
        current.length,
        issueDate,
        defaults,
        null,
        rowSettings,
      ),
    ]);
  }

  function setImportPhoto(rowNumber: number, photo: ImportPhoto | null) {
    const next = { ...importPhotosRef.current };
    if (photo) next[rowNumber] = photo;
    else delete next[rowNumber];
    importPhotosRef.current = next;
    setImportPhotos(next);
  }

  function queueImportPhoto(rowNumber: number, file: File, source: ImportPhoto["source"]) {
    if (importApplied.current) return;
    const workbookVersion = importReadVersion.current;
    const photoVersion = (importPhotoVersions.current[rowNumber] ?? 0) + 1;
    importPhotoVersions.current[rowNumber] = photoVersion;
    const isCurrent = () => workbookVersion === importReadVersion.current &&
      importPhotoVersions.current[rowNumber] === photoVersion;

    if ((file.type && !["image/jpeg", "image/png"].includes(file.type.toLowerCase())) || !file.size || file.size > MAX_SOURCE_PHOTO_SIZE_BYTES) {
      setImportPhoto(rowNumber, { status: "error", source, message: "Выберите непустой JPG или PNG размером не более 10 МБ." });
      return;
    }
    setImportPhoto(rowNumber, { status: "processing", source });
    // Decode one image at a time to limit peak memory use for large workbooks.
    importPhotoQueue.current = importPhotoQueue.current.then(async () => {
      if (!isCurrent()) return;
      try {
        const photo = validateBiotPhoto(new Uint8Array(await file.arrayBuffer()), file.name);
        if (file.type && photo.mimeType !== file.type.toLowerCase()) {
          throw new Error("Неверный формат изображения.");
        }
        if (!isCurrent()) return;
        const imageFile = file.type ? file : new File([file], file.name, { type: photo.mimeType });
        const dataUrl = await preparePhotoDataUrl(imageFile);
        if (isCurrent()) setImportPhoto(rowNumber, { status: "ready", source, dataUrl, fileName: toJpegFileName(file.name) });
      } catch {
        if (isCurrent()) setImportPhoto(rowNumber, { status: "error", source, message: "Не удалось обработать фото. Выберите корректный JPG или PNG размером до 12 000 пикселей на сторону и до 40 миллионов пикселей." });
      }
    });
  }

  function clearImportPhoto(rowNumber: number) {
    if (importApplied.current) return;
    importPhotoVersions.current[rowNumber] = (importPhotoVersions.current[rowNumber] ?? 0) + 1;
    setImportPhoto(rowNumber, null);
  }

  async function handleWorkbookSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const version = ++importReadVersion.current;
    importApplied.current = false;
    importPhotoVersions.current = {};
    importPhotosRef.current = {};
    setImportPhotos({});
    setIsImportApplied(false);
    setImportPreview(null);
    setImportError(null);
    setIsReadingImport(true);
    try {
      const result = await readBiotWorkbook(file);
      if (version === importReadVersion.current) {
        // Keep compressed previews, not the original image bytes, after decoding.
        setImportPreview({ ...result, rows: result.rows.map((row) => ({ ...row, photo: null })) });
        for (const row of result.rows) {
          if (!row.photo) continue;
          const bytes = new Uint8Array(row.photo.bytes);
          const extension = row.photo.mimeType === "image/png" ? "png" : "jpg";
          queueImportPhoto(row.rowNumber, new File([bytes.buffer], `photo-row-${row.rowNumber}.${extension}`, { type: row.photo.mimeType }), "excel");
        }
      }
    } catch (error) {
      if (version === importReadVersion.current) {
        setImportError(error instanceof Error ? error.message : "Не удалось прочитать файл Excel.");
      }
    } finally {
      if (version === importReadVersion.current) setIsReadingImport(false);
    }
  }

  function cancelWorkbookImport() {
    importReadVersion.current += 1;
    importPhotoVersions.current = {};
    importPhotosRef.current = {};
    setImportPhotos({});
    setImportPreview(null);
    setImportError(null);
    setIsReadingImport(false);
    setIsImportApplied(false);
  }

  function getWorkbookSettingsError(result: BiotImportResult): string | null {
    const activeCount = rows.filter((row) =>
      row.fullName.trim() || row.issuedTo.trim() || row.positionRu.trim() || row.positionKz.trim(),
    ).length;
    if (activeCount + result.rows.length > 100) {
      return `В заявке может быть не более 100 заполненных строк. Сейчас: ${activeCount}, в файле: ${result.rows.length}.`;
    }
    const hasNumbers = result.rows.some((row) =>
      row.certificateNumber || row.protocolNumber || row.witnessCertificateNumber || row.witnessRegistrationNumber,
    );
    if (selectedCertificateTypes.length > 1 && hasNumbers) {
      return "В файле указаны номера. Для их импорта выберите один вид документа либо очистите столбцы D–G в файле.";
    }
    const hasWitnessNumbers = result.rows.some((row) =>
      row.witnessCertificateNumber || row.witnessRegistrationNumber,
    );
    if (hasWitnessNumbers && certificateType === "PS" && psDocumentKind === "ITR_CERTIFICATE") {
      return "Для выбранного свидетельства КБ номера указываются в столбцах D–E. Перенесите их туда и очистите F–G.";
    }
    if (hasWitnessNumbers && !(certificateType === "PS" && psDocumentKind !== "ITR_CERTIFICATE" && psIncludeWitness)) {
      return "Столбцы F–G доступны только при выбранном свидетельстве КБ. Измените настройки документа или очистите эти столбцы в файле.";
    }
    return null;
  }

  function handleAddWorkbookRows() {
    const preview = importPreview;
    const photos = importPhotosRef.current;
    if (importApplied.current || !preview || !preview.rows.length || preview.errors.length || getWorkbookSettingsError(preview) || Object.values(photos).some((photo) => photo.status !== "ready")) return;
    importApplied.current = true;
    const rowSettings = getCurrentRowSettings();
    setRows((current) => {
      const emptyRow = createEmptyRow(
        certificateType, activeBiotDocumentKind,
        certificateType === "PS" ? psIncludeWitness : false,
        0, issueDate, defaults, null, rowSettings,
      );
      // Do not leave the untouched initial row consuming the first auto number.
      // Any entered data or changed row settings make this comparison fail.
      const reuseFirst = canReuseImportPlaceholder(current, emptyRow);
      const existing = reuseFirst ? [] : current;
      const added = preview.rows.map((data, offset) => {
        const index = existing.length + offset;
        let row = reuseFirst && offset === 0 ? current[0] : createEmptyRow(
          certificateType, activeBiotDocumentKind,
          certificateType === "PS" ? psIncludeWitness : false,
          index, issueDate, defaults, null, rowSettings,
        );
        const fields: BulkPasteColumnKey[] = [
          "fullName", "positionRu", "positionKz", "certificateNumber", "protocolNumber",
          "witnessCertificateNumber", "witnessRegistrationNumber",
        ];
        for (const key of fields) {
          // Empty number cells must retain the generated number and automatic mode.
          if (data[key]) row = applyPastedValueToRow(row, key, data[key]);
        }
        const photo = photos[data.rowNumber];
        if (photo?.status === "ready") {
          row = { ...row, photoDataUrl: photo.dataUrl ?? "", photoFileName: photo.fileName ?? "" };
        }
        return applyRowAutoNumbers(row, index);
      });
      return [...existing, ...added];
    });
    setIsImportApplied(true);
    setImportError(null);
    setErrorMessage(null);
    setSuccessMessage(`Добавлено строк из Excel: ${preview.rows.length}. Проверьте настройки и обязательные данные заявки.`);
  }

  function applyPastedValueToRow(
    row: GeneratorRow,
    key: BulkPasteColumnKey,
    value: string,
  ): GeneratorRow {
    if (key === "fullName") {
      return {
        ...row,
        fullName: value,
        issuedTo: value,
      };
    }

    if (key === "positionRu") {
      return {
        ...row,
        positionRu: value,
      };
    }

    if (key === "positionKz") {
      return {
        ...row,
        positionKz: value,
      };
    }

    if (key === "certificateNumber") {
      return withUpdatedRowDocumentNumberState(
        row,
        row.certificateType,
        0,
        (numbers) => ({
          ...numbers,
          certificateNumber: value,
          isCertificateManual: true,
        }),
      );
    }

    if (key === "protocolNumber") {
      return withUpdatedRowDocumentNumberState(
        row,
        row.certificateType,
        0,
        (numbers) => ({
          ...numbers,
          protocolNumber: value,
          isProtocolManual: true,
        }),
      );
    }

    if (key === "witnessCertificateNumber") {
      return withUpdatedRowDocumentNumberState(
        row,
        row.certificateType,
        0,
        (numbers) => ({
          ...numbers,
          witnessCertificateNumber: value,
          isWitnessCertificateManual: true,
        }),
      );
    }

    return withUpdatedRowDocumentNumberState(
      row,
      row.certificateType,
      0,
      (numbers) => ({
        ...numbers,
        witnessRegistrationNumber: value,
        isWitnessRegistrationManual: true,
      }),
    );
  }

  function handleTablePaste(
    startRowId: string,
    startColumnKey: BulkPasteColumnKey,
    value: string,
  ) {
    const parsedRows = parseBulkPasteText(value);
    if (!parsedRows.length) {
      return;
    }

    const dataRows = looksLikeBulkPasteHeader(parsedRows[0])
      ? parsedRows.slice(1)
      : parsedRows;
    if (!dataRows.length) {
      return;
    }

    const startColumnIndex = tablePasteColumns.findIndex(
      (column) => column.key === startColumnKey,
    );
    if (startColumnIndex === -1) {
      return;
    }

    const rowSettings = getCurrentRowSettings();

    setRows((current) => {
      const startRowIndex = current.findIndex((row) => row.id === startRowId);
      if (startRowIndex === -1) {
        return current;
      }

      const nextRows = [...current];
      const requiredRows = startRowIndex + dataRows.length;

      while (nextRows.length < requiredRows) {
        nextRows.push(
          createEmptyRow(
            certificateType,
            activeBiotDocumentKind,
            certificateType === "PS" ? psIncludeWitness : false,
            nextRows.length,
            issueDate,
            defaults,
            null,
            rowSettings,
          ),
        );
      }

      dataRows.forEach((cells, rowOffset) => {
        let updatedRow = { ...nextRows[startRowIndex + rowOffset] };

        cells.forEach((cellValue, cellOffset) => {
          const targetColumn = tablePasteColumns[startColumnIndex + cellOffset];
          if (!targetColumn) {
            return;
          }

          updatedRow = applyPastedValueToRow(
            updatedRow,
            targetColumn.key,
            cellValue,
          );
        });

        if (!updatedRow.issuedTo.trim()) {
          updatedRow.issuedTo = updatedRow.fullName;
        }

        nextRows[startRowIndex + rowOffset] = updatedRow;
      });

      return nextRows.map((row, index) => applyRowAutoNumbers(row, index));
    });

    setErrorMessage(null);
    setSuccessMessage(null);
  }

  function handleCellPaste(
    rowId: string,
    columnKey: BulkPasteColumnKey,
    event: ReactClipboardEvent<HTMLElement>,
  ) {
    const pastedText = event.clipboardData.getData("text/plain");
    if (!pastedText.includes("\t") && !pastedText.includes("\n")) {
      return;
    }

    event.preventDefault();
    if (columnKey === "positionRu" || columnKey === "positionKz") {
      clearRowTranslationError(rowId);
    }
    handleTablePaste(rowId, columnKey, pastedText);
  }

  async function handlePhotoChange(rowId: string, file: File | null) {
    if (!file) {
      updateRow(rowId, (current) => ({
        ...current,
        photoDataUrl: "",
        photoFileName: "",
        isPhotoProcessing: false,
      }));
      return;
    }

    const normalizedType = file.type.toLowerCase();
    if (!["image/jpeg", "image/png"].includes(normalizedType)) {
      setErrorMessage("Для фото подходят только файлы JPG или PNG.");
      return;
    }

    if (file.size > MAX_SOURCE_PHOTO_SIZE_BYTES) {
      setErrorMessage("Исходное фото должно быть не больше 10 МБ.");
      return;
    }

    updateRow(rowId, (current) => ({
      ...current,
      isPhotoProcessing: true,
    }));

    try {
      const dataUrl = await preparePhotoDataUrl(file);
      updateRow(rowId, (current) => ({
        ...current,
        photoDataUrl: dataUrl,
        photoFileName: toJpegFileName(file.name),
        isPhotoProcessing: false,
      }));
      setErrorMessage(null);
    } catch (error) {
      updateRow(rowId, (current) => ({
        ...current,
        photoDataUrl: "",
        photoFileName: "",
        isPhotoProcessing: false,
      }));
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Не удалось прочитать выбранное фото.",
      );
    }
  }

  function handlePhotoPasteTarget(rowId: string, file: File | null) {
    void handlePhotoChange(rowId, file);
  }

  function handleRemoveRow(rowId: string) {
    setRowTranslating(rowId, false);
    clearRowTranslationError(rowId);
    const rowSettings = getCurrentRowSettings();

    setRows((current) => {
      const nextRows = current.filter((row) => row.id !== rowId);
      if (nextRows.length === 0) {
        return [
          createEmptyRow(
            certificateType,
            activeBiotDocumentKind,
            certificateType === "PS" ? psIncludeWitness : false,
            0,
            issueDate,
            defaults,
            null,
            rowSettings,
          ),
        ];
      }
      return nextRows.map((row, index) => applyRowAutoNumbers(row, index));
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);
    setConfirmedRequestLinks([]);
    setSuccessMessage(null);

    try {
      if (
        isEditMode &&
        singleSelectionUsesTrainingSubject &&
        !effectiveTrainingSubject
      ) {
        throw new Error("Укажите значение для строки «В том, что он».");
      }

      const activeRows = rows.filter(
        (row) =>
          row.fullName.trim() ||
          row.issuedTo.trim() ||
          row.positionRu.trim() ||
          row.positionKz.trim(),
      );

      if (!activeRows.length) {
        throw new Error("Заполните хотя бы одну строку в заявке.");
      }

      if (
        activeRows.some((row) => rowUsesRequestCompany(row)) &&
        !requestWorkplaceRu
      ) {
        throw new Error(
          "Укажите название компании для заявки. Форма сама добавит ТОО/ЖШС, ИП/ЖК или АО/АҚ.",
        );
      }

      activeRows.forEach((row, index) => {
        // Validation must refer to the visible table, including empty rows.
        // Keep `index` for the existing generation/numbering calculations.
        const visibleRowNumber = rows.findIndex((candidate) => candidate.id === row.id) + 1;

        if (!row.fullName.trim()) {
          throw new Error(`Заполните ФИО на русском в строке ${visibleRowNumber}.`);
        }

        if (!row.positionRu.trim() && !row.positionKz.trim()) {
          throw new Error(
            `Заполните ${roleRequiredLabel} в строке ${visibleRowNumber}.`,
          );
        }

        if (row.isPhotoProcessing && rowUsesPhoto(row)) {
          throw new Error(
            `Фото в строке ${visibleRowNumber} ещё обрабатывается. Дождитесь завершения и попробуйте снова.`,
          );
        }

        getRowSelectedTypes(row).forEach((type) => {
          const rowDocumentKind = getRowDocumentKindForType(row, type);

          if (
            usesTrainingSubject(type, rowDocumentKind) &&
            !getRowTypeTrainingSubject(row, type, index)
          ) {
            throw new Error(
              `Укажите тему обучения в настройках строки ${visibleRowNumber}.`,
            );
          }

          if (
            usesPhotoWithSelection(type, rowDocumentKind, row.psIncludeCard) &&
            !row.photoDataUrl
          ) {
            throw new Error(
              `Добавьте фото в строке ${visibleRowNumber}. Для ${getCertificateTypeLabel(type, rowDocumentKind)} оно обязательно.`,
            );
          }
        });
      });

      const requestTypes = [...selectedCertificateTypes];

      const getRequestIssueDate = (
        type: SafetyCardType,
        typeDefaults: BiotCardDefaults,
      ) =>
        activeRows[0]
          ? getRowTypeIssueDate(activeRows[0], type, 0, typeDefaults)
          : issueDate;

      const getRequestTrainingSubject = (
        type: SafetyCardType,
        typeDefaults: BiotCardDefaults,
      ) =>
        activeRows[0]
          ? getRowTypeTrainingSubject(activeRows[0], type, 0, typeDefaults)
          : effectiveTrainingSubject;

      const buildRequestPayload = (
        type: SafetyCardType,
        typeBiotDocumentKind: BiotDocumentKind,
        typeDefaults: BiotCardDefaults,
      ) => ({
        companyId,
        certificateType: type,
        biotDocumentKind: typeBiotDocumentKind,
        includeCard:
          type === "PS" && typeBiotDocumentKind !== "ITR_CERTIFICATE"
            ? psIncludeCard
            : undefined,
        includeProtocol:
          type === "BIOT" && typeBiotDocumentKind === "ITR_CERTIFICATE"
            ? true
            : type === "PS" && typeBiotDocumentKind !== "ITR_CERTIFICATE"
              ? psIncludeProtocol
              : undefined,
        includeWitness:
          type === "PS" && typeBiotDocumentKind !== "ITR_CERTIFICATE"
            ? psIncludeWitness
            : undefined,
        requestMode: "REQUEST" as const,
        requestCompanyRu: usesRequestCompany(type, typeBiotDocumentKind)
          ? requestWorkplaceRu
          : undefined,
        requestCompanyKz: usesRequestCompany(type, typeBiotDocumentKind)
          ? requestWorkplaceKz
          : undefined,
        issueDate: getRequestIssueDate(type, typeDefaults),
        seriesNumber: usesSeriesNumber(type, typeBiotDocumentKind)
          ? seriesNumber
          : "1",
        trainingSubject:
          requestTypes.length === 1 &&
          usesTrainingSubject(type, typeBiotDocumentKind)
            ? getRequestTrainingSubject(type, typeDefaults)
            : typeDefaults.defaultTrainingSubject,
        items: activeRows.map((row, index) => ({
          employeeId: undefined,
          trainingAssignmentId: null,
          fullName: row.fullName.trim(),
          fullNameKz:
            type === "PS" && typeBiotDocumentKind !== "ITR_CERTIFICATE"
              ? row.fullName.trim() || undefined
              : undefined,
          issuedTo: row.issuedTo.trim() || row.fullName.trim(),
          positionRu: row.positionRu.trim(),
          positionKz: row.positionKz.trim(),
          workplaceRu: requestWorkplaceRu,
          workplaceKz: requestWorkplaceKz,
          photoDataUrl: usesPhoto(type, typeBiotDocumentKind)
            ? row.photoDataUrl
            : undefined,
          photoFileName: usesPhoto(type, typeBiotDocumentKind)
            ? row.photoFileName
            : undefined,
          certificateNumber:
            requestTypes.length === 1
              ? row.certificateNumber.trim()
              : formatCertificateNumber(
                  type,
                  getRequestIssueDate(type, typeDefaults),
                  typeDefaults.nextCertificateSequence + index,
                  typeBiotDocumentKind,
                ),
          protocolNumber: !usesProtocolNumber(type, typeBiotDocumentKind)
            ? ""
            : requestTypes.length === 1
              ? row.protocolNumber.trim()
              : formatProtocolNumber(
                  type,
                  getRequestIssueDate(type, typeDefaults),
                  typeDefaults.nextProtocolSequence + index,
                  typeBiotDocumentKind,
                ),
          witnessCertificateNumber:
            type === "PS" &&
            typeBiotDocumentKind !== "ITR_CERTIFICATE" &&
            psIncludeWitness
              ? requestTypes.length === 1
                ? row.witnessCertificateNumber.trim()
                : formatPsWitnessCertificateNumber(
                    getRequestIssueDate(type, typeDefaults),
                    (typeDefaults.nextWitnessCertificateSequence ?? 1) + index,
                  )
              : undefined,
          witnessRegistrationNumber:
            type === "PS" &&
            typeBiotDocumentKind !== "ITR_CERTIFICATE" &&
            psIncludeWitness
              ? requestTypes.length === 1
                ? row.witnessRegistrationNumber.trim()
                : formatPsWitnessRegistrationNumber(
                    (typeDefaults.nextWitnessRegistrationSequence ?? 1) + index,
                  )
              : undefined,
        })),
      });

      const buildGenerationGroups = async () => {
        const groups = new Map<string, GenerationGroup>();

        for (const [rowIndex, row] of activeRows.entries()) {
          for (const type of getRowSelectedTypes(row)) {
            const typeBiotDocumentKind = getRowDocumentKindForType(row, type);
            const fallbackIssueDate = getRowTypeIssueDate(row, type, rowIndex);
            const typeDefaults = await fetchDefaultsForType(
              type,
              fallbackIssueDate,
              typeBiotDocumentKind,
            );
            const typeIssueDate = getRowTypeIssueDate(
              row,
              type,
              rowIndex,
              typeDefaults,
            );
            const typeUsesRequestCompany = usesRequestCompany(
              type,
              typeBiotDocumentKind,
            );
            const includeCard =
              type === "PS" && typeBiotDocumentKind !== "ITR_CERTIFICATE"
                ? row.psIncludeCard
                : undefined;
            const includeProtocol =
              type === "BIOT" && typeBiotDocumentKind === "ITR_CERTIFICATE"
                ? true
                : type === "PS" && typeBiotDocumentKind !== "ITR_CERTIFICATE"
                  ? row.psIncludeProtocol
                  : undefined;
            const includeWitness =
              type === "PS" && typeBiotDocumentKind !== "ITR_CERTIFICATE"
                ? row.psIncludeWitness
                : undefined;
            const trainingSubject = usesTrainingSubject(
              type,
              typeBiotDocumentKind,
            )
              ? getRowTypeTrainingSubject(row, type, rowIndex, typeDefaults)
              : "";
            const groupSeriesNumber = usesSeriesNumberWithSelection(
              type,
              typeBiotDocumentKind,
              row.psIncludeCard,
            )
              ? row.seriesNumber
              : "1";
            const requestCompanyRu = typeUsesRequestCompany
              ? requestWorkplaceRu
              : undefined;
            const requestCompanyKz = typeUsesRequestCompany
              ? requestWorkplaceKz
              : undefined;
            const key = JSON.stringify({
              type,
              typeBiotDocumentKind,
              issueDate: typeIssueDate,
              seriesNumber: groupSeriesNumber,
              trainingSubject,
              includeCard,
              includeProtocol,
              includeWitness,
              requestCompanyRu,
              requestCompanyKz,
            });
            const existingGroup = groups.get(key);

            if (existingGroup) {
              existingGroup.rows.push(row);
              continue;
            }

            groups.set(key, {
              key,
              certificateType: type,
              biotDocumentKind: typeBiotDocumentKind,
              issueDate: typeIssueDate,
              seriesNumber: groupSeriesNumber,
              trainingSubject,
              includeCard,
              includeProtocol,
              includeWitness,
              requestCompanyRu,
              requestCompanyKz,
              rows: [row],
            });
          }
        }

        return Array.from(groups.values());
      };

      const buildGroupedRequestPayload = (
        group: GenerationGroup,
        typeDefaults: BiotCardDefaults,
      ) => {
        const groupUsesPhoto = usesPhotoWithSelection(
          group.certificateType,
          group.biotDocumentKind,
          group.includeCard ?? true,
        );
        const groupUsesWitness =
          group.certificateType === "PS" &&
          group.biotDocumentKind !== "ITR_CERTIFICATE" &&
          Boolean(group.includeWitness);

        return {
          companyId,
          certificateType: group.certificateType,
          biotDocumentKind: group.biotDocumentKind,
          includeCard: group.includeCard,
          includeProtocol: group.includeProtocol,
          includeWitness: group.includeWitness,
          requestMode: "REQUEST" as const,
          requestCompanyRu: group.requestCompanyRu,
          requestCompanyKz: group.requestCompanyKz,
          issueDate: group.issueDate,
          seriesNumber: usesSeriesNumberWithSelection(
            group.certificateType,
            group.biotDocumentKind,
            group.includeCard ?? true,
          )
            ? group.seriesNumber
            : "1",
          trainingSubject: usesTrainingSubject(
            group.certificateType,
            group.biotDocumentKind,
          )
            ? group.trainingSubject
            : typeDefaults.defaultTrainingSubject,
          items: group.rows.map((row, index) => {
            const numbers = getRowDocumentNumberState(
              row,
              group.certificateType,
              index,
              typeDefaults,
            );

            return {
              employeeId: undefined,
              trainingAssignmentId: null,
              fullName: row.fullName.trim(),
              fullNameKz:
                group.certificateType === "PS" &&
                group.biotDocumentKind !== "ITR_CERTIFICATE"
                  ? row.fullName.trim() || undefined
                  : undefined,
              issuedTo: row.issuedTo.trim() || row.fullName.trim(),
              positionRu: row.positionRu.trim(),
              positionKz: row.positionKz.trim(),
              workplaceRu: group.requestCompanyRu,
              workplaceKz: group.requestCompanyKz,
              photoDataUrl: groupUsesPhoto ? row.photoDataUrl : undefined,
              photoFileName: groupUsesPhoto ? row.photoFileName : undefined,
              certificateNumber: numbers.isCertificateManual
                ? numbers.certificateNumber.trim()
                : formatCertificateNumber(
                    group.certificateType,
                    group.issueDate,
                    typeDefaults.nextCertificateSequence + index,
                    group.biotDocumentKind,
                  ),
              protocolNumber: !usesProtocolNumber(
                group.certificateType,
                group.biotDocumentKind,
              )
                ? ""
                : numbers.isProtocolManual
                  ? numbers.protocolNumber.trim()
                  : formatProtocolNumber(
                      group.certificateType,
                      group.issueDate,
                      typeDefaults.nextProtocolSequence + index,
                      group.biotDocumentKind,
                    ),
              witnessCertificateNumber: groupUsesWitness
                ? numbers.isWitnessCertificateManual
                  ? numbers.witnessCertificateNumber.trim()
                  : formatPsWitnessCertificateNumber(
                      group.issueDate,
                      (typeDefaults.nextWitnessCertificateSequence ?? 1) +
                        index,
                    )
                : undefined,
              witnessRegistrationNumber: groupUsesWitness
                ? numbers.isWitnessRegistrationManual
                  ? numbers.witnessRegistrationNumber.trim()
                  : formatPsWitnessRegistrationNumber(
                      (typeDefaults.nextWitnessRegistrationSequence ?? 1) +
                        index,
                    )
                : undefined,
            };
          }),
        };
      };

      if (isEditMode) {
        if (!currentRequestId) {
          throw new Error("Не удалось определить редактируемую заявку.");
        }

        const response = await fetch(
          `/api/biot-cards/requests/${currentRequestId}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
            },
            body: serializeBiotRequest(
              buildRequestPayload(
                certificateType,
                activeBiotDocumentKind,
                defaults,
              ),
            ),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readResponseError(
              response,
              "Не удалось сохранить изменения в заявке.",
            ),
          );
        }

        await response.json();
        await refreshDefaults(issueDate);
        setSuccessMessage(
          "Изменения сохранены. Теперь повторные выгрузки документов будут использовать обновлённые данные заявки.",
        );
        return;
      }

      const generationGroups = await buildGenerationGroups();

      // Check every group before creating any request. Defaults are fetched again
      // at submission time so number allocation keeps its existing behavior.
      for (const group of generationGroups) {
        const typeDefaults = await fetchDefaultsForType(
          group.certificateType,
          group.issueDate,
          group.biotDocumentKind,
        );
        serializeBiotRequest(buildGroupedRequestPayload(group, typeDefaults));
      }

      await submitBiotGroups(generationGroups, async (group, markRequestSent) => {
        const typeDefaults = await fetchDefaultsForType(
          group.certificateType,
          group.issueDate,
          group.biotDocumentKind,
        );

        const body = serializeBiotRequest(buildGroupedRequestPayload(group, typeDefaults));
        markRequestSent();
        const response = await fetch("/api/biot-cards/generate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body,
        });

        if (!response.ok) {
          throw new Error(
            await readResponseError(
              response,
              `Не удалось сформировать заявку ${getCertificateTypeLabel(group.certificateType, group.biotDocumentKind)}.`,
            ),
          );
        }

        await response.arrayBuffer();
        return response.headers.get("X-Card-Request-Id");
      }, (group) => `${getCertificateTypeLabel(group.certificateType, group.biotDocumentKind)} (${group.issueDate})`);

      setSuccessMessage(
        generationGroups.length === 1
          ? `Заявка ${getCertificateTypeLabel(
              generationGroups[0].certificateType,
              generationGroups[0].biotDocumentKind,
            )} сохранена. Документы доступны в списке заявок ниже и на странице «Удостоверения».`
          : `Созданы заявки по группам: ${generationGroups
              .map((group) =>
                getCertificateTypeLabel(
                  group.certificateType,
                  group.biotDocumentKind,
                ),
              )
              .join(
                ", ",
              )}. Скачивание доступно отдельно по каждой группе в списке заявок.`,
      );
      await refreshDefaults(issueDate);
      await loadRequests();
    } catch (error) {
      if (error instanceof BiotGroupSubmissionError) {
        let historyUpdated = false;
        try {
          const history = await loadRequests();
          historyUpdated = true;
          setConfirmedRequestLinks(confirmedBiotHistoryLinks(error, history.map((request) => request.id)));
          if (historyDetailsRef.current) historyDetailsRef.current.open = true;
        } catch {
          // The warning still directs the user to check history before retrying.
        }
        setErrorMessage(describeBiotGroupFailure(error, historyUpdated));
      } else {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Не удалось сформировать заявки на корочки.",
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      {errorMessage ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <p>{errorMessage}</p>
          {confirmedRequestLinks.length ? (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {confirmedRequestLinks.map(({ requestId, label }) => (
                <a key={requestId} href={`#card-request-${requestId}`} className="font-medium underline underline-offset-2">
                  Открыть заявку: {label}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {successMessage ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {successMessage}
        </div>
      ) : null}
      <datalist id="ps-position-ru-options">
        {psProfessionSuggestions.map((suggestion) =>
          suggestion.positionRu ? (
            <option
              key={`ru-${suggestion.positionRu}-${suggestion.positionKz}`}
              value={suggestion.positionRu}
            />
          ) : null,
        )}
      </datalist>
      <datalist id="ps-position-kz-options">
        {psProfessionSuggestions.map((suggestion) =>
          suggestion.positionKz ? (
            <option
              key={`kz-${suggestion.positionRu}-${suggestion.positionKz}`}
              value={suggestion.positionKz}
            />
          ) : null,
        )}
      </datalist>

      {renderRowSettingsModal()}

      {activeCellEditor && activeEditorRow ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 py-6"
          role="presentation"
          onMouseDown={() => setActiveCellEditor(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="biot-cell-editor-title"
            className="w-full max-w-xl overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4">
              <div className="min-w-0">
                <h2
                  id="biot-cell-editor-title"
                  className="text-base font-semibold text-[var(--ink)]"
                >
                  {getEditableCellLabel(activeCellEditor.field)}
                </h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Строка{" "}
                  {rows.findIndex((row) => row.id === activeEditorRow.id) + 1}
                </p>
              </div>
              <button
                type="button"
                className="inline-flex size-8 items-center justify-center rounded-md border border-[var(--line)] text-lg leading-none text-[var(--muted)] transition-colors duration-150 hover:bg-[var(--surface-muted)]"
                onClick={() => setActiveCellEditor(null)}
                aria-label="Закрыть"
              >
                ×
              </button>
            </div>
            <div className="space-y-4 px-5 py-5">
              {activeCellEditor.field === "photo" ? (
                <div className="space-y-3">
                  <PhotoUploadInput
                    inputClassName={requestSpreadsheetFileClass}
                    pasteAreaClassName="rounded-md border border-dashed border-[var(--line)] bg-[var(--surface-muted)] px-3 py-3 text-sm leading-5 text-[var(--muted)] outline-none transition-colors duration-150 focus:border-[var(--focus-border)] focus:ring-2 focus:ring-[var(--focus-ring)]"
                    pasteHint="Вставить фото из буфера или выбрать файл"
                    onFileSelected={(file) =>
                      handlePhotoPasteTarget(activeEditorRow.id, file)
                    }
                  />
                  {activeEditorRow.photoFileName ? (
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] px-3.5 py-2.5 text-sm text-[var(--muted)]">
                      <span className="truncate">
                        {activeEditorRow.photoFileName}
                      </span>
                      <button
                        type="button"
                        className="shrink-0 font-medium text-[var(--ink)]"
                        onClick={() =>
                          updateRow(activeEditorRow.id, (current) => ({
                            ...current,
                            photoDataUrl: "",
                            photoFileName: "",
                            isPhotoProcessing: false,
                          }))
                        }
                      >
                        Очистить
                      </button>
                    </div>
                  ) : activeEditorRow.isPhotoProcessing ? (
                    <p className="text-sm text-amber-600">
                      Фото обрабатывается...
                    </p>
                  ) : (
                    <p className="text-sm text-[var(--muted)]">
                      JPG/PNG до 10 МБ.
                    </p>
                  )}
                </div>
              ) : (
                <Textarea
                  autoFocus
                  className="min-h-36"
                  value={getEditableCellValue(
                    activeEditorRow,
                    activeCellEditor.field,
                  )}
                  onChange={(event) =>
                    updateCellEditorValue(
                      activeEditorRow.id,
                      activeCellEditor.field,
                      event.target.value,
                    )
                  }
                  onPaste={(event) =>
                    handleCellPaste(
                      activeEditorRow.id,
                      activeCellEditor.field as BulkPasteColumnKey,
                      event,
                    )
                  }
                  placeholder={getEditableCellPlaceholder(
                    activeCellEditor.field,
                  )}
                />
              )}

              {activeCellEditor.field === "positionKz" ? (
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className={translateActionButtonClass}
                    disabled={
                      !activeEditorRow.positionRu.trim() ||
                      Boolean(translatingRowIds[activeEditorRow.id])
                    }
                    onClick={() =>
                      void handleTranslatePosition(
                        activeEditorRow.id,
                        activeEditorRow.positionRu,
                      )
                    }
                  >
                    {translatingRowIds[activeEditorRow.id]
                      ? "Перевод..."
                      : "Перевести в KZ"}
                  </button>
                  {rowTranslationErrors[activeEditorRow.id] ? (
                    <p className="text-sm text-rose-600">
                      {rowTranslationErrors[activeEditorRow.id]}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="flex justify-end gap-3 border-t border-[var(--line)] px-5 py-4">
              <Button type="button" onClick={() => setActiveCellEditor(null)}>
                Готово
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <form
        id="biot-card-generator-form"
        className="space-y-6"
        onSubmit={handleSubmit}
      >
        {isEditMode ? (
          <section className={denseInfoClass}>
            Редактируется существующая заявка. После сохранения новые выгрузки
            будут браться из этой же записи, без создания новой заявки.
            {returnHref ? (
              <>
                {" "}
                <a
                  href={returnHref}
                  className="font-medium text-[var(--ink)] underline underline-offset-2"
                >
                  Вернуться к списку заявок
                </a>
              </>
            ) : null}
          </section>
        ) : null}

        <div className="space-y-6">
          <div className="space-y-6">
            <EditorSection
              title="Настройка заявки"
              description="Режим отдельной заявки. Выберите нужные шаблоны документов."
              compact
              className="hidden"
              action={
                !isEditMode ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={handleStartNewRequest}
                  >
                    Очистить заявку
                  </Button>
                ) : null
              }
            >
              <div className="space-y-2.5">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm font-medium text-[var(--ink)]">
                    Шаблоны удостоверений
                  </p>
                  <p className="text-[13px] leading-5 text-[var(--muted)]">
                    Можно выбрать один или несколько видов
                  </p>
                </div>

                <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
                  {certificateTypeOrder.map((type) => {
                    const checked = selectedCertificateTypes.includes(type);

                    return (
                      <label
                        key={type}
                        className={cn(
                          "flex cursor-pointer items-start justify-between gap-2.5 rounded-lg border px-3.5 py-3 transition-colors",
                          checked
                            ? "border-[var(--surface-strong)] bg-[var(--surface-muted)]"
                            : "border-[var(--line)] bg-[var(--surface)] hover:bg-[var(--surface-muted)]",
                          isEditMode && "cursor-not-allowed opacity-60",
                        )}
                      >
                        <div className="min-w-0 space-y-0.5">
                          <div className="text-sm font-semibold text-[var(--ink)]">
                            {certificateTypeLabels[type]}
                          </div>
                          <div className="text-[13px] leading-5 text-[var(--muted)]">
                            {certificateTypeDescriptions[type]}
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          className="mt-0.5 size-4 rounded border-slate-300 accent-[var(--accent)]"
                          checked={checked}
                          disabled={isEditMode}
                          onChange={() => handleTypeToggle(type)}
                        />
                      </label>
                    );
                  })}
                </div>
              </div>

              {hasRoleSelection || hasPsSelection ? (
                <div
                  className={cn(
                    "mt-4 grid gap-3",
                    hasRoleSelection && hasPsSelection ? "lg:grid-cols-2" : "",
                  )}
                >
                  {hasRoleSelection ? (
                    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3.5">
                      <p className="text-sm font-semibold text-[var(--ink)]">
                        Категория удостоверения
                      </p>
                      <p className="mt-1 text-[13px] leading-5 text-[var(--muted)]">
                        Выберите, для кого оформляется удостоверение. Срок
                        фиксирован: рабочий 1 год, ИТР 3 года.
                      </p>
                      <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => setBiotDocumentKind("WORKER_CARD")}
                          disabled={isEditMode}
                          className={cn(
                            "rounded-lg border px-3.5 py-3 text-left transition-colors",
                            biotDocumentKind === "WORKER_CARD"
                              ? "border-[var(--surface-strong)] bg-[var(--surface-strong)] text-white"
                              : "border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] hover:bg-white",
                            isEditMode && "cursor-not-allowed opacity-60",
                          )}
                        >
                          <div className="text-sm font-semibold">Рабочий</div>
                          <div
                            className={cn(
                              "mt-0.5 text-[13px] leading-5",
                              biotDocumentKind === "WORKER_CARD"
                                ? "text-[var(--surface-strong-muted)]"
                                : "text-[var(--muted)]",
                            )}
                          >
                            Срок действия 1 год.
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => setBiotDocumentKind("ITR_CERTIFICATE")}
                          disabled={isEditMode}
                          className={cn(
                            "rounded-lg border px-3.5 py-3 text-left transition-colors",
                            biotDocumentKind === "ITR_CERTIFICATE"
                              ? "border-[var(--surface-strong)] bg-[var(--surface-strong)] text-white"
                              : "border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] hover:bg-white",
                            isEditMode && "cursor-not-allowed opacity-60",
                          )}
                        >
                          <div className="text-sm font-semibold">ИТР</div>
                          <div
                            className={cn(
                              "mt-0.5 text-[13px] leading-5",
                              biotDocumentKind === "ITR_CERTIFICATE"
                                ? "text-[var(--surface-strong-muted)]"
                                : "text-[var(--muted)]",
                            )}
                          >
                            Срок действия 3 года.
                          </div>
                        </button>
                      </div>
                      {hasBiotSelection ? (
                        <div className={`${denseInfoClass} mt-2.5`}>
                          Для БиОТ выбор ИТР дополнительно включает шаблон
                          сертификата ИТР.
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {hasPsSelection ? (
                    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3.5">
                      <p className="text-sm font-semibold text-[var(--ink)]">
                        Документы ПС
                      </p>
                      <p className="mt-1 text-[13px] leading-5 text-[var(--muted)]">
                        Отметьте документы, которые нужны по заявке.
                      </p>
                      <div className="mt-2.5">
                        {psDocumentKind === "ITR_CERTIFICATE" ? (
                          <div className={denseInfoClass}>
                            Открыта старая заявка ПС Свидетельство. Для неё
                            используется legacy-режим без комплекта.
                          </div>
                        ) : (
                          <div className="grid gap-2 sm:grid-cols-3">
                            <label className="flex items-center justify-between rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2.5 text-sm font-medium text-[var(--ink)]">
                              <span>Корочка</span>
                              <input
                                type="checkbox"
                                className="size-4 rounded border-slate-300 accent-[var(--accent)]"
                                checked={psIncludeCard}
                                onChange={(event) =>
                                  setPsIncludeCard(event.target.checked)
                                }
                              />
                            </label>
                            <label className="flex items-center justify-between rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2.5 text-sm font-medium text-[var(--ink)]">
                              <span>Протокол</span>
                              <input
                                type="checkbox"
                                className="size-4 rounded border-slate-300 accent-[var(--accent)]"
                                checked={psIncludeProtocol}
                                onChange={(event) =>
                                  setPsIncludeProtocol(event.target.checked)
                                }
                              />
                            </label>
                            <label className="flex items-center justify-between rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2.5 text-sm font-medium text-[var(--ink)]">
                              <span>Свидетельство</span>
                              <input
                                type="checkbox"
                                className="size-4 rounded border-slate-300 accent-[var(--accent)]"
                                checked={psIncludeWitness}
                                onChange={(event) =>
                                  setPsIncludeWitness(event.target.checked)
                                }
                              />
                            </label>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-2.5 text-[13px] leading-5 text-[var(--muted)]">
                {isMultiTypeSelection
                  ? `Выбрано: ${selectedTypesLabel}. Система создаст отдельную заявку для каждого вида.`
                  : `Текущий шаблон: ${getCertificateTypeLabel(
                      certificateType,
                      activeBiotDocumentKind,
                    )}.`}
              </div>
            </EditorSection>

            <EditorSection
              title="Параметры шаблона"
              description="Дата выдачи и поля текущего шаблона."
              compact
              className="hidden"
              action={
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => refreshDefaults(issueDate, true)}
                  disabled={isRefreshingDefaults}
                >
                  {isRefreshingDefaults ? "Обновление..." : "Обновить номера"}
                </Button>
              }
            >
              <div className="space-y-3.5">
                <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)] md:items-end">
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-[var(--ink)]">
                      Дата выдачи
                    </label>
                    <Input
                      type="date"
                      className="h-9"
                      value={issueDate}
                      onChange={(event: ChangeEvent<HTMLInputElement>) =>
                        setIssueDate(event.target.value)
                      }
                      required
                    />
                  </div>

                  <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-2.5 text-[13px] leading-5 text-[var(--muted)]">
                    {isMultiTypeSelection
                      ? "Для нескольких видов система разнесёт постоянные значения и назначит номера отдельно по каждому документу."
                      : isBiotItrCertificate(
                            certificateType,
                            activeBiotDocumentKind,
                          )
                        ? "Для сертификата ИТР используются дата, ФИО, номер сертификата и номер протокола."
                        : isPsWitnessCertificate(
                              certificateType,
                              activeBiotDocumentKind,
                            )
                          ? "Для свидетельства ПС используются дата, номер КБ, регистрационный номер и данные по профессии."
                          : "Номера и постоянные значения подставляются автоматически из текущего шаблона и даты выдачи."}
                  </div>
                </div>

                {singleSelectionUsesTrainingSubject ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-[var(--ink)]">
                        {getTrainingSubjectLabel(certificateType)}
                      </label>
                      <Select
                        className="h-9"
                        value={
                          trainingSubjectMode === "custom"
                            ? CUSTOM_SUBJECT_VALUE
                            : trainingSubjectPreset
                        }
                        onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                          if (event.target.value === CUSTOM_SUBJECT_VALUE) {
                            setTrainingSubjectMode("custom");
                            return;
                          }

                          setTrainingSubjectMode("preset");
                          setTrainingSubjectPreset(event.target.value);
                        }}
                      >
                        {defaults.trainingSubjectPresets.map((preset) => (
                          <option key={preset} value={preset}>
                            {preset}
                          </option>
                        ))}
                        <option value={CUSTOM_SUBJECT_VALUE}>
                          Свое значение
                        </option>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-sm font-medium text-[var(--ink)]">
                        Собственное значение
                      </label>
                      <Input
                        className={cn(
                          "h-9",
                          trainingSubjectMode !== "custom"
                            ? "bg-[var(--surface-muted)] text-[var(--muted)]"
                            : "",
                        )}
                        value={trainingSubjectCustom}
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          setTrainingSubjectCustom(event.target.value)
                        }
                        placeholder={defaults.defaultTrainingSubject}
                        disabled={trainingSubjectMode !== "custom"}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            </EditorSection>

            {usesRequestCompanyForSelection ? (
              <EditorSection
                title="Параметры заявки"
                description="Название вводится один раз. Русская и казахская форма собираются автоматически."
                compact
                tone="muted"
              >
                <div className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)] md:items-end">
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-[var(--ink)]">
                        Форма компании
                      </label>
                      <Select
                        className="h-9"
                        value={requestCompanyLegalForm}
                        onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                          setRequestCompanyLegalForm(
                            event.target.value as CompanyLegalForm,
                          )
                        }
                      >
                        {legalFormOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-[var(--ink)]">
                        Название компании
                      </label>
                      <Input
                        className="h-9"
                        value={requestCompanyBaseName}
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          setRequestCompanyBaseName(event.target.value)
                        }
                        placeholder="Например, Alpina Tech"
                      />
                    </div>
                  </div>

                  {requestWorkplaceRu || requestWorkplaceKz ? (
                    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2.5 sm:flex sm:items-center sm:gap-3">
                      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--muted)]">
                        Компания заявки
                      </p>
                      <p className="mt-1 text-sm font-semibold leading-5 text-[var(--ink)] sm:mt-0">
                        {requestWorkplaceRu} / {requestWorkplaceKz}
                      </p>
                    </div>
                  ) : null}

                  {renderAdditionalSettings()}
                </div>
              </EditorSection>
            ) : null}

            {!usesRequestCompanyForSelection ? (
              <EditorSection
                title="Параметры заявки"
                description="Для этого варианта данные компании и места работы не используются."
                compact
                tone="muted"
              >
                <div className="space-y-3">
                  <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-2.5 text-[13px] leading-5 text-[var(--muted)]">
                    Ниже заполняются только ФИО, профессия и номера документов.
                  </div>

                  {renderAdditionalSettings()}
                </div>
              </EditorSection>
            ) : null}

            <EditorSection
              title={tableSectionHeaderText}
              description="Верхние параметры используются как значения по умолчанию для новых строк. Дата и детальные настройки существующей строки меняются в колонке «Настройки»."
              compact
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleAddRow}
                  >
                    Добавить строку
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={isSubmitting || isRefreshingDefaults}
                    className="hidden"
                  >
                    {isSubmitting
                      ? "Сохранение..."
                      : isEditMode
                        ? "Сохранить"
                        : "Сформировать"}
                  </Button>
                </div>
              }
              bodyClassName="p-0"
            >
              <div className="space-y-4 border-b border-[var(--line)] px-5 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1 text-sm leading-5 text-[var(--muted)]">
                  <p>
                    Загрузите заполненный шаблон XLSX для проверки и добавления строк.
                    Фото можно вставить в столбец «Фото» как рисунок или выбрать отдельно для каждой строки.
                    Файл XLSX — до 5 МБ, до 100 сотрудников; отдельное фото JPG или PNG — до 10 МБ.
                  </p>
                  <p>
                    Также можно вставить скопированные ячейки в поле «ФИО». Вставка заменяет
                    выбранные ячейки, включая пустые; для автоматических номеров копируйте только A–C.
                  </p>
                </div>
                <a
                  href="/templates/biot-table.xlsx"
                  download
                  className="inline-flex min-h-10 items-center rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-medium text-[var(--ink)] underline-offset-2 hover:bg-[var(--surface-muted)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-border)]"
                >
                  Скачать шаблон Excel
                </a>
                </div>
                <div className="space-y-2">
                  <label htmlFor="biot-workbook" className="block text-sm font-medium text-[var(--ink)]">
                    Выбрать файл Excel (.xlsx)
                  </label>
                  <input
                    id="biot-workbook"
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    disabled={isSubmitting}
                    onChange={handleWorkbookSelection}
                    aria-describedby="biot-workbook-help"
                    className="block w-full text-sm text-[var(--muted)] file:mr-3 file:rounded-md file:border file:border-[var(--line)] file:bg-[var(--surface)] file:px-3 file:py-2 file:text-sm file:font-medium file:text-[var(--ink)]"
                  />
                  <p id="biot-workbook-help" className="text-xs leading-5 text-[var(--muted)]">
                    Импорт добавляет строки в конец и не заменяет существующие. Повторный импорт добавит их снова.
                    Пустые строки в таблице сохранятся и могут влиять на автоматическую нумерацию; при необходимости удалите их.
                  </p>
                </div>
                <div aria-live="polite">
                  {isReadingImport ? <p className="text-sm text-[var(--muted)]">Проверяем файл…</p> : null}
                  {importError ? <p role="alert" className="text-sm text-rose-700">{importError}</p> : null}
                  {importPreview ? (
                    <div className="space-y-3 rounded-md border border-[var(--line)] bg-[var(--surface-muted)] p-4">
                      <p className="text-sm font-medium text-[var(--ink)]">
                        Найдено строк: {importPreview.rows.length}. Ошибок: {importPreview.errors.length}.
                      </p>
                      {importPreview.errors.length ? (
                        <div role="alert" className="text-sm text-rose-700">
                          <p>Исправьте ошибки в файле и выберите его снова. Заявка не изменена.</p>
                          <ul className="mt-2 max-h-48 list-disc space-y-1 overflow-y-auto pl-5">
                            {importPreview.errors.slice(0, 50).map((error, index) => (
                              <li key={`${error.rowNumber}-${error.field}-${index}`}>
                                Строка {error.rowNumber}, {error.field}: {error.message}
                              </li>
                            ))}
                          </ul>
                          {importPreview.errors.length > 50 ? <p>Показаны первые 50 ошибок.</p> : null}
                        </div>
                      ) : null}
                      {!importPreview.rows.length && !importPreview.errors.length ? (
                        <p className="text-sm text-[var(--muted)]">В файле нет заполненных строк. Добавьте данные и выберите файл снова.</p>
                      ) : null}
                      {importPreview.rows.length ? (
                        <>
                        <p className="text-xs leading-5 text-[var(--muted)]">В столбце «Фото сотрудника» видно фото из Excel; там же можно выбрать или заменить его отдельным файлом для каждой строки. Прокрутите таблицу вправо и вниз.</p>
                        <div className="max-h-[32rem] overflow-auto">
                          <table className="min-w-[1100px] border-collapse text-left text-xs text-[var(--ink)]">
                            <thead><tr>
                              {["Строка Excel", "ФИО", "Должность RU", "Должность KZ", "Удостоверение", "Протокол", "КБ", "Рег. номер", "Фото сотрудника"].map((label) => (
                                <th key={label} scope="col" className="border-b border-[var(--line)] px-2 py-2 font-medium">{label}</th>
                              ))}
                            </tr></thead>
                            <tbody>{importPreview.rows.map((row) => (
                              <tr key={row.rowNumber}>
                                {[row.rowNumber, row.fullName, row.positionRu, row.positionKz, row.certificateNumber, row.protocolNumber, row.witnessCertificateNumber, row.witnessRegistrationNumber].map((value, index) => (
                                  <td key={index} className="max-w-64 break-words border-b border-[var(--line)] px-2 py-2">{value || "—"}</td>
                                ))}
                                <td className="min-w-56 border-b border-[var(--line)] px-2 py-2 align-top">
                                  <div className="space-y-2">
                                    <p>
                                      {!importPhotos[row.rowNumber] ? "Фото не выбрано" :
                                        importPhotos[row.rowNumber].status === "processing" ? "Фото обрабатывается…" :
                                          importPhotos[row.rowNumber].status === "error" ? "Ошибка фото" :
                                            importPhotos[row.rowNumber].source === "excel" ? "Фото из Excel" : "Фото из отдельного файла"}
                                    </p>
                                    {importPhotos[row.rowNumber]?.status === "ready" ? (
                                      // A locally prepared data URL never leaves the browser before submission.
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={importPhotos[row.rowNumber].dataUrl} alt={`Фото, строка ${row.rowNumber}`} className="h-16 w-12 rounded object-cover" />
                                    ) : null}
                                    {importPhotos[row.rowNumber]?.message ? <p role="alert" className="text-rose-700">{importPhotos[row.rowNumber].message}</p> : null}
                                    <label htmlFor={`import-photo-${row.rowNumber}`} className="block font-medium">Выбрать JPG или PNG для строки {row.rowNumber}</label>
                                    <input id={`import-photo-${row.rowNumber}`} type="file" accept="image/jpeg,image/png" disabled={isImportApplied || isSubmitting}
                                      onChange={(event) => {
                                        const file = event.target.files?.[0];
                                        event.target.value = "";
                                        if (file) queueImportPhoto(row.rowNumber, file, "file");
                                      }}
                                      className="block max-w-56 text-xs text-[var(--muted)] file:mr-2 file:rounded file:border file:border-[var(--line)] file:bg-[var(--surface)] file:px-2 file:py-1" />
                                    {importPhotos[row.rowNumber] ? <button type="button" disabled={isImportApplied || isSubmitting} onClick={() => clearImportPhoto(row.rowNumber)} className="underline underline-offset-2 disabled:opacity-50">Убрать фото</button> : null}
                                  </div>
                                </td>
                              </tr>
                            ))}</tbody>
                          </table>
                        </div>
                        </>
                      ) : null}
                      {!isImportApplied && getWorkbookSettingsError(importPreview) ? (
                        <p role="alert" className="text-sm text-rose-700">{getWorkbookSettingsError(importPreview)}</p>
                      ) : null}
                      {!isImportApplied && Object.values(importPhotos).some((photo) => photo.status === "processing") ? <p className="text-sm text-[var(--muted)]">Дождитесь обработки фотографий.</p> : null}
                      {!isImportApplied && Object.values(importPhotos).some((photo) => photo.status === "error") ? <p role="alert" className="text-sm text-rose-700">Исправьте ошибки фотографий или уберите их из соответствующих строк.</p> : null}
                      <p className="text-xs leading-5 text-[var(--muted)]">
                        {isImportApplied
                          ? "Строки уже добавлены. Закройте просмотр или выберите другой файл."
                          : "К новым строкам применятся текущие настройки документов. Пустые номера будут автоматическими. Проверьте компанию, вид документа, тему и фото перед формированием заявки."}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" size="sm" onClick={handleAddWorkbookRows}
                          disabled={isImportApplied || !importPreview.rows.length || !!importPreview.errors.length || !!getWorkbookSettingsError(importPreview) || Object.values(importPhotos).some((photo) => photo.status !== "ready") || isRefreshingDefaults || isSubmitting}>
                          {isImportApplied ? "Добавлено" : "Добавить строки в заявку"}
                        </Button>
                        <Button type="button" size="sm" variant="secondary" onClick={cancelWorkbookImport}>{isImportApplied ? "Закрыть" : "Отменить"}</Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table
                  className={cn(
                    "border-collapse text-sm",
                    tableUsesWitness
                      ? "min-w-[1720px]"
                      : tableUsesPhoto
                        ? "min-w-[1540px]"
                        : "min-w-[1340px]",
                  )}
                >
                  <thead>
                    <tr>
                      <th className="w-[52px] border-b border-r border-[var(--line)] bg-[color:rgba(238,244,255,0.8)] px-3 py-2.5 text-left text-xs font-medium text-[var(--muted)]">
                        №
                      </th>
                      <th className="min-w-[190px] border-b border-r border-[var(--line)] bg-[color:rgba(238,244,255,0.8)] px-3 py-2.5 text-left text-xs font-medium text-[var(--muted)]">
                        Настройки
                      </th>
                      <th className="min-w-[220px] border-b border-r border-[var(--line)] bg-[color:rgba(238,244,255,0.8)] px-3 py-2.5 text-left text-xs font-medium text-[var(--muted)]">
                        ФИО
                      </th>
                      <th className="min-w-[210px] border-b border-r border-[var(--line)] bg-[color:rgba(238,244,255,0.8)] px-3 py-2.5 text-left text-xs font-medium text-[var(--muted)]">
                        {roleTableLabelRu}
                      </th>
                      <th className="min-w-[210px] border-b border-r border-[var(--line)] bg-[color:rgba(238,244,255,0.8)] px-3 py-2.5 text-left text-xs font-medium text-[var(--muted)]">
                        {roleTableLabelKz}
                      </th>
                      {tableUsesPhoto ? (
                        <th className="min-w-[200px] border-b border-r border-[var(--line)] bg-[color:rgba(238,244,255,0.8)] px-3 py-2.5 text-left text-xs font-medium text-[var(--muted)]">
                          Фото
                        </th>
                      ) : null}
                      <th className="min-w-[170px] border-b border-r border-[var(--line)] bg-[color:rgba(238,244,255,0.8)] px-3 py-2.5 text-left text-xs font-medium text-[var(--muted)]">
                        Номер удостоверения
                      </th>
                      {tableUsesProtocol ? (
                        <th className="min-w-[190px] border-b border-r border-[var(--line)] bg-[color:rgba(238,244,255,0.8)] px-3 py-2.5 text-left text-xs font-medium text-[var(--muted)]">
                          Протокол № / основание
                        </th>
                      ) : null}
                      {tableUsesWitness ? (
                        <>
                          <th className="min-w-[180px] border-b border-r border-[var(--line)] bg-[color:rgba(238,244,255,0.8)] px-3 py-2.5 text-left text-xs font-medium text-[var(--muted)]">
                            Номер КБ
                          </th>
                          <th className="min-w-[170px] border-b border-r border-[var(--line)] bg-[color:rgba(238,244,255,0.8)] px-3 py-2.5 text-left text-xs font-medium text-[var(--muted)]">
                            Регистрационный номер
                          </th>
                        </>
                      ) : null}
                      <th className="w-[92px] border-b border-[var(--line)] bg-[color:rgba(238,244,255,0.8)] px-3 py-2.5 text-left text-xs font-medium text-[var(--muted)]">
                        Действия
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => (
                      <tr key={row.id} className="bg-[var(--surface)]">
                        <td className="border-b border-r border-[var(--line)] px-3 py-2.5 text-sm text-[var(--muted)]">
                          {index + 1}
                        </td>
                        <td className="border-b border-r border-[var(--line)] px-3 py-2 align-middle">
                          <div className="grid min-w-0 gap-1.5">
                            <button
                              type="button"
                              className="min-w-0 rounded-md px-1 py-1 text-left outline-none transition-colors duration-150 hover:bg-[var(--surface-muted)] focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                              onClick={() => openRowSettings(row.id)}
                            >
                              <span className="block truncate text-sm font-medium text-[var(--ink)]">
                                {getRowTypesLabel(row)}
                              </span>
                              <span className="mt-0.5 block text-xs text-[var(--muted)]">
                                Настройки строки
                              </span>
                            </button>
                            <Input
                              type="date"
                              className="h-8 px-2 text-xs"
                              value={row.issueDate}
                              disabled={isEditMode}
                              aria-label={`Дата выдачи строки ${index + 1}`}
                              onInput={(event) =>
                                updateRowIssueDate(
                                  row.id,
                                  event.currentTarget.value,
                                )
                              }
                              onChange={(
                                event: ChangeEvent<HTMLInputElement>,
                              ) =>
                                updateRowIssueDate(row.id, event.target.value)
                              }
                            />
                          </div>
                        </td>
                        <td className="border-b border-r border-[var(--line)] p-0 align-middle">
                          {renderEditableCell(row, "fullName", "ФИО")}
                        </td>
                        <td className="border-b border-r border-[var(--line)] p-0 align-middle">
                          {renderEditableCell(
                            row,
                            "positionRu",
                            roleFieldPlaceholderRu,
                          )}
                        </td>
                        <td className="border-b border-r border-[var(--line)] p-0 align-middle">
                          {renderEditableCell(
                            row,
                            "positionKz",
                            roleFieldPlaceholderKz,
                          )}
                        </td>
                        {tableUsesPhoto ? (
                          <td className="border-b border-r border-[var(--line)] p-0 align-middle">
                            {renderEditableCell(row, "photo", "Добавить фото")}
                          </td>
                        ) : null}
                        <td className="border-b border-r border-[var(--line)] p-0 align-middle">
                          {renderEditableCell(
                            row,
                            "certificateNumber",
                            "Номер удостоверения",
                          )}
                        </td>
                        {tableUsesProtocol ? (
                          <td className="border-b border-r border-[var(--line)] p-0 align-middle">
                            {renderEditableCell(row, "protocolNumber")}
                          </td>
                        ) : null}
                        {tableUsesWitness ? (
                          <>
                            <td className="border-b border-r border-[var(--line)] p-0 align-middle">
                              {renderEditableCell(
                                row,
                                "witnessCertificateNumber",
                                "Номер КБ",
                              )}
                            </td>
                            <td className="border-b border-r border-[var(--line)] p-0 align-middle">
                              {renderEditableCell(
                                row,
                                "witnessRegistrationNumber",
                                "Регистрационный номер",
                              )}
                            </td>
                          </>
                        ) : null}
                        <td className="border-b border-[var(--line)] px-3 py-2.5 align-middle">
                          <button
                            type="button"
                            className="inline-flex h-8 items-center rounded-md border border-[var(--line)] px-2.5 text-[11px] font-medium text-[var(--ink)] transition-colors duration-150 hover:bg-[var(--surface-muted)]"
                            onClick={() => handleRemoveRow(row.id)}
                          >
                            Убрать
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </EditorSection>
          </div>

          <aside className="hidden">
            <section className={workspaceSurfaceClass}>
              <div className="border-b border-[var(--line)] px-5 py-4">
                <h2 className="text-base font-semibold text-[var(--ink)]">
                  Сводка заявки
                </h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Ключевые настройки и контекст текущего набора документов.
                </p>
              </div>
              <div className="space-y-4 px-5 py-5">
                <div className="flex flex-wrap gap-2">
                  <Badge tone={isEditMode ? "amber" : "blue"}>
                    {isEditMode ? "Редактирование" : "Новая заявка"}
                  </Badge>
                  <Badge tone="blue">{generationModeLabel}</Badge>
                  <Badge tone="green">
                    {rows.length}{" "}
                    {rows.length === 1
                      ? "строка"
                      : rows.length < 5
                        ? "строки"
                        : "строк"}
                  </Badge>
                </div>

                <SummaryStat
                  label="Шаблоны"
                  value={selectedTypesLabel || "Не выбрано"}
                  hint={
                    isMultiTypeSelection
                      ? "Система создаст отдельную заявку по каждому типу."
                      : getCertificateTypeLabel(
                          certificateType,
                          activeBiotDocumentKind,
                        )
                  }
                />
                <SummaryStat
                  label="Дата выдачи"
                  value={formatHumanDate(issueDate)}
                  hint={
                    singleSelectionUsesTrainingSubject
                      ? effectiveTrainingSubject || "Тема обучения не указана"
                      : "Используется для автонумерации и постоянных полей."
                  }
                />
                {hasRoleSelection ? (
                  <SummaryStat
                    label="Срок действия"
                    value={formatValidityLabel(biotDocumentKind)}
                    hint={`${getDocumentCategoryLabel(biotDocumentKind)}: фиксированно ${formatValidityLabel(
                      biotDocumentKind,
                    )}.`}
                  />
                ) : null}
                <SummaryStat
                  label="Контекст"
                  value={summaryContextLabel}
                  hint={summaryContextHint}
                />
              </div>
            </section>

            <section className={workspaceSurfaceClass}>
              <div className="border-b border-[var(--line)] px-5 py-4">
                <h2 className="text-base font-semibold text-[var(--ink)]">
                  Автонумерация
                </h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Следующие номера для текущего шаблона.
                </p>
              </div>
              <div className="space-y-3 px-5 py-5">
                <SummaryStat
                  label={singleSelectionCertificateNumberLabel}
                  value={
                    isMultiTypeSelection
                      ? selectedTypesLabel
                      : formatCertificateNumber(
                          certificateType,
                          issueDate,
                          defaults.nextCertificateSequence,
                          activeBiotDocumentKind,
                        )
                  }
                  hint={
                    isMultiTypeSelection
                      ? "Для каждого вида номера будут назначены отдельно."
                      : "Стартовое значение для следующей записи."
                  }
                />

                {singleSelectionUsesProtocol ? (
                  <SummaryStat
                    label={getProtocolNumberLabel(
                      certificateType,
                      activeBiotDocumentKind,
                    )}
                    value={
                      isMultiTypeSelection
                        ? "Номера назначатся автоматически"
                        : formatProtocolNumber(
                            certificateType,
                            issueDate,
                            defaults.nextProtocolSequence,
                            activeBiotDocumentKind,
                          )
                    }
                  />
                ) : null}

                {singleSelectionUsesWitness &&
                activeBiotDocumentKind !== "ITR_CERTIFICATE" ? (
                  <>
                    <SummaryStat
                      label="Номер КБ"
                      value={formatPsWitnessCertificateNumber(
                        issueDate,
                        defaults.nextWitnessCertificateSequence ?? 1,
                      )}
                    />
                    <SummaryStat
                      label="Регистрационный номер"
                      value={formatPsWitnessRegistrationNumber(
                        defaults.nextWitnessRegistrationSequence ?? 1,
                      )}
                    />
                  </>
                ) : null}
              </div>
            </section>

            <section className={workspaceSurfaceClass}>
              <div className="border-b border-[var(--line)] px-5 py-4">
                <h2 className="text-base font-semibold text-[var(--ink)]">
                  Действия
                </h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Финальное действие вынесено отдельно, чтобы не спорить с
                  рабочей таблицей.
                </p>
              </div>
              <div className="space-y-3 px-5 py-5">
                <p className="text-sm leading-6 text-[var(--muted)]">
                  {isEditMode
                    ? "После сохранения повторные выгрузки будут использовать обновлённые данные этой же заявки."
                    : "После формирования новая заявка появится в сохранённом списке ниже."}
                </p>
                <Button
                  type="submit"
                  disabled={isSubmitting || isRefreshingDefaults}
                  className="hidden w-full xl:inline-flex"
                >
                  {isSubmitting
                    ? "Сохранение..."
                    : isEditMode
                      ? "Сохранить изменения"
                      : "Сформировать заявки"}
                </Button>
              </div>
            </section>
          </aside>
        </div>

        {isEditMode ? (
          <div className="flex justify-start">
            <Button
              type="submit"
              disabled={isSubmitting || isRefreshingDefaults}
            >
              {isSubmitting ? "Сохранение..." : "Сохранить изменения"}
            </Button>
          </div>
        ) : null}
      </form>

      {!isEditMode ? (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <Button
            form="biot-card-generator-form"
            type="submit"
            disabled={isSubmitting || isRefreshingDefaults}
            className="w-full lg:w-auto lg:shrink-0"
          >
            {isSubmitting ? "Сохранение..." : "Сформировать заявки"}
          </Button>

          <section className="w-full rounded-xl border border-[var(--line)] bg-[color:rgba(255,255,255,0.84)] lg:w-[720px] lg:max-w-full">
            <details ref={historyDetailsRef} open className="group">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-5 py-4 [&::-webkit-details-marker]:hidden">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold text-[var(--ink)]">
                      История заявок
                    </h2>
                    <Badge tone="slate">{savedRequests.length}</Badge>
                  </div>
                  <p className="text-sm leading-6 text-[var(--muted)]">
                    Компания и количество сотрудников в каждой заявке. Откройте
                    состав, чтобы посмотреть список сотрудников.
                  </p>
                  {!canManageSavedRequests ? (
                    <p className="text-xs text-slate-400">
                      Редактирование и удаление доступны только администратору
                      компании.
                    </p>
                  ) : null}
                </div>
                <span className="inline-flex h-9 items-center rounded-md border border-[var(--line)] px-3 text-xs font-medium text-[var(--ink)]">
                  <span className="group-open:hidden">Открыть список</span>
                  <span className="hidden group-open:inline">Свернуть список</span>
                </span>
              </summary>

              <div className="border-t border-[var(--line)]">
                {savedRequests.length > 0 ? (
                  <TableWrapper className="rounded-none border-0 bg-transparent">
                    <Table className="min-w-[980px]">
                      <thead>
                        <tr>
                          <Th className="min-w-[260px] bg-[color:rgba(238,244,255,0.7)] text-xs font-medium text-[var(--muted)]">
                            Компания / заявка
                          </Th>
                          <Th className="min-w-[120px] bg-[color:rgba(238,244,255,0.7)] text-xs font-medium text-[var(--muted)]">
                            Тип
                          </Th>
                          <Th className="min-w-[120px] bg-[color:rgba(238,244,255,0.7)] text-xs font-medium text-[var(--muted)]">
                            Дата выдачи
                          </Th>
                          <Th className="min-w-[120px] bg-[color:rgba(238,244,255,0.7)] text-xs font-medium text-[var(--muted)]">
                            Сотрудников
                          </Th>
                          <Th className="min-w-[240px] bg-[color:rgba(238,244,255,0.7)] text-xs font-medium text-[var(--muted)]">
                            Диапазон номеров
                          </Th>
                          <Th className="min-w-[180px] bg-[color:rgba(238,244,255,0.7)] text-xs font-medium text-[var(--muted)]">
                            Создана
                          </Th>
                          <Th className="min-w-[220px] bg-[color:rgba(238,244,255,0.7)] text-xs font-medium text-[var(--muted)]">
                            Действия
                          </Th>
                        </tr>
                      </thead>
                      <tbody>
                        {savedRequests.map((request) => (
                          <tr
                            key={request.id}
                            id={`card-request-${request.id}`}
                            className="border-t border-[var(--line)]"
                          >
                            <Td>
                              <div>
                                <p className="font-medium text-[var(--ink)]">
                                  {request.requestCompanyRu?.trim() ||
                                    request.requestCompanyKz?.trim() ||
                                    "Компания не указана"}
                                </p>
                                <p className="mt-1 text-xs text-[var(--muted)]">
                                  {request.title}
                                </p>
                                {getRequestBundleLabel(request) ? (
                                  <p className="mt-1 text-xs text-slate-400">
                                    Комплект: {getRequestBundleLabel(request)}
                                  </p>
                                ) : null}
                                <details className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--surface-muted)]">
                                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-medium text-[var(--muted)] [&::-webkit-details-marker]:hidden">
                                    <span>Сотрудники: {request.itemsCount}</span>
                                    <span className="text-slate-400">
                                      Открыть
                                    </span>
                                  </summary>
                                  <div className="border-t border-[var(--line)] px-3 py-3">
                                    <div className="overflow-x-auto">
                                      <table className="min-w-full text-left text-xs text-[var(--muted)]">
                                        <thead>
                                          <tr className="border-b border-[var(--line)] text-[var(--muted)]">
                                            <th className="pb-2 pr-4 font-medium">
                                              ФИО
                                            </th>
                                            <th className="pb-2 pr-4 font-medium">
                                              Должность
                                            </th>
                                            <th className="pb-2 pr-4 font-medium">
                                              № удостоверения
                                            </th>
                                            <th className="pb-2 pr-4 font-medium">
                                              № протокола
                                            </th>
                                            <th className="pb-2 pr-4 font-medium">
                                              № КБ
                                            </th>
                                            <th className="pb-2 font-medium">
                                              Рег. №
                                            </th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {request.items.map((item) => (
                                            <tr
                                              key={item.id}
                                              className="border-t border-[var(--line)]"
                                            >
                                              <td className="py-2 pr-4 text-[var(--ink)]">
                                                <div>
                                                  <p>{item.fullName}</p>
                                                  {item.fullNameKz &&
                                                  item.fullNameKz !==
                                                    item.fullName ? (
                                                    <p className="mt-1 text-[11px] text-[var(--muted)]">
                                                      {item.fullNameKz}
                                                    </p>
                                                  ) : null}
                                                </div>
                                              </td>
                                              <td className="py-2 pr-4">
                                                {formatRequestPosition(item)}
                                              </td>
                                              <td className="py-2 pr-4">
                                                {item.certificateNumber || "-"}
                                              </td>
                                              <td className="py-2 pr-4">
                                                {item.protocolNumber || "-"}
                                              </td>
                                              <td className="py-2 pr-4">
                                                {item.witnessCertificateNumber ||
                                                  "-"}
                                              </td>
                                              <td className="py-2">
                                                {item.witnessRegistrationNumber ||
                                                  "-"}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                </details>
                              </div>
                            </Td>
                            <Td>{getRequestTypeLabel(request)}</Td>
                            <Td>{formatHumanDate(request.issueDate)}</Td>
                            <Td>{request.itemsCount}</Td>
                            <Td>
                              <div className="text-sm text-[var(--ink)]">
                                <p>
                                  {request.includeCard ||
                                  (request.certificateType === "BIOT" &&
                                    request.biotDocumentKind ===
                                      "ITR_CERTIFICATE")
                                    ? `Уд.: ${request.firstCertificateNumber ?? "-"}${
                                        request.lastCertificateNumber &&
                                        request.lastCertificateNumber !==
                                          request.firstCertificateNumber
                                          ? ` -> ${request.lastCertificateNumber}`
                                          : ""
                                      }`
                                    : "Уд.: не включено"}
                                </p>
                                <p className="mt-1 text-xs text-[var(--muted)]">
                                  Прот.: {request.firstProtocolNumber ?? "-"}
                                  {request.lastProtocolNumber &&
                                  request.lastProtocolNumber !==
                                    request.firstProtocolNumber
                                    ? ` -> ${request.lastProtocolNumber}`
                                    : ""}
                                </p>
                                {request.witnessExportAvailable ? (
                                  <>
                                    <p className="mt-1 text-xs text-[var(--muted)]">
                                      КБ:{" "}
                                      {request.firstWitnessCertificateNumber ??
                                        "-"}
                                      {request.lastWitnessCertificateNumber &&
                                      request.lastWitnessCertificateNumber !==
                                        request.firstWitnessCertificateNumber
                                        ? ` -> ${request.lastWitnessCertificateNumber}`
                                        : ""}
                                    </p>
                                    <p className="mt-1 text-xs text-[var(--muted)]">
                                      Рег.:{" "}
                                      {request.firstWitnessRegistrationNumber ??
                                        "-"}
                                      {request.lastWitnessRegistrationNumber &&
                                      request.lastWitnessRegistrationNumber !==
                                        request.firstWitnessRegistrationNumber
                                        ? ` -> ${request.lastWitnessRegistrationNumber}`
                                        : ""}
                                    </p>
                                  </>
                                ) : null}
                              </div>
                            </Td>
                            <Td>
                              <div>
                                <p className="text-sm text-[var(--ink)]">
                                  {formatHumanDateTime(request.createdAt)}
                                </p>
                                <p className="mt-1 text-xs text-[var(--muted)]">
                                  {request.createdByUserName}
                                </p>
                              </div>
                            </Td>
                            <Td>
                              <div className="flex flex-wrap gap-2">
                                {request.includeCard ||
                                (request.certificateType === "BIOT" &&
                                  request.biotDocumentKind ===
                                    "ITR_CERTIFICATE") ||
                                (request.certificateType === "PS" &&
                                  request.biotDocumentKind ===
                                    "ITR_CERTIFICATE") ? (
                                  <a
                                    href={buildScopedDownloadHref(
                                      `/api/biot-cards/requests/${request.id}/cards`,
                                      companyId,
                                    )}
                                    className="inline-flex rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs font-medium text-[var(--ink)] transition-colors duration-150 hover:bg-[var(--surface-muted)]"
                                  >
                                    {getDocumentDownloadLabel(request)}
                                  </a>
                                ) : null}
                                {canManageSavedRequests ? (
                                  <a
                                    href={
                                      companyId
                                        ? `/certificates/requests/${request.id}/edit?companyId=${companyId}`
                                        : `/certificates/requests/${request.id}/edit`
                                    }
                                    className="inline-flex rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs font-medium text-[var(--ink)] transition-colors duration-150 hover:bg-[var(--surface-muted)]"
                                  >
                                    Редактировать
                                  </a>
                                ) : null}
                                {canManageSavedRequests ? (
                                  <button
                                    type="button"
                                    disabled={deletingRequestId === request.id}
                                    onClick={() =>
                                      void handleDeleteRequest(
                                        request.id,
                                        request.title,
                                      )
                                    }
                                    className="inline-flex rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 transition-colors duration-150 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {deletingRequestId === request.id
                                      ? "Удаление..."
                                      : "Удалить"}
                                  </button>
                                ) : null}
                                {request.witnessExportAvailable &&
                                !(
                                  request.certificateType === "PS" &&
                                  request.biotDocumentKind === "ITR_CERTIFICATE"
                                ) ? (
                                  <a
                                    href={buildScopedDownloadHref(
                                      `/api/biot-cards/requests/${request.id}/witness`,
                                      companyId,
                                    )}
                                    className="inline-flex rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs font-medium text-[var(--ink)] transition-colors duration-150 hover:bg-[var(--surface-muted)]"
                                  >
                                    Свидетельство DOCX
                                  </a>
                                ) : null}
                                {request.protocolExportAvailable ? (
                                  <a
                                    href={buildScopedDownloadHref(
                                      `/api/biot-cards/requests/${request.id}/protocol`,
                                      companyId,
                                    )}
                                    className="inline-flex rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs font-medium text-[var(--ink)] transition-colors duration-150 hover:bg-[var(--surface-muted)]"
                                  >
                                    Протокол DOCX
                                  </a>
                                ) : null}
                              </div>
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </TableWrapper>
                ) : (
                  <div className="px-5 py-6 text-sm text-[var(--muted)]">
                    Пока нет сохраненных заявок. После первой генерации заявка
                    появится здесь автоматически.
                  </div>
                )}
              </div>
            </details>
          </section>
        </div>
      ) : null}
    </div>
  );
}

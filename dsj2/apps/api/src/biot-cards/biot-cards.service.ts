import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import type {
  BiotDocumentKind,
  BiotCardDefaultsQuery,
  CardGenerationRequestQuery,
  GenerateBiotCardBatchInput,
  GenerateBiotCardBatchItem,
  GenerateBiotCardInput,
  SafetyCardType,
  UpdateCardGenerationRequestInput,
} from "@dsj/types";
import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../common/types/authenticated-user.type";
import {
  assertPythonModuleAvailable,
  assertPython3Available,
  assertReadablePath,
  getPythonCommand,
  getPythonProcessEnv,
} from "../common/utils/runtime-dependencies";
import { requireCompanyScope } from "../common/utils/tenant-scope";
import {
  getWorkspaceRoot,
  resolveWorkspacePath,
} from "../common/utils/workspace-path";
import { PrismaService } from "../database/prisma.service";

type TemplateFieldMap = Record<string, string>;
type EmployeeTemplateSource = Awaited<
  ReturnType<BiotCardsService["ensureEmployee"]>
>;
type TrainingTemplateSource = Awaited<
  ReturnType<BiotCardsService["ensureTrainingAssignment"]>
>;
type CardPhotoAsset = {
  dataUrl: string;
  fileName: string | null;
};
type TemplateTextReplacement = {
  matchText: string;
  replaceText: string;
  mode?: "paragraph" | "text" | "styled_paragraph";
  rightTabStopPt?: number;
  segments?: Array<{
    text: string;
    bold?: boolean;
  }>;
};
type FieldStyleOverrideMap = Record<
  string,
  {
    fontSize?: number;
  }
>;
type PhotoSlotConfig =
  | {
      mode: "existing_rect";
      rectId: string;
    }
  | {
      mode: "floating_rect";
      shapeId: string;
      style: string;
    };
type TemplateRenderRow = {
  fields: TemplateFieldMap;
  photo: CardPhotoAsset | null;
  textReplacements?: TemplateTextReplacement[];
};

type BatchPreparedItem = {
  fields: TemplateFieldMap;
  employeeId: string | null;
  certificateNumber: string;
  protocolNumber: string;
  witnessCertificateNumber: string | null;
  witnessRegistrationNumber: string | null;
  trainingAssignmentId: string | null;
  trainingSubject: string;
  fileName: string;
  certificateType: SafetyCardType;
  fullName: string;
  fullNameKz: string | null;
  issuedTo: string;
  positionRu: string | null;
  positionKz: string | null;
  workplaceRu: string | null;
  workplaceKz: string | null;
  photo: CardPhotoAsset | null;
  biotDocumentKind: BiotDocumentKind;
};

type ResolvedBundleOptions = {
  includeCard: boolean;
  includeProtocol: boolean;
  includeWitness: boolean;
};

const CARD_TYPE_CONFIG: Record<
  SafetyCardType,
  {
    code: string;
    label: string;
    defaultTrainingSubject: string;
    trainingSubjectPresets: string[];
    singleFilePrefix: string;
    previewFileName: string;
    templatePath: string;
    protocolTemplatePath?: string | null;
    protocolPreviewFileName?: string | null;
  }
> = {
  BIOT: {
    code: "БТ",
    label: "БиОТ",
    defaultTrainingSubject: "Еқ және ЕҚ/БиОТ",
    trainingSubjectPresets: ["Еқ және ЕҚ/БиОТ"],
    singleFilePrefix: "biot-card",
    previewFileName: "biot-preview-all.docx",
    templatePath: "docs/experimental/biot/biot-card-template.docx",
    protocolTemplatePath: "docs/experimental/biot/biot-protocol-template.docx",
    protocolPreviewFileName: "biot-protocol-preview-all.docx",
  },
  PTM: {
    code: "ПТМ",
    label: "ПТМ",
    defaultTrainingSubject: "ПТМ",
    trainingSubjectPresets: ["ПТМ"],
    singleFilePrefix: "ptm-card",
    previewFileName: "ptm-preview-all.docx",
    templatePath: "docs/experimental/ptm/ptm-card-template.docx",
    protocolTemplatePath: "docs/experimental/ptm/ptm-protocol-template.docx",
    protocolPreviewFileName: "ptm-protocol-preview-all.docx",
  },
  PB: {
    code: "ПБ",
    label: "ПБ",
    defaultTrainingSubject:
      'ПОПБ на ОПО согласно Закону РК от 2014 года №188-V "О гражданской защите"/Қауіпті өндірістік объектілердегі өнеркәсіптік қауіпсіздік "азаматтық қорғау туралы"ҚР 2014 жылғы №188-V Заңына сәйкес',
    trainingSubjectPresets: [
      'ПОПБ на ОПО согласно Закону РК от 2014 года №188-V "О гражданской защите"/Қауіпті өндірістік объектілердегі өнеркәсіптік қауіпсіздік "азаматтық қорғау туралы"ҚР 2014 жылғы №188-V Заңына сәйкес',
    ],
    singleFilePrefix: "pb-card",
    previewFileName: "pb-preview-all.docx",
    templatePath: "docs/experimental/pb/pb-card-template.docx",
    protocolTemplatePath: "docs/experimental/pb/pb-protocol-template.docx",
    protocolPreviewFileName: "pb-protocol-preview-all.docx",
  },
  PS: {
    code: "ПС",
    label: "ПС",
    defaultTrainingSubject: "ПС",
    trainingSubjectPresets: ["ПС"],
    singleFilePrefix: "ps-card",
    previewFileName: "ps-preview-all.docx",
    templatePath: "docs/experimental/ps/ps-card-template.docx",
    protocolTemplatePath: "docs/experimental/ps/ps-protocol-template.docx",
    protocolPreviewFileName: "ps-protocol-preview-all.docx",
  },
};

const CARD_PHOTO_CONFIG: Partial<
  Record<
    SafetyCardType,
    {
      slot: PhotoSlotConfig;
    }
  >
> = {
  PTM: {
    slot: {
      mode: "floating_rect",
      shapeId: "DSJPhotoSlotPTM",
      style:
        "position:absolute;margin-left:215.4pt;margin-top:123.75pt;width:51pt;height:67.5pt;z-index:251689984;visibility:visible;mso-wrap-style:square;mso-width-percent:0;mso-height-percent:0;mso-wrap-distance-left:9pt;mso-wrap-distance-top:0;mso-wrap-distance-right:9pt;mso-wrap-distance-bottom:0;mso-position-horizontal:absolute;mso-position-horizontal-relative:text;mso-position-vertical:absolute;mso-position-vertical-relative:page;mso-width-relative:page;mso-height-relative:page;v-text-anchor:top",
    },
  },
  PB: {
    slot: {
      mode: "floating_rect",
      shapeId: "DSJPhotoSlotPB",
      style:
        "position:absolute;margin-left:-2.1pt;margin-top:121.5pt;width:59.8pt;height:79.65pt;z-index:251709952;visibility:visible;mso-wrap-style:square;mso-width-percent:0;mso-height-percent:0;mso-wrap-distance-left:9pt;mso-wrap-distance-top:0;mso-wrap-distance-right:9pt;mso-wrap-distance-bottom:0;mso-position-horizontal:absolute;mso-position-horizontal-relative:text;mso-position-vertical:absolute;mso-position-vertical-relative:page;mso-width-relative:page;mso-height-relative:page;v-text-anchor:top",
    },
  },
  PS: {
    slot: {
      mode: "floating_rect",
      shapeId: "DSJPhotoSlotPS",
      style:
        "position:absolute;margin-left:8pt;margin-top:108pt;width:56pt;height:74pt;z-index:251709952;visibility:visible;mso-wrap-style:square;mso-width-percent:0;mso-height-percent:0;mso-wrap-distance-left:9pt;mso-wrap-distance-top:0;mso-wrap-distance-right:9pt;mso-wrap-distance-bottom:0;mso-position-horizontal:absolute;mso-position-horizontal-relative:text;mso-position-vertical:absolute;mso-position-vertical-relative:page;mso-width-relative:page;mso-height-relative:page;v-text-anchor:top",
    },
  },
};

const PS_FIELD_STYLE_OVERRIDES: FieldStyleOverrideMap = {
  Выдано_ФИО: { fontSize: 22 },
  Біліктілік_берілгендігі_туралы: { fontSize: 22 },
  в_том_что_ему_присвоена_квалификация_: { fontSize: 22 },
  Протокол_: { fontSize: 16 },
  День_месяц: { fontSize: 16 },
  ГОД: { fontSize: 16 },
  M_1__пп: { fontSize: 13 },
  M_1_Пәндер_атауы_: { fontSize: 13 },
  M_1_Наименование_дисциплины: { fontSize: 13 },
  M_2__пп: { fontSize: 13 },
  M_2_Пәндер_атауы_: { fontSize: 13 },
  M_2_Наименование_дисциплины: { fontSize: 13 },
  Баға: { fontSize: 13 },
  Оценка: { fontSize: 13 },
};

const BIOT_PROTOCOL_DATE_PLACEHOLDER =
  "«18» қараша 2025 ж.                                                                                                               «18» ноября 2025 г.";
const BIOT_PROTOCOL_DATE_SPACER =
  "                                                                                                               ";
const BIOT_PROTOCOL_SIGNER_PLACEHOLDER = "Флеглер А.Т.";
const BIOT_PROTOCOL_SIGNER_REPLACEMENT = "Флеглер А.С.";
const PTM_PROTOCOL_COMPANY_PLACEHOLDER =
  "ТОО «Аттестационный центр Стандарт» ЖШС";
const PTM_PROTOCOL_ORDER_DATE_RU_PLACEHOLDER =
  "от «09» февраля 2026 г. № 03-П квалификационная комиссия в составе";
const PTM_PROTOCOL_ORDER_DATE_KZ_PLACEHOLDER =
  "«09» ақпан 2026 ж. «Өрт-техникалық минимум көлемінде өрт қауіпсіздігі бойынша білімді тексеру мәселелері бойынша Біліктілік комиссиясын құру туралы»";
const PTM_PROTOCOL_RESULT_DATE_PLACEHOLDER =
  "«19» ноября 2025 г. приняла экзамен по пожарной безопасности в объеме пожарно-технического минимума и установила следующие результаты/ «19» қараша 2025 ж. өрт қауіпсіздігі көлемінде өрт-техникалық минимум  білімін  тексеруді өткізді және келесі нәтижені орнатты:";
const PTM_PROTOCOL_MEMBER_ONE_PLACEHOLDER =
  "Баянов Ф. Начальник УМО ТОО «Аттестационный центр Стандарт» ЖШС ОӘБ бастығы";
const PTM_PROTOCOL_MEMBER_TWO_PLACEHOLDER =
  "Жакибеков А.Т. - Преподаватель ТОО «Аттестационный центр Стандарт» ЖШС оқытушысы";
const PTM_PROTOCOL_MEMBER_ONE_REPLACEMENT =
  "Есен Д.А. Начальник УМО ТОО «Аттестационный центр Стандарт» ЖШС ОӘБ бастығы";
const PTM_PROTOCOL_MEMBER_TWO_REPLACEMENT =
  "Флеглер А.С. - Преподаватель ТОО «Аттестационный центр Стандарт» ЖШС оқытушысы";
const PTM_PROTOCOL_SIGNER_MEMBER_ONE_PLACEHOLDER = "Баянов Ф.";
const PTM_PROTOCOL_SIGNER_MEMBER_TWO_PLACEHOLDER = "Жакибеков А.Т.";
const PTM_PROTOCOL_SIGNER_MEMBER_ONE_REPLACEMENT = "Есен Д.А.";
const PTM_PROTOCOL_SIGNER_MEMBER_TWO_REPLACEMENT = "Флеглер А.С.";
const PB_PROTOCOL_DATE_PLACEHOLDER = "«13» қараша 2025 г. «13» ноября 2025 г.";
const PB_PROTOCOL_DATE_TAB_STOP_PT = 474.75;
const PB_PROTOCOL_MEMBER_ONE_LINE_PLACEHOLDER =
  "Жакибеков А.Т. Преподаватель ТОО «Аттестационный центр Стандарт» ЖШС оқытушысы";
const PB_PROTOCOL_MEMBER_TWO_LINE_PLACEHOLDER =
  "Баянов Ф. Начальник УМО ТОО «Аттестационный центр Стандарт» ЖШС ОӘБ бастығы";
const PB_PROTOCOL_MEMBER_ONE_NAME_REPLACEMENT = "Флеглер А.С.";
const PB_PROTOCOL_MEMBER_TWO_NAME_REPLACEMENT = "Есен Д.А.";
const PB_PROTOCOL_MEMBER_ONE_ROLE_REPLACEMENT =
  " - Преподаватель ТОО «Аттестационный центр Стандарт» ЖШС оқытушысы";
const PB_PROTOCOL_MEMBER_TWO_ROLE_REPLACEMENT =
  " - Начальник УМО ТОО «Аттестационный центр Стандарт» ЖШС ОӘБ бастығы";
const PB_PROTOCOL_SIGNER_MEMBER_ONE_PLACEHOLDER = "Жакибеков А.Т.";
const PB_PROTOCOL_SIGNER_MEMBER_TWO_PLACEHOLDER = "Баянов Ф.";
const BIOT_ITR_CERTIFICATE_TEMPLATE_PATH =
  "docs/experimental/biot/biot-itr-certificate-template.docx";
const BIOT_ITR_CERTIFICATE_DATE_PLACEHOLDER = "24 марта 2026 г.";
const BIOT_ITR_CERTIFICATE_NUMBER_PLACEHOLDER = "БТ-СРТ-00001";
const BIOT_ITR_CERTIFICATE_PREVIEW_FILE_NAME =
  "biot-itr-certificates-preview-all.docx";
const PS_WITNESS_CERTIFICATE_TEMPLATE_PATH =
  "docs/experimental/ps/ps-witness-certificate-template.docx";
const PS_WITNESS_CERTIFICATE_PREVIEW_FILE_NAME =
  "ps-witness-certificates-preview-all.docx";
const PS_WITNESS_PROVIDER_ORG_RU = "ТОО Аттестационный центр Стандарт";
const PS_WITNESS_PROVIDER_ORG_KZ = "Аттестационный центр Стандарт ЖШС";
const PS_WITNESS_DEFAULT_TRAINING_DAYS = 5;
const RU_MONTH_NAMES = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];
const KZ_MONTH_NAMES = [
  "қаңтар",
  "ақпан",
  "наурыз",
  "сәуір",
  "мамыр",
  "маусым",
  "шілде",
  "тамыз",
  "қыркүйек",
  "қазан",
  "қараша",
  "желтоқсан",
];

@Injectable()
export class BiotCardsService {
  private readonly workspaceRoot = getWorkspaceRoot(__dirname);

  private readonly generatorScriptPath = resolveWorkspacePath(
    __dirname,
    "scripts/generate_biot_card.py",
  );

  private readonly psWitnessCertificateScriptPath = resolveWorkspacePath(
    __dirname,
    "scripts/generate_ps_witness_certificate.py",
  );

  private readonly mailMergeBundleScriptPath = resolveWorkspacePath(
    __dirname,
    "scripts/generate_biot_mail_merge_bundle.py",
  );

  private readonly registryExportScriptPath = resolveWorkspacePath(
    __dirname,
    "scripts/export_card_request_registry.py",
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  private getCardConfig(certificateType: SafetyCardType) {
    return CARD_TYPE_CONFIG[certificateType];
  }

  private normalizeBiotDocumentKind(
    certificateType: SafetyCardType,
    biotDocumentKind?: BiotDocumentKind | null,
  ) {
    void certificateType;

    return biotDocumentKind === "ITR_CERTIFICATE"
      ? "ITR_CERTIFICATE"
      : "WORKER_CARD";
  }

  private getCertificateValidityYears(
    biotDocumentKind?: BiotDocumentKind | null,
  ) {
    return biotDocumentKind === "ITR_CERTIFICATE" ? 3 : 1;
  }

  private getValidUntilYear(
    issueDate: Date,
    biotDocumentKind?: BiotDocumentKind | null,
  ) {
    const validUntil = new Date(issueDate);
    validUntil.setFullYear(
      validUntil.getFullYear() +
        this.getCertificateValidityYears(biotDocumentKind),
    );
    return String(validUntil.getFullYear());
  }

  private isBiotItrCertificate(
    certificateType: SafetyCardType,
    biotDocumentKind?: BiotDocumentKind | null,
  ) {
    return (
      certificateType === "BIOT" &&
      this.normalizeBiotDocumentKind(certificateType, biotDocumentKind) ===
        "ITR_CERTIFICATE"
    );
  }

  private isPsWitnessCertificate(
    certificateType: SafetyCardType,
    biotDocumentKind?: BiotDocumentKind | null,
  ) {
    return (
      certificateType === "PS" &&
      this.normalizeBiotDocumentKind(certificateType, biotDocumentKind) ===
        "ITR_CERTIFICATE"
    );
  }

  private getCardDisplayLabel(
    certificateType: SafetyCardType,
    biotDocumentKind?: BiotDocumentKind | null,
  ) {
    if (this.isBiotItrCertificate(certificateType, biotDocumentKind)) {
      return "БиОТ Сертификат ИТР";
    }

    if (this.isPsWitnessCertificate(certificateType, biotDocumentKind)) {
      return "ПС Свидетельство";
    }

    return this.getCardConfig(certificateType).label;
  }

  private getTemplatePath(certificateType: SafetyCardType) {
    return resolveWorkspacePath(
      __dirname,
      this.getCardConfig(certificateType).templatePath,
    );
  }

  private getBiotItrCertificateTemplatePath() {
    return resolveWorkspacePath(__dirname, BIOT_ITR_CERTIFICATE_TEMPLATE_PATH);
  }

  private getPsWitnessCertificateTemplatePath() {
    return resolveWorkspacePath(
      __dirname,
      PS_WITNESS_CERTIFICATE_TEMPLATE_PATH,
    );
  }

  private getProtocolTemplatePath(certificateType: SafetyCardType) {
    const templatePath =
      this.getCardConfig(certificateType).protocolTemplatePath;
    return templatePath ? resolveWorkspacePath(__dirname, templatePath) : null;
  }

  private getFieldStyleOverrides(
    certificateType?: SafetyCardType,
  ): FieldStyleOverrideMap {
    if (certificateType === "PS") {
      return PS_FIELD_STYLE_OVERRIDES;
    }

    return {};
  }

  private hasProtocolTemplate(
    certificateType: SafetyCardType,
    biotDocumentKind?: BiotDocumentKind | null,
  ) {
    if (this.isPsWitnessCertificate(certificateType, biotDocumentKind)) {
      return false;
    }

    return Boolean(this.getCardConfig(certificateType).protocolTemplatePath);
  }

  private getPhotoConfig(certificateType: SafetyCardType) {
    return CARD_PHOTO_CONFIG[certificateType] ?? null;
  }

  private requiresPhoto(
    certificateType: SafetyCardType,
    biotDocumentKind?: BiotDocumentKind | null,
  ) {
    if (this.isPsWitnessCertificate(certificateType, biotDocumentKind)) {
      return false;
    }

    return Boolean(this.getPhotoConfig(certificateType));
  }

  private normalizeOptionalText(value?: string | null) {
    const normalized = value?.trim() ?? "";
    return normalized.length > 0 ? normalized : null;
  }

  private normalizePhotoDataUrl(value?: string | null) {
    const normalized = value?.trim() ?? "";

    if (!normalized) {
      return null;
    }

    const match = normalized.match(
      /^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=]+)$/i,
    );

    if (!match) {
      throw new BadRequestException("Фото должно быть в формате JPG или PNG.");
    }

    const imageBuffer = Buffer.from(match[2], "base64");

    if (!imageBuffer.length) {
      throw new BadRequestException("Не удалось прочитать фото.");
    }

    if (imageBuffer.byteLength > 3 * 1024 * 1024) {
      throw new BadRequestException("Фото должно быть не больше 3 МБ.");
    }

    const mime =
      match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase();
    return `data:image/${mime};base64,${imageBuffer.toString("base64")}`;
  }

  private normalizePhotoFileName(value?: string | null) {
    const normalized = value?.trim() ?? "";
    return normalized.length > 0 ? normalized.slice(0, 255) : null;
  }

  private buildPhotoAsset(args: {
    certificateType: SafetyCardType;
    biotDocumentKind?: BiotDocumentKind | null;
    fullName: string | null;
    photoDataUrl?: string | null;
    photoFileName?: string | null;
    requirePhoto?: boolean;
  }) {
    const photoDataUrl = this.normalizePhotoDataUrl(args.photoDataUrl);
    const requirePhoto =
      args.requirePhoto ??
      this.requiresPhoto(args.certificateType, args.biotDocumentKind);

    if (!photoDataUrl) {
      if (requirePhoto) {
        throw new BadRequestException(
          `Добавьте фото для ${args.fullName ?? "сотрудника"}. Для этого типа корочки оно обязательно.`,
        );
      }

      return null;
    }

    return {
      dataUrl: photoDataUrl,
      fileName: this.normalizePhotoFileName(args.photoFileName),
    };
  }

  private buildPhotoRenderPayload(
    certificateType: SafetyCardType,
    photo: CardPhotoAsset | null,
  ) {
    const config = this.getPhotoConfig(certificateType);

    if (!photo || !config) {
      return null;
    }

    return {
      dataUrl: photo.dataUrl,
      fileName: photo.fileName,
      slot: config.slot,
    };
  }

  private parseIssueDate(issueDate: string) {
    const parsed = new Date(issueDate);

    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException("Укажите корректную дату выдачи.");
    }

    return parsed;
  }

  private padSequence(sequence: number) {
    return String(sequence).padStart(5, "0");
  }

  private padWideSequence(sequence: number) {
    return String(sequence).padStart(6, "0");
  }

  private getCertificateYear(issueDate: Date) {
    return String(issueDate.getFullYear()).slice(-2);
  }

  private getProtocolYear(issueDate: Date) {
    return String(issueDate.getFullYear());
  }

  private formatCertificateNumber(
    certificateType: SafetyCardType,
    issueDate: Date,
    sequence: number,
    biotDocumentKind?: BiotDocumentKind | null,
  ) {
    if (this.isBiotItrCertificate(certificateType, biotDocumentKind)) {
      return `БТ-СРТ-${this.padSequence(sequence)}`;
    }

    if (this.isPsWitnessCertificate(certificateType, biotDocumentKind)) {
      return `${this.getCertificateYear(issueDate)}/ПС/СВ-${this.padWideSequence(sequence)}`;
    }

    return `${this.getCardConfig(certificateType).code}/${this.getCertificateYear(issueDate)}-${this.padSequence(sequence)}`;
  }

  private formatProtocolNumber(
    certificateType: SafetyCardType,
    issueDate: Date,
    sequence: number,
    biotDocumentKind?: BiotDocumentKind | null,
  ) {
    if (this.isPsWitnessCertificate(certificateType, biotDocumentKind)) {
      return this.padSequence(sequence);
    }

    return `${this.getCardConfig(certificateType).code}/${this.getProtocolYear(issueDate)}-ПТ-${this.padSequence(sequence)}`;
  }

  private formatPsWitnessCertificateNumber(issueDate: Date, sequence: number) {
    return `${this.getCertificateYear(issueDate)}/ПС/СВ-${this.padWideSequence(sequence)}`;
  }

  private formatPsWitnessRegistrationNumber(sequence: number) {
    return this.padSequence(sequence);
  }

  private extractCertificateSequence(
    certificateType: SafetyCardType,
    value: string,
    issueDate: Date,
    biotDocumentKind?: BiotDocumentKind | null,
  ) {
    if (this.isBiotItrCertificate(certificateType, biotDocumentKind)) {
      const match = value.match(/^БТ-СРТ-(\d{5})$/);
      return match ? Number(match[1]) : null;
    }

    if (this.isPsWitnessCertificate(certificateType, biotDocumentKind)) {
      const match = value.match(
        new RegExp(`^${this.getCertificateYear(issueDate)}/ПС/СВ-(\\d{6})$`),
      );
      return match ? Number(match[1]) : null;
    }

    const match = value.match(
      new RegExp(
        `^${this.getCardConfig(certificateType).code}/${this.getCertificateYear(issueDate)}-(\\d{5})$`,
      ),
    );

    return match ? Number(match[1]) : null;
  }

  private extractProtocolSequence(
    certificateType: SafetyCardType,
    value: string,
    issueDate: Date,
    biotDocumentKind?: BiotDocumentKind | null,
  ) {
    if (this.isPsWitnessCertificate(certificateType, biotDocumentKind)) {
      const match = value.match(/^(\d{5})$/);
      return match ? Number(match[1]) : null;
    }

    const match = value.match(
      new RegExp(
        `^${this.getCardConfig(certificateType).code}/${this.getProtocolYear(issueDate)}-ПТ-(\\d{5})$`,
      ),
    );

    return match ? Number(match[1]) : null;
  }

  private extractPsWitnessCertificateSequence(value: string, issueDate: Date) {
    const match = value.match(
      new RegExp(`^${this.getCertificateYear(issueDate)}/ПС/СВ-(\\d{6})$`),
    );
    return match ? Number(match[1]) : null;
  }

  private extractPsWitnessRegistrationSequence(value: string) {
    const match = value.match(/^(\d{5})$/);
    return match ? Number(match[1]) : null;
  }

  private resolveBundleOptions(args: {
    certificateType: SafetyCardType;
    biotDocumentKind?: BiotDocumentKind | null;
    includeCard?: boolean | null;
    includeProtocol?: boolean | null;
    includeWitness?: boolean | null;
  }): ResolvedBundleOptions {
    if (
      this.isBiotItrCertificate(args.certificateType, args.biotDocumentKind)
    ) {
      return {
        includeCard: true,
        includeProtocol: args.includeProtocol ?? true,
        includeWitness: false,
      };
    }

    if (
      this.isPsWitnessCertificate(args.certificateType, args.biotDocumentKind)
    ) {
      return {
        includeCard: false,
        includeProtocol: false,
        includeWitness: true,
      };
    }

    if (args.certificateType !== "PS") {
      return {
        includeCard: true,
        includeProtocol: this.hasProtocolTemplate(
          args.certificateType,
          args.biotDocumentKind,
        ),
        includeWitness: false,
      };
    }

    const includeCard = args.includeCard ?? true;
    const includeProtocol = args.includeProtocol ?? true;
    const includeWitness = args.includeWitness ?? false;

    if (!includeCard && !includeProtocol && !includeWitness) {
      throw new BadRequestException(
        "Для ПС нужно выбрать хотя бы один документ: корочку, протокол или свидетельство.",
      );
    }

    return {
      includeCard,
      includeProtocol,
      includeWitness,
    };
  }

  private async populateMissingBiotItrProtocolNumbers(args: {
    user: AuthenticatedUser;
    companyId: string;
    certificateType: SafetyCardType;
    biotDocumentKind: BiotDocumentKind;
    issueDate: string;
    includeProtocol?: boolean | null;
    items: GenerateBiotCardBatchItem[];
  }) {
    const bundleOptions = this.resolveBundleOptions({
      certificateType: args.certificateType,
      biotDocumentKind: args.biotDocumentKind,
      includeProtocol: args.includeProtocol,
    });

    if (
      !this.isBiotItrCertificate(args.certificateType, args.biotDocumentKind) ||
      !bundleOptions.includeProtocol
    ) {
      return args.items;
    }

    if (
      !args.items.some(
        (item) => !this.normalizeOptionalText(item.protocolNumber),
      )
    ) {
      return args.items;
    }

    const defaults = await this.getDefaults(args.user, {
      companyId: args.companyId,
      certificateType: args.certificateType,
      biotDocumentKind: args.biotDocumentKind,
      issueDate: args.issueDate,
    });
    const issueDate = this.parseIssueDate(args.issueDate);
    const usedProtocolSequences = new Set<number>();

    for (const item of args.items) {
      const protocolNumber = this.normalizeOptionalText(item.protocolNumber);

      if (!protocolNumber) {
        continue;
      }

      const parsedSequence = this.extractProtocolSequence(
        args.certificateType,
        protocolNumber,
        issueDate,
        args.biotDocumentKind,
      );

      if (parsedSequence) {
        usedProtocolSequences.add(parsedSequence);
      }
    }

    let nextProtocolSequence = defaults.nextProtocolSequence;

    return args.items.map((item) => {
      if (this.normalizeOptionalText(item.protocolNumber)) {
        return item;
      }

      while (usedProtocolSequences.has(nextProtocolSequence)) {
        nextProtocolSequence += 1;
      }

      const protocolNumber = this.formatProtocolNumber(
        args.certificateType,
        issueDate,
        nextProtocolSequence,
        args.biotDocumentKind,
      );

      usedProtocolSequences.add(nextProtocolSequence);
      nextProtocolSequence += 1;

      return {
        ...item,
        protocolNumber,
      };
    });
  }

  private sanitizeFileNamePart(value: string) {
    return value
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  private formatIssueDayMonth(date: Date) {
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return `${day}.${month}`;
  }

  private formatIssueYear(date: Date) {
    return String(date.getFullYear());
  }

  private formatIssueYearShort(date: Date) {
    return String(date.getFullYear()).slice(-2);
  }

  private formatDayNumber(date: Date) {
    return String(date.getDate());
  }

  private formatDisplayDate(date: Date) {
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return `${day}.${month}.${date.getFullYear()}`;
  }

  private formatQuotedDay(date: Date) {
    return `«${String(date.getDate()).padStart(2, "0")}»`;
  }

  private formatRuProtocolDate(date: Date) {
    return `${this.formatQuotedDay(date)} ${RU_MONTH_NAMES[date.getMonth()]} ${date.getFullYear()} г.`;
  }

  private formatKzProtocolDate(date: Date) {
    return `${this.formatQuotedDay(date)} ${KZ_MONTH_NAMES[date.getMonth()]} ${date.getFullYear()} ж.`;
  }

  private formatRuCertificateDate(date: Date) {
    return `${date.getDate()} ${RU_MONTH_NAMES[date.getMonth()]} ${date.getFullYear()} г.`;
  }

  private formatKzCertificateDate(date: Date) {
    return `${date.getDate()} ${KZ_MONTH_NAMES[date.getMonth()]} ${date.getFullYear()} ж.`;
  }

  private formatRuMonthName(date: Date) {
    return RU_MONTH_NAMES[date.getMonth()];
  }

  private formatKzMonthName(date: Date) {
    return KZ_MONTH_NAMES[date.getMonth()];
  }

  private addDays(date: Date, days: number) {
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + days);
    return nextDate;
  }

  private combineCompanyRuKzLabel(
    workplaceRu?: string | null,
    workplaceKz?: string | null,
  ) {
    const normalizedRu = this.normalizeOptionalText(workplaceRu);
    const normalizedKz = this.normalizeOptionalText(workplaceKz);

    if (normalizedRu && normalizedKz) {
      const fullCombinedMatch = normalizedRu.match(
        /^(ТОО|ИП|АО)\s+(.+?)\s+(ЖШС|ЖК|АҚ)$/u,
      );
      if (fullCombinedMatch) {
        return normalizedRu;
      }

      const ruMatch = normalizedRu.match(/^(ТОО|ИП|АО)\s+(.+)$/u);
      const kzMatch = normalizedKz.match(/^(.+?)\s+(ЖШС|ЖК|АҚ)$/u);

      if (ruMatch && kzMatch) {
        const ruBaseName = ruMatch[2].trim();
        const kzBaseName = kzMatch[1].trim();
        const baseName =
          ruBaseName.length >= kzBaseName.length ? ruBaseName : kzBaseName;
        return `${ruMatch[1]} ${baseName} ${kzMatch[2]}`;
      }
    }

    return normalizedRu ?? normalizedKz ?? null;
  }

  private buildBilingualPositionLabel(
    positionRu?: string | null,
    positionKz?: string | null,
  ) {
    const normalizedRu = this.normalizeOptionalText(positionRu);
    const normalizedKz = this.normalizeOptionalText(positionKz);

    if (normalizedRu && normalizedKz && normalizedRu !== normalizedKz) {
      return `${normalizedRu}/${normalizedKz}`;
    }

    return normalizedRu ?? normalizedKz ?? null;
  }

  private buildBiotProtocolTextReplacements(args: {
    issueDate: Date;
    workplaceRu?: string | null;
    workplaceKz?: string | null;
  }): TemplateTextReplacement[] {
    const replacements: TemplateTextReplacement[] = [
      {
        matchText: BIOT_PROTOCOL_DATE_PLACEHOLDER,
        replaceText: `${this.formatKzProtocolDate(args.issueDate)}${BIOT_PROTOCOL_DATE_SPACER}${this.formatRuProtocolDate(args.issueDate)}`,
      },
      {
        matchText: BIOT_PROTOCOL_SIGNER_PLACEHOLDER,
        replaceText: BIOT_PROTOCOL_SIGNER_REPLACEMENT,
      },
    ];

    return replacements;
  }

  private buildPtmProtocolTextReplacements(args: {
    issueDate: Date;
    workplaceRu?: string | null;
    workplaceKz?: string | null;
  }): TemplateTextReplacement[] {
    const companyRu = this.normalizeOptionalText(args.workplaceRu);
    const companyKz = this.normalizeOptionalText(args.workplaceKz);
    const companyLabel =
      companyRu && companyKz
        ? `${companyRu} ${companyKz.split(/\s+/u).at(-1) ?? ""}`.trim()
        : (companyRu ?? companyKz ?? PTM_PROTOCOL_COMPANY_PLACEHOLDER);

    return [
      {
        matchText: PTM_PROTOCOL_COMPANY_PLACEHOLDER,
        replaceText: companyLabel,
      },
      {
        matchText: PTM_PROTOCOL_ORDER_DATE_RU_PLACEHOLDER,
        replaceText: `от ${this.formatRuProtocolDate(args.issueDate)} № 03-П квалификационная комиссия в составе`,
      },
      {
        matchText: PTM_PROTOCOL_ORDER_DATE_KZ_PLACEHOLDER,
        replaceText: `${this.formatKzProtocolDate(args.issueDate)} «Өрт-техникалық минимум көлемінде өрт қауіпсіздігі бойынша білімді тексеру мәселелері бойынша Біліктілік комиссиясын құру туралы»`,
      },
      {
        matchText: PTM_PROTOCOL_RESULT_DATE_PLACEHOLDER,
        replaceText: `${this.formatRuProtocolDate(args.issueDate)} приняла экзамен по пожарной безопасности в объеме пожарно-технического минимума и установила следующие результаты/ ${this.formatKzProtocolDate(args.issueDate)} өрт қауіпсіздігі көлемінде өрт-техникалық минимум  білімін  тексеруді өткізді және келесі нәтижені орнатты:`,
      },
      {
        matchText: PTM_PROTOCOL_MEMBER_ONE_PLACEHOLDER,
        replaceText: PTM_PROTOCOL_MEMBER_ONE_REPLACEMENT,
      },
      {
        matchText: PTM_PROTOCOL_MEMBER_TWO_PLACEHOLDER,
        replaceText: PTM_PROTOCOL_MEMBER_TWO_REPLACEMENT,
      },
      {
        matchText: PTM_PROTOCOL_SIGNER_MEMBER_ONE_PLACEHOLDER,
        replaceText: PTM_PROTOCOL_SIGNER_MEMBER_ONE_REPLACEMENT,
      },
      {
        matchText: PTM_PROTOCOL_SIGNER_MEMBER_TWO_PLACEHOLDER,
        replaceText: PTM_PROTOCOL_SIGNER_MEMBER_TWO_REPLACEMENT,
      },
    ];
  }

  private buildPbProtocolTextReplacements(args: {
    issueDate: Date;
  }): TemplateTextReplacement[] {
    return [
      {
        matchText: PB_PROTOCOL_DATE_PLACEHOLDER,
        replaceText: `${this.formatKzProtocolDate(args.issueDate)}\t${this.formatRuProtocolDate(args.issueDate)}`,
        mode: "paragraph",
        rightTabStopPt: PB_PROTOCOL_DATE_TAB_STOP_PT,
      },
      {
        matchText: PB_PROTOCOL_MEMBER_ONE_LINE_PLACEHOLDER,
        replaceText: `${PB_PROTOCOL_MEMBER_ONE_NAME_REPLACEMENT}${PB_PROTOCOL_MEMBER_ONE_ROLE_REPLACEMENT}`,
        mode: "styled_paragraph",
        segments: [
          {
            text: PB_PROTOCOL_MEMBER_ONE_NAME_REPLACEMENT,
            bold: true,
          },
          {
            text: PB_PROTOCOL_MEMBER_ONE_ROLE_REPLACEMENT,
            bold: false,
          },
        ],
      },
      {
        matchText: PB_PROTOCOL_MEMBER_TWO_LINE_PLACEHOLDER,
        replaceText: `${PB_PROTOCOL_MEMBER_TWO_NAME_REPLACEMENT}${PB_PROTOCOL_MEMBER_TWO_ROLE_REPLACEMENT}`,
        mode: "styled_paragraph",
        segments: [
          {
            text: PB_PROTOCOL_MEMBER_TWO_NAME_REPLACEMENT,
            bold: true,
          },
          {
            text: PB_PROTOCOL_MEMBER_TWO_ROLE_REPLACEMENT,
            bold: false,
          },
        ],
      },
      {
        matchText: PB_PROTOCOL_SIGNER_MEMBER_ONE_PLACEHOLDER,
        replaceText: PB_PROTOCOL_MEMBER_ONE_NAME_REPLACEMENT,
        mode: "styled_paragraph",
        segments: [
          {
            text: PB_PROTOCOL_MEMBER_ONE_NAME_REPLACEMENT,
            bold: true,
          },
        ],
      },
      {
        matchText: PB_PROTOCOL_SIGNER_MEMBER_TWO_PLACEHOLDER,
        replaceText: PB_PROTOCOL_MEMBER_TWO_NAME_REPLACEMENT,
        mode: "styled_paragraph",
        segments: [
          {
            text: PB_PROTOCOL_MEMBER_TWO_NAME_REPLACEMENT,
            bold: true,
          },
        ],
      },
    ];
  }

  private formatRequestTitle(args: {
    certificateType: SafetyCardType;
    biotDocumentKind: BiotDocumentKind;
    includeCard?: boolean | null;
    includeProtocol?: boolean | null;
    includeWitness?: boolean | null;
    issueDate: Date;
    itemsCount: number;
    requestCompanyRu?: string | null;
    requestCompanyKz?: string | null;
  }) {
    const bundleOptions = this.resolveBundleOptions({
      certificateType: args.certificateType,
      biotDocumentKind: args.biotDocumentKind,
      includeCard: args.includeCard,
      includeProtocol: args.includeProtocol,
      includeWitness: args.includeWitness,
    });
    const companyLabel =
      this.normalizeOptionalText(args.requestCompanyRu) ??
      this.normalizeOptionalText(args.requestCompanyKz);
    const displayLabel =
      args.certificateType === "PS" &&
      bundleOptions.includeWitness &&
      !bundleOptions.includeCard
        ? "ПС Свидетельство"
        : args.certificateType === "PS" &&
            bundleOptions.includeWitness &&
            bundleOptions.includeCard
          ? "ПС комплект"
          : this.getCardDisplayLabel(
              args.certificateType,
              args.biotDocumentKind,
            );
    const head = companyLabel
      ? `${displayLabel} · ${companyLabel}`
      : displayLabel;
    const peopleLabel =
      args.itemsCount === 1 ? "1 чел." : `${args.itemsCount} чел.`;
    return `${head} · ${this.formatDisplayDate(args.issueDate)} · ${peopleLabel}`;
  }

  private getCommonValue(values: Array<string | null | undefined>) {
    const unique = Array.from(
      new Set(
        values
          .map((value) => this.normalizeOptionalText(value))
          .filter((value): value is string => Boolean(value)),
      ),
    );
    return unique.length === 1 ? unique[0] : null;
  }

  private getDefaultWorkplace(employee: {
    contractorCompany: { name: string } | null;
    company: { name: string };
  }) {
    return employee.contractorCompany?.name ?? employee.company.name;
  }

  private async ensureEmployee(companyId: string, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: {
        id: employeeId,
        companyId,
      },
      include: {
        company: true,
        contractorCompany: true,
      },
    });

    if (!employee) {
      throw new NotFoundException("Сотрудник не найден.");
    }

    return employee;
  }

  private async ensureTrainingAssignment(
    companyId: string,
    employeeId: string,
    trainingAssignmentId?: string | null,
  ) {
    if (!trainingAssignmentId) {
      return null;
    }

    const assignment = await this.prisma.trainingAssignment.findFirst({
      where: {
        id: trainingAssignmentId,
        companyId,
        employeeId,
      },
      include: {
        trainingProgram: true,
      },
    });

    if (!assignment) {
      throw new NotFoundException(
        "Назначенное обучение не найдено для этого сотрудника.",
      );
    }

    return assignment;
  }

  private buildBiotMergeFields(args: {
    issueDate: Date;
    seriesNumber: string;
    certificateNumber: string;
    protocolNumber: string;
    trainingSubject: string;
    fullName?: string | null;
    fullNameKz?: string | null;
    issuedTo?: string | null;
    positionRu?: string | null;
    positionKz?: string | null;
    workplaceRu?: string | null;
    workplaceKz?: string | null;
  }): TemplateFieldMap {
    const fullName = this.normalizeOptionalText(args.fullName);

    if (!fullName) {
      throw new BadRequestException("Укажите ФИО для корочки.");
    }

    const issuedTo = this.normalizeOptionalText(args.issuedTo) ?? fullName;
    const positionRu =
      this.normalizeOptionalText(args.positionRu) ??
      this.normalizeOptionalText(args.positionKz);

    if (!positionRu) {
      throw new BadRequestException(`Укажите должность для ${fullName}.`);
    }

    const positionKz =
      this.normalizeOptionalText(args.positionKz) ?? positionRu;
    const workplaceRu =
      this.normalizeOptionalText(args.workplaceRu) ??
      this.normalizeOptionalText(args.workplaceKz);

    if (!workplaceRu) {
      throw new BadRequestException(
        `Укажите компанию или место работы для ${fullName}.`,
      );
    }

    const workplaceKz =
      this.normalizeOptionalText(args.workplaceKz) ?? workplaceRu;
    return {
      Берілді: issuedTo,
      В_том_что_он: args.trainingSubject,
      ГОД: this.formatIssueYear(args.issueDate),
      День_месяц: this.formatIssueDayMonth(args.issueDate),
      Должность: positionRu,
      Жұмыс__орны_: workplaceKz,
      Лауазымы: positionKz,
      Место_работы__: workplaceRu,
      Номер_серии: args.seriesNumber.trim(),
      Номер_удостоверения: args.certificateNumber.trim(),
      Протокол_: args.protocolNumber.trim(),
      ФИО: fullName,
    };
  }

  private buildPtmMergeFields(args: {
    issueDate: Date;
    biotDocumentKind?: BiotDocumentKind | null;
    certificateNumber: string;
    protocolNumber: string;
    trainingSubject: string;
    fullName?: string | null;
    fullNameKz?: string | null;
    issuedTo?: string | null;
    positionRu?: string | null;
    positionKz?: string | null;
    workplaceRu?: string | null;
    workplaceKz?: string | null;
  }): TemplateFieldMap {
    const fullName = this.normalizeOptionalText(args.fullName);

    if (!fullName) {
      throw new BadRequestException("Укажите ФИО для корочки.");
    }

    const positionRu =
      this.normalizeOptionalText(args.positionRu) ??
      this.normalizeOptionalText(args.positionKz);

    if (!positionRu) {
      throw new BadRequestException(`Укажите должность для ${fullName}.`);
    }

    const positionKz =
      this.normalizeOptionalText(args.positionKz) ?? positionRu;
    const workplaceRu =
      this.normalizeOptionalText(args.workplaceRu) ??
      this.normalizeOptionalText(args.workplaceKz);

    if (!workplaceRu) {
      throw new BadRequestException(
        `Укажите компанию или место работы для ${fullName}.`,
      );
    }

    const workplaceKz =
      this.normalizeOptionalText(args.workplaceKz) ?? workplaceRu;
    const validUntilYear = this.getValidUntilYear(
      args.issueDate,
      args.biotDocumentKind,
    );
    const dayMonth = this.formatIssueDayMonth(args.issueDate);

    return {
      В_том_что: args.trainingSubject,
      Год: this.formatIssueYear(args.issueDate),
      Действительно_Год: validUntilYear,
      Действительно_Мес: "",
      Должность: positionRu,
      Емтихан_тапсырды: "ӨТМ",
      Жұмыс_орны: workplaceKz,
      Лауазымы: positionKz,
      Месяц: dayMonth,
      Место_работы: workplaceRu,
      Номер_удостоверения: args.certificateNumber.trim(),
      Протокол_: args.protocolNumber.trim(),
      ФИО: fullName,
    };
  }

  private buildPbMergeFields(args: {
    issueDate: Date;
    biotDocumentKind?: BiotDocumentKind | null;
    certificateNumber: string;
    protocolNumber: string;
    trainingSubject: string;
    fullName?: string | null;
    positionRu?: string | null;
    positionKz?: string | null;
    workplaceRu?: string | null;
    workplaceKz?: string | null;
  }): TemplateFieldMap {
    const fullName = this.normalizeOptionalText(args.fullName);

    if (!fullName) {
      throw new BadRequestException("Укажите ФИО для корочки.");
    }

    const positionRu =
      this.normalizeOptionalText(args.positionRu) ??
      this.normalizeOptionalText(args.positionKz);

    if (!positionRu) {
      throw new BadRequestException(`Укажите должность для ${fullName}.`);
    }

    const positionKz =
      this.normalizeOptionalText(args.positionKz) ?? positionRu;
    const workplaceRu =
      this.normalizeOptionalText(args.workplaceRu) ??
      this.normalizeOptionalText(args.workplaceKz);

    if (!workplaceRu) {
      throw new BadRequestException(
        `Укажите компанию или место работы для ${fullName}.`,
      );
    }

    const workplaceKz =
      this.normalizeOptionalText(args.workplaceKz) ?? workplaceRu;
    const issueDay = String(args.issueDate.getDate()).padStart(2, "0");
    const issueMonth = String(args.issueDate.getMonth() + 1).padStart(2, "0");
    const issueYear = this.formatIssueYear(args.issueDate);
    const validUntilYear = this.getValidUntilYear(
      args.issueDate,
      args.biotDocumentKind,
    );
    const workplaceLabel =
      workplaceRu === workplaceKz
        ? workplaceRu
        : `${workplaceRu}/${workplaceKz}`;
    const positionLabel =
      positionRu === positionKz ? positionRu : `${positionRu}/${positionKz}`;

    return {
      '"Месяц"': issueMonth,
      Год: issueYear,
      Действительно_Год: validUntilYear,
      День: issueDay,
      Жұмыс_орны_лауазымы: workplaceLabel,
      Месяц: issueMonth,
      Номер_удостоверения: args.certificateNumber.trim(),
      Прослушала_курс: args.trainingSubject,
      Протокол_: args.protocolNumber.trim(),
      ФИО: fullName,
      должность: positionLabel,
    };
  }

  private buildBiotProtocolFields(args: {
    protocolNumber: string;
    certificateNumber: string;
    issueDate: Date;
    fullName: string;
    positionRu?: string | null;
    positionKz?: string | null;
    workplaceRu?: string | null;
    workplaceKz?: string | null;
  }): TemplateFieldMap {
    const positionRu =
      this.normalizeOptionalText(args.positionRu) ??
      this.normalizeOptionalText(args.positionKz);

    if (!positionRu) {
      throw new BadRequestException(`Укажите должность для ${args.fullName}.`);
    }

    const positionKz =
      this.normalizeOptionalText(args.positionKz) ?? positionRu;
    const workplaceRu = this.normalizeOptionalText(args.workplaceRu);
    const workplaceKz =
      this.normalizeOptionalText(args.workplaceKz) ?? workplaceRu;

    if (!workplaceRu && !workplaceKz) {
      throw new BadRequestException(
        `Для протокола укажите компанию или место работы для ${args.fullName}.`,
      );
    }

    const headerWorkplace = workplaceKz ?? workplaceRu ?? "";
    const tableWorkplace = workplaceRu ?? workplaceKz ?? "";

    return {
      '"Должность_1"': "",
      Должность: positionRu,
      Жұмыс__орны_: headerWorkplace,
      Лауазымы: positionKz,
      Место_работы__: tableWorkplace,
      Номер_удостоверения: args.certificateNumber.trim(),
      Примечание_1: "",
      Протокол_: args.protocolNumber.trim(),
      ФИО: args.fullName,
      ФИО_1: "",
    };
  }

  private buildPtmProtocolFields(args: {
    issueDate: Date;
    protocolNumber: string;
    certificateNumber: string;
    fullName: string;
    positionRu?: string | null;
    positionKz?: string | null;
    workplaceRu?: string | null;
    workplaceKz?: string | null;
  }): TemplateFieldMap {
    const positionRu =
      this.normalizeOptionalText(args.positionRu) ??
      this.normalizeOptionalText(args.positionKz);

    if (!positionRu) {
      throw new BadRequestException(`Укажите должность для ${args.fullName}.`);
    }

    const positionKz =
      this.normalizeOptionalText(args.positionKz) ?? positionRu;
    const workplaceRu =
      this.normalizeOptionalText(args.workplaceRu) ??
      this.normalizeOptionalText(args.workplaceKz);

    if (!workplaceRu) {
      throw new BadRequestException(
        `Для протокола укажите компанию или место работы для ${args.fullName}.`,
      );
    }

    const workplaceRuWithPrefix =
      workplaceRu && /^(ТОО|ИП|АО)\s+/u.test(workplaceRu)
        ? workplaceRu
        : `ТОО ${workplaceRu}`;

    return {
      '"Должность_РУС_1"': "",
      '"ФИО_1"': "",
      '"Организация_РУС_1"': "",
      Должность: positionRu,
      Лауазымы: positionKz,
      Место_работы: workplaceRuWithPrefix,
      Номер_Уд_1: args.certificateNumber,
      Протокол_: args.protocolNumber,
      ФИО: args.fullName,
    };
  }

  private buildPbProtocolFields(args: {
    protocolNumber: string;
    fullName: string;
    positionRu?: string | null;
    positionKz?: string | null;
    workplaceRu?: string | null;
    workplaceKz?: string | null;
  }): TemplateFieldMap {
    const positionRu =
      this.normalizeOptionalText(args.positionRu) ??
      this.normalizeOptionalText(args.positionKz);

    if (!positionRu) {
      throw new BadRequestException(`Укажите должность для ${args.fullName}.`);
    }

    const positionKz =
      this.normalizeOptionalText(args.positionKz) ?? positionRu;
    const workplaceLabel = this.combineCompanyRuKzLabel(
      args.workplaceRu,
      args.workplaceKz,
    );
    const positionLabel = this.buildBilingualPositionLabel(
      args.positionRu,
      args.positionKz,
    );

    if (!workplaceLabel) {
      throw new BadRequestException(
        `Для протокола укажите компанию или место работы для ${args.fullName}.`,
      );
    }

    return {
      '"Образование_РУС_1"': "",
      ДОЛЖНОСТЬ_РУС_1: "",
      Жұмыс_орны_лауазымы: workplaceLabel,
      Протокол_: args.protocolNumber,
      ФИО: args.fullName,
      ФИО_РУС_1: "",
      должность: positionLabel ?? positionRu,
    };
  }

  private buildPsProtocolFields(args: {
    issueDate: Date;
    protocolNumber: string;
    certificateNumber: string;
    fullName: string;
    issuedTo?: string | null;
    positionRu?: string | null;
    positionKz?: string | null;
  }): TemplateFieldMap {
    const qualificationRu =
      this.normalizeOptionalText(args.positionRu) ??
      this.normalizeOptionalText(args.positionKz);

    if (!qualificationRu) {
      throw new BadRequestException(
        `Укажите квалификацию для ${args.fullName}.`,
      );
    }

    return {
      '"Номер_удостоверения"': args.certificateNumber,
      '"Образование_РУС_1"': "",
      ГОД: this.formatIssueYear(args.issueDate),
      День_месяц: this.formatIssueDayMonth(args.issueDate),
      Номер_Уд_1: "",
      Протокол_: args.protocolNumber,
      Выдано_ФИО: this.normalizeOptionalText(args.issuedTo) ?? args.fullName,
      ФИО_1: "",
      в_том_что_ему_присвоена_квалификация_: qualificationRu,
    };
  }

  private buildProtocolFields(args: {
    certificateType: SafetyCardType;
    issueDate: Date;
    protocolNumber: string;
    certificateNumber: string;
    fullName: string;
    issuedTo?: string | null;
    positionRu?: string | null;
    positionKz?: string | null;
    workplaceRu?: string | null;
    workplaceKz?: string | null;
  }) {
    if (args.certificateType === "PTM") {
      return this.buildPtmProtocolFields(args);
    }

    if (args.certificateType === "PB") {
      return this.buildPbProtocolFields(args);
    }

    if (args.certificateType === "PS") {
      return this.buildPsProtocolFields(args);
    }

    return this.buildBiotProtocolFields(args);
  }

  private buildProtocolTextReplacements(args: {
    certificateType: SafetyCardType;
    issueDate: Date;
    workplaceRu?: string | null;
    workplaceKz?: string | null;
  }) {
    if (args.certificateType === "PTM") {
      return this.buildPtmProtocolTextReplacements(args);
    }

    if (args.certificateType === "BIOT") {
      return this.buildBiotProtocolTextReplacements(args);
    }

    if (args.certificateType === "PB") {
      return this.buildPbProtocolTextReplacements(args);
    }

    return [];
  }

  private buildPsMergeFields(args: {
    issueDate: Date;
    seriesNumber: string;
    certificateNumber: string;
    protocolNumber: string;
    fullName?: string | null;
    issuedTo?: string | null;
    positionRu?: string | null;
    positionKz?: string | null;
  }): TemplateFieldMap {
    const fullName = this.normalizeOptionalText(args.fullName);

    if (!fullName) {
      throw new BadRequestException("Укажите ФИО для корочки.");
    }

    const qualificationRu =
      this.normalizeOptionalText(args.positionRu) ??
      this.normalizeOptionalText(args.positionKz);

    if (!qualificationRu) {
      throw new BadRequestException(`Укажите квалификацию для ${fullName}.`);
    }

    const qualificationKz =
      this.normalizeOptionalText(args.positionKz) ?? qualificationRu;
    const issuedTo = this.normalizeOptionalText(args.issuedTo) ?? fullName;

    return {
      M_1__пп: "1",
      M_1_Наименование_дисциплины: "Общепроф. курс",
      M_1_Пәндер_атауы_: "Жалпы кәсіби курс",
      M_2__пп: "2",
      M_2_Наименование_дисциплины: "Спец. Курс",
      M_2_Пәндер_атауы_: "арнайы курс",
      Баға: "Жаксы",
      Біліктілік_берілгендігі_туралы: qualificationKz,
      Выдано_ФИО: issuedTo,
      ГОД: this.formatIssueYear(args.issueDate),
      День_месяц: this.formatIssueDayMonth(args.issueDate),
      Номер_серии: "",
      Номер_удостоверения: args.certificateNumber.trim(),
      Оценка: "Хорошо",
      Протокол_: args.protocolNumber.trim(),
      в_том_что_ему_присвоена_квалификация_: qualificationRu,
    };
  }

  private buildPsWitnessCertificateFields(args: {
    issueDate: Date;
    certificateNumber: string;
    protocolNumber: string;
    registrationNumber: string;
    fullName?: string | null;
    fullNameKz?: string | null;
    positionRu?: string | null;
    positionKz?: string | null;
  }): TemplateFieldMap {
    const fullNameRu = this.normalizeOptionalText(args.fullName);
    const fullNameKz =
      this.normalizeOptionalText(args.fullNameKz) ?? fullNameRu;
    const registrationNumber = args.registrationNumber.trim();
    const protocolNumber = args.protocolNumber.trim();
    const professionRu =
      this.normalizeOptionalText(args.positionRu) ??
      this.normalizeOptionalText(args.positionKz);
    const professionKz =
      this.normalizeOptionalText(args.positionKz) ??
      this.normalizeOptionalText(args.positionRu);
    const trainingEndDate = args.issueDate;
    const trainingStartDate = this.addDays(
      trainingEndDate,
      -(PS_WITNESS_DEFAULT_TRAINING_DAYS - 1),
    );

    if (!fullNameRu) {
      throw new BadRequestException(
        "Укажите ФИО на русском для свидетельства.",
      );
    }

    if (!professionRu) {
      throw new BadRequestException(
        `Укажите профессию на русском для ${fullNameRu}.`,
      );
    }

    if (!professionKz) {
      throw new BadRequestException(
        `Укажите профессию на казахском для ${fullNameRu}.`,
      );
    }

    return {
      "{{KB_NUMBER}}": `КБ № ${args.certificateNumber.trim()}`,
      "{{REGISTRATION_NUMBER}}": registrationNumber,
      "{{FULL_NAME_RU}}": fullNameRu,
      "{{FULL_NAME_KZ}}": fullNameKz ?? fullNameRu,
      "{{PROFESSION_RU}}": professionRu,
      "{{PROFESSION_KZ}}": professionKz,
      "{{EDU_ORG_RU}}": PS_WITNESS_PROVIDER_ORG_RU,
      "{{EDU_ORG_KZ}}": PS_WITNESS_PROVIDER_ORG_KZ,
      "{{TRAINING_START_DAY}}": this.formatDayNumber(trainingStartDate),
      "{{TRAINING_START_MONTH_RU}}": this.formatRuMonthName(trainingStartDate),
      "{{TRAINING_START_MONTH_KZ}}": this.formatKzMonthName(trainingStartDate),
      "{{TRAINING_START_YEAR_SHORT}}":
        this.formatIssueYearShort(trainingStartDate),
      "{{TRAINING_START_YEAR_FULL}}": this.formatIssueYear(trainingStartDate),
      "{{TRAINING_END_DAY}}": this.formatDayNumber(trainingEndDate),
      "{{TRAINING_END_MONTH_RU}}": this.formatRuMonthName(trainingEndDate),
      "{{TRAINING_END_MONTH_KZ}}": this.formatKzMonthName(trainingEndDate),
      "{{TRAINING_END_YEAR_SHORT}}": this.formatIssueYearShort(trainingEndDate),
      "{{TRAINING_END_YEAR_FULL}}": this.formatIssueYear(trainingEndDate),
      "{{PROTOCOL_NUMBER_DISPLAY}}": protocolNumber,
      "{{ISSUE_DAY}}": this.formatDayNumber(args.issueDate),
      "{{ISSUE_MONTH_RU}}": this.formatRuMonthName(args.issueDate),
      "{{ISSUE_MONTH_KZ}}": this.formatKzMonthName(args.issueDate),
      "{{ISSUE_YEAR_SHORT}}": this.formatIssueYearShort(args.issueDate),
    };
  }

  private buildMergeFields(args: {
    certificateType: SafetyCardType;
    biotDocumentKind?: BiotDocumentKind | null;
    issueDate: Date;
    seriesNumber: string;
    certificateNumber: string;
    protocolNumber: string;
    trainingSubject: string;
    fullName?: string | null;
    fullNameKz?: string | null;
    issuedTo?: string | null;
    positionRu?: string | null;
    positionKz?: string | null;
    workplaceRu?: string | null;
    workplaceKz?: string | null;
  }) {
    if (args.certificateType === "PTM") {
      return this.buildPtmMergeFields(args);
    }

    if (args.certificateType === "PB") {
      return this.buildPbMergeFields(args);
    }

    if (
      this.isPsWitnessCertificate(args.certificateType, args.biotDocumentKind)
    ) {
      return this.buildPsWitnessCertificateFields({
        ...args,
        registrationNumber: args.protocolNumber,
      });
    }

    if (args.certificateType === "PS") {
      return this.buildPsMergeFields(args);
    }

    return this.buildBiotMergeFields(args);
  }

  private buildBiotItrCertificateFields(args: {
    issuedTo?: string | null;
    fullName?: string | null;
  }) {
    return {
      Full_Name:
        this.normalizeOptionalText(args.issuedTo) ??
        this.normalizeOptionalText(args.fullName) ??
        "",
    };
  }

  private buildBiotItrCertificateTextReplacements(args: {
    issueDate: Date;
    certificateNumber: string;
  }): TemplateTextReplacement[] {
    return [
      {
        matchText: BIOT_ITR_CERTIFICATE_DATE_PLACEHOLDER,
        replaceText: this.formatRuCertificateDate(args.issueDate),
      },
      {
        matchText: BIOT_ITR_CERTIFICATE_NUMBER_PLACEHOLDER,
        replaceText: args.certificateNumber,
      },
    ];
  }

  private async renderTemplateFromPath(
    templatePath: string,
    label: string,
    fields: TemplateFieldMap,
    photo?: CardPhotoAsset | null,
    certificateType?: SafetyCardType,
    textReplacements: TemplateTextReplacement[] = [],
  ) {
    await Promise.all([
      assertReadablePath(
        templatePath,
        `DOCX template for ${label} is missing on the server.`,
      ),
      assertReadablePath(
        this.generatorScriptPath,
        "DOCX generator script for BIOT card exports is missing on the server.",
      ),
      assertPython3Available(
        "python3 is required to generate BIOT DOCX files on the server.",
      ),
    ]);

    const workingDirectory = await mkdtemp(join(tmpdir(), "dsj-biot-card-"));
    const outputPath = join(workingDirectory, "biot-card.docx");

    try {
      await new Promise<void>((resolvePromise, rejectPromise) => {
        const processHandle = spawn(
          getPythonCommand(),
          [this.generatorScriptPath, templatePath, outputPath],
          {
            cwd: this.workspaceRoot,
            env: getPythonProcessEnv(),
            stdio: ["pipe", "ignore", "pipe"],
          },
        );

        let stderrOutput = "";

        processHandle.stderr.on("data", (chunk) => {
          stderrOutput += chunk.toString("utf8");
        });

        processHandle.on("error", (error) => {
          rejectPromise(error);
        });

        processHandle.on("close", (code) => {
          if (code === 0) {
            resolvePromise();
            return;
          }

          rejectPromise(
            new Error(
              stderrOutput.trim() ||
                `Генератор корочки завершился с кодом ${code}.`,
            ),
          );
        });

        processHandle.stdin.write(
          Buffer.from(
            JSON.stringify({
              fields,
              textReplacements,
              fieldStyleOverrides: this.getFieldStyleOverrides(certificateType),
              photo:
                certificateType !== undefined
                  ? this.buildPhotoRenderPayload(certificateType, photo ?? null)
                  : null,
            }),
            "utf8",
          ),
        );
        processHandle.stdin.end();
      });

      return await readFile(outputPath);
    } catch (error) {
      throw new InternalServerErrorException(
        error instanceof Error
          ? error.message
          : `Не удалось сформировать документ ${label}.`,
      );
    } finally {
      await rm(workingDirectory, { recursive: true, force: true });
    }
  }

  private async renderTemplate(
    certificateType: SafetyCardType,
    fields: TemplateFieldMap,
    photo?: CardPhotoAsset | null,
  ) {
    return this.renderTemplateFromPath(
      this.getTemplatePath(certificateType),
      this.getCardConfig(certificateType).label,
      fields,
      photo,
      certificateType,
    );
  }

  private async renderPsWitnessCertificateRows(rows: TemplateFieldMap[]) {
    await Promise.all([
      assertReadablePath(
        this.getPsWitnessCertificateTemplatePath(),
        "DOCX template for PS witness certificates is missing on the server.",
      ),
      assertReadablePath(
        this.psWitnessCertificateScriptPath,
        "DOCX generator script for PS witness certificates is missing on the server.",
      ),
      assertPython3Available(
        "python3 is required to generate PS witness DOCX files on the server.",
      ),
      assertPythonModuleAvailable(
        "docx",
        "python-docx is required to generate PS witness DOCX files on the server.",
      ),
    ]);

    const workingDirectory = await mkdtemp(join(tmpdir(), "dsj-ps-witness-"));
    const outputPath = join(
      workingDirectory,
      PS_WITNESS_CERTIFICATE_PREVIEW_FILE_NAME,
    );

    try {
      await new Promise<void>((resolvePromise, rejectPromise) => {
        const processHandle = spawn(
          getPythonCommand(),
          [
            this.psWitnessCertificateScriptPath,
            this.getPsWitnessCertificateTemplatePath(),
            outputPath,
          ],
          {
            cwd: this.workspaceRoot,
            env: getPythonProcessEnv(),
            stdio: ["pipe", "ignore", "pipe"],
          },
        );

        let stderrOutput = "";

        processHandle.stderr.on("data", (chunk) => {
          stderrOutput += chunk.toString("utf8");
        });

        processHandle.on("error", (error) => {
          rejectPromise(error);
        });

        processHandle.on("close", (code) => {
          if (code === 0) {
            resolvePromise();
            return;
          }

          rejectPromise(
            new Error(
              stderrOutput.trim() ||
                `Генератор свидетельства ПС завершился с кодом ${code}.`,
            ),
          );
        });

        processHandle.stdin.write(
          Buffer.from(
            JSON.stringify({
              rows: rows.map((fields) => ({ fields })),
            }),
            "utf8",
          ),
        );
        processHandle.stdin.end();
      });

      return await readFile(outputPath);
    } catch (error) {
      throw new InternalServerErrorException(
        error instanceof Error
          ? error.message
          : "Не удалось сформировать свидетельство ПС.",
      );
    } finally {
      await rm(workingDirectory, { recursive: true, force: true });
    }
  }

  private async listGenerationLogs(
    companyId: string,
    certificateType: SafetyCardType,
    biotDocumentKind: BiotDocumentKind = "WORKER_CARD",
  ) {
    const logs = await this.prisma.auditLog.findMany({
      where: {
        companyId,
        action: "biot_card.generated",
        entityType: "BiotCardTemplate",
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 1000,
    });

    return logs.filter((log) => {
      const loggedType = this.readMetadataString(
        log.metadata,
        "certificateType",
      );
      const loggedBiotDocumentKind = this.readMetadataString(
        log.metadata,
        "biotDocumentKind",
      );
      if (certificateType === "BIOT" || certificateType === "PS") {
        if (!loggedType || loggedType === "BIOT") {
          if (certificateType === "PS") {
            return false;
          }

          return (
            this.normalizeBiotDocumentKind(
              certificateType,
              loggedBiotDocumentKind as BiotDocumentKind | null,
            ) ===
            this.normalizeBiotDocumentKind(certificateType, biotDocumentKind)
          );
        }

        if (loggedType !== certificateType) {
          return false;
        }

        return (
          this.normalizeBiotDocumentKind(
            certificateType,
            loggedBiotDocumentKind as BiotDocumentKind | null,
          ) ===
          this.normalizeBiotDocumentKind(certificateType, biotDocumentKind)
        );
      }
      return loggedType === certificateType;
    });
  }

  private readMetadataString(metadata: unknown, key: string) {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      return null;
    }

    const value = (metadata as Record<string, unknown>)[key];
    return typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : null;
  }

  private async listPsWitnessLogs(companyId: string) {
    const [bundleLogs, legacyLogs] = await Promise.all([
      this.listGenerationLogs(companyId, "PS", "WORKER_CARD"),
      this.listGenerationLogs(companyId, "PS", "ITR_CERTIFICATE"),
    ]);

    return [...bundleLogs, ...legacyLogs];
  }

  private readWitnessCertificateNumberFromLog(log: { metadata: unknown }) {
    const loggedType = this.readMetadataString(log.metadata, "certificateType");
    const loggedBiotDocumentKind = this.readMetadataString(
      log.metadata,
      "biotDocumentKind",
    );
    const directValue = this.readMetadataString(
      log.metadata,
      "witnessCertificateNumber",
    );

    if (directValue) {
      return directValue;
    }

    if (loggedType === "PS" && loggedBiotDocumentKind === "ITR_CERTIFICATE") {
      return this.readMetadataString(log.metadata, "certificateNumber");
    }

    return null;
  }

  private readWitnessRegistrationNumberFromLog(log: { metadata: unknown }) {
    const loggedType = this.readMetadataString(log.metadata, "certificateType");
    const loggedBiotDocumentKind = this.readMetadataString(
      log.metadata,
      "biotDocumentKind",
    );
    const directValue = this.readMetadataString(
      log.metadata,
      "witnessRegistrationNumber",
    );

    if (directValue) {
      return directValue;
    }

    if (loggedType === "PS" && loggedBiotDocumentKind === "ITR_CERTIFICATE") {
      return this.readMetadataString(log.metadata, "protocolNumber");
    }

    return null;
  }

  private getCertificateNumberFieldLabel(
    certificateType: SafetyCardType,
    biotDocumentKind: BiotDocumentKind,
  ) {
    if (this.isBiotItrCertificate(certificateType, biotDocumentKind)) {
      return "номер сертификата";
    }

    if (this.isPsWitnessCertificate(certificateType, biotDocumentKind)) {
      return "номер КБ";
    }

    return "номер удостоверения";
  }

  private getProtocolNumberFieldLabel(
    certificateType: SafetyCardType,
    biotDocumentKind: BiotDocumentKind,
  ) {
    if (this.isPsWitnessCertificate(certificateType, biotDocumentKind)) {
      return "регистрационный номер";
    }

    return "номер протокола";
  }

  private ensureUniqueBatchValues(
    certificateType: SafetyCardType,
    biotDocumentKind: BiotDocumentKind,
    items: GenerateBiotCardBatchInput["items"],
  ) {
    const certificateNumbers = new Set<string>();
    const protocolNumbers = new Set<string>();
    const witnessCertificateNumbers = new Set<string>();
    const witnessRegistrationNumbers = new Set<string>();

    for (const item of items) {
      const certificateNumber = item.certificateNumber.trim();
      const protocolNumber = item.protocolNumber.trim();
      const witnessCertificateNumber =
        item.witnessCertificateNumber?.trim() ?? "";
      const witnessRegistrationNumber =
        item.witnessRegistrationNumber?.trim() ?? "";

      if (certificateNumbers.has(certificateNumber)) {
        throw new BadRequestException(
          `${this.getCertificateNumberFieldLabel(certificateType, biotDocumentKind)} ${certificateNumber} повторяется в текущем списке.`,
        );
      }

      if (protocolNumber && protocolNumbers.has(protocolNumber)) {
        throw new BadRequestException(
          `${this.getProtocolNumberFieldLabel(certificateType, biotDocumentKind)} ${protocolNumber} повторяется в текущем списке.`,
        );
      }

      if (
        witnessCertificateNumber &&
        witnessCertificateNumbers.has(witnessCertificateNumber)
      ) {
        throw new BadRequestException(
          `номер КБ ${witnessCertificateNumber} повторяется в текущем списке.`,
        );
      }

      if (
        witnessRegistrationNumber &&
        witnessRegistrationNumbers.has(witnessRegistrationNumber)
      ) {
        throw new BadRequestException(
          `регистрационный номер ${witnessRegistrationNumber} повторяется в текущем списке.`,
        );
      }

      certificateNumbers.add(certificateNumber);
      if (protocolNumber) {
        protocolNumbers.add(protocolNumber);
      }
      if (witnessCertificateNumber) {
        witnessCertificateNumbers.add(witnessCertificateNumber);
      }
      if (witnessRegistrationNumber) {
        witnessRegistrationNumbers.add(witnessRegistrationNumber);
      }
    }
  }

  private async ensureNumbersAreAvailable(
    certificateType: SafetyCardType,
    biotDocumentKind: BiotDocumentKind,
    companyId: string,
    items: Array<{
      certificateNumber: string;
      protocolNumber: string;
      witnessCertificateNumber?: string | null;
      witnessRegistrationNumber?: string | null;
    }>,
    ignoreCertificateNumbers: string[] = [],
    ignoreProtocolNumbers: string[] = [],
    ignoreWitnessCertificateNumbers: string[] = [],
    ignoreWitnessRegistrationNumbers: string[] = [],
  ) {
    const logs = await this.listGenerationLogs(
      companyId,
      certificateType,
      biotDocumentKind,
    );
    const witnessLogs =
      certificateType === "PS" && biotDocumentKind === "WORKER_CARD"
        ? await this.listPsWitnessLogs(companyId)
        : logs;
    const existingCertificateNumbers = new Set<string>();
    const existingProtocolNumbers = new Set<string>();
    const existingWitnessCertificateNumbers = new Set<string>();
    const existingWitnessRegistrationNumbers = new Set<string>();
    const ignoredCertificates = new Set(
      ignoreCertificateNumbers.map((item) => item.trim()),
    );
    const ignoredProtocols = new Set(
      ignoreProtocolNumbers.map((item) => item.trim()),
    );
    const ignoredWitnessCertificates = new Set(
      ignoreWitnessCertificateNumbers.map((item) => item.trim()),
    );
    const ignoredWitnessRegistrations = new Set(
      ignoreWitnessRegistrationNumbers.map((item) => item.trim()),
    );

    for (const log of logs) {
      const certificateNumber = this.readMetadataString(
        log.metadata,
        "certificateNumber",
      );
      const protocolNumber = this.readMetadataString(
        log.metadata,
        "protocolNumber",
      );

      if (certificateNumber && !ignoredCertificates.has(certificateNumber)) {
        existingCertificateNumbers.add(certificateNumber);
      }

      if (protocolNumber && !ignoredProtocols.has(protocolNumber)) {
        existingProtocolNumbers.add(protocolNumber);
      }
    }

    for (const log of witnessLogs) {
      const witnessCertificateNumber =
        this.readWitnessCertificateNumberFromLog(log);
      const witnessRegistrationNumber =
        this.readWitnessRegistrationNumberFromLog(log);

      if (
        witnessCertificateNumber &&
        !ignoredWitnessCertificates.has(witnessCertificateNumber)
      ) {
        existingWitnessCertificateNumbers.add(witnessCertificateNumber);
      }

      if (
        witnessRegistrationNumber &&
        !ignoredWitnessRegistrations.has(witnessRegistrationNumber)
      ) {
        existingWitnessRegistrationNumbers.add(witnessRegistrationNumber);
      }
    }

    for (const item of items) {
      if (existingCertificateNumbers.has(item.certificateNumber.trim())) {
        throw new BadRequestException(
          `${this.getCertificateNumberFieldLabel(certificateType, biotDocumentKind)} ${item.certificateNumber.trim()} уже использован. Обновите автонумерацию.`,
        );
      }

      if (existingProtocolNumbers.has(item.protocolNumber.trim())) {
        throw new BadRequestException(
          `${this.getProtocolNumberFieldLabel(certificateType, biotDocumentKind)} ${item.protocolNumber.trim()} уже использован. Обновите автонумерацию.`,
        );
      }

      if (
        item.witnessCertificateNumber?.trim() &&
        existingWitnessCertificateNumbers.has(
          item.witnessCertificateNumber.trim(),
        )
      ) {
        throw new BadRequestException(
          `номер КБ ${item.witnessCertificateNumber.trim()} уже использован. Обновите автонумерацию.`,
        );
      }

      if (
        item.witnessRegistrationNumber?.trim() &&
        existingWitnessRegistrationNumbers.has(
          item.witnessRegistrationNumber.trim(),
        )
      ) {
        throw new BadRequestException(
          `регистрационный номер ${item.witnessRegistrationNumber.trim()} уже использован. Обновите автонумерацию.`,
        );
      }
    }
  }

  private buildPresetList(
    logs: Awaited<ReturnType<BiotCardsService["listGenerationLogs"]>>,
  ) {
    const presets = new Set<string>();

    for (const log of logs) {
      const trainingSubject = this.readMetadataString(
        log.metadata,
        "trainingSubject",
      );

      if (trainingSubject) {
        presets.add(trainingSubject);
      }
    }

    return Array.from(presets);
  }

  private async createRequestRecord(args: {
    user: AuthenticatedUser;
    companyId: string;
    issueDate: Date;
    input: GenerateBiotCardBatchInput;
    trainingSubject: string;
    items: BatchPreparedItem[];
    biotDocumentKind: BiotDocumentKind;
  }, transaction: Pick<Prisma.TransactionClient, "cardGenerationRequest">) {
    const requestData = this.buildRequestRecordValues({
      certificateType: args.input.certificateType,
      biotDocumentKind: args.biotDocumentKind,
      includeCard: args.input.includeCard,
      includeProtocol: args.input.includeProtocol,
      includeWitness: args.input.includeWitness,
      issueDate: args.issueDate,
      requestMode: args.input.requestMode,
      seriesNumber: args.input.seriesNumber,
      trainingSubject: args.trainingSubject,
      requestCompanyRu: args.input.requestCompanyRu,
      requestCompanyKz: args.input.requestCompanyKz,
      items: args.items,
    });

    return transaction.cardGenerationRequest.create({
      data: {
        companyId: args.companyId,
        createdByUserId: args.user.userId,
        ...requestData,
        items: {
          create: args.items.map((item) => ({
            employeeId: item.employeeId,
            trainingAssignmentId: item.trainingAssignmentId,
            fullName: item.fullName,
            fullNameKz: item.fullNameKz,
            issuedTo: item.issuedTo,
            positionRu: item.positionRu,
            positionKz: item.positionKz,
            workplaceRu: item.workplaceRu,
            workplaceKz: item.workplaceKz,
            photoDataUrl: item.photo?.dataUrl,
            photoFileName: item.photo?.fileName,
            certificateNumber: item.certificateNumber,
            protocolNumber: item.protocolNumber,
            witnessCertificateNumber: item.witnessCertificateNumber,
            witnessRegistrationNumber: item.witnessRegistrationNumber,
          })),
        },
      },
    });
  }

  private buildRequestRecordValues(args: {
    certificateType: SafetyCardType;
    biotDocumentKind: BiotDocumentKind;
    includeCard?: boolean | null;
    includeProtocol?: boolean | null;
    includeWitness?: boolean | null;
    issueDate: Date;
    requestMode: GenerateBiotCardBatchInput["requestMode"];
    seriesNumber: string;
    trainingSubject: string;
    requestCompanyRu?: string | null;
    requestCompanyKz?: string | null;
    items: BatchPreparedItem[];
  }) {
    const bundleOptions = this.resolveBundleOptions({
      certificateType: args.certificateType,
      biotDocumentKind: args.biotDocumentKind,
      includeCard: args.includeCard,
      includeProtocol: args.includeProtocol,
      includeWitness: args.includeWitness,
    });
    const requestCompanyRu =
      this.normalizeOptionalText(args.requestCompanyRu) ??
      this.getCommonValue(args.items.map((item) => item.workplaceRu));
    const requestCompanyKz =
      this.normalizeOptionalText(args.requestCompanyKz) ??
      this.getCommonValue(args.items.map((item) => item.workplaceKz));

    return {
      title: this.formatRequestTitle({
        certificateType: args.certificateType,
        biotDocumentKind: args.biotDocumentKind,
        includeCard: bundleOptions.includeCard,
        includeProtocol: bundleOptions.includeProtocol,
        includeWitness: bundleOptions.includeWitness,
        issueDate: args.issueDate,
        itemsCount: args.items.length,
        requestCompanyRu,
        requestCompanyKz,
      }),
      certificateType: args.certificateType,
      biotDocumentKind: args.biotDocumentKind,
      includeCard: bundleOptions.includeCard,
      includeProtocol: bundleOptions.includeProtocol,
      includeWitness: bundleOptions.includeWitness,
      requestMode: args.requestMode,
      issueDate: args.issueDate,
      seriesNumber: args.seriesNumber.trim(),
      trainingSubject: args.trainingSubject,
      requestCompanyRu,
      requestCompanyKz,
      itemsCount: args.items.length,
    };
  }

  private async ensureRequest(companyId: string, requestId: string) {
    const request = await this.prisma.cardGenerationRequest.findFirst({
      where: {
        id: requestId,
        companyId,
      },
      include: {
        createdByUser: {
          select: {
            fullName: true,
          },
        },
        items: {
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });

    if (!request) {
      throw new NotFoundException("Заявка на корочки не найдена.");
    }

    return request;
  }

  private mapRequestSummary(request: {
    id: string;
    title: string;
    certificateType: SafetyCardType;
    biotDocumentKind: BiotDocumentKind;
    includeCard: boolean;
    includeProtocol: boolean;
    includeWitness: boolean;
    requestMode: GenerateBiotCardBatchInput["requestMode"];
    issueDate: Date;
    trainingSubject: string;
    requestCompanyRu: string | null;
    requestCompanyKz: string | null;
    itemsCount: number;
    createdAt: Date;
    createdByUser: {
      fullName: string;
    };
    items: Array<{
      id: string;
      fullName: string;
      fullNameKz: string | null;
      issuedTo: string | null;
      positionRu: string | null;
      positionKz: string | null;
      workplaceRu: string | null;
      workplaceKz: string | null;
      certificateNumber: string;
      protocolNumber: string;
      witnessCertificateNumber: string | null;
      witnessRegistrationNumber: string | null;
    }>;
  }) {
    const bundleOptions = this.resolveBundleOptions({
      certificateType: request.certificateType,
      biotDocumentKind: request.biotDocumentKind,
      includeCard: request.includeCard,
      includeProtocol: request.includeProtocol,
      includeWitness: request.includeWitness,
    });
    const firstWitnessCertificateNumber =
      this.normalizeOptionalText(request.items[0]?.witnessCertificateNumber) ??
      (this.isPsWitnessCertificate(
        request.certificateType,
        request.biotDocumentKind,
      )
        ? (request.items[0]?.certificateNumber ?? null)
        : null);
    const lastWitnessCertificateNumber =
      this.normalizeOptionalText(
        request.items[request.items.length - 1]?.witnessCertificateNumber,
      ) ??
      (this.isPsWitnessCertificate(
        request.certificateType,
        request.biotDocumentKind,
      )
        ? (request.items[request.items.length - 1]?.certificateNumber ?? null)
        : null);
    const firstWitnessRegistrationNumber =
      this.normalizeOptionalText(request.items[0]?.witnessRegistrationNumber) ??
      (this.isPsWitnessCertificate(
        request.certificateType,
        request.biotDocumentKind,
      )
        ? this.normalizeOptionalText(request.items[0]?.protocolNumber)
        : null);
    const lastWitnessRegistrationNumber =
      this.normalizeOptionalText(
        request.items[request.items.length - 1]?.witnessRegistrationNumber,
      ) ??
      (this.isPsWitnessCertificate(
        request.certificateType,
        request.biotDocumentKind,
      )
        ? this.normalizeOptionalText(
            request.items[request.items.length - 1]?.protocolNumber,
          )
        : null);

    return {
      id: request.id,
      title: request.title,
      certificateType: request.certificateType,
      biotDocumentKind: request.biotDocumentKind,
      includeCard: bundleOptions.includeCard,
      includeProtocol: bundleOptions.includeProtocol,
      includeWitness: bundleOptions.includeWitness,
      requestMode: request.requestMode,
      issueDate: request.issueDate.toISOString(),
      trainingSubject: request.trainingSubject,
      requestCompanyRu: request.requestCompanyRu,
      requestCompanyKz: request.requestCompanyKz,
      itemsCount: request.itemsCount,
      createdAt: request.createdAt.toISOString(),
      createdByUserName: request.createdByUser.fullName,
      firstCertificateNumber: request.items[0]?.certificateNumber ?? null,
      lastCertificateNumber:
        request.items[request.items.length - 1]?.certificateNumber ?? null,
      firstProtocolNumber:
        this.normalizeOptionalText(request.items[0]?.protocolNumber) ?? null,
      lastProtocolNumber:
        this.normalizeOptionalText(
          request.items[request.items.length - 1]?.protocolNumber,
        ) ?? null,
      firstWitnessCertificateNumber,
      lastWitnessCertificateNumber,
      firstWitnessRegistrationNumber,
      lastWitnessRegistrationNumber,
      protocolExportAvailable:
        bundleOptions.includeProtocol &&
        this.hasProtocolTemplate(
          request.certificateType,
          request.biotDocumentKind,
        ),
      witnessExportAvailable: bundleOptions.includeWitness,
      items: request.items.map((item) => ({
        id: item.id,
        fullName: item.fullName,
        fullNameKz:
          item.fullNameKz ??
          (this.isPsWitnessCertificate(
            request.certificateType,
            request.biotDocumentKind,
          )
            ? item.issuedTo
            : null),
        issuedTo: item.issuedTo,
        positionRu: item.positionRu,
        positionKz: item.positionKz,
        workplaceRu: item.workplaceRu,
        workplaceKz: item.workplaceKz,
        certificateNumber: item.certificateNumber,
        protocolNumber: item.protocolNumber,
        witnessCertificateNumber:
          item.witnessCertificateNumber ??
          (this.isPsWitnessCertificate(
            request.certificateType,
            request.biotDocumentKind,
          )
            ? item.certificateNumber
            : null),
        witnessRegistrationNumber:
          item.witnessRegistrationNumber ??
          (this.isPsWitnessCertificate(
            request.certificateType,
            request.biotDocumentKind,
          )
            ? item.protocolNumber
            : null),
      })),
    };
  }

  private mapRequestDetail(
    request: Awaited<ReturnType<BiotCardsService["ensureRequest"]>>,
  ) {
    return {
      ...this.mapRequestSummary(request),
      companyId: request.companyId,
      seriesNumber: request.seriesNumber,
      items: request.items.map((item) => ({
        id: item.id,
        employeeId: item.employeeId,
        trainingAssignmentId: item.trainingAssignmentId,
        fullName: item.fullName,
        fullNameKz:
          item.fullNameKz ??
          (this.isPsWitnessCertificate(
            request.certificateType,
            request.biotDocumentKind,
          )
            ? item.issuedTo
            : null),
        issuedTo: item.issuedTo,
        positionRu: item.positionRu,
        positionKz: item.positionKz,
        workplaceRu: item.workplaceRu,
        workplaceKz: item.workplaceKz,
        photoDataUrl: item.photoDataUrl,
        photoFileName: item.photoFileName,
        certificateNumber: item.certificateNumber,
        protocolNumber: item.protocolNumber,
        witnessCertificateNumber:
          item.witnessCertificateNumber ??
          (this.isPsWitnessCertificate(
            request.certificateType,
            request.biotDocumentKind,
          )
            ? item.certificateNumber
            : null),
        witnessRegistrationNumber:
          item.witnessRegistrationNumber ??
          (this.isPsWitnessCertificate(
            request.certificateType,
            request.biotDocumentKind,
          )
            ? item.protocolNumber
            : null),
      })),
    };
  }

  async getRequest(
    user: AuthenticatedUser,
    requestId: string,
    query: CardGenerationRequestQuery,
  ) {
    const companyId = requireCompanyScope(user, query.companyId);
    const request = await this.ensureRequest(companyId, requestId);
    return this.mapRequestDetail(request);
  }

  async listRequests(
    user: AuthenticatedUser,
    query: CardGenerationRequestQuery,
  ) {
    const companyId = requireCompanyScope(user, query.companyId);
    const requests = await this.prisma.cardGenerationRequest.findMany({
      where: {
        companyId,
      },
      include: {
        createdByUser: {
          select: {
            fullName: true,
          },
        },
        items: {
          orderBy: {
            createdAt: "asc",
          },
          select: {
            id: true,
            fullName: true,
            fullNameKz: true,
            issuedTo: true,
            positionRu: true,
            positionKz: true,
            workplaceRu: true,
            workplaceKz: true,
            certificateNumber: true,
            protocolNumber: true,
            witnessCertificateNumber: true,
            witnessRegistrationNumber: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 50,
    });

    return requests.map((request) => this.mapRequestSummary(request));
  }

  async updateRequest(
    user: AuthenticatedUser,
    requestId: string,
    input: UpdateCardGenerationRequestInput,
  ) {
    const companyId = requireCompanyScope(user, input.companyId);
    const existingRequest = await this.ensureRequest(companyId, requestId);
    const certificateType = existingRequest.certificateType;
    const biotDocumentKind = existingRequest.biotDocumentKind;

    if (input.certificateType !== certificateType) {
      throw new BadRequestException(
        "Тип корочки в существующей заявке менять нельзя.",
      );
    }

    if (
      this.normalizeBiotDocumentKind(
        input.certificateType,
        input.biotDocumentKind,
      ) !== biotDocumentKind
    ) {
      throw new BadRequestException(
        "Формат существующей заявки менять нельзя.",
      );
    }

    const issueDate = this.parseIssueDate(input.issueDate);
    const trainingSubject = this.isBiotItrCertificate(
      certificateType,
      biotDocumentKind,
    )
      ? this.getCardConfig(certificateType).defaultTrainingSubject
      : (this.normalizeOptionalText(input.trainingSubject) ??
        this.getCardConfig(certificateType).defaultTrainingSubject);
    const normalizedItems = await this.populateMissingBiotItrProtocolNumbers({
      user,
      companyId,
      certificateType,
      biotDocumentKind,
      issueDate: input.issueDate,
      includeProtocol: input.includeProtocol,
      items: input.items,
    });

    this.ensureUniqueBatchValues(
      certificateType,
      biotDocumentKind,
      normalizedItems,
    );
    await this.ensureNumbersAreAvailable(
      certificateType,
      biotDocumentKind,
      companyId,
      normalizedItems.map((item) => ({
        certificateNumber: item.certificateNumber,
        protocolNumber: item.protocolNumber,
        witnessCertificateNumber: item.witnessCertificateNumber,
        witnessRegistrationNumber: item.witnessRegistrationNumber,
      })),
      existingRequest.items.map((item) => item.certificateNumber),
      existingRequest.items.map((item) => item.protocolNumber),
      existingRequest.items.map(
        (item) =>
          item.witnessCertificateNumber ??
          (this.isPsWitnessCertificate(certificateType, biotDocumentKind)
            ? item.certificateNumber
            : ""),
      ),
      existingRequest.items.map(
        (item) =>
          item.witnessRegistrationNumber ??
          (this.isPsWitnessCertificate(certificateType, biotDocumentKind)
            ? item.protocolNumber
            : ""),
      ),
    );

    const preparedItems: BatchPreparedItem[] = [];

    for (const item of normalizedItems) {
      preparedItems.push(
        await this.prepareItem({
          certificateType,
          biotDocumentKind,
          includeCard: input.includeCard,
          includeProtocol: input.includeProtocol,
          includeWitness: input.includeWitness,
          companyId,
          issueDate,
          seriesNumber: input.seriesNumber,
          trainingSubject,
          item,
        }),
      );
    }

    const requestData = this.buildRequestRecordValues({
      certificateType,
      biotDocumentKind,
      includeCard: input.includeCard,
      includeProtocol: input.includeProtocol,
      includeWitness: input.includeWitness,
      issueDate,
      requestMode: input.requestMode,
      seriesNumber: input.seriesNumber,
      trainingSubject,
      requestCompanyRu: input.requestCompanyRu,
      requestCompanyKz: input.requestCompanyKz,
      items: preparedItems,
    });

    await this.prisma.cardGenerationRequest.update({
      where: {
        id: existingRequest.id,
      },
      data: {
        ...requestData,
        items: {
          deleteMany: {},
          create: preparedItems.map((item) => ({
            employeeId: item.employeeId,
            trainingAssignmentId: item.trainingAssignmentId,
            fullName: item.fullName,
            fullNameKz: item.fullNameKz,
            issuedTo: item.issuedTo,
            positionRu: item.positionRu,
            positionKz: item.positionKz,
            workplaceRu: item.workplaceRu,
            workplaceKz: item.workplaceKz,
            photoDataUrl: item.photo?.dataUrl,
            photoFileName: item.photo?.fileName,
            certificateNumber: item.certificateNumber,
            protocolNumber: item.protocolNumber,
            witnessCertificateNumber: item.witnessCertificateNumber,
            witnessRegistrationNumber: item.witnessRegistrationNumber,
          })),
        },
      },
    });

    await this.removeArtifactLogs(
      companyId,
      certificateType,
      biotDocumentKind,
      existingRequest.items,
    );
    await this.logArtifacts(user, companyId, preparedItems, existingRequest.id);
    await this.auditService.log({
      actorUserId: user.userId,
      companyId,
      action: "biot_card.request_updated",
      entityType: "CardGenerationRequest",
      entityId: existingRequest.id,
      metadata: {
        certificateType,
        biotDocumentKind,
        itemsCount: preparedItems.length,
      },
    });

    return this.getRequest(user, existingRequest.id, { companyId });
  }

  async deleteRequest(
    user: AuthenticatedUser,
    requestId: string,
    query: CardGenerationRequestQuery,
  ) {
    const companyId = requireCompanyScope(user, query.companyId);
    const existingRequest = await this.ensureRequest(companyId, requestId);

    await this.removeArtifactLogs(
      companyId,
      existingRequest.certificateType,
      existingRequest.biotDocumentKind,
      existingRequest.items,
    );

    await this.prisma.auditLog.deleteMany({
      where: {
        companyId,
        OR: [
          {
            entityType: "CardGenerationRequest",
            entityId: existingRequest.id,
          },
          {
            action: "biot_card.generated",
            entityType: "BiotCardTemplate",
            metadata: {
              path: ["requestId"],
              equals: existingRequest.id,
            },
          },
        ],
      },
    });

    await this.prisma.cardGenerationRequest.delete({
      where: {
        id: existingRequest.id,
      },
    });

    await this.auditService.log({
      actorUserId: user.userId,
      companyId,
      action: "biot_card.request_deleted",
      entityType: "CardGenerationRequest",
      entityId: existingRequest.id,
      metadata: {
        certificateType: existingRequest.certificateType,
        biotDocumentKind: existingRequest.biotDocumentKind,
        itemsCount: existingRequest.itemsCount,
      },
    });

    return {
      success: true,
    };
  }

  private async exportRegistryWorkbook(payload: {
    request: {
      title: string;
      certificateTypeLabel: string;
      issueDate: string;
      createdAt: string;
      createdByUserName: string;
      requestCompanyRu: string | null;
      requestCompanyKz: string | null;
    };
    items: Array<{
      index: number;
      fullName: string;
      positionRu: string | null;
      positionKz: string | null;
      workplaceRu: string | null;
      workplaceKz: string | null;
      certificateNumber: string;
      protocolNumber: string;
    }>;
  }) {
    await Promise.all([
      assertReadablePath(
        this.registryExportScriptPath,
        "Registry export script is missing on the server.",
      ),
      assertPython3Available(
        "python3 is required to export BIOT registries on the server.",
      ),
      assertPythonModuleAvailable(
        "openpyxl",
        "openpyxl is required to export BIOT registries on the server.",
      ),
    ]);

    const workingDirectory = await mkdtemp(
      join(tmpdir(), "dsj-biot-registry-"),
    );
    const outputPath = join(workingDirectory, "card-request-registry.xlsx");

    try {
      await new Promise<void>((resolvePromise, rejectPromise) => {
        const processHandle = spawn(
          getPythonCommand(),
          [this.registryExportScriptPath, outputPath],
          {
            cwd: this.workspaceRoot,
            env: getPythonProcessEnv(),
            stdio: ["pipe", "ignore", "pipe"],
          },
        );

        let stderrOutput = "";

        processHandle.stderr.on("data", (chunk) => {
          stderrOutput += chunk.toString("utf8");
        });

        processHandle.on("error", (error) => {
          rejectPromise(error);
        });

        processHandle.on("close", (code) => {
          if (code === 0) {
            resolvePromise();
            return;
          }

          rejectPromise(
            new Error(
              stderrOutput.trim() ||
                `Экспорт реестра завершился с кодом ${code}.`,
            ),
          );
        });

        processHandle.stdin.write(Buffer.from(JSON.stringify(payload), "utf8"));
        processHandle.stdin.end();
      });

      return await readFile(outputPath);
    } catch (error) {
      throw new InternalServerErrorException(
        error instanceof Error
          ? error.message
          : "Не удалось сформировать реестр.",
      );
    } finally {
      await rm(workingDirectory, { recursive: true, force: true });
    }
  }

  async exportRequestRegistry(
    user: AuthenticatedUser,
    requestId: string,
    query: CardGenerationRequestQuery = {},
  ) {
    const companyId = requireCompanyScope(user, query.companyId);
    return this.exportRequestRegistryForCompany(companyId, requestId);
  }

  private async exportRequestRegistryForCompany(
    companyId: string,
    requestId: string,
  ) {
    const request = await this.ensureRequest(companyId, requestId);
    const buffer = await this.exportRegistryWorkbook({
      request: {
        title: request.title,
        certificateTypeLabel: this.getCardDisplayLabel(
          request.certificateType,
          request.biotDocumentKind,
        ),
        issueDate: this.formatDisplayDate(request.issueDate),
        createdAt: request.createdAt.toISOString(),
        createdByUserName: request.createdByUser.fullName,
        requestCompanyRu: request.requestCompanyRu,
        requestCompanyKz: request.requestCompanyKz,
      },
      items: request.items.map((item, index) => ({
        index: index + 1,
        fullName: item.fullName,
        positionRu: item.positionRu,
        positionKz: item.positionKz,
        workplaceRu: item.workplaceRu,
        workplaceKz: item.workplaceKz,
        certificateNumber: item.certificateNumber,
        protocolNumber: item.protocolNumber,
      })),
    });

    return {
      buffer,
      fileName: `card-request-registry-${request.id}.xlsx`,
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  }

  private buildPsWitnessRowsFromRequest(
    request: Awaited<ReturnType<BiotCardsService["ensureRequest"]>>,
  ) {
    return request.items.map((item) =>
      this.buildPsWitnessCertificateFields({
        issueDate: request.issueDate,
        certificateNumber:
          item.witnessCertificateNumber ??
          (this.isPsWitnessCertificate(
            request.certificateType,
            request.biotDocumentKind,
          )
            ? item.certificateNumber
            : ""),
        protocolNumber: item.protocolNumber,
        registrationNumber:
          item.witnessRegistrationNumber ??
          (this.isPsWitnessCertificate(
            request.certificateType,
            request.biotDocumentKind,
          )
            ? item.protocolNumber
            : ""),
        fullName: item.fullName,
        fullNameKz:
          item.fullNameKz ??
          (this.isPsWitnessCertificate(
            request.certificateType,
            request.biotDocumentKind,
          )
            ? item.issuedTo
            : null),
        positionRu: item.positionRu,
        positionKz: item.positionKz,
      }),
    );
  }

  async exportRequestCards(
    user: AuthenticatedUser,
    requestId: string,
    query: CardGenerationRequestQuery = {},
  ) {
    const companyId = requireCompanyScope(user, query.companyId);
    return this.exportRequestCardsForCompany(companyId, requestId);
  }

  private async exportRequestCardsForCompany(
    companyId: string,
    requestId: string,
  ) {
    const request = await this.ensureRequest(companyId, requestId);
    const bundleOptions = this.resolveBundleOptions({
      certificateType: request.certificateType,
      biotDocumentKind: request.biotDocumentKind,
      includeCard: request.includeCard,
      includeProtocol: request.includeProtocol,
      includeWitness: request.includeWitness,
    });

    if (
      this.isBiotItrCertificate(
        request.certificateType,
        request.biotDocumentKind,
      )
    ) {
      const rows = request.items.map((item) => ({
        fields: this.buildBiotItrCertificateFields({
          issuedTo: item.issuedTo,
          fullName: item.fullName,
        }),
        photo: null,
        textReplacements: this.buildBiotItrCertificateTextReplacements({
          issueDate: request.issueDate,
          certificateNumber: item.certificateNumber,
        }),
      }));

      if (rows.length === 1) {
        const buffer = await this.renderTemplateFromPath(
          this.getBiotItrCertificateTemplatePath(),
          "БиОТ Сертификат ИТР",
          rows[0].fields,
          null,
          undefined,
          rows[0].textReplacements ?? [],
        );

        return {
          buffer,
          fileName: `biot-itr-certificate-${request.id}.docx`,
          contentType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        };
      }

      const buffer = await this.renderPreviewDocumentFromPath({
        templatePath: this.getBiotItrCertificateTemplatePath(),
        label: "БиОТ Сертификат ИТР",
        previewFileName: BIOT_ITR_CERTIFICATE_PREVIEW_FILE_NAME,
        rows,
        certificateType: "BIOT",
      });

      return {
        buffer,
        fileName: BIOT_ITR_CERTIFICATE_PREVIEW_FILE_NAME,
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      };
    }

    if (
      this.isPsWitnessCertificate(
        request.certificateType,
        request.biotDocumentKind,
      ) ||
      (request.certificateType === "PS" &&
        !bundleOptions.includeCard &&
        bundleOptions.includeWitness)
    ) {
      const rows = this.buildPsWitnessRowsFromRequest(request);
      const buffer = await this.renderPsWitnessCertificateRows(rows);

      return {
        buffer,
        fileName:
          rows.length === 1
            ? `ps-witness-certificate-${request.id}.docx`
            : PS_WITNESS_CERTIFICATE_PREVIEW_FILE_NAME,
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      };
    }

    if (!bundleOptions.includeCard) {
      throw new BadRequestException("Для этой заявки корочки не включены.");
    }

    const label = `Корочки ${this.getCardConfig(request.certificateType).label}`;
    const rows = request.items.map((item) =>
      this.buildMergeFields({
        certificateType: request.certificateType,
        biotDocumentKind: request.biotDocumentKind,
        issueDate: request.issueDate,
        seriesNumber: request.seriesNumber,
        certificateNumber: item.certificateNumber,
        protocolNumber: item.protocolNumber,
        trainingSubject: request.trainingSubject,
        fullName: item.fullName,
        fullNameKz:
          item.fullNameKz ??
          (this.isPsWitnessCertificate(
            request.certificateType,
            request.biotDocumentKind,
          )
            ? item.issuedTo
            : null),
        issuedTo: item.issuedTo,
        positionRu: item.positionRu,
        positionKz: item.positionKz,
        workplaceRu: request.requestCompanyRu ?? item.workplaceRu,
        workplaceKz:
          request.requestCompanyKz ?? item.workplaceKz ?? item.workplaceRu,
      }),
    );

    if (rows.length === 1) {
      const buffer = await this.renderTemplateFromPath(
        this.getTemplatePath(request.certificateType),
        label,
        rows[0],
        this.buildPhotoAsset({
          certificateType: request.certificateType,
          biotDocumentKind: request.biotDocumentKind,
          fullName: request.items[0]?.fullName ?? null,
          photoDataUrl: request.items[0]?.photoDataUrl,
          photoFileName: request.items[0]?.photoFileName,
          requirePhoto: false,
        }),
        request.certificateType,
      );

      return {
        buffer,
        fileName: `${request.certificateType.toLowerCase()}-card-${request.id}.docx`,
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      };
    }

    const buffer = await this.renderPreviewDocumentFromPath({
      templatePath: this.getTemplatePath(request.certificateType),
      label,
      previewFileName: this.getCardConfig(request.certificateType)
        .previewFileName,
      rows: request.items.map((item, index) => ({
        fields: rows[index],
        photo: this.buildPhotoAsset({
          certificateType: request.certificateType,
          biotDocumentKind: request.biotDocumentKind,
          fullName: item.fullName,
          photoDataUrl: item.photoDataUrl,
          photoFileName: item.photoFileName,
          requirePhoto: false,
        }),
      })),
      certificateType: request.certificateType,
    });

    return {
      buffer,
      fileName: this.getCardConfig(request.certificateType).previewFileName,
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  }

  async exportRequestProtocol(
    user: AuthenticatedUser,
    requestId: string,
    query: CardGenerationRequestQuery = {},
  ) {
    const companyId = requireCompanyScope(user, query.companyId);
    return this.exportRequestProtocolForCompany(companyId, requestId);
  }

  private async exportRequestProtocolForCompany(
    companyId: string,
    requestId: string,
  ) {
    const request = await this.ensureRequest(companyId, requestId);
    const bundleOptions = this.resolveBundleOptions({
      certificateType: request.certificateType,
      biotDocumentKind: request.biotDocumentKind,
      includeCard: request.includeCard,
      includeProtocol: request.includeProtocol,
      includeWitness: request.includeWitness,
    });

    if (
      !bundleOptions.includeProtocol ||
      !this.hasProtocolTemplate(
        request.certificateType,
        request.biotDocumentKind,
      )
    ) {
      throw new BadRequestException(
        "Для этого типа документа протокол не используется.",
      );
    }

    const templatePath = this.getProtocolTemplatePath(request.certificateType);
    const previewFileName =
      this.getCardConfig(request.certificateType).protocolPreviewFileName ??
      "card-protocol-preview-all.docx";
    const protocolLabel = `Протокол ${this.getCardConfig(request.certificateType).label}`;

    if (!templatePath) {
      throw new BadRequestException(
        "Для этого типа корочек шаблон протокола не настроен.",
      );
    }

    const rows: TemplateRenderRow[] = request.items.map((item) => {
      const workplaceRu = request.requestCompanyRu ?? item.workplaceRu;
      const workplaceKz =
        request.requestCompanyKz ?? item.workplaceKz ?? item.workplaceRu;

      return {
        fields: this.buildProtocolFields({
          certificateType: request.certificateType,
          issueDate: request.issueDate,
          protocolNumber: item.protocolNumber,
          certificateNumber: item.certificateNumber,
          fullName: item.fullName,
          issuedTo: item.issuedTo,
          positionRu: item.positionRu,
          positionKz: item.positionKz,
          workplaceRu,
          workplaceKz,
        }),
        photo: null,
        textReplacements: this.buildProtocolTextReplacements({
          certificateType: request.certificateType,
          issueDate: request.issueDate,
          workplaceRu,
          workplaceKz,
        }),
      };
    });

    if (rows.length === 1) {
      const buffer = await this.renderTemplateFromPath(
        templatePath,
        protocolLabel,
        rows[0].fields,
        null,
        undefined,
        rows[0].textReplacements ?? [],
      );
      return {
        buffer,
        fileName: `${request.certificateType.toLowerCase()}-protocol-${request.id}.docx`,
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      };
    }

    const buffer = await this.renderPreviewDocumentFromPath({
      templatePath,
      label: protocolLabel,
      previewFileName,
      rows,
      certificateType: request.certificateType,
    });

    return {
      buffer,
      fileName: previewFileName,
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  }

  async exportRequestWitness(
    user: AuthenticatedUser,
    requestId: string,
    query: CardGenerationRequestQuery = {},
  ) {
    const companyId = requireCompanyScope(user, query.companyId);
    return this.exportRequestWitnessForCompany(companyId, requestId);
  }

  private async exportRequestWitnessForCompany(
    companyId: string,
    requestId: string,
  ) {
    const request = await this.ensureRequest(companyId, requestId);
    const bundleOptions = this.resolveBundleOptions({
      certificateType: request.certificateType,
      biotDocumentKind: request.biotDocumentKind,
      includeCard: request.includeCard,
      includeProtocol: request.includeProtocol,
      includeWitness: request.includeWitness,
    });

    if (
      request.certificateType !== "PS" ||
      (!bundleOptions.includeWitness &&
        !this.isPsWitnessCertificate(
          request.certificateType,
          request.biotDocumentKind,
        ))
    ) {
      throw new BadRequestException(
        "Для этой заявки свидетельство не используется.",
      );
    }

    const rows = this.buildPsWitnessRowsFromRequest(request);
    const buffer = await this.renderPsWitnessCertificateRows(rows);

    return {
      buffer,
      fileName:
        rows.length === 1
          ? `ps-witness-certificate-${request.id}.docx`
          : PS_WITNESS_CERTIFICATE_PREVIEW_FILE_NAME,
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  }

  async getDefaults(user: AuthenticatedUser, query: BiotCardDefaultsQuery) {
    const companyId = requireCompanyScope(user, query.companyId);
    const issueDate = this.parseIssueDate(query.issueDate);
    const certificateType = query.certificateType;
    const biotDocumentKind = this.normalizeBiotDocumentKind(
      certificateType,
      query.biotDocumentKind,
    );
    const config = this.getCardConfig(certificateType);
    const logs = await this.listGenerationLogs(
      companyId,
      certificateType,
      biotDocumentKind,
    );
    const witnessLogs =
      certificateType === "PS" && biotDocumentKind === "WORKER_CARD"
        ? await this.listPsWitnessLogs(companyId)
        : [];

    let certificateSequence = 1;
    let protocolSequence = 1;
    let witnessCertificateSequence = 1;
    let witnessRegistrationSequence = 1;

    for (const log of logs) {
      const certificateNumber = this.readMetadataString(
        log.metadata,
        "certificateNumber",
      );
      const protocolNumber = this.readMetadataString(
        log.metadata,
        "protocolNumber",
      );
      const parsedCertificateSequence = certificateNumber
        ? this.extractCertificateSequence(
            certificateType,
            certificateNumber,
            issueDate,
            biotDocumentKind,
          )
        : null;
      const parsedProtocolSequence = protocolNumber
        ? this.extractProtocolSequence(
            certificateType,
            protocolNumber,
            issueDate,
            biotDocumentKind,
          )
        : null;

      if (parsedCertificateSequence) {
        certificateSequence = Math.max(
          certificateSequence,
          parsedCertificateSequence + 1,
        );
      }

      if (parsedProtocolSequence) {
        protocolSequence = Math.max(
          protocolSequence,
          parsedProtocolSequence + 1,
        );
      }
    }

    for (const log of witnessLogs) {
      const witnessCertificateNumber =
        this.readWitnessCertificateNumberFromLog(log);
      const witnessRegistrationNumber =
        this.readWitnessRegistrationNumberFromLog(log);
      const parsedWitnessCertificateSequence = witnessCertificateNumber
        ? this.extractPsWitnessCertificateSequence(
            witnessCertificateNumber,
            issueDate,
          )
        : null;
      const parsedWitnessRegistrationSequence = witnessRegistrationNumber
        ? this.extractPsWitnessRegistrationSequence(witnessRegistrationNumber)
        : null;

      if (parsedWitnessCertificateSequence) {
        witnessCertificateSequence = Math.max(
          witnessCertificateSequence,
          parsedWitnessCertificateSequence + 1,
        );
      }

      if (parsedWitnessRegistrationSequence) {
        witnessRegistrationSequence = Math.max(
          witnessRegistrationSequence,
          parsedWitnessRegistrationSequence + 1,
        );
      }
    }

    return {
      certificateType,
      biotDocumentKind,
      defaultTrainingSubject: config.defaultTrainingSubject,
      trainingSubjectPresets: Array.from(
        new Set([
          ...config.trainingSubjectPresets,
          ...this.buildPresetList(logs),
        ]),
      ),
      nextCertificateNumber: this.formatCertificateNumber(
        certificateType,
        issueDate,
        certificateSequence,
        biotDocumentKind,
      ),
      nextProtocolNumber: this.formatProtocolNumber(
        certificateType,
        issueDate,
        protocolSequence,
        biotDocumentKind,
      ),
      nextCertificateSequence: certificateSequence,
      nextProtocolSequence: protocolSequence,
      nextWitnessCertificateNumber:
        certificateType === "PS" && biotDocumentKind === "WORKER_CARD"
          ? this.formatPsWitnessCertificateNumber(
              issueDate,
              witnessCertificateSequence,
            )
          : undefined,
      nextWitnessRegistrationNumber:
        certificateType === "PS" && biotDocumentKind === "WORKER_CARD"
          ? this.formatPsWitnessRegistrationNumber(witnessRegistrationSequence)
          : undefined,
      nextWitnessCertificateSequence:
        certificateType === "PS" && biotDocumentKind === "WORKER_CARD"
          ? witnessCertificateSequence
          : undefined,
      nextWitnessRegistrationSequence:
        certificateType === "PS" && biotDocumentKind === "WORKER_CARD"
          ? witnessRegistrationSequence
          : undefined,
    };
  }

  private async prepareItem(args: {
    certificateType: SafetyCardType;
    biotDocumentKind: BiotDocumentKind;
    includeCard?: boolean;
    includeProtocol?: boolean;
    includeWitness?: boolean;
    companyId: string;
    issueDate: Date;
    seriesNumber: string;
    trainingSubject: string;
    item: GenerateBiotCardBatchItem;
  }): Promise<BatchPreparedItem> {
    let employee: EmployeeTemplateSource | null = null;
    let trainingAssignment: TrainingTemplateSource = null;

    if (args.item.employeeId) {
      employee = await this.ensureEmployee(
        args.companyId,
        args.item.employeeId,
      );
      trainingAssignment = await this.ensureTrainingAssignment(
        args.companyId,
        employee.id,
        args.item.trainingAssignmentId ?? null,
      );
    } else if (args.item.trainingAssignmentId) {
      throw new BadRequestException(
        "Для отдельной заявки нельзя выбирать обучение без сотрудника компании.",
      );
    }

    const bundleOptions = this.resolveBundleOptions({
      certificateType: args.certificateType,
      biotDocumentKind: args.biotDocumentKind,
      includeCard: args.includeCard,
      includeProtocol: args.includeProtocol,
      includeWitness: args.includeWitness,
    });

    const fullName =
      this.normalizeOptionalText(args.item.fullName) ??
      employee?.fullName ??
      null;
    const fullNameKz =
      this.normalizeOptionalText(args.item.fullNameKz) ??
      fullName ??
      employee?.fullName ??
      (this.isPsWitnessCertificate(args.certificateType, args.biotDocumentKind)
        ? this.normalizeOptionalText(args.item.issuedTo)
        : null);
    const issuedTo =
      this.normalizeOptionalText(args.item.issuedTo) ??
      fullName ??
      employee?.fullName ??
      null;
    const positionRu =
      this.normalizeOptionalText(args.item.positionRu) ??
      this.normalizeOptionalText(args.item.positionKz) ??
      employee?.jobTitle ??
      null;
    const positionKz =
      this.normalizeOptionalText(args.item.positionKz) ??
      positionRu ??
      employee?.jobTitle ??
      null;
    const workplaceRu =
      this.normalizeOptionalText(args.item.workplaceRu) ??
      this.normalizeOptionalText(args.item.workplaceKz) ??
      (employee ? this.getDefaultWorkplace(employee) : null);
    const workplaceKz =
      this.normalizeOptionalText(args.item.workplaceKz) ??
      workplaceRu ??
      (employee ? this.getDefaultWorkplace(employee) : null);
    const normalizedProtocolNumber =
      this.normalizeOptionalText(args.item.protocolNumber) ?? "";
    const witnessCertificateNumber = bundleOptions.includeWitness
      ? this.normalizeOptionalText(args.item.witnessCertificateNumber)
      : this.isPsWitnessCertificate(args.certificateType, args.biotDocumentKind)
        ? args.item.certificateNumber.trim()
        : null;
    const witnessRegistrationNumber = bundleOptions.includeWitness
      ? this.normalizeOptionalText(args.item.witnessRegistrationNumber)
      : this.isPsWitnessCertificate(args.certificateType, args.biotDocumentKind)
        ? normalizedProtocolNumber
        : null;

    const requiresProtocolNumber =
      !this.isBiotItrCertificate(args.certificateType, args.biotDocumentKind) ||
      bundleOptions.includeProtocol;

    if (requiresProtocolNumber && !normalizedProtocolNumber) {
      throw new BadRequestException(
        this.isPsWitnessCertificate(args.certificateType, args.biotDocumentKind)
          ? "Укажите регистрационный номер."
          : "Укажите номер протокола.",
      );
    }

    if (bundleOptions.includeWitness && !witnessCertificateNumber) {
      throw new BadRequestException(
        `Укажите номер КБ для ${fullName ?? "сотрудника"} в свидетельстве ПС.`,
      );
    }

    if (bundleOptions.includeWitness && !witnessRegistrationNumber) {
      throw new BadRequestException(
        `Укажите регистрационный номер для ${fullName ?? "сотрудника"} в свидетельстве ПС.`,
      );
    }

    const fields = this.isBiotItrCertificate(
      args.certificateType,
      args.biotDocumentKind,
    )
      ? this.buildBiotItrCertificateFields({
          issuedTo,
          fullName,
        })
      : this.buildMergeFields({
          certificateType: args.certificateType,
          biotDocumentKind: args.biotDocumentKind,
          issueDate: args.issueDate,
          seriesNumber: args.seriesNumber,
          certificateNumber: args.item.certificateNumber,
          protocolNumber: normalizedProtocolNumber,
          trainingSubject: args.trainingSubject,
          fullName,
          fullNameKz,
          issuedTo,
          positionRu,
          positionKz,
          workplaceRu,
          workplaceKz,
        });
    const photo = this.buildPhotoAsset({
      certificateType: args.certificateType,
      biotDocumentKind: args.biotDocumentKind,
      fullName,
      photoDataUrl: args.item.photoDataUrl,
      photoFileName: args.item.photoFileName,
      requirePhoto:
        args.certificateType === "PS" ? bundleOptions.includeCard : undefined,
    });
    const fileNameBase =
      this.sanitizeFileNamePart(args.item.certificateNumber.trim()) ||
      `biot-card-${employee?.id ?? "manual"}`;
    const filePrefix = this.isBiotItrCertificate(
      args.certificateType,
      args.biotDocumentKind,
    )
      ? "biot-itr-certificate"
      : this.isPsWitnessCertificate(args.certificateType, args.biotDocumentKind)
        ? "ps-witness-certificate"
        : this.getCardConfig(args.certificateType).singleFilePrefix;

    return {
      fields,
      fileName: `${filePrefix}-${fileNameBase}.docx`,
      employeeId: employee?.id ?? null,
      certificateNumber: args.item.certificateNumber.trim(),
      certificateType: args.certificateType,
      protocolNumber: normalizedProtocolNumber,
      trainingAssignmentId: trainingAssignment?.id ?? null,
      trainingSubject: args.trainingSubject,
      fullName: fullName ?? "",
      fullNameKz,
      issuedTo: issuedTo ?? fullName ?? "",
      positionRu,
      positionKz,
      workplaceRu,
      workplaceKz,
      witnessCertificateNumber,
      witnessRegistrationNumber,
      photo,
      biotDocumentKind: args.biotDocumentKind,
    };
  }

  private async renderPreviewDocumentFromPath(args: {
    templatePath: string;
    label: string;
    previewFileName: string;
    rows: TemplateRenderRow[];
    certificateType: SafetyCardType;
  }) {
    await Promise.all([
      assertReadablePath(
        args.templatePath,
        `DOCX template for the ${args.label} preview bundle is missing on the server.`,
      ),
      assertReadablePath(
        this.mailMergeBundleScriptPath,
        "DOCX preview bundle script is missing on the server.",
      ),
      assertPython3Available(
        "python3 is required to generate BIOT preview DOCX files on the server.",
      ),
    ]);

    const workingDirectory = await mkdtemp(
      join(tmpdir(), "dsj-biot-mail-merge-"),
    );
    const outputPath = join(workingDirectory, args.previewFileName);

    try {
      await new Promise<void>((resolvePromise, rejectPromise) => {
        const processHandle = spawn(
          getPythonCommand(),
          [this.mailMergeBundleScriptPath, args.templatePath, outputPath],
          {
            cwd: this.workspaceRoot,
            env: getPythonProcessEnv(),
            stdio: ["pipe", "ignore", "pipe"],
          },
        );

        let stderrOutput = "";

        processHandle.stderr.on("data", (chunk) => {
          stderrOutput += chunk.toString("utf8");
        });

        processHandle.on("error", (error) => {
          rejectPromise(error);
        });

        processHandle.on("close", (code) => {
          if (code === 0) {
            resolvePromise();
            return;
          }

          rejectPromise(
            new Error(
              stderrOutput.trim() ||
                `Генератор общего документа завершился с кодом ${code}.`,
            ),
          );
        });

        processHandle.stdin.write(
          Buffer.from(
            JSON.stringify({
              rows: args.rows.map((row) => ({
                fields: row.fields,
                textReplacements: row.textReplacements ?? [],
                fieldStyleOverrides: this.getFieldStyleOverrides(
                  args.certificateType,
                ),
                photo: this.buildPhotoRenderPayload(
                  args.certificateType,
                  row.photo,
                ),
              })),
            }),
            "utf8",
          ),
        );
        processHandle.stdin.end();
      });

      return await readFile(outputPath);
    } catch (error) {
      throw new InternalServerErrorException(
        error instanceof Error
          ? error.message
          : `Не удалось подготовить общий документ ${args.label}.`,
      );
    } finally {
      await rm(workingDirectory, { recursive: true, force: true });
    }
  }

  private async renderPreviewDocument(
    certificateType: SafetyCardType,
    items: BatchPreparedItem[],
  ) {
    return this.renderPreviewDocumentFromPath({
      templatePath: this.getTemplatePath(certificateType),
      label: this.getCardConfig(certificateType).label,
      previewFileName: this.getCardConfig(certificateType).previewFileName,
      rows: items.map((item) => ({
        fields: item.fields,
        photo: item.photo,
      })),
      certificateType,
    });
  }

  private async logArtifacts(
    user: AuthenticatedUser,
    companyId: string,
    artifacts: BatchPreparedItem[],
    requestId?: string,
    transaction?: Pick<Prisma.TransactionClient, "auditLog">,
  ) {
    for (const artifact of artifacts) {
      await this.auditService.log({
        actorUserId: user.userId,
        companyId,
        action: "biot_card.generated",
        entityType: "BiotCardTemplate",
        entityId: randomUUID(),
        metadata: {
          employeeId: artifact.employeeId,
          trainingAssignmentId: artifact.trainingAssignmentId,
          certificateNumber: artifact.certificateNumber,
          certificateType: artifact.certificateType,
          biotDocumentKind: artifact.biotDocumentKind,
          protocolNumber: artifact.protocolNumber,
          witnessCertificateNumber: artifact.witnessCertificateNumber,
          witnessRegistrationNumber: artifact.witnessRegistrationNumber,
          trainingSubject: artifact.trainingSubject,
          requestId: requestId ?? null,
          templatePath: this.isBiotItrCertificate(
            artifact.certificateType,
            artifact.biotDocumentKind,
          )
            ? BIOT_ITR_CERTIFICATE_TEMPLATE_PATH
            : this.getCardConfig(artifact.certificateType).templatePath,
        },
      }, transaction);
    }
  }

  private async removeArtifactLogs(
    companyId: string,
    certificateType: SafetyCardType,
    biotDocumentKind: BiotDocumentKind,
    items: Array<{
      certificateNumber: string;
      protocolNumber: string;
      witnessCertificateNumber?: string | null;
      witnessRegistrationNumber?: string | null;
    }>,
  ) {
    const filters = items.flatMap((item) => {
      const normalizedCertificateNumber = item.certificateNumber.trim();
      const normalizedProtocolNumber = this.normalizeOptionalText(
        item.protocolNumber,
      );
      const normalizedWitnessCertificateNumber = this.normalizeOptionalText(
        item.witnessCertificateNumber,
      );
      const normalizedWitnessRegistrationNumber = this.normalizeOptionalText(
        item.witnessRegistrationNumber,
      );
      return [
        {
          metadata: {
            path: ["certificateNumber"],
            equals: normalizedCertificateNumber,
          },
        },
        ...(normalizedProtocolNumber
          ? [
              {
                metadata: {
                  path: ["protocolNumber"],
                  equals: normalizedProtocolNumber,
                },
              },
            ]
          : []),
        ...(normalizedWitnessCertificateNumber
          ? [
              {
                metadata: {
                  path: ["witnessCertificateNumber"],
                  equals: normalizedWitnessCertificateNumber,
                },
              },
            ]
          : []),
        ...(normalizedWitnessRegistrationNumber
          ? [
              {
                metadata: {
                  path: ["witnessRegistrationNumber"],
                  equals: normalizedWitnessRegistrationNumber,
                },
              },
            ]
          : []),
      ];
    });

    if (!filters.length) {
      return;
    }

    await this.prisma.auditLog.deleteMany({
      where: {
        companyId,
        action: "biot_card.generated",
        entityType: "BiotCardTemplate",
        AND: [
          {
            metadata: {
              path: ["certificateType"],
              equals: certificateType,
            },
          },
          ...(certificateType === "BIOT" || certificateType === "PS"
            ? [
                {
                  metadata: {
                    path: ["biotDocumentKind"],
                    equals: biotDocumentKind,
                  },
                },
              ]
            : []),
        ],
        OR: filters,
      },
    });
  }

  async generate(user: AuthenticatedUser, input: GenerateBiotCardInput) {
    const biotDocumentKind = this.normalizeBiotDocumentKind(
      input.certificateType,
      input.biotDocumentKind,
    );
    const batchResult = await this.generateBatch(user, {
      companyId: input.companyId,
      certificateType: input.certificateType,
      biotDocumentKind,
      requestMode: "EMPLOYEE",
      issueDate: input.issueDate,
      seriesNumber: input.seriesNumber,
      trainingSubject:
        this.normalizeOptionalText(input.trainingSubject) ??
        this.getCardConfig(input.certificateType).defaultTrainingSubject,
      items: [
        {
          employeeId: input.employeeId,
          trainingAssignmentId: input.trainingAssignmentId ?? null,
          fullName: input.fullName,
          issuedTo: input.issuedTo,
          positionRu: input.positionRu,
          positionKz: input.positionKz,
          workplaceRu: input.workplaceRu,
          workplaceKz: input.workplaceKz,
          photoDataUrl: input.photoDataUrl,
          photoFileName: input.photoFileName,
          certificateNumber: input.certificateNumber,
          protocolNumber: this.isBiotItrCertificate(
            input.certificateType,
            biotDocumentKind,
          )
            ? ""
            : (input.protocolNumber ??
              this.formatProtocolNumber(
                input.certificateType,
                this.parseIssueDate(input.issueDate),
                1,
                biotDocumentKind,
              )),
        },
      ],
    });

    return batchResult;
  }

  async generateBatch(
    user: AuthenticatedUser,
    input: GenerateBiotCardBatchInput,
  ) {
    const companyId = requireCompanyScope(user, input.companyId);
    const issueDate = this.parseIssueDate(input.issueDate);
    const certificateType = input.certificateType;
    const biotDocumentKind = this.normalizeBiotDocumentKind(
      certificateType,
      input.biotDocumentKind,
    );
    const bundleOptions = this.resolveBundleOptions({
      certificateType,
      biotDocumentKind,
      includeCard: input.includeCard,
      includeProtocol: input.includeProtocol,
      includeWitness: input.includeWitness,
    });
    const trainingSubject =
      this.normalizeOptionalText(input.trainingSubject) ??
      this.getCardConfig(certificateType).defaultTrainingSubject;
    const normalizedItems = await this.populateMissingBiotItrProtocolNumbers({
      user,
      companyId,
      certificateType,
      biotDocumentKind,
      issueDate: input.issueDate,
      includeProtocol: input.includeProtocol,
      items: input.items,
    });

    this.ensureUniqueBatchValues(
      certificateType,
      biotDocumentKind,
      normalizedItems,
    );
    await this.ensureNumbersAreAvailable(
      certificateType,
      biotDocumentKind,
      companyId,
      normalizedItems.map((item) => ({
        certificateNumber: item.certificateNumber,
        protocolNumber: item.protocolNumber,
        witnessCertificateNumber: item.witnessCertificateNumber,
        witnessRegistrationNumber: item.witnessRegistrationNumber,
      })),
    );

    const preparedItems: BatchPreparedItem[] = [];

    for (const item of normalizedItems) {
      preparedItems.push(
        await this.prepareItem({
          certificateType,
          biotDocumentKind,
          includeCard: input.includeCard,
          includeProtocol: input.includeProtocol,
          includeWitness: bundleOptions.includeWitness,
          companyId,
          issueDate,
          seriesNumber: input.seriesNumber,
          trainingSubject,
          item,
        }),
      );
    }
    // Persist the request and every existing audit event together. Rendering is
    // deliberately outside the transaction: it invokes an external process.
    const request = await this.prisma.$transaction(async (transaction) => {
      const created = await this.createRequestRecord({
        user,
        companyId,
        issueDate,
        input,
        trainingSubject,
        items: preparedItems,
        biotDocumentKind,
      }, transaction);
      await this.logArtifacts(user, companyId, preparedItems, created.id, transaction);
      return created;
    }, { timeout: 30_000 });

    const exportResult = bundleOptions.includeCard
      ? await this.exportRequestCardsForCompany(companyId, request.id)
      : bundleOptions.includeWitness
        ? await this.exportRequestWitnessForCompany(companyId, request.id)
        : await this.exportRequestProtocolForCompany(companyId, request.id);

    return {
      ...exportResult,
      requestId: request.id,
    };
  }
}

import {
  TEMPLATE_LABELS,
  type Draft as DraftInput,
  type Assignment,
  type RequestItemInput,
  type Role,
  type OrganizationForm,
  type IssuerProfile,
} from "@demo/contracts";
import { biotAssignmentDefaults } from "./assignment-presets";
export type { Assignment, Role };
export type Recipient = RequestItemInput;
export type Draft = DraftInput & {
  id: string;
  revision: number;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  customerName?: string;
  approval?: {
    proposalId: string;
    status: "PENDING" | "APPROVED" | "REJECTED" | "SUPERSEDED";
    baseRevision: number;
    proposalHash: string;
    submittedBy: string;
    submittedAt: string;
  };
  approvedDraft?: Draft;
  approvedRevision?: number;
  archived?: boolean;
  archivedAt?: string | null;
  lifecycle?:
    | "RENDERING"
    | "AWAITING_SIGNATURE"
    | "ISSUED"
    | "FAILED"
    | "LEGACY_ISSUED"
    | null;
  issuances?: Issuance[];
};
export type Customer = {
  id: string;
  nameRu: string;
  nameKz: string;
  legalForm?: OrganizationForm | null;
  ownNameRu?: string | null;
  ownNameKz?: string | null;
  bin: string;
  addressRu: string;
  addressKz: string;
  archived: boolean;
};
export type Template = {
  id: string;
  templateId?: string;
  name?: string;
  title?: string;
  direction?: string;
  version?: number | string;
  photo?: boolean;
  exports?: string[];
  supportedExports?: string[];
  description?: string;
  contract?: Record<string, unknown>;
};
export type Profile = IssuerProfile & {
  version?: number;
  id?: string;
};
export type AppContext = {
  user: { id: string; displayName: string; email: string; role: Role };
  tenant: { id: string; name: string; timezone: string; demoOnly?: boolean };
  csrfToken?: string;
  profile: Profile | null;
  profileVersionId?: string | null;
  templates: Template[];
  numbering: unknown;
};
export type Artifact = {
  id: string;
  availability?: "AVAILABLE" | "MISSING";
  documentId?: string;
  issuanceId?: string;
  name?: string;
  filename?: string;
  fileName?: string;
  format?: string;
  mimeType?: string;
  size?: number;
  sha256?: string;
  createdAt?: string;
  provenance?: string;
};
export type Job = {
  id: string;
  status: string;
  kind?: string;
  attempts?: number;
  error?: string;
  errorCode?: string;
  artifactId?: string;
  artifact?: Artifact;
  artifacts?: Artifact[];
  requestId?: string;
  documentId?: string;
  sourceRevision?: number;
  issuanceId?: string;
  createdAt?: string;
  updatedAt?: string;
};
export type Issuance = {
  id: string;
  status?: string;
  sourceRevision: number;
  createdAt: string;
  reason?: string;
  correctionReason?: string;
  correctionOfId?: string;
  correctsIssuanceId?: string;
  correctsRequestId?: string | null;
  events?: {
    kind: string;
    reason: string;
    createdAt: string;
    relatedRequestId?: string | null;
  }[];
  documents?: {
    id: string;
    number: string;
    registrationNumber?: string;
    templateId: string;
    rowId?: string | null;
    groupEventId?: string | null;
    artifacts?: Artifact[];
  }[];
  jobs?: Job[];
  artifacts?: Artifact[];
};
export type Validation = {
  valid: boolean;
  errors: (
    | { path?: string | string[]; message: string; itemId?: string }
    | string
  )[];
  warnings?: (
    | {
        message: string;
        candidates?: { historyPath: string; number?: string }[];
      }
    | string
  )[];
  documents?: unknown[];
  documentCount?: number;
};
export type Page<T> = {
  items: T[];
  total: number;
  page?: number;
  pageSize?: number;
};
export const templateLabels: Record<string, string> = TEMPLATE_LABELS;
export function documentTitle(templateId: string, group?: boolean): string {
  const title = templateLabels[templateId] || templateId;
  if (!templateId.endsWith("-protocol")) return title;
  const scope = group === undefined ? "" : group ? "общий " : "индивидуальный ";
  return title.replace(
    /(?:индивидуальный |общий )?протокол/,
    `${scope}протокол`,
  );
}
export function newAssignment(
  templateId: Assignment["templateId"] = "biot-worker-card",
): Assignment {
  return {
    id: crypto.randomUUID(),
    templateId,
    documentDate: "",
    trainingStart: "",
    trainingEnd: "",
    protocolDate: "",
    trainingSubject: "",
    result: "",
    hours: "",
    reason: "",
    education: "",
    validUntil: "",
    externalBasisNumber: "",
    protocolMode: "INDIVIDUAL",
    ...biotAssignmentDefaults(templateId),
  };
}
export function newRecipient(): Recipient {
  return {
    id: crypto.randomUUID(),
    employeeCategory: "WORKER",
    fullNameRu: "",
    fullNameKz: "",
    positionRu: "",
    positionKz: "",
    workplaceRu: "",
    workplaceKz: "",
    photoAssetId: null,
    assignments: [newAssignment()],
  };
}
export function draftPayload(draft: Draft) {
  const {
    kind,
    title,
    customerId,
    organizationSnapshots,
    demoMode,
    businessRuleVersion,
    englishAppendix,
    items,
    schemaVersion,
    profileVersionId,
    presetFields,
    commonFields,
    events,
  } = draft;
  return {
    kind,
    title: personRequestName(draft) || title,
    customerId,
    organizationSnapshots,
    demoMode,
    businessRuleVersion,
    englishAppendix,
    items,
    schemaVersion,
    profileVersionId,
    presetFields,
    commonFields,
    events,
  };
}

export function personRequestName(draft: Pick<Draft, "kind" | "items">) {
  if (draft.kind !== "PERSON") return "";
  return (draft.items[0]?.fullNameRu || draft.items[0]?.fullNameKz || "")
    .trim()
    .slice(0, 255);
}

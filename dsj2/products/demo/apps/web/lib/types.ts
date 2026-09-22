import {
  TEMPLATE_LABELS,
  type Draft as DraftInput,
  type Assignment,
  type RequestItemInput,
  type Role,
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
  issuances?: Issuance[];
};
export type Customer = {
  id: string;
  nameRu: string;
  nameKz: string;
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
export type Profile = {
  bin?: string;
  headName?: string;
  nameRu: string;
  nameKz: string;
  addressRu: string;
  addressKz: string;
  cityRu: string;
  cityKz: string;
  approvalBasis: string;
  commission: { name: string; position: string }[];
  version?: number;
  approved: boolean;
};
export type AppContext = {
  user: { id: string; displayName: string; email: string; role: Role };
  tenant: { id: string; name: string; timezone: string; demoOnly?: boolean };
  csrfToken?: string;
  profile: Profile;
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
  documents?: {
    id: string;
    number: string;
    registrationNumber?: string;
    templateId: string;
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
  warnings?: ({ message: string } | string)[];
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
  const { kind, title, customerId, demoMode, items } = draft;
  return { kind, title, customerId, demoMode, items };
}

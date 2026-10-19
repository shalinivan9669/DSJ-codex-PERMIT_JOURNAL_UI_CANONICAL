import { api, json } from "./api";
import type { Enrollment, Paged } from "./lms-api";
export type ResultFilters = {
  enrollmentId?: string;
  search: string;
  customerId: string;
  courseVersionId: string;
  groupId: string;
  status: string;
  view: string;
  expiringDays: number;
  dueFrom: string;
  dueTo: string;
  sourceOrderId?: string;
  sourceRequestId?: string;
};
export const initialResultFilters: ResultFilters = {
  search: "",
  customerId: "",
  courseVersionId: "",
  groupId: "",
  status: "",
  view: "ALL",
  expiringDays: 14,
  dueFrom: "",
  dueTo: "",
};
export type ResultEnrollment = Omit<Enrollment, "documents"> & {
  customer?: { id: string; nameRu: string; nameKz: string } | null;
  groupId?: string | null;
  groupKey?: string;
  group?: { id: string; name: string } | null;
  sourceOrderId?: string | null;
  sourceRequestId?: string | null;
  documents?: Array<
    NonNullable<Enrollment["documents"]>[number] & {
      resultId: string;
      artifacts: { id: string; kind: string; fileName: string }[];
    }
  >;
};
export type FilterOption = { id: string; labelRu: string; labelKz: string };
export type BundleState = {
  id: string;
  status: string;
  partCount: number;
  parts: { index: number; fileName: string; size: number }[];
  directFiles: { id: string; fileName: string; size: number }[];
  error?: { code: string; correlationId?: string } | null;
};
export function resultQuery(filters: ResultFilters) {
  return Object.fromEntries(
    Object.entries(filters).filter(
      ([, value]) => value !== "" && value != null,
    ),
  );
}
export const resultsApi = {
  list: (page: number, filters: ResultFilters) =>
    api<Paged<ResultEnrollment>>(
      `/lms/enrollments?${new URLSearchParams(Object.entries({ ...resultQuery(filters), page, pageSize: 30 }).map(([k, v]) => [k, String(v)]))}`,
    ),
  filters: () =>
    api<{
      customers: FilterOption[];
      courses: FilterOption[];
      groups: FilterOption[];
    }>("/lms/results/filters"),
  bundle: (documentIds: string[], format: string, groupId?: string) =>
    api<BundleState>("/lms/documents/bundle", {
      method: "POST",
      body: json(groupId ? { groupId, format } : { documentIds, format }),
    }),
  bundleStatus: (id: string) =>
    api<BundleState>(`/lms/documents/bundles/${id}`),
};

import { api, json, ApiError, exportFileName } from "./api";
export type ReportKind =
  | "TRAINING"
  | "EMPLOYEES"
  | "TESTING"
  | "DOCUMENTS"
  | "ORGANIZATIONS"
  | "DEADLINES"
  | "CREDENTIALS"
  | "CERTIFICATES"
  | "EMPLOYEE_DIRECTORY"
  | "ORGANIZATION_DIRECTORY"
  | "DOCUMENT_REGISTRY";
export type ReportFilters = {
  groupId?: string;
  sourceOrderId?: string;
  sourceRequestId?: string;
  enrollmentId?: string;
  view?: string;
  expiringDays?: string;
  dueFrom?: string;
  dueTo?: string;
  dateFrom: string;
  dateTo: string;
  courseVersionId: string;
  customerId: string;
  bin: string;
  city: string;
  teacherUserId: string;
  status: string;
  search: string;
};
export const initialReportFilters: ReportFilters = {
  dateFrom: "",
  dateTo: "",
  courseVersionId: "",
  customerId: "",
  bin: "",
  city: "",
  teacherUserId: "",
  status: "",
  search: "",
};
export type ReportData = {
  filters?: Record<string, string | number | null>;
  id?: string;
  kind: ReportKind;
  metric?: string;
  format?: string;
  status?: string;
  progress?: number;
  errorCode?: string | null;
  total: number;
  totalRows?: number;
  page: number;
  pageSize: number;
  snapshotAt: string;
  expiresAt?: string;
  timezone: string;
  definition: string;
  fileName?: string;
  columns: Array<{ field: string; title: string }>;
  items: Array<{
    ordinal?: number;
    sourceId?: string;
    enrollmentId: string | null;
    payload: Record<string, string | number | null>;
  }>;
  summary: Record<string, number>;
};
export function reportFilterValues(filters: ReportFilters) {
  return Object.fromEntries(
    Object.entries(filters).filter(([, v]) => v !== ""),
  );
}
export type ReportOption = { id: string; labelRu: string; labelKz: string };
export const reportsApi = {
  query: (
    kind: ReportKind,
    filters: ReportFilters,
    language: "ru" | "kz",
    page = 1,
    metric?: string,
  ) =>
    api<ReportData>("/lms/reports/query", {
      method: "POST",
      body: json({
        kind,
        filters: reportFilterValues(filters),
        language,
        page,
        metric,
        pageSize: 30,
      }),
    }),
  options: () =>
    api<{
      customers: ReportOption[];
      courses: ReportOption[];
      teachers: ReportOption[];
      cities: string[];
    }>("/lms/reports/filters"),
  create: (
    kind: ReportKind,
    filters: ReportFilters,
    language: "ru" | "kz",
    format: string,
    requestKey: string,
    metric?: string,
  ) =>
    api<ReportData>("/lms/reports", {
      method: "POST",
      body: json({
        kind,
        filters: reportFilterValues(filters),
        language,
        format,
        requestKey,
        metric,
      }),
    }),
  status: (id: string, page = 1) =>
    api<ReportData>(`/lms/reports/${id}?page=${page}&pageSize=30`),
  action: (id: string, action: "retry" | "cancel") =>
    api<ReportData>(`/lms/reports/${id}/${action}`, {
      method: "POST",
      body: json({}),
    }),
  list: () =>
    api<{
      items: Array<{
        id: string;
        kind: ReportKind;
        format: string;
        status: string;
        totalRows: number;
        snapshotAt: string;
      }>;
    }>("/lms/reports"),
};
export async function downloadReport(id: string, fallback: string) {
  let response: Response;
  try {
    response = await fetch(`/api/lms/reports/${id}/file`, {
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "Не удалось скачать отчёт");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(
      response.status,
      body.message || "Не удалось скачать отчёт",
      body,
    );
  }
  const href = URL.createObjectURL(await response.blob()),
    link = document.createElement("a");
  link.href = href;
  link.download = exportFileName(
    response.headers.get("content-disposition"),
    fallback,
  );
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

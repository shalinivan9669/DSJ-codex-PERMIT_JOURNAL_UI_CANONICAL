import { api, json } from "./api";
export type PublicProgramme = {
  id: string;
  courseVersionId: string;
  titleRu: string;
  titleKz: string;
  summaryRu: string;
  summaryKz: string;
  hours: number;
  durationDays?: number;
  available: boolean;
};
export type Application = {
  id: string;
  kind: "B2C" | "B2B";
  courseVersionId: string;
  titleRu: string;
  titleKz: string;
  contact: {
    organization: string;
    bin: string;
    contactName: string;
    email: string;
    phone: string;
    position: string;
  };
  quantity: number;
  comment: string;
  state: string;
  reason: string | null;
  revision: number;
  assignedTo: string | null;
  ownerName: string | null;
  orderId: string | null;
  enrollmentId: string | null;
  recipientId: string | null;
  customerId: string | null;
  createdAt: string;
};
export type ApplicationDefaults = {
  contactName: string;
  email: string;
  organizations: { id: string; nameRu: string; nameKz: string; bin: string }[];
};
export type ApplicationOrder = {
  order: { id: string; revision: number; status: string } | null;
  expected?: number;
  assigned?: number;
  completed?: number;
  documentsReady?: number;
  payment?: { state: string; totalMinor: string | null; paidMinor: string };
  stages?: {
    stage: string;
    record: {
      status: string;
      evidence: string;
      reason: string;
      completedAt: string;
      completedBy: string;
    } | null;
  }[];
  financialDocuments?: {
    id: string;
    type: string;
    number: string;
    documentDate: string;
    source: string;
  }[];
};
export const applications = {
  catalogue: (
    page = 1,
    search = "",
    authenticated = false,
    versionId?: string,
  ) =>
    api<{
      centerName: string;
      items: PublicProgramme[];
      total: number;
      page: number;
      pageSize: number;
    }>(
      `/${authenticated ? "lms" : "learn"}/catalogue?page=${page}&search=${encodeURIComponent(search)}${versionId ? `&versionId=${encodeURIComponent(versionId)}` : ""}`,
    ),
  defaults: () => api<ApplicationDefaults>("/lms/applications/defaults"),
  submit: (input: unknown, anonymous = false) =>
    api<{ id: string; saved: boolean; state: string; centerName: string }>(
      anonymous ? "/learn/catalogue/applications" : "/lms/applications",
      { method: "POST", body: json(input) },
    ),
  list: (page = 1, search = "", state = "", id = "") =>
    api<{ items: Application[]; total: number; pageSize: number }>(
      `/lms/applications?page=${page}&search=${encodeURIComponent(search)}${state ? `&state=${state}` : ""}${id ? `&id=${encodeURIComponent(id)}` : ""}`,
    ),
  action: (id: string, input: unknown) =>
    api<{ id: string; state: string }>(`/lms/applications/${id}/action`, {
      method: "POST",
      body: json(input),
    }),
  order: (id: string) => api<ApplicationOrder>(`/lms/applications/${id}/order`),
  stage: (id: string, input: unknown) =>
    api(`/lms/applications/${id}/stages`, {
      method: "POST",
      body: json(input),
    }),
};
export const applicationStateText: Record<string, [string, string]> = {
  NEW: ["Новая", "Жаңа"],
  PROCESSING: ["В обработке", "Өңделуде"],
  RETURNED: ["Нужно уточнение", "Нақтылау қажет"],
  REJECTED: ["Отклонена", "Қабылданбады"],
  ACCEPTED: ["Принята", "Қабылданды"],
  CANCELLED: ["Отменена", "Жойылды"],
  CONTACT: ["Контакт установлен", "Байланыс орнатылды"],
  OFFER: ["КП отправлено", "Коммерциялық ұсыныс жіберілді"],
  CONTRACT: ["Договор", "Шарт"],
  INVOICE: ["Счёт", "Шот"],
  SETTLEMENT: ["Расчёты", "Есеп айырысу"],
  PAID: ["Оплачено", "Төленді"],
  PARTIAL: ["Частично оплачено", "Ішінара төленді"],
  UNPAID: ["Не оплачено", "Төленбеді"],
  UNKNOWN: ["Сумма требует уточнения", "Соманы нақтылау қажет"],
  DONE: ["Подтверждено", "Расталды"],
  WAIVED: ["Не применяется", "Қолданылмайды"],
  CLOSED: ["Закрыта", "Жабылды"],
  OPEN: ["Открыта", "Ашық"],
};

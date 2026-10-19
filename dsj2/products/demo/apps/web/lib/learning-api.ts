import { api, json } from "./api";
import type { Attempt } from "./lms-api";

export type SubmissionAttachment = {
  id: string;
  name: string;
  downloadUrl: string;
};
export type LearnerSubmission = {
  id: string | null;
  enrollmentId: string;
  lessonId: string;
  revision: number;
  sequence: number;
  status: "DRAFT" | "SUBMITTED" | "RETURNED" | "ACCEPTED" | "REJECTED";
  text: string;
  attachments: SubmissionAttachment[];
  feedback?: string;
  history: {
    revision: number;
    text: string;
    attachments: SubmissionAttachment[];
    submittedAt?: string;
    decision?: string;
    feedback?: string;
    reviewerName?: string;
    reviewedAt?: string;
  }[];
  canRevise: boolean;
  canEdit: boolean;
  canSubmit: boolean;
  instructionsRu: string;
  instructionsKz: string;
  criteriaRu: string;
  criteriaKz: string;
};
export type AssessmentItem = {
  lessonId: string;
  attempts: Attempt[];
  canStart: boolean;
  reasonCode?: string;
  maxAttempts: number;
};
const assignmentPath = (id: string, lessonId: string) =>
  `/lms/enrollments/${encodeURIComponent(id)}/assignments/${encodeURIComponent(lessonId)}`;
export const learningApi = {
  assessments: (id: string) =>
    api<{ items: AssessmentItem[] }>(
      `/lms/enrollments/${encodeURIComponent(id)}/assessments`,
    ),
  startAssessment: (id: string, lessonId: string) =>
    api<Attempt>(
      `/lms/enrollments/${encodeURIComponent(id)}/assessments/${encodeURIComponent(lessonId)}/attempts`,
      { method: "POST", body: json({}) },
    ),
  submission: (id: string, lessonId: string) =>
    api<LearnerSubmission>(`${assignmentPath(id, lessonId)}/submission`),
  saveSubmission: (
    id: string,
    lessonId: string,
    body: { sequence: number; text: string; attachmentIds: string[] },
  ) =>
    api<LearnerSubmission>(`${assignmentPath(id, lessonId)}/submission`, {
      method: "PUT",
      body: json(body),
    }),
  submit: (id: string, lessonId: string, sequence: number) =>
    api<LearnerSubmission>(
      `${assignmentPath(id, lessonId)}/submission/submit`,
      { method: "POST", body: json({ sequence }) },
    ),
  upload: (id: string, lessonId: string, file: File) => {
    const body = new FormData();
    body.append("file", file);
    return api<SubmissionAttachment>(
      `${assignmentPath(id, lessonId)}/attachments`,
      { method: "POST", body },
    );
  },
};

export type TeachingEvent = {
  location?: string | null;
  practiceCriteria?: Array<{ id: string; titleRu: string; titleKz: string }> | null;
  ownPractice?: { decision: string; feedback: string; createdAt: string } | null;
  ownAttendance?: { status: string; recordedAt: string } | null;
  id: string;
  groupId: string;
  courseVersionId: string;
  requirementId: string | null;
  titleRu: string;
  titleKz: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  teacherUserId: string;
  teacherName?: string;
  joinUrl: string | null;
  recordingUrl: string | null;
  recordingMaterialId: string | null;
  status: "SCHEDULED" | "CANCELLED";
  revision: number;
};
export type TeachingList = {
  items: TeachingEvent[];
  total: number;
  page: number;
  pageSize: number;
  canSchedule: boolean;
  requirements?: { id: string; titleRu: string; titleKz: string }[];
  teachers?: { id: string; name: string }[];
};
export type AttendanceRow = {
  enrollmentId: string;
  nameRu: string;
  nameKz: string;
  status: "PRESENT" | "ABSENT" | null;
  revision: number;
  recordedAt?: string;
  history: {
    revision: number;
    status: string;
    reason: string;
    recordedAt: string;
    actorName?: string;
  }[];
};
export type TeachingDetail = {
  event: TeachingEvent;
  canSchedule: boolean;
  canAttend: boolean;
  history: {
    id: string;
    kind: string;
    reason: string;
    createdAt: string;
    revision: number;
  }[];
};
export type CalendarItem = {
  id: string;
  kind: string;
  titleRu: string;
  titleKz: string;
  startsAt: string;
  endsAt?: string | null;
  timezone?: string;
  groupId?: string;
  enrollmentId?: string;
  href: string;
  status?: string;
};
export type CalendarPage = {
  items: CalendarItem[];
  total: number;
  page: number;
  pageSize: number;
};
export type LearningNotification = {
  id: string;
  eventId: string;
  kind: string;
  readAt: string | null;
  createdAt: string;
  titleRu: string;
  titleKz: string;
  startsAt: string;
  status: string;
};
export const teachingApi = {
  list: (groupId: string, page = 1) =>
    api<TeachingList>(
      `/lms/teaching-events?groupId=${encodeURIComponent(groupId)}&page=${page}`,
    ),
  detail: (id: string) => api<TeachingDetail>(`/lms/teaching-events/${id}`),
  create: (body: unknown) =>
    api<TeachingEvent>("/lms/teaching-events", {
      method: "POST",
      body: json(body),
    }),
  update: (id: string, body: unknown) =>
    api<TeachingEvent>(`/lms/teaching-events/${id}`, {
      method: "PUT",
      body: json(body),
    }),
  cancel: (id: string, body: unknown) =>
    api<TeachingEvent>(`/lms/teaching-events/${id}/cancel`, {
      method: "POST",
      body: json(body),
    }),
  attendance: (id: string, page = 1) =>
    api<{
      items: AttendanceRow[];
      total: number;
      page: number;
      pageSize: number;
      canAttend: boolean;
      eventRevision: number;
    }>(`/lms/teaching-events/${id}/attendance?page=${page}`),
  saveAttendance: (id: string, body: unknown) =>
    api<{ saved: number }>(`/lms/teaching-events/${id}/attendance`, {
      method: "POST",
      body: json(body),
    }),
  calendar: (from: string, to: string, page = 1) =>
    api<CalendarPage>(
      `/lms/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&page=${page}`,
    ),
  notifications: (page = 1) =>
    api<{
      items: LearningNotification[];
      total: number;
      page: number;
      pageSize: number;
    }>(`/lms/notifications?page=${page}`),
  readNotification: (id: string) =>
    api(`/lms/notifications/${id}/read`, { method: "POST", body: json({}) }),
};

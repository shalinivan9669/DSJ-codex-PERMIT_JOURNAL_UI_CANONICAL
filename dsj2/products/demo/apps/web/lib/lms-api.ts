import type {
  CourseContent,
  LmsLesson,
  RegulatoryProfile,
  LmsQuestion,
  LearningAnswers,
  QuestionAnswerSpec,
  AccessPolicy,
} from "@demo/contracts/src/lms";
import { api, json } from "./api";

export type CourseVersion = {
  publicationIssues?: {
    code: string;
    messageRu: string;
    messageKz: string;
    target: "overview" | "settings" | "modules" | "exam" | "review";
    moduleId?: string;
    lessonId?: string;
    questionId?: string;
  }[];
  allowedActions?: string[];
  review?: {
    state: string;
    revision: number;
    contentHash: string;
    feedback: string;
  } | null;
  id: string;
  courseId: string;
  version: number;
  revision: number;
  status: string;
  content: CourseContent;
  profile: RegulatoryProfile;
  publishedAt?: string | null;
};
export type Course = {
  publishedVersion?: Course["latestVersion"] | null;
  allowedActions?: string[];
  archived?: boolean;
  id: string;
  titleRu?: string;
  titleKz?: string;
  latestVersion?: Pick<CourseVersion, "id" | "version" | "status"> & {
    content: Pick<
      CourseContent,
      "titleRu" | "titleKz" | "category" | "hours" | "accessDays" | "metadata"
    >;
    profile: Pick<RegulatoryProfile, "status" | "assessmentKind" | "legalForm">;
  };
  versions?: CourseVersion[];
  assignmentPaused?: boolean;
  assignmentPauseReason?: string;
  currentReview?: { status: string; note: string; updatedAt: string } | null;
};
export type CourseDetails = { course: Course; versions: CourseVersion[]; demoOnly?: boolean };
export type Paged<T> = {
  items: T[];
  total: number;
  page?: number;
  pageSize?: number;
};
export type LearnerSummary = {
  id: string;
  data: {
    fullNameRu: string;
    fullNameKz?: string;
    positionRu?: string;
    positionKz?: string;
    workplaceRu?: string;
    workplaceKz?: string;
  };
  customerIds?: string[];
  employerId?: string | null;
  userId?: string | null;
};
export type LessonProgress = {
  activeSeconds?: number;
  acknowledgedAt?: string | null;
  lessonId: string;
  positionSeconds: number;
  completed?: boolean;
  completedAt?: string | null;
  updatedAt?: string;
  watchedSeconds?: number;
  revision?: number;
  sequence?: number;
};
export type Enrollment = {
  accessPolicy?: AccessPolicy | null;
  startsAt?: string | null;
  id: string;
  courseVersionId: string;
  learnerId?: string;
  learnerUserId?: string | null;
  recipientId: string;
  status: string;
  progressPercent?: number;
  lastLessonId?: string | null;
  recipient?: LearnerSummary;
  courseVersion?: CourseVersion;
  progress?: LessonProgress[];
  expiresAt?: string | null;
  dueAt?: string | null;
  result?: ExamResult | null;
  documents?: {
    id: string;
    resultId: string;
    requestId: string;
    legalForm: string;
    status: string;
  }[];
  groupId?: string | null;
  groupKey?: string;
  sourceRequestId?: string | null;
  sourceOrderId?: string | null;
  dueAtOverride?: boolean;
};
type PublicSpec<S> = S extends { kind: "CASE"; response: infer R }
  ? Omit<S, "response"> & { response: PublicSpec<R> }
  : S extends object
    ? Omit<
        S,
        "correctOptionIds" | "correctOrderIds" | "pairs" | "acceptedAnswers"
      >
    : never;
export type PublicQuestion = Omit<
  CourseContent["exam"]["questions"][number],
  "correctOptionIds" | "answerSpec"
> & { answerSpec?: PublicSpec<QuestionAnswerSpec> };
export type Attempt = {
  review?: {
    thresholdPercent: number;
    comparison: "GT" | "GTE";
    remainingAttempts: number;
    revealAnswers: boolean;
    questionScores: Record<string, number | null>;
    feedback: string | null;
    reviewedAt: string | null;
  } | null;
  id: string;
  enrollmentId: string;
  sequence: number;
  state: string;
  ordinal: number;
  startedAt: string;
  deadlineAt: string;
  serverNow?: string;
  questions: PublicQuestion[];
  answers: LearningAnswers;
  purpose?: string;
  assessmentId?: string;
  result?: ExamResult | null;
};
export type Learning = Enrollment & {
  prerequisites?: Array<{
    courseId: string;
    satisfied: boolean;
    basis: string;
    titleRu?: string;
    titleKz?: string;
    enrollmentId?: string | null;
  }>;
  examReadiness: {
    remainingAttempts?: number;
    opensAt?: string | null;
    closesAt?: string | null;
    missingSubmissionStates?: Record<string, string>;
    ready: boolean;
    requiredCount: number;
    completedCount: number;
    missingLessonIds: string[];
    reasonCode: string | null;
  };
  content: Omit<CourseContent, "modules"> & {
    modules: Array<
      Omit<CourseContent["modules"][number], "lessons"> & {
        lessons: Array<
          LmsLesson & {
            locked?: boolean;
            completed?: boolean;
            lockReason?: string | null;
          }
        >;
      }
    >;
  };
  profile: Pick<RegulatoryProfile, "assessmentKind" | "status" | "requiresProctoring" | "proctoringMode">;
  attempts: Attempt[];
  results: ExamResult[];
  documents: {
    id: string;
    resultId: string;
    requestId?: string;
    legalForm: string;
    status: string;
    artifactId?: string;
    fileName?: string;
  }[];
};
export type LibraryRevision = {
  id: string;
  version: number;
  question: LmsQuestion;
};
export type LibraryQuestion = {
  id: string;
  category: string;
  topic: string;
  latestRevision: LibraryRevision;
};
export type ExamResult = {
  id: string;
  enrollmentId: string;
  verdict: string;
  state?: string;
  status?: string;
  assessmentKind: string;
  score?: number | null;
  maximum?: number | null;
  eligible?: boolean;
  documentEligible?: boolean;
  reviewReasons?: string[];
  eligibility?: string;
  reasons?: string[];
  confirmedAt?: string;
  recipient?: LearnerSummary;
  enrollment?: Enrollment;
  courseTitleRu?: string;
  courseTitleKz?: string;
  requestId?: string | null;
  legalForm?: string;
  documentRequestId?: string | null;
};
export type SanitaryEntry = {
  id: string;
  enrollmentId: string;
  recipient?: LearnerSummary;
  fullNameRu?: string;
  fullNameKz?: string;
  courseTitleRu?: string;
  courseTitleKz?: string;
  status: string;
  dueAt?: string | null;
  batchId?: string | null;
  revision: number;
  issue?: string | null;
  evidence?: {
    id: string;
    reference: string;
    createdAt: string;
    category: string;
  }[];
};
export const lms = {
  courses: (page = 1, search = "") =>
    api<Paged<Course>>(
      `/lms/courses?page=${page}&search=${encodeURIComponent(search)}`,
    ),
  course: (id: string) =>
    api<CourseDetails>(`/lms/courses/${encodeURIComponent(id)}`),
  createCourse: (content: CourseContent, profile: RegulatoryProfile) =>
    api<{ course: Course; version: CourseVersion }>("/lms/courses", {
      method: "POST",
      body: json({ content, profile }),
    }),
  saveVersion: (
    id: string,
    revision: number,
    content: CourseContent,
    profile: RegulatoryProfile,
  ) =>
    api<CourseVersion>(`/lms/course-versions/${id}`, {
      method: "PUT",
      body: json({ revision, content, profile }),
    }),
  publish: (id: string, revision: number) =>
    api<CourseVersion>(`/lms/course-versions/${id}/publish`, {
      method: "POST",
      body: json({ revision }),
    }),
  newVersion: (id: string) =>
    api<CourseVersion>(`/lms/courses/${id}/versions`, {
      method: "POST",
      body: "{}",
    }),
  uploadMaterial: (courseId: string, file: File) => {
    const body = new FormData();
    body.set("file", file);
    return api<{ id: string; fileName: string }>(
      `/lms/courses/${courseId}/materials`,
      { method: "POST", body },
    );
  },
  assignmentContext: (
    requestId = "",
    page = 1,
    search = "",
    orderId = "",
    groupId = "",
  ) =>
    api<{
      recipients: LearnerSummary[];
      courses: Course[];
      customerId?: string;
      total: number;
      page: number;
      pageSize: number;
      sourceRequestId?: string | null;
      sourceOrderId?: string | null;
      contextRecipientIds?: string[];
      group?: {
        id: string;
        name: string;
        courseVersionId: string;
        dueAt: string;
        customerId: string | null;
        sourceRequestId: string | null;
        sourceOrderId: string | null;
      };
    }>(
      `/lms/assignment-context?page=${page}&search=${encodeURIComponent(search)}${requestId ? `&requestId=${encodeURIComponent(requestId)}` : ""}${orderId ? `&orderId=${encodeURIComponent(orderId)}` : ""}${groupId ? `&groupId=${encodeURIComponent(groupId)}` : ""}`,
    ),
  assign: (
    courseVersionId: string,
    recipientIds: string[],
    customerId?: string,
    groupName?: string,
    context?: {
      operationId: string;
      sourceRequestId?: string | null;
      sourceOrderId?: string | null;
      groupId?: string;
      dueAt?: string;
    },
  ) =>
    api<{
      created: number;
      duplicates: number;
      errors: { recipientId: string; code: string; message: string }[];
      items: Enrollment[];
      errorCount: number;
      failedRecipientIds: string[];
      operationId: string;
      groupId: string | null;
      state: "PENDING" | "PAUSED" | "COMPLETED";
      cursor: number;
      total: number;
      conflicts: number;
      pauseError?: {
        code: string;
        params: Record<string, unknown>;
        message: string;
      } | null;
    }>("/lms/enrollments", {
      method: "POST",
      body: json({
        courseVersionId,
        recipientIds,
        customerId,
        groupName,
        ...context,
      }),
    }),
  enrollments: (learner = false, page = 1) =>
    api<Paged<Enrollment>>(
      `/${learner ? "learn" : "lms"}/enrollments?page=${page}&pageSize=${learner ? 50 : 250}`,
    ),
  learning: (id: string) => api<Learning>(`/learn/enrollments/${id}`),
  progress: (
    id: string,
    lessonId: string,
    payload: {
      sequence: number;
      positionSeconds?: number;
      playing?: boolean;
      playbackRate?: number;
      acknowledge?: boolean;
      interacting?: boolean;
    },
  ) =>
    api<LessonProgress>(
      `/learn/enrollments/${id}/lessons/${lessonId}/progress`,
      { method: "POST", body: json(payload) },
    ),
  startAttempt: (id: string) =>
    api<Attempt>(`/learn/enrollments/${id}/attempts`, {
      method: "POST",
      body: "{}",
    }),
  attempt: (id: string) => api<Attempt>(`/learn/attempts/${id}`),
  answers: (id: string, sequence: number, answers: LearningAnswers) =>
    api<Attempt>(`/learn/attempts/${id}/answers`, {
      method: "PUT",
      body: json({ sequence, answers }),
    }),
  submit: (id: string) =>
    api<Attempt>(`/learn/attempts/${id}/submit`, {
      method: "POST",
      body: "{}",
    }),
};

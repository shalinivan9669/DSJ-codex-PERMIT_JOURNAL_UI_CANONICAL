import Link from "next/link";
import { Card, CardContent, CardHeader, EmptyState, PageHeader } from "@dsj/ui";
import { formatDate, formatDateTime } from "@dsj/utils";
import {
  completeMyTrainingAction,
  startMyTrainingAction,
} from "@/actions/training";
import { ProgressMeter } from "@/components/progress-meter";
import { StatusBadge } from "@/components/status-badge";
import { SubmitButton } from "@/components/submit-button";
import { apiFetch } from "@/lib/api";
import { requireRoleAccess } from "@/lib/auth";
import { getStatusLabel } from "@/lib/labels";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function MyTrainingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  await requireRoleAccess(["EMPLOYEE_SIGNER"]);
  const { id } = await params;
  const rawSearchParams = await searchParams;
  const errorMessage = typeof rawSearchParams.error === "string" ? rawSearchParams.error : null;
  const assignment = await apiFetch<{
    id: string;
    dueAt: string | null;
    status: string;
    progressPercent: number;
    startedAt: string | null;
    completedAt: string | null;
    examPassedAt: string | null;
    canStart: boolean;
    canCompleteMaterial: boolean;
    canTakeExam: boolean;
    trainingProgram: {
      title: string;
      description: string;
      materialContent: string | null;
      materialFileName: string | null;
      materialFileUrl: string | null;
      videoUrl: string | null;
      issuerName: string | null;
      requiresExam: boolean;
      createsDocument: boolean;
      createsSafetyCertificate: boolean;
    };
    exam?: {
      status: string;
      examId: string;
      title: string;
      passingScore: number;
      maxAttempts: number;
      result: number | null;
    } | null;
    generatedDocuments: Array<{
      id: string;
      title: string;
      status: string;
    }>;
    generatedCertificates: Array<{
      id: string;
      certificateNumber: string;
      status: string;
    }>;
    assignedByUser?: {
      fullName: string;
    } | null;
  }>(`training-assignments/${id}`);

  const hasMaterialLinks = Boolean(
    assignment.trainingProgram.materialFileUrl || assignment.trainingProgram.videoUrl,
  );
  const expectsDocuments =
    assignment.trainingProgram.createsDocument || assignment.trainingProgram.createsSafetyCertificate;

  return (
    <div className="space-y-6">
      {errorMessage ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {errorMessage}
        </div>
      ) : null}

      <PageHeader>
        <div>
          <p className="text-sm uppercase tracking-[0.18em] text-slate-400">Обучение</p>
          <h1 className="mt-2 text-3xl font-semibold text-slate-950">{assignment.trainingProgram.title}</h1>
          <p className="mt-2 text-sm text-slate-500">{assignment.trainingProgram.description}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {assignment.canStart ? (
            <form action={startMyTrainingAction}>
              <input type="hidden" name="assignmentId" value={assignment.id} />
              <SubmitButton label="Начать обучение" pendingLabel="Открытие..." />
            </form>
          ) : null}
          {assignment.canCompleteMaterial ? (
            <form action={completeMyTrainingAction}>
              <input type="hidden" name="assignmentId" value={assignment.id} />
              <SubmitButton
                label={
                  assignment.trainingProgram.requiresExam
                    ? "Завершить материал и перейти к тесту"
                    : "Завершить обучение"
                }
                pendingLabel="Сохранение..."
              />
            </form>
          ) : null}
          {assignment.canTakeExam && assignment.exam ? (
            <Link
              href={`/my-testing/${assignment.id}`}
              className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700"
            >
              Перейти к тесту
            </Link>
          ) : null}
        </div>
      </PageHeader>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="rounded-[24px]">
          <CardHeader className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-950">Материалы обучения</h2>
            <StatusBadge value={assignment.status} />
          </CardHeader>
          <CardContent className="space-y-4">
            <ProgressMeter value={assignment.progressPercent} />

            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Описание и материал</p>
              <p className="mt-2 whitespace-pre-line text-sm text-slate-700">
                {assignment.trainingProgram.materialContent?.trim() ||
                  (hasMaterialLinks
                    ? "Текстовый материал не приложен. Откройте материал по ссылке ниже."
                    : "Материалы пока не добавлены. Обратитесь к ответственному за обучение.")}
              </p>
              {assignment.trainingProgram.materialFileUrl ? (
                <a
                  href={assignment.trainingProgram.materialFileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex text-sm font-medium text-slate-700 underline underline-offset-4"
                >
                  {assignment.trainingProgram.materialFileName ?? "Открыть вложение"}
                </a>
              ) : null}
              {assignment.trainingProgram.videoUrl ? (
                <a
                  href={assignment.trainingProgram.videoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex text-sm font-medium text-slate-700 underline underline-offset-4"
                >
                  Открыть видеоматериал
                </a>
              ) : null}
            </div>

            {assignment.trainingProgram.requiresExam ? (
              <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800">
                После изучения материала потребуется пройти тестирование. Проходной балл и количество попыток будут
                показаны на следующем шаге.
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="rounded-[24px]">
            <CardHeader>
              <h2 className="text-lg font-semibold text-slate-950">Сводка</h2>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-600">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p>Статус: <span className="font-medium text-slate-900">{getStatusLabel(assignment.status)}</span></p>
                <p className="mt-2">Срок прохождения: {assignment.dueAt ? formatDate(assignment.dueAt) : "Не задан"}</p>
                <p className="mt-2">Назначил: {assignment.assignedByUser?.fullName ?? "Система"}</p>
                <p className="mt-2">Начато: {assignment.startedAt ? formatDateTime(assignment.startedAt) : "Ещё нет"}</p>
                <p className="mt-2">
                  Завершено: {assignment.completedAt ? formatDateTime(assignment.completedAt) : "Ещё нет"}
                </p>
              </div>
              {assignment.exam ? (
                <div className="rounded-2xl bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-slate-900">Связанный тест</p>
                    <StatusBadge value={assignment.exam.status} />
                  </div>
                  <p className="mt-2">{assignment.exam.title}</p>
                  <p className="mt-2">Проходной балл: {assignment.exam.passingScore}%</p>
                  <p className="mt-2">Попыток: {assignment.exam.maxAttempts}</p>
                  {assignment.canTakeExam ? (
                    <Link
                      href={`/my-testing/${assignment.id}`}
                      className="mt-3 inline-flex text-sm font-medium text-slate-700 underline underline-offset-4"
                    >
                      Открыть тестирование
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="rounded-[24px]">
            <CardHeader>
              <h2 className="text-lg font-semibold text-slate-950">Результаты и документы</h2>
            </CardHeader>
            <CardContent className="space-y-3">
              {assignment.generatedDocuments.length || assignment.generatedCertificates.length ? (
                <>
                  {assignment.generatedDocuments.map((document) => (
                    <div key={document.id} className="rounded-2xl border border-slate-200 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-900">{document.title}</p>
                        <StatusBadge value={document.status} />
                      </div>
                      <Link
                        href={`/my-documents/${document.id}`}
                        className="mt-3 inline-flex text-sm font-medium text-slate-700 underline underline-offset-4"
                      >
                        Открыть документ
                      </Link>
                    </div>
                  ))}
                  {assignment.generatedCertificates.map((certificate) => (
                    <div key={certificate.id} className="rounded-2xl border border-slate-200 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-900">{certificate.certificateNumber}</p>
                        <StatusBadge value={certificate.status} />
                      </div>
                      <Link
                        href={`/my-certificates/${certificate.id}`}
                        className="mt-3 inline-flex text-sm font-medium text-slate-700 underline underline-offset-4"
                      >
                        Открыть удостоверение
                      </Link>
                    </div>
                  ))}
                </>
              ) : (
                <EmptyState>
                  {!expectsDocuments
                    ? "Для этой программы создание документов не предусмотрено."
                    : assignment.status === "COMPLETED"
                      ? "Документы пока не появились. Обратитесь к ответственному за обучение."
                      : "Документы могут появиться после завершения обучения."}
                </EmptyState>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

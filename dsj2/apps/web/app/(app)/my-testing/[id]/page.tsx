import Link from "next/link";
import { Card, CardContent, CardHeader, PageHeader } from "@dsj/ui";
import { formatDate } from "@dsj/utils";
import {
  startMyExamAction,
  submitMyExamAction,
} from "@/actions/testing";
import { StatusBadge } from "@/components/status-badge";
import { SubmitButton } from "@/components/submit-button";
import { apiFetch } from "@/lib/api";
import { requireRoleAccess } from "@/lib/auth";
import { getStatusLabel } from "@/lib/labels";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function MyTestingDetailPage({
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
  const exam = await apiFetch<{
    assignmentId: string;
    trainingTitle: string;
    description: string | null;
    passingScore: number;
    maxAttempts: number;
    questionCount: number;
    dueAt: string | null;
    trainingStatus: string;
    status: string;
    result: number | null;
    passed: boolean | null;
    passedAt: string | null;
    attemptsUsed: number;
    attemptsRemaining: number;
    currentAttempt: {
      id: string;
      startedAt: string;
    } | null;
    questions: Array<{
      id: string;
      prompt: string;
      options: Array<{
        id: string;
        text: string;
      }>;
    }>;
  }>(`exams/my/${id}`);

  const canStart = exam.status === "AVAILABLE" && exam.attemptsRemaining > 0;
  const canSubmit = exam.status === "IN_PROGRESS" && exam.currentAttempt;

  return (
    <div className="space-y-6">
      {errorMessage ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {errorMessage}
        </div>
      ) : null}

      <PageHeader>
        <div>
          <p className="text-sm uppercase tracking-[0.18em] text-slate-400">Тестирование</p>
          <h1 className="mt-2 text-3xl font-semibold text-slate-950">{exam.trainingTitle}</h1>
          <p className="mt-2 text-sm text-slate-500">
            Проходной балл: {exam.passingScore}% • Попыток: {exam.maxAttempts}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {canStart ? (
            <form action={startMyExamAction}>
              <input type="hidden" name="assignmentId" value={exam.assignmentId} />
              <SubmitButton
                label={exam.attemptsUsed ? "Начать повторную попытку" : "Начать тест"}
                pendingLabel="Запуск..."
              />
            </form>
          ) : null}
          <Link
            href={`/my-training/${exam.assignmentId}`}
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700"
          >
            Открыть обучение
          </Link>
        </div>
      </PageHeader>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="rounded-[24px]">
          <CardHeader className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-950">Вопросы теста</h2>
            <StatusBadge value={exam.status} />
          </CardHeader>
          <CardContent className="space-y-4">
            {exam.status === "NOT_STARTED" ? (
              <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800">
                Сначала завершите изучение материала обучения, затем тест станет доступным.
              </div>
            ) : canSubmit ? (
              <form action={submitMyExamAction} className="space-y-4">
                <input type="hidden" name="assignmentId" value={exam.assignmentId} />
                {exam.questions.map((question, index) => (
                  <div key={question.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-sm font-semibold text-slate-900">
                      {index + 1}. {question.prompt}
                    </p>
                    <div className="mt-4 space-y-2">
                      {question.options.map((option) => (
                        <label
                          key={option.id}
                          className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700"
                        >
                          <input
                            type="radio"
                            name={`answer_${question.id}`}
                            value={option.id}
                            className="mt-1 h-4 w-4 border-slate-300 text-slate-950"
                            required
                          />
                          <span>{option.text}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                <SubmitButton label="Завершить тест" pendingLabel="Проверка..." />
              </form>
            ) : exam.status === "PASSED" ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                Тест успешно сдан. Результат: {exam.result ?? "—"}%. Обучение завершено.
              </div>
            ) : exam.status === "FAILED" ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                Тест не сдан. Последний результат: {exam.result ?? "—"}%. Попытки исчерпаны.
                Обратитесь к ответственному за обучение.
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                После старта откроются вопросы теста и форма отправки ответов.
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="rounded-[24px]">
            <CardHeader>
              <h2 className="text-lg font-semibold text-slate-950">Сводка</h2>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-600">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p>Статус теста: <span className="font-medium text-slate-900">{getStatusLabel(exam.status)}</span></p>
                <p className="mt-2">Срок прохождения: {exam.dueAt ? formatDate(exam.dueAt) : "Не задан"}</p>
                <p className="mt-2">Связанный статус обучения: {getStatusLabel(exam.trainingStatus)}</p>
                <p className="mt-2">Количество вопросов: {exam.questionCount}</p>
                <p className="mt-2">Использовано попыток: {exam.attemptsUsed}</p>
                <p className="mt-2">Осталось попыток: {exam.attemptsRemaining}</p>
              </div>
              {exam.currentAttempt ? (
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="font-semibold text-slate-900">Текущая попытка</p>
                  <p className="mt-2">Начата: {formatDate(exam.currentAttempt.startedAt)}</p>
                </div>
              ) : null}
              {exam.passedAt ? (
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="font-semibold text-slate-900">Результат</p>
                  <p className="mt-2">Дата прохождения: {formatDate(exam.passedAt)}</p>
                  <p className="mt-2">Баллы: {exam.result ?? "—"}%</p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

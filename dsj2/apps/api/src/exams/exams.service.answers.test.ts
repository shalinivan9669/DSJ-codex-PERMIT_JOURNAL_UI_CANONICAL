import assert from "node:assert/strict";
import { test } from "node:test";
import { BadRequestException } from "@nestjs/common";
import type { AuthenticatedUser } from "../common/types/authenticated-user.type";
import { ExamsService } from "./exams.service";

const user: AuthenticatedUser = {
  userId: "user-1",
  companyId: "company-1",
  email: "employee@example.test",
  fullName: "Test Employee",
  role: "EMPLOYEE_SIGNER",
};

const questions = [
  { id: "q1", prompt: "Question 1", options: [
    { id: "q1-yes", text: "Yes", isCorrect: true },
    { id: "q1-no", text: "No", isCorrect: false },
  ] },
  { id: "q2", prompt: "Question 2", options: [
    { id: "q2-yes", text: "Yes", isCorrect: true },
    { id: "q2-no", text: "No", isCorrect: false },
  ] },
];

function createService(examQuestions = questions) {
  const attempt = { id: "attempt-1", status: "IN_PROGRESS", startedAt: new Date(), score: null as number | null, passed: null as boolean | null, submittedAt: null as Date | null };
  const assignment = {
    id: "assignment-1", companyId: "company-1", employeeId: "employee-1", trainingProgramId: "program-1", status: "IN_PROGRESS",
    dueAt: null, completedAt: null, examPassedAt: null, progressPercent: 80,
    trainingProgram: { title: "Training", exam: {
      id: "exam-1", description: null, passingScore: 100, maxAttempts: 3, questions: examQuestions,
    } },
    examAttempts: [attempt],
  };
  let updates = 0;
  let completions = 0;
  const prisma = {
    employee: { findFirst: async () => ({ id: "employee-1" }) },
    trainingAssignment: { findUnique: async () => assignment },
    $queryRaw: async () => [{ id: "assignment-1" }],
    $transaction: async (callback: (transaction: any) => Promise<unknown>) => callback(prisma),
    examAttempt: { updateMany: async ({ data }: { data: typeof attempt }) => {
      updates += 1;
      Object.assign(attempt, data);
      return { count: 1 };
    } },
  };
  const service = new ExamsService(
    prisma as never,
    { log: async () => undefined } as never,
    { completeAfterPassedExam: async (_id: string, _user: AuthenticatedUser, _fromExam: boolean, callback: (transaction: typeof prisma) => Promise<void>, audit: (transaction: typeof prisma) => Promise<void>) => {
      await callback(prisma);
      await audit(prisma);
      completions += 1;
    } } as never,
  );
  return { service, attempt, getUpdates: () => updates, getCompletions: () => completions };
}

test("an empty exam cannot consume an attempt", async () => {
  const { service, attempt, getUpdates } = createService([]);
  await assert.rejects(() => service.submitMy(user, "assignment-1", { answers: [] }), BadRequestException);
  assert.equal(getUpdates(), 0);
  assert.equal(attempt.status, "IN_PROGRESS");
});

for (const [description, answers] of [
  ["missing answer", [{ questionId: "q1", optionId: "q1-yes" }]],
  ["duplicate question", [{ questionId: "q1", optionId: "q1-yes" }, { questionId: "q1", optionId: "q1-no" }]],
  ["unknown question", [{ questionId: "q1", optionId: "q1-yes" }, { questionId: "other", optionId: "q2-yes" }]],
  ["option from another question", [{ questionId: "q1", optionId: "q2-yes" }, { questionId: "q2", optionId: "q2-yes" }]],
] as const) {
  test(`rejects ${description} without consuming the attempt`, async () => {
    const { service, attempt, getUpdates, getCompletions } = createService();
    await assert.rejects(
      () => service.submitMy(user, "assignment-1", { answers: [...answers] }),
      BadRequestException,
    );
    assert.equal(getUpdates(), 0);
    assert.equal(getCompletions(), 0);
    assert.equal(attempt.status, "IN_PROGRESS");
  });
}

test("a complete valid submission keeps the normal scoring and completion flow", async () => {
  const { service, attempt, getUpdates, getCompletions } = createService();
  await service.submitMy(user, "assignment-1", { answers: [
    { questionId: "q1", optionId: "q1-yes" },
    { questionId: "q2", optionId: "q2-yes" },
  ] });
  assert.equal(getUpdates(), 1);
  assert.equal(getCompletions(), 1);
  assert.equal(attempt.status, "SUBMITTED");
  assert.equal(attempt.score, 100);
  assert.equal(attempt.passed, true);
});

test("a complete incorrect submission still uses the existing scoring rules", async () => {
  const { service, attempt, getUpdates, getCompletions } = createService();
  await service.submitMy(user, "assignment-1", { answers: [
    { questionId: "q1", optionId: "q1-yes" },
    { questionId: "q2", optionId: "q2-no" },
  ] });
  assert.equal(getUpdates(), 1);
  assert.equal(getCompletions(), 0);
  assert.equal(attempt.status, "SUBMITTED");
  assert.equal(attempt.score, 50);
  assert.equal(attempt.passed, false);
});

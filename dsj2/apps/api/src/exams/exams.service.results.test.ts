import assert from "node:assert/strict";
import { test } from "node:test";
import type { AuthenticatedUser } from "../common/types/authenticated-user.type";
import { ExamsService } from "./exams.service";

const user: AuthenticatedUser = {
  userId: "user-1",
  companyId: "company-1",
  email: "employee@example.test",
  fullName: "Test Employee",
  role: "EMPLOYEE_SIGNER",
};

function serviceFor(passed: boolean, examPassedAt: Date | null = null) {
  const submittedAt = new Date("2026-01-10T10:00:00Z");
  const assignment = {
    id: "assignment-1",
    companyId: "company-1",
    employeeId: "employee-1",
    status: "IN_PROGRESS",
    dueAt: null,
    completedAt: null,
    progressPercent: 80,
    examPassedAt,
    trainingProgram: {
      title: "Training",
      exam: {
        id: "exam-1",
        description: null,
        passingScore: 80,
        maxAttempts: 1,
        questions: [],
      },
    },
    examAttempts: [{ status: "SUBMITTED", passed, score: passed ? 90 : 50, submittedAt }],
  };
  const prisma = {
    employee: { findFirst: async () => ({ id: "employee-1" }) },
    trainingAssignment: { findUnique: async () => assignment },
  };
  return { service: new ExamsService(prisma as never, {} as never, {} as never), submittedAt };
}

test("a failed exam has a score but no passing date", async () => {
  const { service } = serviceFor(false);
  const result = await service.findMy(user, "assignment-1");
  assert.equal(result.status, "FAILED");
  assert.equal(result.result, 50);
  assert.equal(result.passedAt, null);
});

test("a passed attempt supplies a passing date when the assignment date is absent", async () => {
  const { service, submittedAt } = serviceFor(true);
  const result = await service.findMy(user, "assignment-1");
  assert.equal(result.status, "PASSED");
  assert.equal(result.passedAt, submittedAt);
});

test("the recorded assignment passing date takes precedence", async () => {
  const recordedDate = new Date("2026-01-11T10:00:00Z");
  const { service } = serviceFor(true, recordedDate);
  const result = await service.findMy(user, "assignment-1");
  assert.equal(result.passedAt, recordedDate);
});

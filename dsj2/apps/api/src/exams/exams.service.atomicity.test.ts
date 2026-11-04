import assert from "node:assert/strict";
import { test } from "node:test";
import { ConflictException, NotFoundException } from "@nestjs/common";
import type { AuthenticatedUser } from "../common/types/authenticated-user.type";
import { TrainingProgramsService } from "../training-programs/training-programs.service";
import { ExamsService } from "./exams.service";
import { AuditService } from "../audit/audit.service";

const user: AuthenticatedUser = {
  userId: "user-1", companyId: "company-1", email: "employee@example.test",
  fullName: "Test Employee", role: "EMPLOYEE_SIGNER",
};

// This test double stages writes until the callback succeeds. It exercises the
// transaction boundary and event order; it is not a PostgreSQL concurrency test.
function createFixture(options: { failArtifact?: boolean; failAuditAction?: string; employeeId?: string; conflictAttempt?: boolean; conflictTraining?: boolean } = {}) {
  let state: any = {
    assignment: {
      id: "assignment-1", companyId: "company-1", employeeId: "employee-1", trainingProgramId: "program-1",
      status: "IN_PROGRESS", dueAt: null, startedAt: new Date("2026-01-01"), completedAt: null,
      examPassedAt: null, progressPercent: 80, assignedByUser: null,
      employee: { id: "employee-1", fullName: "Test Employee", employeeNumber: "1", jobTitle: "Worker" },
      trainingProgram: {
        id: "program-1", title: "Training", issuerName: "Test issuer", requiresExam: true,
        createsDocument: true, createsSafetyCertificate: true,
        exam: { id: "exam-1", title: "Exam", description: null, passingScore: 80, maxAttempts: 2,
          questions: [{ id: "question-1", prompt: "Question", options: [
            { id: "yes", text: "Yes", isCorrect: true }, { id: "no", text: "No", isCorrect: false },
          ] }],
        },
      },
    },
    attempt: { id: "attempt-1", status: "IN_PROGRESS", startedAt: new Date("2026-01-01"), score: null, passed: null, submittedAt: null },
    documents: [], certificates: [], events: [],
  };
  const readAssignment = (snapshot: typeof state) => ({
    ...snapshot.assignment,
    examAttempts: snapshot.attempt ? [snapshot.attempt] : [],
    generatedDocuments: snapshot.documents,
    generatedCertificates: snapshot.certificates,
  });
  const clientFor = (snapshot: typeof state) => ({
    $queryRaw: async () => [{ id: "assignment-1" }],
    auditLog: { create: async ({ data }: any) => {
      if (options.failAuditAction === data.action) throw new Error("Simulated audit failure");
      snapshot.events.push(data.action);
      return data;
    } },
    employee: { findFirst: async () => ({ id: options.employeeId ?? "employee-1" }) },
    trainingAssignment: {
      findUnique: async () => readAssignment(snapshot),
      update: async ({ data }: any) => {
        Object.assign(snapshot.assignment, data);
        return snapshot.assignment;
      },
      updateMany: async ({ where, data }: any) => {
        if (options.conflictTraining || (where.completedAt === null && snapshot.assignment.completedAt !== null)) return { count: 0 };
        Object.assign(snapshot.assignment, data);
        return { count: 1 };
      },
    },
    examAttempt: {
      create: async ({ data }: any) => {
        snapshot.attempt = { ...data, id: "attempt-new", startedAt: new Date(), score: null, passed: null, submittedAt: null };
        return snapshot.attempt;
      },
      updateMany: async ({ where, data }: any) => {
        if (options.conflictAttempt || snapshot.attempt.id !== where.id || snapshot.attempt.status !== where.status) return { count: 0 };
        Object.assign(snapshot.attempt, data);
        return { count: 1 };
      },
    },
    employeeDocument: { create: async ({ data }: any) => {
      const document = { ...data, id: `document-${snapshot.documents.length + 1}`, expiryDate: data.expiryDate ?? null };
      snapshot.documents.push(document);
      return document;
    } },
    safetyCertificate: { create: async ({ data }: any) => {
      if (options.failArtifact) throw new Error("Simulated certificate creation failure");
      const certificate = { ...data, id: "certificate-1" };
      snapshot.certificates.push(certificate);
      return certificate;
    } },
  });
  const prisma: any = {
    employee: { findFirst: async () => ({ id: options.employeeId ?? "employee-1" }) },
    trainingAssignment: { findUnique: async () => readAssignment(state) },
    examAttempt: { updateMany: async (args: any) => clientFor(state).examAttempt.updateMany(args) },
    $transaction: async (callback: (transaction: any) => Promise<unknown>) => {
      const staged = structuredClone(state);
      const result = await callback(clientFor(staged));
      state = staged;
      return result;
    },
  };
  const audit = new AuditService(prisma);
  const training = new TrainingProgramsService(prisma, audit);
  const exams = new ExamsService(prisma, audit, training);
  return { exams, training, getState: () => state };
}

const answers = { answers: [{ questionId: "question-1", optionId: "yes" }] };

test("successful submission commits attempt, completion and artifacts before ordered audit events", async () => {
  const { exams, getState } = createFixture();
  await exams.submitMy(user, "assignment-1", answers);
  assert.equal(getState().attempt.status, "SUBMITTED");
  assert.equal(getState().attempt.passed, true);
  assert.equal(getState().assignment.status, "COMPLETED");
  assert.equal(getState().documents.length, 2);
  assert.equal(getState().certificates.length, 1);
  assert.deepEqual(getState().events, ["training.completed", "exam.submitted"]);
});

test("failure creating an artifact rolls back attempt and completion in the transaction double", async () => {
  const { exams, getState } = createFixture({ failArtifact: true });
  await assert.rejects(() => exams.submitMy(user, "assignment-1", answers), /Simulated certificate/);
  assert.equal(getState().attempt.status, "IN_PROGRESS");
  assert.equal(getState().assignment.completedAt, null);
  assert.equal(getState().documents.length, 0);
  assert.equal(getState().certificates.length, 0);
  assert.deepEqual(getState().events, []);
});

for (const action of ["training.completed", "exam.submitted"]) {
  test(`failure writing ${action} rolls back attempt, completion, artifacts and audit`, async () => {
    const { exams, getState } = createFixture({ failAuditAction: action });
    await assert.rejects(() => exams.submitMy(user, "assignment-1", answers), /Simulated audit failure/);
    assert.equal(getState().attempt.status, "IN_PROGRESS");
    assert.equal(getState().assignment.completedAt, null);
    assert.equal(getState().documents.length, 0);
    assert.equal(getState().certificates.length, 0);
    assert.deepEqual(getState().events, []);
  });
}

test("failure auditing a failed submission does not consume the attempt", async () => {
  const { exams, getState } = createFixture({ failAuditAction: "exam.submitted" });
  await assert.rejects(() => exams.submitMy(user, "assignment-1", {
    answers: [{ questionId: "question-1", optionId: "no" }],
  }), /Simulated audit failure/);
  assert.equal(getState().attempt.status, "IN_PROGRESS");
  assert.equal(getState().attempt.score, null);
  assert.deepEqual(getState().events, []);
});

test("failure auditing exam start does not create an attempt", async () => {
  const { exams, getState } = createFixture({ failAuditAction: "exam.started" });
  getState().attempt = null;
  await assert.rejects(() => exams.startMy(user, "assignment-1"), /Simulated audit failure/);
  assert.equal(getState().attempt, null);
  assert.deepEqual(getState().events, []);
});

for (const action of ["training.started", "training.material_completed"]) {
  test(`failure auditing ${action} rolls back the assignment update`, async () => {
    const { training, getState } = createFixture({ failAuditAction: action });
    Object.assign(getState().assignment, { status: "ASSIGNED", progressPercent: 0, startedAt: null });
    const operation = action === "training.started" ? training.startMy.bind(training) : training.completeMy.bind(training);
    await assert.rejects(() => operation(user, "assignment-1"), /Simulated audit failure/);
    assert.equal(getState().assignment.status, "ASSIGNED");
    assert.equal(getState().assignment.progressPercent, 0);
    assert.equal(getState().assignment.startedAt, null);
    assert.deepEqual(getState().events, []);
  });
}

test("the same already-submitted attempt is not committed or audited again", async () => {
  const { exams, getState } = createFixture();
  await exams.submitMy(user, "assignment-1", answers);
  await assert.rejects(() => exams.submitMy(user, "assignment-1", answers), /Сначала начните/);
  assert.equal(getState().documents.length, 2);
  assert.equal(getState().certificates.length, 1);
  assert.deepEqual(getState().events, ["training.completed", "exam.submitted"]);
});

test("another employee cannot submit or create completion artifacts", async () => {
  const { exams, getState } = createFixture({ employeeId: "other-employee" });
  await assert.rejects(() => exams.submitMy(user, "assignment-1", answers), NotFoundException);
  assert.equal(getState().attempt.status, "IN_PROGRESS");
  assert.equal(getState().documents.length, 0);
  assert.deepEqual(getState().events, []);
});

for (const conflict of ["conflictAttempt", "conflictTraining"] as const) {
  test(`a ${conflict} guard rejects stale state without committing or auditing`, async () => {
    const { exams, getState } = createFixture({ [conflict]: true });
    await assert.rejects(() => exams.submitMy(user, "assignment-1", answers), ConflictException);
    assert.equal(getState().attempt.status, "IN_PROGRESS");
    assert.equal(getState().assignment.completedAt, null);
    assert.equal(getState().documents.length, 0);
    assert.deepEqual(getState().events, []);
  });
}

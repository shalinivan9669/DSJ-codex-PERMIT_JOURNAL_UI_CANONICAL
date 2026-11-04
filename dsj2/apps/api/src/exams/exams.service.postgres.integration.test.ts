import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../common/types/authenticated-user.type";
import { TrainingProgramsService } from "../training-programs/training-programs.service";
import { ExamsService } from "./exams.service";

// Never use the application DATABASE_URL here. This test requires an explicitly
// provisioned disposable local database with this exact dedicated name.
const testUrl = process.env.ISOLATED_EXAM_TEST_DATABASE_URL;

test("exam completion in a dedicated local PostgreSQL database", { skip: !testUrl }, async (t) => {
  const url = new URL(testUrl!);
  assert.ok(["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname));
  assert.equal(url.pathname, "/codex_exam_atomicity_test");
  const prisma = new PrismaClient({ datasources: { db: { url: testUrl } } });

  async function fixture() {
    const suffix = randomUUID();
    const company = await prisma.company.create({ data: { name: `Test ${suffix}` } });
    const account = await prisma.user.create({ data: {
      companyId: company.id, email: `${suffix}@example.test`, passwordHash: "synthetic",
      fullName: "Synthetic employee", role: "EMPLOYEE_SIGNER",
    } });
    const employee = await prisma.employee.create({ data: {
      companyId: company.id, userId: account.id, fullName: "Synthetic employee", iinEncrypted: "synthetic",
      iinHash: suffix, iinLast4: "0000", employeeNumber: suffix, jobTitle: "Tester",
    } });
    const program = await prisma.trainingProgram.create({ data: {
      companyId: company.id, title: `Program ${suffix}`, description: "Synthetic test program",
      requiresExam: true, createsDocument: true, createsSafetyCertificate: true,
    } });
    const exam = await prisma.exam.create({ data: {
      companyId: company.id, trainingProgramId: program.id, title: "Test exam", passingScore: 80, maxAttempts: 3,
      questions: { create: [{ prompt: "Synthetic question", options: { create: [
        { text: "Correct", isCorrect: true }, { text: "Incorrect", isCorrect: false },
      ] } }] },
    }, include: { questions: { include: { options: true } } } });
    const assignment = await prisma.trainingAssignment.create({ data: {
      companyId: company.id, employeeId: employee.id, trainingProgramId: program.id,
      status: "IN_PROGRESS", progressPercent: 80, startedAt: new Date(),
    } });
    const attempt = await prisma.examAttempt.create({ data: {
      companyId: company.id, employeeId: employee.id, examId: exam.id, trainingAssignmentId: assignment.id,
    } });
    const question = exam.questions[0];
    const correct = question.options.find((option) => option.isCorrect)!;
    const incorrect = question.options.find((option) => !option.isCorrect)!;
    const user: AuthenticatedUser = {
      userId: account.id, companyId: company.id, email: account.email,
      fullName: account.fullName, role: "EMPLOYEE_SIGNER",
    };
    return { company, user, assignment, attempt,
      answers: { answers: [{ questionId: question.id, optionId: correct.id }] },
      wrongAnswers: { answers: [{ questionId: question.id, optionId: incorrect.id }] },
    };
  }

  function services(failingAction?: string) {
    const events: string[] = [];
    const realAudit = new AuditService(prisma as never);
    const audit = { log: async (payload: Parameters<AuditService["log"]>[0], transaction?: Parameters<AuditService["log"]>[1]) => {
      if (payload.action === failingAction) throw new Error("Synthetic audit failure");
      const result = await realAudit.log(payload, transaction);
      events.push(payload.action);
      return result;
    } };
    const training = new TrainingProgramsService(prisma as never, audit as never);
    const exams = new ExamsService(prisma as never, audit as never, training);
    return { exams, training, events };
  }

  try {
    await t.test("failure auditing program creation rolls back the program and assignments", async () => {
      const data = await fixture();
      const { training } = services("training.created");
      const title = `New program ${randomUUID()}`;
      await assert.rejects(() => training.create({ ...data.user, role: "COMPANY_ADMIN" }, {
        employeeIds: [data.assignment.employeeId], title, description: "Synthetic description",
        requiresExam: false, createsDocument: false, createsSafetyCertificate: false,
      }), /Synthetic audit failure/);
      assert.equal(await prisma.trainingProgram.count({ where: { companyId: data.company.id, title } }), 0);
      assert.equal(await prisma.auditLog.count({ where: { companyId: data.company.id } }), 0);
    });

    for (const action of ["training.started", "training.material_completed"]) await t.test(`failure auditing ${action} rolls back the training update`, async () => {
      const data = await fixture();
      await prisma.trainingAssignment.update({ where: { id: data.assignment.id }, data: {
        status: "ASSIGNED", progressPercent: 0, startedAt: null,
      } });
      const { training } = services(action);
      const operation = action === "training.started" ? training.startMy.bind(training) : training.completeMy.bind(training);
      await assert.rejects(() => operation(data.user, data.assignment.id), /Synthetic audit failure/);
      const assignment = await prisma.trainingAssignment.findUniqueOrThrow({ where: { id: data.assignment.id } });
      assert.equal(assignment.status, "ASSIGNED");
      assert.equal(assignment.progressPercent, 0);
      assert.equal(assignment.startedAt, null);
      assert.equal(await prisma.auditLog.count({ where: { companyId: data.company.id } }), 0);
    });

    await t.test("failure auditing exam creation rolls back the exam and program change", async () => {
      const data = await fixture();
      const program = await prisma.trainingProgram.create({ data: {
        companyId: data.company.id, title: `No exam ${randomUUID()}`, description: "Synthetic program", requiresExam: false,
      } });
      const { exams } = services("exam.created");
      await assert.rejects(() => exams.create({ ...data.user, role: "COMPANY_ADMIN" }, {
        trainingProgramId: program.id, title: "Exam", passingScore: 80, maxAttempts: 3,
        questions: [{ prompt: "Question?", options: ["Yes", "No"], correctOptionIndex: 0 }],
      }), /Synthetic audit failure/);
      assert.equal(await prisma.exam.count({ where: { trainingProgramId: program.id } }), 0);
      assert.equal((await prisma.trainingProgram.findUniqueOrThrow({ where: { id: program.id } })).requiresExam, false);
      assert.equal(await prisma.auditLog.count({ where: { companyId: data.company.id } }), 0);
    });

    await t.test("failure auditing exam start does not create an attempt", async () => {
      const data = await fixture();
      await prisma.examAttempt.delete({ where: { id: data.attempt.id } });
      const { exams } = services("exam.started");
      await assert.rejects(() => exams.startMy(data.user, data.assignment.id), /Synthetic audit failure/);
      assert.equal(await prisma.examAttempt.count({ where: { trainingAssignmentId: data.assignment.id } }), 0);
      assert.equal(await prisma.auditLog.count({ where: { companyId: data.company.id } }), 0);
    });

    await t.test("failure auditing a failed submission does not consume the attempt", async () => {
      const data = await fixture();
      const { exams } = services("exam.submitted");
      await assert.rejects(() => exams.submitMy(data.user, data.assignment.id, data.wrongAnswers), /Synthetic audit failure/);
      assert.equal((await prisma.examAttempt.findUniqueOrThrow({ where: { id: data.attempt.id } })).status, "IN_PROGRESS");
      assert.equal(await prisma.auditLog.count({ where: { companyId: data.company.id } }), 0);
    });

    await t.test("failure auditing completion without an exam rolls back training and artifacts", async () => {
      const data = await fixture();
      await prisma.trainingProgram.update({ where: { id: data.assignment.trainingProgramId }, data: { requiresExam: false } });
      const { training } = services("training.completed");
      await assert.rejects(() => training.completeMy(data.user, data.assignment.id), /Synthetic audit failure/);
      assert.equal((await prisma.trainingAssignment.findUniqueOrThrow({ where: { id: data.assignment.id } })).completedAt, null);
      assert.equal(await prisma.employeeDocument.count({ where: { trainingAssignmentId: data.assignment.id } }), 0);
      assert.equal(await prisma.safetyCertificate.count({ where: { trainingAssignmentId: data.assignment.id } }), 0);
      assert.equal(await prisma.auditLog.count({ where: { companyId: data.company.id } }), 0);
    });

    await t.test("failure after artifact writes rolls back attempt, completion and artifacts", async () => {
      const data = await fixture();
      const { exams, training, events } = services();
      const internals = training as unknown as { ensureCompletionArtifacts: (...args: any[]) => Promise<void> };
      const original = internals.ensureCompletionArtifacts.bind(training);
      internals.ensureCompletionArtifacts = async (...args: any[]) => {
        await original(...args);
        throw new Error("Synthetic failure after artifact creation");
      };
      await assert.rejects(() => exams.submitMy(data.user, data.assignment.id, data.answers), /Synthetic failure/);
      assert.equal((await prisma.examAttempt.findUniqueOrThrow({ where: { id: data.attempt.id } })).status, "IN_PROGRESS");
      assert.equal((await prisma.trainingAssignment.findUniqueOrThrow({ where: { id: data.assignment.id } })).completedAt, null);
      assert.equal(await prisma.employeeDocument.count({ where: { trainingAssignmentId: data.assignment.id } }), 0);
      assert.equal(await prisma.safetyCertificate.count({ where: { trainingAssignmentId: data.assignment.id } }), 0);
      assert.deepEqual(events, []);
      assert.equal(await prisma.auditLog.count({ where: { companyId: data.company.id } }), 0);
    });

    await t.test("concurrent submissions of one attempt commit only once", async () => {
      const data = await fixture();
      const { exams, events } = services();
      const results = await Promise.allSettled([
        exams.submitMy(data.user, data.assignment.id, data.answers),
        exams.submitMy(data.user, data.assignment.id, data.answers),
      ]);
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(results.filter((result) => result.status === "rejected").length, 1);
      assert.equal((await prisma.examAttempt.findUniqueOrThrow({ where: { id: data.attempt.id } })).status, "SUBMITTED");
      assert.equal((await prisma.trainingAssignment.findUniqueOrThrow({ where: { id: data.assignment.id } })).status, "COMPLETED");
      assert.equal(await prisma.employeeDocument.count({ where: { trainingAssignmentId: data.assignment.id } }), 2);
      assert.equal(await prisma.safetyCertificate.count({ where: { trainingAssignmentId: data.assignment.id } }), 1);
      assert.deepEqual(events, ["training.completed", "exam.submitted"]);
      assert.equal(await prisma.auditLog.count({ where: { companyId: data.company.id } }), 2);
    });

    await t.test("concurrent starts produce one active attempt and one audit event", async () => {
      const data = await fixture();
      await prisma.examAttempt.delete({ where: { id: data.attempt.id } });
      const { exams, events } = services();
      const internals = exams as unknown as { findEmployeeAssignmentById: (id: string) => Promise<unknown> };
      const original = internals.findEmployeeAssignmentById.bind(exams);
      let reads = 0;
      let release!: () => void;
      const bothRead = new Promise<void>((resolve) => { release = resolve; });
      internals.findEmployeeAssignmentById = async (id: string) => {
        const value = await original(id);
        reads += 1;
        if (reads === 2) release();
        if (reads <= 2) await bothRead;
        return value;
      };
      const results = await Promise.all([
        exams.startMy(data.user, data.assignment.id), exams.startMy(data.user, data.assignment.id),
      ]);
      assert.equal(results[0].currentAttempt?.id, results[1].currentAttempt?.id);
      assert.equal(await prisma.examAttempt.count({ where: { trainingAssignmentId: data.assignment.id, status: "IN_PROGRESS" } }), 1);
      assert.deepEqual(events, ["exam.started"]);
    });

    for (const operation of ["startMy", "completeMy"] as const) await t.test(`stale ${operation} cannot reopen a completed assignment`, async () => {
      const data = await fixture();
      const pendingTraining = services();
      const passing = services();
      const internals = pendingTraining.training as unknown as { findRawById: (id: string) => Promise<unknown> };
      const original = internals.findRawById.bind(pendingTraining.training);
      let release!: () => void;
      let captured!: () => void;
      const readReady = new Promise<void>((resolve) => { captured = resolve; });
      const hold = new Promise<void>((resolve) => { release = resolve; });
      internals.findRawById = async (id: string) => {
        const snapshot = await original(id);
        captured();
        await hold;
        return snapshot;
      };
      const staleUpdate = pendingTraining.training[operation](data.user, data.assignment.id);
      await readReady;
      try {
        await passing.exams.submitMy(data.user, data.assignment.id, data.answers);
      } finally {
        release();
      }
      await assert.rejects(staleUpdate, /Обучение уже завершено/);
      const current = await prisma.trainingAssignment.findUniqueOrThrow({ where: { id: data.assignment.id } });
      assert.equal(current.status, "COMPLETED");
      assert.equal(current.progressPercent, 100);
      assert.ok(current.completedAt);
      assert.deepEqual(pendingTraining.events, []);
      assert.deepEqual(passing.events, ["training.completed", "exam.submitted"]);
      assert.equal(await prisma.auditLog.count({ where: { companyId: data.company.id } }), 2);
    });

    await t.test("a stale failed submission cannot overwrite a completed exam", async () => {
      const data = await fixture();
      const second = await prisma.examAttempt.create({ data: {
        companyId: data.attempt.companyId, employeeId: data.attempt.employeeId,
        examId: data.attempt.examId, trainingAssignmentId: data.assignment.id,
      } });
      const passing = services();
      const failing = services();
      const internals = failing.exams as unknown as { findEmployeeAssignmentById: (id: string) => Promise<any> };
      const original = internals.findEmployeeAssignmentById.bind(failing.exams);
      let release!: () => void;
      let captured!: () => void;
      const readReady = new Promise<void>((resolve) => { captured = resolve; });
      const hold = new Promise<void>((resolve) => { release = resolve; });
      internals.findEmployeeAssignmentById = async (id: string) => {
        const value = await original(id);
        value.examAttempts.sort((a: any, b: any) => (a.id === data.attempt.id ? -1 : b.id === data.attempt.id ? 1 : 0));
        captured();
        await hold;
        return value;
      };
      const failedSubmit = failing.exams.submitMy(data.user, data.assignment.id, data.wrongAnswers);
      await readReady;
      await passing.exams.submitMy(data.user, data.assignment.id, data.answers);
      release();
      await assert.rejects(failedSubmit, /уже успешно сдан/);
      assert.equal((await prisma.examAttempt.findUniqueOrThrow({ where: { id: data.attempt.id } })).status, "IN_PROGRESS");
      assert.equal((await prisma.examAttempt.findUniqueOrThrow({ where: { id: second.id } })).passed, true);
      assert.deepEqual(failing.events, []);
      assert.deepEqual(passing.events, ["training.completed", "exam.submitted"]);
    });

    await t.test("a failure committed first does not hide a subsequent pass, even with tied timestamps", async () => {
      const data = await fixture();
      const second = await prisma.examAttempt.create({ data: {
        companyId: data.attempt.companyId, employeeId: data.attempt.employeeId,
        examId: data.attempt.examId, trainingAssignmentId: data.assignment.id,
      } });
      const passing = services();
      const failing = services();
      const internals = passing.exams as unknown as { findEmployeeAssignmentById: (id: string) => Promise<any> };
      const original = internals.findEmployeeAssignmentById.bind(passing.exams);
      let release!: () => void;
      let captured!: () => void;
      const readReady = new Promise<void>((resolve) => { captured = resolve; });
      const hold = new Promise<void>((resolve) => { release = resolve; });
      let firstRead = true;
      internals.findEmployeeAssignmentById = async (id: string) => {
        const value = await original(id);
        if (firstRead) {
          firstRead = false;
          value.examAttempts.sort((a: any, b: any) => (a.id === data.attempt.id ? -1 : b.id === data.attempt.id ? 1 : 0));
          captured();
          await hold;
        }
        return value;
      };
      const passedSubmit = passing.exams.submitMy(data.user, data.assignment.id, data.answers);
      await readReady;
      await failing.exams.submitMy(data.user, data.assignment.id, data.wrongAnswers);
      release();
      await passedSubmit;
      const passAttempt = await prisma.examAttempt.findUniqueOrThrow({ where: { id: data.attempt.id } });
      assert.equal(passAttempt.passed, true);
      await prisma.examAttempt.update({ where: { id: second.id }, data: { submittedAt: passAttempt.submittedAt } });
      const result = await passing.exams.findMy(data.user, data.assignment.id);
      const training = await passing.training.findOne(data.user, data.assignment.id);
      assert.equal(result.status, "PASSED");
      assert.equal(result.passed, true);
      assert.equal(result.result, 100);
      assert.equal(training.exam?.result, 100);
      assert.deepEqual(failing.events, ["exam.submitted"]);
      assert.deepEqual(passing.events, ["training.completed", "exam.submitted"]);
    });

    await t.test("an existing completed assignment preserves its prior submission behavior", async () => {
      const data = await fixture();
      await prisma.trainingAssignment.update({ where: { id: data.assignment.id }, data: {
        status: "COMPLETED", progressPercent: 100, completedAt: new Date(), examPassedAt: new Date(),
      } });
      const { exams, events } = services();
      await exams.submitMy(data.user, data.assignment.id, data.answers);
      assert.equal((await prisma.examAttempt.findUniqueOrThrow({ where: { id: data.attempt.id } })).status, "SUBMITTED");
      assert.equal(await prisma.employeeDocument.count({ where: { trainingAssignmentId: data.assignment.id } }), 0);
      assert.deepEqual(events, ["exam.submitted"]);
    });

    for (const failingAction of ["training.completed", "exam.submitted"]) await t.test(`audit failure at ${failingAction} rolls back the entire completion`, async () => {
      const data = await fixture();
      const realAudit = new AuditService(prisma as never);
      const audit = { log: async (payload: Parameters<AuditService["log"]>[0], transaction?: Parameters<AuditService["log"]>[1]) => {
        if (payload.action === failingAction) throw new Error("Synthetic audit failure");
        return realAudit.log(payload, transaction);
      } };
      const training = new TrainingProgramsService(prisma as never, audit as never);
      const exams = new ExamsService(prisma as never, audit as never, training);
      await assert.rejects(() => exams.submitMy(data.user, data.assignment.id, data.answers), /Synthetic audit failure/);
      assert.equal((await prisma.examAttempt.findUniqueOrThrow({ where: { id: data.attempt.id } })).status, "IN_PROGRESS");
      assert.equal((await prisma.trainingAssignment.findUniqueOrThrow({ where: { id: data.assignment.id } })).completedAt, null);
      assert.equal(await prisma.employeeDocument.count({ where: { trainingAssignmentId: data.assignment.id } }), 0);
      assert.equal(await prisma.safetyCertificate.count({ where: { trainingAssignmentId: data.assignment.id } }), 0);
      assert.equal(await prisma.auditLog.count({ where: { companyId: data.company.id } }), 0);
    });

    await t.test("a database constraint failure while writing audit rolls back completion", async () => {
      const data = await fixture();
      const realAudit = new AuditService(prisma as never);
      const audit = { log: async (payload: Parameters<AuditService["log"]>[0], transaction?: Parameters<AuditService["log"]>[1]) => {
        return realAudit.log(payload.action === "exam.submitted"
          ? { ...payload, actorUserId: `missing-${randomUUID()}` }
          : payload, transaction);
      } };
      const training = new TrainingProgramsService(prisma as never, audit as never);
      const exams = new ExamsService(prisma as never, audit as never, training);
      await assert.rejects(() => exams.submitMy(data.user, data.assignment.id, data.answers));
      assert.equal((await prisma.examAttempt.findUniqueOrThrow({ where: { id: data.attempt.id } })).status, "IN_PROGRESS");
      assert.equal((await prisma.trainingAssignment.findUniqueOrThrow({ where: { id: data.assignment.id } })).completedAt, null);
      assert.equal(await prisma.employeeDocument.count({ where: { trainingAssignmentId: data.assignment.id } }), 0);
      assert.equal(await prisma.safetyCertificate.count({ where: { trainingAssignmentId: data.assignment.id } }), 0);
      assert.equal(await prisma.auditLog.count({ where: { companyId: data.company.id } }), 0);
    });

    await t.test("concurrent completion from distinct attempts cannot issue artifacts twice", async () => {
      const data = await fixture();
      const second = await prisma.examAttempt.create({ data: {
        companyId: data.attempt.companyId, employeeId: data.attempt.employeeId,
        examId: data.attempt.examId, trainingAssignmentId: data.assignment.id,
      } });
      const { training, events } = services();
      let entered = 0;
      let release!: () => void;
      const bothEntered = new Promise<void>((resolve) => { release = resolve; });
      const internals = training as unknown as { findRawById: (id: string) => Promise<unknown> };
      const originalFind = internals.findRawById.bind(training);
      internals.findRawById = async (id: string) => {
        const result = await originalFind(id);
        entered += 1;
        if (entered === 2) release();
        if (entered <= 2) await bothEntered;
        return result;
      };
      const submit = (attemptId: string) => training.completeAfterPassedExam(
        data.assignment.id, data.user, true,
        async (transaction) => {
          const update = await transaction.examAttempt.updateMany({
            where: { id: attemptId, status: "IN_PROGRESS" },
            data: { status: "SUBMITTED", passed: true, score: 100, submittedAt: new Date() },
          });
          assert.equal(update.count, 1);
        },
      );
      const results = await Promise.allSettled([submit(data.attempt.id), submit(second.id)]);
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(results.filter((result) => result.status === "rejected").length, 1);
      assert.equal(await prisma.examAttempt.count({ where: { trainingAssignmentId: data.assignment.id, status: "SUBMITTED" } }), 1);
      assert.equal(await prisma.employeeDocument.count({ where: { trainingAssignmentId: data.assignment.id } }), 2);
      assert.equal(await prisma.safetyCertificate.count({ where: { trainingAssignmentId: data.assignment.id } }), 1);
      assert.deepEqual(events, ["training.completed"]);
    });
  } finally {
    await prisma.$disconnect();
  }
});

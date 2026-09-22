import { refuseFrozenRuntime } from "../../../product-policy/legacy";
import { config } from "dotenv";
import { Queue, Worker } from "bullmq";
import { createPrismaClient } from "@dsj/database";
import {
  evaluateEmployeeAdmissionSummary,
  getEmployeeDocumentLifecycleStatus,
  parsePositionComplianceMatrixPayload,
} from "@dsj/utils";
import { resolve } from "node:path";

refuseFrozenRuntime("DSJ worker");

config({ path: resolve(process.cwd(), "../../.env.local") });
config({ path: resolve(process.cwd(), "../../.env") });

const prisma = createPrismaClient();
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
  maxRetriesPerRequest: null,
};

const complianceQueue = new Queue("dsj-compliance", {
  connection,
});

const notificationQueue = new Queue("dsj-notifications", {
  connection,
});

const signingExpirationQueue = new Queue("dsj-signing-expiration", {
  connection,
});

const signingCallbackReconcileQueue = new Queue("dsj-signing-callback-reconcile", {
  connection,
});

const workPermitExpirationQueue = new Queue("dsj-work-permit-expiration", {
  connection,
});

const EMAIL_TRANSPORT_NOT_CONFIGURED =
  "Email notification transport is not configured.";

async function ensureReminder(args: {
  companyId: string;
  briefingRecordId: string;
  employeeId: string;
  type: "REPEATED_BRIEFING_DUE" | "REPEATED_BRIEFING_OVERDUE" | "UNSIGNED_RECORD_PENDING";
  title: string;
  message: string;
  dueAt: Date;
  assigneeUserId: string;
}) {
  return prisma.$transaction(async (transaction) => {
    const existing = await transaction.reminder.findFirst({
      where: {
        companyId: args.companyId,
        briefingRecordId: args.briefingRecordId,
        type: args.type,
        status: {
          in: ["pending", "sent"],
        },
      },
    });

    if (existing) {
      return existing;
    }

    const reminder = await transaction.reminder.create({
      data: {
        companyId: args.companyId,
        briefingRecordId: args.briefingRecordId,
        employeeId: args.employeeId,
        type: args.type,
        title: args.title,
        message: args.message,
        dueAt: args.dueAt,
      },
    });

    await transaction.notificationJob.create({
      data: {
        companyId: args.companyId,
        reminderId: reminder.id,
        briefingRecordId: args.briefingRecordId,
        assigneeUserId: args.assigneeUserId,
        type: args.type,
        channel: "IN_APP",
        scheduledAt: new Date(),
        payload: {
          title: args.title,
          message: args.message,
        },
      },
    });

    return reminder;
  });
}

function mapSummaryStatusToLegacy(status: "admitted" | "limited" | "blocked") {
  switch (status) {
    case "admitted":
      return "DOPUSHEN" as const;
    case "limited":
      return "OGRANICHENNO_DOPUSHEN" as const;
    case "blocked":
      return "NE_DOPUSHEN" as const;
  }
}

async function syncEmployeeDocumentLifecycle(now: Date) {
  const documents = await prisma.employeeDocument.findMany({
    where: {
      status: {
        not: "DRAFT",
      },
    },
    select: {
      id: true,
      companyId: true,
      title: true,
      documentNumber: true,
      status: true,
      expiryDate: true,
    },
  });

  let updatedCount = 0;

  for (const document of documents) {
    const lifecycleStatus = getEmployeeDocumentLifecycleStatus({
      status: document.status,
      expiryDate: document.expiryDate,
      evaluatedAt: now,
    });
    const nextStatus =
      lifecycleStatus === "EXPIRING"
        ? "EXPIRING"
        : lifecycleStatus === "EXPIRED"
          ? "EXPIRED"
          : "ACTIVE";

    if (document.status === nextStatus) {
      continue;
    }

    await prisma.employeeDocument.update({
      where: { id: document.id },
      data: {
        status: nextStatus,
      },
    });

    await prisma.auditLog.create({
      data: {
        companyId: document.companyId,
        action: "document.expiry_scan.updated",
        entityType: "EmployeeDocument",
        entityId: document.id,
        metadata: {
          previousStatus: document.status,
          nextStatus,
          documentNumber: document.documentNumber,
          title: document.title,
        },
      },
    });

    updatedCount += 1;
  }

  return updatedCount;
}

async function resolveActiveMatrixForEmployee(
  companyId: string,
  positionId: string | null,
) {
  if (!positionId) {
    return null;
  }

  const matrices = await prisma.jobRequirementMatrix.findMany({
    where: {
      organizationId: companyId,
      positionId,
      currentVersionId: {
        not: null,
      },
    },
    include: {
      currentVersion: true,
    },
    orderBy: [{ effectiveFrom: "desc" }, { updatedAt: "desc" }],
    take: 10,
  });

  const currentTime = Date.now();

  return (
    matrices.find((matrix) => {
      const matrixEffectiveFrom =
        matrix.effectiveFrom?.getTime() ?? Number.MIN_SAFE_INTEGER;
      const matrixEffectiveTo =
        matrix.effectiveTo?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const versionEffectiveFrom =
        matrix.currentVersion?.effectiveFrom?.getTime() ??
        Number.MIN_SAFE_INTEGER;
      const versionEffectiveTo =
        matrix.currentVersion?.effectiveTo?.getTime() ??
        Number.MAX_SAFE_INTEGER;

      return (
        Boolean(matrix.currentVersion) &&
        (matrix.currentVersion?.status === "ACTIVE" ||
          matrix.currentVersion?.status === "APPROVED") &&
        matrixEffectiveFrom <= currentTime &&
        matrixEffectiveTo >= currentTime &&
        versionEffectiveFrom <= currentTime &&
        versionEffectiveTo >= currentTime
      );
    }) ??
    matrices.find(
      (matrix) =>
        Boolean(matrix.currentVersion) &&
        (matrix.currentVersion?.status === "ACTIVE" ||
          matrix.currentVersion?.status === "APPROVED"),
    ) ??
    null
  );
}

async function recalculateEmployeeAdmissions(now: Date) {
  const employees = await prisma.employee.findMany({
    where: {
      isArchived: false,
      status: "active",
    },
    select: {
      id: true,
      companyId: true,
      departmentId: true,
      positionId: true,
    },
  });

  let recalculatedCount = 0;

  for (const employee of employees) {
    const [documents, latestEvaluation, matrix] = await Promise.all([
      prisma.employeeDocument.findMany({
        where: { employeeId: employee.id },
        select: {
          id: true,
          documentTypeDefinitionId: true,
          title: true,
          documentNumber: true,
          issueDate: true,
          expiryDate: true,
          status: true,
          verificationStatus: true,
        },
      }),
      prisma.admissionEvaluation.findFirst({
        where: {
          organizationId: employee.companyId,
          employeeId: employee.id,
        },
        orderBy: {
          evaluatedAt: "desc",
        },
      }),
      resolveActiveMatrixForEmployee(employee.companyId, employee.positionId),
    ]);

    let matrixPayload = null as ReturnType<typeof parsePositionComplianceMatrixPayload> | null;

    try {
      matrixPayload =
        matrix?.currentVersion?.payloadJson
          ? parsePositionComplianceMatrixPayload(matrix.currentVersion.payloadJson)
          : null;
    } catch {
      matrixPayload = null;
    }

    const requiredTypeIds = Array.from(
      new Set(
        matrixPayload
          ? [
              ...matrixPayload.requiredDocuments.map((item) => item.documentTypeId),
              ...matrixPayload.requiredTrainings.map((item) => item.documentTypeId),
              ...matrixPayload.requiredInstructions.map((item) => item.documentTypeId),
            ]
          : [],
      ),
    );
    const documentTypes = requiredTypeIds.length
      ? await prisma.complianceDocumentType.findMany({
          where: {
            organizationId: employee.companyId,
            id: { in: requiredTypeIds },
          },
        })
      : [];
    const documentTypeMap = new Map(
      documentTypes.map((documentType) => [documentType.id, documentType]),
    );
    const requirements = matrixPayload
      ? [
          ...matrixPayload.requiredDocuments.map((item) => ({
            documentTypeId: item.documentTypeId,
            code:
              documentTypeMap.get(item.documentTypeId)?.code ??
              `missing-${item.documentTypeId}`,
            name:
              documentTypeMap.get(item.documentTypeId)?.name ??
              item.documentTypeId,
            category: "DOCUMENT" as const,
            requiresVerification:
              documentTypeMap.get(item.documentTypeId)?.requiresVerification ??
              true,
          })),
          ...matrixPayload.requiredTrainings.map((item) => ({
            documentTypeId: item.documentTypeId,
            code:
              documentTypeMap.get(item.documentTypeId)?.code ??
              `missing-${item.documentTypeId}`,
            name:
              documentTypeMap.get(item.documentTypeId)?.name ??
              item.documentTypeId,
            category: "TRAINING" as const,
            requiresVerification:
              documentTypeMap.get(item.documentTypeId)?.requiresVerification ??
              true,
          })),
          ...matrixPayload.requiredInstructions.map((item) => ({
            documentTypeId: item.documentTypeId,
            code:
              documentTypeMap.get(item.documentTypeId)?.code ??
              `missing-${item.documentTypeId}`,
            name:
              documentTypeMap.get(item.documentTypeId)?.name ??
              item.documentTypeId,
            category: "INSTRUCTION" as const,
            requiresVerification:
              documentTypeMap.get(item.documentTypeId)?.requiresVerification ??
              true,
          })),
        ]
      : [];

    const summary = evaluateEmployeeAdmissionSummary({
      checkedAt: now,
      hasPosition: Boolean(employee.positionId),
      matrixId: matrixPayload ? matrix?.id ?? null : null,
      matrixVersionId: matrixPayload ? matrix?.currentVersionId ?? null : null,
      requirements,
      documents,
    });
    const legacyStatus = mapSummaryStatusToLegacy(summary.status);
    const nextReviewAt =
      documents
        .map((document) => document.expiryDate)
        .filter((value): value is Date => value instanceof Date)
        .sort((left, right) => left.getTime() - right.getTime())[0] ?? null;

    if (
      latestEvaluation &&
      latestEvaluation.status === legacyStatus &&
      latestEvaluation.decisionCode === summary.decisionCode &&
      latestEvaluation.matrixVersionId === (matrixPayload ? matrix?.currentVersionId ?? null : null)
    ) {
      continue;
    }

    const evaluation = await prisma.admissionEvaluation.create({
      data: {
        organizationId: employee.companyId,
        subjectType: "EMPLOYEE",
        subjectId: employee.id,
        employeeId: employee.id,
        contractorWorkerId: null,
        branchId: null,
        departmentId: employee.departmentId,
        workSiteId: null,
        positionId: employee.positionId,
        workType: "OTHER",
        matrixId: matrix?.id ?? null,
        matrixVersionId: matrixPayload ? matrix?.currentVersionId ?? null : null,
        trainingPlanVersionId: null,
        briefingJournalEntryId: null,
        workPermitId: null,
        status: legacyStatus,
        decisionCode: summary.decisionCode,
        ruleVersion: "employee-compliance-p0-v1",
        evaluatedAt: now,
        nextReviewAt,
        checksJson: summary.checks,
        warningsJson: summary.warnings,
        nextActionsJson: summary.nextActions,
        resultJson: {
          ...summary,
          employeeId: employee.id,
          positionId: employee.positionId,
        },
      },
    });

    await prisma.auditLog.create({
      data: {
        companyId: employee.companyId,
        action: "admission.recalculated",
        entityType: "AdmissionEvaluation",
        entityId: evaluation.id,
        metadata: {
          employeeId: employee.id,
          positionId: employee.positionId,
          status: summary.status,
          decisionCode: summary.decisionCode,
        },
      },
    });

    recalculatedCount += 1;
  }

  return recalculatedCount;
}

async function scanCompliance() {
  const now = new Date();
  const upcomingWindow = new Date(now);
  upcomingWindow.setDate(now.getDate() + 7);

  const [repeatedDueSoon, repeatedOverdue, unsignedRecords] = await Promise.all([
    prisma.briefingRecord.findMany({
      where: {
        briefingType: "REPEATED",
        status: {
          notIn: ["SIGNED", "ARCHIVED"],
        },
        nextBriefingDueAt: {
          gt: now,
          lte: upcomingWindow,
        },
      },
    }),
    prisma.briefingRecord.findMany({
      where: {
        briefingType: "REPEATED",
        status: {
          notIn: ["SIGNED", "ARCHIVED"],
        },
        nextBriefingDueAt: {
          lte: now,
        },
      },
    }),
    prisma.briefingRecord.findMany({
      where: {
        status: "READY_FOR_SIGNING",
      },
    }),
  ]);

  for (const record of repeatedDueSoon) {
    await ensureReminder({
      companyId: record.companyId,
      briefingRecordId: record.id,
      employeeId: record.employeeId,
      type: "REPEATED_BRIEFING_DUE",
      title: "Скоро требуется повторный инструктаж",
      message: `${record.documentNumber ?? "Инструктаж"} нужно повторить до ${record.nextBriefingDueAt?.toISOString()}.`,
      dueAt: record.nextBriefingDueAt ?? upcomingWindow,
      assigneeUserId: record.instructorUserId,
    });
  }

  for (const record of repeatedOverdue) {
    await ensureReminder({
      companyId: record.companyId,
      briefingRecordId: record.id,
      employeeId: record.employeeId,
      type: "REPEATED_BRIEFING_OVERDUE",
      title: "Просрочен повторный инструктаж",
      message: `${record.documentNumber ?? "Инструктаж"} просрочен и требует действия.`,
      dueAt: record.nextBriefingDueAt ?? now,
      assigneeUserId: record.instructorUserId,
    });
  }

  for (const record of unsignedRecords) {
    const dueAt = new Date(record.updatedAt);
    dueAt.setDate(dueAt.getDate() + 2);

    await ensureReminder({
      companyId: record.companyId,
      briefingRecordId: record.id,
      employeeId: record.employeeId,
      type: "UNSIGNED_RECORD_PENDING",
      title: "Ожидается подпись под записью",
      message: `${record.documentNumber ?? "Инструктаж"} готов к подписанию.`,
      dueAt,
      assigneeUserId: record.instructorUserId,
    });
  }

  const updatedDocumentStatuses = await syncEmployeeDocumentLifecycle(now);
  const recalculatedAdmissions = await recalculateEmployeeAdmissions(now);

  console.log(
    `[worker] проверка соответствия завершена: скоро ${repeatedDueSoon.length}, просрочено ${repeatedOverdue.length}, ожидают подписи ${unsignedRecords.length}`,
  );
  console.log(
    `[worker] p0 bridge extras: document status updates ${updatedDocumentStatuses}, admission recalculations ${recalculatedAdmissions}`,
  );
}

async function dispatchNotifications() {
  const queuedJobs = await prisma.notificationJob.findMany({
    where: {
      status: "queued",
      scheduledAt: {
        lte: new Date(),
      },
    },
    orderBy: {
      scheduledAt: "asc",
    },
    take: 50,
  });

  let deliveredCount = 0;
  let failedCount = 0;

  for (const job of queuedJobs) {
    await prisma.notificationJob.update({
      where: { id: job.id },
      data: {
        status: "processing",
        attempts: {
          increment: 1,
        },
      },
    });

    const processedAt = new Date();

    if (job.channel === "EMAIL") {
      await prisma.notificationJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          processedAt,
          lastError: EMAIL_TRANSPORT_NOT_CONFIGURED,
        },
      });

      if (job.reminderId) {
        await prisma.reminder.update({
          where: { id: job.reminderId },
          data: {
            status: "failed",
          },
        });
      }

      failedCount += 1;
      continue;
    }

    await prisma.notificationJob.update({
      where: { id: job.id },
      data: {
        status: "sent",
        processedAt,
        lastError: null,
      },
    });

    if (job.reminderId) {
      await prisma.reminder.update({
        where: { id: job.reminderId },
        data: {
          status: "sent",
          sentAt: processedAt,
        },
      });
    }

    deliveredCount += 1;
  }

  console.log(
    `[worker] notification jobs processed: ${queuedJobs.length}, in-app sent: ${deliveredCount}, failed: ${failedCount}`,
  );
}

async function expireSigningSessions() {
  const expired = await prisma.signingSession.findMany({
    where: {
      status: {
        in: ["CREATED", "QR_GENERATED", "WAITING_FOR_USER", "CALLBACK_RECEIVED", "VERIFYING"],
      },
      expiresAt: {
        lte: new Date(),
      },
    },
    orderBy: {
      expiresAt: "asc",
    },
    take: 100,
  });

  for (const session of expired) {
    await prisma.signingSession.updateMany({
      where: {
        id: session.id,
        status: session.status,
      },
      data: {
        status: "EXPIRED",
        failureReason: "Signing session expired.",
      },
    });

    await prisma.auditLog.create({
      data: {
        companyId: session.organizationId,
        action: "signing.session.expired",
        entityType: "SigningSession",
        entityId: session.id,
        metadata: {
          provider: session.provider,
          documentType: session.documentType,
          documentId: session.documentId,
          correlationId: session.correlationId,
        },
      },
    });
  }

  console.log(`[worker] signing sessions expired: ${expired.length}`);
}

async function reconcileSigningCallbacks() {
  const staleCallbacks = await prisma.providerCallbackEvent.findMany({
    where: {
      processingStatus: "PENDING",
      createdAt: {
        lte: new Date(Date.now() - 1000 * 60 * 10),
      },
    },
    orderBy: {
      createdAt: "asc",
    },
    take: 50,
  });

  for (const callback of staleCallbacks) {
    await prisma.providerCallbackEvent.updateMany({
      where: {
        id: callback.id,
        processingStatus: "PENDING",
      },
      data: {
        processingStatus: "IGNORED",
        processedAt: new Date(),
        error: callback.error ?? "Callback was not reconciled by API path.",
      },
    });
  }

  console.log(`[worker] signing callbacks inspected: ${staleCallbacks.length}`);
}

async function expireWorkPermits() {
  const permits = await prisma.workPermit.findMany({
    where: {
      status: {
        in: ["ACTIVE", "SUSPENDED", "EXTENDED"],
      },
      effectiveTo: {
        lt: new Date(),
      },
    },
    select: {
      id: true,
      organizationId: true,
      status: true,
      effectiveTo: true,
    },
    orderBy: {
      effectiveTo: "asc",
    },
    take: 100,
  });

  let expiredCount = 0;
  for (const permit of permits) {
    const updated = await prisma.$transaction(async (transaction) => {
      const result = await transaction.workPermit.updateMany({
        where: {
          id: permit.id,
          status: permit.status,
          effectiveTo: {
            lt: new Date(),
          },
        },
        data: {
          status: "EXPIRED",
        },
      });

      if (result.count === 0) {
        return false;
      }

      await transaction.auditLog.create({
        data: {
          companyId: permit.organizationId,
          action: "work_permit.expired",
          entityType: "WorkPermit",
          entityId: permit.id,
          metadata: {
            previousStatus: permit.status,
            effectiveTo: permit.effectiveTo?.toISOString() ?? null,
          },
        },
      });
      return true;
    });

    if (updated) {
      expiredCount += 1;
    }
  }

  console.log(`[worker] work permits expired: ${expiredCount}`);
}

async function bootstrap() {
  await prisma.$connect();

  await complianceQueue.add(
    "scan",
    {},
    {
      repeat: {
        every: 1000 * 60 * 15,
      },
      jobId: "compliance-scan",
      removeOnComplete: 20,
      removeOnFail: 20,
    },
  );

  await notificationQueue.add(
    "dispatch",
    {},
    {
      repeat: {
        every: 1000 * 60 * 5,
      },
      jobId: "notification-dispatch",
      removeOnComplete: 20,
      removeOnFail: 20,
    },
  );

  await signingExpirationQueue.add(
    "expire",
    {},
    {
      repeat: {
        every: 1000 * 60,
      },
      jobId: "signing-expiration",
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 1000,
      },
      removeOnComplete: 20,
      removeOnFail: 50,
    },
  );

  await signingCallbackReconcileQueue.add(
    "reconcile",
    {},
    {
      repeat: {
        every: 1000 * 60 * 5,
      },
      jobId: "signing-callback-reconcile",
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 1000,
      },
      removeOnComplete: 20,
      removeOnFail: 50,
    },
  );

  await workPermitExpirationQueue.add(
    "expire",
    {},
    {
      repeat: {
        every: 1000 * 60,
      },
      jobId: "work-permit-expiration",
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 1000,
      },
      removeOnComplete: 20,
      removeOnFail: 50,
    },
  );

  new Worker(
    "dsj-compliance",
    async () => {
      await scanCompliance();
    },
    { connection },
  );

  new Worker(
    "dsj-notifications",
    async () => {
      await dispatchNotifications();
    },
    { connection },
  );

  console.log("[worker] worker Digital Safety Journal запущен");
  new Worker(
    "dsj-signing-expiration",
    async () => {
      await expireSigningSessions();
    },
    { connection },
  );

  new Worker(
    "dsj-signing-callback-reconcile",
    async () => {
      await reconcileSigningCallbacks();
    },
    { connection },
  );

  new Worker(
    "dsj-work-permit-expiration",
    async () => {
      await expireWorkPermits();
    },
    { connection },
  );
}

bootstrap().catch(async (error) => {
  console.error("[worker] ошибка запуска", error);
  await prisma.$disconnect();
  process.exit(1);
});

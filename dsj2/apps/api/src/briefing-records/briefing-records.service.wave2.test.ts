import assert from "node:assert/strict";
import { test } from "node:test";
import { BadRequestException } from "@nestjs/common";
import type { AuthenticatedUser } from "../common/types/authenticated-user.type";
import { BriefingRecordsService } from "./briefing-records.service";

const adminUser: AuthenticatedUser = {
  userId: "user-admin-1",
  companyId: "company-1",
  email: "admin@example.com",
  fullName: "Admin User",
  role: "COMPANY_ADMIN",
};

const employeeUser: AuthenticatedUser = {
  userId: "user-employee-1",
  companyId: "company-1",
  email: "employee@example.com",
  fullName: "Aigerim Sadykova",
  role: "EMPLOYEE_SIGNER",
};

const instructorAdminUser: AuthenticatedUser = {
  ...adminUser,
  userId: "user-instructor-1",
};

function createInput(overrides: Record<string, unknown> = {}) {
  return {
    companyId: "company-1",
    employeeIds: ["employee-1"],
    departmentId: null,
    siteId: null,
    instructorUserId: "user-instructor-1",
    briefingType: "INTRODUCTORY",
    briefingDate: "2026-03-20T00:00:00.000Z",
    completionDueAt: null,
    topic: "Introductory briefing",
    notes: "Bring PPE",
    materialContent: null,
    materialFileName: null,
    materialFileUrl: null,
    nextBriefingDueAt: null,
    status: "DRAFT",
    ...overrides,
  };
}

function createExistingRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "record-1",
    companyId: "company-1",
    organizationId: "company-1",
    journalId: "journal-1",
    journalKind: "INTRODUCTORY",
    entryNo: 1,
    registrationNo: "DSJ-2026-0001",
    briefingBatchId: null,
    briefingBatch: null,
    documentNumber: "DSJ-2026-0001",
    documentHash: "digest-1",
    briefingType: "INTRODUCTORY",
    briefingDate: new Date("2026-03-20T00:00:00.000Z"),
    completionDueAt: null,
    nextBriefingDueAt: null,
    topic: "Introductory briefing",
    notes: "Bring PPE",
    materialContent: null,
    materialFileName: null,
    materialFileUrl: null,
    status: "DRAFT",
    employeeStatus: "ASSIGNED",
    departmentId: "department-1",
    siteId: "site-1",
    workSiteId: "site-1",
    employeeId: "employee-1",
    instructorUserId: "user-instructor-1",
    inviteToken: null,
    inviteTokenExpiresAt: null,
    inviteSentAt: null,
    openedAt: null,
    acknowledgedAt: null,
    signedAt: null,
    archivedAt: null,
    createdAt: new Date("2026-03-20T00:00:00.000Z"),
    updatedAt: new Date("2026-03-20T00:00:00.000Z"),
    employee: createEmployee(),
    instructor: {
      id: "user-instructor-1",
      fullName: "Instructor User",
    },
    department: null,
    site: null,
    workSite: null,
    documentEnvelope: null,
    pendingSigners: [],
    signatures: [],
    ...overrides,
  };
}

function createEmployee(overrides: Record<string, unknown> = {}) {
  return {
    id: "employee-1",
    userId: "user-employee-1",
    departmentId: "department-1",
    siteId: "site-1",
    fullName: "Aigerim Sadykova",
    employeeNumber: "EMP-001",
    jobTitle: "Operator",
    email: null,
    phone: null,
    employeeKind: "INTERNAL",
    iinLast4: "0011",
    contractorCompany: null,
    user: {
      id: "user-employee-1",
      email: "employee@example.com",
      role: "EMPLOYEE_SIGNER",
      isActive: true,
    },
    ...overrides,
  };
}

function createService(options?: {
  departments?: string[];
  employees?: Record<string, unknown>[];
  existingRecord?: Record<string, unknown>;
  sites?: string[];
}) {
  const state: {
    briefingCreateData: Record<string, unknown>[];
    briefingUpdateData: Record<string, unknown>[];
    transactionCalls: number;
  } = {
    briefingCreateData: [],
    briefingUpdateData: [],
    transactionCalls: 0,
  };
  const departments = new Set(options?.departments ?? ["department-1", "department-2"]);
  const employees = options?.employees ?? [createEmployee()];
  const sites = new Set(options?.sites ?? ["site-1", "site-2"]);

  const prisma = {
    department: {
      findFirst: async ({ where }: { where: { companyId: string; id: string } }) =>
        where.companyId === "company-1" && departments.has(where.id)
          ? { id: where.id, companyId: where.companyId }
          : null,
    },
    site: {
      findFirst: async ({ where }: { where: { companyId: string; id: string } }) =>
        where.companyId === "company-1" && sites.has(where.id) ? { id: where.id, companyId: where.companyId } : null,
    },
    briefingJournalEntry: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.briefingCreateData.push(data);
        return {
          id: "record-1",
        };
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        state.briefingUpdateData.push(data);
        return {
          id: "record-1",
          ...data,
        };
      },
    },
    workSite: {
      findFirst: async ({ where }: { where: { organizationId: string; id: string } }) =>
        where.organizationId === "company-1" && sites.has(where.id)
          ? {
              id: where.id,
              organizationId: where.organizationId,
              code: null,
              name: where.id,
              location: null,
            }
          : null,
    },
    $transaction: async (callback: (transaction: any) => Promise<unknown>) => {
      state.transactionCalls += 1;

      return callback({
        briefingBatch: {
          create: async ({ data }: { data: Record<string, unknown> }) => ({
            id: "batch-1",
            ...data,
          }),
        },
        briefingRecord: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            state.briefingCreateData.push(data);
            return {
              id: "record-1",
              companyId: String(data.companyId),
              employeeId: String(data.employeeId),
              instructorUserId: String(data.instructorUserId),
              documentNumber: String(data.documentNumber),
              topic: String(data.topic),
              status: String(data.status),
              inviteToken: null,
            };
          },
        },
      });
    },
  };

  const service = new BriefingRecordsService(
    prisma as never,
    {
      log: async () => undefined,
    } as never,
    {
      queueSigningInvite: async () => undefined,
      queueUnsignedReminder: async () => undefined,
      resolveBriefingReminders: async () => undefined,
    } as never,
    {
      renderBriefingRecord: async () => Buffer.from("pdf"),
      renderJournal: async () => Buffer.from("pdf"),
    } as never,
  );

  (service as any).buildRecordPayload = (payload: Record<string, unknown>) => ({
    companyId: payload.companyId,
    departmentId: payload.departmentId,
    siteId: payload.siteId,
    employeeId: payload.employeeId,
    instructorUserId: payload.instructorUserId,
    documentNumber: payload.journalNumber,
    topic: payload.topic,
    status: payload.status,
    inviteToken: null,
  });
  (service as any).ensureEmployees = async () => employees;
  (service as any).ensureEmployee = async () => employees[0];
  (service as any).ensureInstructor = async () => ({
    id: "user-instructor-1",
  });
  (service as any).findOne = async (_user: AuthenticatedUser, id: string) => ({
    id,
    departmentId:
      (state.briefingUpdateData[0]?.departmentId as string | null | undefined) ??
      (state.briefingCreateData[0]?.departmentId as string | null | undefined) ??
      null,
    workSiteId:
      (state.briefingUpdateData[0]?.workSiteId as string | null | undefined) ??
      (state.briefingCreateData[0]?.workSiteId as string | null | undefined) ??
      null,
    documentHash: (options?.existingRecord?.documentHash as string | null | undefined) ?? null,
  });
  (service as any).findRawById = async () => options?.existingRecord ?? createExistingRecord();
  (service as any).generateJournalNumber = async () => "DSJ-2026-0001";
  (service as any).ensureJournal = async () => ({ id: "journal-1" });
  (service as any).nextEntryNo = async () => 1;
  (service as any).nextRegistrationNo = async () => "DSJ-2026-0001";
  (service as any).queueSigningArtifacts = async () => undefined;

  return {
    service,
    state,
  };
}

test("briefing create rejects a department from another company", async () => {
  const { service, state } = createService({
    departments: ["department-1"],
  });

  await assert.rejects(
    () =>
      service.create(
        adminUser,
        createInput({
          departmentId: "department-foreign",
        }) as never,
      ),
    (error) => error instanceof BadRequestException,
  );

  assert.equal(state.transactionCalls, 0);
});

test("briefing create accepts same-company employee-derived department and site", async () => {
  const { service, state } = createService({
    employees: [
      createEmployee({
        departmentId: "department-2",
        siteId: "site-2",
      }),
    ],
  });

  const record = await service.create(
    adminUser,
    createInput({
      departmentId: undefined,
      siteId: undefined,
    }) as never,
  );

  assert.equal(state.briefingCreateData.length, 1);
  assert.equal(state.briefingCreateData[0]?.departmentId, "department-2");
  assert.equal(state.briefingCreateData[0]?.workSiteId, "site-2");
  assert.deepEqual(record, {
    id: "record-1",
    departmentId: "department-2",
    workSiteId: "site-2",
    documentHash: null,
  });
});

test("briefing draft can be created before an employee account exists", async () => {
  const { service, state } = createService({
    employees: [
      createEmployee({
        userId: null,
        user: null,
      }),
    ],
  });

  await service.create(adminUser, createInput() as never);

  assert.equal(state.briefingCreateData.length, 1);
  assert.equal(state.briefingCreateData[0]?.status, "DRAFT");
});

test("signing-ready create does not require an employee account", async () => {
  const { service, state } = createService({
    employees: [
      createEmployee({
        userId: null,
        user: null,
      }),
    ],
  });
  let prepareCalls = 0;
  (service as any).prepareForSigning = async () => {
    prepareCalls += 1;
    return {};
  };

  await service.create(
    adminUser,
    createInput({
      status: "SIGNING_READY",
    }) as never,
  );

  assert.equal(state.briefingCreateData.length, 1);
  assert.equal(prepareCalls, 1);
});

test("shop-chief persona scope still rejects employees from another department or site", async () => {
  const { service, state } = createService({
    employees: [
      createEmployee({
        departmentId: "department-2",
        siteId: "site-2",
      }),
    ],
  });
  (service as any).resolvePersonaPolicy = async () => ({
    key: "shop-chief",
    readOnly: false,
    allowedBriefingTypes: ["PRIMARY"],
    scopeDepartmentId: "department-1",
    scopeSiteId: "site-1",
  });

  await assert.rejects(
    () =>
      service.create(
        instructorAdminUser,
        createInput({
          briefingType: "PRIMARY",
        }) as never,
      ),
    /scoped department and site/,
  );

  assert.equal(state.briefingCreateData.length, 0);
});

test("prepare for signing reaches canonical artifacts without an employee account", async () => {
  const employee = createEmployee({
    userId: null,
    user: null,
  });
  const { service, state } = createService({
    employees: [employee],
    existingRecord: createExistingRecord({
      employee,
    }),
  });
  (service as any).resolveScopeRefs = async () => ({
    employees: new Map([["employee-1", employee]]),
    instructors: new Map(),
    departments: new Map(),
    workSites: new Map(),
  });
  let envelopeCalls = 0;
  (service as any).corePlatformService = {
    createDocumentEnvelope: async () => {
      envelopeCalls += 1;
      throw new Error("core-platform-reached");
    },
  };

  await assert.rejects(() => service.prepareForSigning(instructorAdminUser, "record-1"), /core-platform-reached/);

  assert.equal(state.briefingUpdateData.length, 0);
  assert.equal(envelopeCalls, 1);
});

test("active EMPLOYEE_SIGNER account also reaches canonical preparation", async () => {
  const employee = createEmployee();
  const { service } = createService({
    employees: [employee],
    existingRecord: createExistingRecord({
      employee,
    }),
  });
  let envelopeCalls = 0;
  (service as any).resolveScopeRefs = async () => ({
    employees: new Map([["employee-1", employee]]),
    instructors: new Map(),
    departments: new Map(),
    workSites: new Map(),
  });
  (service as any).corePlatformService = {
    createDocumentEnvelope: async () => {
      envelopeCalls += 1;
      throw new Error("core-platform-reached");
    },
  };

  await assert.rejects(() => service.prepareForSigning(instructorAdminUser, "record-1"), /core-platform-reached/);

  assert.equal(envelopeCalls, 1);
});

test("employee briefing details expose documentHash for NCALayer signing", async () => {
  const { service } = createService({
    existingRecord: createExistingRecord({
      documentHash: "digest-employee-1",
    }),
  });

  const record = await service.findOne(employeeUser, "record-1");

  assert.equal((record as { documentHash?: string | null }).documentHash, "digest-employee-1");
});

test("briefing update rejects a carried foreign site reference", async () => {
  const { service, state } = createService({
    existingRecord: createExistingRecord({
      workSiteId: "site-foreign",
    }),
    sites: ["site-1", "site-2"],
  });

  await assert.rejects(
    () =>
      service.update(adminUser, "record-1", {
        topic: "Updated topic",
      } as never),
    (error) => error instanceof BadRequestException,
  );

  assert.equal(state.briefingUpdateData.length, 0);
});

test("briefing update accepts same-company department and site", async () => {
  const { service, state } = createService({
    existingRecord: createExistingRecord(),
  });

  const record = await service.update(adminUser, "record-1", {
    departmentId: "department-2",
    siteId: "site-2",
    topic: "Updated topic",
  } as never);

  assert.equal(state.briefingUpdateData.length, 1);
  assert.equal(state.briefingUpdateData[0]?.departmentId, "department-2");
  assert.equal(state.briefingUpdateData[0]?.workSiteId, "site-2");
  assert.deepEqual(record, {
    id: "record-1",
    departmentId: "department-2",
    workSiteId: "site-2",
    documentHash: "digest-1",
  });
});

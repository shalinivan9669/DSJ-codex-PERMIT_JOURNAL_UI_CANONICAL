import assert from "node:assert/strict";
import { test } from "node:test";
import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { EmployeeComplianceService } from "./employee-compliance.service";
import type { AuthenticatedUser } from "../common/types/authenticated-user.type";

const admin: AuthenticatedUser = {
  userId: "user-a",
  companyId: "company-a",
  email: "admin@example.test",
  fullName: "Synthetic admin",
  role: "COMPANY_ADMIN",
};

test("foreign employee scope is rejected before reading related data or writing", async () => {
  let additionalAccesses = 0;
  const prisma = {
    employee: {
      findUnique: async () => ({ companyId: "company-b" }),
      findFirst: async () => { additionalAccesses++; throw new Error("unexpected read"); },
    },
    $transaction: async () => { additionalAccesses++; throw new Error("unexpected write"); },
  };
  const service = new EmployeeComplianceService(prisma as never, {} as never);
  await assert.rejects(() => service.getCard(admin, "foreign-employee"), ForbiddenException);
  await assert.rejects(() => service.recalculate(admin, "foreign-employee"), ForbiddenException);
  assert.equal(additionalAccesses, 0);
});

test("SUPER_ADMIN can select a company through the employee without a company binding", async () => {
  let requestedCompany: string | undefined;
  const prisma = {
    employee: {
      findUnique: async () => ({ companyId: "company-b" }),
      findFirst: async ({ where }: { where: { companyId: string } }) => {
        requestedCompany = where.companyId;
        return null;
      },
    },
  };
  const service = new EmployeeComplianceService(prisma as never, {} as never);
  await assert.rejects(() => service.getCard({ ...admin, companyId: null, role: "SUPER_ADMIN" }, "employee"), NotFoundException);
  assert.equal(requestedCompany, "company-b");
});

test("organization collision is rejected without modifying the other organization", async () => {
  let writes = 0;
  const tx = {
    company: { findUnique: async () => ({ id: "company-a", name: "A", bin: null, timezone: "Asia/Almaty", isActive: true }) },
    organization: {
      findUnique: async () => ({ id: "company-a", legacyCompanyId: "company-b" }),
      create: async () => { writes++; },
    },
    complianceDocumentType: { upsert: async () => { writes++; } },
  };
  const prisma = {
    employee: {
      findUnique: async () => ({ companyId: "company-a" }),
      findFirst: async () => ({ id: "employee-a", companyId: "company-a", positionId: null }),
    },
    employeeDocument: { findMany: async () => [] },
    protocol: { findMany: async () => [] },
    admissionEvaluation: { findFirst: async () => null },
    briefingJournalEntry: { findMany: async () => [] },
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
  };
  const service = new EmployeeComplianceService(prisma as never, {} as never);
  await assert.rejects(() => service.getCard(admin, "employee-a"), ConflictException);
  assert.equal(writes, 0);
});

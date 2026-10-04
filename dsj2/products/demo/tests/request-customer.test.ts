import test from "node:test";
import assert from "node:assert/strict";
import { draftSchema } from "../packages/contracts/src";
import type { Prisma } from "@demo/database";
import type { Context } from "../apps/api/src/core";
import { submitProposal } from "../apps/api/src/approvals";
import {
  companyEmployerId,
  personCustomerName,
  withCustomerIdentity,
} from "../apps/api/src/request-customer";
import { employerFields, organizationMap } from "../apps/api/src/requests";

const context: Context = {
  tenantId: "synthetic-center",
  userId: "synthetic-operator",
  role: "OPERATOR",
  sessionId: "test",
  csrfHash: "test",
  correlationId: "test",
};
const company = {
  id: "company",
  nameRu: "ТОО Синтетическая компания",
  nameKz: "Синтетикалық компания ЖШС",
  bin: "000000000001",
  addressRu: "Синтетический адрес",
  addressKz: null,
};

function draft(kind: "PERSON" | "COMPANY" = "PERSON") {
  return draftSchema.parse({
    kind,
    title: "Новая заявка",
    schemaVersion: 2,
    profileVersionId: "profile",
    customerId: company.id,
    items: [{ id: "row", fullNameRu: "Синтетический Тестов Тестович" }],
  });
}

test("person customer and title use the supplied name, preserving translations and legacy references", () => {
  const input = draft();
  input.items[0].fullNameKz = "Синтетикалық Тестов";
  const result = withCustomerIdentity(input);
  assert.equal(result.title, input.items[0].fullNameRu);
  assert.equal(personCustomerName(result), input.items[0].fullNameRu);
  assert.equal(result.items[0].fullNameKz, "Синтетикалық Тестов");
  assert.equal(result.customerId, company.id);
  assert.equal(companyEmployerId(result), null);
  assert.equal(input.title, "Новая заявка");
  assert.equal(withCustomerIdentity(draft("COMPANY")).title, "Новая заявка");
});

test("blank person names remain blank and explicitly supplied KZ names are reused without invention", () => {
  const input = draft();
  input.items[0].fullNameRu = "";
  assert.equal(withCustomerIdentity(input).title, "Новая заявка");
  assert.equal(personCustomerName(input), "");
  input.items[0].fullNameKz = "  Синтетикалық Тестов  ";
  assert.equal(withCustomerIdentity(input).title, "Синтетикалық Тестов");
  input.items[0].fullNameKz = "А".repeat(300);
  assert.equal(withCustomerIdentity(input).title.length, 255);
  assert.equal(personCustomerName(input).length, 300);
  assert.doesNotThrow(() => draftSchema.parse(withCustomerIdentity(input)));
});

test("one pinned company supplies all empty employee rows and preserves explicit exceptions", async () => {
  const input = draft("COMPANY");
  input.items.push({ ...input.items[0], id: "second-row" });
  input.organizationSnapshots = [company];
  const noDirectoryReads = new Proxy(
    {},
    {
      get() {
        throw new Error(
          "An approved draft must not read the changed directory",
        );
      },
    },
  ) as Prisma.TransactionClient;
  const organizations = await organizationMap(noDirectoryReads, context, input);
  const employer = organizations.get(companyEmployerId(input)!);
  assert.ok(employer);
  for (const row of input.items) {
    assert.deepEqual(employerFields(row, employer, organizations), {
      workplaceRu: company.nameRu,
      workplaceKz: company.nameKz,
      employerBin: company.bin,
      employerAddressRu: company.addressRu,
      employerAddressKz: company.addressRu,
    });
  }
  const legacy = {
    ...input.items[0],
    workplaceRu: "Историческое место работы",
    workplaceKz: "Тарихи жұмыс орны",
  };
  assert.equal(
    employerFields(legacy, employer, organizations).workplaceRu,
    legacy.workplaceRu,
  );
  assert.equal(
    employerFields(legacy, employer, organizations).workplaceKz,
    legacy.workplaceKz,
  );
  assert.equal(
    employerFields(input.items[0], null, organizations).workplaceRu,
    "",
  );
  assert.equal(
    employerFields(
      { ...input.items[0], employerId: company.id },
      null,
      organizations,
    ).workplaceRu,
    company.nameRu,
  );
});

test("manual employer identity never receives unrelated company BIN or address", () => {
  const row = draft("COMPANY").items[0];
  const organizations = new Map([[company.id, company]]);
  const own = employerFields(
    { ...row, workplaceRu: "Другая организация" },
    company,
    organizations,
  );
  assert.equal(own.workplaceRu, "Другая организация");
  assert.equal(own.employerBin, "");
  assert.equal(own.employerAddressRu, "");
  const matching = employerFields(
    { ...row, workplaceRu: `  ${company.nameRu.toUpperCase()}  ` },
    company,
    organizations,
  );
  assert.equal(matching.employerBin, company.bin);
  assert.equal(matching.employerAddressRu, company.addressRu);
  const linked = employerFields(
    { ...row, employerId: company.id, workplaceRu: "Короткое имя" },
    null,
    organizations,
  );
  assert.equal(linked.employerBin, company.bin);
  const conflict = employerFields(
    {
      ...row,
      employerId: company.id,
      employerBin: "000000000002",
      workplaceRu: company.nameRu,
    },
    company,
    organizations,
  );
  assert.equal(conflict.employerBin, "000000000002");
  assert.equal(conflict.employerAddressRu, "");
  const addressOnly = employerFields(
    { ...row, employerAddressRu: "Введённый адрес неизвестного работодателя" },
    company,
    organizations,
  );
  assert.equal(addressOnly.workplaceRu, "");
  assert.equal(addressOnly.employerBin, "");
  assert.equal(
    addressOnly.employerAddressRu,
    "Введённый адрес неизвестного работодателя",
  );
});

test("autosave persists the person title and working data without submitting director review", async () => {
  const input = draft();
  const approvedDraft = draftSchema.parse({ kind: "PERSON", items: [] });
  const record = {
    id: "request",
    tenantId: context.tenantId,
    status: "DRAFT",
    draft: approvedDraft,
    revision: 0,
    workingRevision: 0,
    archivedAt: null,
  };
  let proposed: Record<string, unknown> | null = null;
  let requestUpdate: Record<string, unknown> = {};
  const tx = {
    $executeRaw: async () => 1,
    printRequest: {
      findFirst: async () => record,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        requestUpdate = data;
        Object.assign(record, data);
        return record;
      },
    },
    requestProposal: {
      findFirst: async ({ where }: { where: { status?: unknown } }) =>
        where.status && proposed?.status === "DRAFT" ? null : proposed,
      findMany: async () => [],
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        proposed = { ...data, id: "proposal" };
        return proposed;
      },
    },
    customerOrganization: {
      findFirst: async () => company,
      count: async () => 0,
      findMany: async () => [company],
    },
    issuanceAssignment: { findMany: async () => [] },
    requestItem: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 1 }),
    },
    recipient: { count: async () => 0 },
    issuerProfileVersion: { count: async () => 1 },
    serviceRuleVersion: { count: async () => 0 },
    photoAsset: { count: async () => 0 },
    auditEvent: { create: async () => ({}) },
  } as unknown as Prisma.TransactionClient;
  const result = await submitProposal(tx, context, record.id, input, 0);
  const payload = (proposed as unknown as { payload: typeof input }).payload;
  assert.equal(payload.title, input.items[0].fullNameRu);
  assert.equal(result.title, input.items[0].fullNameRu);
  assert.equal(result.customerName, input.items[0].fullNameRu);
  assert.deepEqual(payload.organizationSnapshots, [company]);
  assert.deepEqual(record.draft, payload);
  assert.equal(requestUpdate.workingRevision, 1);
  assert.equal(requestUpdate.revision, 1);
  assert.equal(proposed!.status, "DRAFT");
  assert.equal(result.approval, null);
});

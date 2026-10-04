import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertTestDatabase } from "./test-database";
import { db, type Context } from "../../apps/api/src/core";
import { provision } from "../../scripts/setup";
import { saveProfile, saveUser } from "../../apps/api/src/settings";
import { decideProposal } from "../../apps/api/src/approvals";
import {
  createRequest,
  patchRequest,
  requestDetail,
  validateRequest,
  finalize,
} from "../../apps/api/src/requests";
import { draftSchema } from "../../packages/contracts/src";
import {
  newRequestBundle,
  recipientForRequest,
} from "../../apps/web/lib/request-bundles";
import { editTrainingAssignment } from "../../apps/web/lib/training-assignment-edit";
import { newRecipient } from "../../apps/web/lib/types";

test("manager and director prepare worker and ITR bundles for 1/3/100/250 people with individual or shared protocols", async (t) => {
  assertTestDatabase();
  assert.notEqual(
    new URL(process.env.DATABASE_URL!).pathname,
    "/demo_test_operator_browser",
    "suite must not use the browser database",
  );
  const seeded = await provision({
    email: `forms-ux-${randomUUID()}@example.test`,
    password: "Synthetic-Forms-UX-Password!",
    name: "Проверка комплектов",
    sample: true,
  });
  const context: Context = {
    ...seeded,
    role: "DIRECTOR",
    sessionId: "test",
    csrfHash: "test",
    correlationId: randomUUID(),
  };
  const profile = await db.issuerProfileVersion.findFirstOrThrow({
    where: { tenantId: context.tenantId },
    orderBy: { version: "desc" },
  });
  await saveProfile(context, {
    ...(profile.profile as object),
    headName: "Синтетический Руководитель",
    bin: "000000000002",
    cityRu: "Тестовый город",
    commission: Array.from({ length: 3 }, (_, i) => ({
      name: `Синтетический Член ${i}`,
      position: "Член комиссии",
    })),
  });
  const operator = await saveUser(context, {
    email: `forms-manager-${randomUUID()}@example.test`,
    password: "Synthetic-Forms-Manager-Password!",
    displayName: "Синтетический менеджер комплектов",
    role: "OPERATOR",
  });
  const manager: Context = {
    ...context,
    userId: operator.id,
    role: "OPERATOR",
  };
  assert.equal(
    await db.user.count({ where: { tenantId: context.tenantId } }),
    2,
  );
  for (const category of ["WORKER", "ITR"] as const)
    for (const count of [1, 3, 100, 250])
      await t.test(`${category}: ${count}`, async () => {
        const seed = newRequestBundle(category);
        const draft = draftSchema.parse({
          kind: "PERSON",
          title: `Комплект ${category} ${count}`,
          schemaVersion: 2,
          demoMode: true,
          commonFields: { documentDate: "2026-09-25" },
          // The manager explicitly assigns this course to subsequent people.
          // Existing courses alone do not make newly added people participants.
          trainingDefaults: [
            { direction: "BIOT", eventIds: [seed.events[0].id] },
          ],
          ...seed,
        });
        Object.assign(draft.events![0].commonFields, {
          trainingStart: "2026-09-21",
          trainingEnd: "2026-09-24",
          protocolDate: "2026-09-24",
          trainingSubject: "Синтетическая программа БиОТ",
          biotIndustryRu: "Синтетическая отрасль",
          biotIndustryKz: "Сынақ саласы",
        });
        while (draft.items.length < count)
          draft.items.push(
            recipientForRequest(draft, {
              ...newRecipient(),
              employeeCategory: category,
              assignments: [],
            }),
          );
        draft.items.forEach((item, index) => {
          Object.assign(item, {
            fullNameRu: `Тестовый Получатель ${String(index + 1).padStart(3, "0")}`,
            fullNameKz: `Әділ Өмір Қасымұлы ${String(index + 1).padStart(3, "0")}`,
            positionRu: "Инженер",
            positionKz: "Маман",
            workplaceRu: "ТОО «Испытание»",
            workplaceKz: "«Сынақ» ЖШС",
            employerBin: "000000000001",
            employerAddressRu: "Тестовый адрес",
            employerAddressKz: "Сынақ мекенжайы",
          });
          Object.assign(
            item,
            editTrainingAssignment(
              item,
              item.assignments[0].id,
              {
                result: "Сдал",
                outcome: {
                  status: "PASSED",
                  source: "Синтетическая тестовая ведомость",
                },
                biotKnowledgeResult: "80%",
                biotProctoringResult: "Синтетический подтверждённый результат",
              },
              true,
            ),
          );
        });
        const before = await db.numberReservation.count({
          where: { tenantId: context.tenantId },
        });
        const created = await createRequest(manager, draft);
        const saved = await patchRequest(manager, created.id, {
          expectedRevision: created.revision,
          draft,
        });
        const reloaded = await requestDetail(manager, created.id);
        assert.equal(reloaded.events?.length, 1);
        assert.equal(reloaded.items.length, count);
        assert.ok(
          reloaded.items.every(
            (item) => item.assignments.length === (count === 1 ? 2 : 1),
          ),
        );
        assert.equal(
          await db.numberReservation.count({
            where: { tenantId: context.tenantId },
          }),
          before,
        );
        const checked = await validateRequest(manager, created.id, {
          expectedRevision: saved.revision,
        });
        assert.deepEqual(checked.issues, []);
        assert.equal(checked.documentCount, count + 1);
        await decideProposal(context, saved.approval.proposalId, {
          decision: "APPROVE",
          reason: "Синтетическая проверка массового комплекта",
          expectedProposalHash: saved.approval.proposalHash,
        });
        const approved = await requestDetail(manager, created.id);
        const key = randomUUID();
        const issued = await finalize(
          manager,
          created.id,
          { expectedRevision: approved.revision },
          key,
        );
        assert.deepEqual(
          await finalize(
            manager,
            created.id,
            { expectedRevision: approved.revision },
            key,
          ),
          issued,
        );
        const documents = await db.issuedDocument.findMany({
          where: { requestId: created.id },
        });
        assert.equal(documents.length, count + 1);
        const protocols = documents.filter((document) =>
          document.templateId.endsWith("-protocol"),
        );
        assert.equal(protocols.length, 1);
        assert.equal(protocols[0].ownerKind === "GROUP", count > 1);
        assert.equal(
          protocols[0].templateId,
          category === "WORKER" ? "biot-protocol" : "biot-itr-protocol",
        );
        assert.equal(
          new Set(
            documents
              .filter((document) => !document.templateId.endsWith("-protocol"))
              .map((document) => document.number),
          ).size,
          count,
        );
        const members = await db.groupDocumentMember.findMany({
          where: { documentId: protocols[0].id },
          orderBy: { position: "asc" },
        });
        assert.equal(members.length, count > 1 ? count : 0);
        const snapshots = await db.renderInputSnapshot.findMany({
          where: {
            requestId: created.id,
            issuanceId: { not: null },
            templateVersionId: { not: null },
          },
        });
        const group = snapshots
          .map((snapshot) => snapshot.input as any)
          .find((input) => input.groupEvent);
        if (count > 1)
          assert.deepEqual(
            group.items.map((item: any) => item.fullNameRu),
            draft.items.map((item) => item.fullNameRu),
          );
        else assert.equal(group, undefined);
        for (const input of snapshots
          .map((snapshot) => snapshot.input as any)
          .filter((input) => !input.groupEvent)) {
          assert.equal(input.items[0].protocolNumber, protocols[0].number);
          assert.equal(
            input.items[0].assignment.documentDate,
            input.templateId.endsWith("-protocol")
              ? "2026-09-24"
              : "2026-09-25",
          );
        }
        assert.equal(
          await db.numberReservation.count({
            where: { tenantId: context.tenantId },
          }),
          before + count + 1,
        );
      });
  await db.$disconnect();
});

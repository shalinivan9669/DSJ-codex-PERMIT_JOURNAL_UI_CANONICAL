import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { provision } from "../../scripts/setup";
import { db, type Context } from "../../apps/api/src/core";
import { saveCustomer } from "../../apps/api/src/settings";
import { createRequest, finalize, preview } from "../../apps/api/src/requests";
import { collectRegistryRows } from "../../apps/api/src/files";
import { draftSchema } from "../../packages/contracts/src";
import { assertTestDatabase } from "./test-database";
import { createApprovalFixture } from "./live-approval-fixture";

test("mixed PB groups keep their members and allocated protocol numbers across approval, preview, issuance and retry", async () => {
  assertTestDatabase();
  const seed = await provision({
    email: `pb-groups-${randomUUID()}@example.test`,
    password: "Synthetic-Group-Test!",
    name: "Synthetic PB test",
    sample: true,
  });
  await db.user.update({
    where: { id: seed.userId },
    data: { role: "SUPER_ADMIN" },
  });
  const c: Context = {
    ...seed,
    role: "SUPER_ADMIN",
    correlationId: randomUUID(),
    sessionId: "test",
    csrfHash: "test",
  };
  const approval = await createApprovalFixture(c);
  try {
    const customer = await saveCustomer(c, {
      nameRu: "Синтетическая компания",
      nameKz: "Синтетикалық компания",
    });
    const eventId = randomUUID();
    const draft = draftSchema.parse({
      kind: "COMPANY",
      schemaVersion: 2,
      businessRuleVersion: "LIVE_V1",
      demoMode: true,
      customerId: customer.id,
      events: [
        {
          id: eventId,
          title: "ПБ",
          protocolTemplateId: "pb-protocol",
          protocolMode: "GROUP",
          commonFields: {
            documentDate: "2026-11-17",
            protocolDate: "2026-11-17",
            trainingStart: "2026-11-01",
            trainingEnd: "2026-11-16",
            trainingSubject: "Синтетическая программа",
          },
        },
      ],
      items: [
        {
          id: "worker",
          fullNameRu: "Синтетический Рабочий",
          positionRu: "Рабочий",
          employeeCategory: "WORKER",
        },
        {
          id: "engineer",
          fullNameRu: "Синтетический Инженер",
          positionRu: "Инженер",
          employeeCategory: "ITR",
        },
        {
          id: "failed-worker",
          fullNameRu: "Синтетический Не Сдавший",
          positionRu: "Рабочий",
          employeeCategory: "WORKER",
        },
      ].map((item) => ({
        ...item,
        assignments: [
          {
            id: `assignment-${item.id}`,
            templateId: "pb-card",
            eventId,
            protocolMode: "GROUP",
            outcome: {
              status: item.id === "failed-worker" ? "FAILED" : "PASSED",
              source: "Синтетическая ведомость",
            },
          },
        ],
      })),
    });
    const request = await createRequest(c, draft);
    await assert.rejects(
      preview(c, request.id, {
        expectedRevision: request.revision,
        target: { kind: "GROUP_PROTOCOL", eventId },
      }),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "getResponse" in error &&
        (error as { getResponse(): { code: string } }).getResponse().code ===
          "PREVIEW_GROUP_REQUIRED",
    );
    for (const rowId of ["worker", "engineer"]) {
      const jobs = await preview(c, request.id, {
        expectedRevision: request.revision,
        target: { kind: "GROUP_PROTOCOL", eventId, memberRowId: rowId },
      });
      const snapshotIds = [
        ...new Set(
          jobs.jobs.map((job: { snapshotId: string }) => job.snapshotId),
        ),
      ];
      const snapshots = await db.renderInputSnapshot.findMany({
        where: { id: { in: snapshotIds } },
      });
      assert.equal(snapshots.length, 1);
      const input = snapshots[0].input as {
        items: { id: string; assignment: { hours: string } }[];
      };
      assert.deepEqual(
        input.items.map((item) => [item.id, item.assignment.hours]),
        rowId === "worker"
          ? [
              ["worker", "10"],
              ["failed-worker", "10"],
            ]
          : [["engineer", "40"]],
      );
    }
    await approval.approve(request.id);
    const key = randomUUID();
    const result = (await finalize(
      c,
      request.id,
      { expectedRevision: request.revision },
      key,
    )) as { issuanceId: string };
    assert.deepEqual(
      await finalize(
        c,
        request.id,
        { expectedRevision: request.revision },
        key,
      ),
      result,
    );
    assert.deepEqual(
      await finalize(
        c,
        request.id,
        { expectedRevision: request.revision },
        randomUUID(),
      ),
      result,
    );
    const docs = await db.issuedDocument.findMany({
      where: { issuanceId: result.issuanceId },
    });
    const groups = docs.filter((d) => d.templateId === "pb-protocol");
    assert.equal(groups.length, 2);
    assert.equal(new Set(groups.map((d) => d.number)).size, 2);
    assert.ok(groups.every((d) => d.groupEventId === eventId));
    const members = await db.groupDocumentMember.findMany({
      where: { documentId: { in: groups.map((d) => d.id) } },
    });
    assert.equal(members.length, 3);
    const snapshots = await db.renderInputSnapshot.findMany({
      where: { issuanceId: result.issuanceId },
    });
    for (const rowId of ["worker", "engineer"]) {
      const member = members.find((m) => m.rowId === rowId)!;
      const group = groups.find((d) => d.id === member.documentId)!;
      const card = docs.find(
        (d) => d.rowId === rowId && d.templateId === "pb-card",
      )!;
      const expectedHours = rowId === "worker" ? "10" : "40";
      const groupInput = snapshots
        .map(
          (s) =>
            s.input as {
              templateId?: string;
              items?: {
                id?: string;
                documentId?: string;
                assignment?: { hours?: string };
                protocolNumber?: string;
              }[];
            },
        )
        .find(
          (input) =>
            input.templateId === "pb-protocol" &&
            input.items?.some((item) => item.documentId === group.id),
        )!;
      assert.deepEqual(
        groupInput.items?.map((item) => [
          item.id,
          item.assignment?.hours,
          item.protocolNumber,
        ]),
        rowId === "worker"
          ? [
              ["worker", expectedHours, group.number],
              ["failed-worker", expectedHours, group.number],
            ]
          : [[rowId, expectedHours, group.number]],
      );
      const cardInput = snapshots
        .map(
          (s) =>
            s.input as {
              templateId?: string;
              items?: {
                documentId?: string;
                linkedProtocolDocumentId?: string;
                protocolNumber?: string;
              }[];
            },
        )
        .find(
          (input) =>
            input.templateId === "pb-card" &&
            input.items?.some((item) => item.documentId === card.id),
        )!;
      assert.equal(cardInput.items![0].linkedProtocolDocumentId, group.id);
      assert.equal(cardInput.items![0].protocolNumber, group.number);
    }
    assert.equal(
      await db.issuance.count({ where: { requestId: request.id } }),
      1,
    );
    assert.equal(
      await db.issuedDocument.count({
        where: { issuanceId: result.issuanceId },
      }),
      4,
    );
    // Synthetic registry fixture only: this status lets the registry read the
    // frozen issuance; it does not claim that a CMS was signed or verified.
    await db.issuanceWorkflow.update({
      where: {
        tenantId_issuanceId: {
          tenantId: c.tenantId,
          issuanceId: result.issuanceId,
        },
      },
      data: { status: "ISSUED", completedAt: new Date() },
    });
    const registry = await collectRegistryRows(c, {}, request.id);
    const failedMember = members.find(
      (member) => member.rowId === "failed-worker",
    )!;
    const failedGroup = groups.find(
      (group) => group.id === failedMember.documentId,
    )!;
    const failedRow = registry.rows.find((row) => row.id === "failed-worker")!;
    assert.equal(failedRow.documentId, undefined);
    assert.equal(failedRow.protocolDocumentId, failedGroup.id);
    assert.equal(failedRow.protocolNumber, failedGroup.number);
  } finally {
    await approval.close();
    await db.$disconnect();
  }
});

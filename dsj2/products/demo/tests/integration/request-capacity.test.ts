import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertTestDatabase } from "./test-database";
import { db, type Context } from "../../apps/api/src/core";
import { provision } from "../../scripts/setup";
import { saveUser } from "../../apps/api/src/settings";
import {
  createRequest,
  patchRequest,
  requestDetail,
} from "../../apps/api/src/requests";
import { importPreview, applyImport } from "../../apps/api/src/files";
import { draftSchema, itemSchema, LIMITS } from "../../packages/contracts/src";

test("250 imported recipients save/reload in PostgreSQL; 251 is rejected without partial writes", async () => {
  assertTestDatabase();
  const who = await provision({
    email: `capacity-${randomUUID()}@example.test`,
    password: "Capacity-Test-Only-Password!",
    name: "Synthetic capacity test",
    sample: true,
  });
  const director: Context = {
    ...who,
    role: "DIRECTOR",
    sessionId: "capacity-test",
    csrfHash: "capacity-test",
    correlationId: randomUUID(),
  };
  const manager = await saveUser(director, {
    email: `capacity-manager-${randomUUID()}@example.test`,
    password: "Synthetic-Capacity-Manager-Password!",
    displayName: "Синтетический менеджер импорта",
    role: "OPERATOR",
  });
  const context: Context = {
    ...director,
    role: "OPERATOR",
    userId: manager.id,
  };
  try {
    const csv = Buffer.from(
      "fullNameRu,fullNameKz,personnelNumber,externalId\r\n" +
        Array.from(
          { length: 250 },
          (_, index) =>
            `Слушатель ${index + 1},Қатысушы ${index + 1},${String(index + 1).padStart(6, "0")},person-${index + 1}`,
        ).join("\r\n"),
    );
    const upload = (buffer: Buffer, originalname: string) =>
      ({
        buffer,
        size: buffer.length,
        originalname,
      }) as Express.Multer.File;
    const preview = await importPreview(context, upload(csv, "250.csv"));
    assert.equal(preview.total, 250);
    assert.equal(preview.canApply, true);
    const rows = preview.rows.map((row) =>
      itemSchema.parse({
        id: `row-${row.sourceRow}`,
        fullNameRu: row.values[0],
        fullNameKz: row.values[1],
        personnelNumber: row.values[2],
        externalId: row.values[3],
        sourceRow: row.sourceRow,
        importId: preview.importId,
      }),
    );
    const created = await createRequest(context, {
      kind: "COMPANY",
      schemaVersion: 2,
      businessRuleVersion: "LIVE_V1",
      items: [
        itemSchema.parse({ id: "empty-starter", employeeCategory: "WORKER" }),
      ],
    });
    const imported = await applyImport(context, created.id, {
      expectedRevision: created.revision,
      importId: preview.importId,
      rows,
    });
    assert.equal(imported.items.length, 250);
    assert.equal(
      imported.items.some((row) => row.id === "empty-starter"),
      false,
    );
    assert.equal(imported.items[249].personnelNumber, "000250");
    assert.equal(
      await db.requestItem.count({ where: { requestId: created.id } }),
      250,
      "autosave durably stores every imported working row before review",
    );
    assert.equal(
      (await db.printRequest.findUniqueOrThrow({ where: { id: created.id } }))
        .itemCount,
      250,
      "the working container retains the complete imported composition",
    );
    const working = await requestDetail(context, created.id);
    assert.equal(
      working.approvedProposalId,
      null,
      "import does not create a director decision",
    );
    assert.equal(working.approvedRevision, 0);
    assert.equal(
      working.approval,
      null,
      "unsubmitted import stays out of the pending queue",
    );
    assert.equal(
      await db.proposalDecision.count({
        where: { tenantId: context.tenantId },
      }),
      0,
    );
    assert.equal(
      await db.issuance.count({ where: { requestId: created.id } }),
      0,
    );
    assert.equal(
      await db.numberReservation.count({
        where: { tenantId: context.tenantId },
      }),
      0,
    );
    const draft = draftSchema.parse({ kind: "COMPANY", items: imported.items });
    draft.items[249].positionRu = "Последний инженер";
    const body = { expectedRevision: imported.revision, draft };
    assert.ok(Buffer.byteLength(JSON.stringify(body)) < LIMITS.jsonBytes);
    const saved = await patchRequest(context, created.id, body);
    const reloaded = await requestDetail(context, created.id);
    assert.equal(reloaded.items.length, 250);
    assert.equal(reloaded.items[249].positionRu, "Последний инженер");
    assert.deepEqual(
      reloaded.items.map((row) => row.id),
      rows.map((row) => row.id),
    );
    const tooMany = {
      ...draft,
      items: [...draft.items, itemSchema.parse({ id: "row-251" })],
    };
    await assert.rejects(createRequest(context, tooMany));
    await assert.rejects(
      patchRequest(context, created.id, {
        expectedRevision: saved.revision,
        draft: tooMany,
      }),
    );
    await assert.rejects(
      db.printRequest.update({
        where: { id: created.id },
        data: { itemCount: 251 },
      }),
    );
    const afterRejections = await requestDetail(context, created.id);
    assert.equal(afterRejections.revision, saved.revision);
    assert.equal(afterRejections.items.length, 250);
    assert.equal(afterRejections.items[249].positionRu, "Последний инженер");
    const overflow = await importPreview(
      context,
      upload(
        Buffer.concat([csv, Buffer.from("\r\nЛишний,Артық,000251,person-251")]),
        "251.csv",
      ),
    );
    assert.equal(overflow.total, 251);
    assert.equal(overflow.canApply, false);
    assert.ok(
      (
        overflow.errors as { code: string; count: number; limit: number }[]
      ).some(
        (error) =>
          error.code === "ROW_LIMIT" &&
          error.count === 251 &&
          error.limit === 250,
      ),
    );
    assert.equal(
      overflow.rows[250].values[2],
      "000251",
      "overflow source must remain visible, never silently truncated",
    );
  } finally {
    await db.$disconnect();
  }
});

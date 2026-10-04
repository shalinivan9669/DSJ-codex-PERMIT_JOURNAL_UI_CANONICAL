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
import { applyImport, importPreview } from "../../apps/api/src/files";
import {
  draftSchema,
  itemSchema,
  type RequestItemInput,
} from "../../packages/contracts/src";

const rejectsWithCode = (code: string) => (error: unknown) => {
  assert.ok(error && typeof error === "object" && "getResponse" in error);
  const response = (error as { getResponse(): { code: string } }).getResponse();
  assert.equal(response.code, code);
  return true;
};

test("import replaces only an untouched live starter atomically and preserves existing recipients", async (t) => {
  assertTestDatabase();
  const who = await provision({
    email: `import-scaffold-${randomUUID()}@example.test`,
    password: "Synthetic-Import-Only-Password!",
    name: "Synthetic import scaffold test",
    sample: true,
  });
  const director: Context = {
    ...who,
    role: "DIRECTOR",
    sessionId: "import-scaffold",
    csrfHash: "import-scaffold",
    correlationId: randomUUID(),
  };
  const user = await saveUser(director, {
    email: `import-manager-${randomUUID()}@example.test`,
    password: "Synthetic-Import-Manager-Password!",
    displayName: "Менеджер импорта",
    role: "OPERATOR",
  });
  const context: Context = { ...director, userId: user.id, role: "OPERATOR" };
  const starter = itemSchema.parse({
    id: "empty-starter",
    employeeCategory: "WORKER",
  });
  const liveDraft = (items: RequestItemInput[] = [starter]) =>
    draftSchema.parse({
      kind: "COMPANY",
      schemaVersion: 2,
      businessRuleVersion: "LIVE_V1",
      items,
    });
  try {
    const buffer = Buffer.from(
      "fullNameRu,positionRu\r\n" +
        Array.from(
          { length: 250 },
          (_, i) => `Импорт ${i + 1},Инженер ${i + 1}`,
        ).join("\r\n"),
    );
    const preview = await importPreview(context, {
      buffer,
      size: buffer.length,
      originalname: "people.csv",
    } as Express.Multer.File);
    const rows = preview.rows.map((row) =>
      itemSchema.parse({
        id: `source-${row.sourceRow}`,
        importId: preview.importId,
        sourceRow: row.sourceRow,
        fullNameRu: row.values[0],
        positionRu: row.values[1],
      }),
    );
    const apply = (
      id: string,
      expectedRevision: number,
      selected = rows.slice(0, 100),
    ) =>
      applyImport(context, id, {
        expectedRevision,
        importId: preview.importId,
        rows: selected,
      });

    await t.test(
      "100 source rows replace one scaffold and persist one working revision without review",
      async () => {
        const created = await createRequest(context, liveDraft());
        const imported = await apply(created.id, created.revision);
        assert.equal(imported.items.length, 100);
        assert.deepEqual(
          imported.items.map((row) => row.id),
          rows.slice(0, 100).map((row) => row.id),
        );
        assert.ok(imported.items.every((row) => row.assignments.length === 0));
        const repeated = await apply(created.id, imported.revision);
        assert.equal(repeated.revision, imported.revision);
        assert.equal(repeated.items.length, 100);
        assert.equal(repeated.importResult.repeated, true);
        assert.equal(
          (
            await db.printRequest.findUniqueOrThrow({
              where: { id: created.id },
            })
          ).itemCount,
          100,
        );
        assert.equal(
          await db.requestItem.count({ where: { requestId: created.id } }),
          100,
        );
      },
    );

    await t.test(
      "partial rows, explicit category, import metadata and existing training are preserved",
      async () => {
        for (const partial of [
          { ...starter, fullNameKz: "Қатысушы" },
          { ...starter, employeeCategory: "ITR" as const },
          { ...starter, personnelNumber: "000001" },
          { ...starter, importId: "earlier-import", sourceRow: 2 },
          { ...starter, employerBin: "" },
          itemSchema.parse({
            ...starter,
            assignments: [{ id: "training", templateId: "ptm-card" }],
          }),
        ]) {
          const created = await createRequest(context, liveDraft([partial]));
          const imported = await apply(
            created.id,
            created.revision,
            rows.slice(0, 1),
          );
          assert.equal(imported.items.length, 2);
          assert.equal(imported.items[0].id, starter.id);
        }
      },
    );

    await t.test(
      "legacy rows and previously edited then cleared rows are retained",
      async () => {
        const legacy = await createRequest(context, {
          kind: "COMPANY",
          items: [starter],
        });
        assert.equal(
          (await apply(legacy.id, legacy.revision, rows.slice(0, 1))).items
            .length,
          2,
        );
        const created = await createRequest(
          context,
          liveDraft([{ ...starter, fullNameRu: "Бывшее значение" }]),
        );
        const cleared = await patchRequest(context, created.id, {
          expectedRevision: created.revision,
          draft: liveDraft(),
        });
        assert.equal(
          (await apply(created.id, cleared.revision, rows.slice(0, 1))).items
            .length,
          2,
        );
      },
    );

    await t.test(
      "250 imported people preserve a real retained row in the same 251-person request",
      async () => {
        const created = await createRequest(
          context,
          liveDraft([{ ...starter, fullNameRu: "Сохранить" }]),
        );
        const before = await db.requestProposal.count({
          where: { requestId: created.id },
        });
        await apply(created.id, created.revision, rows);
        const after = await requestDetail(context, created.id);
        assert.equal(after.revision, created.revision + 1);
        assert.equal(after.items.length, 251);
        assert.equal(after.items[0].fullNameRu, "Сохранить");
        assert.equal(
          await db.requestProposal.count({ where: { requestId: created.id } }),
          before + 1,
        );
      },
    );

    await t.test(
      "stale revision and invalid provenance cannot remove a starter",
      async () => {
        const created = await createRequest(context, liveDraft());
        const updated = await patchRequest(context, created.id, {
          expectedRevision: created.revision,
          draft: { ...liveDraft(), title: "Параллельная правка" },
        });
        const before = await db.requestProposal.count({
          where: { requestId: created.id },
        });
        await assert.rejects(
          apply(created.id, created.revision),
          rejectsWithCode("REVISION_CONFLICT"),
        );
        await assert.rejects(
          apply(created.id, updated.revision, [
            { ...rows[0], sourceRow: 9999 },
          ]),
          rejectsWithCode("IMPORT_SOURCE"),
        );
        const after = await requestDetail(context, created.id);
        assert.equal(after.revision, updated.revision);
        assert.equal(after.items[0].id, starter.id);
        assert.equal(after.title, "Параллельная правка");
        assert.equal(
          await db.requestProposal.count({ where: { requestId: created.id } }),
          before,
        );
      },
    );

    await t.test("empty selection retains the starter", async () => {
      const created = await createRequest(context, liveDraft());
      const imported = await apply(created.id, created.revision, []);
      assert.equal(imported.items.length, 1);
      assert.equal(imported.items[0].id, starter.id);
    });
  } finally {
    await db.$disconnect();
  }
});

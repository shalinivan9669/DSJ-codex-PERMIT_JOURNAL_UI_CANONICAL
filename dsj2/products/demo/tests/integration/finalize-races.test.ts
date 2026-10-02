import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, json, type Context } from "../../apps/api/src/core";
import {
  createRequest,
  finalize,
  patchRequest,
  validateRequest,
} from "../../apps/api/src/requests";
import { saveProfile } from "../../apps/api/src/settings";
import { draftSchema, type Draft } from "../../packages/contracts/src";
import { AutosaveLane } from "../../apps/web/lib/autosave";
import { provision } from "../../scripts/setup";
import { assertTestDatabase } from "./test-database";
import { createApprovalFixture } from "./live-approval-fixture";
import { workingRequest } from "../../apps/api/src/approvals";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function code(expected: string) {
  return (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    "getResponse" in error &&
    (error as { getResponse(): { code: string } }).getResponse().code ===
      expected;
}
function fixture(): Draft {
  const eventId = randomUUID();
  return draftSchema.parse({
    schemaVersion: 2,
    kind: "PERSON",
    demoMode: true,
    events: [
      {
        id: eventId,
        title: "Синтетическая проверка гонки",
        protocolTemplateId: "pb-protocol",
        commonFields: {
          documentDate: "2026-09-24",
          protocolDate: "2026-09-24",
          trainingStart: "2026-09-23",
          trainingEnd: "2026-09-24",
          trainingSubject: "Синтетическая программа",
        },
      },
    ],
    items: [
      {
        id: randomUUID(),
        fullNameRu: "Синтетический Слушатель",
        fullNameKz: "Әділ Өмір",
        positionRu: "Инженер",
        assignments: [
          {
            id: randomUUID(),
            templateId: "pb-card",
            eventId,
            result: "Сдал",
            protocolMode: "GROUP",
            outcome: {
              status: "PASSED",
              source: "Синтетическая подтверждённая ведомость",
            },
          },
        ],
      },
    ],
  });
}

test("AT135/AT136 controlled real database races preserve autosave revision and reject changed preflight inputs", async (t) => {
  assertTestDatabase();
  const seed = await provision({
    email: `race-${randomUUID()}@example.test`,
    password: "Synthetic-Race-Password!",
    name: "Синтетический центр гонок",
    sample: true,
  });
  const c: Context = {
    ...seed,
    role: "ADMIN",
    sessionId: "test",
    csrfHash: "test",
    correlationId: randomUUID(),
  };
  const secondUser = await db.user.create({
    data: {
      tenantId: c.tenantId,
      email: `race-second-${randomUUID()}@example.test`,
      passwordHash: "unused",
      displayName: "Вторая сессия",
      role: "OPERATOR",
    },
  });
  const second = { ...c, userId: secondUser.id, role: "OPERATOR" };
  const approvals = await createApprovalFixture(c).catch(async (error) => {
    await db.$disconnect();
    throw error;
  });
  try {
    await t.test(
      "AT135 last typed characters remain dirty after a competing session saves; successful flush finalizes exact acknowledged revision",
      async () => {
        const input = fixture();
        const request = await createRequest(c, input);
        await approvals.approve(request.id);
        const local = structuredClone(input);
        local.items[0].fullNameRu += " Последние символы ЯӘ";
        const captured = gate(),
          continueSave = gate();
        const lane = new AutosaveLane<Draft>(
          input,
          request.revision,
          async (draft, revision) => {
            assert.equal(draft.items[0].fullNameRu, local.items[0].fullNameRu);
            captured.release();
            await continueSave.promise;
            return patchRequest(c, request.id, {
              expectedRevision: revision,
              draft,
            });
          },
          () => undefined,
        );
        lane.edit(local);
        const attempt = (async () =>
          finalize(
            c,
            request.id,
            { expectedRevision: await lane.flush() },
            randomUUID(),
          ))();
        // Attach the rejection assertion before permitting the deferred save to run.
        const conflict = assert.rejects(attempt, code("REVISION_CONFLICT"));
        await captured.promise;
        const other = structuredClone(input);
        other.items[0].positionRu = "Изменение второй сессии";
        await patchRequest(second, request.id, {
          expectedRevision: request.revision,
          draft: other,
        });
        continueSave.release();
        await conflict;
        assert.equal(lane.dirty, true);
        assert.equal(lane.currentRevision, request.revision);
        const afterConflict = await workingRequest(c, request.id);
        assert.equal(
          draftSchema.parse(afterConflict.draft).items[0].positionRu,
          other.items[0].positionRu,
        );
        assert.equal(afterConflict.revision, request.revision + 1);
        assert.equal(
          (
            await db.printRequest.findUniqueOrThrow({
              where: { id: request.id },
            })
          ).revision,
          request.revision,
          "Unapproved competing edits must not change the approved revision",
        );
        assert.equal(
          await db.issuance.count({ where: { requestId: request.id } }),
          0,
        );
        const confirmed = draftSchema.parse(afterConflict.draft);
        confirmed.items[0].fullNameRu = local.items[0].fullNameRu;
        const freshLane = new AutosaveLane<Draft>(
          confirmed,
          afterConflict.revision,
          (draft, revision) =>
            patchRequest(c, request.id, { expectedRevision: revision, draft }),
          () => undefined,
        );
        freshLane.edit(confirmed);
        const expectedRevision = await freshLane.flush();
        await approvals.approve(request.id);
        assert.deepEqual(
          (await validateRequest(c, request.id, { expectedRevision })).issues,
          [],
        );
        const result = await finalize(
          c,
          request.id,
          { expectedRevision },
          randomUUID(),
        );
        const issuance = await db.issuance.findUniqueOrThrow({
          where: { id: result.issuanceId },
        });
        const saved = draftSchema.parse(
          (issuance.snapshot as { draft: unknown }).draft,
        );
        assert.equal(issuance.sourceRevision, request.revision + 2);
        assert.equal(saved.items[0].fullNameRu, local.items[0].fullNameRu);
        assert.equal(saved.items[0].positionRu, other.items[0].positionRu);
        assert.equal(freshLane.dirty, false);
      },
    );

    await t.test(
      "AT136 a template change after real geometry preflight blocks commit; retry uses the new template and the explicitly pinned profile",
      async () => {
        const request = await createRequest(c, fixture());
        await approvals.approve(request.id);
        const savedRequest = await db.printRequest.findUniqueOrThrow({
          where: { id: request.id },
        });
        const pinnedProfileId = draftSchema.parse(
          savedRequest.draft,
        ).profileVersionId;
        const pinnedProfile = await db.issuerProfileVersion.findUniqueOrThrow({
          where: { id: pinnedProfileId! },
        });
        const originalTemplate = await db.templateVersion.findFirstOrThrow({
          where: { tenantId: c.tenantId, templateId: "pb-card" },
          orderBy: { createdAt: "desc" },
        });
        const sequencesBefore = await db.numberSequence.findMany({
          where: { tenantId: c.tenantId },
          orderBy: { namespace: "asc" },
        });
        let changedTemplateId: string;
        assert.deepEqual(
          (
            await validateRequest(c, request.id, {
              expectedRevision: request.revision,
            })
          ).issues,
          [],
        );
        const key = randomUUID(),
          lockName = `${c.tenantId}:finalize:${key}`;
        const held = gate(),
          release = gate();
        const blocker = db.$transaction(
          async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockName},0))`;
            held.release();
            await release.promise;
          },
          { timeout: 60000 },
        );
        await held.promise;
        const attempted = finalize(
          c,
          request.id,
          { expectedRevision: request.revision },
          key,
        );
        const expectedConflict = assert.rejects(
          attempted,
          code("PRINT_INPUT_CHANGED"),
        );
        let pending = false;
        try {
          const deadline = Date.now() + 45000;
          while (Date.now() < deadline) {
            const rows = await db.$queryRaw<
              { pending: boolean }[]
            >`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND classid=((hashtextextended(${lockName},0) >> 32) & 4294967295)::oid AND objid=(hashtextextended(${lockName},0) & 4294967295)::oid) AS pending`;
            if (rows[0].pending) {
              pending = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 15));
          }
          assert.equal(
            pending,
            true,
            "Finalize must have completed actual geometry and be waiting at the commit lock",
          );
          const profile = await db.issuerProfileVersion.findFirstOrThrow({
            where: { tenantId: c.tenantId },
            orderBy: { version: "desc" },
          });
          assert.notEqual(
            (profile.profile as { cityRu: string }).cityRu,
            "Синтетический город Б",
          );
          const changed = await saveProfile(c, {
            ...(profile.profile as object),
            cityRu: "Синтетический город Б",
          });
          assert.notEqual(changed.id, profile.id);
          // A V2 request pins its issuer profile. Appending a profile version must
          // not replace that explicit choice. The current template selection is
          // dynamic, however: replacing its version changes the print fingerprint.
          const template = await db.templateVersion.create({
            data: {
              tenantId: c.tenantId,
              templateId: originalTemplate.templateId,
              version: `${originalTemplate.version}-race`,
              checksum: originalTemplate.checksum,
              storageKey: originalTemplate.storageKey,
              contract: json(originalTemplate.contract),
              approved: true,
            },
          });
          changedTemplateId = template.id;
        } finally {
          release.release();
          await blocker;
        }
        await expectedConflict;
        assert.equal(
          await db.issuance.count({ where: { requestId: request.id } }),
          0,
        );
        assert.equal(
          await db.issuedDocument.count({ where: { requestId: request.id } }),
          0,
        );
        assert.equal(
          await db.idempotencyOperation.count({
            where: {
              tenantId: c.tenantId,
              command: "FINALIZE",
              idempotencyKey: key,
            },
          }),
          0,
        );
        assert.deepEqual(
          await db.numberSequence.findMany({
            where: { tenantId: c.tenantId },
            orderBy: { namespace: "asc" },
          }),
          sequencesBefore,
        );
        const result = await finalize(
          c,
          request.id,
          { expectedRevision: request.revision },
          key,
        );
        const issuance = await db.issuance.findUniqueOrThrow({
          where: { id: result.issuanceId },
        });
        assert.equal(issuance.profileVersionId, pinnedProfileId);
        assert.equal(
          (issuance.snapshot as { issuer: { cityRu: string } }).issuer.cityRu,
          (pinnedProfile.profile as { cityRu: string }).cityRu,
        );
        const issuedCard = await db.issuedDocument.findFirstOrThrow({
          where: { issuanceId: issuance.id, templateId: "pb-card" },
        });
        assert.equal(issuedCard.templateVersionId, changedTemplateId);
      },
    );
  } finally {
    await approvals.close();
    await db.$disconnect();
  }
});

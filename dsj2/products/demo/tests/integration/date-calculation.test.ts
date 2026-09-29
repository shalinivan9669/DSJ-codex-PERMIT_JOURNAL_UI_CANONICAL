import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, type Context } from "../../apps/api/src/core";
import {
  createRequest,
  patchRequest,
  resolvedRequest,
} from "../../apps/api/src/requests";
import { draftSchema, today } from "../../packages/contracts/src";
import {
  KZ_TRAINING_CALENDAR_VERSION,
  resolveDraft,
  type TrainingDateRule,
} from "../../packages/contracts/src";
import { saveProfile } from "../../apps/api/src/settings";
import { assertTestDatabase } from "./test-database";

test("API creation defaults to tenant calendar date once; saved/blank/imported dates and automatic provenance survive reload", async () => {
  assertTestDatabase();
  assert.doesNotMatch(
    new URL(process.env.DATABASE_URL!).pathname,
    /operator_browser/i,
    "Do not run test fixtures in the working browser database",
  );
  const tenant = await db.tenant.create({
    data: {
      name: "Date calculation disposable fixture",
      timezone: "Pacific/Kiritimati",
      demoOnly: true,
    },
  });
  const user = await db.user.create({
    data: {
      tenantId: tenant.id,
      email: `date-${randomUUID()}@example.test`,
      displayName: "Date fixture",
      passwordHash: "unused",
      role: "ADMIN",
    },
  });
  const c: Context = {
    tenantId: tenant.id,
    userId: user.id,
    role: "ADMIN",
    sessionId: "test",
    csrfHash: "test",
    correlationId: randomUUID(),
  };
  try {
    const created = await createRequest(c, {
      kind: "PERSON",
      schemaVersion: 2,
    });
    assert.equal(
      draftSchema.parse(created.draft).commonFields?.documentDate,
      today(tenant.timezone),
    );
    const saved = draftSchema.parse(created.draft);
    saved.commonFields!.documentDate = "2028-03-01";
    saved.commonFields!.trainingDateRule = {
      hoursPerDay: 8,
      hoursSource: "THEORY",
      calendar: "CALENDAR",
      anchor: "DOCUMENT_IS_END",
      protocolDate: "TRAINING_END",
      source: "Synthetic integration schedule, not a program rule",
    };
    saved.items = draftSchema.parse({
      kind: "PERSON",
      items: [
        {
          id: "row",
          assignments: [
            {
              id: "card",
              templateId: "biot-worker-card",
              biotCategory: "WORKER",
              hours: "24",
              productionHours: "16",
            },
          ],
        },
      ],
    }).items;
    const patched = await patchRequest(c, created.id, {
      expectedRevision: created.revision,
      draft: saved,
    });
    let resolved = await resolvedRequest(c, created.id);
    assert.equal(
      resolved.draft.items[0].assignments[0].documentDate,
      "2028-03-01",
    );
    assert.equal(
      resolved.draft.items[0].assignments[0].trainingStart,
      "2028-02-28",
    );
    assert.equal(
      resolved.draft.items[0].assignments[0].validUntil,
      "2029-03-01",
    );
    assert.equal(
      draftSchema.parse(
        (await db.printRequest.findUniqueOrThrow({ where: { id: created.id } }))
          .draft,
      ).commonFields!.documentDate,
      "2028-03-01",
    );
    saved.items[0].assignments[0].trainingStart = "2028-02-28";
    saved.items[0].assignments[0].fieldOrigins = { trainingStart: "IMPORTED" };
    saved.items[0].assignments[0].hours = "40";
    const imported = await patchRequest(c, created.id, {
      expectedRevision: patched.revision,
      draft: saved,
    });
    resolved = await resolvedRequest(c, created.id);
    assert.equal(
      resolved.draft.items[0].assignments[0].trainingStart,
      "2028-02-28",
    );
    saved.items[0].assignments[0].fieldOrigins = { trainingStart: "AUTO" };
    await patchRequest(c, created.id, {
      expectedRevision: imported.revision,
      draft: saved,
    });
    resolved = await resolvedRequest(c, created.id);
    assert.equal(
      resolved.draft.items[0].assignments[0].trainingStart,
      "2028-02-26",
    );
    const blank = await createRequest(c, {
      kind: "PERSON",
      schemaVersion: 2,
      commonFields: { documentDate: "" },
    });
    assert.equal(draftSchema.parse(blank.draft).commonFields!.documentDate, "");
    const legacy = await createRequest(c, { kind: "PERSON" });
    assert.equal(draftSchema.parse(legacy.draft).commonFields, undefined);

    const schedule: TrainingDateRule = {
      hoursPerDay: 8,
      hoursSource: "THEORY",
      calendar: "KZ_FIVE_DAY",
      calendarVersion: KZ_TRAINING_CALENDAR_VERSION,
      anchor: "DOCUMENT_AFTER_TRAINING",
      protocolDate: "DOCUMENT_DATE",
      source: "Синтетический подтверждённый график интеграционного теста",
    };
    const center = {
      nameRu: "Изолированный тест графика",
      nameKz: "",
      addressRu: "",
      addressKz: "",
      cityRu: "",
      cityKz: "",
      approvalBasis: "",
      commission: [],
      approved: false,
      commonFields: { trainingDateRule: schedule },
    };
    const profile = await saveProfile(c, center);
    const scheduled = await createRequest(c, {
      kind: "PERSON",
      schemaVersion: 2,
      commonFields: { documentDate: "2026-03-26" },
      items: [
        {
          id: "scheduled-person",
          assignments: [
            { id: "scheduled-card", templateId: "ptm-card", hours: "16" },
          ],
        },
      ],
    });
    const persisted = draftSchema.parse(scheduled.draft);
    assert.equal(persisted.profileVersionId, profile.id);
    let server = await resolvedRequest(c, scheduled.id);
    const browser = resolveDraft(persisted, center.commonFields);
    assert.equal(
      server.draft.items[0].assignments[0].trainingStart,
      "2026-03-19",
    );
    assert.equal(
      server.draft.items[0].assignments[0].trainingEnd,
      "2026-03-20",
    );
    assert.deepEqual(
      server.draft.items[0].assignments[0],
      browser.draft.items[0].assignments[0],
    );
    await saveProfile(c, {
      ...center,
      commonFields: { trainingDateRule: { ...schedule, hoursPerDay: 4 } },
    });
    server = await resolvedRequest(c, scheduled.id);
    assert.equal(
      server.draft.items[0].assignments[0].trainingStart,
      "2026-03-19",
      "Saved profile version remains pinned after center settings change",
    );
    persisted.items[0].assignments[0].documentDate = "2025-01-08";
    persisted.items[0].assignments[0].fieldOrigins = { documentDate: "MANUAL" };
    const retroactive = await patchRequest(c, scheduled.id, {
      expectedRevision: scheduled.revision,
      draft: persisted,
    });
    server = await resolvedRequest(c, scheduled.id);
    assert.equal(
      server.draft.items[0].assignments[0].documentDate,
      "2025-01-08",
    );
    assert.equal(
      server.draft.items[0].assignments[0].trainingStart,
      "2025-01-05",
    );
    assert.equal(
      server.draft.items[0].assignments[0].trainingEnd,
      "2025-01-06",
    );
    persisted.items[0].assignments[0].trainingEnd = "2025-01-08";
    persisted.items[0].assignments[0].fieldOrigins!.trainingEnd = "IMPORTED";
    await patchRequest(c, scheduled.id, {
      expectedRevision: retroactive.revision,
      draft: persisted,
    });
    server = await resolvedRequest(c, scheduled.id);
    assert.equal(
      server.draft.items[0].assignments[0].trainingEnd,
      "2025-01-08",
    );
    assert.ok(
      server.issues.some(
        (issue) =>
          issue.code === "TRAINING_BEFORE_DOCUMENT" &&
          issue.path === "items.0.assignments.0.trainingEnd",
      ),
    );
  } finally {
    // Profiles/audit are immutable, including isolated fixtures. Leave the
    // UUID-scoped test tenant for disposal with the dedicated test database.
    await db.$disconnect();
  }
});

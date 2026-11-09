import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, type Context } from "../../apps/api/src/core";
import { getProfile, saveProfile } from "../../apps/api/src/settings";
import { assertTestDatabase } from "./test-database";

test("saving center requisites renames only its tenant and preserves prior profile, commission and staff", async () => {
  assertTestDatabase();
  try {
    const tenant = await db.tenant.create({
      data: {
        name: "Синтетический центр до изменения",
        demoOnly: true,
        learnerRegistrationEnabled: false,
      },
    });
    const foreign = await db.tenant.create({
      data: { name: "Другой синтетический центр", demoOnly: true },
    });
    const director = await db.user.create({
      data: {
        tenantId: tenant.id,
        email: `requisites-${randomUUID()}@example.test`,
        displayName: "Синтетический директор",
        role: "DIRECTOR",
        passwordHash: "unused-synthetic-credential",
      },
    });
    const c: Context = {
      tenantId: tenant.id,
      userId: director.id,
      role: "DIRECTOR",
      sessionId: "synthetic-session",
      csrfHash: "synthetic-csrf",
      correlationId: randomUUID(),
    };
    const legacy = {
      nameRu: "Старое название центра",
      nameKz: "Бұрынғы орталық атауы",
      cityRu: "Алматы",
      cityKz: "Алматы",
      addressRu: "Синтетический адрес, 1",
      addressKz: "",
      headName: "Синтетический директор",
      approvalBasis: "Основание синтетической комиссии",
      approved: false,
      commission: [
        { name: "Синтетический председатель", position: "Начальник УМО" },
        { name: "Синтетический директор", position: "Директор" },
        { name: "Синтетический преподаватель", position: "Преподаватель" },
      ],
      people: [
        {
          name: "Синтетический преподаватель",
          position: "Преподаватель",
          role: "TEACHER",
        },
      ],
    };
    const previous = await saveProfile(c, legacy);
    const foreignProfile = await db.issuerProfileVersion.create({
      data: {
        tenantId: foreign.id,
        version: 1,
        profile: { ...legacy, nameRu: foreign.name },
        createdBy: director.id,
      },
    });
    const tenantBefore = await db.tenant.findUniqueOrThrow({
      where: { id: tenant.id },
    });
    const updated = await saveProfile(c, {
      ...legacy,
      legalForm: "TOO",
      ownNameRu: "«Синтетический центр реквизитов»",
      ownNameKz: "",
      nameKz: "",
      addressKz: "",
      bankName: "АО Тестовый банк",
      iban: "kz77 0000 0000 0000 0001",
      bik: "testkzkx",
      postalCode: "050038",
    });
    assert.equal(updated.version, previous.version + 1);
    const saved = updated.profile as Record<string, unknown>;
    assert.equal(saved.nameRu, "ТОО «Синтетический центр реквизитов»");
    assert.equal(saved.nameKz, "«Синтетический центр реквизитов» ЖШС");
    assert.equal(saved.bankName, "АО Тестовый банк");
    assert.equal(saved.iban, "KZ770000000000000001");
    assert.equal(saved.bik, "TESTKZKX");
    assert.equal(saved.postalCode, "050038");
    assert.deepEqual(saved.commission, legacy.commission);
    assert.deepEqual(saved.people, legacy.people);
    assert.equal(saved.approved, false);
    assert.equal(saved.approvalBasis, legacy.approvalBasis);
    assert.deepEqual((await getProfile(c))?.profile, updated.profile);
    assert.deepEqual(
      await db.issuerProfileVersion.findUnique({ where: { id: previous.id } }),
      previous,
    );
    assert.deepEqual(
      await db.issuerProfileVersion.findUnique({
        where: { id: foreignProfile.id },
      }),
      foreignProfile,
    );
    assert.deepEqual(
      await db.tenant.findUnique({ where: { id: foreign.id } }),
      foreign,
    );
    assert.deepEqual(await db.tenant.findUnique({ where: { id: tenant.id } }), {
      ...tenantBefore,
      name: saved.nameRu,
    });
    assert.deepEqual(
      await db.user.findUnique({ where: { id: director.id } }),
      director,
    );
    assert.equal(
      await db.auditEvent.count({
        where: { tenantId: tenant.id, action: "PROFILE_VERSION_CREATED" },
      }),
      2,
    );

    for (const [actor, input, expected] of [
      [
        { ...c, role: "OPERATOR" },
        { ...legacy, nameRu: "Запрещённая смена" },
        403,
      ],
      [
        c,
        { ...legacy, nameRu: "Невалидная смена", iban: "KZ770000000000000002" },
        400,
      ],
    ] as const) {
      await assert.rejects(
        saveProfile(actor, input),
        (error: unknown) =>
          !!error &&
          typeof error === "object" &&
          "getStatus" in error &&
          typeof error.getStatus === "function" &&
          error.getStatus() === expected,
      );
    }
    assert.equal(
      await db.issuerProfileVersion.count({ where: { tenantId: tenant.id } }),
      2,
    );
    assert.deepEqual(await getProfile(c), updated);
    assert.equal(
      (await db.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).name,
      saved.nameRu,
    );
  } finally {
    // Immutable synthetic fixtures remain isolated in the guarded disposable DB.
    await db.$disconnect();
  }
});

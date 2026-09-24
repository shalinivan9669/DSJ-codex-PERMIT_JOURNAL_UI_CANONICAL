import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, type Context } from "../../apps/api/src/core";
import {
  createDossierRecord,
  addValueAttachment,
} from "../../apps/api/src/operator-value";
import {
  centerDossierReminders,
  exportCenterDossier,
} from "../../apps/api/src/center-dossier";
import { assertTestDatabase } from "./test-database";

test("center dossier: calendar review reminders and explicitly selected public-only file package", async () => {
  assertTestDatabase();
  const tenant = await db.tenant.create({
    data: { name: "Синтетическое досье", demoOnly: true },
  });
  const user = await db.user.create({
    data: {
      tenantId: tenant.id,
      email: randomUUID() + "@example.test",
      passwordHash: "fixture",
      displayName: "Тест",
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
    const common = {
      version: "1",
      source: "Синтетический источник",
      applicability: "Только испытание",
      ownerId: user.id,
      validUntil: "2026-10-01",
    };
    const visible = await createDossierRecord(c, {
      ...common,
      title: "Разрешённый образец",
      category: "PROGRAM",
      customerVisible: true,
    });
    const secret = await createDossierRecord(c, {
      ...common,
      title: "Персональное досье",
      category: "QUALIFICATION",
      customerVisible: false,
    });
    const pdf = Buffer.from("%PDF-1.4\nsynthetic-only-document\n%%EOF");
    await addValueAttachment(c, {
      dossierId: visible.id,
      category: "SOURCE",
      source: "Синтетика",
      fileName: "Программа.pdf",
      contentBase64: pdf.toString("base64"),
      customerVisible: true,
    });
    await addValueAttachment(c, {
      dossierId: secret.id,
      category: "SOURCE",
      source: "Синтетика",
      fileName: "SECRET.pdf",
      contentBase64: pdf.toString("base64"),
      customerVisible: false,
    });
    const reminders = await centerDossierReminders(c, {
      asOf: "2026-09-24",
      withinDays: 30,
    });
    assert.equal(reminders.items.length, 2);
    assert.equal(reminders.items[0].state, "CONTACT_DUE");
    assert.match(reminders.limitation, /Не является выводом/);
    assert.equal(
      (await centerDossierReminders(c, { asOf: "2026-10-02", withinDays: 0 }))
        .items[0].state,
      "DATE_PASSED_REVIEW",
    );
    await assert.rejects(
      exportCenterDossier(c, { recordIds: [visible.id, secret.id] }),
      (e: any) => e.getStatus() === 403,
    );
    await assert.rejects(
      exportCenterDossier(
        { ...c, tenantId: randomUUID() },
        { recordIds: [visible.id] },
      ),
      (e: any) => e.getStatus() === 404,
    );
    await assert.rejects(
      exportCenterDossier(
        { ...c, role: "EMPLOYER" },
        { recordIds: [visible.id] },
      ),
      (e: any) => e.getStatus() === 403,
    );
    const zip = await exportCenterDossier(c, { recordIds: [visible.id] });
    assert.equal(zip.buffer.subarray(0, 2).toString(), "PK");
    // ZIP directory filenames are uncompressed: private records cannot enter even as entries.
    assert.ok(!zip.buffer.includes(Buffer.from("SECRET")));
    assert.ok(!zip.buffer.includes(Buffer.from(user.id)));
  } finally {
    await db.$disconnect();
  }
});

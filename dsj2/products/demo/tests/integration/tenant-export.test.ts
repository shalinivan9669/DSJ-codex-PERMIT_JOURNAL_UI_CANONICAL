import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { db, type Context } from "../../apps/api/src/core";
import { ArtifactStore } from "../../packages/printing/src";
import {
  tenantExportSnapshot,
  exportTenant,
} from "../../apps/api/src/tenant-export";
import { assertTestDatabase } from "./test-database";
import {
  exportOrderDossier,
  createOrderMilestone,
} from "../../apps/api/src/operator-value";

test("tenant export includes new data and verified files, excludes foreign tenant and all auth secrets, refuses partial archive", async () => {
  assertTestDatabase();
  const tenant = await db.tenant.create({
    data: { name: "Синтетический владелец выгрузки" },
  });
  const foreign = await db.tenant.create({
    data: { name: "Закрытый чужой центр" },
  });
  const user = await db.user.create({
    data: {
      tenantId: tenant.id,
      email: `export-${randomUUID()}@example.test`,
      displayName: "Владелец",
      role: "ADMIN",
      passwordHash: "SECRET_PASSWORD_HASH",
    },
  });
  await db.user.create({
    data: {
      tenantId: foreign.id,
      email: `secret-${randomUUID()}@example.test`,
      displayName: "FOREIGN_PERSON_PRIVATE",
      role: "ADMIN",
      passwordHash: "FOREIGN_SECRET",
    },
  });
  await db.session.create({
    data: {
      id: randomUUID(),
      tenantId: tenant.id,
      userId: user.id,
      csrfHash: "SESSION_SECRET",
      sessionVersion: 1,
      expiresAt: new Date(Date.now() + 60000),
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
  const order = await db.serviceOrder.create({
    data: {
      tenantId: tenant.id,
      title: "Сохранённый рабочий заказ",
      createdBy: user.id,
    },
  });
  const bytes = Buffer.from("%PDF-1.4\nSYNTHETIC_PRESERVED_BYTES\n%%EOF");
  const stored = await new ArtifactStore().put(bytes, "pdf");
  const attachment = await db.valueAttachment.create({
    data: {
      tenantId: tenant.id,
      orderId: order.id,
      category: "SOURCE",
      source: "Синтетический исходник",
      ...stored,
      fileName: "source.pdf",
      mimeType: "application/pdf",
      createdBy: user.id,
    },
  });
  const snapshot = await tenantExportSnapshot(c);
  assert.equal(snapshot.tables.ServiceOrder[0].id, order.id);
  assert.equal(snapshot.tables.ValueAttachment[0].id, attachment.id);
  assert.ok("DocumentCorrectionRequest" in snapshot.tables);
  assert.ok("ServiceRuleVersion" in snapshot.tables);
  assert.ok("GroupDocumentMember" in snapshot.tables);
  const text = JSON.stringify(snapshot);
  assert.ok(!text.includes("SECRET_PASSWORD_HASH"));
  assert.ok(!text.includes("SESSION_SECRET"));
  assert.ok(!text.includes("FOREIGN_PERSON_PRIVATE"));
  assert.ok(!text.includes(foreign.id));
  assert.equal(snapshot.tables.Session, undefined);
  await assert.rejects(tenantExportSnapshot({ ...c, role: "OPERATOR" }));
  const exported = await exportTenant(c);
  const inspected = spawnSync(
    process.env.DEMO_PYTHON || "python",
    [
      "-c",
      "import sys,io,zipfile,json; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); data=json.loads(z.read('tenant-data.json')); manifest=json.loads(z.read('manifest.json')); print(json.dumps({'complete':manifest['complete'],'tables':list(data['tables']),'attachment':z.read(data['files'][0]['fileName']).decode(),'count':len(data['files'])}))",
    ],
    { input: exported.buffer, encoding: "utf8", windowsHide: true },
  );
  assert.equal(inspected.status, 0, inspected.stderr);
  const contents = JSON.parse(inspected.stdout);
  assert.equal(contents.complete, true);
  assert.equal(contents.count, 1);
  assert.equal(contents.attachment, bytes.toString());
  assert.ok(contents.tables.includes("ServiceOrder"));
  await createOrderMilestone(c, order.id, {
    label: "Получить подписанный экземпляр",
    category: "EVIDENCE",
    source: "CONTRACT",
    sourceReference: "Согласованный тестовый комплект",
  });
  const dossier = await exportOrderDossier(c, order.id);
  const dossierProbe = spawnSync(
    process.env.DEMO_PYTHON || "python",
    [
      "-c",
      "import sys,io,zipfile,json; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); m=json.loads(z.read('manifest.json')); print(json.dumps({'complete':m['complete'],'missing':len(m['missing']),'bytes':z.read(next(x for x in z.namelist() if x.startswith('evidence/'))).decode()}))",
    ],
    { input: dossier.buffer, encoding: "utf8", windowsHide: true },
  );
  assert.equal(dossierProbe.status, 0, dossierProbe.stderr);
  const dossierResult = JSON.parse(dossierProbe.stdout);
  assert.equal(dossierResult.complete, false);
  assert.ok(dossierResult.missing >= 2);
  assert.equal(dossierResult.bytes, bytes.toString());
  await db.valueAttachment.create({
    data: {
      tenantId: tenant.id,
      orderId: order.id,
      category: "SOURCE",
      source: "Синтетически отсутствующий исходник",
      storageKey: `objects/missing-${randomUUID()}.pdf`,
      sha256: "a".repeat(64),
      size: 10,
      fileName: "missing.pdf",
      mimeType: "application/pdf",
      createdBy: user.id,
    },
  });
  await assert.rejects(
    exportTenant(c),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "getResponse" in error &&
      (error as { getResponse(): { code: string } }).getResponse().code ===
        "TENANT_EXPORT_INCOMPLETE",
  );
  await db.$disconnect();
});

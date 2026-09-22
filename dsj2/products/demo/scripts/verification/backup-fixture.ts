import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { db, type Context } from "../../apps/api/src/core";
import { provision } from "../setup";
import {
  uploadPhoto,
  registryExport,
  readArtifact,
} from "../../apps/api/src/files";
import { createRequest, finalize } from "../../apps/api/src/requests";
import { draftSchema } from "../../packages/contracts/src";
import { ArtifactStore } from "../../packages/printing/src";
import { claimJob, executeJob } from "../../apps/render-worker/src/queue";

async function main() {
  assert.match(
    process.env.DATABASE_URL || "",
    /\/demo_test_[a-z0-9_]+(?:\?|$)/,
    "Dedicated disposable demo_test_* DB is mandatory",
  );
  const provisioned = await provision({
    email:
      process.env.DEMO_ADMIN_EMAIL || `backup-${randomUUID()}@example.invalid`,
    password: process.env.DEMO_ADMIN_PASSWORD || randomUUID() + randomUUID(),
    name: "Синтетический центр проверки восстановления",
    sample: true,
  });
  const context: Context = {
    ...provisioned,
    userId: provisioned.userId,
    role: "ADMIN",
    sessionId: "offline-fixture",
    csrfHash: "offline-fixture",
    correlationId: randomUUID(),
  };
  const image = spawnSync(
    process.env.DEMO_PYTHON || "python3",
    [
      "-I",
      "-c",
      'from PIL import Image;import sys;Image.new("RGB",(480,640),(68,108,145)).save(sys.stdout.buffer,"PNG")',
    ],
    { windowsHide: true },
  );
  assert.equal(image.status, 0, "Pillow must generate the synthetic photo");
  const photo = await uploadPhoto(
    context,
    {
      buffer: image.stdout,
      size: image.stdout.length,
      mimetype: "image/png",
      originalname: "synthetic.png",
    } as Express.Multer.File,
    {},
  );
  const request = await createRequest(
    context,
    draftSchema.parse({
      kind: "PERSON",
      title: "Проверка полного резервного восстановления",
      demoMode: true,
      items: [
        {
          id: randomUUID(),
          fullNameRu: "Синтетический Получатель",
          fullNameKz: "Синтетикалық Алушы",
          positionRu: "Инженер",
          positionKz: "Маман",
          photoAssetId: photo.id,
          assignments: [
            {
              id: randomUUID(),
              templateId: "pb-card",
              documentDate: "2026-09-22",
              trainingStart: "2026-09-20",
              trainingEnd: "2026-09-21",
              trainingSubject: "Синтетическая программа",
              result: "Тестовое значение",
              hours: "8",
            },
          ],
        },
      ],
    }),
  );
  await finalize(context, request.id, { expectedRevision: 0 }, randomUUID());
  const owner = randomUUID(),
    store = new ArtifactStore();
  for (let i = 0; i < 20; i++) {
    const job = await claimJob(db, owner, context.tenantId);
    if (!job) break;
    await executeJob(db, store, job, owner, new AbortController().signal);
  }
  assert.equal(
    await db.generationJob.count({
      where: { tenantId: context.tenantId, status: { not: "SUCCEEDED" } },
    }),
    0,
  );
  const files = await db.artifact.findMany({
    where: { tenantId: context.tenantId },
  });
  assert.ok(files.some((file) => file.format === "DOCX"));
  assert.ok(files.some((file) => file.format === "PDF"));
  for (const file of files) {
    const first = await readArtifact(context, file.id);
    const second = await readArtifact(context, file.id);
    assert.deepEqual(first, second);
  }
  await registryExport(context, {}, request.id);
  const result = {
    tenantId: context.tenantId,
    requestId: request.id,
    artifacts: files.map((file) => ({
      id: file.id,
      kind: file.format,
      sha256: file.sha256,
      size: file.size,
    })),
    photoIds: await db.photoAsset.findMany({
      where: { tenantId: context.tenantId },
      select: { id: true, sha256: true },
    }),
    photos: await db.photoAsset.count({
      where: { tenantId: context.tenantId },
    }),
    templates: await db.templateVersion.count({
      where: { tenantId: context.tenantId },
    }),
  };
  if (process.argv[2])
    await writeFile(process.argv[2], JSON.stringify(result, null, 2), {
      flag: "wx",
    });
  console.log(JSON.stringify(result));
}
void main().finally(() => db.$disconnect());

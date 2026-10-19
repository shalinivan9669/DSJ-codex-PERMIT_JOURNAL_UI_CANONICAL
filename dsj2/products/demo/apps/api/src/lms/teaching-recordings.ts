import { unlink } from "node:fs/promises";
import { Prisma } from "@demo/database";
import { audit, db, fail, transaction, type Context } from "../core";
import { assertLearningPermission } from "./learning-permissions";
import { groupVersion } from "./teaching-events";
import { lmsStore, savePrivateUpload } from "./materials";

async function recordingScope(
  c: Context,
  groupId: string,
  tx: Prisma.TransactionClient = db,
) {
  const { version } = await groupVersion(c, groupId, tx);
  await assertLearningPermission(c, version.courseId, groupId, "SCHEDULE", tx);
  return version.courseId;
}
export async function listGroupRecordings(c: Context, groupId: string) {
  const courseId = await recordingScope(c, groupId);
  return {
    items: await db.$queryRaw<
      Array<{ id: string; title: string; originalName: string; size: number }>
    >(Prisma.sql`
    SELECT m.id,COALESCE(s.title,m."originalName") AS title,m."originalName",m.size FROM "LmsMaterial" m
    LEFT JOIN "LmsMaterialState" s ON s."tenantId"=m."tenantId" AND s."materialId"=m.id
    WHERE m."tenantId"=${c.tenantId} AND m."mimeType" LIKE 'video/%' AND NOT COALESCE(s.hidden,false) AND NOT COALESCE(s.deleted,false)
      AND (m."courseId"=${courseId} OR EXISTS(SELECT 1 FROM "LmsMaterialBinding" b WHERE b."tenantId"=m."tenantId" AND b."materialId"=m.id AND b."courseId"=${courseId}))
    ORDER BY m."createdAt" DESC,m.id LIMIT 250`),
  };
}
export async function uploadGroupRecording(
  c: Context,
  groupId: string,
  file: Express.Multer.File | undefined,
) {
  const courseId = await recordingScope(c, groupId);
  if (!file?.mimetype.startsWith("video/"))
    fail(
      400,
      "RECORDING_VIDEO_REQUIRED",
      "Выберите видео в формате MP4 или WebM",
    );
  const stored = await savePrivateUpload(file);
  try {
    return await transaction(async (tx) => {
      await recordingScope(c, groupId, tx);
      const material = await tx.lmsMaterial.create({
        data: {
          tenantId: c.tenantId,
          courseId,
          ...stored,
          createdBy: c.userId,
        },
      });
      await tx.lmsMaterialState.create({
        data: {
          tenantId: c.tenantId,
          materialId: material.id,
          familyId: material.id,
          title: material.originalName,
          updatedBy: c.userId,
        },
      });
      await audit(tx, c, "LMS_RECORDING_UPLOADED", material.id, {
        groupId,
        courseId,
        size: material.size,
      });
      return {
        id: material.id,
        title: material.originalName,
        originalName: material.originalName,
        size: material.size,
      };
    });
  } catch (error) {
    await unlink(lmsStore.path(stored.storageKey)).catch(() => {});
    throw error;
  }
}

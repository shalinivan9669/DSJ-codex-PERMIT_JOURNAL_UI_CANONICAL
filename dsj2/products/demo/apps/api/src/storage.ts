import { createHash } from "node:crypto";
import { open, realpath, stat } from "node:fs/promises";
import { relative, isAbsolute } from "node:path";
import { ArtifactStore } from "@demo/printing";
import { db, fail, audit, type Context } from "./core";

const store = new ArtifactStore();
/** Verify using bounded buffers, then stream the SAME open inode to the response. */
export async function openArtifact(c: Context, id: string) {
  const artifact = await db.artifact.findFirst({
    where: { id, tenantId: c.tenantId },
  });
  if (!artifact) fail(404, "NOT_FOUND", "Файл не найден");
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const actual = await realpath(store.path(artifact.storageKey));
    const root = await realpath(store.root);
    const rel = relative(root, actual);
    if (rel.startsWith("..") || isAbsolute(rel))
      throw new Error("INVALID_PATH");
    handle = await open(actual, "r");
    const meta = await handle.stat();
    if (meta.size !== artifact.size) throw new Error("SIZE_MISMATCH");
    const digest = createHash("sha256");
    for await (const chunk of handle.createReadStream({
      autoClose: false,
      start: 0,
    }))
      digest.update(chunk);
    if (digest.digest("hex") !== artifact.sha256)
      throw new Error("HASH_MISMATCH");
    const stream = handle.createReadStream({ autoClose: true, start: 0 });
    handle = undefined;
    return { artifact, stream };
  } catch {
    await handle?.close();
    await audit(db, c, "ARTIFACT_STORAGE_FAILURE", id);
    fail(
      503,
      "ARTIFACT_UNAVAILABLE",
      "Сохранённый файл отсутствует или повреждён. Восстановление создаст отдельный файл с указанием происхождения",
    );
  }
}
export async function artifactAvailability(
  storageKey: string,
  size: number,
): Promise<"AVAILABLE" | "MISSING"> {
  try {
    return (await stat(store.path(storageKey))).size === size
      ? "AVAILABLE"
      : "MISSING";
  } catch {
    return "MISSING";
  }
}

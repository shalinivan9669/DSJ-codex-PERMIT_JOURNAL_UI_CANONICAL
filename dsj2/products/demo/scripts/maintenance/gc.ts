import { createHash } from "node:crypto";
import {
  lstat,
  open,
  readFile,
  readdir,
  realpath,
  unlink,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { PrismaClient } from "../../packages/database/src";
import { ArtifactStore } from "../../packages/printing/src";

const AGE_MS = 7 * 24 * 60 * 60 * 1000;
const OBJECT_KEY =
  /^objects\/[0-9a-f]{2}\/[0-9a-f]{64}-[0-9a-f-]{36}\.[a-z0-9]{1,8}$/;
const digest = (value: Buffer) =>
  createHash("sha256").update(value).digest("hex");
type Options = { apply?: boolean; backupDirectory?: string; now?: Date };
/** Conservative orphan collector. All DB records (including previews) are retained. */
export async function collectOrphanObjects(
  db: PrismaClient,
  store: ArtifactStore,
  options: Options = {},
) {
  const root = await realpath(store.root),
    lockPath = root + ".maintenance.lock";
  const lock = await open(lockPath, "wx", 0o600);
  try {
    await lock.writeFile(
      JSON.stringify({
        operation: "gc",
        pid: process.pid,
        startedAt: new Date().toISOString(),
      }),
    );
    const pinned = new Set<string>();
    if (options.backupDirectory) {
      const backup = await realpath(resolve(options.backupDirectory));
      if (
        backup === root ||
        backup.startsWith(root + sep) ||
        root.startsWith(backup + sep)
      )
        throw new Error("GC_BACKUP_MUST_BE_SEPARATE");
      const manifest = JSON.parse(
        await readFile(join(backup, "manifest.json"), "utf8"),
      ) as {
        version: number;
        product: string;
        databaseSha256: string;
        files: Record<string, string>;
      };
      if (
        ![1, 2].includes(manifest.version) ||
        manifest.product !== "DEMO" ||
        !manifest.files
      )
        throw new Error("GC_BACKUP_MANIFEST_INVALID");
      if (
        digest(await readFile(join(backup, "database.dump"))) !==
        manifest.databaseSha256
      )
        throw new Error("GC_BACKUP_DATABASE_HASH_MISMATCH");
      for (const [key, hash] of Object.entries(manifest.files)) {
        const target = resolve(backup, "files", key),
          inside = relative(join(backup, "files"), target);
        if (
          inside.startsWith("..") ||
          isAbsolute(inside) ||
          (await lstat(target)).isSymbolicLink()
        )
          throw new Error("GC_BACKUP_PATH_INVALID");
        if (digest(await readFile(target)) !== hash)
          throw new Error("GC_BACKUP_FILE_HASH_MISMATCH");
        pinned.add(key.replaceAll("\\", "/"));
      }
    } else if (options.apply)
      throw new Error("GC_APPLY_REQUIRES_VERIFIED_BACKUP");
    return await db.$transaction(
      async (tx) => {
        // Acquisitions take the shared lock. No new worker can acquire a lease during this scan.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(1145392463)`;
        const running = await tx.generationJob.count({
          where: { status: "RUNNING", leaseUntil: { gt: new Date() } },
        });
        if (options.apply && running) throw new Error("GC_ACTIVE_LEASES");
        const [artifacts, photos, templates, snapshots] = await Promise.all([
          tx.artifact.findMany({ select: { storageKey: true } }),
          tx.photoAsset.findMany({
            select: { storageKey: true, originalStorageKey: true },
          }),
          tx.templateVersion.findMany({ select: { storageKey: true } }),
          tx.renderInputSnapshot.findMany({ select: { input: true } }),
        ]);
        const referenced = new Set([
          ...artifacts.map((a) => a.storageKey),
          ...templates.map((t) => t.storageKey),
          ...photos.flatMap((p) => [p.storageKey, p.originalStorageKey]),
        ]);
        for (const snapshot of snapshots) {
          const input = snapshot.input as Record<string, unknown>;
          if (typeof input.templateStorageKey === "string")
            referenced.add(input.templateStorageKey);
          if (input.photos && typeof input.photos === "object")
            for (const value of Object.values(input.photos))
              if (typeof value === "string") referenced.add(value);
        }
        const cutoff = (options.now || new Date()).getTime() - AGE_MS;
        const candidates: Array<{
          storageKey: string;
          size: number;
          sha256: string;
        }> = [];
        let protectedObjects = 0,
          recentObjects = 0,
          ignoredObjects = 0;
        const walk = async (directory: string): Promise<void> => {
          for (const entry of await readdir(directory, {
            withFileTypes: true,
          })) {
            const target = join(directory, entry.name),
              info = await lstat(target);
            if (info.isSymbolicLink()) {
              ignoredObjects++;
              continue;
            }
            if (entry.isDirectory()) {
              await walk(target);
              continue;
            }
            const key = relative(root, target).split(sep).join("/");
            if (!OBJECT_KEY.test(key) || !info.isFile()) {
              ignoredObjects++;
              continue;
            }
            if (referenced.has(key) || pinned.has(key)) {
              protectedObjects++;
              continue;
            }
            if (info.mtimeMs >= cutoff || info.birthtimeMs >= cutoff) {
              recentObjects++;
              continue;
            }
            const hash = digest(await readFile(target));
            candidates.push({ storageKey: key, size: info.size, sha256: hash });
            if (options.apply) {
              const current = await lstat(target);
              if (
                current.isSymbolicLink() ||
                current.size !== info.size ||
                current.mtimeMs !== info.mtimeMs ||
                digest(await readFile(target)) !== hash
              )
                throw new Error("GC_FILE_CHANGED");
              await unlink(target);
            }
          }
        };
        try {
          await walk(join(root, "objects"));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        return {
          mode: options.apply ? "apply" : "dry-run",
          minimumAgeDays: 7,
          backupPinned: pinned.size,
          activeLeases: running,
          protectedObjects,
          recentObjects,
          ignoredObjects,
          candidates,
          deleted: options.apply ? candidates.length : 0,
          previewRecordsRetained: true,
        };
      },
      { timeout: 120000, maxWait: 15000 },
    );
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

if (require.main === module) {
  const args = process.argv.slice(2),
    apply = args.includes("--apply");
  if (!args.includes("--dry-run") && !apply)
    throw new Error(
      "Usage: tsx scripts/maintenance/gc.ts --dry-run|--apply [--backup ABSOLUTE_DIRECTORY]",
    );
  const backup = args.indexOf("--backup");
  const db = new PrismaClient();
  collectOrphanObjects(db, new ArtifactStore(), {
    apply,
    backupDirectory: backup < 0 ? undefined : args[backup + 1],
  })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "GC_FAILED");
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}

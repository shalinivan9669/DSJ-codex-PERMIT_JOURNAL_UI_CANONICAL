import { mixin, type CallHandler, type ExecutionContext } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { randomUUID } from "node:crypto";
import { createWriteStream, type WriteStream } from "node:fs";
import { readdir, stat, statfs, unlink } from "node:fs/promises";
import { join } from "node:path";
import { finished, pipeline } from "node:stream/promises";
import type { Request } from "express";
import type { StorageEngine } from "multer";
import { finalize } from "rxjs";
import { fail } from "../core";
import { lmsUploadDirectory, uploadDestination } from "./materials";

function limit(name: string, fallback: number, maximum: number) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new Error(`INVALID_${name}`);
  return value;
}
const concurrency = limit("DEMO_UPLOAD_CONCURRENCY", 2, 4);
const diskBudget = limit("DEMO_UPLOAD_TEMP_MIB", 1024, 4096) * 1024 * 1024;
const minimumFree = 64 * 1024 * 1024;
type Reservation = {
  bytes: number;
  paths: Set<string>;
  streams: Set<WriteStream>;
  cleanup?: Promise<void>;
};
const reservations = new Map<Request, Reservation>();

/** Reserve the maximum before multipart parsing, including concurrent writers. */
async function admit(req: Request, maximum: number) {
  const reserved = [...reservations.values()].reduce(
    (n, item) => n + item.bytes,
    0,
  );
  if (reservations.size >= concurrency || reserved + maximum > diskBudget)
    fail(
      503,
      "UPLOAD_BUSY",
      "Загрузка занята. Повторите через несколько секунд",
    );
  const declared = req.headers["content-length"];
  if (declared && Number(declared) > maximum + 1024 * 1024)
    fail(413, "UPLOAD_TOO_LARGE", "Файл превышает допустимый размер");
  const reservation: Reservation = {
    bytes: maximum,
    paths: new Set(),
    streams: new Set(),
  };
  reservations.set(req, reservation);
  try {
    await uploadDestination();
    const activePaths = new Set(
      [...reservations.values()].flatMap((entry) => [...entry.paths]),
    );
    let occupied = 0;
    for (const name of await readdir(lmsUploadDirectory)) {
      const path = join(lmsUploadDirectory, name);
      if (!activePaths.has(path)) occupied += (await stat(path)).size;
    }
    const allReserved = [...reservations.values()].reduce(
      (n, entry) => n + entry.bytes,
      0,
    );
    const disk = await statfs(lmsUploadDirectory, { bigint: true });
    if (
      occupied + allReserved > diskBudget ||
      disk.bavail * disk.bsize < BigInt(allReserved + minimumFree)
    )
      fail(
        503,
        "UPLOAD_STORAGE_BUSY",
        "Недостаточно места для загрузки. Повторите позже",
      );
    return reservation;
  } catch (error) {
    reservations.delete(req);
    throw error;
  }
}

async function cleanup(req: Request, reservation: Reservation) {
  if (!reservation.cleanup)
    reservation.cleanup = (async () => {
      for (const stream of reservation.streams) stream.destroy();
      await Promise.all(
        [...reservation.streams].map((stream) =>
          finished(stream).catch(() => {}),
        ),
      );
      await Promise.all(
        [...reservation.paths].map((path) => unlink(path).catch(() => {})),
      );
      reservations.delete(req);
    })();
  await reservation.cleanup;
}

// A destroyed request must also close the writer on Windows before unlinking.
const privateStorage: StorageEngine = {
  _handleFile(req, file, callback) {
    void (async () => {
      const reservation = reservations.get(req);
      if (!reservation || reservation.cleanup || req.aborted)
        throw new Error("UPLOAD_ABORTED");
      const filename = randomUUID() + ".upload";
      const path = join(lmsUploadDirectory, filename);
      reservation.paths.add(path);
      const output = createWriteStream(path, { flags: "wx", mode: 0o600 });
      reservation.streams.add(output);
      try {
        await pipeline(file.stream, output);
        return {
          destination: lmsUploadDirectory,
          filename,
          path,
          size: output.bytesWritten,
        };
      } catch (error) {
        await unlink(path).catch(() => {});
        throw error;
      } finally {
        reservation.streams.delete(output);
      }
    })().then(
      (info) => callback(null, info),
      (error: Error) => callback(error),
    );
  },
  _removeFile(_req, file, callback) {
    unlink(file.path).then(
      () => callback(null),
      (error: Error) => callback(error),
    );
  },
};

export function privateUpload(maximum: number) {
  const Multipart = FileInterceptor("file", {
    storage: privateStorage,
    limits: { fileSize: maximum, files: 1, fields: 12, fieldSize: 10000 },
  });
  class AdmittedUpload extends Multipart {
    async intercept(context: ExecutionContext, next: CallHandler) {
      const req = context.switchToHttp().getRequest<Request>();
      const reservation = await admit(req, maximum);
      if (req.aborted) {
        await cleanup(req, reservation);
        fail(400, "UPLOAD_ABORTED", "Загрузка прервана. Повторите загрузку");
      }
      const onAbort = () => void cleanup(req, reservation);
      req.once("aborted", onAbort);
      try {
        return (await super.intercept(context, next)).pipe(
          finalize(() => {
            req.off("aborted", onAbort);
            void cleanup(req, reservation);
          }),
        );
      } catch (error) {
        req.off("aborted", onAbort);
        await cleanup(req, reservation);
        throw error;
      }
    }
  }
  return mixin(AdmittedUpload);
}

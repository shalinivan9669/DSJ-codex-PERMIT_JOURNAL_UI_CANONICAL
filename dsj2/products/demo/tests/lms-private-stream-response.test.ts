import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import test from "node:test";
import type { Response } from "express";
import { pipePrivateResponse } from "../apps/api/src/lms/private-stream-response";

for (const mode of [
  "already-disconnected",
  "headers-throw",
  "disconnect-during-stream",
] as const) {
  test(`private media closes the actual file descriptor: ${mode}`, async () => {
    const folder = await mkdtemp(join(tmpdir(), "demo-stream-owner-"));
    const path = join(folder, "media.bin");
    await writeFile(path, Buffer.alloc(128 * 1024, 7));
    const handle = await open(path, "r");
    const stream = handle.createReadStream({
      autoClose: true,
      highWaterMark: 1024,
    });
    const closed = once(stream, "close");
    const response = new Writable({
      write(_chunk, _encoding, callback) {
        if (mode === "disconnect-during-stream") this.destroy();
        callback();
      },
    });
    if (mode === "already-disconnected") response.destroy();
    try {
      const send = () =>
        pipePrivateResponse(response as unknown as Response, stream, () => {
          if (mode === "headers-throw") throw new Error("HEADER_ERROR");
          assert.equal(response.destroyed, false);
        });
      if (mode === "headers-throw") assert.throws(send, /HEADER_ERROR/);
      else send();
      await closed;
      await assert.rejects(handle.stat(), { code: "EBADF" });
    } finally {
      response.destroy();
      stream.destroy();
      await handle.close().catch(() => {});
      await rm(folder, { recursive: true, force: true });
    }
  });
}

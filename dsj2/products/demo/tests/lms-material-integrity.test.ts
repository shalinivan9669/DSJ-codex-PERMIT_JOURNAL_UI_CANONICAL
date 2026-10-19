import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  open,
  rm,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("concurrent private ranges share a complete check and reject same-size tampering", async () => {
  const directory = await mkdtemp(join(tmpdir(), "demo-material-integrity-"));
  const previousRoot = process.env.DEMO_ARTIFACT_ROOT;
  process.env.DEMO_ARTIFACT_ROOT = directory;
  const { lmsStore, openPrivateStream, invalidateMaterialIntegrity } =
    await import("../apps/api/src/lms/materials");
  const bytes = Buffer.alloc(1024 * 1024, 65);
  const stored = await lmsStore.put(bytes, "pdf");
  const path = lmsStore.path(stored.storageKey);
  const probe = await open(path, "r");
  const prototype = Object.getPrototypeOf(probe) as {
    createReadStream: FileHandle["createReadStream"];
  };
  const original = prototype.createReadStream;
  let fullReads = 0;
  prototype.createReadStream = function (this: FileHandle, options) {
    if (options?.autoClose === false && options.end === undefined) fullReads++;
    return original.call(this, options);
  };
  await probe.close();
  const read = async (start: number, force = false) => {
    const result = await openPrivateStream(
      stored,
      `bytes=${start}-${start + 9}`,
      force,
    );
    assert.equal(result.invalid, false);
    if (result.invalid) throw new Error("INVALID_RANGE");
    const chunks: Buffer[] = [];
    for await (const chunk of result.stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  };
  try {
    const initial = await Promise.all(
      Array.from({ length: 8 }, (_, i) => read(i * 10)),
    );
    for (const value of initial) assert.deepEqual(value, bytes.subarray(0, 10));
    assert.equal(
      fullReads,
      1,
      "one cold object version must have one full read",
    );
    await read(0);
    assert.equal(fullReads, 1);
    await read(0, true);
    assert.equal(fullReads, 2, "explicit verification must read the object");
    bytes[500] ^= 1;
    await writeFile(path, bytes);
    const tampered = await Promise.allSettled([read(0), read(10), read(20)]);
    assert.ok(tampered.every((result) => result.status === "rejected"));
    assert.equal(fullReads, 3);
    bytes[500] ^= 1;
    await writeFile(path, bytes);
    invalidateMaterialIntegrity(stored.storageKey);
    assert.deepEqual(await read(0), bytes.subarray(0, 10));
    assert.equal(fullReads, 4);
  } finally {
    prototype.createReadStream = original;
    if (previousRoot === undefined) delete process.env.DEMO_ARTIFACT_ROOT;
    else process.env.DEMO_ARTIFACT_ROOT = previousRoot;
    await rm(directory, { recursive: true, force: true });
  }
});

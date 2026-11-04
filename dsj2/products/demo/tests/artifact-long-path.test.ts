import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore, buildZip } from "../packages/printing/src";

test("Python archive builder verifies stored bytes even beyond Windows MAX_PATH", async () => {
  const directory = await mkdtemp(join(tmpdir(), "demo-long-artifact-"));
  const previous = process.env.DEMO_ARTIFACT_ROOT;
  try {
    const root = join(directory, "a".repeat(110), "b".repeat(110));
    process.env.DEMO_ARTIFACT_ROOT = root;
    const store = new ArtifactStore();
    const bytes = Buffer.from("SYNTHETIC_LONG_PATH_ARCHIVE_BYTES");
    const saved = await store.put(bytes, "txt");
    assert.ok(store.path(saved.storageKey).length > 260);
    const archive = await buildZip(
      [{ id: "synthetic", ...saved, format: "TXT", fileName: "synthetic.txt" }],
      "synthetic-long-path",
      1,
    );
    assert.equal(archive.metadata.complete, true);
    const files = archive.metadata.files as { sha256: string; size: number }[];
    assert.equal(files.length, 1);
    assert.equal(files[0].sha256, saved.sha256);
    assert.equal(files[0].size, bytes.length);
  } finally {
    if (previous === undefined) delete process.env.DEMO_ARTIFACT_ROOT;
    else process.env.DEMO_ARTIFACT_ROOT = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

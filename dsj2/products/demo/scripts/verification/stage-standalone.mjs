import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sourceManifest } from "./source-manifest.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const destination = process.argv[2];
if (!destination || !path.isAbsolute(destination))
  throw new Error(
    "Provide an absolute NEW directory outside the source repository.",
  );
const target = path.resolve(destination);
if (
  target === path.parse(target).root ||
  target.startsWith(root + path.sep) ||
  root.startsWith(target + path.sep)
)
  throw new Error(
    "Standalone destination must be separate from the product source.",
  );
await fs.mkdir(target, { recursive: false });
const manifest = await sourceManifest(root);
for (const item of manifest.files) {
  const output = path.join(target, item.path);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.copyFile(path.join(root, item.path), output);
}
const copied = await sourceManifest(target);
if (manifest.sourceSha256 !== copied.sourceSha256)
  throw new Error("Standalone copy checksum mismatch.");
await fs.writeFile(
  path.join(target, "standalone-source.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    destination: target,
    files: manifest.files.length,
    sourceSha256: manifest.sourceSha256,
  }),
);

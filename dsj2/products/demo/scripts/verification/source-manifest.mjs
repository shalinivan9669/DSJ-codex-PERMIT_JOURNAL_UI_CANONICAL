import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const excluded = new Set([
  "node_modules",
  ".git",
  ".next",
  ".runtime",
  "dist",
  "data",
  "storage",
  "test-results",
  "playwright-report",
  "__pycache__",
  ".pytest_cache",
]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function sourceManifest(directory = root) {
  const files = [];
  async function walk(relative = "") {
    for (const item of await fs.readdir(path.join(directory, relative), {
      withFileTypes: true,
    })) {
      const name = path.posix.join(relative, item.name);
      if (
        excluded.has(item.name) ||
        item.name.startsWith(".next-") ||
        item.name === "standalone-source.json" ||
        name.startsWith("docs/evidence/") ||
        name.startsWith("docs/deliverables/") ||
        /(?:\.log|\.tsbuildinfo)$/.test(name) ||
        item.name === "next-env.d.ts" ||
        (/^\.env(?:\.|$)/.test(item.name) && item.name !== ".env.example")
      )
        continue;
      if (item.isSymbolicLink())
        throw new Error(`Source symlink refused: ${name}`);
      if (item.isDirectory()) await walk(name);
      else if (item.isFile()) {
        const bytes = await fs.readFile(path.join(directory, name));
        files.push({ path: name, bytes: bytes.length, sha256: hash(bytes) });
      }
    }
  }
  await walk();
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    version: 1,
    algorithm: "sha256",
    sourceSha256: hash(JSON.stringify(files)),
    files,
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const destination = process.argv[2];
  if (!destination)
    throw new Error(
      "Usage: node scripts/verification/source-manifest.mjs OUTPUT.json",
    );
  const result = await sourceManifest();
  await fs.mkdir(path.dirname(path.resolve(destination)), { recursive: true });
  await fs.writeFile(destination, JSON.stringify(result, null, 2) + "\n");
  console.log(
    JSON.stringify({
      files: result.files.length,
      sourceSha256: result.sourceSha256,
      destination,
    }),
  );
}

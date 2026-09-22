import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const excluded = new Set([
  "node_modules",
  ".next",
  "dist",
  ".runtime",
  ".git",
  "data",
  "storage",
  "test-results",
  "playwright-report",
  "docs",
]);
let manifests = 0,
  sourceFiles = 0;
const errors = [];
async function walk(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name) || entry.name.startsWith(".next-")) continue;
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      errors.push(
        `Symbolic link outside build ownership: ${path.relative(root, file)}`,
      );
      continue;
    }
    if (entry.isDirectory()) {
      await walk(file);
      continue;
    }
    if (entry.name === "package.json") {
      manifests++;
      const manifest = JSON.parse(await fs.readFile(file, "utf8"));
      for (const [name, value] of Object.entries({
        ...manifest.dependencies,
        ...manifest.devDependencies,
      }))
        if (name.startsWith("@dsj/") || String(value).startsWith("file:"))
          errors.push(
            `Parent dependency: ${path.relative(root, file)} ${name}`,
          );
    }
    if (!/\.(?:ts|tsx|js|mjs|py)$/.test(entry.name)) continue;
    sourceFiles++;
    const source = await fs.readFile(file, "utf8");
    if (file === fileURLToPath(import.meta.url)) continue;
    const imports = [
      ...source.matchAll(
        /(?:from\s*|import\s*\(|require\s*\()\s*["']([^"']+)["']/g,
      ),
    ].map((match) => match[1]);
    for (const specifier of imports) {
      if (specifier.startsWith("@dsj/"))
        errors.push(`Legacy import: ${path.relative(root, file)}`);
      if (specifier.startsWith(".")) {
        const resolved = path.resolve(path.dirname(file), specifier);
        if (!resolved.startsWith(root))
          errors.push(
            `Escaping relative import: ${path.relative(root, file)} ${specifier}`,
          );
      }
    }
    if (/docs[\\/]experimental|DSJ_DATABASE_URL|REDIS_URL/.test(source))
      errors.push(
        `Legacy runtime path/connection: ${path.relative(root, file)}`,
      );
  }
}
await walk(root);
const templateRoot = path.join(root, "assets", "templates");
const manifest = JSON.parse(
  await fs.readFile(path.join(templateRoot, "manifest.json"), "utf8"),
);
const selected = new Set(manifest.templates.map((template) => template.file));
for (const entry of await fs.readdir(templateRoot))
  if (entry.endsWith(".docx") && !selected.has(entry))
    errors.push(
      `Unselected historical template would enter shipping image: ${entry}`,
    );
if (errors.length) throw new Error(errors.join("\n"));
console.log(
  JSON.stringify({
    autonomous: true,
    manifests,
    sourceFiles,
    externalDsjDependencies: 0,
  }),
);

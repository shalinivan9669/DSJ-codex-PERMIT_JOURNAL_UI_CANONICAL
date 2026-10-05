import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
// Match exact exclusions in both a source checkout and the Docker context.
// Glob patterns still use the explicit directory exclusions below.
const dockerExcludes = new Set(
  (await fs.readFile(path.join(root, ".dockerignore"), "utf8"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !/[*!?]/.test(line)),
);
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
    if (dockerExcludes.has(path.relative(root, file).replaceAll("\\", "/")))
      continue;
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
const templates = [
  ...manifest.templates,
  ...(manifest.groupTemplates || []),
  ...(manifest.specialTemplates || []),
];
const selected = new Set(templates.map((template) => template.file));
for (const template of templates) {
  const file = String(template.file);
  if (path.basename(file) !== file || !file.endsWith(".docx")) {
    errors.push(`Invalid shipping template path: ${file}`);
    continue;
  }
  if (dockerExcludes.has(`assets/templates/${file}`)) {
    errors.push(`Selected template excluded from Docker context: ${file}`);
    continue;
  }
  try {
    const checksum = createHash("sha256")
      .update(await fs.readFile(path.join(templateRoot, file)))
      .digest("hex");
    if (checksum !== template.sha256)
      errors.push(`Shipping template checksum mismatch: ${file}`);
  } catch {
    errors.push(`Missing shipping template: ${file}`);
  }
}
for (const entry of await fs.readdir(templateRoot))
  if (
    entry.endsWith(".docx") &&
    !selected.has(entry) &&
    !dockerExcludes.has(`assets/templates/${entry}`)
  )
    errors.push(
      `Unselected historical template would enter shipping image: ${entry}`,
    );
if (errors.length) throw new Error(errors.join("\n"));
console.log(
  JSON.stringify({
    autonomous: true,
    manifests,
    sourceFiles,
    selectedTemplates: selected.size,
    externalDsjDependencies: 0,
  }),
);

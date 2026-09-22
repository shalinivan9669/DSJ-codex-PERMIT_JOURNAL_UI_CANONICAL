import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = fileURLToPath(new URL("../../", import.meta.url));
const input = process.argv[2];
if (!input)
  throw new Error(
    "Usage: node scripts/verification/software-bill.mjs PNPM_LICENSES_ALL.json",
  );
const groups = JSON.parse(
  (await fs.readFile(input, "utf8")).replace(/^\uFEFF/, ""),
);
const components = [];
const missingLicenseText = [];
const notices = [
  "DEMO third-party component notices",
  "Generated from the resolved application dependency installation, including build tools.",
  "The SBOM covers application packages and fonts. Container operating-system packages require an image scan.",
  "Original forms and logos are not licensed by this notice. The issuer must establish their applicable rights and legal approval.",
];
for (const entries of Object.values(groups)) {
  for (const entry of entries) {
    for (const version of entry.versions) {
      const purl = `pkg:npm/${entry.name.replace("@", "%40")}@${version}`;
      components.push({
        type: "library",
        name: entry.name,
        version,
        "bom-ref": purl,
        purl,
        licenses: [{ expression: entry.license || "NOASSERTION" }],
        ...(entry.homepage
          ? { externalReferences: [{ type: "website", url: entry.homepage }] }
          : {}),
      });
    }
    notices.push(
      `\n===== ${entry.name} ${entry.versions.join(", ")} (${entry.license}) =====`,
    );
    if (entry.author)
      notices.push(
        `Author: ${typeof entry.author === "string" ? entry.author : JSON.stringify(entry.author)}`,
      );
    if (entry.homepage) notices.push(`Source: ${entry.homepage}`);
    const copied = new Set();
    for (const directory of entry.paths || []) {
      for (const item of await fs.readdir(directory, { withFileTypes: true })) {
        if (
          !item.isFile() ||
          !/^(?:licen[cs]e|copying|notice|copyright)(?:[.-]|$)/i.test(item.name)
        )
          continue;
        const bytes = await fs.readFile(path.join(directory, item.name));
        const checksum = createHash("sha256").update(bytes).digest("hex");
        if (copied.has(checksum)) continue;
        copied.add(checksum);
        notices.push(`${item.name}\n${bytes.toString("utf8")}`);
      }
    }
    if (!copied.size) {
      missingLicenseText.push(entry.name);
      notices.push(
        "License expression is recorded from package metadata; the package did not include a top-level license text.",
      );
    }
  }
}
const requirements = await fs.readFile(
  path.join(root, "scripts/render/requirements.txt"),
  "utf8",
);
const pythonLicenses = {
  Pillow: "MIT-CMU",
  lxml: "BSD-3-Clause",
  openpyxl: "MIT",
  defusedxml: "PSF-2.0",
  et_xmlfile: "MIT",
};
for (const line of requirements
  .split(/\r?\n/)
  .filter((v) => v.includes("=="))) {
  const [name, version] = line.split("==");
  const purl = `pkg:pypi/${name.toLowerCase()}@${version}`;
  components.push({
    type: "library",
    name,
    version,
    "bom-ref": purl,
    purl,
    licenses: [{ expression: pythonLicenses[name] || "NOASSERTION" }],
  });
  notices.push(
    `\n===== ${name} ${version} =====\nSource and distribution license: https://pypi.org/project/${name}/${version}/\nThe Python package distribution retains its own license files in site-packages.`,
  );
}
const fontManifest = JSON.parse(
  await fs.readFile(path.join(root, "assets/fonts/manifest.json"), "utf8"),
);
components.push({
  type: "library",
  name: "Liberation Fonts",
  version: fontManifest.version,
  licenses: [{ expression: "OFL-1.1" }],
  externalReferences: [{ type: "website", url: fontManifest.source }],
});
notices.push(
  "\n===== Liberation Fonts =====\n" +
    (await fs.readFile(path.join(root, "assets/fonts/LICENSE"), "utf8")),
);
components.sort(
  (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
);
await fs.writeFile(
  path.join(root, "SBOM.cdx.json"),
  JSON.stringify(
    {
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      version: 1,
      metadata: {
        component: { type: "application", name: "DEMO", version: "2.0.0" },
      },
      components,
    },
    null,
    2,
  ) + "\n",
);
await fs.writeFile(
  path.join(root, "THIRD_PARTY_NOTICES.txt"),
  notices.join("\n\n") + "\n",
);
console.log(
  JSON.stringify({
    components: components.length,
    missingLicenseText,
    scope:
      "resolved npm including build tools, pinned Python requirements, bundled fonts; not OS images",
  }),
);

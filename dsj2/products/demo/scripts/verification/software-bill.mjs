import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = fileURLToPath(new URL("../../", import.meta.url));
const collect = process.argv[2] === "--collect";
const inputs = process.argv.slice(collect ? 3 : 2);
if (!inputs.length || (collect && inputs.length !== 2))
  throw new Error(
    "Usage: node scripts/verification/software-bill.mjs [--collect INPUT.json OUTPUT.json] | INPUT.json [ADDITIONAL_COLLECTED.json]",
  );
const checksum = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inventories = [];
for (const input of collect ? inputs.slice(0, 1) : inputs) {
  const data = JSON.parse(
    (await fs.readFile(input, "utf8")).replace(/^\uFEFF/, ""),
  );
  inventories.push({
    platform: data.platform || `${process.platform}-${process.arch}`,
    source: path.basename(input),
    groups: data.groups || data,
  });
}
const entries = inventories.flatMap((inventory) =>
  Object.values(inventory.groups)
    .flat()
    .map((entry) => ({
      ...entry,
      platform: inventory.platform,
      inventory: inventory.source,
    })),
);
const sourceReport = [];
const readTexts = async (entry) => {
  if (entry.licenseTexts) return entry.licenseTexts;
  const texts = [];
  for (const directory of entry.paths || []) {
    for (const item of await fs.readdir(directory, { withFileTypes: true })) {
      if (!item.isFile()) continue;
      if (
        /^(?:licen[cs]e|copying|notice|copyright|third[-_]party[-_](?:notices?|licenses?))(?:[.-]|$)/i.test(
          item.name,
        )
      ) {
        texts.push({
          source: `${entry.name}/${item.name}`,
          text: await fs.readFile(path.join(directory, item.name), "utf8"),
        });
      } else if (
        /^readme(?:\.|$)/i.test(item.name) &&
        entry.name.startsWith("@img/sharp-libvips-")
      ) {
        texts.push({
          source: `${entry.name}/${item.name} upstream license inventory (not full license texts)`,
          text: await fs.readFile(path.join(directory, item.name), "utf8"),
          isFullLicense: false,
        });
      } else if (
        /^readme(?:\.|$)/i.test(item.name) &&
        ["@tokenizer/token", "imurmurhash", "esrecurse"].includes(entry.name)
      ) {
        const readme = await fs.readFile(
          path.join(directory, item.name),
          "utf8",
        );
        const start = readme.search(
          /^(?:#{1,6}\s+)?Licen[cs]e(?:\s*\(MIT\))?\s*$/im,
        );
        const section = start >= 0 ? readme.slice(start).trim() : "";
        if (
          !/Copyright/i.test(section) ||
          !/(?:Permission is hereby granted|Redistribution and use)/.test(
            section,
          ) ||
          !/THIS SOFTWARE IS PROVIDED|THE SOFTWARE IS PROVIDED/.test(section)
        )
          throw new Error(`Incomplete README license: ${entry.name}`);
        texts.push({
          source: `${entry.name}/${item.name} license section`,
          text: section,
        });
      }
    }
  }
  return texts;
};
for (const entry of entries) entry.licenseTexts = await readTexts(entry);
if (collect) {
  await fs.writeFile(
    inputs[1],
    JSON.stringify(
      {
        platform: `${process.platform}-${process.arch}`,
        groups: { collected: entries },
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      collected: entries.length,
      platform: `${process.platform}-${process.arch}`,
      output: inputs[1],
    }),
  );
  process.exit(0);
}
const supplemental = JSON.parse(
  await fs.readFile(path.join(root, "licenses/provenance.json"), "utf8"),
);
const peerLicense = (entry) => {
  const name = entry.name.startsWith("@esbuild/")
    ? "esbuild"
    : entry.name === "@next/env" || entry.name.startsWith("@next/swc-")
      ? "next"
      : entry.name === "@humanfs/types"
        ? "@humanfs/core"
        : null;
  if (!name) return null;
  return entries.find(
    (candidate) =>
      candidate.name === name &&
      candidate.platform === entry.platform &&
      candidate.license === entry.license &&
      candidate.licenseTexts.length &&
      (entry.name === "@humanfs/types" ||
        entry.versions.every((version) =>
          candidate.versions.includes(version),
        )),
  );
};
const components = [];
const componentByPurl = new Map();
const missingLicenseText = [];
const notices = [
  "DEMO third-party component notices",
  `Generated from resolved dependency installations, including build tools: ${inventories.map((inventory) => `${inventory.platform} (${inventory.source})`).join("; ")}.`,
  "The SBOM covers application packages and fonts. Container operating-system packages require an image scan.",
  "Original forms and logos are not licensed by this notice. The issuer must establish their applicable rights and legal approval.",
];
for (const entry of entries) {
  for (const version of entry.versions) {
    const purl = `pkg:npm/${entry.name.replace("@", "%40")}@${version}`;
    const existing = componentByPurl.get(purl);
    if (existing) {
      if (
        !existing.properties.some(
          (property) => property.value === entry.platform,
        )
      )
        existing.properties.push({
          name: "demo:resolved-platform",
          value: entry.platform,
        });
      continue;
    }
    const component = {
      type: "library",
      name: entry.name,
      version,
      "bom-ref": purl,
      purl,
      licenses: [{ expression: entry.license || "NOASSERTION" }],
      properties: [{ name: "demo:resolved-platform", value: entry.platform }],
      ...(entry.homepage
        ? { externalReferences: [{ type: "website", url: entry.homepage }] }
        : {}),
    };
    components.push(component);
    componentByPurl.set(purl, component);
  }
  notices.push(
    `\n===== ${entry.name} ${entry.versions.join(", ")} (${entry.license}) =====`,
  );
  if (entry.author)
    notices.push(
      `Author: ${typeof entry.author === "string" ? entry.author : JSON.stringify(entry.author)}`,
    );
  if (entry.homepage) notices.push(`Source: ${entry.homepage}`);
  notices.push(`Resolved installation: ${entry.platform}`);
  const copied = new Set();
  const peer = entry.licenseTexts.length ? null : peerLicense(entry);
  const texts = [...entry.licenseTexts];
  if (peer) {
    notices.push(
      `Project license supplied by resolved ${peer.name}@${peer.versions.join(", ")}; same project and declared license. ${entry.name === "@humanfs/types" ? "HumanFS packages share the root Apache-2.0 license." : "Version matches the platform package."}`,
    );
    texts.push(...peer.licenseTexts);
  }
  const supplement = supplemental.packages.find(
    (item) =>
      item.name === entry.name &&
      entry.versions.every((version) => item.versions.includes(version)),
  );
  if (!texts.some((item) => item.isFullLicense !== false) && supplement?.file) {
    const bytes = await fs.readFile(
      path.join(root, "licenses", supplement.file),
    );
    if (checksum(bytes) !== supplement.sha256)
      throw new Error(`Supplemental license checksum mismatch: ${entry.name}`);
    texts.push({
      source: supplement.source,
      text: `${supplement.attribution}\n\n${bytes.toString("utf8")}`,
    });
    notices.push(`Provenance: ${supplement.explanation}`);
  }
  if (supplement?.distributionStatus)
    notices.push(`Distribution review: ${supplement.distributionStatus}`);
  for (const item of texts) {
    const hash = checksum(item.text);
    if (copied.has(hash)) continue;
    copied.add(hash);
    notices.push(`${item.source}\n${item.text}`);
    sourceReport.push({
      name: entry.name,
      versions: entry.versions,
      platform: entry.platform,
      source: item.source,
      sha256: hash,
      isFullLicense: item.isFullLicense !== false,
    });
  }
  if (!copied.size || !texts.some((item) => item.isFullLicense !== false)) {
    if (!missingLicenseText.includes(entry.name))
      missingLicenseText.push(entry.name);
    notices.push(
      "Full license/copyright text is not included in this notice. Metadata or the upstream license inventory alone is not treated as a complete license notice.",
    );
    if (supplement?.explanation)
      notices.push(`Unresolved provenance: ${supplement.explanation}`);
  }
}
// Native libraries bundled into sharp are not all visible to an OS package scan.
// Preserve the installed/build inventory and its confidence limits explicitly.
if (
  entries.some(
    (entry) =>
      entry.name === "@img/sharp-libvips-linux-x64" &&
      entry.versions.includes("1.3.3"),
  )
) {
  const native = JSON.parse(
    await fs.readFile(
      path.join(root, "licenses/sharp-libvips/collection.json"),
      "utf8",
    ),
  );
  for (const component of native.components) {
    components.push({
      type: "library",
      name: component.name,
      ...(component.version ? { version: component.version } : {}),
      "bom-ref": `urn:demo:sharp-libvips:1.3.3:${encodeURIComponent(component.name)}`,
      licenses: [
        {
          license: { name: component.packageDeclaredLicense || "NOASSERTION" },
        },
      ],
      externalReferences: [{ type: "website", url: component.repository }],
      properties: [
        {
          name: "demo:bundled-in",
          value: "@img/sharp-libvips-linux-x64@1.3.3",
        },
        {
          name: "demo:version-source",
          value: component.installedVersionMatches
            ? "Exact installed versions.json and upstream source"
            : "Embedded upstream source; no independent standalone version",
        },
        {
          name: "demo:inventory-limitation",
          value:
            "Build inventory is preserved; static contribution/per-file and transitive attribution are not fully verified. Distribution review remains blocked.",
        },
      ],
    });
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
        properties: inventories.map((inventory) => ({
          name: "demo:resolved-inventory",
          value: `${inventory.platform}:${inventory.source}`,
        })),
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
await fs.writeFile(
  path.join(
    root,
    "docs/evidence/commercial-acceptance/license-text-sources.json",
  ),
  JSON.stringify(sourceReport, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    components: components.length,
    missingLicenseText,
    inventories: inventories.map(({ platform, source }) => ({
      platform,
      source,
    })),
    scope:
      "resolved npm including build tools, pinned Python requirements, bundled fonts; not OS images",
  }),
);

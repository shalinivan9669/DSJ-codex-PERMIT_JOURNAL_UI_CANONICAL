import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const root = fileURLToPath(new URL("../../", import.meta.url));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const dockerignore = await fs.readFile(
  path.join(root, ".dockerignore"),
  "utf8",
);
const exclusions = new Set(
  dockerignore.split(/\r?\n/).map((line) => line.trim()),
);
const manifest = JSON.parse(
  await fs.readFile(path.join(root, "assets/templates/manifest.json"), "utf8"),
);
const active = [
  ...manifest.templates,
  ...(manifest.groupTemplates || []),
  ...(manifest.specialTemplates || []),
];

async function context(t) {
  const directory = await fs.mkdtemp(
    path.join(tmpdir(), "demo-template-packaging-"),
  );
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith("demo-template-packaging-"));
    await fs.rm(directory, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(directory, "scripts/verification"), {
    recursive: true,
  });
  await fs.mkdir(path.join(directory, "assets/templates"), { recursive: true });
  await fs.writeFile(path.join(directory, ".dockerignore"), dockerignore);
  await fs.writeFile(
    path.join(directory, "package.json"),
    '{"private":true,"type":"module"}',
  );
  await fs.copyFile(
    path.join(root, "scripts/verification/autonomy.mjs"),
    path.join(directory, "scripts/verification/autonomy.mjs"),
  );
  for (const entry of await fs.readdir(path.join(root, "assets/templates"))) {
    if (exclusions.has(`assets/templates/${entry}`)) continue;
    const source = path.join(root, "assets/templates", entry);
    if ((await fs.stat(source)).isFile())
      await fs.copyFile(
        source,
        path.join(directory, "assets/templates", entry),
      );
  }
  return directory;
}

function autonomy(directory) {
  return spawnSync(
    process.execPath,
    [path.join(directory, "scripts/verification/autonomy.mjs")],
    { cwd: directory, encoding: "utf8" },
  );
}

test("Docker template context keeps every active source and excludes superseded neutral files", async (t) => {
  const directory = await context(t);
  const result = autonomy(directory);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    JSON.parse(result.stdout).selectedTemplates,
    new Set(active.map((form) => form.file)).size,
  );
  for (const form of active) {
    assert.equal(exclusions.has(`assets/templates/${form.file}`), false);
    assert.equal(
      hash(
        await fs.readFile(path.join(directory, "assets/templates", form.file)),
      ),
      form.sha256,
    );
  }
  const neutralHistory = manifest.archivedTemplates.filter(
    (form) => form.renderPolicy === "NEUTRAL_FORMS_V1",
  );
  assert.equal(neutralHistory.length, 14);
  for (const form of neutralHistory) {
    assert.ok(exclusions.has(`assets/templates/${form.file}`));
    await assert.rejects(
      fs.access(path.join(directory, "assets/templates", form.file)),
    );
  }
});

test("autonomy still rejects unselected files, corrupted active bytes and excluded active sources", async (t) => {
  const directory = await context(t);
  const unexpected = path.join(
    directory,
    "assets/templates/unselected-history.docx",
  );
  await fs.writeFile(unexpected, "unselected");
  assert.match(
    autonomy(directory).stderr,
    /Unselected historical template would enter shipping image/,
  );
  await fs.unlink(unexpected);
  const selected = path.join(directory, "assets/templates", active[0].file);
  const bytes = await fs.readFile(selected);
  await fs.writeFile(selected, "corrupt");
  assert.match(
    autonomy(directory).stderr,
    /Shipping template checksum mismatch/,
  );
  await fs.writeFile(selected, bytes);
  await fs.appendFile(
    path.join(directory, ".dockerignore"),
    `\nassets/templates/${active[0].file}\n`,
  );
  assert.match(
    autonomy(directory).stderr,
    /Selected template excluded from Docker context/,
  );
});

test("a stored historical neutral snapshot renders identically without its old bundled DOCX", async (t) => {
  const directory = await context(t);
  await fs.cp(
    path.join(root, "assets/fonts"),
    path.join(directory, "assets/fonts"),
    { recursive: true },
  );
  await fs.cp(
    path.join(root, "scripts/render"),
    path.join(directory, "scripts/render"),
    {
      recursive: true,
      filter: (source) =>
        !source.includes("__pycache__") &&
        !exclusions.has(path.relative(root, source).replaceAll("\\", "/")),
    },
  );
  const historical = manifest.archivedTemplates.find(
    (form) => form.id === "pb-card" && form.renderPolicy === "NEUTRAL_FORMS_V1",
  );
  assert.ok(historical);
  const source = await fs.readFile(
    path.join(root, "assets/templates", historical.file),
  );
  assert.equal(hash(source), historical.sha256);
  const storage = path.join(directory, "private-store");
  await fs.mkdir(storage);
  await fs.writeFile(path.join(storage, "stored-neutral.docx"), source);
  const snapshot = {
    mode: "issued-document",
    demoMode: false,
    templateId: historical.id,
    templateVersion: historical.version,
    templateStorageKey: "stored-neutral.docx",
    templateChecksum: historical.sha256,
    issuer: {
      nameRu: "Синтетический центр",
      nameKz: "Сынақ орталығы",
      cityRu: "Астана",
      cityKz: "Астана",
      approvalBasis: "Синтетическое основание",
      commission: [
        { name: "Тестов А. Б.", position: "Председатель" },
        { name: "Тестова В. Г.", position: "Член комиссии" },
        { name: "Үлгі Ә. Б.", position: "Член комиссии" },
      ],
    },
    items: [
      {
        id: "historical",
        fullNameRu: "Тестовый Получатель",
        fullNameKz: "Сынақ Алушы",
        positionRu: "Инженер",
        positionKz: "Инженер",
        workplaceRu: "Тестовая организация",
        workplaceKz: "Сынақ ұйымы",
        number: "HISTORY-001",
        protocolNumber: "PROTOCOL-001",
        assignment: {
          id: "historical-assignment",
          templateId: "pb-card",
          documentDate: "2026-10-05",
          protocolDate: "2026-10-04",
          trainingStart: "2026-10-01",
          trainingEnd: "2026-10-03",
          trainingSubject: "Безопасность / Қауіпсіздік",
          hours: 40,
          validUntil: "2027-10-05",
          result: "Сдал",
          outcome: { status: "PASSED" },
          reason: "Проверка",
        },
      },
    ],
    photos: {},
  };
  const input = path.join(directory, "snapshot.json");
  await fs.writeFile(input, JSON.stringify(snapshot));
  const python = process.env.DEMO_PYTHON || "python";
  const code =
    "import json,sys;from pathlib import Path;sys.path.insert(0,sys.argv[1]);from renderer import render_docx;result=render_docx(json.loads(Path(sys.argv[2]).read_text(encoding='utf8')),Path(sys.argv[3]));assert result['renderPolicy']=='NEUTRAL_FORMS_V1';print('historical-neutral-rendered')";
  const outputs = [];
  for (const [name, location] of [
    ["checkout", root],
    ["shipping", directory],
  ]) {
    const output = path.join(directory, `${name}.docx`);
    const result = spawnSync(
      python,
      ["-c", code, path.join(location, "scripts/render"), input, output],
      {
        cwd: directory,
        encoding: "utf8",
        env: { ...process.env, PYTHONUTF8: "1", DEMO_ARTIFACT_ROOT: storage },
      },
    );
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    outputs.push(await fs.readFile(output));
  }
  assert.deepEqual(outputs[1], outputs[0]);
  await assert.rejects(
    fs.access(path.join(directory, "assets/templates", historical.file)),
  );
  assert.equal(
    hash(await fs.readFile(path.join(storage, "stored-neutral.docx"))),
    historical.sha256,
  );
});

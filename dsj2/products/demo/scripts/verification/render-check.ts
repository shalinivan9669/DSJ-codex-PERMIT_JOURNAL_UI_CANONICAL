import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
const root = resolve(__dirname, "../..");
const result = spawnSync(
  process.env.DEMO_PYTHON ||
    (process.platform === "win32" ? "python" : "python3"),
  [
    "-X",
    "utf8",
    "-m",
    "unittest",
    "discover",
    "-s",
    resolve(root, "tests/render"),
    "-p",
    "test_*.py",
    "-v",
  ],
  { cwd: root, stdio: "inherit", windowsHide: true, env: process.env },
);
if (result.error)
  console.error(
    "Required Python/converter unavailable; render checks cannot be skipped.",
  );
process.exit(result.status ?? 1);

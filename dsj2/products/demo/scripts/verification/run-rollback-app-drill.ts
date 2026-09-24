import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PRODUCT_ROOT } from "@demo/printing";

const output = join(PRODUCT_ROOT, "docs/evidence/final-completion/recovery");
const oldProduct = resolve(process.argv[2]);
assert.equal(
  oldProduct,
  join(PRODUCT_ROOT, ".runtime/rollback-base-59a961a/dsj2/products/demo"),
);
const children: ChildProcess[] = [];
const env = {
  ...process.env,
  DATABASE_URL:
    "postgresql://postgres@127.0.0.1:55439/demo_test_restore_rollback_base",
  TSX_TSCONFIG_PATH: join(oldProduct, "tsconfig.base.json"),
  DEMO_ARTIFACT_ROOT: join(
    PRODUCT_ROOT,
    ".runtime/rollback-restored-artifacts",
  ),
  DEMO_ORIGIN: "http://127.0.0.1:3131",
  DEMO_API_ORIGIN: "http://127.0.0.1:4131",
  HOST: "127.0.0.1",
  PORT: "4131",
  DEMO_RENDER_CONCURRENCY: "1",
  DEMO_CONTAINER_ACCEPTANCE: "SYNTHETIC_ONLY",
  DEMO_RECOVERY_WEB_ORIGIN: "http://127.0.0.1:3131",
};
function start(name: string, args: string[], cwd: string, environment = env) {
  const process = spawn(globalThis.process.execPath, args, {
    cwd,
    env: environment,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(process);
  process.stdout!.pipe(createWriteStream(join(output, `${name}.log`)));
  process.stderr!.pipe(createWriteStream(join(output, `${name}.error.log`)));
  return process;
}
async function completed(child: ChildProcess) {
  const code = await new Promise<number | null>((resolveResult, reject) => {
    child.once("error", reject);
    child.once("exit", resolveResult);
  });
  assert.equal(code, 0, "Drill subprocess failed; inspect its named log");
}
async function stop(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    const terminator = spawn(
      "taskkill",
      ["/pid", String(child.pid), "/T", "/F"],
      { windowsHide: true, stdio: "ignore" },
    );
    await new Promise<void>((resolveResult) => {
      terminator.once("error", () => resolveResult());
      terminator.once("exit", () => resolveResult());
    });
  } else child.kill("SIGKILL");
}
async function main() {
  const started = Date.now();
  const auth = JSON.parse(
    await readFile(join(PRODUCT_ROOT, ".runtime/backup-v2-auth.json"), "utf8"),
  );
  Object.assign(env, {
    DEMO_ADMIN_EMAIL: auth.email,
    DEMO_ADMIN_PASSWORD: auth.password,
  });
  await copyFile(
    join(PRODUCT_ROOT, "scripts/verification/verify-restored-http.ts"),
    join(oldProduct, "scripts/verification/verify-restored-http.ts"),
  );
  const worker = start(
    "old-worker",
    ["--import", "tsx", "src/main.ts"],
    join(oldProduct, "apps/render-worker"),
  );
  const web = start(
    "old-web",
    [
      "node_modules/next/dist/bin/next",
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3131",
    ],
    join(oldProduct, "apps/web"),
  );
  const deadline = Date.now() + 45000;
  let ready = false;
  while (Date.now() < deadline) {
    assert.equal(worker.exitCode, null, "Legacy worker failed startup");
    assert.equal(web.exitCode, null, "Legacy web failed startup");
    const log = await readFile(join(output, "old-worker.log"), "utf8").catch(
      () => "",
    );
    if (log.includes("worker.started")) {
      try {
        if (
          (
            await fetch("http://127.0.0.1:3131/login", {
              signal: AbortSignal.timeout(3000),
            })
          ).status === 200
        ) {
          ready = true;
          break;
        }
      } catch {
        /* server is still starting */
      }
    }
    await new Promise((resolveResult) => setTimeout(resolveResult, 500));
  }
  assert.ok(ready, "Old application readiness deadline");
  await completed(
    start(
      "old-http",
      [
        "node_modules/tsx/dist/cli.mjs",
        "--tsconfig",
        "tsconfig.base.json",
        "scripts/verification/verify-restored-http.ts",
        join(PRODUCT_ROOT, ".runtime/rollback-http-fixture.json"),
        join(output, "rollback-old-http.json"),
      ],
      oldProduct,
    ),
  );
  await completed(
    start(
      "old-boundary",
      [
        "node_modules/tsx/dist/cli.mjs",
        "--tsconfig",
        "tsconfig.base.json",
        "scripts/verification/verify-rollback-boundary.ts",
        "after",
        join(output, "populated-upgrade-12.json"),
        join(PRODUCT_ROOT, ".runtime/rollback-pending-jobs.json"),
        join(output, "rollback-boundary.json"),
      ],
      PRODUCT_ROOT,
      {
        ...env,
        DATABASE_URL:
          "postgresql://postgres@127.0.0.1:55439/demo_test_upgrade_rollback_source",
      },
    ),
  );
  const result = {
    status: "PASS",
    durationMs: Date.now() - started,
    oldCommit: "59a961a07b4f8103db9fbdbe0fe4dc09406816f1",
    oldProduct,
    apiPort: 4131,
    webPort: 3131,
    realWorker: true,
    realOldApiReadback: true,
    realOldWebAuthenticatedProxy: true,
    isolatedChildrenStoppedInFinally: true,
  };
  await writeFile(
    join(output, "rollback-application.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
}
const deadline = setTimeout(() => {
  void Promise.all(children.map(stop)).finally(() => process.exit(1));
}, 90000);
void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    clearTimeout(deadline);
    await Promise.all(children.map(stop));
  });

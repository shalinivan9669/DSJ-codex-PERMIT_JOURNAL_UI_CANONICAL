import { spawn } from "node:child_process";
import {
  chmod,
  chown,
  mkdir,
  readFile,
  realpath,
  stat,
} from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const log = (event, fields = {}) =>
  console.log(JSON.stringify({ event, ...fields }));

export function validateEnvironment(env) {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
  let origin;
  try {
    origin = new URL(env.DEMO_ORIGIN);
  } catch {
    throw new Error("DEMO_ORIGIN_HTTPS_REQUIRED");
  }
  if (origin.protocol !== "https:" || origin.origin !== env.DEMO_ORIGIN)
    throw new Error("DEMO_ORIGIN_HTTPS_REQUIRED");
  if (
    env.RAILWAY_VOLUME_MOUNT_PATH !== "/data" ||
    env.DEMO_ARTIFACT_ROOT !== "/data/artifacts"
  )
    throw new Error("DURABLE_VOLUME_AT_DATA_REQUIRED");
  const port = Number(env.PORT || 4100);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("INVALID_PORT");
}

export async function prepareVolume() {
  if (process.platform !== "linux") throw new Error("LINUX_CONTAINER_REQUIRED");
  const mounts = await readFile("/proc/self/mountinfo", "utf8");
  if (!mounts.split("\n").some((line) => line.split(" ")[4] === "/data"))
    throw new Error("DATA_IS_NOT_A_MOUNT");
  for (const directory of ["/data", "/data/artifacts"]) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if ((await realpath(directory)) !== directory)
      throw new Error("VOLUME_SYMLINK_REFUSED");
    if (process.getuid() === 0) {
      await chown(directory, 1000, 1000);
      await chmod(directory, 0o700);
    }
    const info = await stat(directory);
    if (!info.isDirectory() || info.uid !== 1000)
      throw new Error("VOLUME_OWNER_MUST_BE_NODE");
  }
  if (process.getuid() === 0) {
    process.setgroups([]);
    process.setgid(1000);
    process.setuid(1000);
  }
  if (process.getuid() !== 1000) throw new Error("RUNTIME_UID_MUST_BE_NODE");
  process.umask(0o077);
  process.env.HOME = "/home/node";
}

function signalGroup(child, signal) {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

function groupAlive(child) {
  if (!child.pid) return false;
  if (process.platform === "win32")
    return child.exitCode === null && child.signalCode === null;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Exit the whole service if either required process exits, including exit 0. */
export async function supervise(commands, { graceMs = 45_000 } = {}) {
  const children = [];
  let stopping = false;
  let result = 0;
  let stopAt = 0;
  const stop = (failed) => {
    if (stopping) return;
    stopping = true;
    result = failed ? 1 : 0;
    stopAt = Date.now() + graceMs;
    for (const child of children) signalGroup(child, "SIGTERM");
  };
  const onSignal = () => stop(false);
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  try {
    for (const command of commands) {
      const child = spawn(command.command, command.args, {
        cwd: command.cwd || root,
        env: process.env,
        stdio: "inherit",
        detached: process.platform !== "win32",
      });
      children.push(child);
      child.on("error", () => {
        log("backend.child_start_failed", { name: command.name });
        stop(true);
      });
      child.on("exit", (code, signal) => {
        if (!stopping) {
          log("backend.child_exited", { name: command.name, code, signal });
          stop(true);
        }
      });
    }
    log("backend.supervisor_started", { processes: commands.length });
    while (!stopping) await delay(100);
    while (children.some(groupAlive) && Date.now() < stopAt) await delay(100);
    for (const child of children) signalGroup(child, "SIGKILL");
    return result;
  } finally {
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
  }
}

async function main() {
  validateEnvironment(process.env);
  await prepareVolume();
  process.chdir(root);
  // Explicit administrative one-shot commands also run as the same file owner.
  // No migration, provisioning, sample data or template approval runs at boot.
  if (process.argv[2] === "--") {
    if (!process.argv[3]) throw new Error("ADMIN_COMMAND_REQUIRED");
    const child = spawn(process.argv[3], process.argv.slice(4), {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    });
    const forward = () => child.kill("SIGTERM");
    process.on("SIGTERM", forward);
    process.on("SIGINT", forward);
    return await new Promise((done) => {
      child.on("error", () => done(1));
      child.on("exit", (code) => done(code ?? 1));
    });
  }
  const tsx = resolve(root, "node_modules/tsx/dist/cli.mjs");
  return supervise([
    {
      name: "api",
      command: process.execPath,
      args: [tsx, "src/main.ts"],
      cwd: resolve(root, "apps/api"),
    },
    {
      name: "worker",
      command: process.execPath,
      args: [tsx, "src/main.ts"],
      cwd: resolve(root, "apps/render-worker"),
    },
  ]);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      log("backend.start_failed", { code: error.message });
      process.exitCode = 1;
    });

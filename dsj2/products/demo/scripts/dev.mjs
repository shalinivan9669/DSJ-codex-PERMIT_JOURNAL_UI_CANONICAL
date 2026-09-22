import { spawn } from "node:child_process";
const processes = ["api", "web", "render-worker"].map((name) =>
  spawn(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    ["--filter", `@demo/${name}`, "dev"],
    {
      stdio: "inherit",
      shell: process.platform === "win32",
      windowsHide: true,
    },
  ),
);
let closing = false;
function stop() {
  if (closing) return;
  closing = true;
  for (const child of processes) child.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of processes)
  child.on("exit", (code) => {
    if (!closing) {
      process.exitCode = code || 1;
      stop();
    }
  });

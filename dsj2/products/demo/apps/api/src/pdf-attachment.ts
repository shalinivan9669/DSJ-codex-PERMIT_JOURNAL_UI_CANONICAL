import { spawn } from "node:child_process";
import { join } from "node:path";
import { PRODUCT_ROOT } from "@demo/printing";
import { fail } from "./core";

// Per API process: at most two 256 MiB / three CPU-second parser processes.
// Refuse excess work rather than retaining arbitrary uploaded files in a queue.
let activeParsers = 0;
export async function validatePdfAttachment(bytes: Buffer): Promise<void> {
  return validateAttachment(bytes, "PDF");
}
export async function validateRasterAttachment(bytes: Buffer): Promise<void> {
  return validateAttachment(bytes, "IMAGE");
}
async function validateAttachment(
  bytes: Buffer,
  kind: "PDF" | "IMAGE",
): Promise<void> {
  if (activeParsers >= 2)
    fail(
      503,
      `${kind}_VALIDATOR_BUSY`,
      "Проверка вложений занята. Повторите загрузку.",
    );
  activeParsers++;
  try {
    const code = await new Promise<string>((resolveResult) => {
      let settled = false;
      const child = spawn(
        process.env.DEMO_PYTHON ||
          (process.platform === "win32" ? "python" : "python3"),
        [
          "-I",
          "-X",
          "utf8",
          join(
            PRODUCT_ROOT,
            `scripts/security/validate_${kind === "PDF" ? "pdf" : "image"}.py`,
          ),
        ],
        {
          cwd: PRODUCT_ROOT,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      let stdout = Buffer.alloc(0);
      let stderrBytes = 0;
      let stoppedCode: string | undefined;
      const finish = (result: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveResult(result);
      };
      const stop = (result: string) => {
        stoppedCode ??= result;
        child.kill("SIGKILL");
      };
      const timer = setTimeout(() => stop(`${kind}_RESOURCE_LIMIT`), 5000);
      child.on("error", () => finish(`${kind}_VALIDATOR_UNAVAILABLE`));
      child.stdin.on("error", () => {
        /* The bounded child may reject before reading all bytes. */
      });
      child.stdout.on("data", (chunk: Buffer) => {
        if (stdout.length + chunk.length > 2048) stop(`${kind}_RESOURCE_LIMIT`);
        else stdout = Buffer.concat([stdout, chunk]);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderrBytes += chunk.length;
        if (stderrBytes > 2048) stop(`${kind}_RESOURCE_LIMIT`);
      });
      child.on("close", (exitCode) => {
        if (stoppedCode) return finish(stoppedCode);
        if (exitCode !== 0) return finish(`${kind}_RESOURCE_LIMIT`);
        try {
          const result = JSON.parse(stdout.toString("utf8"));
          if (typeof result.code !== "string")
            throw new Error("invalid result");
          finish(result.code);
        } catch {
          finish(`${kind}_VALIDATOR_UNAVAILABLE`);
        }
      });
      child.stdin.end(bytes);
    });
    if (code === `${kind}_SAFE`) return;
    if (code === `${kind}_VALIDATOR_UNAVAILABLE`)
      fail(
        503,
        code,
        "Проверка вложения временно недоступна. Файл не сохранён.",
      );
    if (code === "ACTIVE_PDF_REJECTED")
      fail(
        400,
        code,
        "PDF с действиями, активным содержимым или вложенными файлами не принимается.",
      );
    if (code === "PDF_ENCRYPTED_REJECTED")
      fail(
        400,
        code,
        "Зашифрованный PDF не принимается. Предоставьте открытый документ.",
      );
    if (code === `${kind}_RESOURCE_LIMIT`)
      fail(
        400,
        code,
        "Вложение превышает допустимую сложность. Предоставьте упрощённый документ.",
      );
    fail(
      400,
      `${kind}_INVALID`,
      "Вложение повреждено или использует неподдерживаемые возможности.",
    );
  } finally {
    activeParsers--;
  }
}

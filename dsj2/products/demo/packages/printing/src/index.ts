import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const RENDERER_VERSION = "demo-ooxml-3/libreoffice-26.2.6.3";
export const PRODUCT_ROOT = resolve(__dirname, "../../..");
export type RenderCommand =
  | "docx"
  | "pdf"
  | "photo"
  | "import"
  | "xlsx"
  | "zip"
  | "health"
  | "preflight";
export const MIME: Record<string, string> = {
  DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  PDF: "application/pdf",
  XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ZIP: "application/zip",
  PNG: "image/png",
  JSON: "application/json",
};

export class ArtifactStore {
  readonly root: string;
  constructor(
    root = process.env.DEMO_ARTIFACT_ROOT ||
      join(PRODUCT_ROOT, "data/artifacts"),
  ) {
    this.root = resolve(root);
  }
  path(storageKey: string): string {
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,250}$/.test(storageKey) ||
      storageKey.includes("..") ||
      storageKey.includes("\\") ||
      isAbsolute(storageKey)
    )
      throw new Error("INVALID_STORAGE_KEY");
    const path = resolve(this.root, storageKey);
    if (!path.startsWith(this.root + sep))
      throw new Error("INVALID_STORAGE_KEY");
    return path;
  }
  async put(
    bytes: Buffer,
    extension: string,
  ): Promise<{ storageKey: string; sha256: string; size: number }> {
    if (!/^[a-z0-9]{1,8}$/.test(extension))
      throw new Error("INVALID_EXTENSION");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    // Attempt-addressed immutable keys. No rename-overwrite and no shared mutable canonical path.
    const storageKey = `objects/${sha256.slice(0, 2)}/${sha256}-${randomUUID()}.${extension}`;
    const path = this.path(storageKey);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const file = await open(path, "wx", 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    if (process.platform !== "win32") {
      const directory = await open(dirname(path), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
    return { storageKey, sha256, size: bytes.length };
  }
  async read(storageKey: string, expectedHash?: string): Promise<Buffer> {
    const path = this.path(storageKey);
    const actual = await realpath(path);
    const root = await realpath(this.root);
    if (
      relative(root, actual).startsWith("..") ||
      isAbsolute(relative(root, actual))
    )
      throw new Error("INVALID_STORAGE_KEY");
    const bytes = await readFile(actual);
    if (
      expectedHash &&
      createHash("sha256").update(bytes).digest("hex") !== expectedHash
    )
      throw new Error("ARTIFACT_HASH_MISMATCH");
    return bytes;
  }
  async exists(storageKey: string): Promise<boolean> {
    try {
      return (await stat(this.path(storageKey))).isFile();
    } catch {
      return false;
    }
  }
}

export interface RenderOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  inputBytes?: Buffer;
  inputExtension?: string;
}
export interface RenderResult {
  buffer: Buffer;
  metadata: Record<string, unknown>;
}
function killTree(pid: number): void {
  if (process.platform === "win32") {
    const child = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    child.unref();
  } else {
    // Descendants may form their own process groups (LibreOffice); kill leaf-first.
    const parents = new Map<number, number>();
    try {
      for (const entry of readdirSync("/proc"))
        if (/^\d+$/.test(entry)) {
          try {
            const match = readFileSync(`/proc/${entry}/stat`, "utf8").match(
              /^\d+ \(.*\) \S (\d+)/,
            );
            if (match) parents.set(Number(entry), Number(match[1]));
          } catch {
            /* exited */
          }
        }
    } catch {
      /* POSIX fallback below */
    }
    const children: number[] = [];
    const visit = (parent: number) => {
      for (const [child, ppid] of parents)
        if (ppid === parent) {
          visit(child);
          children.push(child);
        }
    };
    visit(pid);
    for (const child of children) {
      try {
        process.kill(child, "SIGKILL");
      } catch {
        /* exited */
      }
    }
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* child already exited */
      }
    }
  }
}
export async function runRender(
  command: RenderCommand,
  payload: unknown,
  options: RenderOptions = {},
): Promise<RenderResult> {
  const work = await mkdtemp(join(tmpdir(), "demo-render-"));
  const extension =
    command === "photo" ? "png" : command === "import" ? "json" : command;
  const output = join(work, "output." + extension);
  const input = { ...(payload as Record<string, unknown>) };
  if (options.inputBytes) {
    const suffix = options.inputExtension || "bin";
    if (!/^[a-z0-9]{1,8}$/.test(suffix)) throw new Error("INVALID_EXTENSION");
    const path = join(work, "input." + suffix);
    await writeFile(path, options.inputBytes, { mode: 0o600 });
    input.inputPath = path;
    if (command === "pdf") input.docxPath = path;
  }
  try {
    if (options.signal?.aborted) throw new Error("RENDER_ABORTED");
    const metadata = await new Promise<Record<string, unknown>>(
      (resolveResult, reject) => {
        const child = spawn(
          process.env.DEMO_PYTHON ||
            (process.platform === "win32" ? "python" : "python3"),
          [
            "-I",
            "-X",
            "utf8",
            join(PRODUCT_ROOT, "scripts/render/entry.py"),
            command,
            output,
          ],
          {
            cwd: PRODUCT_ROOT,
            windowsHide: true,
            detached: process.platform !== "win32",
            stdio: ["pipe", "pipe", "pipe"],
            env: {
              ...process.env,
              PYTHONUTF8: "1",
              PYTHONDONTWRITEBYTECODE: "1",
              DEMO_ARTIFACT_ROOT: new ArtifactStore().root,
            },
          },
        );
        let stdout = Buffer.alloc(0),
          stderr = Buffer.alloc(0),
          failure: string | undefined;
        const terminate = (code: string) => {
          failure = code;
          if (child.pid) killTree(child.pid);
        };
        const timer = setTimeout(
          () => terminate("RENDER_TIMEOUT"),
          Math.min(options.timeoutMs || 120_000, 180_000),
        );
        const abort = () => terminate("RENDER_ABORTED");
        options.signal?.addEventListener("abort", abort, { once: true });
        child.stdout.on("data", (chunk: Buffer) => {
          if (stdout.length + chunk.length > 2 * 1024 * 1024)
            terminate("RENDER_OUTPUT_LIMIT");
          else stdout = Buffer.concat([stdout, chunk]);
        });
        child.stderr.on("data", (chunk: Buffer) => {
          if (stderr.length < 4096)
            stderr = Buffer.concat([
              stderr,
              chunk.subarray(0, 4096 - stderr.length),
            ]);
        });
        child.on("error", () => {
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", abort);
          reject(new Error("RENDER_EXECUTABLE_UNAVAILABLE"));
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", abort);
          if (failure || code !== 0) {
            let detail = "RENDER_FAILED";
            try {
              const parsed = JSON.parse(stderr.toString("utf8"));
              if (
                typeof parsed.error === "string" &&
                /^[A-Z_]+$/.test(parsed.error)
              )
                detail = parsed.error;
            } catch {
              /* bounded untrusted stderr omitted */
            }
            reject(new Error(failure || detail));
            return;
          }
          try {
            resolveResult(
              JSON.parse(stdout.toString("utf8")) as Record<string, unknown>,
            );
          } catch {
            reject(new Error("RENDER_INVALID_OUTPUT"));
          }
        });
        child.stdin.on("error", () => {
          /* process error is handled by close */
        });
        child.stdin.end(JSON.stringify(input));
      },
    );
    if ((await stat(output)).size > 100 * 1024 * 1024)
      throw new Error("RENDER_FILE_LIMIT");
    return { buffer: await readFile(output), metadata };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export async function templateManifest(): Promise<{
  version: number;
  rendererVersion: string;
  templates: Array<Record<string, unknown>>;
}> {
  return JSON.parse(
    await readFile(
      join(PRODUCT_ROOT, "assets/templates/manifest.json"),
      "utf8",
    ),
  );
}

export async function normalizePhoto(
  bytes: Buffer,
  options: {
    rotation?: number;
    crop?: { x: number; y: number; width: number; height: number };
  } = {},
) {
  return runRender("photo", options, { inputBytes: bytes });
}
export async function parseImport(
  bytes: Buffer,
  format: "xlsx" | "csv" | "tsv",
  mapping: Record<string, string> = {},
  delimiter?: string,
  sheet?: string,
) {
  const result = await runRender(
    "import",
    { format, mapping, delimiter, sheet },
    { inputBytes: bytes, inputExtension: format },
  );
  return JSON.parse(result.buffer.toString("utf8")) as Record<string, unknown>;
}
export async function exportRegistry(items: unknown[]) {
  return runRender("xlsx", { items });
}
export async function buildZip(
  artifacts: unknown[],
  issuanceId: string,
  expectedCount: number,
  missing: Array<Record<string, unknown>> = [],
) {
  return runRender("zip", { artifacts, issuanceId, expectedCount, missing });
}

/** Latest attempt for each logical document/format; restored outputs replace the bundle pointer only. */
export function selectBundleJobs<
  T extends {
    id: string;
    kind: string;
    documentId: string | null;
    createdAt: Date;
  },
>(jobs: T[]): T[] {
  const selected = new Map<string, T>();
  for (const job of [...jobs].sort(
    (a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id),
  )) {
    if (job.kind === "ZIP") continue;
    const key = (job.documentId || "registry") + ":" + job.kind;
    if (!selected.has(key)) selected.set(key, job);
  }
  return [...selected.values()];
}

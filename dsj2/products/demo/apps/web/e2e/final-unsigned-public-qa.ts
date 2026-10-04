import { execFileSync } from "node:child_process";
import path from "node:path";

/** Read-only scoped state proof; never changes signatures or workflow status. */
export function unsignedPublicState(tenantId: string, requestId: string) {
  const product = path.resolve(__dirname, "../../..");
  const output = execFileSync(process.execPath, [
    path.join(product, "node_modules/tsx/dist/cli.mjs"),
    "--tsconfig", path.join(product, "tsconfig.base.json"),
    path.join(product, "scripts/verification/unsigned-public-state-qa.ts"),
    tenantId, requestId,
  ], { cwd: product, env: process.env, windowsHide: true, encoding: "utf8", timeout: 30000 });
  return JSON.parse(output.trim().split(/\r?\n/).at(-1)!);
}

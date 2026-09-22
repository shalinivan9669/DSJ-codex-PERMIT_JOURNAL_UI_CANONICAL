import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const source = new URL("../products/demo/packages/contracts/src/product-policy.json", import.meta.url);
const target = new URL("../product-policy/manifest.json", import.meta.url);
const bytes = await readFile(source);
const policy = JSON.parse(bytes.toString("utf8"));
if (policy.version !== 1 || policy.productId !== "DEMO" || !Array.isArray(policy.legacyRoutes)) throw new Error("Invalid policy source");
await writeFile(target, bytes);
console.log(`Policy v1 synchronized. SHA256 ${createHash("sha256").update(bytes).digest("hex")}`);

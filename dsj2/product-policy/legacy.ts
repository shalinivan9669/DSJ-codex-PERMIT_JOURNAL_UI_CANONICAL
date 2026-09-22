import manifest from "./manifest.json";

/** This gate intentionally has no role, Public, cookie or environment bypass. */
export const productPolicyVersion = 1;
export type Surface = "web" | "api";
type Route = { surface: string; method: string; path: string };

export function assertPrintingProduct() {
  if (manifest.version !== productPolicyVersion || manifest.productId !== "DEMO" ||
      manifest.legacyProductId !== "legacy-printing-gateway" || !Array.isArray(manifest.legacyRoutes) || !manifest.legacyRoutes.length ||
      !manifest.legacyRoutes.every(route => ["web", "api"].includes(route.surface) &&
        ["GET", "HEAD", "POST", "PUT", "DELETE"].includes(route.method) && typeof route.path === "string" &&
        route.path.startsWith("/") && !/[?*%\\]/.test(route.path))) {
    throw new Error("Invalid DEMO product manifest; startup refused.");
  }
  if (typeof process !== "undefined" && process.env.DSJ_PRODUCT_ID &&
      process.env.DSJ_PRODUCT_ID !== "legacy-printing-gateway") {
    throw new Error("Only legacy-printing-gateway is supported. Full DSJ is frozen.");
  }
}

export function refuseFrozenRuntime(name: string): never {
  throw new Error(`${name} is frozen by DEMO product policy v${productPolicyVersion}; no clients or queues were started.`);
}

/** Reject ambiguity before a framework/router can decode or normalize it differently. */
export function canonicalPath(rawUrl: string): string | null {
  const path = rawUrl.split("?", 1)[0];
  if (!path.startsWith("/") || path.startsWith("//") || /[\\%#;\u0000-\u0020\u007f]/.test(path) ||
      path.includes("//") || (path.length > 1 && path.endsWith("/")) ||
      path.split("/").some((part) => part === "." || part === "..")) return null;
  return path;
}

function matches(pattern: string, path: string) {
  const expected = pattern.split("/");
  const actual = path.split("/");
  return expected.length === actual.length && expected.every((part, index) =>
    part === ":id" ? /^[A-Za-z0-9_-]{1,128}$/.test(actual[index]) : part === actual[index]);
}

export function allowsLegacyRequest(surface: Surface, method: string, rawUrl: string, nextAction = false) {
  assertPrintingProduct();
  if (nextAction || method !== method.toUpperCase()) return false;
  if (surface === "web" && (method === "GET" || method === "HEAD") && allowsLegacyStatic(rawUrl)) return true;
  const path = canonicalPath(rawUrl);
  if (!path) return false;
  return (manifest.legacyRoutes as Route[]).some((route) =>
    route.surface === surface && route.method === method && matches(route.path, path));
}

function allowsLegacyStatic(rawUrl: string) {
  const raw = rawUrl.split("?", 1)[0];
  // Next emits encoded route-group parentheses and parameter brackets in chunk URLs.
  // Only these four encodings are decoded; encoded slash/dot/double encoding remain closed.
  if (!raw.startsWith("/_next/static/") || /%(?!28|29|5b|5d)/i.test(raw)) return false;
  const path = canonicalPath(decodeURIComponent(raw));
  if (!path) return false;
  const tail = path.slice("/_next/static/".length);
  if (/^(?:[A-Za-z0-9_-]+\/(?:_buildManifest|_ssgManifest)\.js|css\/[A-Za-z0-9_.-]+\.css|media\/[A-Za-z0-9_.-]+\.(?:woff2?|ttf)|chunks\/[A-Za-z0-9_.-]+\.js|chunks\/pages\/_(?:app|error)-[A-Za-z0-9_-]+\.js)$/.test(tail)) return true;
  return /^chunks\/app\/(?:layout|page|_not-found\/page|login\/page|\(app\)\/(?:layout|access-denied\/page|certificates\/page|certificates\/biot-experimental\/page|certificates\/requests\/\[id\]\/edit\/page))-[A-Za-z0-9_-]+\.js$/.test(tail);
}

export function allowsLegacyPreflight(rawUrl: string, requestedMethod: string, origin: string | undefined, allowedOrigins: string[]) {
  return !!origin && allowedOrigins.includes(origin) && allowsLegacyRequest("api", requestedMethod, rawUrl);
}

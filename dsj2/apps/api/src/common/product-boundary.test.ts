import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { spawnSync } from "node:child_process";
import { Controller, Get, Module } from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import { Public } from "./decorators/public.decorator";
import { ProductBoundaryGuard } from "./guards/product-boundary.guard";
import { legacyProductBoundary } from "./product-boundary.middleware";
import { allowsLegacyRequest, canonicalPath, refuseFrozenRuntime, assertPrintingProduct } from "../../../../product-policy/legacy";

const frozen = ["journal", "permits", "protocols", "orders/responsibility", "training", "testing", "my-instructions", "my-documents", "employees", "companies", "core-platform/organizations", "correspondence", "notifications", "audit", "invite/token", "signing/egov/callback", "documents/one/download", "unexpected-public"];
const roles = ["anonymous", "EMPLOYEE_SIGNER", "SAFETY_ENGINEER", "COMPANY_ADMIN", "SUPER_ADMIN"];

@Controller()
class ProbeController {
  @Public() @Get("auth/me") allowed() { return { printing: true }; }
  @Public() @Get("unexpected-public") surprise() { throw new Error("Frozen controller executed"); }
}
@Module({ controllers: [ProbeController], providers: [{ provide: APP_GUARD, useClass: ProductBoundaryGuard }] })
class ProbeModule {}

test("policy artifact is exact, versioned and identical to autonomous source", () => {
  const local = readFileSync(resolve(__dirname, "../../../../product-policy/manifest.json"));
  const independent = readFileSync(resolve(__dirname, "../../../../products/demo/packages/contracts/src/product-policy.json"));
  assert.equal(createHash("sha256").update(local).digest("hex"), createHash("sha256").update(independent).digest("hex"));
  const policy = JSON.parse(local.toString());
  assert.equal(policy.version, 1); assert.equal(policy.productId, "DEMO");
  const keys = policy.legacyRoutes.map((route: { surface: string; method: string; path: string }) => {
    assert.ok(["api", "web"].includes(route.surface));
    assert.ok(["GET", "HEAD", "POST", "PUT", "DELETE"].includes(route.method));
    assert.match(route.path, /^\//); assert.ok(!route.path.includes("*"));
    return `${route.surface} ${route.method} ${route.path}`;
  });
  assert.equal(new Set(keys).size, keys.length);
});

test("normalization, alternative methods and all old actions are denied", () => {
  for (const path of ["/v1//auth/me", "/v1/auth/me/", "/v1/auth/../auth/me", "/v1/auth/%6de", "/v1%2fauth/me", "/v1/auth\\me", "//v1/auth/me", "/v1/auth/me;ignored"]) {
    assert.equal(canonicalPath(path), null, path);
    assert.equal(allowsLegacyRequest("api", "GET", path), false, path);
  }
  for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
    for (const page of ["/", "/login", "/certificates", "/certificates/biot-experimental"]) {
      assert.equal(allowsLegacyRequest("web", method, page), false);
    }
  }
  assert.equal(allowsLegacyRequest("web", "GET", "/certificates", true), false);
  assert.equal(allowsLegacyRequest("api", "POST", "/v1/biot-cards/generate"), false);
  assert.equal(allowsLegacyRequest("api", "HEAD", "/v1/auth/me"), false);
  assert.equal(allowsLegacyRequest("web", "GET", "/_next/static/chunks/main.js"), true);
  assert.equal(allowsLegacyRequest("web", "GET", "/_next/static/chunks/app/%28app%29/certificates/requests/%5Bid%5D/edit/page-123abc.js"), true);
  assert.equal(allowsLegacyRequest("web", "GET", "/_next/static/chunks/app/%28app%29/journal/page-123abc.js"), false);
  assert.equal(allowsLegacyRequest("web", "GET", "/_next/static/chunks/%2e%2e/main.js"), false);
  assert.equal(allowsLegacyRequest("web", "GET", "/uploads/person.png"), false);
  assert.equal(allowsLegacyRequest("web", "GET", "/_next/image?url=/frozen"), false);
});

test("direct backend origin blocks frozen paths for every role and public controller", async () => {
  const app = await NestFactory.create(ProbeModule, { logger: false });
  app.setGlobalPrefix("v1");
  app.use(legacyProductBoundary(["http://localhost:3000"]));
  await app.listen(0, "127.0.0.1");
  const origin = await app.getUrl();
  try {
    assert.equal((await fetch(`${origin}/v1/auth/me`)).status, 200);
    for (const role of roles) {
      for (const path of frozen) {
        const response = await fetch(`${origin}/v1/${path}`, { headers: { Authorization: `Bearer legacy-${role}` } });
        assert.equal(response.status, 404, `${role}: ${path}`);
      }
    }
    for (const path of ["/v1/auth/../auth/me", "/v1/auth/%6de", "/v1%2fauth/me", "/v1//auth/me"]) {
      const status = await new Promise<number>((resolve, reject) => {
        const req = httpRequest(origin, { path }, (res) => { res.resume(); resolve(res.statusCode!); });
        req.on("error", reject); req.end();
      });
      assert.equal(status, 404, path);
    }
    assert.equal((await fetch(`${origin}/v1/auth/me`, { headers: { "Next-Action": "old-action" } })).status, 404);
    assert.equal((await fetch(`${origin}/v1/auth/me`, { method: "HEAD" })).status, 404);
    assert.equal((await fetch(`${origin}/v1/auth/me`, { method: "OPTIONS", headers: { origin: "https://evil.invalid", "access-control-request-method": "GET" } })).status, 404);
  } finally { await app.close(); }
});

test("startup never unfreezes full DSJ, even with an invalid selector", () => {
  assert.throws(() => refuseFrozenRuntime("worker"), /frozen/);
  const previous = process.env.DSJ_PRODUCT_ID;
  try { process.env.DSJ_PRODUCT_ID = "full-dsj"; assert.throws(assertPrintingProduct, /frozen/); }
  finally { if (previous === undefined) delete process.env.DSJ_PRODUCT_ID; else process.env.DSJ_PRODUCT_ID = previous; }
});

test("direct legacy worker/bridge and bare root dev refuse before any runtime clients", () => {
  const root = resolve(__dirname, "../../../..");
  for (const name of ["worker", "ncalayer-bridge"]) {
    const run = spawnSync(process.execPath, ["--import", "tsx", "src/main.ts"], {
      cwd: resolve(root, "apps", name), encoding: "utf8", timeout: 15000,
      env: { ...process.env, DSJ_PRODUCT_ID: "full-dsj", DATABASE_URL: "not-a-database-url", REDIS_URL: "not-a-redis-url" },
    });
    assert.equal(run.status, 1, name);
    assert.match(run.stderr, /frozen by DEMO product policy/);
    assert.doesNotMatch(run.stderr, /Invalid URL|PrismaClientInitializationError|ECONNREFUSED/);
  }
  const rootPackage = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  assert.equal(rootPackage.scripts.dev, "node scripts/legacy-runtime-refused.mjs");
  const run = spawnSync(process.execPath, ["scripts/legacy-runtime-refused.mjs"], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 1); assert.match(run.stderr, /No DSJ services or queues were started/);
});

test("registered legacy bootstrap excludes frozen modules and print pages never fetch workforce", () => {
  const root = resolve(__dirname, "../../../..");
  const bootstrap = readFileSync(resolve(root, "apps/api/src/app.module.ts"), "utf8");
  assert.doesNotMatch(bootstrap, /(?:Companies|Employees|Training|Notifications|Signing|Signatures|CorePlatform|Correspondence|Protocols|BriefingRecords)Module/);
  assert.ok(bootstrap.indexOf("useClass: ProductBoundaryGuard") < bootstrap.indexOf("useClass: JwtAuthGuard"));
  for (const page of ["certificates/biot-experimental/page.tsx", "certificates/requests/[id]/edit/page.tsx"]) {
    const source = readFileSync(resolve(root, "apps/web/app/(app)", page), "utf8");
    assert.doesNotMatch(source, /`(?:employees|training-assignments)/);
  }
});


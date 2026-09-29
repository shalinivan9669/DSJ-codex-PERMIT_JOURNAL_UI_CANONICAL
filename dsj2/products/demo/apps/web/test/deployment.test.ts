import test from "node:test";
import assert from "node:assert/strict";
import { externalApiRewrites } from "../lib/deployment";
import { config } from "../middleware";
import {
  unstable_doesMiddlewareMatch,
  unstable_getResponseFromNextConfig,
} from "next/experimental/testing/server";
import nextConfig from "../next.config";
import { NextRequest } from "next/server";
import { GET, POST } from "../app/api/[...path]/route";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

test("invite API responses preserve their stricter referrer policy through Next headers", async () => {
  for (const [pathname, expected] of [
    ["/api/auth/employer-invite/inspect", "no-referrer"],
    ["/api/auth/employer-invite/exchange", "no-referrer"],
    ["/api/auth/employer-invite/unknown", "no-referrer"],
    ["/api/health", "same-origin"],
    ["/api/auth/employer-invite-other", "same-origin"],
  ]) {
    const response = await unstable_getResponseFromNextConfig({
      url: `https://demo.example.test${pathname}`,
      nextConfig: { headers: nextConfig.headers },
    });
    assert.equal(response.headers.get("referrer-policy"), expected, pathname);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
  }
});

test("Vercel API transport requires an explicit fixed HTTPS backend origin", () => {
  assert.deepEqual(externalApiRewrites({}), []);
  assert.deepEqual(
    externalApiRewrites({
      VERCEL: "1",
      DEMO_API_ORIGIN: "https://api.example.test/",
    }),
    [{ source: "/api/:path*", destination: "https://api.example.test/:path*" }],
  );
  for (const origin of [
    undefined,
    "http://api.example.test",
    "ftp://api.example.test",
    "https://user:secret@api.example.test",
    "https://api.example.test/api",
    "https://api.example.test/?target=another",
    "https://api.example.test/#fragment",
  ]) {
    assert.throws(() =>
      externalApiRewrites({ VERCEL: "1", DEMO_API_ORIGIN: origin }),
    );
  }
});

test("an explicit local parity run can use loopback without altering the default local proxy", () => {
  assert.deepEqual(
    externalApiRewrites({ DEMO_API_ORIGIN: "http://127.0.0.1:4119" }),
    [],
  );
  assert.deepEqual(
    externalApiRewrites({
      DEMO_EXTERNAL_API_PROXY: "1",
      DEMO_API_ORIGIN: "http://127.0.0.1:4119",
    }),
    [{ source: "/api/:path*", destination: "http://127.0.0.1:4119/:path*" }],
  );
});

test("API uploads avoid middleware body limits while every web route remains guarded", () => {
  for (const url of [
    "/api",
    "/api/photos",
    "/api/imports/preview",
    "/api/artifacts/file-id",
    "/api/permits",
  ]) {
    assert.equal(
      unstable_doesMiddlewareMatch({ config, nextConfig: {}, url }),
      false,
      url,
    );
  }
  for (const url of [
    "/login",
    "/requests",
    "/invite",
    "/permits",
    "/api-other",
    "/_next/static/chunks/app.js",
  ]) {
    assert.equal(
      unstable_doesMiddlewareMatch({ config, nextConfig: {}, url }),
      true,
      url,
    );
  }
});

test("local transport retains route, server-action and origin guards without middleware", async () => {
  assert.equal(
    (await GET(new NextRequest("http://localhost/api/permits"))).status,
    404,
  );
  assert.equal(
    (
      await GET(
        new NextRequest("http://localhost/api/health", {
          headers: { "next-action": "legacy" },
        }),
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await POST(
        new NextRequest("http://localhost/api/photos", {
          method: "POST",
          headers: { origin: "https://wrong.example" },
        }),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await POST(
        new NextRequest("http://localhost/api/photos", { method: "POST" }),
      )
    ).status,
    403,
  );
});

test("Vercel's actual Next config loader retains the repository tracing root for a nested app", () => {
  const appRoot = path.resolve(__dirname, "..");
  const repositoryRoot = path.resolve(appRoot, "../../../../..");
  const productRoot = path.resolve(appRoot, "../..");
  const script = `const load = require('next/dist/server/config').default;
    const { PHASE_PRODUCTION_BUILD } = require('next/constants');
    load(PHASE_PRODUCTION_BUILD, process.cwd()).then(config => {
      process.stdout.write(JSON.stringify({root: config.outputFileTracingRoot, output: config.output || null}));
    }).catch(error => { console.error(error); process.exitCode = 1; });`;
  function read(vercel: string) {
    return JSON.parse(
      execFileSync(process.execPath, ["-e", script], {
        cwd: appRoot,
        env: {
          ...process.env,
          VERCEL: vercel,
          NEXT_PRIVATE_OUTPUT_TRACE_ROOT: repositoryRoot,
        },
        encoding: "utf8",
        windowsHide: true,
      }),
    );
  }
  const cloud = read("1");
  assert.equal(cloud.root, repositoryRoot);
  assert.equal(cloud.output, null);
  const relativeAppDir = path.relative(cloud.root, appRoot);
  assert.equal(path.join(repositoryRoot, relativeAppDir), appRoot);
  const adapterRequire = createRequire(
    path.join(repositoryRoot, relativeAppDir, "noop.js"),
  );
  assert.equal(
    adapterRequire.resolve(
      "next/dist/compiled/next-server/server.runtime.prod.js",
    ),
    createRequire(path.join(appRoot, "noop.js")).resolve(
      "next/dist/compiled/next-server/server.runtime.prod.js",
    ),
  );
  assert.deepEqual(read(""), { root: productRoot, output: "standalone" });
});

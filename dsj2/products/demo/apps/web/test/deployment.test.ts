import test from "node:test";
import assert from "node:assert/strict";
import { externalApiRewrites } from "../lib/deployment";
import { config } from "../middleware";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { GET, POST } from "../app/api/[...path]/route";

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

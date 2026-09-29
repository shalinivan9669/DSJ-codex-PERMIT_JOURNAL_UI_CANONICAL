import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { spawn } from "node:child_process";
import { allowedRoute } from "../../packages/contracts/src/policy";
import { originCheck, sessionCookies } from "../../apps/api/src/auth";

// Local transport parity only: no database writes, cloud calls or issuance.
async function main() {
  const root = path.resolve(__dirname, "../..");
  const source = path.join(root, "apps/web");
  const output = path.join(root, ".runtime", `vercel-transport-${Date.now()}`);
  const fixture = path.join(output, "fixture");
  const requireWeb = createRequire(path.join(source, "package.json"));
  const hash = (data: Uint8Array) =>
    createHash("sha256").update(data).digest("hex");
  async function listen(server: Server) {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    return address.port;
  }
  const reservation = createServer();
  const webPort = await listen(reservation);
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const origin = `http://127.0.0.1:${webPort}`;
  process.env.DEMO_ORIGIN = origin;
  process.env.NODE_ENV = "production";
  const file = Buffer.alloc(5 * 1024 * 1024, 97);
  const download = Buffer.alloc(6 * 1024 * 1024, 98);
  const upstream = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    if (
      !allowedRoute("api", req.method || "GET", req.url || "/", req.headers)
    ) {
      res.writeHead(404).end("NOT_FOUND");
      return;
    }
    try {
      originCheck(req as Parameters<typeof originCheck>[0]);
    } catch {
      res.writeHead(403).end("ORIGIN_REJECTED");
      return;
    }
    if (req.url === "/artifacts/large-file?inline=1") {
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        'inline; filename="synthetic-large.bin"',
      );
      res.setHeader("Content-Length", download.byteLength);
      res.end(download);
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    sessionCookies(
      res as Parameters<typeof sessionCookies>[0],
      "sample-session",
      "sample-csrf",
    );
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        url: req.url,
        bytes: body.byteLength,
        sha256: hash(body),
        cookie: req.headers.cookie,
        origin: req.headers.origin,
        csrf: req.headers["x-csrf-token"],
        idempotency: req.headers["idempotency-key"],
        contentType: req.headers["content-type"],
      }),
    );
  });
  const apiPort = await listen(upstream);
  await fs.mkdir(path.join(fixture, "app/api/[...path]"), { recursive: true });
  await fs.mkdir(path.join(fixture, "lib"), { recursive: true });
  for (const relative of [
    "next.config.ts",
    "middleware.ts",
    "lib/deployment.ts",
    "app/api/[...path]/route.ts",
  ]) {
    await fs.copyFile(
      path.join(source, relative),
      path.join(fixture, relative),
    );
  }
  await fs.copyFile(
    path.join(source, "package.json"),
    path.join(fixture, "package.json"),
  );
  await fs.writeFile(
    path.join(fixture, "app/layout.tsx"),
    "export default function Layout({children}:{children:React.ReactNode}) { return <html><body>{children}</body></html>; }",
  );
  await fs.writeFile(
    path.join(fixture, "app/page.tsx"),
    "export default function Page() { return <main>Transport fixture</main>; }",
  );
  await fs.symlink(
    path.join(source, "node_modules"),
    path.join(fixture, "node_modules"),
    "junction",
  );
  const log: string[] = [];
  const child = spawn(
    process.execPath,
    [
      requireWeb.resolve("next/dist/bin/next"),
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(webPort),
    ],
    {
      cwd: fixture,
      env: {
        ...process.env,
        NODE_ENV: "development",
        VERCEL: "",
        DEMO_EXTERNAL_API_PROXY: "1",
        DEMO_API_ORIGIN: `http://127.0.0.1:${apiPort}`,
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  child.stdout.on("data", (value: Buffer) => log.push(value.toString()));
  child.stderr.on("data", (value: Buffer) => log.push(value.toString()));
  try {
    const readyBy = Date.now() + 60000;
    while (true) {
      try {
        if (
          (
            await fetch(`${origin}/api/health`, {
              signal: AbortSignal.timeout(2000),
            })
          ).ok
        )
          break;
      } catch {
        /* Wait only for the isolated local fixture to start. */
      }
      assert.ok(Date.now() < readyBy, "Next transport fixture did not start");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const multipart = new FormData();
    multipart.set(
      "file",
      new Blob([file], { type: "image/png" }),
      "synthetic-five-mib.png",
    );
    const encoded = new Request(`${origin}/api/photos?fixture=transport`, {
      method: "POST",
      body: multipart,
    });
    const bytes = Buffer.from(await encoded.arrayBuffer());
    const response = await fetch(encoded.url, {
      method: "POST",
      headers: {
        "content-type": encoded.headers.get("content-type")!,
        cookie: "demo_session=sample-session; demo_csrf=sample-csrf",
        origin,
        "x-csrf-token": "sample-csrf",
        "idempotency-key": "transport-fixture-key",
      },
      body: bytes,
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") || "", /no-store/);
    const echoed = await response.json();
    assert.equal(echoed.bytes, bytes.byteLength);
    assert.equal(echoed.sha256, hash(bytes));
    assert.equal(echoed.url, "/photos?fixture=transport");
    assert.equal(echoed.origin, origin);
    assert.equal(echoed.csrf, "sample-csrf");
    assert.equal(echoed.idempotency, "transport-fixture-key");
    assert.equal(
      echoed.cookie,
      "demo_session=sample-session; demo_csrf=sample-csrf",
    );
    const cookies = response.headers.getSetCookie();
    assert.equal(cookies.length, 2);
    assert.ok(
      cookies.every(
        (cookie) =>
          cookie.includes("SameSite=Strict") &&
          cookie.includes("Secure") &&
          !cookie.includes("Domain="),
      ),
    );
    assert.match(cookies[0], /HttpOnly/);
    const binary = await fetch(`${origin}/api/artifacts/large-file?inline=1`);
    assert.equal(binary.status, 200);
    assert.equal(
      hash(new Uint8Array(await binary.arrayBuffer())),
      hash(download),
    );
    assert.match(
      binary.headers.get("content-disposition") || "",
      /synthetic-large.bin/,
    );
    assert.equal(
      (
        await fetch(`${origin}/api/photos`, {
          method: "POST",
          headers: { origin: "https://wrong.example" },
        })
      ).status,
      403,
    );
    assert.equal(
      (await fetch(`${origin}/api/photos`, { method: "POST" })).status,
      403,
    );
    assert.equal((await fetch(`${origin}/api/permits`)).status, 404);
    assert.equal(
      (
        await fetch(`${origin}/api/health`, {
          headers: { "next-action": "legacy" },
        })
      ).status,
      404,
    );
    assert.equal((await fetch(`${origin}/permits`)).status, 404);
    const result = {
      status: "PASS",
      uploadFileBytes: file.byteLength,
      multipartBytes: bytes.byteLength,
      downloadedBytes: download.byteLength,
      preservedHeaders: [
        "origin",
        "cookie",
        "x-csrf-token",
        "idempotency-key",
        "content-type",
      ],
      separateSetCookies: 2,
      wrongOrMissingOriginRejected: true,
      apiAndWebFrozenRoutesRejected: true,
      serverActionReplayRejected: true,
      cloudVerified: false,
    };
    await fs.writeFile(
      path.join(output, "result.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify({ ...result, evidence: output }, null, 2));
  } finally {
    child.kill();
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    await fs.writeFile(path.join(output, "next.log"), log.join(""));
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

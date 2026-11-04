import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, test } from "node:test";
import { createBridgeServer } from "./bridge-service";

const limit = 1024 * 1024;
const digest = "0123456789abcdef".repeat(4);
const certificate = {
  certificateSerial: "CERT-123456", certificateThumbprint: "THUMBPRINT123456",
  certificateSubject: "CN=Test", certificateIssuer: "CN=Test CA",
  certificateValidFrom: "2026-03-01T00:00:00.000Z", certificateValidTo: "2027-03-01T00:00:00.000Z",
  signerName: "Test Signer", signerIin: "980317350011",
};
let server: ReturnType<typeof createBridgeServer> | undefined;
afterEach(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  server = undefined;
});

async function start() {
  let calls = 0;
  server = createBridgeServer({
    runtime: {
      async connect() { return "2.0.0"; },
      async signDigest() { calls++; return { cms: "cms-payload", version: "2.0.0" }; },
    },
    parseCertificate: () => certificate,
    logger: { info() {}, error() {} },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  return { port, calls: () => calls };
}

test("accepts exactly 1 MiB and rejects 1 MiB plus one byte without signing", async () => {
  const fixture = await start();
  const body = JSON.stringify({ digest, testMode: true });
  const padded = body + " ".repeat(limit - Buffer.byteLength(body));
  for (const [payload, expected] of [[padded, 200], [padded + " ", 413]] as const) {
    const response = await fetch(`http://127.0.0.1:${fixture.port}/sign`, {
      method: "POST", headers: { "content-type": "application/json" }, body: payload,
    });
    assert.equal(response.status, expected);
  }
  assert.equal(fixture.calls(), 1);
});

test("returns 413 on chunked upload before the client ends the body", async () => {
  const fixture = await start();
  const responseStatus = new Promise<number>((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port: fixture.port, path: "/sign", method: "POST" }, (res) => {
      res.resume();
      res.on("end", () => { resolve(res.statusCode ?? 0); req.destroy(); });
    });
    req.on("error", reject);
    req.setTimeout(3000, () => { req.destroy(new Error("no response while upload remained open")); });
    req.write(Buffer.alloc(limit));
    req.write(Buffer.alloc(1));
  });
  assert.equal(await responseStatus, 413);
  assert.equal(fixture.calls(), 0);
});

test("rejects an oversized declared body before receiving its first byte", async () => {
  const fixture = await start();
  const status = await new Promise<number>((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port: fixture.port, path: "/sign", method: "POST", headers: { "content-length": limit + 1 } }, (res) => {
      res.resume();
      res.on("end", () => { resolve(res.statusCode ?? 0); req.destroy(); });
    });
    req.on("error", reject);
    req.setTimeout(3000, () => req.destroy(new Error("no response to declared oversized body")));
    req.flushHeaders();
  });
  assert.equal(status, 413);
  assert.equal(fixture.calls(), 0);
});

test("closes an oversized upload that never finishes after returning 413", async () => {
  const fixture = await start();
  await new Promise<void>((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port: fixture.port, path: "/sign", method: "POST", headers: { "content-length": limit + 1 } }, (res) => {
      assert.equal(res.statusCode, 413);
      const socket = res.socket;
      assert.ok(socket);
      res.resume();
      socket.once("close", resolve);
    });
    req.on("error", reject);
    req.setTimeout(3500, () => req.destroy(new Error("oversized upload remained open")));
    req.flushHeaders();
  });
  assert.equal(fixture.calls(), 0);
});

test("an aborted request does not prevent a subsequent valid request", async () => {
  const fixture = await start();
  await new Promise<void>((resolve) => {
    const req = httpRequest({ host: "127.0.0.1", port: fixture.port, path: "/sign", method: "POST" });
    req.on("error", () => resolve());
    req.write('{"digest":');
    req.destroy();
  });
  const response = await fetch(`http://127.0.0.1:${fixture.port}/sign`, {
    method: "POST", body: JSON.stringify({ digest, testMode: true }),
  });
  assert.equal(response.status, 200);
  assert.equal(fixture.calls(), 1);
});

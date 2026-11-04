import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, request as httpRequest } from "node:http";
import { Readable } from "node:stream";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { readLimitedNcalayerBody } from "../../lib/ncalayer-body-limit";

function streamingRequest(source: UnderlyingDefaultSource<Uint8Array>): Request {
  return new Request("http://localhost/sign", { method: "POST", body: new ReadableStream(source), duplex: "half" } as RequestInit);
}

test("proxy body reader preserves exactly 1 MiB across streamed chunks", async () => {
  const request = streamingRequest({
    start(controller) {
      controller.enqueue(new Uint8Array(1024 * 512).fill(7));
      controller.enqueue(new Uint8Array(1024 * 512).fill(8));
      controller.close();
    },
  });
  const body = new Uint8Array((await readLimitedNcalayerBody(request))!);
  assert.equal(body.length, 1024 * 1024);
  assert.equal(body[0], 7);
  assert.equal(body[body.length - 1], 8);
});

test("oversized stream is cancelled and rejected without waiting for its cancellation promise", async () => {
  let cancelled = false;
  const request = streamingRequest({
    start(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024));
      controller.enqueue(new Uint8Array(1));
    },
    cancel() { cancelled = true; return new Promise(() => {}); },
  });
  const result = await Promise.race([
    readLimitedNcalayerBody(request),
    new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 300)),
  ]);
  assert.equal(result, null);
  assert.equal(cancelled, true);
});

test("body stream errors are not forwarded as an empty signing request", async () => {
  const request = streamingRequest({ start(controller) { controller.error(new Error("aborted")); } });
  await assert.rejects(() => readLimitedNcalayerBody(request), /aborted/);
});

test("a streamed oversized HTTP request actually receives a 413", async () => {
  const server = createServer(async (req, res) => {
    try {
      const body = Readable.toWeb(req) as ReadableStream<Uint8Array>;
      const request = new Request("http://localhost/sign", { method: "POST", body, duplex: "half" } as RequestInit);
      const result = await readLimitedNcalayerBody(request);
      res.statusCode = result === null ? 413 : 200;
      res.setHeader("Connection", "close");
      res.end();
    } catch { res.statusCode = 500; res.end(); }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const port = (server.address() as AddressInfo).port;
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port, method: "POST" }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      });
      req.on("error", reject);
      req.setTimeout(3000, () => req.destroy(new Error("no response")));
      req.write(Buffer.alloc(1024 * 1024));
      req.write(Buffer.alloc(1));
    });
    assert.equal(status, 413);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});

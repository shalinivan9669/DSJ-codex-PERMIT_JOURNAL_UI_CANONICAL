import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { biotGenerationProxyResponse } from "../../lib/biot-generation-response";

test("retains the saved request id and byte-exact document download", async () => {
  const bytes = Uint8Array.from([0x50, 0x4b, 0, 0xff, 1]);
  const original = new Response(bytes, { status: 200, headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "Content-Disposition": 'attachment; filename="cards.docx"',
    "X-Card-Request-Id": "request-synthetic-1",
  } });
  const result = await biotGenerationProxyResponse(original);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("X-Card-Request-Id"), "request-synthetic-1");
  assert.equal(result.headers.get("Content-Disposition"), 'attachment; filename="cards.docx"');
  assert.equal(result.headers.get("Content-Type"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()), bytes);
});

test("retains the status and message when generation fails", async () => {
  const result = await biotGenerationProxyResponse(new Response('{"message":"Ошибка"}', {
    status: 400,
    headers: { "Content-Type": "application/json" },
  }));
  assert.equal(result.status, 400);
  assert.equal(result.headers.get("X-Card-Request-Id"), null);
  assert.deepEqual(await result.json(), { message: "Ошибка" });
});

test("retains the saved request and binary file from an HTTP response", async () => {
  const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0xff]);
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": 'attachment; filename="cards.docx"',
      "X-Card-Request-Id": "synthetic-http-request",
    });
    response.end(bytes);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const result = await biotGenerationProxyResponse(await fetch(`http://127.0.0.1:${address.port}/`));
    assert.equal(result.headers.get("X-Card-Request-Id"), "synthetic-http-request");
    assert.equal(result.headers.get("Content-Disposition"), 'attachment; filename="cards.docx"');
    assert.deepEqual(Buffer.from(await result.arrayBuffer()), bytes);
  } finally {
    server.close();
    await once(server, "close");
  }
});

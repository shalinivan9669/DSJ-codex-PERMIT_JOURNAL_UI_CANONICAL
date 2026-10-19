import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/[...path]/route";

test("leaving an upload aborts its upstream request", async () => {
  const originalFetch = globalThis.fetch;
  const previousOrigin = process.env.DEMO_ORIGIN;
  const origin = "http://127.0.0.1:3328";
  process.env.DEMO_ORIGIN = origin;
  const controller = new AbortController();
  let upstreamSignal: AbortSignal | undefined;
  globalThis.fetch = async (_input, options) => {
    assert.ok(options?.body instanceof ReadableStream);
    upstreamSignal = options.signal!;
    assert.equal(upstreamSignal.aborted, false);
    return await new Promise<Response>((_resolve, reject) => {
      upstreamSignal!.addEventListener("abort", () =>
        reject(new Error("aborted")),
      );
      controller.abort();
    });
  };
  try {
    const request = new NextRequest(
      `${origin}/api/lms/courses/course/materials`,
      {
        method: "POST",
        headers: {
          origin,
          "content-type": "multipart/form-data; boundary=test",
        },
        body: "--test--",
        signal: controller.signal,
      },
    );
    const response = await POST(request);
    assert.equal(upstreamSignal?.aborted, true);
    assert.equal(response.status, 503);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousOrigin === undefined) delete process.env.DEMO_ORIGIN;
    else process.env.DEMO_ORIGIN = previousOrigin;
  }
});

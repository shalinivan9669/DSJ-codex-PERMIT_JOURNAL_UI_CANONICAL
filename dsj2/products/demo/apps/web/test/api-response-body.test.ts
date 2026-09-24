import assert from "node:assert/strict";
import test from "node:test";
import { api, ApiError } from "../lib/api";
import { filePollingRetryDelay } from "../lib/file-polling";

test("a connection lost after response headers stays a retryable network error", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(
              new TypeError("connection reset during response body"),
            );
          },
        }),
        { status: 200 },
      ),
  );
  await assert.rejects(
    api("/print-requests/synthetic/files"),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 0);
      assert.equal(filePollingRetryDelay(error, 1), 1000);
      return true;
    },
  );
});

test("a complete forbidden response is not changed into a retryable network failure", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(JSON.stringify({ message: "Forbidden" }), { status: 403 }),
  );
  await assert.rejects(
    api("/print-requests/synthetic/files"),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 403);
      assert.equal(filePollingRetryDelay(error, 1), null);
      return true;
    },
  );
});

for (const status of [401, 403, 404])
  test(`HTTP ${status} remains non-retryable even if its error body is interrupted`, async (t) => {
    t.mock.method(
      globalThis,
      "fetch",
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new TypeError("connection reset"));
            },
          }),
          { status },
        ),
    );
    await assert.rejects(
      api("/print-requests/synthetic/files"),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, status);
        assert.equal(filePollingRetryDelay(error, 1), null);
        return true;
      },
    );
  });

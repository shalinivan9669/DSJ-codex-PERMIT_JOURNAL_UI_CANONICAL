import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../lib/api";
import { filePollingRetryDelay } from "../lib/file-polling";

test("file polling retries transient reads with bounded attempts and Retry-After", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map((n) =>
      filePollingRetryDelay(new ApiError(503, "temporary"), n),
    ),
    [1000, 2000, 4000, 8000, 16000, null],
  );
  assert.equal(filePollingRetryDelay(new ApiError(0, "offline"), 1), 1000);
  assert.equal(
    filePollingRetryDelay(
      new ApiError(429, "busy", undefined, undefined, 65000),
      1,
    ),
    65000,
  );
  for (const status of [400, 401, 403, 404, 409, 422])
    assert.equal(filePollingRetryDelay(new ApiError(status, "stop"), 1), null);
  assert.equal(
    filePollingRetryDelay(new TypeError("unexpected program failure"), 1),
    null,
  );
});

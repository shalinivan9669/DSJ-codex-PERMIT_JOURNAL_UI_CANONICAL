import { ApiError } from "./api";

/** Retry transient read failures, then leave the existing manual refresh available. */
export function filePollingRetryDelay(error: unknown, failures: number) {
  if (
    !(error instanceof ApiError) ||
    (![0, 429].includes(error.status) && error.status < 500) ||
    failures > 5
  )
    return null;
  const backoff = Math.min(30_000, 1000 * 2 ** (failures - 1));
  const retryAfter = Math.min(
    2_147_483_647,
    Math.max(0, error.retryAfterMs || 0),
  );
  return Math.max(backoff, retryAfter);
}

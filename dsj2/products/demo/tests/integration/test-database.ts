import assert from "node:assert/strict";

/** Guard before the first connection/write, including tests that create synthetic data. */
export function assertTestDatabase(): void {
  const value = process.env.DATABASE_URL;
  assert.ok(value, "A migrated disposable PostgreSQL DATABASE_URL is required");
  const url = new URL(value);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.match(
    decodeURIComponent(url.pathname.slice(1)),
    /^demo_test(?:[_a-zA-Z0-9-]*)$/,
    "Integration tests require an isolated database whose actual name starts with demo_test",
  );
}

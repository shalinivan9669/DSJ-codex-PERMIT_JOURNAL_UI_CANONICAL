import test from "node:test";
import assert from "node:assert/strict";
import { checkLayoutBatches } from "../apps/api/src/layout-preflight";

test("1203 actual plan identities survive bounded preflight and late overflow indexes", async () => {
  const snapshots = Array.from({ length: 1203 }, (_, index) => ({
    index,
    items: Array.from({ length: index < 1200 ? 1 : 400 }, () => ({})),
  }));
  const seen: number[] = [];
  let active = 0;
  let peak = 0;
  const result = await checkLayoutBatches(snapshots, async (batch) => {
    assert.ok(batch.length <= 100);
    if (
      batch.some(
        (snapshot) => (snapshot as { items: unknown[] }).items.length > 100,
      )
    )
      assert.equal(
        batch.length,
        1,
        "large protocols remain whole in separate batches",
      );
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    const issues = batch.flatMap((snapshot, index) => {
      const identity = (snapshot as { index: number }).index;
      seen.push(identity);
      return [501, 1001, 1202].includes(identity)
        ? [{ index, code: "PRINT_LAYOUT_OVERFLOW" }]
        : [];
    });
    active--;
    return { metadata: { issues, checked: batch.length } };
  });
  assert.deepEqual(
    [...result].sort((a, b) => a - b),
    [501, 1001, 1202],
  );
  assert.deepEqual(
    seen.sort((a, b) => a - b),
    snapshots.map(({ index }) => index),
  );
  assert.equal(new Set(seen).size, 1203);
  assert.ok(peak > 1 && peak <= 4);
});

test("a failed chunk rejects the whole request and stops starting unchecked tail", async () => {
  let calls = 0;
  let active = 0;
  await assert.rejects(
    checkLayoutBatches(
      Array.from({ length: 1203 }, (_, index) => index),
      async () => {
        const call = calls++;
        active++;
        await new Promise((resolve) =>
          setTimeout(resolve, call === 0 ? 1 : 10),
        );
        active--;
        if (call === 0) throw new Error("RENDER_TIMEOUT");
        return { metadata: { issues: [], checked: 100 } };
      },
    ),
    /RENDER_TIMEOUT/,
  );
  assert.equal(calls, 4);
  assert.equal(
    active,
    0,
    "all started work settles before a failed result returns",
  );
});

test("partial or invalid renderer answers never certify unchecked plans", async () => {
  for (const metadata of [
    { checked: 0, issues: [] },
    { checked: 1, issues: [{ index: 1, code: "PRINT_LAYOUT_OVERFLOW" }] },
    { checked: 1, issues: [{ index: -1, code: "PRINT_LAYOUT_OVERFLOW" }] },
    { checked: 1, issues: [{ index: 0.5, code: "PRINT_LAYOUT_OVERFLOW" }] },
    { checked: 1, issues: [{ index: 0, code: "UNKNOWN_ERROR" }] },
    { checked: 1, issues: null },
  ]) {
    await assert.rejects(
      checkLayoutBatches([{}], async () => ({ metadata })),
      /PREFLIGHT_INVALID_OUTPUT/,
    );
  }
});

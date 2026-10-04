/** Keep each Python invocation below its resource cap without skipping a plan. */
export const LAYOUT_BATCH_SIZE = 100;
const REQUEST_WORKERS = 4;

type LayoutBatchResult = { metadata: Record<string, unknown> };

function planWeight(snapshot: unknown) {
  const items = (snapshot as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? Math.max(1, items.length) : 1;
}

export async function checkLayoutBatches(
  snapshots: unknown[],
  runBatch: (batch: unknown[]) => Promise<LayoutBatchResult>,
): Promise<Set<number>> {
  const failures = new Set<number>();
  let next = 0;
  let failure: unknown;
  let failed = false;
  async function worker() {
    while (!failed && next < snapshots.length) {
      const offset = next;
      let weight = 0;
      while (next < snapshots.length && next - offset < LAYOUT_BATCH_SIZE) {
        const addition = planWeight(snapshots[next]);
        if (next > offset && weight + addition > LAYOUT_BATCH_SIZE) break;
        weight += addition;
        next++;
        if (weight >= LAYOUT_BATCH_SIZE) break;
      }
      // A large group is still one complete immutable plan. Run it alone so
      // several long rosters do not create one serial tail after the cards.
      const batch = snapshots.slice(offset, next);
      try {
        const result = await runBatch(batch);
        const issues = result.metadata.issues;
        if (
          result.metadata.checked !== batch.length ||
          !Array.isArray(issues) ||
          issues.some(
            (issue) =>
              !issue ||
              !Number.isInteger(issue.index) ||
              issue.index < 0 ||
              issue.index >= batch.length ||
              issue.code !== "PRINT_LAYOUT_OVERFLOW",
          )
        )
          throw new Error("PREFLIGHT_INVALID_OUTPUT");
        for (const issue of issues) failures.add(offset + issue.index);
      } catch (error) {
        failed = true;
        failure ??= error;
      }
    }
  }
  // A bounded number of workers feeds the shared renderer semaphore. Do not
  // enqueue every chunk of a large request or bypass the global process cap.
  await Promise.all(
    Array.from(
      {
        length: Math.min(REQUEST_WORKERS, snapshots.length),
      },
      worker,
    ),
  );
  if (failed) throw failure;
  return failures;
}

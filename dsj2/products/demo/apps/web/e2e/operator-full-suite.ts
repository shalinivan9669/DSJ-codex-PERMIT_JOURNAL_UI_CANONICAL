import fs from "node:fs/promises";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

type Family = "g1" | "common";

/** Full-suite checkpoints belong to this run; targeted verification stays explicit. */
export function fullSuiteRunId(): string | undefined {
  if (process.env.DEMO_E2E_FULL_CHECKPOINTS !== "1") return;
  const id = process.env.DEMO_E2E_FULL_RUN_ID;
  if (!id || !/^[a-zA-Z0-9][a-zA-Z0-9-]{7,79}$/.test(id))
    throw new Error("FULL_SUITE_UNIQUE_RUN_ID_REQUIRED");
  return id;
}

/** Real idle time for the unchanged local 600/IP/min API window; no request retry. */
export async function fullSuiteApiCooldown(directory: string, phase: string) {
  const suiteRunId = fullSuiteRunId();
  if (!suiteRunId) return;
  if (!/^[a-z0-9-]+$/.test(phase))
    throw new Error("FULL_SUITE_COOLDOWN_PHASE_INVALID");
  const startedUtc = new Date().toISOString();
  const started = performance.now();
  const deadline = started + 60000;
  let actualIdleMs = 0;
  while (actualIdleMs < 60000) {
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(1, Math.ceil(deadline - performance.now()))),
    );
    actualIdleMs = performance.now() - started;
  }
  expect(actualIdleMs).toBeGreaterThanOrEqual(60000);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, `full-api-cooldown-${phase}.json`),
    JSON.stringify(
      {
        suiteRunId,
        phase,
        startedUtc,
        finishedUtc: new Date().toISOString(),
        requestedIdleMs: 60000,
        actualIdleMs,
        scope: "FULL_SUITE_HARNESS_IDLE_WITHOUT_HTTP",
        apiRateLimitChanged: false,
        retriesOrSuppressedResponses: false,
      },
      null,
      2,
    ),
  );
}

/** Stop editor polling before an explicit full-run API budget boundary. */
export async function fullSuitePageApiCooldown(
  page: Page,
  directory: string,
  phase: string,
) {
  if (!fullSuiteRunId()) return;
  await page.goto("about:blank");
  const requests: string[] = [];
  const observe = (request: { url(): string }) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/") || url.port === "4134")
      requests.push(url.pathname);
  };
  page.on("request", observe);
  try {
    await fullSuiteApiCooldown(directory, phase);
    expect(page.url()).toBe("about:blank");
    expect(requests).toEqual([]);
    const proofPath = path.join(directory, `full-api-cooldown-${phase}.json`);
    const proof = JSON.parse(await fs.readFile(proofPath, "utf8"));
    await fs.writeFile(
      proofPath,
      JSON.stringify(
        {
          ...proof,
          editorPollingStopped: true,
          pageUrl: page.url(),
          observedApiRequests: requests,
        },
        null,
        2,
      ),
    );
  } finally {
    page.off("request", observe);
  }
}

export function fullSuiteEvidence(
  family: Family,
  role: string = "producer",
): string | undefined {
  if (!fullSuiteRunId()) return;
  if (!process.env.DEMO_E2E_EVIDENCE)
    throw new Error("FULL_SUITE_EVIDENCE_DIRECTORY_REQUIRED");
  const base = path.resolve(process.env.DEMO_E2E_EVIDENCE);
  return path.join(
    base,
    `${family}-${role === "producer" ? "prepared" : role}`,
  );
}

export function preparedCheckpointDirectory(family: Family) {
  return (
    fullSuiteEvidence(family) ||
    process.env[
      family === "g1"
        ? "DEMO_E2E_G1_PREPARED_DIR"
        : "DEMO_E2E_COMMON_PREPARED_DIR"
    ]
  );
}

export async function requireEmptyFullPreparation(directory: string) {
  if (!fullSuiteRunId()) return;
  // A failed prior run must be preserved in a separate directory before retry.
  for (const name of [
    "g1-checkpoint.json",
    "checkpoint.json",
    "g1-result.json",
    "common-history-result.json",
  ]) {
    try {
      await fs.access(path.join(directory, name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    throw new Error("FULL_SUITE_PREPARATION_ALREADY_EXISTS");
  }
  if (
    process.env.DEMO_E2E_G1_CONTINUE_PREPARATION ||
    process.env.DEMO_E2E_G1_CONTINUE_ISSUANCE_CHECKPOINT ||
    process.env.DEMO_E2E_COMMON_CONTINUE_CHECKPOINT
  )
    throw new Error("FULL_SUITE_REQUIRES_FRESH_UI_PREPARATION");
}

export function requireFullCheckpointIdentity(checkpoint: {
  suiteRunId?: string;
}) {
  const id = fullSuiteRunId();
  if (id && checkpoint.suiteRunId !== id)
    throw new Error("FULL_SUITE_CHECKPOINT_FROM_ANOTHER_RUN");
}

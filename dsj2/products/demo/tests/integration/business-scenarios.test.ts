import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db } from "../../apps/api/src/core";
import { runBusinessScenarios } from "../../scripts/verification/business-scenarios";
import { assertTestDatabase } from "./test-database";

test(
  "daily business scenarios persist real history, output, obligations, renewal and scoped evidence",
  { timeout: 600_000 },
  async () => {
    assertTestDatabase();
    assert.notEqual(
      process.env.DEMO_BUSINESS_RESUME,
      "1",
      "Integration regression must start from a fresh synthetic tenant",
    );
    const output =
      process.env.DEMO_BUSINESS_EVIDENCE_OUTPUT ||
      join(
        await mkdtemp(join(tmpdir(), "demo-daily-workflows-")),
        "business-execution.json",
      );
    try {
      const result = await runBusinessScenarios(output);
      assert.equal(result.status, "PASS");
      assert.deepEqual(
        result.scenarios
          .filter((s) => s.id !== "FIXTURE_SETUP")
          .map((s) => s.id)
          .sort(),
        ["V02", "V03", "V04", "V05", "V06", "V08", "V09", "V10", "V11", "V12"],
      );
      assert.ok(
        result.scenarios.every(
          (s) =>
            s.status === "PASS" &&
            s.assertions.length > 0 &&
            s.humanActiveMs === null &&
            s.manualReentryCount === null &&
            s.browserVerified === false,
        ),
      );
      const saved = JSON.parse(await readFile(output, "utf8"));
      assert.equal(saved.tenantId, result.tenantId);
      assert.equal(saved.status, "PASS");
      assert.equal(
        await db.issuedDocument.count({ where: { tenantId: result.tenantId } }),
        9,
      );
      assert.equal(
        await db.generationJob.count({
          where: { tenantId: result.tenantId, status: { not: "SUCCEEDED" } },
        }),
        0,
      );
    } finally {
      await db.$disconnect();
    }
  },
);

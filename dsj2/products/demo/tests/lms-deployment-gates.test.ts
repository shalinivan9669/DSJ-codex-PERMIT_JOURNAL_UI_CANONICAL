import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  lmsDeploymentEvidenceAllowed,
  personalDataLocations,
} from "../packages/contracts/src/lms/deployment-gates";
import { assertLmsDeploymentAllowed } from "../apps/api/src/lms/deployment-gate";

test("OPS01/02: every personal-data copy needs placement, owner/access/retention evidence; unknown or foreign placement denies real LMS", async () => {
  const id = randomUUID();
  const evidence = {
    tenantId: id,
    operator: "SYNTHETIC OPERATOR",
    approvedBy: "SYNTHETIC REVIEWER",
    approvalReference: "SYNTHETIC-NOT-AUTHORIZATION",
    lawfulBasis: "SYNTHETIC CONSENT",
    subjectAccountingReference: "CONFIRMED PERSON LINKS",
    retentionPolicy: "SYNTHETIC RETENTION",
    incidentAndDeletionProcedure: "SYNTHETIC PROCEDURE",
    inventory: personalDataLocations.map((kind) => ({
      kind,
      applicable: true,
      country: "KZ",
      operatorOrProcessor: "SYNTHETIC PROCESSOR",
      evidence: "SYNTHETIC CONTRACT",
      access: "SCOPED",
      retention: "DEFINED",
    })),
  };
  assert.equal(lmsDeploymentEvidenceAllowed(evidence, id), true);
  assert.equal(lmsDeploymentEvidenceAllowed(evidence, randomUUID()), false);
  for (const kind of personalDataLocations) {
    for (const country of ["", "US", "UNKNOWN"]) {
      const invalid = structuredClone(evidence);
      invalid.inventory.find((row) => row.kind === kind)!.country = country;
      assert.equal(
        lmsDeploymentEvidenceAllowed(invalid, id),
        false,
        kind + country,
      );
    }
  }
  assert.equal(
    lmsDeploymentEvidenceAllowed(
      { ...evidence, inventory: evidence.inventory.slice(1) },
      id,
    ),
    false,
  );
  const previous = process.env.DEMO_LMS_DEPLOYMENT_EVIDENCE;
  const directory = await mkdtemp(join(tmpdir(), "demo-lms-policy-"));
  try {
    delete process.env.DEMO_LMS_DEPLOYMENT_EVIDENCE;
    await assert.rejects(assertLmsDeploymentAllowed({ id, demoOnly: false }));
    await assertLmsDeploymentAllowed({ id, demoOnly: true });
    process.env.DEMO_LMS_DEPLOYMENT_EVIDENCE = join(directory, "evidence.json");
    await writeFile(
      process.env.DEMO_LMS_DEPLOYMENT_EVIDENCE,
      JSON.stringify([evidence]),
    );
    await assertLmsDeploymentAllowed({ id, demoOnly: false });
    await assert.rejects(
      assertLmsDeploymentAllowed({ id: randomUUID(), demoOnly: false }),
    );
  } finally {
    if (previous === undefined) delete process.env.DEMO_LMS_DEPLOYMENT_EVIDENCE;
    else process.env.DEMO_LMS_DEPLOYMENT_EVIDENCE = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

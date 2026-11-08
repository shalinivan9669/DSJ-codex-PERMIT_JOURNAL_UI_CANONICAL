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
import {
  assertLmsDeploymentAllowed,
  inspectLmsDeployment,
} from "../apps/api/src/lms/deployment-gate";

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

test("readiness explains missing, invalid and tenant-specific evidence without exposing the document or weakening the gate", async () => {
  const id = randomUUID();
  const tenant = { id, demoOnly: false };
  const evidence = {
    tenantId: id,
    operator: "PRIVATE OPERATOR",
    approvedBy: "PRIVATE REVIEWER",
    approvalReference: "PRIVATE APPROVAL",
    lawfulBasis: "SYNTHETIC BASIS",
    subjectAccountingReference: "SYNTHETIC ACCOUNTING",
    retentionPolicy: "SYNTHETIC RETENTION",
    incidentAndDeletionProcedure: "SYNTHETIC PROCEDURE",
    inventory: personalDataLocations.map((kind) => ({
      kind,
      applicable: true,
      country: "KZ",
      operatorOrProcessor: "PRIVATE PROCESSOR",
      evidence: "PRIVATE EVIDENCE",
      access: "SCOPED",
      retention: "DEFINED",
    })),
  };
  const previous = process.env.DEMO_LMS_DEPLOYMENT_EVIDENCE;
  const directory = await mkdtemp(join(tmpdir(), "demo-lms-readiness-"));
  const path = join(directory, "private-evidence.json");
  async function denied(reason: string) {
    const result = await inspectLmsDeployment(tenant);
    assert.deepEqual(result, { available: false, reason });
    assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
    assert.equal(JSON.stringify(result).includes(directory), false);
    await assert.rejects(
      assertLmsDeploymentAllowed(tenant),
      (error: unknown) =>
        !!error &&
        typeof error === "object" &&
        "getResponse" in error &&
        typeof error.getResponse === "function" &&
        error.getResponse().code === "LMS_DEPLOYMENT_REVIEW_REQUIRED",
    );
  }
  try {
    delete process.env.DEMO_LMS_DEPLOYMENT_EVIDENCE;
    await denied("NOT_CONFIGURED");
    assert.deepEqual(
      await inspectLmsDeployment({ ...tenant, demoOnly: true }),
      { available: true, reason: "SYNTHETIC" },
    );
    process.env.DEMO_LMS_DEPLOYMENT_EVIDENCE = "relative.json";
    await denied("UNREADABLE");
    process.env.DEMO_LMS_DEPLOYMENT_EVIDENCE = path;
    await denied("UNREADABLE");
    for (const content of ["not JSON", "{}", " ".repeat(256 * 1024 + 1)]) {
      await writeFile(path, content);
      await denied("INVALID_DOCUMENT");
    }
    await writeFile(
      path,
      JSON.stringify([{ ...evidence, tenantId: randomUUID() }]),
    );
    await denied("TENANT_MISSING");
    for (const invalid of [
      { ...evidence, approvalReference: "" },
      { ...evidence, inventory: evidence.inventory.slice(1) },
      {
        ...evidence,
        inventory: [...evidence.inventory.slice(1), evidence.inventory[1]],
      },
    ]) {
      await writeFile(path, JSON.stringify([invalid]));
      await denied("INCOMPLETE");
    }
    await writeFile(
      path,
      JSON.stringify([
        {
          ...evidence,
          inventory: evidence.inventory.map((row) => ({
            ...row,
            country: row.kind === "BACKUPS" ? "UNKNOWN" : "KZ",
          })),
        },
      ]),
    );
    await denied("PLACEMENT_UNCONFIRMED");
    await writeFile(
      path,
      JSON.stringify([
        null,
        { tenantId: randomUUID(), private: "PRIVATE FOREIGN DATA" },
        evidence,
      ]),
    );
    assert.deepEqual(await inspectLmsDeployment(tenant), {
      available: true,
      reason: "READY",
    });
    await assertLmsDeploymentAllowed(tenant);
  } finally {
    if (previous === undefined) delete process.env.DEMO_LMS_DEPLOYMENT_EVIDENCE;
    else process.env.DEMO_LMS_DEPLOYMENT_EVIDENCE = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

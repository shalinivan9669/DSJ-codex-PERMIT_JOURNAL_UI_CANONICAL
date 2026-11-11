import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
  preparationConfig,
  provisionTarget,
  sampleDraft,
  parseCredentialFile,
} from "../scripts/verification/prepare-hosted-signing";

const env = {
  DEMO_HOSTED_PREPARE_APPLY: "1",
  DEMO_HOSTED_PREPARE_KEY: "synthetic_cloud_20261111",
  DEMO_HOSTED_PREPARE_EMAIL: "synthetic-cloud@example.test",
  DEMO_HOSTED_PREPARE_PASSWORD: "Synthetic-only-long-password",
  DEMO_HOSTED_PREPARE_DATE: "2026-11-11",
  DEMO_HOSTED_PREPARE_EXPECTED_ORIGIN: "https://synthetic-web.example.test",
  DEMO_HOSTED_PREPARE_EXPECTED_API_ORIGIN: "https://synthetic-api.example.test",
  DEMO_ORIGIN: "https://synthetic-web.example.test",
  DEMO_API_ORIGIN: "https://synthetic-api.example.test",
  DATABASE_URL:
    "postgresql://synthetic:unused@db.example.test:5432/demo_synthetic",
  DEMO_HOSTED_PREPARE_EXPECTED_DB_HOST: "db.example.test",
  DEMO_HOSTED_PREPARE_EXPECTED_DB_NAME: "demo_synthetic",
  DEMO_ARTIFACT_ROOT: resolve(".runtime/synthetic-preparation-test"),
  DEMO_HOSTED_PREPARE_EXPECTED_ARTIFACT_ROOT: resolve(
    ".runtime/synthetic-preparation-test",
  ),
};

test("malformed private credential JSON never includes secret material in reported errors", () => {
  const secret = "Synthetic-secret-that-must-never-be-logged";
  assert.throws(
    () => parseCredentialFile(`{"password":"${secret}" oops}`),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "CREDENTIAL_FILE_INVALID");
      assert.ok(!JSON.stringify({ message: error.message }).includes(secret));
      return true;
    },
  );
});

test("cloud preparation requires explicit exact target pins and dedicated synthetic credentials", () => {
  assert.equal(preparationConfig(env).key, env.DEMO_HOSTED_PREPARE_KEY);
  assert.equal(provisionTarget(env).databaseName, "demo_synthetic");
  for (const override of [
    { DEMO_HOSTED_PREPARE_APPLY: "0" },
    { DEMO_HOSTED_PREPARE_KEY: "" },
    { DEMO_HOSTED_PREPARE_EMAIL: "director@real-center.example" },
    { DEMO_HOSTED_PREPARE_PASSWORD: "short" },
    { DEMO_ORIGIN: "https://another.example.test" },
    { DEMO_API_ORIGIN: "https://another.example.test" },
    {
      DEMO_HOSTED_PREPARE_EXPECTED_ORIGIN: "http://localhost:3000",
      DEMO_ORIGIN: "http://localhost:3000",
    },
    {
      DEMO_HOSTED_PREPARE_EXPECTED_API_ORIGIN: "https://api.example.test/path",
      DEMO_API_ORIGIN: "https://api.example.test/path",
    },
    { DEMO_HOSTED_PREPARE_DATE: "2026-02-30" },
  ])
    assert.throws(() => preparationConfig({ ...env, ...override }));
  for (const override of [
    { DEMO_HOSTED_PREPARE_EXPECTED_DB_HOST: "another.example.test" },
    { DEMO_HOSTED_PREPARE_EXPECTED_DB_NAME: "another_database" },
    {
      DEMO_HOSTED_PREPARE_EXPECTED_ARTIFACT_ROOT: resolve(
        ".runtime/another-root",
      ),
    },
    { DEMO_ARTIFACT_ROOT: "relative-path" },
  ])
    assert.throws(() => provisionTarget({ ...env, ...override }));
});

test("cloud samples are deterministic, visibly synthetic and contain three workers plus one person", () => {
  const config = preparationConfig(env);
  const customer = "70000000-0000-4000-8000-000000000001";
  const company = sampleDraft(config, true, customer);
  const person = sampleDraft(config, false);
  assert.deepEqual(sampleDraft(config, true, customer), company);
  assert.deepEqual(sampleDraft(config, false), person);
  assert.equal(company.items.length, 3);
  assert.equal(person.items.length, 1);
  assert.equal(company.customerId, customer);
  assert.equal(person.customerId, null);
  for (const draft of [company, person]) {
    assert.equal(draft.demoMode, true);
    assert.equal(draft.businessRuleVersion, "LIVE_V1");
    assert.match(draft.title, /ТЕСТ ЭЦП/);
    assert.equal(draft.commonFields?.documentDate, "2026-11-11");
    assert.ok(
      draft.items.every((item) =>
        item.assignments.every((assignment) =>
          /Синтетический/.test(assignment.outcome?.source || ""),
        ),
      ),
    );
  }
  assert.equal(company.events?.[0].protocolMode, "GROUP");
  assert.equal(person.events?.[0].protocolMode, "INDIVIDUAL");
  assert.equal(company.items[0].assignments[0].templateId, "pb-card");
  assert.equal(person.items[0].assignments[0].templateId, "biot-worker-card");
});

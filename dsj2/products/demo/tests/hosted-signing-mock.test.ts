import test from "node:test";
import assert from "node:assert/strict";
import {
  HOSTED_SIGNING_MOCK_PROVIDER,
  LOCAL_SIGNING_MOCK_PROVIDER,
  localSigningMockEnabled,
  signingMockMode,
} from "../apps/api/src/local-signing-mock";

const tenantId = "70000000-0000-4000-8000-000000000001";
const scope = { tenantId, demoOnly: true, demoMode: true };
const env = {
  NODE_ENV: "production",
  HOST: "0.0.0.0",
  DATABASE_URL: "postgresql://synthetic@db.example.test/demo",
  DEMO_LOCAL_SIGNATURE_MOCK: "0",
  DEMO_HOSTED_SIGNATURE_MOCK: "1",
  DEMO_HOSTED_SIGNATURE_MOCK_TENANT_ID: tenantId,
  DEMO_ORIGIN: "https://synthetic-web.up.railway.app",
  DEMO_API_ORIGIN: "https://synthetic-api.up.railway.app",
};

test("hosted mock requires explicit production/test opt-in, exact tenant and both synthetic flags", () => {
  assert.equal(signingMockMode(scope, env), "HOSTED_TEST_MOCK");
  assert.equal(
    signingMockMode(scope, { ...env, NODE_ENV: "test" }),
    "HOSTED_TEST_MOCK",
  );
  assert.equal(localSigningMockEnabled(env), false);
  assert.notEqual(HOSTED_SIGNING_MOCK_PROVIDER, LOCAL_SIGNING_MOCK_PROVIDER);
  assert.equal(HOSTED_SIGNING_MOCK_PROVIDER, "NCALAYER_HOSTED_TEST");
  for (const override of [
    { DEMO_HOSTED_SIGNATURE_MOCK: "0" },
    { DEMO_HOSTED_SIGNATURE_MOCK: "" },
    { DEMO_HOSTED_SIGNATURE_MOCK: "true" },
    { DEMO_HOSTED_SIGNATURE_MOCK_TENANT_ID: "" },
    { DEMO_HOSTED_SIGNATURE_MOCK_TENANT_ID: "*" },
    {
      DEMO_HOSTED_SIGNATURE_MOCK_TENANT_ID: `${tenantId},70000000-0000-4000-8000-000000000002`,
    },
    {
      DEMO_HOSTED_SIGNATURE_MOCK_TENANT_ID:
        "70000000-0000-4000-8000-000000000002",
    },
    { NODE_ENV: "development" },
    { NODE_ENV: "" },
  ])
    assert.equal(
      signingMockMode(scope, { ...env, ...override }),
      null,
      JSON.stringify(override),
    );
  for (const override of [
    { demoOnly: false },
    { demoMode: false },
    { tenantId: "70000000-0000-4000-8000-000000000002" },
  ])
    assert.equal(
      signingMockMode({ ...scope, ...override }, env),
      null,
      JSON.stringify(override),
    );
});

test("both pinned hosted origins must be clean public HTTPS hostnames", () => {
  const denied = [
    "",
    "not a URL",
    "http://synthetic.example.test",
    "https://localhost",
    "https://sub.localhost",
    "https://demo.local",
    "https://demo.internal",
    "https://demo.lan",
    "https://singlehost",
    "https://127.0.0.1",
    "https://127.1",
    "https://2130706433",
    "https://10.0.0.1",
    "https://172.16.0.1",
    "https://192.168.1.1",
    "https://169.254.169.254",
    "https://8.8.8.8",
    "https://[::1]",
    "https://[2001:4860:4860::8888]",
    "https://user:password@public.example.test",
    "https://public.example.test/",
    "https://public.example.test/path",
    "https://public.example.test/?query=1",
    "https://public.example.test/#fragment",
  ];
  for (const key of ["DEMO_ORIGIN", "DEMO_API_ORIGIN"] as const)
    for (const value of denied)
      assert.equal(
        signingMockMode(scope, { ...env, [key]: value }),
        null,
        `${key}=${value}`,
      );
});

test("hosted opt-in does not weaken the existing strictly local rehearsal", () => {
  const local = {
    ...env,
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    DATABASE_URL: "postgresql://synthetic@127.0.0.1/demo_test_hosted_guard",
    DEMO_LOCAL_SIGNATURE_MOCK: "1",
    DEMO_HOSTED_SIGNATURE_MOCK: "0",
    DEMO_ORIGIN: "http://localhost:3119",
    DEMO_API_ORIGIN: "http://127.0.0.1:4119",
  };
  assert.equal(signingMockMode(scope, local), "LOCAL_TEST_MOCK");
  assert.equal(
    signingMockMode(scope, { ...local, NODE_ENV: "production" }),
    null,
  );
  assert.equal(signingMockMode(scope, { ...local, HOST: "0.0.0.0" }), null);
  assert.equal(
    signingMockMode(scope, {
      ...local,
      DEMO_LOCAL_SIGNATURE_MOCK: "0",
      DEMO_HOSTED_SIGNATURE_MOCK: "1",
    }),
    null,
  );
});

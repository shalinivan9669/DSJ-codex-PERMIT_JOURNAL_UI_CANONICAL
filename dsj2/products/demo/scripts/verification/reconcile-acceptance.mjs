import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = "docs/evidence/operator-value";
const commit = process.argv[2];
if (!commit || !/^[a-f0-9]{40}$/.test(commit))
  throw new Error("Supply the verified source commit SHA");
const read = async (name) => JSON.parse(await readFile(name, "utf8"));
const write = async (name, data) =>
  writeFile(name, JSON.stringify(data, null, 2) + "\n");
const [
  matrix,
  features,
  business,
  audit,
  core,
  ui,
  service,
  delivery,
  executions,
  dailyCoverage,
] = await Promise.all(
  [
    "acceptance-matrix.json",
    "feature-matrix.json",
    "business-scenarios.json",
    "coverage-audit.json",
    "core-coverage.json",
    "ui-coverage.json",
    "service-coverage.json",
  ]
    .map((file) => read(`${root}/${file}`))
    .concat([
      read("docs/evidence/import-delivery/acceptance-coverage.json"),
      read(`${root}/business-execution.json`),
      read(`${root}/business-execution-coverage.json`),
    ]),
);
if (executions.status !== "PASS")
  throw new Error("Daily scenario execution must have finished successfully");
const sourceRecords = [
  ["root", core.tests],
  ["ui", ui.tests],
  ["service", service.acceptance],
  ["import_delivery", delivery.tests],
  [
    "daily_workflows",
    dailyCoverage.acceptance.map((item) => ({
      id: item.id,
      status: item.recommendedFullAcceptanceStatus,
      evidence: [
        `${root}/business-execution.json`,
        `${root}/business-execution-coverage.json`,
      ],
      scope: `${item.scenarioId}: actual persisted API/worker assertions ${item.scopedEngineeringStatus}`,
      remaining: item.boundary,
    })),
  ],
];
const order = { NOT_RUN: 0, PARTIAL: 1, PASS: 2 };
for (const test of matrix.tests) {
  const proposal = audit.acceptanceProposals.find(
    (item) => item.id === test.id,
  );
  const records = sourceRecords.flatMap(([owner, rows]) =>
    (rows || [])
      .filter((item) => item.id === test.id)
      .map((record) => ({
        owner,
        ...record,
        evidence: Array.isArray(record.evidence)
          ? record.evidence.map((reference) =>
              owner === "import_delivery" && delivery.evidence[reference]
                ? "docs/evidence/import-delivery/acceptance-coverage.json"
                : reference,
            )
          : [],
      })),
  );
  const rootRecord = records.find((item) => item.owner === "root");
  test.status =
    rootRecord?.status ||
    records.reduce(
      (best, item) =>
        (order[item.status] ?? -1) > order[best] ? item.status : best,
      proposal?.proposedStatus || "NOT_RUN",
    );
  test.evidence = [
    ...new Set(
      records.flatMap((item) =>
        Array.isArray(item.evidence) ? item.evidence : [],
      ),
    ),
  ].map((file) => (existsSync(file) ? file : `${root}/${file}`));
  test.verification_scope = records.map((item) => ({
    owner: item.owner,
    status: item.status,
    scope:
      item.observed_scope_and_remaining ||
      item.scope ||
      item.note ||
      item.implemented ||
      "See the scoped report",
    remaining: item.remaining || null,
  }));
  test.tested_commit = commit;
}
const scenarios = new Map(
  executions.scenarios
    .filter((item) => /^V\d\d$/.test(item.id))
    .map((item) => [item.id, item]),
);
for (const scenario of business.scenarios) {
  scenario.fixture_path = "tests/fixtures/operator-value/DAILY_WORKFLOWS.json";
  const executed = scenarios.get(scenario.id);
  if (executed) {
    scenario.status = executed.status;
    scenario.execution_layer = executed.layer;
    scenario.evidence = [`${root}/business-execution.json`];
    scenario.measurements = {
      apiActionCount: executed.apiActionCount,
      automationActiveMs: executed.automationActiveMs,
      renderWorkerMs: executed.renderWorkerMs,
      humanActiveMs: null,
      manualReentryCount: null,
    };
  } else if (scenario.id === "V01") {
    scenario.status = "PASS";
    scenario.execution_layer = "LIVE_BROWSER_REAL_API_AND_SAVED_PDF";
    scenario.evidence = [
      `${root}/v01-biot-browser/results.json`,
      `${root}/v01-biot-browser/v01-result.json`,
    ];
  } else if (scenario.id === "V07") {
    scenario.status = "PARTIAL";
    scenario.execution_layer =
      "LIVE_BROWSER_PORTAL_AND_HTTP_MEMBERSHIP_BOUNDARIES";
    scenario.evidence = [
      `${root}/library-portal-browser/portal-retake-result.json`,
      "tests/integration/operator-value-http.test.ts",
      "tests/integration/portal-evidence-http.test.ts",
    ];
    scenario.remaining =
      "Portal identity/evidence upload/reload/download and rights tested; the complete supplied multi-person V07 operator fixture was not replayed as one browser journey.";
  }
  scenario.tested_commit = commit;
}
// Backend daily fixtures are real integrations, but do not stand in for the
// explicitly requested complete operator journey and human time measurement.
for (const test of matrix.tests.filter((item) => item.business_scenario_id)) {
  const scenario = business.scenarios.find(
    (item) => item.id === test.business_scenario_id,
  );
  if (!scenario) continue;
  test.evidence = [...new Set([...test.evidence, ...scenario.evidence])];
  if (scenario.status === "PASS" && test.status === "NOT_RUN")
    test.status = "PARTIAL";
  test.execution_layer = scenario.execution_layer;
}
const modules = [
  "packages/contracts/src/resolution.ts",
  "apps/web/components/event-context.tsx",
  "apps/web/lib/bulk-edit.ts",
  "apps/web/components/settings.tsx",
  "apps/api/src/requests.ts",
  "apps/api/src/requests.ts",
  "apps/api/src/operator-value.ts",
  "apps/api/src/recipients.ts",
  "apps/web/components/import-dialog.tsx",
  "apps/api/src/imports.ts",
  "apps/api/src/delivery-approval.ts",
  "apps/web/components/customer-review.tsx",
  "apps/api/src/files.ts",
  "apps/web/components/customer-output.tsx",
  "apps/api/src/delivery.ts",
  "apps/web/components/customer-output.tsx",
  "apps/api/src/duplicate-issuance.ts",
  "apps/web/lib/text-quality.ts",
  "apps/api/src/requests.ts",
  "apps/api/src/operator-value.ts",
  "apps/api/src/operator-value.ts",
  "apps/api/src/renewal-matrix.ts",
  "apps/web/components/employer-portal.tsx",
  "apps/api/src/portal-evidence.ts",
  "apps/api/src/operator-value.ts",
  "apps/api/src/center-dossier.ts",
  "apps/api/src/service-rule-applicability.ts",
  "apps/api/src/public-verification.ts",
  "apps/web/components/order-finance.tsx",
  "apps/api/src/tenant-export.ts",
  "scripts/verification/business-scenarios.ts",
  "docs/evidence/operator-value/Verification.md",
];
for (const [index, feature] of features.features.entries()) {
  const checks = matrix.tests.filter((test) =>
    test.feature_ids?.includes(feature.id),
  );
  feature.implementation_status = "IMPLEMENTED_LOCAL";
  feature.verification_status = checks.every((test) => test.status === "PASS")
    ? "PASS"
    : "PARTIAL";
  feature.implementation_path = modules[index];
  feature.tested_commit = commit;
  feature.evidence = [...new Set(checks.flatMap((test) => test.evidence))];
  feature.acceptance_counts = checks.reduce(
    (counts, test) => ({
      ...counts,
      [test.status]: (counts[test.status] || 0) + 1,
    }),
    {},
  );
}
matrix.initialStatus =
  "Preserved original handoff criteria; execution records reconciled from scoped evidence";
matrix.tested_commit = commit;
matrix.counts = matrix.tests.reduce(
  (counts, item) => ({
    ...counts,
    [item.status]: (counts[item.status] || 0) + 1,
  }),
  {},
);
matrix.commercialAcceptance =
  "NOT_COMPLETE: exact full operator acceptance, new group Word/physical print, legal review and customer pilot are not claimed";
business.executionStatus = "EXECUTED_WITH_EXPLICIT_LAYER_AND_SCOPE_LIMITS";
business.measurementLimits = {
  humanActiveMs: null,
  customerWaitingMs: null,
  realPaidPilot: null,
  returnOnInvestment: null,
};
features.readiness = {
  code: "IMPLEMENTED_LOCAL",
  engineeringAcceptance: "PARTIAL_SEE_CRITERIA",
  legalAndPhysical: "NOT_RUN",
  production: "NOT_DEPLOYED",
};
const brokenReferences = [
  ...new Set(matrix.tests.flatMap((item) => item.evidence)),
].filter((file) => !existsSync(path.resolve(file)));
if (brokenReferences.length)
  throw new Error(`Missing evidence: ${brokenReferences.join(", ")}`);
if (!process.argv.includes("--check"))
  await Promise.all([
    write(`${root}/acceptance-matrix.json`, matrix),
    write(`${root}/feature-matrix.json`, features),
    write(`${root}/business-scenarios.json`, business),
  ]);
console.log(
  JSON.stringify({
    criteria: matrix.tests.length,
    counts: matrix.counts,
    notRun: matrix.tests
      .filter((item) => item.status === "NOT_RUN")
      .map((item) => ({ id: item.id, title: item.title })),
    features: features.features.length,
    scenarios: business.scenarios.length,
    commit,
  }),
);

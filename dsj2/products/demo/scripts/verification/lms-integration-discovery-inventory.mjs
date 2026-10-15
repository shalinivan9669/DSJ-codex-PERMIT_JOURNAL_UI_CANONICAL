import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import ts from "typescript";

const root = process.cwd();
const evidence = path.join(root, "docs/evidence/lms-one-run-20261015");
const logPath = "command-integration-02.log";
const log = fs.readFileSync(path.join(evidence, logPath), "utf8");
const additions = {
  "employer-identity-http.test.ts": {
    log: "agent-a/employer-identity-http-01.log",
    command: "agent-a/employer-identity-http-01.json",
    note: "Late actual4-pass Nest HTTP regression after the server employer-identity parity correction. Exact before/after source hashes are recorded in its command. The historical integration280 run predates this file and correction.",
  },
  "lms-document-scheduling.test.ts": {
    log: "root-document-projection-01.log",
    command: "root-document-projection-01.json",
    note: "Latest combined command after immutable recipient projection fix: scheduling3 plus documents8 gives11; shared total must not be counted twice. Earlier fairness-only8 PASS retained in agent-a/document-scheduling.log.",
  },
  "lms-documents.test.ts": {
    log: "root-document-projection-01.log",
    command: "root-document-projection-01.json",
    note: "Existing file gained three actual regression cases after the full integration run: two immutable recipient projection cases and one actual B2C preparation/forged-field case. Latest combined11 also includes scheduling3; do not infer that full integration02 executed these later assertions.",
    additionalCommands: [
      {
        log: "root-document-approval-message-01.log",
        command: "root-document-approval-message-01.json",
        note: "Later targeted single-language parent and two child cases passed3 after adding the explicit template-approval error assertion; this is a targeted subset, not a repeat of all document tests.",
      },
    ],
  },
  "lms-template-upgrade.test.ts": {
    log: "agent-c/template-upgrade/command03.log",
    command: "agent-c/template-upgrade/command03.json",
    note: "Late actual4-pass existing-center registration/HTTP approval suite, including final checksum verification after negative fixtures. Fullintegration02 predates this file.",
  },
  "lms-audit-boundaries.test.ts": {
    log: "agent-c/lms-audit-03.log",
    command: "agent-c/lms-audit-03-command.json",
  },
  "lms-identity-selection.test.ts": {
    log: "agent-c/lms-identity-selection-01.log",
    command: "agent-c/lms-identity-selection-01-command.json",
  },
  "lms-external-date.test.ts": { log: "root-external-date-03.log" },
  "lms-route-calendar-boundaries.test.ts": {
    log: "agent-a/route-calendar-boundaries.log",
  },
  "lms-legacy-outcome.test.ts": {
    log: "agent-c/lms-legacy-outcome-01.log",
    command: "agent-c/lms-legacy-outcome-01-command.json",
  },
};
const summary = (content) => {
  const counts = {};
  for (const name of [
    "tests",
    "suites",
    "pass",
    "fail",
    "cancelled",
    "skipped",
    "todo",
  ]) {
    const match = content.match(new RegExp(`(?:ℹ|#) ${name} (\\d+)`));
    counts[name] = match ? Number(match[1]) : null;
  }
  return counts;
};
const items = fs
  .readdirSync(path.join(root, "tests/integration"))
  .filter((name) => name.endsWith(".test.ts"))
  .sort()
  .map((name) => {
    const relative = `tests/integration/${name}`;
    const bytes = fs.readFileSync(path.join(root, relative));
    const source = ts.createSourceFile(
      relative,
      bytes.toString("utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const titles = [];
    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "test" &&
        node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0])
      )
        titles.push(node.arguments[0].text);
      ts.forEachChild(node, visit);
    };
    visit(source);
    const supplementary = additions[name];
    const extra = supplementary
      ? fs.readFileSync(path.join(evidence, supplementary.log), "utf8")
      : null;
    return {
      file: relative,
      currentInventorySha256: crypto
        .createHash("sha256")
        .update(bytes)
        .digest("hex"),
      staticTopLevelTestTitles: titles,
      mainLogTitleMatches: titles.map((title) => ({
        title,
        observedInLog: log.includes(title),
      })),
      mainLogStatus:
        titles.length && titles.every((title) => log.includes(title))
          ? "TITLE_OBSERVED_CHECK_FINAL_EXIT_AND_TEST_OUTCOME"
          : "NOT_YET_OBSERVED_OR_LATE_ADDED",
      supplementary: supplementary
        ? {
            ...supplementary,
            sha256: crypto.createHash("sha256").update(extra).digest("hex"),
            summary: summary(extra),
            allStaticTitlesObserved: titles.every((title) =>
              extra.includes(title),
            ),
          }
        : null,
    };
  });
const report = {
  generatedAt: new Date().toISOString(),
  command: "pnpm test:integration",
  glob: "tests/integration/*.test.ts",
  mainLog: logPath,
  mainLogSummary: summary(log),
  mainLogCompleteSummaryObserved: summary(log).tests !== null,
  note: "Inventory records the actual final glob and test titles observed in logs, not an assumption that every current file existed at process launch. Supplementary late/updated cases have explicit independent command evidence; shared combined logs must not be double-counted. A matching title does not by itself prove PASS; the coordinator must bind the final command exit and all outcomes. Current source hashes are inventory hashes, not fabricated execution-time hashes.",
  files: items,
};
const outputName =
  process.env.LMS_INTEGRATION_INVENTORY_OUTPUT ||
  "INTEGRATION_DISCOVERY_INVENTORY.json";
if (!/^INTEGRATION_DISCOVERY_INVENTORY(?:_[A-Z0-9]+)?\.json$/.test(outputName))
  throw new Error("SCOPED_INTEGRATION_INVENTORY_NAME_REQUIRED");
fs.writeFileSync(
  path.join(evidence, "agent-c", outputName),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    files: items.length,
    titleObserved: items.filter((item) =>
      item.mainLogStatus.startsWith("TITLE_"),
    ).length,
    supplementary: Object.keys(additions).length,
    completeSummaryObserved: report.mainLogCompleteSummaryObserved,
  }),
);

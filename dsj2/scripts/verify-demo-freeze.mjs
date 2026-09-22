import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const workspace = fileURLToPath(new URL("../", import.meta.url));
const repository = path.dirname(workspace);
const baseline =
  process.env.DEMO_FREEZE_BASELINE ||
  "161c5ed022c9e2c643e80802d3f9dc2cd496a041";
const git = (args) =>
  execFileSync("git", args, {
    cwd: repository,
    encoding: "utf8",
    windowsHide: true,
  }).trim();
git(["rev-parse", "--verify", `${baseline}^{commit}`]);
const adapters = new Set([
  "apps/api/package.json",
  "apps/api/src/app.module.ts",
  "apps/api/src/main.ts",
  "apps/worker/src/main.ts",
  "apps/ncalayer-bridge/src/main.ts",
  "apps/web/app/(app)/access-denied/page.tsx",
  "apps/web/app/(app)/certificates/biot-experimental/page.tsx",
  "apps/web/app/(app)/certificates/requests/[id]/edit/page.tsx",
  "apps/web/app/(app)/layout.tsx",
  "apps/web/app/layout.tsx",
  "apps/web/app/login/page.tsx",
  "apps/web/components/login-form.tsx",
  "apps/web/lib/api.ts",
  "apps/web/lib/auth.ts",
  "apps/web/lib/company-context.ts",
  "apps/web/next.config.ts",
]);
const changed = git([
  "diff",
  "--name-only",
  baseline,
  "--",
  "dsj2/apps",
  "dsj2/packages/database",
  "dsj2/packages/types",
  "dsj2/packages/utils",
  "dsj2/docs/experimental",
])
  .split("\n")
  .filter(Boolean);
const newAdapters = new Set([
  "apps/api/src/common/guards/product-boundary.guard.ts",
  "apps/api/src/common/product-boundary.middleware.ts",
  "apps/api/src/common/product-boundary.test.ts",
  "apps/web/middleware.ts",
  "apps/web/components/printing-shell.tsx",
  "apps/web/app/api/auth/login/route.ts",
  "apps/web/app/api/auth/logout/route.ts",
]);
const allowed = (file) => {
  const local = file.replace(/^dsj2\//, "");
  return (
    adapters.has(local) ||
    newAdapters.has(local) ||
    local.startsWith("apps/api/src/printing/")
  );
};
const forbidden = changed.filter((file) => !allowed(file));
if (forbidden.length)
  throw new Error(
    `Frozen source changed outside authorized boundary adapters:\n${forbidden.join("\n")}`,
  );
const tracked = git([
  "ls-tree",
  "-r",
  "--name-only",
  baseline,
  "--",
  "dsj2/apps",
  "dsj2/packages/database",
  "dsj2/packages/types",
  "dsj2/packages/utils",
  "dsj2/docs/experimental",
])
  .split("\n")
  .filter(Boolean);
const trackedSet = new Set(tracked);
const added = [
  ...new Set([
    ...git([
      "ls-files",
      "--others",
      "--exclude-standard",
      "--",
      "dsj2/apps",
      "dsj2/packages/database",
      "dsj2/packages/types",
      "dsj2/packages/utils",
      "dsj2/docs/experimental",
    ])
      .split("\n")
      .filter(Boolean),
    ...changed.filter((file) => !trackedSet.has(file)),
  ]),
];
const forbiddenAdded = added.filter((file) => {
  const local = file.replace(/^dsj2\//, "");
  return !newAdapters.has(local) && !local.startsWith("apps/api/src/printing/");
});
if (forbiddenAdded.length)
  throw new Error(
    `Unexpected new frozen-area files:\n${forbiddenAdded.join("\n")}`,
  );
const absent = tracked.filter(
  (file) => !fs.existsSync(path.join(repository, file)),
);
if (absent.length)
  throw new Error(`Preserved source missing:\n${absent.join("\n")}`);
const modified = changed.filter((file) => trackedSet.has(file));
console.log(
  JSON.stringify(
    {
      baseline,
      trackedLegacyFiles: tracked.length,
      unchangedPreservedFiles: tracked.length - modified.length,
      authorizedBoundaryAdaptersChanged: modified.length,
      authorizedNewBoundaryFiles: added.length,
      changedAdapters: changed,
      frozenBusinessLogicChanges: forbidden.length,
      missingPreservedFiles: absent.length,
    },
    null,
    2,
  ),
);

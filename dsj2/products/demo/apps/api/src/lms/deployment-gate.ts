import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { lmsDeploymentEvidenceAllowed } from "@demo/contracts/src/lms/deployment-gates";
import { fail } from "../core";

export async function assertLmsDeploymentAllowed(tenant: {
  id: string;
  demoOnly: boolean;
}) {
  if (tenant.demoOnly) return;
  const path = process.env.DEMO_LMS_DEPLOYMENT_EVIDENCE;
  let allowed = false;
  if (path && isAbsolute(path)) {
    try {
      const bytes = await readFile(path);
      if (bytes.length <= 256 * 1024) {
        const records = JSON.parse(bytes.toString("utf8"));
        allowed =
          Array.isArray(records) &&
          records.some((record) =>
            lmsDeploymentEvidenceAllowed(record, tenant.id),
          );
      }
    } catch {
      /* Missing or unverified evidence leaves the real-data gate closed. */
    }
  }
  if (!allowed)
    fail(
      503,
      "LMS_DEPLOYMENT_REVIEW_REQUIRED",
      "Доступ к обучению с реальными данными ожидает настройки центра",
    );
}

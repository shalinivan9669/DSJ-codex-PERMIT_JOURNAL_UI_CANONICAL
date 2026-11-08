import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import {
  lmsDeploymentEvidenceAllowed,
  lmsDeploymentEvidenceSchema,
  personalDataLocations,
  type LmsDeploymentReadiness,
} from "@demo/contracts/src/lms/deployment-gates";
import { fail } from "../core";

/** Only bounded diagnostic codes leave this module; evidence and server paths stay private. */
export async function inspectLmsDeployment(tenant: {
  id: string;
  demoOnly: boolean;
}): Promise<LmsDeploymentReadiness> {
  if (tenant.demoOnly) return { available: true, reason: "SYNTHETIC" };
  const path = process.env.DEMO_LMS_DEPLOYMENT_EVIDENCE;
  if (!path) return { available: false, reason: "NOT_CONFIGURED" };
  if (!isAbsolute(path)) return { available: false, reason: "UNREADABLE" };
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    return { available: false, reason: "UNREADABLE" };
  }
  if (bytes.length > 256 * 1024)
    return { available: false, reason: "INVALID_DOCUMENT" };
  let records: unknown;
  try {
    records = JSON.parse(bytes.toString("utf8"));
  } catch {
    return { available: false, reason: "INVALID_DOCUMENT" };
  }
  if (!Array.isArray(records))
    return { available: false, reason: "INVALID_DOCUMENT" };
  if (records.some((record) => lmsDeploymentEvidenceAllowed(record, tenant.id)))
    return { available: true, reason: "READY" };
  const own = records.filter(
    (record: unknown) =>
      record !== null &&
      typeof record === "object" &&
      "tenantId" in record &&
      record.tenantId === tenant.id,
  );
  if (!own.length) return { available: false, reason: "TENANT_MISSING" };
  for (const record of own) {
    const parsed = lmsDeploymentEvidenceSchema.safeParse(record);
    if (!parsed.success) continue;
    const rows = parsed.data.inventory;
    if (
      rows.length === personalDataLocations.length &&
      personalDataLocations.every(
        (kind) => rows.filter((row) => row.kind === kind).length === 1,
      ) &&
      rows.some((row) => row.applicable && row.country !== "KZ")
    )
      return { available: false, reason: "PLACEMENT_UNCONFIRMED" };
  }
  return { available: false, reason: "INCOMPLETE" };
}

export async function assertLmsDeploymentAllowed(tenant: {
  id: string;
  demoOnly: boolean;
}) {
  if (!(await inspectLmsDeployment(tenant)).available)
    fail(
      503,
      "LMS_DEPLOYMENT_REVIEW_REQUIRED",
      "Доступ к обучению с реальными данными ожидает настройки центра",
    );
}

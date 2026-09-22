import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** A review is valid for one immutable image, exact package/version/CVE and expiry. */
export function evaluateImageScan(scan, policy, now = new Date()) {
  if (
    scan?.SchemaVersion !== 2 ||
    scan?.ArtifactType !== "container_image" ||
    !/^sha256:[a-f0-9]{64}$/.test(scan?.Metadata?.ImageID || "") ||
    !Array.isArray(scan.Results) ||
    !scan.Results.some(
      (result) =>
        result.Class === "os-pkgs" &&
        Array.isArray(result.Packages) &&
        result.Packages.length > 0,
    ) ||
    policy?.version !== 1 ||
    !Array.isArray(policy.reviewedImages)
  )
    throw new Error(
      "A complete Trivy image JSON and versioned review policy are required",
    );
  for (const result of scan.Results) {
    if (
      result.Vulnerabilities != null &&
      !Array.isArray(result.Vulnerabilities)
    )
      throw new Error("Malformed vulnerability list");
    for (const finding of result.Vulnerabilities || []) {
      if (
        !finding.VulnerabilityID ||
        !finding.PkgName ||
        !finding.InstalledVersion ||
        !["UNKNOWN", "LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(
          finding.Severity,
        )
      )
        throw new Error("Malformed vulnerability finding");
    }
  }
  const imageId = scan.Metadata.ImageID;
  const review = policy.reviewedImages.find((item) => item.imageId === imageId);
  const findings = scan.Results.flatMap((result) =>
    (result.Vulnerabilities || [])
      .filter((item) => ["HIGH", "CRITICAL"].includes(item.Severity))
      .map((item) => ({
        type: result.Type,
        cve: item.VulnerabilityID,
        package: item.PkgName,
        version: item.InstalledVersion,
        severity: item.Severity,
      })),
  );
  const accepted = [];
  const failures = (review?.unresolvedFindings || []).map((finding) => ({
    ...finding,
    rejection: "UNRESOLVED_IMAGE_REVIEW_FINDING",
  }));
  for (const finding of findings) {
    const rule = review?.findings?.find(
      (item) =>
        item.type === finding.type &&
        item.cve === finding.cve &&
        item.package === finding.package &&
        item.version === finding.version &&
        item.severity === finding.severity,
    );
    let rejection;
    if (!rule) rejection = "UNREVIEWED_IMAGE_OR_FINDING";
    else {
      const reviewedAt = Date.parse(review.reviewedAt);
      const expiresAt = Date.parse(review.expiresAt);
      if (
        !Number.isFinite(reviewedAt) ||
        !Number.isFinite(expiresAt) ||
        reviewedAt > now.getTime() ||
        expiresAt <= now.getTime() ||
        expiresAt - reviewedAt > 31 * 86_400_000
      )
        rejection = "INVALID_OR_EXPIRED_REVIEW";
      else if (
        rule.disposition !== "not_affected_in_declared_runtime" ||
        typeof rule.justification !== "string" ||
        rule.justification.length < 40 ||
        !Array.isArray(rule.evidence) ||
        !rule.evidence.length ||
        !Array.isArray(rule.primarySources) ||
        !rule.primarySources.length ||
        rule.primarySources.some((source) => !/^https:\/\//.test(source))
      )
        rejection = "MISSING_SUPPORTED_DISPOSITION";
    }
    if (rejection) failures.push({ ...finding, rejection });
    else accepted.push({ ...finding, justification: rule.justification });
  }
  return {
    status: failures.length ? "FAIL" : "PASS",
    imageId,
    rawHighCritical: findings.length,
    reviewedNotAffected: accepted.length,
    accepted,
    failures,
    limitation:
      "Raw findings remain retained. Review applies only to this image and declared non-root/private/read-only runtime; a new image, package version, CVE, severity or expired review fails closed.",
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [scanPath, policyPath] = process.argv.slice(2);
    if (!scanPath || !policyPath)
      throw new Error("Usage: image-gate SCAN.json POLICY.json");
    const read = (file) =>
      JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
    const result = evaluateImageScan(read(scanPath), read(policyPath));
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "PASS") process.exitCode = 1;
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Invalid scan/review",
    );
    process.exitCode = 1;
  }
}

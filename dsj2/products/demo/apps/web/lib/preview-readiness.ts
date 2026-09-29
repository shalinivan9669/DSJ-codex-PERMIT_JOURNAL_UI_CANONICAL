import type { Artifact, Job } from "./types";

// Queue acceptance is not a usable preview. Every current job must have its
// confirmed artifact before the editor recommends the next workflow step.
export function readyPreviewRevision(
  revision: number,
  jobs: Job[],
  artifacts: Artifact[],
  missing: string[] = [],
): number | null {
  const previews = jobs.filter(
    (job) => !job.issuanceId && job.sourceRevision === revision,
  );
  if (!previews.length) return null;
  const available = new Map(
    [
      ...artifacts,
      ...jobs.flatMap((job) => [
        ...(job.artifacts || []),
        ...(job.artifact ? [job.artifact] : []),
      ]),
    ].map((artifact) => [artifact.id, artifact]),
  );
  return previews.every((job) => {
    const artifact = job.artifactId ? available.get(job.artifactId) : undefined;
    return (
      ["READY", "COMPLETED", "SUCCEEDED"].includes(job.status) &&
      artifact?.provenance === "PREVIEW" &&
      artifact.availability !== "MISSING" &&
      !missing.includes(artifact.id)
    );
  })
    ? revision
    : null;
}

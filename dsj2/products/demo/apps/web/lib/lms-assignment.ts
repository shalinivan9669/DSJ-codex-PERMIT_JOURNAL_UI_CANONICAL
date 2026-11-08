import { z } from "@demo/contracts";
import { accessPolicySchema, type AccessPolicy } from "@demo/contracts/src/lms";
import { ApiError } from "./api";
import type { Course } from "./lms-api";

export function publishedAssignmentVersion(course: Course) {
  if (course.publishedVersion?.status === "PUBLISHED")
    return course.publishedVersion;
  return course.latestVersion?.status === "PUBLISHED"
    ? course.latestVersion
    : null;
}

/** A lost response can follow a committed assignment; retry its saved operation. */
export function assignmentOutcomeUnknown(error: unknown): boolean {
  return (
    !(error instanceof ApiError) || error.status === 0 || error.status >= 500
  );
}

export type AssignmentDraft = {
  versionId: string;
  recipientIds: string[];
  groupName: string;
  customAccess: boolean;
  accessPolicy: AccessPolicy;
};

const assignmentDraftSchema = z
  .object({
    versionId: z.string().max(100),
    recipientIds: z
      .array(
        z
          .string()
          .min(1)
          .max(100)
          .refine((id) => !!id.trim()),
      )
      .max(10000),
    groupName: z.string().max(300),
    customAccess: z.boolean(),
    accessPolicy: accessPolicySchema,
  })
  .strict();

/** Only identifiers and assignment settings belong in tenant-scoped storage. */
export function readAssignmentDraft(
  raw: string | null,
): AssignmentDraft | null {
  // Bound parsing even when identifiers were stored with escaped characters.
  if (!raw || raw.length > 6_100_000) return null;
  try {
    const value: unknown = JSON.parse(raw);
    const parsed = assignmentDraftSchema.safeParse(value);
    if (!parsed.success) return null;
    return {
      ...parsed.data,
      recipientIds: [...new Set(parsed.data.recipientIds)],
    };
  } catch {
    return null;
  }
}

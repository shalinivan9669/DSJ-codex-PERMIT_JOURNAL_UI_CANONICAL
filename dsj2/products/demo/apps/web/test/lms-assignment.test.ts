import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../lib/api";
import type { Course } from "../lib/lms-api";
import {
  assignmentOutcomeUnknown,
  publishedAssignmentVersion,
  readAssignmentDraft,
  type AssignmentDraft,
} from "../lib/lms-assignment";

function fixture(): AssignmentDraft {
  return {
    versionId: "published-version",
    recipientIds: ["person-1", "person-2"],
    groupName: "Группа ноября",
    customAccess: true,
    accessPolicy: { mode: "DAYS", days: 30, timezone: "Asia/Qyzylorda" },
  };
}

test("assignment uses the published version while a newer draft is being prepared", () => {
  const published: NonNullable<Course["latestVersion"]> = {
    id: "published-v1",
    version: 1,
    status: "PUBLISHED",
    content: {
      titleRu: "Программа",
      titleKz: "Бағдарлама",
      category: "BIOT",
      hours: 40,
      accessDays: 90,
    },
    profile: {
      status: "CONFIRMED",
      assessmentKind: "CENTER_EXAM",
      legalForm: "INFORMATION_CARD",
    },
  };
  const draft = { ...published, id: "draft-v2", version: 2, status: "DRAFT" };
  const course: Course = {
    id: "course",
    latestVersion: draft,
    publishedVersion: published,
  };
  assert.equal(publishedAssignmentVersion(course), published);
  assert.equal(course.latestVersion, draft);
  assert.equal(
    publishedAssignmentVersion({ id: "legacy", latestVersion: published }),
    published,
  );
  assert.equal(
    publishedAssignmentVersion({
      id: "fallback",
      latestVersion: published,
      publishedVersion: draft,
    }),
    published,
  );
  assert.equal(
    publishedAssignmentVersion({ id: "draft-only", latestVersion: draft }),
    null,
  );
  assert.equal(publishedAssignmentVersion({ id: "empty" }), null);
});

test("response loss retains uncertain command outcome while definite rejections can be corrected", () => {
  for (const status of [0, 500, 502, 503, 504])
    assert.equal(
      assignmentOutcomeUnknown(new ApiError(status, "Failure")),
      true,
    );
  for (const status of [400, 401, 403, 404, 409, 422, 429])
    assert.equal(
      assignmentOutcomeUnknown(new ApiError(status, "Rejected")),
      false,
    );
  for (const error of [new Error("Interrupted"), null, undefined, "unknown"])
    assert.equal(assignmentOutcomeUnknown(error), true);
});

test("saved assignment restores only validated identifiers and settings, including an unfinished choice", () => {
  const draft = fixture();
  assert.deepEqual(readAssignmentDraft(JSON.stringify(draft)), draft);
  assert.deepEqual(
    readAssignmentDraft(
      JSON.stringify({
        ...draft,
        recipientIds: ["person-2", "person-1", "person-2"],
      }),
    )?.recipientIds,
    ["person-2", "person-1"],
  );
  const unfinished = { ...draft, versionId: "", recipientIds: [] };
  assert.deepEqual(readAssignmentDraft(JSON.stringify(unfinished)), unfinished);
  const fixed = {
    ...draft,
    accessPolicy: {
      mode: "FIXED",
      endsAt: "2027-01-01T00:00:00.000Z",
      timezone: "Asia/Qyzylorda",
    },
  };
  assert.deepEqual(readAssignmentDraft(JSON.stringify(fixed)), fixed);
});

test("malformed, oversized or incompatible storage cannot become assignment inputs", () => {
  const draft = fixture();
  for (const raw of [null, "", "{", "null", "[]", "true", "42", '"text"'])
    assert.equal(readAssignmentDraft(raw), null);
  for (const invalid of [
    {},
    { ...draft, versionId: null },
    { ...draft, versionId: "v".repeat(101) },
    { ...draft, recipientIds: "person-1" },
    { ...draft, recipientIds: ["person-1", 1] },
    { ...draft, recipientIds: [""] },
    { ...draft, recipientIds: ["   "] },
    { ...draft, recipientIds: ["p".repeat(101)] },
    {
      ...draft,
      recipientIds: Array.from({ length: 10001 }, (_, i) => `p-${i}`),
    },
    { ...draft, groupName: "g".repeat(301) },
    { ...draft, customAccess: "true" },
    { ...draft, accessPolicy: null },
    { ...draft, accessPolicy: { mode: "DAYS", days: -1, timezone: "UTC" } },
    {
      ...draft,
      accessPolicy: { mode: "FIXED", endsAt: "bad", timezone: "UTC" },
    },
    { ...draft, fullNameRu: "Unwanted personal data" },
  ])
    assert.equal(readAssignmentDraft(JSON.stringify(invalid)), null);
  assert.equal(readAssignmentDraft(" ".repeat(6_100_001)), null);
  const largest = {
    ...draft,
    recipientIds: Array.from({ length: 10000 }, (_, i) => `p-${i}`),
  };
  assert.equal(
    readAssignmentDraft(JSON.stringify(largest))?.recipientIds.length,
    10000,
  );
});

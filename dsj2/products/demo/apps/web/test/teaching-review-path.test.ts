import assert from "node:assert/strict";
import test from "node:test";
import { teachingReviewPath } from "../lib/teaching-review-path";

test("opening a submission and returning retain course, group and queue filters", () => {
  const context = {
    courseId: "course-1",
    groupId: "group-1",
    type: "SUBMISSION" as const,
  };
  assert.equal(
    teachingReviewPath(context, { id: "work-1", targetType: "SUBMISSION" }),
    "/lms/teaching?courseId=course-1&groupId=group-1&type=SUBMISSION&reviewId=work-1",
  );
  assert.equal(
    teachingReviewPath(context),
    "/lms/teaching?courseId=course-1&groupId=group-1&type=SUBMISSION",
  );
});

test("unfiltered queue does not retain a previously opened submission", () => {
  assert.equal(
    teachingReviewPath({ courseId: "", groupId: "", type: "ALL" }),
    "/lms/teaching",
  );
});

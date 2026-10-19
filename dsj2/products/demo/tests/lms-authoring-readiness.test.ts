import test from "node:test";
import assert from "node:assert/strict";
import {
  courseContentSchema,
  regulatoryProfileSchema,
  type CourseContent,
} from "../packages/contracts/src/lms";
import {
  assertLocalAssessmentSupported,
  localAssessmentIssues,
  regulatoryEffectiveFromIssue,
} from "../apps/api/src/lms/course-validation";
import { assertPublishable } from "../apps/api/src/lms/validation";

const content = courseContentSchema.parse({
  titleRu: "Программа",
  titleKz: "Бағдарлама",
  modules: [],
  exam: { questions: [], questionCount: 1 },
});
const profile = regulatoryProfileSchema.parse({
  title: "Основание",
  assessmentKind: "CENTER_EXAM",
});

test("regulated centre and external exam publication requires an explicit effective date", () => {
  for (const assessmentKind of ["CENTER_EXAM", "EXTERNAL_AUTHORIZED"] as const) {
    const invalid = { ...profile, assessmentKind };
    assert.throws(() => assertPublishable(content, invalid), code("POLICY_EFFECTIVE_FROM_REQUIRED"));
    const issue = regulatoryEffectiveFromIssue(content, invalid)!;
    assert.ok(issue.messageRu.includes("Действует с")); assert.ok(issue.messageKz.includes("Басталуы"));
    assert.equal(regulatoryEffectiveFromIssue(content, { ...invalid, effectiveFrom: "2026-10-01" }), null);
  }
  assert.equal(regulatoryEffectiveFromIssue({ ...content, learningOutcome: "LEARNING" }, profile), null);
  assert.equal(regulatoryEffectiveFromIssue(content, { ...profile, assessmentKind: "PRACTICE" }), null);
});
const code = (value: string) => (error: unknown) =>
  (error as { getResponse(): { code: string } }).getResponse().code === value;
function withAssignment(required: boolean): CourseContent {
  return courseContentSchema.parse({
    ...content,
    modules: [
      {
        id: "module",
        lessons: [{ id: "practice", kind: "ASSIGNMENT", required }],
      },
    ],
  });
}

test("unsupported proctoring is caught before publishing without weakening stored requirements", () => {
  const constrained = { ...profile, requiresProctoring: true };
  assert.throws(
    () => assertPublishable(content, constrained),
    code("LOCAL_PROCTORING_UNAVAILABLE"),
  );
  const [issue] = localAssessmentIssues(content, constrained);
  assert.ok(issue.messageRu.includes("наблюдатель"));
  assert.ok(issue.messageKz.includes("бақылаушы"));
  assert.equal(constrained.requiresProctoring, true);
  assert.deepEqual(localAssessmentIssues(content, { ...constrained, proctoringMode: "LOCAL_SUPERVISED" }), []);
});

test("local practice needs an explicit supported mode and at least one mandatory assignment", () => {
  for (const practiceEvidenceMode of [undefined, "UNSPECIFIED"] as const)
    assert.throws(
      () =>
        assertLocalAssessmentSupported(withAssignment(true), {
          ...profile,
          requiresPractice: true,
          practiceEvidenceMode,
        }),
      code("LOCAL_PRACTICE_MODE_REQUIRED"),
    );
  const online = {
    ...profile,
    requiresPractice: true,
    practiceEvidenceMode: "REVIEWED_ASSIGNMENTS" as const,
  };
  assert.throws(
    () => assertLocalAssessmentSupported(withAssignment(false), online),
    code("LOCAL_PRACTICE_ASSIGNMENT_REQUIRED"),
  );
  assert.throws(
    () => assertLocalAssessmentSupported(content, online),
    code("LOCAL_PRACTICE_ASSIGNMENT_REQUIRED"),
  );
  assert.deepEqual(localAssessmentIssues(withAssignment(true), online), []);
});

test("an in-person practice requirement cannot be disguised with the online evidence setting", () => {
  const online = {
    ...profile,
    requiresPractice: true,
    practiceEvidenceMode: "REVIEWED_ASSIGNMENTS" as const,
  };
  assert.throws(
    () =>
      assertLocalAssessmentSupported(withAssignment(true), {
        ...online,
        practiceEvidenceMode: "IN_PERSON",
      }),
    code("LOCAL_PRACTICE_SESSION_REQUIRED"),
  );
  const onsite = courseContentSchema.parse({
    ...withAssignment(true),
    metadata: {
      format: "IN_PERSON",
      goalRu: "",
      goalKz: "",
      audienceRu: "",
      audienceKz: "",
      documentValidity: "",
      trainingRecurrence: "",
      parameterSource: "",
    },
  });
  assert.throws(
    () => assertLocalAssessmentSupported(onsite, online),
    code("LOCAL_PRACTICE_MODE_REQUIRED"),
  );
  const withSession = courseContentSchema.parse({ ...onsite, modules: [{ id: "practice", lessons: [{ id: "session", kind: "SESSION", required: true }] }] });
  assert.deepEqual(localAssessmentIssues(withSession, { ...online, practiceEvidenceMode: "IN_PERSON" }), []);
});

test("learning-only and explicitly external assessments retain their separate existing routes", () => {
  const constrained = {
    ...profile,
    requiresProctoring: true,
    requiresPractice: true,
    practiceEvidenceMode: "IN_PERSON" as const,
  };
  assert.deepEqual(
    localAssessmentIssues(
      { ...content, learningOutcome: "LEARNING" },
      constrained,
    ),
    [],
  );
  assert.deepEqual(
    localAssessmentIssues(content, {
      ...constrained,
      assessmentKind: "EXTERNAL_AUTHORIZED",
    }),
    [],
  );
  assert.deepEqual(localAssessmentIssues(content, profile), []);
});

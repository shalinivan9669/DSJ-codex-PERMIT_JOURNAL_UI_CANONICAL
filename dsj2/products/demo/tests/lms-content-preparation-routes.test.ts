import assert from "node:assert/strict";
import test from "node:test";
import { isLmsContentPreparationRequest } from "../apps/api/src/lms/content-preparation-routes";
import { roleRouteAllowed } from "../packages/contracts/src";
import { allowedRoute, PRODUCT_POLICY } from "../packages/contracts/src/policy";

const course = "9d574916-6aae-4b4c-8e7d-31363456c551";
const staff = { role: "METHODIST" };

test("preparation covers programme drafts, question banks and source reading with exact methods", () => {
  const expected: [string, string][] = [
    ["GET", "/lms/courses"],
    ["GET", "/lms/course-options"],
    ["POST", "/lms/courses"],
    ["GET", `/lms/courses/${course}`],
    ["POST", `/lms/courses/${course}/versions`],
    ["PUT", `/lms/course-versions/${course}`],
    ["POST", `/lms/course-versions/${course}/review`],
    ["POST", `/lms/course-versions/${course}/publish`],
    ["GET", "/lms/questions"],
    ["POST", "/lms/questions"],
    ["POST", "/lms/questions/import"],
    ["GET", `/lms/questions/${course}/revisions`],
    ["POST", `/lms/questions/${course}/revisions`],
    ["GET", "/lms/regulatory"],
    ["GET", "/lms/regulatory-sources"],
  ];
  for (const [method, path] of expected)
    assert.equal(
      isLmsContentPreparationRequest(method, path, staff),
      true,
      `${method} ${path}`,
    );
  for (const method of ["DELETE", "PATCH", "HEAD", "OPTIONS"])
    for (const [, path] of expected)
      assert.equal(
        isLmsContentPreparationRequest(method, path, staff),
        false,
        `${method} ${path}`,
      );
  assert.equal(
    isLmsContentPreparationRequest(
      "GET",
      `/lms/course-versions/${course}`,
      staff,
    ),
    false,
  );
  assert.equal(
    isLmsContentPreparationRequest("POST", "/lms/regulatory-sources", staff),
    false,
  );
});

test("staff preparation does not become a role-wide or read-wide deployment bypass", () => {
  const sensitive = [
    "/lms/enrollments",
    "/lms/assignment-context",
    "/lms/groups",
    "/lms/calendar",
    "/lms/notifications",
    "/lms/reports/query",
    "/lms/workplace",
    "/lms/profile",
    "/lms/results",
    `/lms/enrollments/${course}/assignments/lesson/submission`,
    `/lms/courses/${course}/materials`,
    `/lms/materials/${course}`,
    "/lms/material-library",
    `/lms/materials/${course}/bind`,
    `/lms/materials/${course}/state`,
    `/lms/groups/${course}/recordings`,
    `/lms/courses/${course}/archive`,
    `/lms/course-versions/${course}/publish/extra`,
    `/lms/reviews/SUBMISSION/${course}`,
    `/lms/reviews/ATTEMPT/${course}/decision`,
    `/lms/courses/${course}/regulatory-review`,
    "/lms/regulatory-tasks",
    `/lms/regulatory-sources/${course}/revisions`,
    "/lms/sanitary/calendars",
    `/lms/commission/${course}/signing`,
    `/lms/documents/${course}`,
    `/lms/external-evidence/${course}/file`,
    "/learn/enrollments",
    "/learn/profile",
    "/lms/new-unreviewed-feature",
    "/lms/teaching-context",
    `/lms/courses/${course}/unknown`,
  ];
  for (const role of [
    "SUPER_ADMIN",
    "ADMIN",
    "DIRECTOR",
    "METHODIST",
    "TEACHER",
    "EXPERT",
  ])
    for (const method of ["GET", "POST", "PUT", "DELETE"])
      for (const path of sensitive)
        assert.equal(
          isLmsContentPreparationRequest(method, path, { role }),
          false,
          `${role} ${method} ${path}`,
        );
});

test("the narrow course picker registers only GET and preserves content staff roles", () => {
  const path = "/lms/course-options";
  assert.deepEqual(
    PRODUCT_POLICY.demoRoutes.filter((route) => route.path === path),
    [{ method: "GET", surface: "api", path }],
  );
  for (const role of [
    "SUPER_ADMIN",
    "ADMIN",
    "DIRECTOR",
    "METHODIST",
    "TEACHER",
    "EXPERT",
  ])
    assert.equal(roleRouteAllowed(role, path), true, role);
  for (const role of ["OPERATOR", "LEARNER", "EMPLOYER", "VIEWER", "UNKNOWN"])
    assert.equal(roleRouteAllowed(role, path), false, role);
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD"])
    assert.equal(allowedRoute("api", method, path), false, method);
  assert.equal(allowedRoute("api", "GET", `${path}/users`), false);
});

test("learners, employers and operators cannot use staff preparation as admission to learning", () => {
  for (const role of ["LEARNER", "EMPLOYER", "OPERATOR", "VIEWER", "UNKNOWN"])
    assert.equal(
      isLmsContentPreparationRequest("GET", "/lms/courses", { role }),
      false,
      role,
    );
  for (const role of ["LEARNER", "VIEWER"])
    assert.equal(
      isLmsContentPreparationRequest("GET", "/lms/courses", {
        role,
        teachingMode: true,
      }),
      true,
    );
  assert.equal(
    isLmsContentPreparationRequest("GET", "/learn/enrollments", {
      role: "LEARNER",
      teachingMode: true,
    }),
    false,
  );
  assert.equal(
    isLmsContentPreparationRequest("GET", "/lms/courses", {
      role: "UNKNOWN",
      teachingMode: true,
    }),
    false,
  );
});

test("preparation matches complete canonical paths, never prefixes or encoded extra segments", () => {
  for (const path of [
    "/lms/courses/",
    "/lms/courses//",
    "/lms/courses?tenantId=foreign",
    "/lms/courses/../enrollments",
    "/lms/courses/%2e%2e",
    "/lms/courses/course%2fmaterials",
    "/lms/courses/course/materials",
    "/lms/coursesExtra",
    "/LMS/courses",
    "/lms/questions/course/revisions/extra",
  ])
    assert.equal(
      isLmsContentPreparationRequest("GET", path, staff),
      false,
      path,
    );
});

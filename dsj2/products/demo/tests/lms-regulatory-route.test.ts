import test from "node:test";
import assert from "node:assert/strict";
import { roleRouteAllowed } from "../packages/contracts/src";
import { PRODUCT_POLICY } from "../packages/contracts/src/policy";

test("regulatory catalogue has explicit GET/HEAD route contracts and responsible role boundary", () => {
  const routes = PRODUCT_POLICY.demoRoutes.filter(route => route.path === "/lms/regulatory");
  assert.deepEqual(routes.map(route => `${route.surface}:${route.method}`).sort(), ["api:GET", "web:GET", "web:HEAD"]);
  for (const role of ["SUPER_ADMIN", "ADMIN", "DIRECTOR", "METHODIST"]) assert.equal(roleRouteAllowed(role, "/lms/regulatory"), true);
  for (const role of ["EMPLOYER", "LEARNER", "VIEWER", "OPERATOR", "TEACHER", "EXPERT", "UNKNOWN"]) assert.equal(roleRouteAllowed(role, "/lms/regulatory"), false);
});

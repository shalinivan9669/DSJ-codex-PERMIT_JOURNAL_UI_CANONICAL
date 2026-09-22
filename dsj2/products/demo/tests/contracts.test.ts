import test from "node:test";
import assert from "node:assert/strict";
import {
  draftSchema,
  itemSchema,
  assignmentSchema,
  validDate,
  validateDraft,
  today,
} from "../packages/contracts/src";
import { allowedRoute, PRODUCT_POLICY } from "../packages/contracts/src/policy";
test("date-only validates leap days and never substitutes today", () => {
  assert.equal(validDate("2024-02-29"), true);
  for (const d of ["2026-02-29", "2026-09-31", "2026-1-1", "bad", ""])
    assert.equal(validDate(d), false);
});
test("tenant midnight changes only new defaults, saved leap-day dates remain literal", (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-09-22T18:59:59Z"),
  });
  assert.equal(today("Asia/Almaty"), "2026-09-22");
  const saved = assignmentSchema.parse({
    id: "d",
    templateId: "biot-worker-card",
    documentDate: "2024-02-29",
  });
  t.mock.timers.tick(2000);
  assert.equal(today("Asia/Almaty"), "2026-09-23");
  assert.equal(today("UTC"), "2026-09-22");
  assert.equal(assignmentSchema.parse(saved).documentDate, "2024-02-29");
});
test("partial draft retains independent RU/KZ and rejects 101 rows", () => {
  const item = itemSchema.parse({
    id: "r",
    fullNameRu: "Иванов",
    fullNameKz: "Иванұлы",
    positionRu: "",
    positionKz: "Ә Ғ Қ Ң Ө Ұ Ү Һ І",
  });
  const draft = draftSchema.parse({ kind: "PERSON", items: [item] });
  assert.deepEqual(draft.items[0], item);
  assert.throws(() =>
    draftSchema.parse({
      kind: "PERSON",
      items: Array.from({ length: 101 }, (_, i) => ({
        ...item,
        id: String(i),
      })),
    }),
  );
  assert.equal(
    draftSchema.parse({
      kind: "PERSON",
      items: Array.from({ length: 100 }, (_, i) => ({
        ...item,
        id: String(i),
      })),
    }).items.length,
    100,
  );
  assert.ok(validateDraft(draft, null).length > 0);
});
test("protocol reason/education roundtrip and unbroken print limits report the specific field", () => {
  const assignment = assignmentSchema.parse({
    id: "a",
    templateId: "ptm-protocol",
    reason: "Повторная проверка",
    education: "Высшее образование",
    documentDate: "2026-12-31",
    trainingSubject: "Программа",
    result: "Результат",
  });
  assert.equal(assignmentSchema.parse(assignment).reason, "Повторная проверка");
  assert.equal(
    assignmentSchema.parse(assignment).education,
    "Высшее образование",
  );
  const draft = draftSchema.parse({
    kind: "PERSON",
    items: [
      { id: "row", fullNameRu: "X".repeat(81), assignments: [assignment] },
    ],
  });
  assert.ok(
    validateDraft(draft, null).some(
      (issue) =>
        issue.code === "PRINT_UNBROKEN_VALUE" &&
        issue.path === "items.0.fullNameRu" &&
        issue.rowId === "row",
    ),
  );
  assert.equal(
    assignmentSchema.parse({ id: "blank", templateId: "pb-protocol" })
      .education,
    "",
  );
});
test("unknown client numbers, group protocol and oversized data are rejected", () => {
  assert.throws(() =>
    assignmentSchema.parse({
      id: "a",
      templateId: "biot-protocol",
      protocolMode: "GROUP",
    }),
  );
  assert.throws(() => itemSchema.parse({ id: "a", certificateNumber: "100" }));
  assert.throws(() =>
    itemSchema.parse({ id: "a", fullNameRu: "x".repeat(501) }),
  );
});
test("product policy exact method and path deny unknown, action replay, normalization for every role", () => {
  for (const role of [
    "anonymous",
    "ADMIN",
    "OPERATOR",
    "VIEWER",
    "SUPER_ADMIN",
  ]) {
    assert.ok(role);
    for (const path of [
      "/v1/employees",
      "/employees",
      "/signing",
      "/public/invites/x",
      "/protocols",
      "/artifacts/x/extra",
      "//context",
      "/%63ontext",
      "/../context",
      "/context;foo",
      "/context/",
    ])
      assert.equal(allowedRoute("api", "GET", path), false, path);
    assert.equal(allowedRoute("api", "GET", "/context"), true);
    assert.equal(allowedRoute("api", "POST", "/context"), false);
    assert.equal(
      allowedRoute("api", "GET", "/context", { "next-action": "old" }),
      false,
    );
    assert.equal(allowedRoute("web", "POST", "/requests"), false);
  }
});
test("registered API controller method/path map equals deny-by-default policy", async () => {
  await import("../apps/api/src/main");
  const { DemoController } = await import("../apps/api/src/controller");
  const methods = [
    "GET",
    "POST",
    "PUT",
    "DELETE",
    "PATCH",
    "ALL",
    "OPTIONS",
    "HEAD",
  ];
  const routes = Object.getOwnPropertyNames(DemoController.prototype)
    .filter((k) => k !== "constructor")
    .flatMap((k) => {
      const fn =
        DemoController.prototype[k as keyof typeof DemoController.prototype];
      const path = Reflect.getMetadata("path", fn);
      const method = Reflect.getMetadata("method", fn);
      return typeof path === "string" && method !== undefined
        ? [`${methods[method]} /${path}`]
        : [];
    })
    .sort();
  assert.deepEqual(
    routes,
    PRODUCT_POLICY.demoRoutes
      .filter((r) => r.surface === "api")
      .map((r) => `${r.method} ${r.path}`)
      .sort(),
  );
});

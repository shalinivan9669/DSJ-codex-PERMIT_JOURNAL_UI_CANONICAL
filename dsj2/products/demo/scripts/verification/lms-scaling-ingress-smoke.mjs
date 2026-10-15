import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";

const fixture = JSON.parse(
  await readFile(".runtime/lms-scaling/browser-fixture.json", "utf8"),
);
assert.equal(fixture.fixtureVersion, "lms-tz-scaling-browser-v1");
const base = "http://127.0.0.1:8315";
const login = await fetch(base + "/api/auth/login", {
  method: "POST",
  headers: { origin: base, "content-type": "application/json" },
  body: JSON.stringify({
    email: fixture.director.email,
    password: fixture.director.password,
  }),
});
assert.equal(login.status, 201);
const session = await login.json();
const headers = {
  origin: base,
  cookie: login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; "),
  "x-csrf-token": session.csrfToken,
};
const pages = [];
for (const path of [
  "/lms",
  fixture.links.course,
  "/workbench?orderId=" + fixture.orderId,
]) {
  const response = await fetch(base + path, { headers });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  await response.text();
  pages.push({ path, status: response.status });
}
const size = 13 * 1024 * 1024;
const payload = Buffer.alloc(size, 32);
payload.write("%PDF-1.4\n% Synthetic transport-only upload\n");
payload.write("\n%%EOF", size - 6);
const body = new FormData();
body.set(
  "file",
  new Blob([payload], { type: "application/pdf" }),
  "synthetic-ingress-limit.pdf",
);
const uploaded = await fetch(
  `${base}/api/lms/courses/${fixture.courseId}/materials`,
  { method: "POST", headers, body },
);
assert.equal(uploaded.status, 201);
const material = await uploaded.json();
assert.equal(material.storageKey, undefined);
assert.equal(material.size, size);
const range = await fetch(`${base}/api/lms/materials/${material.id}`, {
  headers: { ...headers, range: "bytes=0-4" },
});
assert.equal(range.status, 206);
assert.equal(await range.text(), "%PDF-");
const globalLimit = await fetch(base + "/api/lms/courses", {
  method: "POST",
  headers: { ...headers, "content-type": "application/json" },
  body: JSON.stringify(" ".repeat(size)),
});
assert.equal(globalLimit.status, 413);
const denied = await fetch(base + "/training", { headers });
assert.equal(denied.status, 404);
const evidence = {
  owner: "lms-tz-scaling-20261015",
  base,
  implementation:
    "Official portable nginx/1.31.7, adapted checked deployment/nginx.conf allowlist and upload limits; localhost upstreams only",
  pages,
  upload: {
    route: `/api/lms/courses/${fixture.courseId}/materials`,
    bytes: size,
    status: uploaded.status,
    materialId: material.id,
    rangeStatus: range.status,
    privateStorageKeyExposed: false,
  },
  globalOversizedBodyStatus: globalLimit.status,
  frozenRouteStatus: denied.status,
  limitation:
    "HTTP ingress/stream verification only. Browser interaction and PDF content/render correctness are separate checks. Synthetic PDF transport fixture is never professional course content.",
};
await mkdir("docs/evidence/lms-tz-scaling-20261015", { recursive: true });
await writeFile(
  "docs/evidence/lms-tz-scaling-20261015/INGRESS_SMOKE.json",
  JSON.stringify(evidence, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    ingress: "PASS",
    pages: pages.length,
    uploadedBytes: size,
    range: range.status,
    globalLimit: globalLimit.status,
    frozenRoute: denied.status,
  }),
);

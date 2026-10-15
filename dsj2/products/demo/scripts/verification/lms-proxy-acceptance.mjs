import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const base = process.env.DEMO_ORIGIN;
assert.equal(base, "http://localhost:3159");
const fixture = JSON.parse(
  await fs.readFile(
    path.join(root, ".runtime/lms-one-run/video-browser-fixture.json"),
    "utf8",
  ),
);
const login = await fetch(base + "/api/auth/login", {
  method: "POST",
  headers: { origin: base, "content-type": "application/json" },
  body: JSON.stringify({
    email: "lms-director-20261015@example.test",
    password: "Synthetic-LMS-only-20261015!",
  }),
});
assert.equal(login.status, 201);
const token = (await login.json()).csrfToken;
const headers = {
  origin: base,
  cookie: login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; "),
  "x-csrf-token": token,
};
const uploadRoute = `/api/lms/courses/${fixture.courseId}/materials`;
const form = new FormData();
form.set(
  "file",
  new Blob(
    [await fs.readFile(fixture.videoPath), Buffer.alloc(6 * 1024 * 1024)],
    { type: "video/mp4" },
  ),
  "synthetic-above-legacy-five-MB.mp4",
);
const uploaded = await fetch(base + uploadRoute, {
  method: "POST",
  headers,
  body: form,
});
assert.equal(uploaded.status, 201, await uploaded.clone().text());
const file = await uploaded.json();
assert.ok(file.size > 5 * 1024 * 1024);
const range = await fetch(base + `/api/lms/materials/${file.id}`, {
  headers: { ...headers, range: "bytes=5-19" },
});
assert.equal(range.status, 206);
assert.equal(range.headers.get("accept-ranges"), "bytes");
assert.equal(range.headers.get("content-range"), `bytes 5-19/${file.size}`);
assert.match(range.headers.get("cache-control"), /private/);
assert.equal(range.headers.get("content-security-policy"), "sandbox");
assert.equal((await range.arrayBuffer()).byteLength, 15);
const oversizedHeader = await new Promise((resolve, reject) => {
  const request = http.request(
    base + uploadRoute,
    {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "multipart/form-data; boundary=synthetic",
        "content-length": String(512 * 1024 * 1024 + 64 * 1024 + 1),
      },
    },
    (response) => {
      response.resume();
      response.on("end", () => {
        resolve(response.statusCode);
        request.destroy();
      });
    },
  );
  request.on("error", reject);
  request.setTimeout(20000, () =>
    request.destroy(new Error("HEADER_GATE_TIMEOUT")),
  );
  request.flushHeaders();
});
assert.equal(oversizedHeader, 413);
const boundary = "synthetic-lms-bounded-stream";
async function* chunks() {
  yield Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4\n`,
  );
  for (let i = 0; i < 22; i++) yield Buffer.alloc(1024 * 1024);
  yield Buffer.from(`\r\n--${boundary}--\r\n`);
}
const oversizeChunked = await fetch(
  base + `/api/lms/enrollments/${fixture.enrollmentId}/external-evidence`,
  {
    method: "POST",
    headers: {
      ...headers,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    body: Readable.from(chunks()),
    duplex: "half",
  },
);
assert.equal(oversizeChunked.status, 413, await oversizeChunked.clone().text());
const evidence = await fetch(
  base + `/api/lms/enrollments/${fixture.enrollmentId}/external-evidence`,
  { headers },
);
assert.equal((await evidence.json()).items.length, 0);
const result = {
  status: "PASS",
  measuredAt: new Date().toISOString(),
  syntheticOnly: true,
  uploadAboveLegacy5MB: { status: uploaded.status, size: file.size },
  byteRangeThroughNextProxy: {
    status: range.status,
    exactBytes: 15,
    privateCache: true,
  },
  oversizedContentLengthRejected: oversizedHeader,
  oversizedChunkedBodyRejected: oversizeChunked.status,
  externalEvidenceRowsAfterRejectedStream: 0,
};
await fs.writeFile(
  path.join(
    root,
    "docs/evidence/lms-one-run-20261015/agent-a/PROXY_ACCEPTANCE.json",
  ),
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result));

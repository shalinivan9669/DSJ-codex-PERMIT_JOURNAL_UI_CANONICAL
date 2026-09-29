import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  supervise,
  validateEnvironment,
} from "../../deployment/railway/start.mjs";

test("Railway startup rejects missing durable storage and noncanonical public origin", () => {
  const valid = {
    DATABASE_URL: "postgresql://synthetic:synthetic@localhost:5432/synthetic",
    DEMO_ORIGIN: "https://demo.example.test",
    RAILWAY_VOLUME_MOUNT_PATH: "/data",
    DEMO_ARTIFACT_ROOT: "/data/artifacts",
    PORT: "8080",
  };
  assert.doesNotThrow(() => validateEnvironment(valid));
  for (const origin of [
    "",
    "http://example.test",
    "https://example.test/path",
    "https://example.test/",
    "https://user:secret@example.test",
  ])
    assert.throws(
      () => validateEnvironment({ ...valid, DEMO_ORIGIN: origin }),
      /DEMO_ORIGIN_HTTPS_REQUIRED/,
    );
  assert.throws(
    () => validateEnvironment({ ...valid, DATABASE_URL: "" }),
    /DATABASE_URL_REQUIRED/,
  );
  assert.throws(
    () => validateEnvironment({ ...valid, RAILWAY_VOLUME_MOUNT_PATH: "" }),
    /DURABLE_VOLUME_AT_DATA_REQUIRED/,
  );
  assert.throws(
    () => validateEnvironment({ ...valid, DEMO_ARTIFACT_ROOT: "/tmp/files" }),
    /DURABLE_VOLUME_AT_DATA_REQUIRED/,
  );
  assert.throws(
    () => validateEnvironment({ ...valid, PORT: "70000" }),
    /INVALID_PORT/,
  );
});

for (const code of [0, 7]) {
  test(`required process exit ${code} fails service and stops its live sibling`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "demo-railway-supervisor-"));
    const pidFile = join(directory, "sibling.pid");
    try {
      const result = await supervise(
        [
          {
            name: "sibling",
            command: process.execPath,
            args: [
              "-e",
              `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid)); setInterval(()=>{},1000)`,
            ],
          },
          {
            name: "failed",
            command: process.execPath,
            args: [
              "-e",
              `const fs=require('node:fs'); const timer=setInterval(()=>{ if(fs.existsSync(${JSON.stringify(pidFile)})){clearInterval(timer); process.exit(${code})}},10)`,
            ],
          },
        ],
        { graceMs: 1000 },
      );
      assert.equal(result, 1);
      const pid = Number(await readFile(pidFile, "utf8"));
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("spawn failure terminates the service rather than leaving a partial backend", async () => {
  assert.equal(
    await supervise(
      [
        {
          name: "unavailable",
          command: "demo-no-such-executable-20260929",
          args: [],
        },
        {
          name: "sibling",
          command: process.execPath,
          args: ["-e", "setInterval(()=>{},1000)"],
        },
      ],
      { graceMs: 1000 },
    ),
    1,
  );
});

test(
  "SIGTERM drains the Linux process group and kills a resistant child within its grace period",
  { skip: process.platform === "win32" },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "demo-railway-drain-"));
    const pidFile = join(directory, "resistant.pid");
    try {
      const running = supervise(
        [
          {
            name: "resistant",
            command: process.execPath,
            args: [
              "-e",
              `process.on('SIGTERM',()=>{}); require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid)); setInterval(()=>{},1000)`,
            ],
          },
        ],
        { graceMs: 300 },
      );
      let pid;
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          pid = Number(await readFile(pidFile, "utf8"));
          break;
        } catch {
          await delay(20);
        }
      }
      assert.ok(pid, "child should reach ready state");
      process.emit("SIGTERM");
      assert.equal(await running, 0);
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          process.kill(pid, 0);
          await delay(20);
        } catch {
          break;
        }
      }
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

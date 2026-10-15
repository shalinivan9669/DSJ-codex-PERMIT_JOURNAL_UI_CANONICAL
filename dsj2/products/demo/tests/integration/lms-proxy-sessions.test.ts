import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { bootstrap } from "../../apps/api/src/main";
import { db } from "../../apps/api/src/core";
import { lmsTenant, lmsLearner, lmsSession } from "./lms-fixture";

test(
  "V3 S1 proxy HTTP: two authenticated users behind one trusted proxy keep separate budgets; spoofed IP/cookies do not reset anonymous admission",
  { timeout: 60_000 },
  async (t) => {
    process.env.PORT = "0";
    process.env.DEMO_ORIGIN = "http://127.0.0.1:3315";
    process.env.DEMO_PROXY_KEY = randomBytes(32).toString("hex");
    process.env.DEMO_TRUSTED_PROXY_IPS = "127.0.0.1,::1";
    const app = await bootstrap();
    t.after(async () => {
      await app.close();
      await db.$disconnect();
    });
    const base = await app.getUrl();
    const center = await lmsTenant("proxy-shared-session");
    const learner = await lmsLearner(center.tenant.id, "proxy shared");
    const sessions = [
      await lmsSession(base, center.user.email),
      await lmsSession(base, learner.user.email),
    ];
    const trustedHeaders = {
      "x-demo-proxy-key": process.env.DEMO_PROXY_KEY,
      "x-demo-client-ip": "203.0.113.20",
    };
    const normal: number[] = [];
    // A bounded admission boundary check: 650 total, 325 per user, in batches of 10.
    for (let offset = 0; offset < 650; offset += 10) {
      normal.push(
        ...(await Promise.all(
          Array.from({ length: 10 }, async (_, n) => {
            const response = await fetch(base + "/auth/session", {
              headers: { ...sessions[(offset + n) % 2], ...trustedHeaders },
            });
            await response.arrayBuffer();
            return response.status;
          }),
        )),
      );
    }
    assert.equal(normal.length, 650);
    assert.ok(
      normal.every((status) => status === 200),
      `shared proxy statuses: ${JSON.stringify([...new Set(normal)])}`,
    );
    const denied: number[] = [];
    for (let offset = 0; offset < 610; offset += 10) {
      denied.push(
        ...(await Promise.all(
          Array.from({ length: 10 }, async (_, n) => {
            const response = await fetch(base + "/auth/session", {
              headers: {
                cookie: `demo_session=${randomBytes(32).toString("hex")}`,
                "x-demo-client-ip": `198.51.100.${((offset + n) % 250) + 1}`,
                "x-demo-proxy-key": "wrong-synthetic-key",
                "x-forwarded-for": `192.0.2.${((offset + n) % 250) + 1}`,
              },
            });
            await response.arrayBuffer();
            return response.status;
          }),
        )),
      );
    }
    assert.ok(denied.includes(401));
    assert.ok(
      denied.includes(429),
      "changing spoofed IPs and random session cookies must still exhaust the anonymous peer budget",
    );
    assert.ok(denied.slice(-10).every((status) => status === 429));
    const stillAuthorized = await fetch(base + "/auth/session", {
      headers: { ...sessions[0], ...trustedHeaders },
    });
    assert.equal(stillAuthorized.status, 200);
    await stillAuthorized.arrayBuffer();
    t.diagnostic(
      `owner=lms-tz-scaling-20261015 apiPid=${process.pid}; authenticated=650/650 HTTP200; spoofed anonymous last10 HTTP429; valid session remains HTTP200`,
    );
  },
);

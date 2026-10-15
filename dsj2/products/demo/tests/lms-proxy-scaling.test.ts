import test from "node:test";
import assert from "node:assert/strict";
import type { DemoRequest } from "../apps/api/src/core";
import { trustedClientIp } from "../apps/api/src/proxy-policy";
import { rateLimit } from "../apps/api/src/auth";

test("S1.1 only an exact configured proxy peer with its secret supplies an audit/login client IP", () => {
  const previous = {
    key: process.env.DEMO_PROXY_KEY,
    peers: process.env.DEMO_TRUSTED_PROXY_IPS,
  };
  process.env.DEMO_PROXY_KEY = "synthetic-local-proxy-key-for-test-20261015";
  process.env.DEMO_TRUSTED_PROXY_IPS = "127.0.0.1";
  const request = (peer: string, headers: Record<string, string>) =>
    ({ socket: { remoteAddress: peer }, headers }) as Pick<
      DemoRequest,
      "socket" | "headers"
    >;
  try {
    assert.equal(
      trustedClientIp(
        request("::ffff:127.0.0.1", { "x-forwarded-for": "198.51.100.1" }),
      ),
      "127.0.0.1",
    );
    assert.equal(
      trustedClientIp(
        request("127.0.0.1", {
          "x-demo-client-ip": "198.51.100.2",
          "x-demo-proxy-key": "forged",
        }),
      ),
      "127.0.0.1",
    );
    assert.equal(
      trustedClientIp(
        request("192.0.2.4", {
          "x-demo-client-ip": "198.51.100.2",
          "x-demo-proxy-key": process.env.DEMO_PROXY_KEY,
        }),
      ),
      "192.0.2.4",
    );
    assert.equal(
      trustedClientIp(
        request("127.0.0.1", {
          "x-demo-client-ip": "198.51.100.2",
          "x-demo-proxy-key": process.env.DEMO_PROXY_KEY,
        }),
      ),
      "198.51.100.2",
    );
    assert.equal(
      trustedClientIp(
        request("127.0.0.1", {
          "x-demo-client-ip": "198.51.100.2,198.51.100.3",
          "x-demo-proxy-key": process.env.DEMO_PROXY_KEY,
        }),
      ),
      "127.0.0.1",
    );
  } finally {
    if (previous.key === undefined) delete process.env.DEMO_PROXY_KEY;
    else process.env.DEMO_PROXY_KEY = previous.key;
    if (previous.peers === undefined) delete process.env.DEMO_TRUSTED_PROXY_IPS;
    else process.env.DEMO_TRUSTED_PROXY_IPS = previous.peers;
  }
});

test("S1.1 a session budget cannot consume another authenticated identity budget", () => {
  const prefix = `scaling:${Date.now()}:${Math.random()}`;
  for (let i = 0; i < 600; i++) {
    rateLimit(`${prefix}:session-a`, 600);
    rateLimit(`${prefix}:session-b`, 600);
  }
  assert.throws(() => rateLimit(`${prefix}:session-a`, 600));
  rateLimit(`${prefix}:session-c`, 600);
});

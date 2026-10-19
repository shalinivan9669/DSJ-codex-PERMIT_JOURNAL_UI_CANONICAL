import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { bootstrap } from "../../apps/api/src/main";
import { db, hash } from "../../apps/api/src/core";
import {
  createMfaChallenge,
  decryptMfaSeed,
  encryptMfaSeed,
} from "../../apps/api/src/mfa";
import { lmsTenant, lmsSession, lmsHttp, LMS_PASSWORD } from "./lms-fixture";

const { TOTP, Secret } = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
)("otpauth") as typeof import("../../apps/api/node_modules/otpauth");
async function body(response: Response, status = 201) {
  assert.equal(
    response.status,
    status,
    `HTTP status ${response.status}; expected ${status}`,
  );
  return response.json();
}
test(
  "N08: real HTTP MFA admission, reauth, atomic replay/recovery, policy, key loss and safe audit",
  { timeout: 180_000 },
  async () => {
    process.env.PORT = "0";
    process.env.HOST = "127.0.0.1";
    process.env.DEMO_ORIGIN = "http://127.0.0.1:3159";
    const originalKeys = process.env.DEMO_MFA_KEYS,
      originalVersion = process.env.DEMO_MFA_KEY_VERSION;
    process.env.DEMO_MFA_KEYS = JSON.stringify({
      v1: randomBytes(32).toString("hex"),
    });
    process.env.DEMO_MFA_KEY_VERSION = "v1";
    const app = await bootstrap(),
      base = await app.getUrl();
    const fixture = await lmsTenant("MFA atomic admission"),
      userId = fixture.user.id;
    const publicHttp = lmsHttp(base, { origin: process.env.DEMO_ORIGIN });
    const first = lmsHttp(base, await lmsSession(base, fixture.user.email));
    const peer = await db.user.create({
      data: {
        tenantId: fixture.tenant.id,
        email: `peer-${userId}@example.test`,
        displayName: "Synthetic old staff",
        role: "OPERATOR",
        passwordHash: fixture.user.passwordHash,
      },
    });
    const oldStaff = lmsHttp(base, await lmsSession(base, peer.email));
    try {
      await body(
        await first("/auth/mfa/setup", "POST", { reauthToken: "0".repeat(64) }),
        403,
      );
      await body(
        await first("/auth/mfa/reauth", "POST", {
          password: "incorrect",
          purpose: "SETUP",
        }),
        403,
      );
      const reauth = await body(
        await first("/auth/mfa/reauth", "POST", {
          password: LMS_PASSWORD,
          purpose: "SETUP",
        }),
      );
      const setup = await body(
        await first("/auth/mfa/setup", "POST", {
          reauthToken: reauth.reauthToken,
        }),
      );
      assert.equal(
        (await body(await first("/auth/mfa/status"), 200)).enabled,
        false,
      );
      const pending = await db.mfaFactor.findUniqueOrThrow({
        where: { userId },
      });
      assert.ok(
        !pending.secretCiphertext &&
          pending.pendingCiphertext &&
          !pending.pendingCiphertext.includes(setup.secret),
      );
      const totp = new TOTP({
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: Secret.fromBase32(setup.secret),
      });
      const confirmed = await body(
        await first("/auth/mfa/confirm", "POST", {
          reauthToken: reauth.reauthToken,
          code: totp.generate(),
        }),
      );
      assert.equal(confirmed.recoveryCodes.length, 10);
      const stored = await db.mfaRecoveryCode.findMany({ where: { userId } });
      assert.ok(
        stored.every((r) => !confirmed.recoveryCodes.includes(r.codeHash)),
      );
      assert.equal(await db.session.count({ where: { userId } }), 0);
      await body(await first("/context"), 401);

      const login = await publicHttp("/auth/login", "POST", {
        email: fixture.user.email,
        password: LMS_PASSWORD,
      });
      const challenge = await body(login);
      assert.equal(challenge.mfaRequired, true);
      assert.equal(login.headers.getSetCookie().length, 0);
      await body(await publicHttp("/context"), 401);
      await body(await publicHttp("/lms/reports"), 401);
      await body(
        await publicHttp("/auth/mfa/challenge", "POST", {
          challengeToken: challenge.challengeToken,
          code: "000000",
        }),
        401,
      );
      const currentUser = () =>
        db.user.findUniqueOrThrow({ where: { id: userId } });
      const newChallenge = async () => createMfaChallenge(await currentUser());
      const expired = await newChallenge();
      await db.mfaChallenge.update({
        where: { id: hash(expired.challengeToken) },
        data: { expiresAt: new Date(0) },
      });
      await body(
        await publicHttp("/auth/mfa/challenge", "POST", {
          challengeToken: expired.challengeToken,
          code: confirmed.recoveryCodes[9],
        }),
        401,
      );
      const attempts = await Promise.all([newChallenge(), newChallenge()]);
      const raced = await Promise.all(
        attempts.map((c) =>
          publicHttp("/auth/mfa/challenge", "POST", {
            challengeToken: c.challengeToken,
            code: confirmed.recoveryCodes[0],
          }),
        ),
      );
      assert.deepEqual(raced.map((r) => r.status).sort(), [201, 401]);
      assert.equal(
        await db.mfaRecoveryCode.count({
          where: { userId, usedAt: { not: null } },
        }),
        1,
      );
      const winning = raced.find((r) => r.status === 201)!;
      const winningBody = await winning.json();
      const full = lmsHttp(base, {
        origin: process.env.DEMO_ORIGIN!,
        cookie: winning.headers
          .getSetCookie()
          .map((s) => s.split(";")[0])
          .join("; "),
        "x-csrf-token": winningBody.csrfToken,
      });
      await body(await full("/context"), 200);
      const replay = await newChallenge();
      await body(
        await publicHttp("/auth/mfa/challenge", "POST", {
          challengeToken: replay.challengeToken,
          code: confirmed.recoveryCodes[0],
        }),
        401,
      );
      const factor = await db.mfaFactor.findUniqueOrThrow({
        where: { userId },
      });
      const nextStep = Math.max(
        Math.floor(Date.now() / 30_000),
        factor.lastTotpStep + 1,
      );
      const totpCode = totp.generate({ timestamp: nextStep * 30_000 });
      const totpChallenges = await Promise.all([
        newChallenge(),
        newChallenge(),
      ]);
      const totpRace = await Promise.all(
        totpChallenges.map((c) =>
          publicHttp("/auth/mfa/challenge", "POST", {
            challengeToken: c.challengeToken,
            code: totpCode,
          }),
        ),
      );
      assert.deepEqual(totpRace.map((r) => r.status).sort(), [201, 401]);

      const policyAuth = await body(
        await full("/auth/mfa/reauth", "POST", {
          password: LMS_PASSWORD,
          code: confirmed.recoveryCodes[1],
          purpose: "POLICY",
        }),
      );
      await body(
        await full("/auth/mfa/policy", "POST", {
          reauthToken: policyAuth.reauthToken,
          required: true,
        }),
      );
      assert.equal(
        (await body(await oldStaff("/context"), 403)).code,
        "MFA_SETUP_REQUIRED",
      );
      await body(
        await oldStaff("/lms/results/export", "POST", { format: "CSV" }),
        403,
      );
      assert.equal(
        (await body(await oldStaff("/auth/mfa/status"), 200)).enabled,
        false,
      );
      await body(
        await full("/auth/mfa/reauth", "POST", {
          password: LMS_PASSWORD,
          purpose: "SETUP",
        }),
        403,
      );
      const manage = await body(
        await full("/auth/mfa/reauth", "POST", {
          password: LMS_PASSWORD,
          code: confirmed.recoveryCodes[2],
          purpose: "MANAGE",
        }),
      );
      await body(
        await full("/auth/mfa/manage", "POST", {
          reauthToken: manage.reauthToken,
          action: "DISABLE",
        }),
        409,
      );
      const regenerated = await body(
        await full("/auth/mfa/manage", "POST", {
          reauthToken: manage.reauthToken,
          action: "RECOVERY",
        }),
      );
      assert.equal(regenerated.recoveryCodes.length, 10);
      await body(await full("/context"), 401);
      const last = await newChallenge();
      await body(
        await publicHttp("/auth/mfa/challenge", "POST", {
          challengeToken: last.challengeToken,
          code: confirmed.recoveryCodes[9],
        }),
        401,
      );
      const restored = await publicHttp("/auth/mfa/challenge", "POST", {
        challengeToken: last.challengeToken,
        code: regenerated.recoveryCodes[0],
      });
      await body(restored);
      const keyCopy = process.env.DEMO_MFA_KEYS;
      for (const invalid of ["{}", "null", "bad-json"]) {
        process.env.DEMO_MFA_KEYS = invalid;
        assert.throws(
          () => decryptMfaSeed(factor.secretCiphertext!, userId),
          /ключ|защит/i,
        );
      }
      process.env.DEMO_MFA_KEYS = keyCopy;
      assert.equal(
        decryptMfaSeed(factor.secretCiphertext!, userId),
        setup.secret,
      );
      assert.throws(() =>
        decryptMfaSeed(encryptMfaSeed(setup.secret, userId), peer.id),
      );
      const audit = JSON.stringify(
        await db.auditEvent.findMany({
          where: { tenantId: fixture.tenant.id },
        }),
      );
      for (const secret of [
        setup.secret,
        LMS_PASSWORD,
        ...confirmed.recoveryCodes,
        ...regenerated.recoveryCodes,
      ])
        assert.ok(!audit.includes(secret), "Audit must not retain credentials");
    } finally {
      if (originalKeys === undefined) delete process.env.DEMO_MFA_KEYS;
      else process.env.DEMO_MFA_KEYS = originalKeys;
      if (originalVersion === undefined)
        delete process.env.DEMO_MFA_KEY_VERSION;
      else process.env.DEMO_MFA_KEY_VERSION = originalVersion;
      await app.close();
      await db.$disconnect();
    }
  },
);

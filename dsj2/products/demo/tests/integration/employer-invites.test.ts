import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Response } from "express";
import { bootstrap } from "../../apps/api/src/main";
import {
  db,
  hash,
  type Context,
  type DemoRequest,
} from "../../apps/api/src/core";
import {
  passwordHash,
  passwordMatches,
  sessionCookies,
} from "../../apps/api/src/auth";
import * as invites from "../../apps/api/src/employer-invites";
import { tenantExportSnapshot } from "../../apps/api/src/tenant-export";
import { revokeEmployerMembership } from "../../apps/api/src/operator-value";
import { assertTestDatabase } from "./test-database";

test("employer invitations: atomic one-time exchange, principal isolation, expiry, revocation and HTTP boundaries", async (t) => {
  assertTestDatabase();
  process.env.PORT = "0";
  process.env.DEMO_ORIGIN = "http://localhost:3100";
  const app = await bootstrap();
  t.after(async () => {
    await app.close();
    await db.$disconnect();
  });
  const base = await app.getUrl();
  const password = "Invite-Synthetic-New-Password-249!";
  const tenant = await db.tenant.create({
    data: { name: "Invite synthetic center" },
  });
  const admin = await db.user.create({
    data: {
      tenantId: tenant.id,
      email: `${randomUUID()}@example.test`,
      displayName: "Admin",
      passwordHash: await passwordHash(password),
      role: "ADMIN",
    },
  });
  const c: Context = {
    tenantId: tenant.id,
    userId: admin.id,
    role: "ADMIN",
    sessionId: "test",
    csrfHash: "test",
    correlationId: randomUUID(),
  };
  const customer = await db.customerOrganization.create({
    data: { tenantId: tenant.id, nameRu: "Разрешённая организация" },
  });
  const other = await db.customerOrganization.create({
    data: { tenantId: tenant.id, nameRu: "Другой заказчик" },
  });
  const people = await Promise.all(
    ["Разрешённый человек", "Закрытый человек"].map((fullNameRu) =>
      db.recipient.create({
        data: { tenantId: tenant.id, data: { fullNameRu } },
      }),
    ),
  );
  await db.recipientEmployment.createMany({
    data: people.map((p) => ({
      tenantId: tenant.id,
      recipientId: p.id,
      employerId: customer.id,
      createdBy: admin.id,
    })),
  });
  function input(extra: Record<string, unknown> = {}) {
    return {
      email: `${randomUUID()}@example.test`,
      displayName: "Представитель",
      customerId: customer.id,
      permissions: ["READ"],
      recipientIds: [people[0].id],
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      accessExpiresAt: new Date(Date.now() + 86400_000).toISOString(),
      ...extra,
    };
  }
  const secret = (v: { inviteUrl: string }) =>
    new URL(v.inviteUrl).hash.slice(1);
  const request = (
    path: string,
    body?: unknown,
    cookie = "",
    csrf = "",
    origin = process.env.DEMO_ORIGIN,
  ) =>
    fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        ...(origin ? { origin } : {}),
        ...(cookie ? { cookie } : {}),
        ...(csrf ? { "x-csrf-token": csrf } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const login = await request("/auth/login", { email: admin.email, password });
  assert.equal(login.status, 201);
  const adminCookie = login.headers
    .getSetCookie()
    .map((v) => v.split(";")[0])
    .join("; ");
  const adminCsrf = (await login.json()).csrfToken as string;
  function req(): DemoRequest {
    return { ip: randomUUID(), correlationId: randomUUID() } as DemoRequest;
  }
  function fakeResponse(): Response {
    return { setHeader() {} } as unknown as Response;
  }
  function code(expected: string) {
    return (e: unknown) =>
      (e as { getResponse?: () => { code: string } }).getResponse?.().code ===
      expected;
  }

  await t.test(
    "new principal: one successful concurrent claim, exact scopes, cookie/CSRF and immediate revoke",
    async () => {
      const response = await request(
        "/employer-invites",
        input(),
        adminCookie,
        adminCsrf,
      );
      assert.equal(response.status, 201);
      const invite = await response.json();
      const token = secret(invite);
      assert.match(token, /^[a-f0-9]{64}$/);
      assert.equal(new URL(invite.inviteUrl).search, "");
      const stored = await db.employerInvite.findUniqueOrThrow({
        where: { id: invite.id },
      });
      assert.equal(stored.secretHash, hash(token));
      assert.ok(!JSON.stringify(stored).includes(token));
      const listed = await request("/employer-invites", undefined, adminCookie);
      const list = JSON.stringify(await listed.json());
      assert.ok(!list.includes(token) && !list.includes(stored.secretHash));
      const exported = await tenantExportSnapshot(c);
      assert.ok(
        exported.tables.EmployerInvite.some((row) => row.id === invite.id),
      );
      assert.ok(!JSON.stringify(exported).includes(stored.secretHash));
      assert.equal(
        (
          await request(
            "/auth/employer-invite/exchange",
            { token, password },
            "",
            "",
            "https://foreign.test",
          )
        ).status,
        403,
      );
      const inspect = await request("/auth/employer-invite/inspect", { token });
      assert.equal(inspect.status, 201);
      assert.equal(inspect.headers.get("referrer-policy"), "no-referrer");
      assert.equal(inspect.headers.get("cache-control"), "no-store");
      assert.equal((await inspect.json()).existingAccount, false);
      const [a, b] = await Promise.all([
        request("/auth/employer-invite/exchange", { token, password }),
        request("/auth/employer-invite/exchange", { token, password }),
      ]);
      assert.deepEqual([a.status, b.status].sort(), [201, 410]);
      const good = a.status === 201 ? a : b;
      const result = await good.json();
      const cookies = good.headers.getSetCookie();
      assert.match(
        cookies.find((v) => v.startsWith("demo_session="))!,
        /HttpOnly; SameSite=Strict/,
      );
      const cookie = cookies.map((v) => v.split(";")[0]).join("; ");
      const user = await db.user.findUniqueOrThrow({
        where: { email: invite.email },
      });
      assert.equal(user.role, "EMPLOYER");
      assert.equal(await passwordMatches(password, user.passwordHash), true);
      assert.equal(await db.session.count({ where: { userId: user.id } }), 1);
      assert.equal(
        (await request("/auth/employer-invite/exchange", { token, password }))
          .status,
        410,
      );
      assert.equal(
        (await request("/auth/employer-invite/inspect", { token })).status,
        410,
      );
      assert.equal(
        (await request("/print-requests", undefined, cookie)).status,
        403,
      );
      assert.equal(
        (await request("/employer-invites", input(), cookie, result.csrfToken))
          .status,
        403,
      );
      assert.equal(
        (
          await request(
            "/portal/evidence?customerId=" + other.id,
            undefined,
            cookie,
          )
        ).status,
        404,
      );
      const evidence = await request(
        "/portal/evidence?customerId=" + customer.id,
        undefined,
        cookie,
      );
      assert.equal(evidence.status, 200);
      const evidenceText = JSON.stringify(await evidence.json());
      assert.ok(evidenceText.includes(people[0].id));
      assert.ok(!evidenceText.includes(people[1].id));
      assert.equal((await request("/portal/evidence", {}, cookie)).status, 403);
      assert.equal(
        (
          await request(
            "/employer-invites/" + invite.id + "/revoke",
            {},
            adminCookie,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            "/employer-invites/" + invite.id + "/revoke",
            {},
            adminCookie,
            adminCsrf,
          )
        ).status,
        201,
      );
      assert.equal((await request("/portal", undefined, cookie)).status, 401);
      assert.equal(
        (
          await db.employerMembership.findUniqueOrThrow({
            where: { id: result.membershipId },
          })
        ).active,
        false,
      );
      assert.equal(await db.session.count({ where: { userId: user.id } }), 0);
      const audit = JSON.stringify(
        await db.auditEvent.findMany({ where: { tenantId: tenant.id } }),
      );
      assert.ok(!audit.includes(token) && !audit.includes(password));
    },
  );

  await t.test(
    "expired, revoked, superseded, stale-role and disabled-center invites disclose no data or account",
    async () => {
      const old = await invites.createEmployerInvite(c, input());
      await db.employerInvite.update({
        where: { id: old.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await assert.rejects(
        invites.exchangeEmployerInvite(req(), fakeResponse(), {
          token: secret(old),
          password,
        }),
        code("INVITE_UNAVAILABLE"),
      );
      assert.equal(await db.user.count({ where: { email: old.email } }), 0);
      const revoked = await invites.createEmployerInvite(c, input());
      await invites.revokeEmployerInvite(c, revoked.id);
      await assert.rejects(
        invites.inspectEmployerInvite(req(), { token: secret(revoked) }),
        code("INVITE_UNAVAILABLE"),
      );
      const data = input();
      const original = await invites.createEmployerInvite(c, data);
      await invites.createEmployerInvite(c, data);
      await assert.rejects(
        invites.exchangeEmployerInvite(req(), fakeResponse(), {
          token: secret(original),
          password,
        }),
        code("INVITE_UNAVAILABLE"),
      );
      const inactive = await invites.createEmployerInvite(c, input());
      await db.tenant.update({
        where: { id: tenant.id },
        data: { active: false },
      });
      await assert.rejects(
        invites.exchangeEmployerInvite(req(), fakeResponse(), {
          token: secret(inactive),
          password,
        }),
        code("INVITE_UNAVAILABLE"),
      );
      await db.tenant.update({
        where: { id: tenant.id },
        data: { active: true },
      });
      await db.user.update({
        where: { id: admin.id },
        data: { role: "OPERATOR" },
      });
      await assert.rejects(
        invites.exchangeEmployerInvite(req(), fakeResponse(), {
          token: secret(inactive),
          password,
        }),
        code("INVITE_UNAVAILABLE"),
      );
      await db.user.update({
        where: { id: admin.id },
        data: { role: "ADMIN" },
      });
    },
  );

  await t.test(
    "existing account proves current password; no password reset, role promotion or foreign email takeover",
    async () => {
      const existing = await db.user.create({
        data: {
          tenantId: tenant.id,
          email: `${randomUUID()}@example.test`,
          displayName: "Existing",
          passwordHash: await passwordHash(password),
          role: "EMPLOYER",
        },
      });
      const invite = await invites.createEmployerInvite(
        c,
        input({ email: existing.email }),
      );
      assert.equal(
        (await invites.inspectEmployerInvite(req(), { token: secret(invite) }))
          .existingAccount,
        true,
      );
      await assert.rejects(
        invites.exchangeEmployerInvite(req(), fakeResponse(), {
          token: secret(invite),
          password: "Different-Strong-Password!",
        }),
        code("INVITE_PASSWORD"),
      );
      assert.equal(
        (
          await db.employerInvite.findUniqueOrThrow({
            where: { id: invite.id },
          })
        ).consumedAt,
        null,
      );
      await invites.exchangeEmployerInvite(req(), fakeResponse(), {
        token: secret(invite),
        password,
      });
      const after = await db.user.findUniqueOrThrow({
        where: { id: existing.id },
      });
      assert.equal(after.passwordHash, existing.passwordHash);
      assert.equal(after.role, "EMPLOYER");
      const next = await invites.createEmployerInvite(
        c,
        input({ email: existing.email, customerId: other.id }),
      );
      await db.user.update({
        where: { id: existing.id },
        data: { sessionVersion: { increment: 1 } },
      });
      await assert.rejects(
        invites.exchangeEmployerInvite(req(), fakeResponse(), {
          token: secret(next),
          password,
        }),
        code("INVITE_UNAVAILABLE"),
      );
      const disabled = await invites.createEmployerInvite(
        c,
        input({ email: existing.email, customerId: other.id }),
      );
      await db.user.update({
        where: { id: existing.id },
        data: { active: false },
      });
      await assert.rejects(
        invites.exchangeEmployerInvite(req(), fakeResponse(), {
          token: secret(disabled),
          password,
        }),
        code("INVITE_UNAVAILABLE"),
      );
      await db.user.update({
        where: { id: existing.id },
        data: { active: true },
      });
      const changedRole = await invites.createEmployerInvite(
        c,
        input({ email: existing.email, customerId: other.id }),
      );
      await db.user.update({
        where: { id: existing.id },
        data: { role: "VIEWER" },
      });
      await assert.rejects(
        invites.exchangeEmployerInvite(req(), fakeResponse(), {
          token: secret(changedRole),
          password,
        }),
        code("INVITE_UNAVAILABLE"),
      );
      const foreign = await db.tenant.create({ data: { name: "Foreign" } });
      const foreignUser = await db.user.create({
        data: {
          tenantId: foreign.id,
          email: `${randomUUID()}@example.test`,
          displayName: "Foreign",
          passwordHash: existing.passwordHash,
          role: "EMPLOYER",
        },
      });
      await assert.rejects(
        invites.createEmployerInvite(c, input({ email: foreignUser.email })),
        code("INVITE_PRINCIPAL"),
      );
      await assert.rejects(
        invites.createEmployerInvite(c, input({ email: admin.email })),
        code("INVITE_PRINCIPAL"),
      );
      await assert.rejects(
        invites.createEmployerInvite({ ...c, role: "OPERATOR" }, input()),
        code("ROLE_DENIED"),
      );
      const fCustomer = await db.customerOrganization.create({
        data: { tenantId: foreign.id, nameRu: "Foreign" },
      });
      await assert.rejects(
        invites.createEmployerInvite(c, input({ customerId: fCustomer.id })),
        code("CUSTOMER_NOT_FOUND"),
      );
      const fRecipient = await db.recipient.create({
        data: { tenantId: foreign.id, data: {} },
      });
      await assert.rejects(
        invites.createEmployerInvite(
          c,
          input({ recipientIds: [fRecipient.id] }),
        ),
        code("RECIPIENT_NOT_FOUND"),
      );
      await assert.rejects(
        invites.revokeEmployerInvite({ ...c, tenantId: foreign.id }, invite.id),
        code("NOT_FOUND"),
      );
      await assert.rejects(
        db.employerInvite.update({
          where: { id: next.id },
          data: { recipientIds: [fRecipient.id] },
        }),
      );
      await assert.rejects(
        db.employerInvite.update({
          where: { id: next.id },
          data: { customerId: fCustomer.id },
        }),
      );
      const pending = await invites.createEmployerInvite(c, input());
      await db.user.create({
        data: {
          tenantId: foreign.id,
          email: pending.email,
          displayName: "Conflicting later account",
          passwordHash: existing.passwordHash,
          role: "EMPLOYER",
        },
      });
      await assert.rejects(
        invites.exchangeEmployerInvite(req(), fakeResponse(), {
          token: secret(pending),
          password,
        }),
        code("INVITE_UNAVAILABLE"),
      );
    },
  );

  await t.test(
    "explicit regrant restores only new pinned scope; repeated revoke cancels pending regrant and rotates old sessions",
    async () => {
      const first = await invites.createEmployerInvite(c, input());
      const granted = await invites.exchangeEmployerInvite(
        req(),
        fakeResponse(),
        { token: secret(first), password },
      );
      const membership = await db.employerMembership.findUniqueOrThrow({
        where: { id: granted.membershipId },
      });
      await assert.rejects(
        invites.createEmployerInvite(c, input({ email: first.email })),
        code("MEMBERSHIP_EXISTS"),
      );
      await revokeEmployerMembership(c, membership.id);
      const stale = await invites.createEmployerInvite(
        c,
        input({ email: first.email }),
      );
      await revokeEmployerMembership(c, membership.id);
      await assert.rejects(
        invites.exchangeEmployerInvite(req(), fakeResponse(), {
          token: secret(stale),
          password,
        }),
        code("INVITE_UNAVAILABLE"),
      );
      const regrant = await invites.createEmployerInvite(
        c,
        input({
          email: first.email,
          permissions: ["READ", "DOWNLOAD"],
          recipientIds: [people[1].id],
        }),
      );
      const principal = await db.user.findUniqueOrThrow({
        where: { id: membership.userId },
      });
      const previousSession = hash(randomUUID());
      await db.session.create({
        data: {
          id: previousSession,
          tenantId: tenant.id,
          userId: principal.id,
          csrfHash: hash(randomUUID()),
          sessionVersion: principal.sessionVersion,
          expiresAt: new Date(Date.now() + 3600_000),
        },
      });
      const accepted = await invites.exchangeEmployerInvite(
        req(),
        fakeResponse(),
        { token: secret(regrant), password },
      );
      assert.equal(accepted.membershipId, membership.id);
      const current = await db.employerMembership.findUniqueOrThrow({
        where: { id: membership.id },
      });
      assert.equal(current.active, true);
      assert.ok(
        (await db.employerInvite.findUniqueOrThrow({ where: { id: first.id } }))
          .revokedAt,
      );
      await invites.revokeEmployerInvite(c, first.id);
      assert.equal(
        (
          await db.employerMembership.findUniqueOrThrow({
            where: { id: membership.id },
          })
        ).active,
        true,
      );
      assert.deepEqual(current.recipientIds, [people[1].id]);
      assert.deepEqual(current.permissions, ["READ", "DOWNLOAD"]);
      assert.equal(
        await db.session.count({ where: { id: previousSession } }),
        0,
      );
      assert.equal(
        await db.session.count({ where: { userId: principal.id } }),
        1,
      );
      assert.equal(
        (await db.user.findUniqueOrThrow({ where: { id: principal.id } }))
          .passwordHash,
        principal.passwordHash,
      );
      await db.employerMembership.update({
        where: { id: membership.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const renewed = await invites.createEmployerInvite(
        c,
        input({ email: first.email, recipientIds: [people[0].id] }),
      );
      await invites.exchangeEmployerInvite(req(), fakeResponse(), {
        token: secret(renewed),
        password,
      });
      assert.deepEqual(
        (
          await db.employerMembership.findUniqueOrThrow({
            where: { id: membership.id },
          })
        ).recipientIds,
        [people[0].id],
      );
    },
  );

  await t.test(
    "concurrent invitation creation leaves one pending link per principal/customer and invalidates replaced links",
    async () => {
      for (let round = 0; round < 4; round++) {
        const data = input();
        const pair = await Promise.all([
          invites.createEmployerInvite(c, data),
          invites.createEmployerInvite(c, data),
        ]);
        const pending = await db.employerInvite.findMany({
          where: {
            tenantId: tenant.id,
            email: data.email,
            customerId: customer.id,
            consumedAt: null,
            revokedAt: null,
          },
        });
        assert.equal(pending.length, 1);
        const active = pair.find((entry) => entry.id === pending[0].id)!;
        const stale = pair.find((entry) => entry.id !== pending[0].id)!;
        await assert.rejects(
          invites.exchangeEmployerInvite(req(), fakeResponse(), {
            token: secret(stale),
            password,
          }),
          code("INVITE_UNAVAILABLE"),
        );
        await invites.exchangeEmployerInvite(req(), fakeResponse(), {
          token: secret(active),
          password,
        });
        assert.equal(
          await db.employerMembership.count({
            where: {
              tenantId: tenant.id,
              userId: (
                await db.user.findUniqueOrThrow({
                  where: { email: data.email },
                })
              ).id,
            },
          }),
          1,
        );
      }
    },
  );

  await t.test(
    "public endpoints have bounded input, exact method allowlist, throttling and production cookie flags",
    async () => {
      assert.equal(
        (await request("/auth/employer-invite/exchange")).status,
        404,
      );
      assert.equal(
        (
          await request("/auth/employer-invite/inspect", {
            token: "0".repeat(64),
            extra: "x",
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request("/auth/employer-invite/exchange", {
            token: "0".repeat(64),
            password: "short",
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request("/auth/employer-invite/exchange", {
            token: "0".repeat(64),
            password: "x".repeat(4500),
          })
        ).status,
        413,
      );
      let limited = false;
      for (let i = 0; i < 11; i++) {
        const r = await request("/auth/employer-invite/exchange", {
          token: "0".repeat(64),
          password,
        });
        if (r.status === 429) {
          limited = true;
          break;
        }
      }
      assert.equal(limited, true);
      const original = process.env.NODE_ENV;
      const values: unknown[] = [];
      try {
        process.env.NODE_ENV = "production";
        sessionCookies(
          {
            setHeader(_name: string, value: unknown) {
              values.push(value);
            },
          } as Response,
          "a".repeat(64),
          "b".repeat(64),
        );
      } finally {
        process.env.NODE_ENV = original;
      }
      assert.match(
        JSON.stringify(values),
        /HttpOnly; SameSite=Strict; Max-Age=28800; Secure/,
      );
    },
  );
});

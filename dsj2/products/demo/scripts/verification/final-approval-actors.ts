import { randomUUID } from "node:crypto";
import { db, type Context } from "../../apps/api/src/core";
import { saveProfile, saveUser } from "../../apps/api/src/settings";
import { saveSignatory } from "../../apps/api/src/signing";
import { assertTestDatabase } from "../../tests/integration/test-database";
import assert from "node:assert/strict";

/** Actual isolated users and bindings; this does not create a decision/signature. */
export async function finalApprovalActors(admin: Context) {
  assertTestDatabase();
  const tenant = await db.tenant.findUniqueOrThrow({
    where: { id: admin.tenantId },
  });
  if (!tenant.demoOnly)
    throw new Error("ISOLATED_MANAGEMENT_REQUIRED");
  const provisionedActor = await db.user.findFirstOrThrow({ where: { id: admin.userId, tenantId: admin.tenantId } });
  if (!provisionedActor.email.endsWith("@example.test")) throw new Error("SYNTHETIC_ADMIN_ACTOR_REQUIRED");
  if (!["ADMIN", "DIRECTOR"].includes(provisionedActor.role)) throw new Error("PROVISIONED_FIXTURE_ACTOR_REQUIRED");
  admin = { ...admin, role: provisionedActor.role };
  const version = await db.issuerProfileVersion.findFirstOrThrow({
    where: { tenantId: admin.tenantId },
    orderBy: { version: "desc" },
  });
  const profile = version.profile as Record<string, unknown> & {
    headName?: string;
    commission?: Array<{ name: string; position: string }>;
  };
  const suffix = randomUUID();
  const directorPassword = `Synthetic-director-${suffix}!`;
  const director = await saveUser(admin, {
    email: `final-director-${suffix}@example.test`,
    password: directorPassword,
    displayName: profile.headName || "Тестовый директор",
    role: "DIRECTOR",
  });
  const commission =
    profile.commission?.length === 3
      ? profile.commission
      : Array.from({ length: 3 }, (_, i) => ({
          name: `Тестовый член ${i + 1}`,
          position: i ? "Член комиссии" : "Председатель",
        }));
  await saveSignatory(admin, {
    userId: director.id,
    displayName: director.displayName,
    role: "DIRECTOR",
    iin: "000000000001",
  });
  for (let i = 0; i < commission.length; i++) {
    const member = await saveUser(admin, {
      email: `final-member-${i}-${suffix}@example.test`,
      password: `Synthetic-member-${suffix}!`,
      displayName: commission[i].name,
      role: "OPERATOR",
    });
    await saveSignatory(admin, {
      userId: member.id,
      displayName: member.displayName,
      role: i ? "MEMBER" : "CHAIR",
      iin: `00000000000${i + 2}`,
    });
  }
  await saveProfile(admin, {
    ...profile,
    bin: profile.bin || "000000000101",
    headName: director.displayName,
    commission,
  });
  return {
    email: director.email,
    password: directorPassword,
    tenantId: admin.tenantId,
    userId: director.id,
  };
}

/** A genuine authenticated director HTTP decision for historical fixture setup. */
export async function approveFinalFixtureRequest(
  director: Awaited<ReturnType<typeof finalApprovalActors>>,
  requestId: string,
) {
  const origin = process.env.DEMO_ORIGIN;
  if (!origin) throw new Error("LOCAL_DEMO_ORIGIN_REQUIRED");
  const login = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({
      email: director.email,
      password: director.password,
    }),
  });
  assert.ok(login.ok, await login.clone().text());
  const session = (await login.json()) as {
    csrfToken: string;
    tenant: { id: string; demoOnly: boolean };
    user: { role: string };
  };
  assert.equal(session.tenant.id, director.tenantId);
  const headers = {
    origin,
    "content-type": "application/json",
    "x-csrf-token": session.csrfToken,
    cookie: login.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; "),
  };
  const sessionResponse = await fetch(`${origin}/api/auth/session`, { headers });
  assert.ok(sessionResponse.ok, await sessionResponse.clone().text());
  const authenticated = await sessionResponse.json() as { tenant: { id: string; demoOnly: boolean }; user: { role: string } };
  assert.equal(authenticated.tenant.id, director.tenantId);
  assert.equal(authenticated.tenant.demoOnly, true);
  assert.equal(authenticated.user.role, "DIRECTOR");
  const stateResponse = await fetch(
    `${origin}/api/print-requests/${requestId}`,
    { headers },
  );
  assert.ok(stateResponse.ok, await stateResponse.clone().text());
  const state = (await stateResponse.json()) as {
    approval: { status: string; proposalId: string };
  };
  assert.equal(state.approval.status, "PENDING");
  const proposalResponse = await fetch(
    `${origin}/api/approvals/${state.approval.proposalId}`,
    { headers },
  );
  assert.ok(proposalResponse.ok, await proposalResponse.clone().text());
  const proposal = (await proposalResponse.json()) as { proposalHash: string };
  const decision = await fetch(
    `${origin}/api/approvals/${state.approval.proposalId}/decision`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        decision: "APPROVE",
        expectedProposalHash: proposal.proposalHash,
        reason:
          "СИНТЕТИЧЕСКАЯ проверка исторического fixture текущей редакции; не NCA подпись",
      }),
    },
  );
  assert.equal(decision.status, 201, await decision.clone().text());
}

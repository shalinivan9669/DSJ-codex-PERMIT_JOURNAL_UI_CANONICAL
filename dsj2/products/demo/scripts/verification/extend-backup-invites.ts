import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type { Response } from "express";
import { db, type Context, type DemoRequest } from "../../apps/api/src/core";
import {
  createEmployerInvite,
  exchangeEmployerInvite,
  revokeEmployerInvite,
} from "../../apps/api/src/employer-invites";

async function main() {
  assert.match(
    process.env.DATABASE_URL || "",
    /\/demo_test_backup_[a-z0-9_]+$/,
  );
  assert.equal(process.env.DEMO_CONTAINER_ACCEPTANCE, "SYNTHETIC_ONLY");
  const fixture = JSON.parse(await readFile(process.argv[2], "utf8"));
  const user = await db.user.findFirstOrThrow({
    where: { tenantId: fixture.tenantId, role: "ADMIN", active: true },
  });
  const customer = await db.customerOrganization.findFirstOrThrow({
    where: { tenantId: fixture.tenantId },
  });
  const c: Context = {
    tenantId: fixture.tenantId,
    userId: user.id,
    role: "ADMIN",
    sessionId: "synthetic",
    csrfHash: "synthetic",
    correlationId: randomUUID(),
  };
  const invitations = [];
  for (const state of ["PENDING", "REVOKED", "REDEEMED"]) {
    const invitation = await createEmployerInvite(c, {
      email: `recovery-${state.toLowerCase()}-${randomUUID()}@example.test`,
      displayName: `Synthetic recovery ${state}`,
      customerId: customer.id,
      permissions: ["READ", "DOWNLOAD"],
      recipientIds: [],
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      accessExpiresAt: new Date(Date.now() + 86400_000).toISOString(),
    });
    if (state === "REVOKED") await revokeEmployerInvite(c, invitation.id);
    if (state === "REDEEMED") {
      const response = {
        setHeader() {
          return this;
        },
      } as unknown as Response;
      await exchangeEmployerInvite(
        {
          ip: "synthetic-recovery",
          correlationId: randomUUID(),
        } as DemoRequest,
        response,
        {
          token: new URL(invitation.inviteUrl).hash.slice(1),
          password: `Recovery-${randomUUID()}!`,
        },
      );
    }
    const row = await db.employerInvite.findUniqueOrThrow({
      where: { id: invitation.id },
    });
    invitations.push({
      id: row.id,
      state,
      customerId: row.customerId,
      membershipId: row.membershipId,
      expiresAt: row.expiresAt,
      accessExpiresAt: row.accessExpiresAt,
      consumedAt: row.consumedAt,
      revokedAt: row.revokedAt,
    });
  }
  fixture.invitations = invitations;
  await writeFile(process.argv[3], JSON.stringify(fixture, null, 2));
  console.log(
    JSON.stringify({
      status: "PASS",
      invitations: invitations.map(({ id, state }) => ({ id, state })),
    }),
  );
}
void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

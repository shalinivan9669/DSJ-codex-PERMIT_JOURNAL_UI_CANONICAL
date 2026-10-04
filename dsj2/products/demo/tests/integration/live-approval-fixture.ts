import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertTestDatabase } from "./test-database";
import { bootstrap } from "../../apps/api/src/main";
import { db, type Context } from "../../apps/api/src/core";
import { saveProfile, saveUser } from "../../apps/api/src/settings";
import { saveSignatory } from "../../apps/api/src/signing";

async function requestWithRateLimit(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, init);
    if (response.status !== 429 || attempt >= 6) return response;
    const retryAfter = Number(response.headers.get("retry-after"));
    await response.text();
    await new Promise((resolve) =>
      setTimeout(resolve, retryAfter > 0 ? retryAfter * 1000 : 61000),
    );
  }
}

/** Real session/CSRF + director decision fixture; no signature or provider bypass. */
export async function createApprovalFixture(admin: Context) {
  assertTestDatabase();
  assert.equal(admin.role, "ADMIN");
  const suffix = randomUUID();
  const password = `Synthetic-approval-${suffix}!`;
  const director = await saveUser(admin, {
    email: `director-${suffix}@example.test`,
    password,
    displayName: "Синтетический директор",
    role: "DIRECTOR",
  });
  const directorContext: Context = {
    ...admin,
    userId: director.id,
    role: "DIRECTOR",
    correlationId: randomUUID(),
  };
  const previous = await db.issuerProfileVersion.findFirst({
    where: { tenantId: admin.tenantId },
    orderBy: { version: "desc" },
  });
  const profile = (previous?.profile || {}) as {
    commission?: { name: string; position: string }[];
    headName?: string;
  };
  const commission =
    profile.commission?.length === 3 &&
    profile.commission.every((member) => member.name.trim())
      ? profile.commission
      : Array.from({ length: 3 }, (_, index) => ({
          name: `Синтетический подписант ${index}`,
          position: index ? "Член комиссии" : "Председатель",
        }));
  const headName = profile.headName?.trim() || director.displayName;
  await saveProfile(admin, { ...profile, commission, headName });
  await saveSignatory(admin, {
    userId: director.id,
    displayName: headName,
    role: "DIRECTOR",
    iin: "000000000001",
  });
  for (let index = 0; index < commission.length; index++) {
    const member = await saveUser(admin, {
      email: `commission-${index}-${suffix}@example.test`,
      password,
      displayName: commission[index].name,
      role: "OPERATOR",
    });
    await saveSignatory(admin, {
      userId: member.id,
      displayName: commission[index].name,
      role: index ? "MEMBER" : "CHAIR",
      iin: `00000000000${index + 2}`,
    });
  }
  const oldPort = process.env.PORT;
  process.env.PORT = "0";
  process.env.DEMO_ORIGIN ||= "http://localhost:3119";
  let app: Awaited<ReturnType<typeof bootstrap>>;
  try {
    app = await bootstrap();
  } finally {
    if (oldPort === undefined) delete process.env.PORT;
    else process.env.PORT = oldPort;
  }
  const base = await app.getUrl();
  const login = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: {
      origin: process.env.DEMO_ORIGIN!,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email: director.email, password }),
  });
  if (![200, 201].includes(login.status)) {
    await app.close();
    assert.equal(
      login.status,
      201,
      "Director login must establish a real session",
    );
  }
  const session = (await login.json()) as { csrfToken: string };
  const auth = {
    cookie: login.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; "),
    "x-csrf-token": session.csrfToken,
    origin: process.env.DEMO_ORIGIN!,
  };
  return {
    directorContext,
    async approve(requestId: string, expectedIncompleteProblem?: string) {
      const current = await requestWithRateLimit(
        `${base}/print-requests/${requestId}/approval`,
        { headers: auth },
      );
      assert.equal(current.status, 200, await current.clone().text());
      const state = (await current.json()) as {
        approval: { proposalId: string; status: string } | null;
      };
      if (state.approval?.status === "APPROVED") return;
      assert.equal(state.approval?.status, "PENDING");
      const detailResponse = await requestWithRateLimit(
        `${base}/approvals/${state.approval!.proposalId}`,
        { headers: auth },
      );
      assert.equal(
        detailResponse.status,
        200,
        await detailResponse.clone().text(),
      );
      const detail = (await detailResponse.json()) as {
        proposalHash: string;
        diff: unknown[];
      };
      assert.ok(Array.isArray(detail.diff));
      const decision = await requestWithRateLimit(
        `${base}/approvals/${state.approval!.proposalId}/decision`,
        {
          method: "POST",
          headers: { ...auth, "content-type": "application/json" },
          body: JSON.stringify({
            decision: "APPROVE",
            reason: "Синтетическая проверка согласования",
            expectedProposalHash: detail.proposalHash,
          }),
        },
      );
      if (expectedIncompleteProblem) {
        const error = (await decision.json()) as {
          code: string;
          details: Array<{ code: string }>;
        };
        assert.equal(decision.status, 422);
        assert.equal(error.code, "APPROVAL_DATA_INCOMPLETE");
        assert.ok(
          error.details.some(
            (issue) => issue.code === expectedIncompleteProblem,
          ),
        );
      } else assert.equal(decision.status, 201, await decision.clone().text());
    },
    async close() {
      await app.close();
    },
  };
}

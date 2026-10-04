import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { bootstrap } from "../../apps/api/src/main";
import { db, type Context } from "../../apps/api/src/core";
import { provision } from "../../scripts/setup";
import { saveUser } from "../../apps/api/src/settings";
import {
  createRequest,
  patchRequest,
  deleteDraft,
  preview,
} from "../../apps/api/src/requests";
import { decideProposal, submitApproval } from "../../apps/api/src/approvals";
import { draftSchema } from "../../packages/contracts/src";
import { assertTestDatabase } from "./test-database";
import { signingState } from "../../apps/api/src/signing";
import { store, readArtifact } from "../../apps/api/src/files";
import {
  claimJob,
  executeJob,
  heartbeat,
} from "../../apps/render-worker/src/queue";

function context(tenantId: string, userId: string, role: string): Context {
  return {
    tenantId,
    userId,
    role,
    sessionId: "test",
    csrfHash: "test",
    correlationId: randomUUID(),
  };
}
function code(expected: string) {
  return (error: unknown) => {
    assert.equal(
      (error as { getResponse: () => { code: string } }).getResponse().code,
      expected,
    );
    return true;
  };
}

test("two working roles own setup, isolate tenants and retain legacy director authority without account rewrites", async (t) => {
  assertTestDatabase();
  process.env.PORT = "0";
  process.env.DEMO_ORIGIN = "http://localhost:3119";
  const app = await bootstrap();
  const base = await app.getUrl();
  const suffix = randomUUID();
  const password = "Synthetic-two-role-password!";
  const center = await provision({
    email: `roles-${suffix}@example.test`,
    password,
    name: "Синтетический центр двух ролей",
    sample: true,
  });
  const director = context(center.tenantId, center.userId, "DIRECTOR");
  const original = await db.user.findUniqueOrThrow({
    where: { id: director.userId },
  });
  assert.equal(original.role, "DIRECTOR");
  const foreign = await db.tenant.create({
    data: { name: "Чужой синтетический центр" },
  });
  const foreignUser = await db.user.create({
    data: {
      tenantId: foreign.id,
      email: `foreign-roles-${suffix}@example.test`,
      displayName: "Чужой директор",
      role: "DIRECTOR",
      passwordHash: original.passwordHash,
    },
  });
  const login = async (email: string) => {
    const response = await fetch(base + "/auth/login", {
      method: "POST",
      headers: {
        origin: process.env.DEMO_ORIGIN!,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(response.status, 201, await response.clone().text());
    const body = await response.json();
    return {
      cookie: response.headers
        .getSetCookie()
        .map((item) => item.split(";")[0])
        .join("; "),
      "x-csrf-token": body.csrfToken,
    };
  };
  type Session = Awaited<ReturnType<typeof login>>;
  const send = (
    session: Session,
    path: string,
    method = "GET",
    body?: unknown,
  ) =>
    fetch(base + path, {
      method,
      headers: {
        origin: process.env.DEMO_ORIGIN!,
        ...session,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const directorSession = await login(center.email);
  let manager: Context;
  let managerSession: Session;
  try {
    await t.test(
      "director configures center and creates the only other working role",
      async () => {
        const created = await send(directorSession, "/users", "POST", {
          email: `manager-roles-${suffix}@example.test`,
          displayName: "Синтетический менеджер",
          password,
          role: "OPERATOR",
        });
        assert.equal(created.status, 201, await created.clone().text());
        const user = await created.json();
        manager = context(center.tenantId, user.id, "OPERATOR");
        managerSession = await login(user.email);
        const profile = await (
          await send(directorSession, "/settings/profile")
        ).json();
        delete profile.id;
        delete profile.version;
        const updated = await send(
          directorSession,
          "/settings/profile",
          "POST",
          {
            ...profile,
            headName: "Синтетический директор",
            commission: Array.from({ length: 3 }, (_, index) => ({
              name: `Синтетический член ${index}`,
              position: "Член комиссии",
            })),
          },
        );
        assert.equal(updated.status, 201, await updated.clone().text());
        const numbering = await send(
          directorSession,
          "/settings/numbering",
          "PATCH",
          { namespace: "PTM:CARD", prefix: "ROLE-" },
        );
        assert.equal(numbering.status, 200, await numbering.clone().text());
        const templates = await (
          await send(directorSession, "/settings/templates")
        ).json();
        const approved = await send(
          directorSession,
          `/settings/templates/${templates.items[0].id}/approve`,
          "POST",
          { approved: true },
        );
        assert.equal(approved.status, 201, await approved.clone().text());
        assert.equal(
          (await approved.json()).checksum,
          templates.items[0].checksum,
        );
        const binding = await send(
          directorSession,
          "/settings/signatories",
          "POST",
          {
            userId: director.userId,
            displayName: "Синтетический директор",
            role: "DIRECTOR",
            iin: "000000000001",
            active: false,
          },
        );
        assert.equal(binding.status, 201, await binding.clone().text());
        const roles = await db.user.findMany({
          where: { tenantId: center.tenantId },
          select: { role: true },
        });
        assert.deepEqual(roles.map((row) => row.role).sort(), [
          "DIRECTOR",
          "OPERATOR",
        ]);
        assert.equal(
          (await db.user.findUniqueOrThrow({ where: { id: director.userId } }))
            .passwordHash,
          original.passwordHash,
        );
      },
    );
    await t.test(
      "manager and director prepare real numbered PDFs with no signing bindings or third account",
      async () => {
        const draft = draftSchema.parse({
          kind: "PERSON",
          title: "Синтетическая печать двух ролей",
          demoMode: true,
          items: [
            {
              id: randomUUID(),
              fullNameRu: "Синтетический Проверочный Получатель",
              fullNameKz: "Синтетический Проверочный Получатель",
              positionRu: "Монтажник",
              positionKz: "Монтажник",
              employeeCategory: "WORKER",
              workplaceRu: "Синтетическое предприятие",
              workplaceKz: "Синтетическое предприятие",
              assignments: [
                {
                  id: randomUUID(),
                  templateId: "ptm-card",
                  documentDate: "2026-10-02",
                  protocolDate: "2026-10-02",
                  trainingStart: "2026-09-29",
                  trainingEnd: "2026-10-01",
                  trainingSubject: "Синтетическая программа ПТМ",
                  result: "Сдал",
                  hours: "16",
                  outcome: {
                    status: "PASSED",
                    source: "Синтетическая проверка знаний",
                  },
                },
              ],
            },
          ],
        });
        const createdResponse = await send(
          managerSession,
          "/print-requests",
          "POST",
          draft,
        );
        assert.equal(
          createdResponse.status,
          201,
          await createdResponse.clone().text(),
        );
        const created = await createdResponse.json();
        assert.equal(created.approval, null);
        const submission = await send(
          managerSession,
          `/print-requests/${created.id}/approval/submit`,
          "POST",
          { expectedRevision: created.revision },
        );
        assert.equal(submission.status, 201, await submission.clone().text());
        const submitted = await submission.json();
        const approval = await send(
          directorSession,
          `/approvals/${submitted.approval.proposalId}/decision`,
          "POST",
          {
            decision: "APPROVE",
            reason: "Синтетическая проверка заполненных данных",
            expectedProposalHash: submitted.approval.proposalHash,
          },
        );
        assert.equal(approval.status, 201, await approval.clone().text());
        assert.equal(
          await db.signatoryBinding.count({
            where: { tenantId: center.tenantId, active: true },
          }),
          0,
        );
        const key = randomUUID();
        const prepare = () =>
          fetch(base + `/print-requests/${created.id}/finalize`, {
            method: "POST",
            headers: {
              origin: process.env.DEMO_ORIGIN!,
              ...managerSession,
              "content-type": "application/json",
              "idempotency-key": key,
            },
            body: JSON.stringify({ expectedRevision: created.revision }),
          });
        const prepared = await prepare();
        assert.equal(prepared.status, 201, await prepared.clone().text());
        const issued = await prepared.json();
        assert.equal(issued.lifecycle, "RENDERING");
        let jobs = 0;
        for (;;) {
          const job = await claimJob(db, "two-role-test", center.tenantId);
          if (!job) break;
          assert.ok(++jobs < 20);
          const controller = new AbortController();
          const timer = setInterval(() => {
            void heartbeat(db, job, "two-role-test")
              .then((ok) => {
                if (!ok) controller.abort();
              })
              .catch(() => controller.abort());
          }, 5000);
          try {
            await executeJob(
              db,
              store,
              job,
              "two-role-test",
              AbortSignal.any([controller.signal, AbortSignal.timeout(210000)]),
            );
          } finally {
            clearInterval(timer);
          }
        }
        const state = await signingState(manager, created.id);
        assert.equal(state.status, "AWAITING_SIGNATURE");
        assert.equal(state.documents.length, 2);
        assert.ok(state.missingBindings.length > 0);
        assert.equal(state.signatures.length, 0);
        for (const document of state.documents) {
          assert.ok(document.artifactId);
          assert.ok(document.number);
          assert.equal(document.complete, false);
          const artifact = await readArtifact(manager, document.artifactId!);
          assert.ok(
            artifact.buffer.subarray(0, 5).equals(Buffer.from("%PDF-")),
          );
        }
        const record = await db.printRequest.findUniqueOrThrow({
          where: { id: created.id },
        });
        assert.equal(record.status, "FINALIZED");
        assert.equal(record.archivedAt, null);
        assert.equal(
          (
            await db.issuanceWorkflow.findFirstOrThrow({
              where: { issuanceId: issued.issuanceId },
            })
          ).completedAt,
          null,
        );
        const numbers = await db.numberSequence.findMany({
          where: { tenantId: center.tenantId },
          orderBy: { namespace: "asc" },
        });
        const replay = await prepare();
        assert.equal(replay.status, 201, await replay.clone().text());
        assert.deepEqual(await replay.json(), issued);
        assert.deepEqual(
          await db.numberSequence.findMany({
            where: { tenantId: center.tenantId },
            orderBy: { namespace: "asc" },
          }),
          numbers,
        );
        assert.equal(
          await db.user.count({ where: { tenantId: center.tenantId } }),
          2,
        );
      },
    );
    await t.test(
      "manager cannot acquire management authority; director cannot mutate foreign users",
      async () => {
        for (const [path, method, body] of [
          ["/users", "GET", undefined],
          ["/audit", "GET", undefined],
          ["/tenant-export", "GET", undefined],
          [
            "/users",
            "POST",
            {
              email: `escalation-${suffix}@example.test`,
              displayName: "Forbidden",
              password,
              role: "DIRECTOR",
            },
          ],
          [`/users/${director.userId}`, "PATCH", { disabled: true }],
          ["/settings/profile", "POST", {}],
          ["/settings/numbering", "PATCH", {}],
          ["/settings/signatories", "POST", {}],
        ] as const) {
          const response = await send(managerSession, path, method, body);
          assert.equal(
            response.status,
            403,
            `${method} ${path}: ${await response.text()}`,
          );
        }
        assert.equal(
          (
            await send(directorSession, `/users/${foreignUser.id}`, "PATCH", {
              disabled: true,
            })
          ).status,
          404,
        );
        assert.equal(
          (await db.user.findUniqueOrThrow({ where: { id: foreignUser.id } }))
            .active,
          true,
        );
        await assert.rejects(
          saveUser(manager, { role: "DIRECTOR" }, manager.userId),
          code("ROLE_DENIED"),
        );
        await assert.rejects(
          saveUser(director, { role: "OPERATOR" }, director.userId),
          code("SELF_LOCKOUT"),
        );
        const self = await saveUser(
          director,
          { displayName: "Переименованный директор", role: "DIRECTOR" },
          director.userId,
        );
        assert.equal(self.role, "DIRECTOR");
        assert.equal(
          (await db.user.findUniqueOrThrow({ where: { id: director.userId } }))
            .passwordHash,
          original.passwordHash,
        );
      },
    );
    await t.test(
      "archived draft rejects API edits and resubmission without adding history",
      async () => {
        const created = await createRequest(manager, {
          kind: "PERSON",
          title: "Синтетическая архивная заявка",
          items: [],
        });
        const archive = await deleteDraft(manager, created.id);
        await decideProposal(director, archive.approval.proposalId, {
          decision: "APPROVE",
          reason: "Синтетическое архивирование",
          expectedProposalHash: archive.approval.proposalHash,
        });
        const before = await db.printRequest.findUniqueOrThrow({
          where: { id: created.id },
        });
        assert.ok(before.archivedAt);
        const proposals = await db.requestProposal.count({
          where: { requestId: created.id },
        });
        const proposalIds = (
          await db.requestProposal.findMany({
            where: { requestId: created.id },
            select: { id: true },
          })
        ).map((row) => row.id);
        const decisions = await db.proposalDecision.count({
          where: { proposalId: { in: proposalIds } },
        });
        await assert.rejects(
          patchRequest(manager, created.id, {
            expectedRevision: before.revision,
            draft: draftSchema.parse({
              kind: "PERSON",
              title: "Forbidden archive rewrite",
              items: [],
            }),
          }),
          code("REQUEST_ARCHIVED"),
        );
        await assert.rejects(
          submitApproval(manager, created.id, {
            expectedRevision: before.revision,
          }),
          code("REQUEST_ARCHIVED"),
        );
        await assert.rejects(
          preview(manager, created.id, { expectedRevision: before.revision }),
          code("REQUEST_ARCHIVED"),
        );
        assert.deepEqual(
          await db.printRequest.findUniqueOrThrow({
            where: { id: created.id },
          }),
          before,
        );
        assert.equal(
          await db.requestProposal.count({ where: { requestId: created.id } }),
          proposals,
        );
        assert.equal(
          await db.proposalDecision.count({
            where: { proposalId: { in: proposalIds } },
          }),
          decisions,
        );
      },
    );
    await t.test(
      "legacy ADMIN is a director in API and database guard, but manager cannot record a decision",
      async () => {
        const legacyTenant = await db.tenant.create({
          data: { name: "Синтетический прежний центр" },
        });
        const legacyUser = await db.user.create({
          data: {
            tenantId: legacyTenant.id,
            email: `legacy-roles-${suffix}@example.test`,
            displayName: "Прежний директор",
            role: "ADMIN",
            passwordHash: original.passwordHash,
          },
        });
        const legacy = context(legacyTenant.id, legacyUser.id, "ADMIN");
        const created = await createRequest(legacy, {
          kind: "PERSON",
          title: "Синтетическая проверка прежней роли",
          items: [],
        });
        const submitted = await deleteDraft(legacy, created.id);
        await assert.rejects(
          decideProposal(manager, submitted.approval.proposalId, {
            decision: "REJECT",
            reason: "Forbidden",
            expectedProposalHash: submitted.approval.proposalHash,
          }),
          code("DIRECTOR_REQUIRED"),
        );
        await assert.rejects(
          decideProposal(director, submitted.approval.proposalId, {
            decision: "REJECT",
            reason: "Foreign tenant",
            expectedProposalHash: submitted.approval.proposalHash,
          }),
          code("NOT_FOUND"),
        );
        await decideProposal(legacy, submitted.approval.proposalId, {
          decision: "REJECT",
          reason: "Проверено прежней учётной записью директора",
          expectedProposalHash: submitted.approval.proposalHash,
        });
        const saved = await db.user.findUniqueOrThrow({
          where: { id: legacyUser.id },
        });
        assert.equal(saved.role, "ADMIN");
        assert.equal(saved.passwordHash, original.passwordHash);
        const decision = await db.proposalDecision.findFirstOrThrow({
          where: { proposalId: submitted.approval.proposalId },
        });
        assert.equal(decision.decidedBy, legacyUser.id);
      },
    );
    await t.test(
      "concurrent director demotions cannot remove the last effective director",
      async () => {
        const second = await saveUser(director, {
          email: `second-director-${suffix}@example.test`,
          displayName: "Синтетический второй директор",
          password,
          role: "DIRECTOR",
        });
        const peer = context(center.tenantId, second.id, "DIRECTOR");
        const results = await Promise.allSettled([
          saveUser(director, { role: "OPERATOR" }, peer.userId),
          saveUser(peer, { role: "OPERATOR" }, director.userId),
        ]);
        assert.equal(
          results.filter((result) => result.status === "fulfilled").length,
          1,
        );
        const failure = results.find(
          (result) => result.status === "rejected",
        ) as PromiseRejectedResult;
        code("LAST_DIRECTOR")(failure.reason);
        assert.equal(
          await db.user.count({
            where: {
              tenantId: center.tenantId,
              active: true,
              role: { in: ["ADMIN", "DIRECTOR"] },
            },
          }),
          1,
        );
      },
    );
  } finally {
    await app.close();
    await db.$disconnect();
  }
});

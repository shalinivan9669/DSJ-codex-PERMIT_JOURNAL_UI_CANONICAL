import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { bootstrap } from "../../apps/api/src/main";
import { db } from "../../apps/api/src/core";

async function main() {
  assert.match(
    process.env.DATABASE_URL || "",
    /\/demo_test_restore_[a-z0-9_]+(?:\?|$)/,
  );
  assert.equal(process.env.DEMO_CONTAINER_ACCEPTANCE, "SYNTHETIC_ONLY");
  const expected = JSON.parse(await readFile(process.argv[2], "utf8"));
  const base = `http://127.0.0.1:${process.env.PORT || "4100"}`;
  process.env.DEMO_ORIGIN = base;
  process.env.HOST = "127.0.0.1";
  const app = await bootstrap();
  try {
    const login = await fetch(base + "/auth/login", {
      method: "POST",
      headers: { origin: base, "content-type": "application/json" },
      body: JSON.stringify({
        email: process.env.DEMO_ADMIN_EMAIL,
        password: process.env.DEMO_ADMIN_PASSWORD,
      }),
    });
    assert.equal(login.status, 201);
    const cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const context = await fetch(base + "/context", { headers: { cookie } });
    assert.equal(context.status, 200);
    const actor = (await context.json()) as {
      tenant: { id: string; demoOnly: boolean };
    };
    assert.equal(actor.tenant.id, expected.tenantId);
    assert.equal(actor.tenant.demoOnly, true);
    const request = await fetch(
      base + `/print-requests/${expected.requestId}`,
      { headers: { cookie } },
    );
    assert.equal(request.status, 200);
    const requestBody = await request.json();
    let orderParties = null;
    if (expected.parties) {
      const response = await fetch(base + `/orders/${expected.orderId}`, {
        headers: { cookie },
      });
      assert.equal(response.status, 200);
      const order = await response.json();
      assert.equal(order.id, expected.orderId);
      assert.deepEqual(
        [order.customerId, order.payerId, order.employerId],
        expected.parties,
      );
      assert.deepEqual(
        [order.customer.id, order.payer.id, order.employer.id],
        expected.parties,
      );
      assert.equal(order.summary.people, expected.people);
      assert.equal(order.summary.events, expected.events);
      assert.equal(order.requests.length, 1);
      assert.equal(order.requests[0].id, expected.requestId);
      assert.equal(order.requests[0].itemCount, expected.people);
      assert.equal(requestBody.customerId, expected.parties[0]);
      assert.equal(requestBody.items.length, expected.people);
      assert.equal(requestBody.items[0].employerId, expected.parties[2]);
      assert.equal(
        requestBody.items[0].assignments[0].outcome.status,
        "UNKNOWN",
      );
      assert.ok(
        order.nextActions.some(
          (item: { source: string }) => item.source === "RESULT_REVIEW",
        ),
      );
      orderParties = {
        orderId: order.id,
        parties: [order.customerId, order.payerId, order.employerId],
        people: order.summary.people,
        events: order.summary.events,
        requestCustomerAndRowEmployerPreserved: true,
        unknownResultStillRequiresAction: true,
        sourceUiEvidence: expected.sourceUiEvidence,
      };
    }
    const downloads = [];
    for (const artifact of expected.artifacts) {
      for (let repeat = 1; repeat <= 2; repeat++) {
        const response = await fetch(base + `/artifacts/${artifact.id}`, {
          headers: { cookie },
        });
        assert.equal(response.status, 200);
        const buffer = Buffer.from(await response.arrayBuffer());
        const sha256 = createHash("sha256").update(buffer).digest("hex");
        assert.equal(sha256, artifact.sha256);
        assert.equal(buffer.length, artifact.size);
        downloads.push({
          id: artifact.id,
          format: artifact.kind,
          repeat,
          sha256,
          bytes: buffer.length,
        });
      }
    }
    const photos = [];
    for (const photo of expected.photoIds) {
      const response = await fetch(base + `/photos/${photo.id}`, {
        headers: { cookie },
      });
      assert.equal(response.status, 200);
      const buffer = Buffer.from(await response.arrayBuffer());
      const sha256 = createHash("sha256").update(buffer).digest("hex");
      assert.equal(sha256, photo.sha256);
      photos.push({ id: photo.id, sha256, bytes: buffer.length });
    }
    const attachments = [];
    for (const file of expected.attachments || []) {
      const response = await fetch(base + `/value-attachments/${file.id}`, {
        headers: { cookie },
      });
      assert.equal(response.status, 200);
      const bytes = Buffer.from(await response.arrayBuffer());
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      assert.equal(sha256, file.sha256);
      assert.equal(bytes.length, file.size);
      attachments.push({ id: file.id, sha256, bytes: bytes.length });
    }
    const restoredEntities = [];
    for (const [kind, id] of [
      ["print-requests", expected.groupRequestId],
      ["orders", expected.orderId],
    ]) {
      if (!id) continue;
      const response = await fetch(`${base}/${kind}/${id}`, {
        headers: { cookie },
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.id, id);
      restoredEntities.push({ kind, id });
    }
    const invitations = [];
    if (expected.invitations?.length) {
      const response = await fetch(base + "/employer-invites", {
        headers: { cookie },
      });
      assert.equal(response.status, 200);
      const { items } = await response.json();
      for (const expectedInvite of expected.invitations) {
        const row = items.find(
          (item: { id: string }) => item.id === expectedInvite.id,
        );
        assert.ok(row);
        assert.equal(row.customerId, expectedInvite.customerId);
        for (const field of [
          "expiresAt",
          "accessExpiresAt",
          "consumedAt",
          "revokedAt",
        ])
          assert.equal(row[field], expectedInvite[field]);
        assert.equal(row.secretHash, undefined);
        invitations.push({
          id: row.id,
          state: expectedInvite.state,
          restored: true,
        });
      }
    }
    let dossier = null;
    if (expected.dossier) {
      const response = await fetch(
        base + `/orders/${expected.orderId}/dossier`,
        { headers: { cookie } },
      );
      assert.equal(response.status, 200);
      const current = await response.json();
      for (const key of [
        "artifacts",
        "attachments",
        "events",
        "issuances",
        "missing",
      ])
        assert.deepEqual(
          current[key].sort((a: { id: string }, b: { id: string }) =>
            a.id.localeCompare(b.id),
          ),
          expected.dossier.detail[key].sort(
            (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id),
          ),
        );
      const order = await fetch(base + `/orders/${expected.orderId}`, {
        headers: { cookie },
      });
      assert.equal(order.status, 200);
      assert.equal((await order.json()).summary.people, expected.people);
      const download = await fetch(
        base + `/orders/${expected.orderId}/dossier/export`,
        { headers: { cookie } },
      );
      assert.equal(download.status, 200);
      const zipPath = join(
        dirname(resolve(process.argv[3])),
        `${basename(process.argv[3], ".json").replace(/-http-readback$/, "")}-restored-dossier.zip`,
      );
      await writeFile(zipPath, Buffer.from(await download.arrayBuffer()));
      assert.ok(process.env.DEMO_PYTHON);
      dossier = JSON.parse(
        execFileSync(
          process.env.DEMO_PYTHON,
          [
            resolve("scripts/verification/verify-restored-dossier.py"),
            zipPath,
            resolve(process.argv[2]),
          ],
          { encoding: "utf8", windowsHide: true, timeout: 30000 },
        ),
      );
    }
    const webChecks = [];
    if (process.env.DEMO_RECOVERY_WEB_ORIGIN) {
      const webBase = process.env.DEMO_RECOVERY_WEB_ORIGIN;
      assert.match(webBase, /^http:\/\/127\.0\.0\.1:[0-9]+$/);
      const loginPage = await fetch(webBase + "/login");
      assert.equal(loginPage.status, 200);
      assert.match(await loginPage.text(), /<html/);
      const proxiedContext = await fetch(webBase + "/api/context", {
        headers: { cookie },
      });
      assert.equal(proxiedContext.status, 200);
      assert.equal((await proxiedContext.json()).tenant.id, expected.tenantId);
      const file = expected.artifacts.find(
        (item: { kind: string }) => item.kind === "PDF",
      );
      assert.ok(file);
      const downloaded = await fetch(webBase + `/api/artifacts/${file.id}`, {
        headers: { cookie },
      });
      assert.equal(downloaded.status, 200);
      const bytes = Buffer.from(await downloaded.arrayBuffer());
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        file.sha256,
      );
      webChecks.push({
        loginPageStatus: 200,
        authenticatedProxyContext: true,
        pdfId: file.id,
        sha256: file.sha256,
      });
    }
    const result = {
      status: "PASS",
      restoredTenantId: expected.tenantId,
      requestId: expected.requestId,
      downloads,
      photos,
      attachments,
      restoredEntities,
      orderParties,
      invitations,
      dossier,
      webChecks,
      note: "Verified after row/file/template/font hash reconciliation; login intentionally creates a new session after the offline restore verification.",
    };
    await writeFile(process.argv[3], JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally {
    await app.close();
  }
}
void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

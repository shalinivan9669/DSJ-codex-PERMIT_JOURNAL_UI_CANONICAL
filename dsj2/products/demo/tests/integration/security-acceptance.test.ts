import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { bootstrap } from "../../apps/api/src/main";
import { db } from "../../apps/api/src/core";
import { store } from "../../apps/api/src/files";
import { provision } from "../../scripts/setup";
import { draftSchema, itemSchema } from "../../packages/contracts/src";
import { claimJob, executeJob } from "../../apps/render-worker/src/queue";
import { assertTestDatabase } from "./test-database";

type Session = {
  cookie: string;
  csrf: string;
  role: string;
  tenantId: string;
  userId: string;
};
test("commercial security: two tenants, all three genuine roles, HTTP object isolation and credential lifecycle", async (t) => {
  assertTestDatabase();
  process.env.PORT = "0";
  process.env.DEMO_ORIGIN = "http://localhost:3100";
  const app = await bootstrap();
  const base = await app.getUrl();
  const password = "Synthetic-Security-Password!";
  const suffix = randomUUID();
  const sessions: Session[][] = [];
  const call = (
    s: Session | null,
    path: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(base + path, {
      method,
      headers: {
        origin: process.env.DEMO_ORIGIN!,
        ...(s ? { cookie: s.cookie, "x-csrf-token": s.csrf } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const logIn = async (
    email: string,
    tenantId: string,
    pass = password,
  ): Promise<Session> => {
    const response = await call(null, "/auth/login", "POST", {
      email,
      password: pass,
    });
    assert.equal(response.status, 201, await response.clone().text());
    const cookies = response.headers.getSetCookie();
    assert.ok(
      cookies.some(
        (c) =>
          c.startsWith("demo_session=") &&
          /HttpOnly/.test(c) &&
          /SameSite=Strict/.test(c),
      ),
    );
    const payload = await response.json();
    assert.equal(payload.tenant.id, tenantId);
    return {
      cookie: cookies.map((c) => c.split(";")[0]).join("; "),
      csrf: payload.csrfToken,
      role: payload.user.role,
      tenantId,
      userId: payload.user.id,
    };
  };
  const readJson = async (response: Response, expected = 201) => {
    assert.equal(response.status, expected, await response.clone().text());
    return response.json();
  };
  try {
    for (const label of ["A", "B"]) {
      const tenant = await provision({
        email: `security-${label}-${suffix}@example.test`,
        password,
        name: `Synthetic security ${label}`,
        sample: true,
      });
      const admin = await logIn(tenant.email, tenant.tenantId);
      const group = [admin];
      for (const role of ["OPERATOR", "VIEWER"]) {
        const user = await readJson(
          await call(admin, "/users", "POST", {
            email: `security-${label}-${role}-${suffix}@example.test`,
            password,
            displayName: `Synthetic ${role}`,
            role,
          }),
        );
        group.push(await logIn(user.email, tenant.tenantId));
      }
      sessions.push(group);
    }
    const fixtures: Array<{
      customer: { id: string };
      recipient: { id: string };
      request: { id: string };
      draft: ReturnType<typeof draftSchema.parse>;
      photo: { id: string };
      artifact: Awaited<ReturnType<typeof executeJob>>;
      template: { id: string };
      mapping: { id: string };
      batch: { id: string };
      token: string;
      job: NonNullable<Awaited<ReturnType<typeof claimJob>>>;
    }> = [];
    for (const [index, group] of sessions.entries()) {
      const admin = group[0];
      const token = `TENANT_${index}_${suffix}`;
      const customer = await readJson(
        await call(admin, "/customers", "POST", {
          nameRu: token,
          nameKz: `Ә Ғ Қ ${token}`,
        }),
      );
      const recipient = await readJson(
        await call(
          admin,
          "/recipients",
          "POST",
          itemSchema.parse({ id: randomUUID(), fullNameRu: token }),
        ),
      );
      const bytes = await readFile(
        join(__dirname, "../fixtures/source-photo.png"),
      );
      const form = new FormData();
      form.append(
        "file",
        new Blob([bytes], { type: "image/png" }),
        "synthetic.png",
      );
      const photo = await readJson(
        await fetch(base + "/photos", {
          method: "POST",
          headers: {
            origin: process.env.DEMO_ORIGIN!,
            cookie: admin.cookie,
            "x-csrf-token": admin.csrf,
          },
          body: form,
        }),
      );
      const draft = draftSchema.parse({
        kind: "COMPANY",
        customerId: customer.id,
        title: token,
        items: [
          {
            id: randomUUID(),
            fullNameRu: token,
            fullNameKz: `Ә Ғ Қ ${token}`,
            photoAssetId: photo.id,
            assignments: [
              {
                id: randomUUID(),
                templateId: "biot-worker-card",
                documentDate: "2026-09-22",
                trainingSubject: "Синтетическая программа",
                result: "Синтетический результат",
              },
            ],
          },
        ],
      });
      const request = await readJson(
        await call(admin, "/print-requests", "POST", draft),
      );
      await readJson(
        await call(
          admin,
          `/print-requests/${request.id}/finalize`,
          "POST",
          { expectedRevision: 0 },
          { "idempotency-key": randomUUID() },
        ),
      );
      const owned = await claimJob(db, `security-${index}`, admin.tenantId);
      assert.ok(owned);
      assert.equal(owned.kind, "DOCX");
      const artifact = await executeJob(
        db,
        store,
        owned,
        `security-${index}`,
        new AbortController().signal,
      );
      const template = (
        await readJson(await call(admin, "/settings/templates"), 200)
      ).items[0];
      const mapping = await readJson(
        await call(admin, "/imports/mappings", "POST", {
          name: token,
          columns: [token],
          mapping: { [token]: "fullNameRu" },
        }),
      );
      const batch = await db.importBatch.create({
        data: { tenantId: admin.tenantId, checksum: token, rows: { rows: [] } },
      });
      fixtures.push({
        customer,
        recipient,
        request,
        draft,
        photo,
        artifact,
        template,
        mapping,
        batch,
        token,
        job: owned,
      });
    }
    await t.test(
      "each real role can read its own data and no role can read or mutate another tenant's IDs",
      async () => {
        for (const [index, group] of sessions.entries()) {
          const own = fixtures[index];
          const foreign = fixtures[1 - index];
          for (const session of group) {
            assert.equal(
              (await call(session, `/print-requests/${own.request.id}`)).status,
              200,
            );
            assert.equal(
              (await call(session, `/photos/${own.photo.id}`)).status,
              200,
            );
            const download = await call(
              session,
              `/artifacts/${own.artifact.id}`,
            );
            assert.equal(download.status, 200);
            assert.equal(
              download.headers.get("x-content-sha256"),
              own.artifact.sha256,
            );
            assert.deepEqual(
              Buffer.from(await download.arrayBuffer()),
              await store.read(own.artifact.storageKey, own.artifact.sha256),
            );
            const writes = session.role === "VIEWER" ? 403 : 404;
            for (const [path, method, body, expected] of [
              [`/print-requests/${foreign.request.id}`, "GET", undefined, 404],
              [
                `/print-requests/${foreign.request.id}`,
                "PATCH",
                { expectedRevision: 0, draft: foreign.draft },
                writes,
              ],
              [
                `/print-requests/${foreign.request.id}`,
                "DELETE",
                undefined,
                writes,
              ],
              [
                `/print-requests/${foreign.request.id}/validate`,
                "POST",
                { expectedRevision: 0 },
                404,
              ],
              [
                `/print-requests/${foreign.request.id}/preview`,
                "POST",
                { expectedRevision: 0 },
                writes,
              ],
              [
                `/print-requests/${foreign.request.id}/finalize`,
                "POST",
                { expectedRevision: 0 },
                writes,
              ],
              [
                `/print-requests/${foreign.request.id}/correct`,
                "POST",
                { expectedRevision: 0, reason: "Synthetic correction" },
                writes,
              ],
              [
                `/print-requests/${foreign.request.id}/cancel`,
                "POST",
                { expectedRevision: 0, reason: "Synthetic cancellation" },
                writes,
              ],
              [
                `/print-requests/${foreign.request.id}/export`,
                "POST",
                { format: "XLSX" },
                404,
              ],
              [
                `/print-requests/${foreign.request.id}/export`,
                "POST",
                { format: "ZIP", allowPartial: true },
                404,
              ],
              [`/photos/${foreign.photo.id}`, "GET", undefined, 404],
              [`/artifacts/${foreign.artifact.id}`, "GET", undefined, 404],
              [
                `/artifacts/${foreign.artifact.id}/restore`,
                "POST",
                { reason: "Synthetic recovery" },
                writes,
              ],
              [`/jobs/${foreign.job.id}/retry`, "POST", {}, writes],
              [
                `/customers/${foreign.customer.id}`,
                "PATCH",
                { nameRu: "Injected" },
                writes,
              ],
              [
                `/recipients/${foreign.recipient.id}`,
                "PATCH",
                itemSchema.parse({ id: "injected" }),
                writes,
              ],
              [
                `/print-requests/${own.request.id}/import`,
                "POST",
                { expectedRevision: 0, importId: foreign.batch.id, rows: [] },
                writes,
              ],
              [
                `/settings/templates/${foreign.template.id}/approve`,
                "POST",
                { approved: true },
                session.role === "ADMIN" ? 404 : 403,
              ],
              [
                `/users/${sessions[1 - index][1].userId}`,
                "PATCH",
                { disabled: true },
                session.role === "ADMIN" ? 404 : 403,
              ],
            ] as const) {
              const response = await call(session, path, method, body, {
                "idempotency-key": randomUUID(),
              });
              assert.equal(
                response.status,
                expected,
                `${session.role} ${method} ${path}: ${await response.text()}`,
              );
            }
            for (const path of [
              `/jobs?requestId=${foreign.request.id}`,
              `/print-requests?search=${foreign.token}`,
              `/customers?search=${foreign.token}`,
            ]) {
              const data = await readJson(await call(session, path), 200);
              assert.equal(data.total, 0, `${session.role} ${path}`);
            }
            for (const path of [
              "/recipients",
              "/settings/templates",
              "/imports/mappings",
            ]) {
              const data = await readJson(await call(session, path), 200);
              assert.ok(
                data.items.every(
                  (item: { tenantId: string }) =>
                    item.tenantId === session.tenantId,
                ),
              );
            }
            const audit = await call(session, "/audit");
            assert.equal(audit.status, session.role === "ADMIN" ? 200 : 403);
            if (session.role === "ADMIN")
              assert.ok(
                (await audit.json()).items.every(
                  (item: { tenantId: string }) =>
                    item.tenantId === session.tenantId,
                ),
              );
            const users = await call(session, "/users");
            assert.equal(users.status, session.role === "ADMIN" ? 200 : 403);
            for (const path of [
              "/employees",
              "/v1/biot-cards/generate",
              "/signing/invites/test",
              "/courses",
              "/data/artifacts/private",
              "/storage",
              "/protocols",
              "/api/employee-documents",
            ]) {
              for (const method of ["GET", "POST", "DELETE"])
                assert.equal((await call(session, path, method)).status, 404);
            }
          }
        }
      },
    );
    await t.test(
      "anonymous requests, forged origin/CSRF, path traversal and unknown JSON fields fail closed",
      async () => {
        const own = fixtures[0];
        for (const path of [
          "/context",
          `/print-requests/${own.request.id}`,
          `/photos/${own.photo.id}`,
          `/artifacts/${own.artifact.id}`,
          "/jobs",
          "/settings/templates",
          "/audit",
          "/imports/mappings",
        ])
          assert.equal((await call(null, path)).status, 401);
        for (const origin of ["https://attacker.invalid", "null", ""])
          assert.equal(
            (
              await call(
                sessions[0][0],
                "/print-requests",
                "POST",
                { kind: "PERSON" },
                { origin },
              )
            ).status,
            403,
          );
        for (const csrf of ["", "bad", sessions[1][0].csrf])
          assert.equal(
            (
              await call(
                sessions[0][0],
                "/print-requests",
                "POST",
                { kind: "PERSON" },
                { "x-csrf-token": csrf },
              )
            ).status,
            403,
          );
        assert.equal(
          (
            await call(sessions[0][0], "/print-requests", "POST", {
              kind: "PERSON",
              tenantId: sessions[1][0].tenantId,
            })
          ).status,
          400,
        );
        for (const path of [
          "/artifacts/%2e%2e%2fsecret",
          "/photos/%5csecret",
          "/settings/templates/%00/approve",
        ])
          assert.equal((await call(sessions[0][0], path)).status, 404);
        const session = await readJson(
          await call(sessions[0][0], "/context"),
          200,
        );
        assert.equal(JSON.stringify(session).includes("passwordHash"), false);
        assert.equal(JSON.stringify(session).includes(password), false);
      },
    );
    await t.test(
      "VIEWER changes own password; every old session revoked, admin reset/logout/expiry and production cookie flags",
      async () => {
        const viewer = sessions[0][2];
        const email = `security-A-VIEWER-${suffix}@example.test`;
        const second = await logIn(email, viewer.tenantId);
        assert.equal(
          (
            await call(viewer, "/auth/password", "POST", {
              currentPassword: password,
              newPassword: "Changed-Security-Password!",
            })
          ).status,
          201,
        );
        assert.equal((await call(viewer, "/context")).status, 401);
        assert.equal((await call(second, "/context")).status, 401);
        const previous = process.env.NODE_ENV;
        process.env.NODE_ENV = "production";
        const secureLogin = await call(null, "/auth/login", "POST", {
          email,
          password: "Changed-Security-Password!",
        });
        process.env.NODE_ENV = previous;
        assert.equal(secureLogin.status, 201);
        assert.ok(
          secureLogin.headers.getSetCookie().every((c) => /; Secure/.test(c)),
        );
        const secureBody = await secureLogin.json();
        const current = {
          ...viewer,
          cookie: secureLogin.headers
            .getSetCookie()
            .map((c) => c.split(";")[0])
            .join("; "),
          csrf: secureBody.csrfToken,
        };
        assert.equal((await call(current, "/auth/logout", "POST")).status, 201);
        assert.equal((await call(current, "/context")).status, 401);
        await db.session.updateMany({
          where: { userId: sessions[1][2].userId },
          data: { expiresAt: new Date(0) },
        });
        assert.equal((await call(sessions[1][2], "/context")).status, 401);
        assert.equal(
          (
            await call(
              sessions[0][0],
              `/users/${sessions[0][1].userId}`,
              "PATCH",
              { password: "Admin-Reset-Security-Password!" },
            )
          ).status,
          200,
        );
        assert.equal((await call(sessions[0][1], "/context")).status, 401);
        assert.equal(
          (
            await call(
              sessions[1][0],
              `/users/${sessions[1][1].userId}`,
              "PATCH",
              { disabled: true },
            )
          ).status,
          200,
        );
        assert.equal((await call(sessions[1][1], "/context")).status, 401);
      },
    );
    await t.test(
      "untrusted images, macro/external XLSX and compressed archive bombs rejected; formula-only source rows remain accounted",
      async () => {
        const session = sessions[0][0];
        const upload = async (
          path: string,
          bytes: Buffer,
          name: string,
          mime = "application/octet-stream",
        ) => {
          const form = new FormData();
          form.append("file", new Blob([bytes], { type: mime }), name);
          return fetch(base + path, {
            method: "POST",
            headers: {
              origin: process.env.DEMO_ORIGIN!,
              cookie: session.cookie,
              "x-csrf-token": session.csrf,
            },
            body: form,
          });
        };
        for (const [name, bytes, mime] of [
          [
            "external.svg",
            Buffer.from(
              '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://attacker.invalid/secret"/></svg>',
            ),
            "image/svg+xml",
          ],
          ["oversized.png", Buffer.alloc(5 * 1024 * 1024 + 1), "image/png"],
          [
            "script.png",
            Buffer.from('<script>alert("synthetic")</script>'),
            "image/png",
          ],
        ] as const)
          assert.ok(
            [400, 413].includes(
              (await upload("/photos", bytes, name, mime)).status,
            ),
          );
        const python = process.env.DEMO_PYTHON || "python";
        const compressed = (name: string, size: number) =>
          execFileSync(
            python,
            [
              "-I",
              "-c",
              "import io,sys,zipfile; b=io.BytesIO(); z=zipfile.ZipFile(b,'w',zipfile.ZIP_DEFLATED); z.writestr(sys.argv[1],b'0'*int(sys.argv[2])); z.close(); sys.stdout.buffer.write(b.getvalue())",
              name,
              String(size),
            ],
            { windowsHide: true },
          );
        for (const [entry, size] of [
          ["xl/vbaProject.bin", 1],
          ["xl/externalLinks/externalLink1.xml", 1],
          ["xl/worksheets/sheet1.xml", 31 * 1024 * 1024],
        ] as const) {
          const result = await upload(
            "/imports/preview",
            compressed(entry, size),
            "unsafe.xlsx",
          );
          assert.equal(result.status, 400);
          const body = await result.json();
          assert.equal(body.code, "IMPORT_INVALID");
          assert.ok(body.correlationId);
          assert.equal(JSON.stringify(body).includes("Traceback"), false);
        }
        const formula = execFileSync(
          python,
          [
            "-I",
            "-c",
            "import io,sys; from openpyxl import Workbook; b=io.BytesIO(); w=Workbook(); s=w.active; s.append(['fullNameRu']); s.append(['=1+1']); w.save(b); sys.stdout.buffer.write(b.getvalue())",
          ],
          { windowsHide: true },
        );
        const preview = await readJson(
          await upload("/imports/preview", formula, "formula.xlsx"),
        );
        assert.equal(preview.total, 1);
        assert.equal(preview.rows[0].sourceRow, 2);
        assert.ok(preview.rows[0].errors.includes("FORMULA_NOT_ALLOWED"));
        assert.equal(preview.canApply, false);
      },
    );
    await t.test(
      "login brute force is bounded with a non-sensitive 429 response",
      async () => {
        let rejected = false;
        for (let i = 0; i < 11; i++) {
          const response = await call(null, "/auth/login", "POST", {
            email: "nonexistent@example.test",
            password: "wrong-password",
          });
          assert.ok([401, 429].includes(response.status));
          const body = await response.json();
          assert.ok(body.correlationId);
          assert.equal(JSON.stringify(body).includes("scrypt"), false);
          if (response.status === 429) {
            rejected = true;
            break;
          }
        }
        assert.ok(rejected);
      },
    );
  } finally {
    await app.close();
    await db.$disconnect();
  }
});

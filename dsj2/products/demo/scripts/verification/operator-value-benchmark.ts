import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { bootstrap } from "../../apps/api/src/main";
import { db } from "../../apps/api/src/core";
import { provision } from "../setup";
import { draftSchema } from "../../packages/contracts/src";
import { assertTestDatabase } from "../../tests/integration/test-database";

async function main() {
  assertTestDatabase();
  const email = `benchmark-${randomUUID()}@example.test`,
    password = randomUUID();
  const tenant = await provision({
    email,
    password,
    name: "Синтетический замер",
    sample: true,
  });
  await db.recipient.createMany({
    data: Array.from({ length: 1001 }, (_, i) => ({
      tenantId: tenant.tenantId,
      data: {
        fullNameRu: `Слушатель ${String(i + 1).padStart(4, "0")}`,
        personnelNumber: String(i + 1).padStart(6, "0"),
      },
    })),
  });
  await db.customerOrganization.createMany({
    data: Array.from({ length: 101 }, (_, i) => ({
      tenantId: tenant.tenantId,
      nameRu: `Заказчик ${String(i + 1).padStart(4, "0")}`,
      bin: String(i + 1).padStart(12, "0"),
    })),
  });
  process.env.PORT = "0";
  process.env.DEMO_ORIGIN = "http://localhost:3109";
  const app = await bootstrap();
  try {
    const base = await app.getUrl();
    const login = await fetch(base + "/auth/login", {
      method: "POST",
      headers: {
        origin: process.env.DEMO_ORIGIN,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(login.status, 201);
    const cookie = login.headers
      .getSetCookie()
      .map((v) => v.split(";")[0])
      .join("; ");
    const session = (await login.json()) as { csrfToken: string };
    const headers = {
      cookie,
      origin: process.env.DEMO_ORIGIN,
      "content-type": "application/json",
      "x-csrf-token": session.csrfToken,
    };
    const call = async (path: string, method = "GET", body?: unknown) => {
      const response = await fetch(base + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await response.json();
      assert.ok(response.ok, JSON.stringify(data));
      return data;
    };
    const page = await call("/recipients?page=6&pageSize=20");
    assert.equal(page.total, 1001);
    assert.equal(page.items[0].data.personnelNumber, "000101");
    const last = await call("/recipients?search=001001");
    assert.equal(last.items.length, 1);
    const customerPage = await call("/customers?page=6&pageSize=20");
    assert.equal(customerPage.total, 101);
    assert.equal(customerPage.items.length, 1);
    assert.equal(customerPage.items[0].nameRu, "Заказчик 0101");
    const customerSearch = await call("/customers?search=000000000101");
    assert.equal(customerSearch.items[0].id, customerPage.items[0].id);
    const draft = draftSchema.parse({
      kind: "PERSON",
      demoMode: true,
      title: "100 строк: замер сохранения",
      items: Array.from({ length: 100 }, (_, i) => ({
        id: randomUUID(),
        fullNameRu: `Синтетический ${i}`,
      })),
    });
    const created = await call("/print-requests", "POST", draft);
    const measurements: Record<string, number[]> = {
      search1001: [],
      load100Rows: [],
      save100Rows: [],
    };
    let revision = 0;
    for (let i = 0; i < 20; i++) {
      let start = performance.now();
      await call("/recipients?search=Слушатель&page=6&pageSize=20");
      measurements.search1001.push(performance.now() - start);
      start = performance.now();
      await call("/print-requests/" + created.id);
      measurements.load100Rows.push(performance.now() - start);
      draft.title = "Замер " + i;
      start = performance.now();
      const saved = await call("/print-requests/" + created.id, "PATCH", {
        expectedRevision: revision,
        draft,
      });
      measurements.save100Rows.push(performance.now() - start);
      revision = saved.revision;
    }
    const final = await call("/print-requests/" + created.id);
    assert.equal(final.items.length, 100);
    assert.equal(final.title, "Замер 19");
    const stats = Object.fromEntries(
      Object.entries(measurements).map(([key, times]) => {
        const sorted = [...times].sort((a, b) => a - b);
        return [
          key,
          {
            samples: times.length,
            p50Ms: sorted[9],
            p95Ms: sorted[18],
            minMs: sorted[0],
            maxMs: sorted[19],
            rawMs: times,
          },
        ];
      }),
    );
    await writeFile(
      "docs/evidence/operator-value/performance.json",
      JSON.stringify(
        {
          synthetic: true,
          baseline: null,
          scope:
            "Local real HTTP and PostgreSQL; 20 sequential samples per operation. Shared Windows development host with other verification processes running. Not browser input latency or customer productivity.",
          recipientCount: 1001,
          customerCount: 101,
          selectorsBeyondFirst100:
            "PASS: real HTTP page6 and exact ID search for recipients and customers",
          requestRows: 100,
          stats,
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify({ status: "PASS", stats }));
  } finally {
    await app.close();
  }
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

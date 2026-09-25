import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { db } from "../../apps/api/src/core";
import { draftSchema, today } from "../../packages/contracts/src";
import {
  newRequestBundle,
  recipientForRequest,
} from "../../apps/web/lib/request-bundles";

// Explicit synthetic acceptance fixture on the existing local stand. No reset,
// re-seed, tenant replacement, or edits to previous requests/issued documents.
async function main() {
  assert.equal(
    process.env.DATABASE_URL,
    "postgresql://postgres@127.0.0.1:55439/demo_test_operator_browser",
  );
  const base = "http://127.0.0.1:4109";
  const origin = "http://localhost:3109";
  const output = "docs/evidence/forms-ux/live";
  await mkdir(output, { recursive: true });
  const login = await fetch(base + "/auth/login", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({
      email: process.env.DEMO_E2E_EMAIL,
      password: process.env.DEMO_E2E_PASSWORD,
    }),
  });
  assert.equal(login.status, 201);
  const cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const ctx = await (
    await fetch(base + "/context", { headers: { cookie } })
  ).json();
  assert.equal(ctx.tenant.demoOnly, true);
  const headers = {
    cookie,
    origin,
    "content-type": "application/json",
    "x-csrf-token": ctx.csrfToken,
  };
  async function api(path: string, method = "GET", body?: unknown) {
    const response = await fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    assert.ok(
      response.ok,
      JSON.stringify({ path, status: response.status, result }),
    );
    return result;
  }
  if (process.argv.includes("--prepare")) {
    const organizations = await db.customerOrganization.findMany({
      where: { tenantId: ctx.tenant.id, nameRu: "ТОО «QA Сарыарка 2509»" },
    });
    assert.equal(
      organizations.length,
      1,
      "Create the synthetic organization through the browser first",
    );
    const employer = organizations[0];
    const cases = [];
    for (const category of ["WORKER", "ITR"] as const) {
      const draft = draftSchema.parse({
        kind: "PERSON",
        schemaVersion: 2,
        title: `QA 2509 · ${category} · готовый образец`,
        demoMode: true,
        ...newRequestBundle(category),
      });
      draft.commonFields = {
        trainingDateRule: {
          hoursPerDay: 8,
          hoursSource: "THEORY",
          calendar: "CALENDAR",
          anchor: "DOCUMENT_IS_END",
          protocolDate: "TRAINING_END",
          source: "Синтетический график QA. Не утверждённое правило центра.",
        },
      };
      Object.assign(draft.events![0].commonFields, {
        trainingSubject: "Синтетическая программа БиОТ",
        biotIndustryRu: "Синтетическая отрасль",
        biotIndustryKz: "Сынақ саласы",
      });
      while (draft.items.length < 3)
        draft.items.push(recipientForRequest(draft));
      draft.items.forEach((item, index) => {
        Object.assign(item, {
          fullNameRu: `QA Испытатель Александр ${index + 1}`,
          fullNameKz: `QA Әділ Өмір Қасымұлы ${index + 1}`,
          positionRu: "Инженер",
          positionKz: "Маман",
          employerId: employer.id,
          employerBin: "000000000001",
          employerAddressRu: "Тестовый адрес",
          employerAddressKz: "Сынақ мекенжайы",
        });
        Object.assign(item.assignments[0], {
          result: "Сдал",
          outcome: {
            status: "PASSED",
            source: "Синтетическая ведомость QA, не реальные результаты",
          },
          biotKnowledgeResult: "80%",
          biotProctoringResult: "Синтетический результат",
        });
      });
      const created = await api("/print-requests", "POST", draft);
      const checked = await api(
        `/print-requests/${created.id}/validate`,
        "POST",
        { expectedRevision: 0 },
      );
      assert.deepEqual(checked.issues, []);
      const resolved = await api(`/print-requests/${created.id}/resolved`);
      assert.equal(
        resolved.draft.commonFields.documentDate,
        today(ctx.tenant.timezone),
      );
      assert.equal(resolved.draft.items[0].workplaceRu, employer.nameRu);
      assert.equal(resolved.draft.items[0].workplaceKz, employer.nameKz);
      const preview = await api(
        `/print-requests/${created.id}/preview`,
        "POST",
        { expectedRevision: 0 },
      );
      cases.push({
        category,
        requestId: created.id,
        url: `${origin}/requests/${created.id}/edit`,
        resolved: resolved.draft,
        preview,
      });
    }
    await writeFile(join(output, "cases.json"), JSON.stringify(cases, null, 2));
    console.log(
      JSON.stringify(
        cases.map(({ category, requestId, url }) => ({
          category,
          requestId,
          url,
        })),
      ),
    );
  } else {
    const cases = JSON.parse(
      await readFile(join(output, "cases.json"), "utf8"),
    );
    const results = [];
    for (const sample of cases) {
      const documents = await db.issuedDocument.findMany({
        where: { tenantId: ctx.tenant.id, requestId: sample.requestId },
      });
      assert.equal(
        documents.length,
        4,
        "Finalize the three-person synthetic bundle through UI",
      );
      const group = documents.filter((d) => d.ownerKind === "GROUP");
      assert.equal(group.length, 1);
      const members = await db.groupDocumentMember.findMany({
        where: { documentId: group[0].id },
        orderBy: { position: "asc" },
      });
      assert.equal(members.length, 3);
      const artifacts = await db.artifact.findMany({
        where: {
          tenantId: ctx.tenant.id,
          requestId: sample.requestId,
          issuanceId: { not: null },
        },
      });
      assert.equal(
        artifacts.filter((artifact) => artifact.documentId).length,
        8,
      );
      const files = [];
      for (const artifact of artifacts) {
        const response = await fetch(base + `/artifacts/${artifact.id}`, {
          headers: { cookie },
        });
        assert.equal(response.status, 200);
        const bytes = Buffer.from(await response.arrayBuffer());
        assert.equal(
          createHash("sha256").update(bytes).digest("hex"),
          artifact.sha256,
        );
        const path = join(
          output,
          `${sample.category}-${artifact.documentId ? documents.find((document) => document.id === artifact.documentId)!.templateId + "-" + documents.find((document) => document.id === artifact.documentId)!.number : "bundle"}.${artifact.format.toLowerCase()}`,
        );
        await writeFile(path, bytes);
        files.push({
          path,
          sha256: artifact.sha256,
          bytes: bytes.length,
          kind: artifact.format,
          id: artifact.id,
        });
      }
      results.push({
        category: sample.category,
        requestId: sample.requestId,
        documents: documents.map((d) => ({
          id: d.id,
          number: d.number,
          templateId: d.templateId,
          ownerKind: d.ownerKind,
        })),
        members: members.length,
        files,
      });
    }
    await writeFile(
      join(output, "verified.json"),
      JSON.stringify({ at: new Date().toISOString(), results }, null, 2),
    );
    console.log(JSON.stringify(results));
  }
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

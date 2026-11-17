import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { bootstrap } from "../../apps/api/src/main";
import { db } from "../../apps/api/src/core";
import { provision } from "../../scripts/setup";
import { draftSchema } from "../../packages/contracts/src";
import { assertTestDatabase } from "./test-database";
import { LMS_PASSWORD, lmsHttp, lmsJson, lmsSession } from "./lms-fixture";

test("director HTTP flow persists distinct group member, PTM programme and pinned PS hours through preview", async () => {
  assertTestDatabase();
  process.env.PORT = "0";
  process.env.DEMO_ORIGIN ||= "http://localhost:3119";
  const seed = await provision({
    email: `hours-${randomUUID()}@example.test`,
    password: LMS_PASSWORD,
    name: "Тестовый учебный центр",
    sample: true,
  });
  const app = await bootstrap();
  try {
    const base = await app.getUrl();
    const http = lmsHttp(base, await lmsSession(base, seed.email));
    const profile = await lmsJson(await http("/settings/profile"));
    delete profile.id;
    delete profile.version;
    await lmsJson(
      await http("/settings/profile", "POST", {
        ...profile,
        nameRu: "УЦ",
        nameKz: "ОО",
        approvalBasis: "№ 1",
        headName: "Тест Д.",
        commission: ["Тест К.", "Тест А.", "Тест Б."].map((name, index) => ({
          name,
          position: index ? "Член" : "Председатель",
        })),
        people: [
          { name: "Тест А.", position: "Преподаватель", role: "TEACHER" },
        ],
      }),
      201,
    );
    // The narrow original PS card has room for a numeric registration sequence.
    for (const namespace of ["PS:CARD", "PS:PROTOCOL"])
      await lmsJson(
        await http("/settings/numbering", "PATCH", { namespace, prefix: "" }),
      );
    const rule = await lmsJson(
      await http("/service-rules", "POST", {
        serviceKey: "PS",
        title: "Тестовая программа слесаря",
        status: "APPROVED",
        source: "Синтетический учебный план",
        applicability: "Рабочие",
        checkedOn: "2026-10-01",
        definition: {
          programVersion: "1",
          category: "WORKER",
          hours: 72,
          compatibleTemplateIds: ["ps-card", "ps-witness", "ps-protocol"],
          requirements: [],
        },
      }),
      201,
    );
    const customer = await lmsJson(
      await http("/customers", "POST", {
        nameRu: "ТОО Тест",
        nameKz: "Тест ЖШС",
      }),
      201,
    );
    const form = (
      id: string,
      eventId: string,
      templateId: string,
      protocolMode: string,
    ) => ({
      id,
      eventId,
      templateId,
      protocolMode,
      result: "Сдал",
      outcome: { status: "PASSED", source: "Синтетическая ведомость" },
    });
    const [pb, fire, ps] = [randomUUID(), randomUUID(), randomUUID()];
    const created = await lmsJson(
      await http("/print-requests", "POST", {
        kind: "COMPANY",
        customerId: customer.id,
        demoMode: true,
        schemaVersion: 2,
        commonFields: {
          documentDate: "2026-11-17",
          protocolDate: "2026-11-17",
        },
        events: [
          {
            id: pb,
            title: "ПБ",
            protocolTemplateId: "pb-protocol",
            protocolMode: "GROUP",
            commonFields: { trainingSubject: "Промбезопасность" },
          },
          {
            id: fire,
            title: "ПТМ",
            protocolTemplateId: "ptm-protocol",
            protocolMode: "INDIVIDUAL",
            commonFields: {
              trainingSubject: "ПТМ",
              hoursProgram: "PTM_DIRECTOR",
            },
          },
          {
            id: ps,
            title: "Профессия",
            protocolTemplateId: "ps-protocol",
            protocolMode: "INDIVIDUAL",
            commonFields: { trainingSubject: "Слесарь" },
            serviceRuleVersionId: rule.id,
          },
        ],
        items: [
          {
            id: "worker",
            fullNameRu: "Тест А.",
            positionRu: "Слесарь",
            employeeCategory: "WORKER",
            assignments: [
              form("worker-pb", pb, "pb-card", "GROUP"),
              form("worker-ps", ps, "ps-card", "INDIVIDUAL"),
            ],
          },
          {
            id: "itr",
            fullNameRu: "Тест Б.",
            positionRu: "Инженер",
            employeeCategory: "ITR",
            assignments: [
              form("itr-pb", pb, "pb-card", "GROUP"),
              form("itr-fire", fire, "ptm-card", "INDIVIDUAL"),
            ],
          },
        ],
      }),
      201,
    );
    const path = `/print-requests/${created.id}`;
    const expected = {
      "worker:pb": "10",
      "itr:pb": "40",
      "worker:ps": "72",
      "itr:ptm": "8",
    };
    const { draft } = await lmsJson(await http(path + "/resolved"));
    const resolved = draftSchema.parse(draft);
    for (const item of resolved.items)
      for (const a of item.assignments) {
        const key =
          `${item.id}:${a.templateId.split("-")[0]}` as keyof typeof expected;
        assert.equal(
          a.hours,
          expected[key],
          `resolved ${item.id}/${a.templateId}`,
        );
      }
    const rev = { expectedRevision: created.revision };
    const checked = await lmsJson(
      await http(path + "/validate", "POST", rev),
      201,
    );
    const preview = await lmsJson(
      await http(path + "/preview", "POST", rev),
      201,
    );
    assert.ok(preview.jobs.length);
    const snapshots = await db.renderInputSnapshot.findMany({
      where: {
        tenantId: seed.tenantId,
        requestId: created.id,
        revision: created.revision,
      },
      select: { input: true },
    });
    const printed: Record<string, string> = {};
    for (const snapshot of snapshots) {
      const input = snapshot.input as {
        templateId: string;
        items: { id: string; assignment: { hours?: string } }[];
      };
      for (const item of input.items) {
        assert.ok(item.assignment.hours);
        printed[`${item.id}:${input.templateId}`] = item.assignment.hours;
      }
    }
    assert.deepEqual(printed, {
      "worker:pb-card": "10",
      "itr:pb-card": "40",
      "worker:pb-protocol": "10",
      "itr:pb-protocol": "40",
      "itr:ptm-card": "8",
      "itr:ptm-protocol": "8",
      "worker:ps-card": "72",
      "worker:ps-witness": "72",
      "worker:ps-protocol": "72",
    });
    assert.deepEqual(checked.issues, []);
  } finally {
    await app.close();
    await db.$disconnect();
  }
});

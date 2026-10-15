import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { bootstrap } from "../../apps/api/src/main";
import { db, type Context } from "../../apps/api/src/core";
import { provision } from "../../scripts/setup";
import { saveProfile } from "../../apps/api/src/settings";
import { draftSchema, profileSchema } from "../../packages/contracts/src";
import { assertTestDatabase } from "./test-database";
import { LMS_PASSWORD, lmsSession, lmsHttp, lmsJson } from "./lms-fixture";

test(
  "known employer identity keeps three-row HTTP validation consistent while implicit and foreign identity remain denied",
  { timeout: 240000 },
  async (t) => {
    assertTestDatabase();
    const database = new URL(process.env.DATABASE_URL!);
    assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
    assert.doesNotMatch(database.pathname, /browser|first_live_ui/);
    const seed = await provision({
      email: `employer-parity-${randomUUID()}@example.test`,
      password: LMS_PASSWORD,
      name: "Синтетическая проверка работодателя",
      sample: true,
    });
    const context: Context = {
      ...seed,
      role: "DIRECTOR",
      sessionId: "synthetic",
      csrfHash: "synthetic",
      correlationId: randomUUID(),
    };
    const previous = await db.issuerProfileVersion.findFirstOrThrow({
      where: { tenantId: seed.tenantId },
      orderBy: { version: "desc" },
    });
    await saveProfile(context, {
      ...profileSchema.parse(previous.profile),
      headName: "Синтетический директор",
      commission: [
        { name: "Синтетический председатель", position: "Председатель" },
        { name: "Синтетический член первый", position: "Член комиссии" },
        { name: "Синтетический член второй", position: "Член комиссии" },
      ],
    });
    const oldPort = process.env.PORT;
    process.env.PORT = "0";
    process.env.DEMO_ORIGIN ||= "http://localhost:3159";
    const app = await bootstrap();
    try {
      const base = await app.getUrl();
      const call = lmsHttp(base, await lmsSession(base, seed.email));
      const employer = await lmsJson(
        await call("/customers", "POST", {
          legalForm: "NONE",
          ownNameRu: "Синтетическая известная компания",
          ownNameKz: "Синтетикалық белгілі компания",
          bin: "",
          addressRu: "",
          addressKz: "",
        }),
        201,
      );
      const source = (employerId: string | undefined = employer.id) => {
        const eventId = randomUUID();
        const dates = {
          trainingStart: "2026-10-12",
          trainingEnd: "2026-10-13",
          documentDate: "2026-10-15",
          protocolDate: "2026-10-15",
        };
        return draftSchema.parse({
          kind: "COMPANY",
          schemaVersion: 2,
          demoMode: true,
          businessRuleVersion: "LIVE_V1",
          customerId: employer.id,
          commonFields: dates,
          events: [
            {
              id: eventId,
              title: "Синтетическая группа",
              protocolTemplateId: "biot-protocol",
              protocolMode: "GROUP",
              protocolModeSource: "MANUAL",
              commonFields: {
                ...dates,
                trainingSubject: "Синтетическая программа",
                hours: "10",
                productionHours: "16",
                biotCategory: "WORKER",
                biotCheckType: "PERIODIC",
              },
            },
          ],
          items: Array.from({ length: 3 }, (_, index) => ({
            id: randomUUID(),
            fullNameRu: `Синтетический Участник ${index + 1}`,
            fullNameKz: `Синтетикалық Қатысушы ${index + 1}`,
            employeeCategory: "WORKER",
            positionRu: "Работник",
            positionKz: "Қызметкер",
            employerId,
            workplaceRu: "",
            workplaceKz: "",
            employerBin: "123456789012",
            employerAddressRu: "Синтетический адрес филиала",
            assignments: [
              {
                id: randomUUID(),
                eventId,
                templateId: "biot-worker-card",
                protocolMode: "GROUP",
                ...dates,
                trainingSubject: "Синтетическая программа",
                hours: "10",
                productionHours: "16",
                biotCategory: "WORKER",
                biotCheckType: "PERIODIC",
                outcome: {
                  status: "PASSED",
                  source: "СИНТЕТИЧЕСКАЯ ведомость; не реальное обучение",
                },
              },
            ],
          })),
        });
      };
      await t.test(
        "explicit known identity validates all three rows and preserves exact stored draft",
        async () => {
          const created = await lmsJson(
            await call("/print-requests", "POST", source()),
            201,
          );
          const before = await lmsJson(
            await call(`/print-requests/${created.id}`),
          );
          const result = await lmsJson(
            await call(`/print-requests/${created.id}/validate`, "POST", {
              expectedRevision: before.revision,
            }),
            201,
          );
          assert.equal(result.valid, true, JSON.stringify(result.issues));
          assert.deepEqual(result.issues, []);
          assert.equal(result.recipientCount, 3);
          assert.equal(result.documentCount, 4);
          const resolved = await lmsJson(
            await call(`/print-requests/${created.id}/resolved`),
          );
          for (const row of resolved.draft.items) {
            assert.equal(row.workplaceRu, employer.nameRu);
            assert.equal(row.workplaceKz, employer.nameKz);
            assert.equal(row.employerBin, "123456789012");
            assert.equal(row.employerAddressRu, "Синтетический адрес филиала");
          }
          const after = await lmsJson(
            await call(`/print-requests/${created.id}`),
          );
          assert.deepEqual(after.items, before.items);
          assert.equal(after.revision, before.revision);
          assert.ok(
            after.items.every(
              (row: {
                employerId: string;
                workplaceRu: string;
                workplaceKz: string;
              }) =>
                row.employerId === employer.id &&
                row.workplaceRu === "" &&
                row.workplaceKz === "",
            ),
          );
          const directory = await db.customerOrganization.findUniqueOrThrow({
            where: { id: employer.id },
          });
          assert.equal(directory.bin, "");
          assert.equal(directory.addressRu, "");
        },
      );
      await t.test(
        "unlinked partial identity and conflicting nonempty BIN cannot borrow employer names",
        async () => {
          const conflicting = await lmsJson(
            await call("/customers", "POST", {
              legalForm: "NONE",
              ownNameRu: "Синтетическая компания с другим БИН",
              ownNameKz: "Синтетикалық басқа БСН компаниясы",
              bin: "999999999999",
              addressRu: "",
              addressKz: "",
            }),
            201,
          );
          const unlinked = source();
          for (const row of unlinked.items) delete row.employerId;
          for (const [label, draft] of [
            ["unlinked partial BIN/address", unlinked],
            [
              "linked employer with conflicting nonempty BIN",
              source(conflicting.id),
            ],
          ] as const) {
            const created = await lmsJson(
              await call("/print-requests", "POST", draft),
              201,
            );
            const result = await lmsJson(
              await call(`/print-requests/${created.id}/validate`, "POST", {
                expectedRevision: created.revision,
              }),
              201,
            );
            assert.equal(result.valid, false, label);
            assert.deepEqual(
              result.issues
                .filter(
                  (issue: { field?: string }) => issue.field === "workplaceRu",
                )
                .map((issue: { path: string }) => issue.path),
              [
                "items.0.workplaceRu",
                "items.1.workplaceRu",
                "items.2.workplaceRu",
              ],
              label,
            );
          }
        },
      );
      await t.test(
        "foreign and missing employer references are rejected before request creation",
        async () => {
          const foreignTenant = await db.tenant.create({
            data: { name: "Synthetic foreign identity", demoOnly: true },
          });
          const foreign = await db.customerOrganization.create({
            data: {
              tenantId: foreignTenant.id,
              nameRu: "Foreign synthetic company",
              nameKz: "Foreign synthetic company",
              bin: "",
              addressRu: "",
              addressKz: "",
            },
          });
          const before = await db.printRequest.count({
            where: { tenantId: seed.tenantId },
          });
          for (const id of [foreign.id, randomUUID()]) {
            const response = await call("/print-requests", "POST", source(id));
            assert.equal(response.status, 404);
            await response.text();
          }
          assert.equal(
            await db.printRequest.count({ where: { tenantId: seed.tenantId } }),
            before,
          );
        },
      );
    } finally {
      await app.close();
      if (oldPort === undefined) delete process.env.PORT;
      else process.env.PORT = oldPort;
      await db.$disconnect();
    }
  },
);

import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { realApprovalRoles } from "./operator-role-fixture";
import { fullSuiteApiCooldown } from "./operator-full-suite";
const evidence = path.resolve(
  (process.env.DEMO_E2E_FULL_CHECKPOINTS === "1"
    ? path.join(process.env.DEMO_E2E_EVIDENCE!, "portal-producer")
    : process.env.DEMO_E2E_EVIDENCE) ||
    "../../docs/evidence/final-completion/portal-three",
);
test.use({ trace: "off" });
async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Электронная почта", { exact: true }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
}
function docxText(bytes: Buffer) {
  let end = bytes.length - 22;
  while (end >= 0 && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("DOCX ZIP directory missing");
  let cursor = bytes.readUInt32LE(end + 16);
  for (let i = 0; i < bytes.readUInt16LE(end + 10); i++) {
    const nameLength = bytes.readUInt16LE(cursor + 28),
      extra = bytes.readUInt16LE(cursor + 30),
      comment = bytes.readUInt16LE(cursor + 32);
    const name = bytes
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString();
    if (name === "word/document.xml") {
      const local = bytes.readUInt32LE(cursor + 42),
        start =
          local +
          30 +
          bytes.readUInt16LE(local + 26) +
          bytes.readUInt16LE(local + 28);
      const compressed = bytes.subarray(
        start,
        start + bytes.readUInt32LE(cursor + 20),
      );
      const xml =
        bytes.readUInt16LE(cursor + 10) === 8
          ? inflateRawSync(compressed)
          : compressed;
      return xml.toString().replace(/<[^>]+>/g, "");
    }
    cursor += 46 + nameLength + extra + comment;
  }
  throw new Error("DOCX main document missing");
}
test("V07 portal: three own people download issued individual files, two foreign people stay denied, repeat reuses clean scoped identities", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(900000);
  await fullSuiteApiCooldown(evidence, "portal-producer-before-ui");
  await context.routeWebSocket("**/_next/webpack-hmr", (socket) =>
    socket.close(),
  );
  await fs.mkdir(evidence, { recursive: true });
  const approvalRoles = await realApprovalRoles(browser, page);
  await approvalRoles.configureSignatories();
  await expect(
    page.getByRole("heading", { name: "Заявки на печать" }),
  ).toBeVisible();
  const csrf = (await context.cookies()).find(
    (c) => c.name === "demo_csrf",
  )!.value;
  const headers = { origin: process.env.DEMO_ORIGIN!, "x-csrf-token": csrf };
  const post = async (
    endpoint: string,
    data: unknown,
    extra: Record<string, string> = {},
  ) => {
    const administrative = ["/users", "/employer-memberships"].includes(
      endpoint,
    );
    const r = await (
      administrative ? approvalRoles.adminPage : page
    ).request.post(`/api${endpoint}`, {
      headers: {
        ...(administrative ? approvalRoles.admin.headers : headers),
        ...extra,
      },
      data,
    });
    expect(r.ok(), await r.text()).toBe(true);
    return r.json();
  };
  const get = async (endpoint: string) => {
    const r = await page.request.get(`/api${endpoint}`);
    expect(r.ok(), await r.text()).toBe(true);
    return r.json();
  };
  const prepare = async () => {
    const suffix = Date.now();
    const a = await post("/customers", {
      nameRu: `V07 свой заказчик ${suffix}`,
    });
    const b = await post("/customers", {
      nameRu: `V07 чужой заказчик ${suffix}`,
    });
    const people = [];
    for (let i = 1; i <= 5; i++)
      people.push(
        await post("/recipients", {
          id: randomUUID(),
          fullNameRu: `${i <= 3 ? "Свой" : "Чужой"} Получатель${i} ${suffix}`,
          fullNameKz: "Әділ Өмір Қанатұлы",
          employerId: i <= 3 ? a.id : b.id,
          positionRu: "Инженер",
          assignments: [],
        }),
      );
    const eventId = randomUUID();
    const draft = {
      schemaVersion: 2,
      kind: "COMPANY",
      title: `V07 смешанная группа ${suffix}`,
      customerId: a.id,
      demoMode: true,
      events: [
        {
          id: eventId,
          title: "V07 фактическая проверка",
          protocolTemplateId: "pb-protocol",
          commonFields: {
            documentDate: "2026-09-24",
            protocolDate: "2026-09-24",
            trainingStart: "2026-09-23",
            trainingEnd: "2026-09-24",
            trainingSubject: "Синтетическая промышленная безопасность",
            hours: "16",
          },
        },
      ],
      items: people.map((person, i) => ({
        id: randomUUID(),
        recipientId: person.id,
        employerId: i < 3 ? a.id : b.id,
        fullNameRu: person.data.fullNameRu,
        fullNameKz: "Әділ Өмір Қанатұлы",
        positionRu: "Инженер",
        assignments: [
          {
            id: randomUUID(),
            templateId: "pb-card",
            eventId,
            protocolMode: "GROUP",
            result: "Сдал",
            outcome: {
              status: "PASSED",
              source: "Синтетическая подписанная ведомость V07",
            },
          },
        ],
      })),
    };
    const request = await post("/print-requests", draft);
    const order = await post("/orders", {
      title: `V07 собственные документы ${suffix}`,
      customerId: a.id,
      requestIds: [request.id],
      contact: `INTERNAL_A_NOTE_${suffix}`,
    });
    const foreignOrder = await post("/orders", {
      title: `FOREIGN_ORDER_${suffix}`,
      customerId: b.id,
      requestIds: [request.id],
      contact: `INTERNAL_B_NOTE_${suffix}`,
    });
    const validation = await post(`/print-requests/${request.id}/validate`, {
      expectedRevision: request.revision,
    });
    expect(validation.issues).toEqual([]);
    await approvalRoles.approve(request.id);
    const approved = await get(`/print-requests/${request.id}`);
    await post(
      `/print-requests/${request.id}/finalize`,
      { expectedRevision: approved.revision },
      { "idempotency-key": randomUUID() },
    );
    await fs.writeFile(
      path.join(evidence, "running-fixture.json"),
      JSON.stringify(
        {
          requestId: request.id,
          orderId: order.id,
          people: 5,
          own: 3,
          foreign: 2,
        },
        null,
        2,
      ),
    );
    return { suffix, a, b, people, draft, request, order, foreignOrder };
  };
  const loadFixture = async () => {
    const prior = JSON.parse(
      await fs.readFile(
        path.resolve(process.env.DEMO_E2E_PORTAL_FIXTURE!),
        "utf8",
      ),
    );
    const request = await get(`/print-requests/${prior.requestId}`);
    const draft = request.draft as Awaited<ReturnType<typeof prepare>>["draft"];
    const suffix = Number(request.title.split(" ").at(-1));
    const order = await get(`/orders/${prior.orderId}`);
    const foreignOrder = (await get("/orders")).items.find(
      (entry: { title: string }) => entry.title === `FOREIGN_ORDER_${suffix}`,
    );
    expect(foreignOrder).toBeTruthy();
    expect(request.status).toBe("FINALIZED");
    expect(draft.items).toHaveLength(5);
    return {
      suffix,
      a: { id: draft.customerId },
      b: { id: draft.items[3].employerId },
      people: draft.items.map((row) => ({ id: row.recipientId, data: row })),
      draft,
      request,
      order,
      foreignOrder,
    };
  };
  const { suffix, a, b, people, draft, request, order, foreignOrder } = process
    .env.DEMO_E2E_PORTAL_FIXTURE
    ? await loadFixture()
    : await prepare();
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `/api/print-requests/${request.id}`,
        );
        if (!response.ok()) return -1;
        const r = await response.json();
        const rowDocuments = new Set(
          r.documents
            .filter((d: { rowId?: string }) => d.rowId)
            .map((d: { id: string }) => d.id),
        );
        return r.artifacts.filter(
          (artifact: {
            format: string;
            documentId: string;
            issuanceId?: string;
          }) =>
            artifact.format === "DOCX" &&
            artifact.issuanceId &&
            rowDocuments.has(artifact.documentId),
        ).length;
      },
      {
        timeout: 720000,
        intervals: [1500, 3000, 5000],
        message: "Five real issued individual DOCX files from worker",
      },
    )
    .toBe(5);
  const issued = await get(`/print-requests/${request.id}`);
  if (!process.env.DEMO_E2E_PORTAL_FRESH_SOURCE)
    throw new Error("Explicit fresh portal checkpoint destination required");
  await fs.writeFile(
    path.resolve(process.env.DEMO_E2E_PORTAL_FRESH_SOURCE),
    JSON.stringify(
      {
        status: "PREPARED",
        fullRunId: process.env.DEMO_E2E_FULL_RUN_ID || null,
        requestId: request.id,
        orderId: order.id,
        tenantId: approvalRoles.operator.session.tenant.id,
        source: "actual fresh real-role browser preparation",
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  const oldNumbers = issued.documents.map(
    (d: { id: string; number: string }) => ({ id: d.id, number: d.number }),
  );
  const oldSnapshot = JSON.stringify(issued.issuances[0].snapshot);
  const ownRows = new Set<string>(draft.items.slice(0, 3).map((row) => row.id));
  const ownDocIds = new Set(
    issued.documents
      .filter((d: { rowId: string }) => ownRows.has(d.rowId))
      .map((d: { id: string }) => d.id),
  );
  const ownFiles = issued.artifacts.filter(
    (artifact: { format: string; documentId: string }) =>
      artifact.format === "DOCX" && ownDocIds.has(artifact.documentId),
  );
  const denied = issued.artifacts.filter(
    (artifact: { documentId: string }) =>
      artifact.documentId && !ownDocIds.has(artifact.documentId),
  );
  expect(ownFiles).toHaveLength(3);
  expect(denied.length).toBeGreaterThanOrEqual(2);
  const email = `v07-employer-${suffix}-${randomUUID()}@example.test`,
    password = `Synthetic-${randomUUID()}!`;
  const user = await post("/users", {
    email,
    password,
    displayName: "Представитель V07",
    role: "EMPLOYER",
  });
  await post("/employer-memberships", {
    userId: user.id,
    customerId: a.id,
    permissions: ["READ", "DOWNLOAD", "PROPOSE"],
    recipientIds: people.slice(0, 3).map((person) => person.id),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  const ec = await browser.newContext({ baseURL: process.env.DEMO_ORIGIN });
  try {
    await ec.routeWebSocket("**/_next/webpack-hmr", (socket) => socket.close());
    const employer = await ec.newPage();
    await login(employer, email, password);
    await expect(
      employer.getByRole("heading", { name: "Кабинет заказчика" }),
    ).toBeVisible();
    const projection = await (await employer.request.get("/api/portal")).json();
    expect(projection.orders).toHaveLength(1);
    expect(
      projection.orders[0].requests[0].rows.map(
        (row: { id: string }) => row.id,
      ),
    ).toEqual(draft.items.slice(0, 3).map((row) => row.id));
    const serialized = JSON.stringify(projection);
    for (const forbidden of [
      people[3].data.fullNameRu,
      people[4].data.fullNameRu,
      `INTERNAL_A_NOTE_${suffix}`,
      `INTERNAL_B_NOTE_${suffix}`,
      foreignOrder.title,
    ]) {
      expect(serialized).not.toContain(forbidden);
      await expect(employer.getByText(forbidden, { exact: true })).toHaveCount(
        0,
      );
    }
    const downloaded = [];
    for (const artifact of ownFiles) {
      const link = employer.locator(
        `a[href="/api/portal/artifacts/${artifact.id}"]`,
      );
      await expect(link).toBeVisible();
      const download = employer.waitForEvent("download");
      await link.click();
      const target = path.join(evidence, `own-${downloaded.length + 1}.docx`);
      await (await download).saveAs(target);
      const bytes = await fs.readFile(target);
      expect(bytes.subarray(0, 2).toString()).toBe("PK");
      const actualText = docxText(bytes);
      expect(
        people
          .slice(0, 3)
          .some((person) => actualText.includes(person.data.fullNameRu)),
      ).toBe(true);
      for (const person of people.slice(3))
        expect(actualText).not.toContain(person.data.fullNameRu);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        artifact.sha256,
      );
      downloaded.push({
        artifactId: artifact.id,
        sha256: artifact.sha256,
        file: path.basename(target),
      });
    }
    for (const artifact of denied) {
      expect([403, 404]).toContain(
        (
          await employer.request.get(`/api/portal/artifacts/${artifact.id}`)
        ).status(),
      );
      await expect(
        employer.locator(`a[href="/api/portal/artifacts/${artifact.id}"]`),
      ).toHaveCount(0);
    }
    for (const endpoint of [
      `/orders/${foreignOrder.id}`,
      `/print-requests/${request.id}`,
      `/recipients/${people[3].id}`,
      "/staff-directory",
    ])
      expect([403, 404]).toContain(
        (await employer.request.get(`/api${endpoint}`)).status(),
      );
    expect(
      (
        await employer.request.get(`/api/portal/evidence?customerId=${b.id}`)
      ).status(),
    ).toBe(404);
    const ecsrf = (await ec.cookies()).find(
      (cookie) => cookie.name === "demo_csrf",
    )!.value;
    const eh = { origin: process.env.DEMO_ORIGIN!, "x-csrf-token": ecsrf };
    const forbidden = await employer.request.post(
      `/api/portal/orders/${order.id}/proposals`,
      {
        headers: eh,
        data: {
          requestId: request.id,
          requestRevision: 1,
          kind: "UPDATE_LIST",
          message: "Attempt unsupported result mutation",
          changes: [
            {
              rowId: draft.items[0].id,
              outcome: { status: "PASSED", source: "forged" },
              number: "FORGED",
            },
          ],
        },
      },
    );
    expect([400, 403]).toContain(forbidden.status());
    await employer
      .getByRole("button", { name: new RegExp(request.title) })
      .click();
    await expect(
      employer.getByRole("textbox", { name: /^ФИО RU, получатель/ }),
    ).toHaveCount(3);
    for (let i = 0; i < 3; i++)
      await expect(
        employer.getByRole("textbox", {
          name: `ФИО RU, получатель ${i + 1}`,
          exact: true,
        }),
      ).toHaveValue(people[i].data.fullNameRu);
    await expect(
      employer.getByLabel(
        /Исход проверки|Регистрационный номер|Фактический результат/,
        { exact: true },
      ),
    ).toHaveCount(0);
    await employer.screenshot({
      path: path.join(evidence, "three-own-people-and-issued-files.png"),
      fullPage: true,
    });
    const repeatMessage =
      "Повторно для тех же трёх сотрудников по сохранённому составу; фактические даты и результаты уточнит центр";
    await employer
      .getByLabel("Сообщение учебному центру", { exact: true })
      .fill(repeatMessage);
    const submitted = employer.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/portal/orders/${order.id}/proposals`) &&
        r.request().method() === "POST",
    );
    await employer
      .getByRole("button", { name: "Запросить повторную заявку", exact: true })
      .click();
    expect((await submitted).ok()).toBe(true);
    await expect(
      employer.getByText(/Ответ передан учебному центру/),
    ).toBeVisible();
    await page.goto("/workbench");
    await page.getByRole("button", { name: order.title, exact: true }).click();
    const proposal = page
      .locator("article.milestone")
      .filter({ hasText: repeatMessage });
    await proposal
      .getByLabel("Решение центра и основание", { exact: true })
      .fill("Согласован новый черновик по трём существующим получателям V07");
    const resolved = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/orders/${order.id}/proposals/`) &&
        r.url().endsWith("/resolve") &&
        r.request().method() === "POST",
    );
    await proposal
      .getByRole("button", {
        name: "Принять и применить согласованные изменения",
        exact: true,
      })
      .click();
    const resolvedResponse = await resolved;
    expect(resolvedResponse.ok(), await resolvedResponse.text()).toBe(true);
    const resolution = await resolvedResponse.json();
    const repeated = await get(`/print-requests/${resolution.newRequestId}`);
    expect(repeated.status).toBe("DRAFT");
    expect(repeated.draft.items).toHaveLength(3);
    expect(
      repeated.draft.items.map(
        (row: { recipientId: string }) => row.recipientId,
      ),
    ).toEqual(people.slice(0, 3).map((person) => person.id));
    expect(repeated.documents).toHaveLength(0);
    expect(repeated.issuances).toHaveLength(0);
    for (const row of repeated.draft.items)
      for (const assignment of row.assignments) {
        expect(assignment.result).toBe("");
        expect(assignment.documentDate).toBe("");
        expect(assignment.trainingStart).toBe("");
        expect(assignment.trainingEnd).toBe("");
        expect(assignment.outcome?.status || "UNKNOWN").toBe("UNKNOWN");
      }
    const unchanged = await get(`/print-requests/${request.id}`);
    expect(JSON.stringify(unchanged.issuances[0].snapshot)).toBe(oldSnapshot);
    expect(
      unchanged.documents.map((d: { id: string; number: string }) => ({
        id: d.id,
        number: d.number,
      })),
    ).toEqual(oldNumbers);
    await employer.reload();
    await expect(
      employer.getByRole("heading", { name: repeated.title, exact: true }),
    ).toBeVisible();
    await employer.setViewportSize({ width: 375, height: 812 });
    expect(
      await employer.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await employer.screenshot({
      path: path.join(evidence, "repeat-existing-three-mobile.png"),
      fullPage: true,
    });
    await fs.writeFile(
      path.join(evidence, "summary.json"),
      JSON.stringify(
        {
          status: "PASS",
          scenario: "V07",
          realApi: true,
          ownPeople: 3,
          foreignPeople: 2,
          ownIndividualDownloads: downloaded,
          downloadedFormat: "DOCX",
          deniedForeignOrMixedArtifactCount: denied.length,
          foreignRowsNotesOrdersApiDenied: true,
          staffDirectoryDenied: true,
          noEmployerOutcomeOrNumberControl: true,
          repeatSubmittedWithoutRetypingPeople: true,
          repeatAcceptedByCenterUi: true,
          newRequestId: repeated.id,
          repeatedPeople: 3,
          existingRecipientIdsPreserved: true,
          oldSnapshotAndNumbersUnchanged: true,
          newResultsDatesNumbersEmpty: true,
          mobile375: true,
          requestId: request.id,
          orderId: order.id,
        },
        null,
        2,
      ),
    );
    await fs.writeFile(
      path.resolve(process.env.DEMO_E2E_PORTAL_FRESH_SOURCE),
      JSON.stringify(
        {
          status: "PASS",
          fullRunId: process.env.DEMO_E2E_FULL_RUN_ID || null,
          requestId: request.id,
          orderId: order.id,
          tenantId: approvalRoles.operator.session.tenant.id,
          source:
            "actual fresh real-role browser preparation and portal journey",
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } finally {
    await ec.close();
    await approvalRoles.close();
  }
});

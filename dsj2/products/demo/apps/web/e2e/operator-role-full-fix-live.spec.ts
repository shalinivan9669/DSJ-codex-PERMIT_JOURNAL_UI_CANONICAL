import { test, expect, type Page } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { draftSchema } from "@demo/contracts";
import type { Draft, Artifact, Job } from "../lib/types";
import { loginRole, write } from "./operator-role-fixture";
import { fullSuitePageApiCooldown } from "./operator-full-suite";

test.use({ trace: "off" });
type Detail = Draft & {
  documents: Array<{ id: string; number: string; templateId: string }>;
  artifacts: Artifact[];
};
async function read(page: Page, id: string) {
  const response = await page.request.get(`/api/print-requests/${id}`);
  expect(response.ok()).toBe(true);
  return response.json() as Promise<Detail>;
}
async function expand(page: Page) {
  const details = page.locator("#request-training");
  if (
    !(await details.evaluate((element) => (element as HTMLDetailsElement).open))
  )
    await details.locator(":scope > summary").click();
  return page.locator(".training-primary-context");
}
async function numbering(page: Page) {
  const response = await page.request.get("/api/settings/numbering");
  expect(response.ok()).toBe(true);
  return response.json();
}

test("real operator preparation, director return/correction/new approval, renderer and immutable bytes retain unsigned official guards", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(420000);
  await fullSuitePageApiCooldown(
    page,
    testInfo.outputDir,
    "before-real-role-cycle",
  );
  const operator = await loginRole(page, "OPERATOR"),
    baseURL = new URL(page.url()).origin;
  const adminContext = await browser.newContext({ baseURL }),
    directorContext = await browser.newContext({ baseURL });
  const adminPage = await adminContext.newPage(),
    directorPage = await directorContext.newPage();
  try {
    const admin = await loginRole(adminPage, "ADMIN"),
      director = await loginRole(directorPage, "DIRECTOR");
    expect(admin.session.tenant.id).toBe(operator.session.tenant.id);
    expect(director.session.tenant.id).toBe(operator.session.tenant.id);
    const commission = [
      {
        userId: operator.session.user.id,
        name: operator.session.user.displayName,
      },
    ];
    for (let index = 1; index < 3; index++) {
      const account = await write(adminPage, admin.headers, "/users", {
        email: `role-commission-${randomUUID()}@example.test`,
        password: `Synthetic-${randomUUID()}!`,
        displayName: `Тестов Член ${index} ${randomUUID().slice(0, 4)}`,
        role: "OPERATOR",
      });
      commission.push({ userId: account.id, name: account.displayName });
    }
    await write(adminPage, admin.headers, "/settings/signatories", {
      userId: director.session.user.id,
      displayName: director.session.user.displayName,
      role: "DIRECTOR",
      iin: "000000000001",
    });
    for (const [index, member] of commission.entries())
      await write(adminPage, admin.headers, "/settings/signatories", {
        userId: member.userId,
        displayName: member.name,
        role: index ? "MEMBER" : "CHAIR",
        iin: `00000000000${index + 2}`,
      });
    const profileResponse = await adminPage.request.get(
        "/api/settings/profile",
      ),
      profile = await profileResponse.json();
    delete profile.id;
    delete profile.version;
    await write(adminPage, admin.headers, "/settings/profile", {
      ...profile,
      nameRu: "Тест Центр",
      nameKz: "Тест Центр",
      headName: director.session.user.displayName,
      commission: commission.map((member, index) => ({
        name: member.name,
        position: index ? "Член комиссии" : "Председатель",
      })),
    });
    const customer = await write(adminPage, admin.headers, "/customers", {
      nameRu: "Тест Альфа",
      nameKz: "Тест Альфа",
      bin: "000000000011",
    });
    const eventId = randomUUID();
    const input = draftSchema.parse({
      kind: "COMPANY",
      customerId: customer.id,
      schemaVersion: 2,
      demoMode: true,
      title: `СИНТЕТИЧЕСКИЙ role цикл ${Date.now()}`,
      commonFields: { documentDate: "2026-10-03" },
      events: [
        {
          id: eventId,
          title: "Синтетическая role группа ПБ",
          protocolTemplateId: "pb-protocol",
          protocolMode: "GROUP",
          commonFields: {
            documentDate: "2026-10-03",
            protocolDate: "2026-10-02",
            trainingStart: "2026-10-01",
            trainingEnd: "2026-10-02",
            trainingSubject: "Тестовая программа ПБ",
          },
        },
      ],
      items: [1, 2].map((index) => ({
        id: randomUUID(),
        fullNameRu: `Тестов Иван ${index}`,
        positionRu: "Инженер",
        employeeCategory: "WORKER",
        assignments: [
          {
            id: randomUUID(),
            eventId,
            templateId: "pb-card",
            protocolMode: "GROUP",
            outcome: { status: "UNKNOWN", source: "" },
          },
        ],
      })),
    });
    const created = await write(
        page,
        operator.headers,
        "/print-requests",
        input,
      ),
      id = created.id as string;
    await page.goto(`/requests/${id}/edit`);
    const initial = await read(page, id);
    expect(
      initial.items.every((item) =>
        item.assignments.every(
          (assignment) => assignment.outcome?.status === "UNKNOWN",
        ),
      ),
    ).toBe(true);
    const training = await expand(page);
    await training
      .getByLabel("Известный результат", { exact: true })
      .selectOption("PASSED");
    const factualSource =
      "СИНТЕТИЧЕСКАЯ известная ведомость role UI; не реальное обучение";
    await training
      .getByLabel("Источник подтверждения", { exact: true })
      .fill(factualSource);
    await expect(
      training.getByRole("button", {
        name: "Проверить применение результатов",
        exact: true,
      }),
    ).toBeEnabled();
    expect(
      (await read(page, id)).items.every((item) =>
        item.assignments.every(
          (assignment) => assignment.outcome?.status === "UNKNOWN",
        ),
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("operator-result-prepared-unapplied.png"),
      fullPage: true,
    });
    await training
      .getByRole("button", {
        name: "Проверить применение результатов",
        exact: true,
      })
      .click();
    await training
      .getByRole("button", { name: "Подтвердить результаты", exact: true })
      .click();
    await expect
      .poll(async () =>
        (await read(page, id)).items.every((item) =>
          item.assignments.every(
            (assignment) =>
              assignment.outcome?.status === "PASSED" &&
              assignment.outcome.confirmedBy === operator.session.user.id,
          ),
        ),
      )
      .toBe(true);
    await page
      .getByLabel(/Все подтверждённые ещё не оформленные курсы/)
      .check();
    await page
      .getByRole("button", { name: /Проверить и передать директору/ })
      .click();
    await expect
      .poll(async () => (await read(page, id)).approval?.status)
      .toBe("PENDING");
    const applied = await read(page, id);
    expect(applied.documents).toHaveLength(0);
    const rejectedProposal = applied.approval!;
    await directorPage.goto(
      `/approvals?proposal=${rejectedProposal.proposalId}`,
    );
    const reason =
      "СИНТЕТИЧЕСКОЕ замечание директора: уточните должность первого участника";
    await directorPage
      .getByLabel("Комментарий к решению", { exact: true })
      .fill(reason);
    await directorPage
      .getByRole("button", { name: "Вернуть на доработку", exact: true })
      .click();
    await expect
      .poll(async () => (await read(page, id)).approval?.status)
      .toBe("REJECTED");
    await page.reload();
    await expect(page.getByText(reason, { exact: false })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("operator-director-return-reason.png"),
      fullPage: true,
    });
    await page
      .getByLabel("Должность · RU, строка 1", { exact: true })
      .fill("Мастер");
    await expect
      .poll(async () => (await read(page, id)).items[0].positionRu)
      .toBe("Мастер");
    expect((await read(page, id)).approval?.status).toBe("DRAFT");
    await page
      .getByLabel(/Все подтверждённые ещё не оформленные курсы/)
      .check();
    await page
      .getByRole("button", { name: /Проверить и передать директору/ })
      .click();
    await expect
      .poll(async () => (await read(page, id)).approval?.status)
      .toBe("PENDING");
    const corrected = await read(page, id);
    expect(corrected.approval?.status).toBe("PENDING");
    expect(corrected.revision).toBeGreaterThan(applied.revision);
    const stale = await directorPage.request.post(
      `/api/approvals/${rejectedProposal.proposalId}/decision`,
      {
        headers: director.headers,
        data: {
          decision: "APPROVE",
          reason: "Синтетическая попытка старого решения",
          expectedProposalHash: rejectedProposal.proposalHash,
        },
      },
    );
    expect(stale.status()).toBe(409);
    expect((await stale.json()).code).toBe("APPROVAL_STALE");
    const beforeNumbers = await numbering(page);
    await page
      .getByRole("button", { name: "Проверить данные", exact: true })
      .click();
    await expect(
      page.getByText("Данные прошли проверку", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Посмотреть документы", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await read(page, id)).artifacts.some(
            (artifact) =>
              artifact.provenance === "PREVIEW" && artifact.format === "PDF",
          ),
        { timeout: 210000, intervals: [1000, 2500] },
      )
      .toBe(true);
    expect(await numbering(page)).toEqual(beforeNumbers);
    expect((await read(page, id)).documents).toHaveLength(0);
    await directorPage.goto(
      `/approvals?proposal=${corrected.approval!.proposalId}`,
    );
    await directorPage
      .getByLabel("Комментарий к решению", { exact: true })
      .fill("Синтетическая проверка актуальной исправленной редакции");
    await directorPage
      .getByRole("button", { name: "Согласовать эту редакцию", exact: true })
      .click();
    await expect
      .poll(async () => (await read(page, id)).approval?.status)
      .toBe("APPROVED");
    await directorPage.screenshot({
      path: testInfo.outputPath("director-new-revision-approved.png"),
      fullPage: true,
    });
    await page.reload();
    await page
      .getByRole("button", { name: "Сформировать документы", exact: true })
      .click();
    await expect
      .poll(async () => (await read(page, id)).status)
      .toBe("FINALIZED");
    await expect
      .poll(
        async () => {
          const response = await page.request.get(`/api/jobs?requestId=${id}`);
          expect(response.ok()).toBe(true);
          const jobs = (await response.json()).items as Job[];
          const originals = jobs.filter((job) => job.issuanceId);
          return (
            originals.length > 0 &&
            originals.every(
              (job) => job.status === "SUCCEEDED" && !!job.artifactId,
            )
          );
        },
        { timeout: 210000, intervals: [1000, 2500] },
      )
      .toBe(true);
    const issued = await read(page, id),
      files = issued.artifacts.filter(
        (artifact) =>
          artifact.issuanceId &&
          ["PDF", "DOCX"].includes(artifact.format || ""),
      );
    expect(issued.documents).toHaveLength(3);
    expect(files).toHaveLength(6);
    const hashes: Array<{
      id: string;
      format: string;
      sha256: string;
      size: number;
    }> = [];
    for (const artifact of files) {
      const response = await page.request.get(`/api/artifacts/${artifact.id}`);
      expect(response.ok(), await response.text()).toBe(true);
      const bytes = await response.body(),
        sha256 = createHash("sha256").update(bytes).digest("hex");
      expect(sha256).toBe(artifact.sha256);
      await fs.writeFile(
        testInfo.outputPath(
          `original-${artifact.id}.${artifact.format!.toLowerCase()}`,
        ),
        bytes,
      );
      hashes.push({
        id: artifact.id,
        format: artifact.format!,
        sha256,
        size: bytes.length,
      });
    }
    await write(
      adminPage,
      admin.headers,
      `/customers/${customer.id}`,
      {
        nameRu: "СИНТЕТИЧЕСКАЯ компания изменена после выпуска",
        nameKz: "Кейін өзгертілген синтетикалық компания",
        bin: "000000000011",
      },
      "PATCH",
    );
    for (const artifact of hashes) {
      const response = await page.request.get(`/api/artifacts/${artifact.id}`);
      expect(response.ok()).toBe(true);
      expect(
        createHash("sha256")
          .update(await response.body())
          .digest("hex"),
      ).toBe(artifact.sha256);
    }
    const signingResponse = await page.request.get(
        `/api/print-requests/${id}/signing`,
      ),
      signing = await signingResponse.json();
    expect(signing.status).toBe("AWAITING_SIGNATURE");
    expect(signing.archived).toBe(false);
    const denied = await page.request.post(`/api/print-requests/${id}/export`, {
      headers: operator.headers,
      data: { format: "ZIP" },
    });
    expect(denied.status()).toBe(409);
    expect((await denied.json()).code).toBe("ISSUANCE_NOT_COMPLETE");
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      (await read(page, id)).organizationSnapshots?.find(
        (company) => company.id === customer.id,
      )?.nameRu,
    ).toBe(customer.nameRu);
    await page.screenshot({
      path: testInfo.outputPath("rendered-unsigned-complete-files.png"),
      fullPage: true,
    });
    const report = {
      capturedAt: new Date().toISOString(),
      requestId: id,
      roles: ["ADMIN", "OPERATOR", "DIRECTOR"],
      initialOutcomes: "UNKNOWN",
      explicitOperatorConfirmation: true,
      source: factualSource,
      rejection: { proposalId: rejectedProposal.proposalId, reason },
      correctedRevision: corrected.revision,
      approvedProposalId: corrected.approval!.proposalId,
      staleApprovalCode: "APPROVAL_STALE",
      previewNumbersUnchanged: true,
      documentCount: issued.documents.length,
      documents: issued.documents,
      artifactHashes: hashes,
      hashesUnchangedAfterDirectoryEdit: true,
      signingStatus: signing.status,
      officialZipDenied: "ISSUANCE_NOT_COMPLETE",
      ncaSignatureVerified: false,
      legalApproval: false,
    };
    const destination = path.resolve(
      process.env.DEMO_E2E_EVIDENCE ||
        "../../docs/evidence/operator-flow-full-fix-20261003/domain/lifecycle",
    );
    await fs.mkdir(destination, { recursive: true });
    await fs.writeFile(
      path.join(destination, "role-lifecycle-readback.json"),
      JSON.stringify(report, null, 2),
    );
  } finally {
    await directorContext.close();
    await adminContext.close();
  }
});

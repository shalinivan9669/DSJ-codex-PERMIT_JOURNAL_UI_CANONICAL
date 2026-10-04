import { expect, type Page, type Browser } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Draft, Artifact, Job } from "../lib/types";
import { draftSchema } from "@demo/contracts";

type Role = "ADMIN" | "OPERATOR" | "DIRECTOR";
type Session = {
  user: { id: string; displayName: string; role: Role };
  tenant: { id: string; demoOnly: boolean };
  csrfToken: string;
};
export async function loginRole(page: Page, role: Role) {
  expect(process.env.DEMO_E2E_ISOLATED_TENANT).toBe("1");
  const email = process.env[`DEMO_${role}_EMAIL`],
    password = process.env[`DEMO_${role}_PASSWORD`];
  if (!email || !password)
    throw new Error(`PRIVATE_${role}_CREDENTIALS_REQUIRED`);
  const cache = path.resolve(
    __dirname,
    `../../../.runtime/operator-flow-full-fix/role-${role.toLowerCase()}-session.private.json`,
  );
  try {
    const stored = JSON.parse(await fs.readFile(cache, "utf8"));
    if (
      stored.email === email &&
      stored.origin === process.env.DEMO_ORIGIN &&
      stored.cookies?.some(
        (cookie: { name: string; expires: number }) =>
          cookie.name === "demo_session" &&
          cookie.expires * 1000 - Date.now() >= 2 * 3600_000,
      )
    )
      await page.context().addCookies(stored.cookies);
  } catch {
    /* Initial local role sessions use the actual login form. */
  }
  await page.goto("/requests");
  const requestsHeading = page.getByRole("heading", {
    name: "Заявки на печать",
    exact: true,
  });
  const loginHeading = page.getByRole("heading", {
    name: "Войти в DEMO",
    exact: true,
  });
  await expect(requestsHeading.or(loginHeading)).toBeVisible();
  if (await loginHeading.isVisible()) {
    await page.goto("/login");
    await page.getByLabel("Электронная почта", { exact: true }).fill(email);
    await page.getByLabel("Пароль", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    try {
      await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
      await page.goto("/requests");
      await expect(
        page.getByRole("heading", { name: "Заявки на печать", exact: true }),
      ).toBeVisible();
    } catch (error) {
      const passwordInput = page.getByLabel("Пароль", { exact: true });
      if (await passwordInput.isVisible()) await passwordInput.fill("");
      throw error;
    }
  }
  const response = await page.request.get("/api/auth/session"),
    session = (await response.json()) as Session;
  expect(session.tenant.demoOnly).toBe(true);
  expect(session.user.role).toBe(role);
  await fs.mkdir(path.dirname(cache), { recursive: true });
  await fs.writeFile(
    cache,
    JSON.stringify({
      email,
      origin: new URL(page.url()).origin,
      cookies: await page.context().cookies(),
    }),
  );
  return {
    session,
    headers: {
      origin: new URL(page.url()).origin,
      "x-csrf-token": session.csrfToken,
    },
  };
}
export async function write(
  page: Page,
  headers: Record<string, string>,
  url: string,
  data: unknown,
  method: "POST" | "PATCH" = "POST",
) {
  const response = await page.request.fetch(`/api${url}`, {
    method,
    headers,
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

/** Actual isolated roles, signatory bindings and public director decisions.
 * No direct database approval or signature state is part of this fixture.
 */
export async function realApprovalRoles(browser: Browser, page: Page) {
  const operator = await loginRole(page, "OPERATOR");
  const baseURL = new URL(page.url()).origin;
  const adminContext = await browser.newContext({ baseURL });
  const directorContext = await browser.newContext({ baseURL });
  const adminPage = await adminContext.newPage();
  const directorPage = await directorContext.newPage();
  const admin = await loginRole(adminPage, "ADMIN");
  const director = await loginRole(directorPage, "DIRECTOR");
  expect(admin.session.tenant.id).toBe(operator.session.tenant.id);
  expect(director.session.tenant.id).toBe(operator.session.tenant.id);
  return {
    operator,
    admin,
    director,
    adminPage,
    directorPage,
    async configureSignatories() {
      const response = await adminPage.request.get("/api/settings/profile");
      expect(response.ok()).toBe(true);
      const profile = await response.json();
      delete profile.id;
      delete profile.version;
      const commission =
        profile.commission?.length === 3
          ? profile.commission
          : [0, 1, 2].map((index) => ({
              name: `Синтетический проверенный член ${index + 1}`,
              position: index ? "Член комиссии" : "Председатель",
            }));
      const headName = profile.headName || director.session.user.displayName;
      await write(adminPage, admin.headers, "/settings/signatories", {
        userId: director.session.user.id,
        displayName: headName,
        role: "DIRECTOR",
        iin: "000000000001",
      });
      const bindings = (await (
        await adminPage.request.get("/api/settings/signatories")
      ).json()) as {
        items: Array<{ active: boolean; role: string; displayName: string }>;
      };
      for (const [index, member] of commission.entries()) {
        const matched = bindings.items.filter(
          (binding) =>
            binding.active &&
            binding.role === (index ? "MEMBER" : "CHAIR") &&
            binding.displayName.trim() === member.name.trim(),
        );
        expect(
          matched.length,
          "Synthetic fixture uses one actual active signer per commission slot",
        ).toBeLessThanOrEqual(1);
        if (matched.length === 1) continue;
        const user = await write(adminPage, admin.headers, "/users", {
          email: `real-ui-fixture-${randomUUID()}@example.test`,
          password: `Synthetic-${randomUUID()}!`,
          displayName: member.name,
          role: "OPERATOR",
        });
        await write(adminPage, admin.headers, "/settings/signatories", {
          userId: user.id,
          displayName: member.name,
          role: index ? "MEMBER" : "CHAIR",
          iin: `00000000000${index + 2}`,
        });
      }
      await write(adminPage, admin.headers, "/settings/profile", {
        ...profile,
        commission,
        headName,
        bin: profile.bin || "000000000101",
        approved: true,
      });
    },
    async approve(id: string) {
      const before = (await (
        await page.request.get(`/api/print-requests/${id}`)
      ).json()) as Draft;
      expect(before.approval?.status).toBe("PENDING");
      await directorPage.goto(
        `/approvals?proposal=${before.approval!.proposalId}`,
      );
      await directorPage
        .getByLabel("Комментарий к решению", { exact: true })
        .fill(
          "СИНТЕТИЧЕСКАЯ проверка текущей редакции для локального browser regression",
        );
      const decided = directorPage.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response
            .url()
            .endsWith(`/approvals/${before.approval!.proposalId}/decision`),
      );
      await directorPage
        .getByRole("button", { name: "Согласовать эту редакцию", exact: true })
        .click();
      const decision = await decided;
      expect(decision.status(), await decision.text()).toBe(201);
      await expect
        .poll(
          async () =>
            (await (await page.request.get(`/api/print-requests/${id}`)).json())
              .approval?.status,
        )
        .toBe("APPROVED");
    },
    async close() {
      await adminContext.close();
      await directorContext.close();
    },
  };
}

export function knownPrintInput(
  count = 1,
  options: {
    kind?: "PERSON" | "COMPANY";
    customerId?: string;
    extraSix?: boolean;
    title?: string;
  } = {},
) {
  return draftSchema.parse({
    kind: options.kind || "PERSON",
    customerId: options.customerId,
    schemaVersion: 2,
    demoMode: true,
    title: options.title || `СИНТЕТИЧЕСКИЙ проверенный комплект ${Date.now()}`,
    commonFields: { documentDate: "2026-10-03" },
    items: Array.from({ length: count }, (_, index) => ({
      id: randomUUID(),
      employeeCategory: "WORKER",
      fullNameRu: `Синтетический Получатель ${String(index + 1).padStart(3, "0")}`,
      fullNameKz: `Синтетикалық Қабылдаушы ${String(index + 1).padStart(3, "0")}`,
      positionRu: `Инженер ${index + 1}`,
      positionKz: `Маман ${index + 1}`,
      workplaceRu:
        options.kind === "COMPANY" ? "" : "Синтетическое предприятие",
      assignments: [
        "pb-card",
        ...(options.extraSix && index < 6
          ? [index === 0 ? "ps-witness" : "ptm-card"]
          : []),
      ].map((templateId) => ({
        id: randomUUID(),
        templateId,
        protocolMode: "INDIVIDUAL",
        documentDate: "2026-10-03",
        protocolDate: "2026-10-02",
        trainingStart: "2026-10-01",
        trainingEnd: "2026-10-02",
        trainingSubject: `Синтетическая программа ${templateId} ${index + 1}`,
        result: "Сдал / Тапсырды (ТЕСТ)",
        outcome: {
          status: "PASSED",
          source:
            "СИНТЕТИЧЕСКАЯ известная ведомость browser fixture; не реальное обучение",
        },
      })),
    })),
  });
}

export async function readPrintDetail(page: Page, id: string) {
  const response = await page.request.get(`/api/print-requests/${id}`);
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as Draft & {
    documents: Array<{
      id: string;
      templateId: string;
      number: string;
      rowId: string | null;
    }>;
    artifacts: Artifact[];
    issuances: Array<{ id: string; snapshot: { draft: Draft } }>;
  };
}

export async function waitOriginalJobs(
  page: Page,
  id: string,
  timeout = 300000,
) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const response = await page.request.get(`/api/jobs?requestId=${id}`);
    expect(response.ok()).toBe(true);
    const originals = ((await response.json()).items as Job[]).filter(
      (job) => job.issuanceId,
    );
    const failed = originals.filter((job) => job.status === "FAILED");
    if (failed.length)
      throw new Error(
        `ORIGINAL_RENDER_FAILED:${JSON.stringify(failed.map((job) => ({ id: job.id, kind: job.kind, code: job.errorCode })))}`,
      );
    if (
      originals.length &&
      originals.every((job) => job.status === "SUCCEEDED" && !!job.artifactId)
    )
      return;
    if (Date.now() >= deadline)
      throw new Error(
        `ORIGINAL_RENDER_TIMEOUT:${JSON.stringify(originals.map((job) => ({ id: job.id, kind: job.kind, status: job.status })))}`,
      );
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
}

export async function assertUnsignedDelivery(
  page: Page,
  id: string,
  headers: Record<string, string>,
) {
  const blocked = await page.request.post(`/api/print-requests/${id}/export`, {
    headers,
    data: { format: "ZIP" },
  });
  expect(blocked.status()).toBe(409);
  expect((await blocked.json()).code).toBe("ISSUANCE_NOT_COMPLETE");
}

import { test, expect, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const product = path.resolve(__dirname, "../../..");
const runtime = path.join(product, ".runtime/mvp-all-roles-20261019/run-01");
const output = path.join(
  product,
  "docs/evidence/mvp-all-roles-20261019/run-01/documents/browser-j13",
);
async function login(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByRole("button", { name: "RU", exact: true }).click();
  await page.getByLabel("Электронная почта", { exact: true }).fill(user.email);
  await page.getByLabel("Пароль", { exact: true }).fill(user.password);
  let response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/auth/login") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  let result = await response;
  if (result.status() === 429) {
    await page.waitForTimeout(61000);
    response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/auth/login") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    result = await response;
  }
  expect(result.ok(), "Authentication must succeed before access checks").toBe(
    true,
  );
  const auth = await result.json();
  await expect(page).not.toHaveURL(/\/login/);
  return {
    "x-csrf-token": auth.csrfToken as string,
    origin: process.env.DEMO_ORIGIN!,
  };
}
test.use({ trace: "off", screenshot: "off", video: "off" });
test("J13 HTTP session scopes protect lists, totals, CSV, files and cached ZIP", async ({
  browser,
}) => {
  test.setTimeout(420000);
  const fixture = JSON.parse(
    await readFile(path.join(runtime, "browser-fixture.json"), "utf8"),
  );
  const chain = JSON.parse(
    await readFile(path.join(runtime, "chain-result.json"), "utf8"),
  );
  await mkdir(output, { recursive: true });
  const contexts = [];
  const checks: Record<string, unknown>[] = [];
  let completeDocuments = false;
  try {
    const staffContext = await browser.newContext({
      baseURL: process.env.DEMO_ORIGIN,
    });
    contexts.push(staffContext);
    const staff = await staffContext.newPage();
    const staffHeaders = await login(staff, fixture.users.operator);
    const detailResponse = await staff.request.get(
      `/api/lms/enrollments/${chain.enrollmentId}`,
    );
    expect(detailResponse.status()).toBe(200);
    const detail = await detailResponse.json();
    const links = detail.documents.filter(
      (document: { resultId: string; status: string }) =>
        document.resultId === chain.resultId && document.status === "ISSUED",
    );
    const artifact = links
      .flatMap(
        (document: { artifacts: { id: string; kind: string }[] }) =>
          document.artifacts,
      )
      .find((file: { kind: string }) => file.kind === "PDF");
    let bundleId: string | null = null;
    if (links.length === 3 && artifact) {
      const prepared = await staff.request.post("/api/lms/documents/bundle", {
        headers: staffHeaders,
        data: {
          documentIds: links.map((item: { id: string }) => item.id),
          format: "PDF",
        },
      });
      expect(prepared.status()).toBe(201);
      bundleId = (await prepared.json()).id;
      await expect
        .poll(
          async () =>
            (
              await (
                await staff.request.get(
                  `/api/lms/documents/bundles/${bundleId}`,
                )
              ).json()
            ).status,
          { timeout: 90000 },
        )
        .toBe("READY");
      completeDocuments = true;
    }
    const roles = [
      "readOnlyEmployer",
      "assignOnlyEmployer",
      "employer",
      "downloadOnlyEmployer",
      "expiredEmployer",
      "bootstrap",
      "viewer",
    ];
    for (const role of process.env.DEMO_J13_ROLES?.split(",") || roles) {
      const context = await browser.newContext({
        baseURL: process.env.DEMO_ORIGIN,
      });
      contexts.push(context);
      const page = await context.newPage();
      const headers = await login(page, fixture.users[role]);
      const noRead = [
        "downloadOnlyEmployer",
        "expiredEmployer",
        "bootstrap",
      ].includes(role);
      const noDownload = ["readOnlyEmployer", "assignOnlyEmployer"].includes(
        role,
      );
      for (const resource of role === "viewer"
        ? []
        : ["enrollments", "results"]) {
        const response = await page.request.get(
          `/api/lms/${resource}?courseId=${chain.courseId}`,
        );
        const routeDenied = role !== "bootstrap" && resource === "results";
        expect
          .soft(response.status(), `${role} ${resource}`)
          .toBe(routeDenied ? 403 : 200);
        const body = await response.json();
        if (routeDenied) expect.soft(body.code).toBe("ROLE_SCOPE");
        else if (noRead) {
          expect.soft(body.items, role).toEqual([]);
          expect.soft(body.total, role).toBe(0);
        } else expect.soft(body.total, role).toBeGreaterThan(0);
        checks.push({
          role,
          action: resource,
          status: response.status(),
          total: body.total,
        });
      }
      const enrollment = await page.request.get(
        `/api/lms/enrollments/${chain.enrollmentId}`,
      );
      expect
        .soft(enrollment.status(), `${role} direct enrollment`)
        .toBe(role === "viewer" ? 403 : noRead ? 404 : 200);
      checks.push({
        role,
        action: "direct enrollment",
        status: enrollment.status(),
      });
      const exported = await page.request.post("/api/lms/results/export", {
        headers,
        data: {
          filters: { courseId: chain.courseId },
          format: "CSV",
          language: "ru",
        },
      });
      const csv = await exported.text();
      if (noDownload) {
        expect
          .soft(exported.status(), `${role} CSV requires DOWNLOAD`)
          .toBe(403);
        expect
          .soft(JSON.parse(csv).code)
          .toBe("EMPLOYER_DOCUMENT_DOWNLOAD_DENIED");
      } else if (role === "employer")
        expect.soft(exported.status(), role).toBe(201);
      else if (exported.ok())
        expect
          .soft(csv.trim().split(/\r?\n/).length, `${role} empty export`)
          .toBe(1);
      else expect.soft([403, 404]).toContain(exported.status());
      checks.push({
        role,
        action: "CSV export",
        status: exported.status(),
        code: exported.ok() ? null : JSON.parse(csv).code,
        csvRows: exported.ok() ? csv.trim().split(/\r?\n/).length - 1 : null,
      });
      if (completeDocuments && role !== "viewer") {
        const document = await page.request.get(
          `/api/lms/documents/${links[0].id}`,
        );
        expect
          .soft(document.status(), `${role} document`)
          .toBe(noRead ? 404 : 200);
        if (noDownload && document.ok()) {
          const view = await document.json();
          expect.soft(view.artifacts, role).toEqual([]);
          expect.soft(view.link.verificationUrl, role).toBeNull();
        }
        const file = await page.request.get(
          `/api/lms/artifacts/${artifact.id}`,
        );
        expect
          .soft(file.status(), `${role} direct file`)
          .toBe(noRead ? 404 : noDownload ? 403 : 200);
        const cached = await page.request.get(
          `/api/lms/documents/bundles/${bundleId}`,
        );
        expect
          .soft(cached.status(), `${role} cached bundle`)
          .toBe(noRead ? 404 : noDownload ? 403 : 200);
        const part = await page.request.get(
          `/api/lms/documents/bundles/${bundleId}/parts/0`,
        );
        expect
          .soft(part.status(), `${role} cached ZIP part`)
          .toBe(noRead ? 404 : noDownload ? 403 : 200);
        if (part.ok())
          expect.soft((await part.body()).subarray(0, 2).toString()).toBe("PK");
        const bundle = await page.request.post("/api/lms/documents/bundle", {
          headers,
          data: {
            documentIds: links.map((item: { id: string }) => item.id),
            format: "PDF",
          },
        });
        expect
          .soft(bundle.status(), `${role} prepare ZIP`)
          .toBe(noRead ? 404 : noDownload ? 403 : 201);
        checks.push({
          role,
          action: "documents and cached ZIP",
          document: document.status(),
          file: file.status(),
          bundle: bundle.status(),
          cached: cached.status(),
          part: part.status(),
        });
      }
      if (role === "viewer") {
        const write = await page.request.post("/api/lms/results/documents", {
          headers,
          data: { resultIds: [chain.resultId] },
        });
        expect.soft(write.status(), "VIEWER write denied").toBe(403);
        checks.push({
          role,
          action: "prepare documents write",
          status: write.status(),
        });
      }
    }
  } finally {
    await writeFile(
      path.join(output, "J13coverage.json"),
      JSON.stringify(
        {
          status: test.info().errors.length
            ? "FAIL"
            : completeDocuments
              ? "PASS"
              : "PARTIAL_DOCUMENTS_PENDING",
          synthetic: true,
          tenantId: fixture.tenantId,
          otherTenantId: fixture.otherTenantId,
          enrollmentId: chain.enrollmentId,
          resultId: chain.resultId,
          realIssuedFilesAndCachedZipExercised: completeDocuments,
          checks,
        },
        null,
        2,
      ),
    );
    await Promise.allSettled(contexts.map((context) => context.close()));
  }
});

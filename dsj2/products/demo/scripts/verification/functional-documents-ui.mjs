import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
const caseName = process.argv[3] || "primary";
if (!["primary", "sanitary", "credential"].includes(caseName)) throw new Error("Unknown document case");
const root = process.cwd(),
  runtime = path.join(root, ".runtime/functional-completion-20261019/run-01"),
  evidence = path.join(
    root,
    "docs/evidence/functional-completion-20261019/run-01/documents", caseName === "primary" ? "" : caseName,
  );
const data = JSON.parse(
  await fs.readFile(path.join(runtime, "populated.private.json"), "utf8"),
);
if (caseName === "sanitary") data.learners = [data.learners[12]];
if (caseName === "credential") {
  const state = JSON.parse(await fs.readFile(path.join(runtime, "credential-result.private.json"), "utf8"));
  const staff = JSON.parse(await fs.readFile(path.join(runtime, "onboarding-result.private.json"), "utf8"));
  data.origin = state.origin; data.users = staff.users;
  data.learners = [{...state.learner, enrollmentId: state.enrollmentId}];
}
const learnerName = caseName === "credential" ? data.learners[0].displayName : `Учебный слушатель ${caseName === "sanitary" ? "13" : "01"}`;
const requestRecord = caseName === "primary" ? "documents-request.private.json" : `documents-${caseName}-request.private.json`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("pageerror", (error) =>
  console.log(
    JSON.stringify({ browserError: error.message, stack: error.stack }),
  ),
);
page.setDefaultTimeout(20000);
await fs.mkdir(evidence, { recursive: true });
try {
  await page.goto(data.origin + "/login");
  await page.locator('input[type="email"]').fill(data.users.superAdmin.email);
  await page
    .locator('input[type="password"]')
    .fill(data.users.superAdmin.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.includes("login"));
  const stage = process.argv[2] || "inspect";
  if (stage === "inspect") {
    await page.goto(data.origin + "/settings?tab=templates");
    await page
      .getByRole("heading", { name: "Формы документов", exact: true })
      .waitFor();
    console.log(await page.locator("main").innerText());
    await page.screenshot({
      path: path.join(evidence, "forms-before.png"),
      fullPage: true,
    });
  }
  if (["samples", "approve"].includes(stage)) {
    await page.goto(data.origin + "/settings?tab=templates");
    await page
      .getByRole("heading", { name: "Формы документов", exact: true })
      .waitFor();
    if (stage === "samples") {
      await page.getByText("Образцы и исходные файлы", { exact: true }).click();
      const outputs = [];
      for (const [key, label] of [
        ["protocol", "Протокол обучения"],
        ["certificate", "Сертификат учебного центра"],
        ["credential", "Удостоверение учебного центра"],
      ]) {
        const row = page
          .locator("li")
          .filter({ has: page.locator("strong", { hasText: label }) });
        for (const format of ["DOCX", "PDF"]) {
          const waiting = page.waitForEvent("download");
          await row
            .getByRole("link", { name: `Образец ${format}`, exact: true })
            .click();
          const download = await waiting;
          const file = path.join(
            evidence,
            `sample-${key}.${format.toLowerCase()}`,
          );
          await download.saveAs(file);
          outputs.push({
            kind: key,
            format,
            file: path.basename(file),
            bytes: (await fs.stat(file)).size,
          });
        }
      }
      await fs.writeFile(
        path.join(evidence, "sample-downloads.json"),
        JSON.stringify(outputs, null, 2),
      );
      console.log(JSON.stringify(outputs));
    } else {
      for (const label of [
        "Обучение — сертификат центра",
        "Обучение — удостоверение центра",
        "Обучение — протокол результата",
      ]) {
        const article = page
          .locator("article")
          .filter({
            has: page.getByRole("heading", { name: label, exact: true }),
          }).first();
        if (
          await article
            .getByRole("button", { name: "Подтвердить форму", exact: true })
            .count()
        )
          await article
            .getByRole("button", { name: "Подтвердить форму", exact: true })
            .click();
        await article.getByText("Подтверждена", { exact: true }).waitFor();
      }
      await page.reload();
      for (const label of [
        "Обучение — сертификат центра",
        "Обучение — удостоверение центра",
        "Обучение — протокол результата",
      ])
        await page
          .locator("article")
          .filter({
            has: page.getByRole("heading", { name: label, exact: true }),
          })
          .getByText("Подтверждена", { exact: true })
          .first()
          .waitFor();
      await page.screenshot({
        path: path.join(evidence, "forms-approved.png"),
        fullPage: true,
      });
      console.log("THREE_LMS_FORMS_APPROVED_THROUGH_UI");
    }
  }
  if (["results", "prepare"].includes(stage)) {
    await page.goto(
      data.origin +
        `/lms/results?enrollmentId=${data.learners[0].enrollmentId}`,
    );
    await page
      .getByRole("heading", { name: "Результаты", exact: true })
      .waitFor();
    await page
      .getByText(learnerName, { exact: true })
      .first()
      .waitFor();
    if (stage === "prepare") {
      const prepare = page.getByRole("button", { name: "Подготовить документы", exact: true });
      const existing = page.getByRole("link", { name: "Открыть подготовку", exact: true }).first();
      await prepare.or(existing).first().waitFor();
      if (await prepare.isVisible()) await prepare.click();
      await page
        .getByRole("link", { name: "Открыть подготовку", exact: true })
        .first()
        .waitFor({ timeout: 30000 });
      const requestUrl = await page
        .getByRole("link", { name: "Открыть подготовку", exact: true })
        .first()
        .getAttribute("href");
      await fs.writeFile(
        path.join(runtime, requestRecord),
        JSON.stringify({ requestUrl }, null, 2),
      );
    }
    console.log(await page.locator("main").innerText());
    await page.screenshot({
      path: path.join(evidence, "results-before.png"),
      fullPage: true,
    });
  }
  if (
    ["preview", "issue", "inspect-issued", "inspect-request"].includes(stage)
  ) {
    const { requestUrl } = JSON.parse(
      await fs.readFile(
        path.join(runtime, requestRecord),
        "utf8",
      ),
    );
    const requestId = requestUrl.split("/")[2];
    const read = async () => {
      const response = await page.request.get(
        data.origin + `/api/print-requests/${requestId}`,
      );
      expect(response.ok()).toBe(true);
      return response.json();
    };
    let request = await read();
    if (stage === "inspect-request") {
      console.log(
        JSON.stringify(
          {
            approval: request.approval,
            jobs: request.jobs,
            documents: request.documents,
          },
          null,
          2,
        ),
      );
      await browser.close();
      process.exit(0);
    }
    if (stage === "preview" || stage === "issue") {
      const director = await browser.newPage({
        viewport: { width: 1440, height: 1100 },
      });
      director.on("pageerror", (error) =>
        console.log(JSON.stringify({ directorError: error.message })),
      );
      director.on("console", (message) => {
        if (message.type() === "error")
          console.log(JSON.stringify({ directorConsole: message.text() }));
      });
      await director.goto(data.origin + "/login");
      await director
        .locator('input[type="email"]')
        .fill(data.users.director.email);
      await director
        .locator('input[type="password"]')
        .fill(data.users.director.password);
      await director
        .getByRole("button", { name: "Войти", exact: true })
        .click();
      await director.waitForURL((url) => !url.pathname.includes("login"));
      await director.goto(
        data.origin + `/approvals?proposal=${request.approval.proposalId}`,
      );
      if (stage === "preview") {
        await director
          .getByText(/^Предпросмотр данных всех людей и документов/)
          .click();
        const viewer = director.getByRole("region", {
          name: "Предпросмотр назначенных документов",
        });
        const create = viewer.getByRole("button", {
          name: /^(Создать|Повторить) предпросмотр$/,
        });
        if (await create.isVisible()) await create.click();
        try {
          await expect(
            viewer.getByRole("img", { name: /^Страница 1 из/ }),
          ).toBeVisible({ timeout: 45000 });
        } catch (error) {
          console.log(await director.locator("main").innerText());
          await director.screenshot({
            path: path.join(evidence, "director-preview-failure.png"),
            fullPage: true,
          });
          throw error;
        }
        await director.screenshot({
          path: path.join(evidence, "director-preview.png"),
          fullPage: true,
        });
        console.log(await director.locator("main").innerText());
      } else {
        if (request.approval.status !== "APPROVED")
          await director
            .getByRole("button", {
              name: "Согласовать эту редакцию",
              exact: true,
            })
            .click();
        await expect
          .poll(async () => (await read()).approval.status)
          .toBe("APPROVED");
        await page.goto(data.origin + `/requests/${requestId}/edit`);
        const generate = page.getByRole("button", {
          name: "Сформировать документы",
          exact: true,
        });
        if (await generate.isVisible()) await generate.click();
        await expect
          .poll(
            async () => {
              const d = await read();
              return (
                d.documents?.length > 0 &&
                d.jobs
                  ?.filter((j) => j.provenance === "ORIGINAL" || j.issuanceId)
                  .every((j) => j.status === "SUCCEEDED")
              );
            },
            { timeout: 210000 },
          )
          .toBe(true);
      }
    }
    if (stage !== "preview") {
      request = await read();
      const outputs = [];
      for (const artifact of request.artifacts.filter(
        (a) =>
          a.provenance === "ORIGINAL" && ["PDF", "DOCX"].includes(a.format),
      )) {
        const response = await page.request.get(
          data.origin + `/api/artifacts/${artifact.id}`,
        );
        expect(response.ok()).toBe(true);
        const body = await response.body();
        const name = `issued-${artifact.id}.${artifact.format.toLowerCase()}`;
        await fs.writeFile(path.join(evidence, name), body);
        outputs.push({
          id: artifact.id,
          name,
          bytes: body.length,
          format: artifact.format,
        });
      }
      await fs.writeFile(
        path.join(evidence, "issued-result.json"),
        JSON.stringify(
          {
            status: "PASS",
            synthetic: true,
            requestId,
            enrollmentId: data.learners[0].enrollmentId,
            approval: request.approval.status,
            documents: request.documents,
            issuanceCount: request.issuances.length,
            outputs,
          },
          null,
          2,
        ),
      );
      await fs.writeFile(
        path.join(runtime, `issued-${caseName}-request.private.json`),
        JSON.stringify(request, null, 2),
      );
      console.log(
        JSON.stringify({ requestId, documents: request.documents, outputs }),
      );
      await page.goto(
        data.origin +
          `/lms/results?enrollmentId=${data.learners[0].enrollmentId}`,
      );
      await page
        .getByRole("heading", { name: "Результаты", exact: true })
        .waitFor();
      await page.screenshot({
        path: path.join(evidence, "issued-results.png"),
        fullPage: true,
      });
    }
  }
  if (stage === "commission") {
    await page.goto(data.origin + "/lms/commission");
    await page
      .getByRole("button", { name: "Открыть", exact: true })
      .first()
      .click();
    await page.getByText(learnerName, { exact: true }).waitFor();
    await page
      .getByRole("checkbox", {
        name: "Результаты и окончательные PDF просмотрены, протокол подтверждаю",
        exact: true,
      })
      .check();
    await page
      .getByRole("button", { name: "Подтвердить протокол", exact: true })
      .click();
    await page.getByText(/Вы подтвердили этот протокол/).waitFor();
    await page.screenshot({
      path: path.join(evidence, "commission-confirmed.png"),
      fullPage: true,
    });
    await page.reload();
    await page
      .getByRole("button", { name: "Открыть", exact: true })
      .first()
      .click();
    await page.getByText(/Вы подтвердили этот протокол/).waitFor();
    await fs.writeFile(
      path.join(evidence, "commission-result.json"),
      JSON.stringify(
        {
          status: "PASS",
          synthetic: true,
          reviewedActualPdf: true,
          confirmedThroughUI: true,
          persistedAfterReload: true,
          electronicSignature: false,
        },
        null,
        2,
      ),
    );
  }
  if (stage === "learner") {
    const learner = await browser.newPage({
      viewport: { width: 1280, height: 1000 },
    });
    await learner.goto(data.origin + "/login");
    await learner.locator('input[type="email"]').fill(data.learners[0].email);
    await learner
      .locator('input[type="password"]')
      .fill(data.learners[0].password);
    await learner.getByRole("button", { name: "Войти", exact: true }).click();
    await learner.waitForURL((url) => !url.pathname.includes("login"));
    await learner.goto(data.origin + `/learn/${data.learners[0].enrollmentId}`);
    await learner
      .getByRole("link", { name: "Скачать PDF", exact: true })
      .first()
      .waitFor();
    const downloads = [];
    for (const format of ["PDF", "DOCX"]) {
      const links = learner.getByRole("link", {
        name: `Скачать ${format}`,
        exact: true,
      });
      for (let i = 0; i < (await links.count()); i++) {
        const waiting = learner.waitForEvent("download");
        await links.nth(i).click();
        const item = await waiting;
        const name = `learner-${i + 1}.${format.toLowerCase()}`;
        await item.saveAs(path.join(evidence, name));
        downloads.push({
          name,
          bytes: (await fs.stat(path.join(evidence, name))).size,
        });
      }
    }
    await learner.screenshot({
      path: path.join(evidence, "learner-documents.png"),
      fullPage: true,
    });
    await learner.reload();
    await expect(
      learner.getByRole("link", { name: "Скачать PDF", exact: true }),
    ).toHaveCount(caseName === "credential" ? 3 : 2);
    await fs.writeFile(
      path.join(evidence, "learner-downloads.json"),
      JSON.stringify(
        {
          status: "PASS",
          enrollmentId: data.learners[0].enrollmentId,
          downloads,
          persistedAfterReload: true,
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify(downloads));
  }
  if (["bulk", "bulk-full"].includes(stage)) {
    await page.goto(data.origin + "/lms/results");
    await page.getByText("Фильтры и отчёт", { exact: true }).click();
    await page.getByLabel("Состояние").selectOption("PASSED");
    await expect(page.locator("table tbody tr")).toHaveCount(2);
    await page
      .getByRole("button", {
        name: "Выбрать допустимые результаты на странице",
        exact: true,
      })
      .click();
    const full = stage === "bulk-full";
    const submit=page.getByRole("button", { name: full ? /^Получить готовый комплект · 2$/ : /^Подготовить документы · 2$/ });
    await expect(submit).toBeEnabled();
    const [response] = await Promise.all([
      page.waitForResponse(r=>r.url().endsWith("/api/lms/results/documents")&&r.request().method()==="POST"),
      submit.click(),
    ]);
    expect(response.ok()).toBe(true);
    const prepared = await response.json();
    if (!full) await page.getByRole("button", { name: /^Получить готовую часть/ }).click();
    const link = page.getByRole("link", { name: /^Скачать часть 1/ });
    await link.waitFor({ timeout: 90000 });
    const downloading = page.waitForEvent("download");
    await link.click();
    await (await downloading).saveAs(path.join(evidence, full ? "full-ready.zip" : "partial-ready.zip"));
    await page.screenshot({
      path: path.join(evidence, full ? "bulk-full-ready.png" : "bulk-partial-ready.png"),
      fullPage: true,
    });
    await page.reload();
    await page
      .getByRole("link", { name: /^Скачать часть 1/ })
      .first()
      .waitFor();
    await fs.writeFile(
      path.join(evidence, full ? "bulk-full.json" : "bulk-partial.json"),
      JSON.stringify(
        {
          status: "PASS",
          mode: full ? "Full ready package after pending result issued" : "Ready files while another result awaits approval",
          prepared,
          persistedAfterReload: true,
        },
        null,
        2,
      ),
    );
    const pendingRequest = prepared.items.find(
      (item) => item.status !== "ISSUED",
    );
    if (pendingRequest)
      await fs.writeFile(
        path.join(runtime, "documents-next-request.private.json"),
        JSON.stringify(
          {
            requestUrl: `/requests/${pendingRequest.requestId}`,
            enrollmentId: data.learners[12].enrollmentId,
          },
          null,
          2,
        ),
      );
    console.log(
      JSON.stringify({
        items: prepared.items.length,
        errors: prepared.errors,
        pendingRequest: pendingRequest?.requestId,
      }),
    );
  }
} catch (error) {
  await page.screenshot({
    path: path.join(evidence, "failure.png"),
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
}

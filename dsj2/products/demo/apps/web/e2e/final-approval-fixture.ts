import { expect, type Browser, type Page } from "@playwright/test";

export async function openFinalPanel(
  page: Page,
  panel: "review" | "operations" | "output" | "dates",
) {
  const label = {
    review: "Согласование и передача",
    operations: "Связанные действия",
    output: "Комплект для заказчика",
    dates: "Общие даты и протоколы",
  }[panel];
  const current = page.getByRole("dialog");
  if (await current.isVisible())
    await current
      .getByRole("button", { name: "Закрыть диалог", exact: true })
      .click();
  await page
    .getByRole("button", { name: "Дополнительные действия", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: label, exact: true })
    .click();
  return page.getByRole("dialog", { name: label, exact: true });
}

/** Real director UI decision for the explicitly provisioned synthetic center. */
export async function approveFinalFixture(
  browser: Browser,
  operator: Page,
  auth: {
    tenantId: string;
    director: { email: string; password: string; tenantId: string };
  },
  id: string,
) {
  const currentResponse = await operator.request.get(
    `/api/print-requests/${id}`,
  );
  expect(currentResponse.ok(), await currentResponse.text()).toBe(true);
  let current = await currentResponse.json();
  if (current.approval?.status !== "PENDING") {
    const session = await (
      await operator.request.get("/api/auth/session")
    ).json();
    const submitted = await operator.request.post(
      `/api/print-requests/${id}/approval/submit`,
      {
        headers: {
          origin: new URL(operator.url()).origin,
          "x-csrf-token": session.csrfToken,
        },
        data: { expectedRevision: current.revision },
      },
    );
    expect(submitted.ok(), await submitted.text()).toBe(true);
    current = await (
      await operator.request.get(`/api/print-requests/${id}`)
    ).json();
  }
  expect(current.approval?.status).toBe("PENDING");
  const context = await browser.newContext({
    baseURL: process.env.DEMO_ORIGIN,
  });
  try {
    const director = await context.newPage();
    await director.goto("/login");
    await director
      .getByLabel("Электронная почта", { exact: true })
      .fill(auth.director.email);
    await director
      .getByLabel("Пароль", { exact: true })
      .fill(auth.director.password);
    await director.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(director).not.toHaveURL(/\/login(?:\?|$)/);
    const session = await (
      await director.request.get("/api/auth/session")
    ).json();
    expect(session.tenant.id).toBe(auth.tenantId);
    expect(session.tenant.demoOnly).toBe(true);
    expect(session.user.role).toBe("DIRECTOR");
    await director.goto(`/approvals?proposal=${current.approval.proposalId}`);
    await director
      .getByLabel("Комментарий к решению", { exact: true })
      .fill(
        "СИНТЕТИЧЕСКАЯ проверка текущей редакции final fixture; не юридическое утверждение",
      );
    const pending = director.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        r.url().endsWith(`/approvals/${current.approval.proposalId}/decision`),
    );
    await director
      .getByRole("button", { name: "Согласовать эту редакцию", exact: true })
      .click();
    const response = await pending;
    expect(response.status(), await response.text()).toBe(201);
    await expect
      .poll(
        async () =>
          (
            await (
              await operator.request.get(`/api/print-requests/${id}`)
            ).json()
          ).approval?.status,
      )
      .toBe("APPROVED");
    return await (
      await operator.request.get(`/api/print-requests/${id}`)
    ).json();
  } finally {
    await context.close();
  }
}

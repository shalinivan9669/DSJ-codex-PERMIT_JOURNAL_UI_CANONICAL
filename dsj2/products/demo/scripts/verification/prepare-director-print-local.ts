/** Prepare a repeatable, synthetic local print desk through the real HTTP API.
 * No electronic signatures or paper attestations are created by this script.
 * Load .runtime/director-print-20261110/env.ps1, then run:
 * pnpm exec tsx --tsconfig tsconfig.base.json scripts/verification/prepare-director-print-local.ts
 * Checkpoints retain request IDs across API/worker restarts; rendered rows are immutable.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { draftSchema, type Draft } from "../../packages/contracts/src";

async function main() {
  const database = new URL(process.env.DATABASE_URL || "http://invalid");
  assert.equal(database.hostname, "127.0.0.1");
  assert.equal(database.pathname, "/demo_test_director_print_20261110");
  const base = process.env.DEMO_LOCAL_API || "http://127.0.0.1:4170";
  const origin = process.env.DEMO_ORIGIN || "http://localhost:3170";
  for (const url of [base, origin]) {
    const parsed = new URL(url);
    assert.ok(["127.0.0.1", "localhost"].includes(parsed.hostname));
    assert.equal(parsed.protocol, "http:");
  }
  const email = process.env.DEMO_ADMIN_EMAIL;
  const password = process.env.DEMO_ADMIN_PASSWORD;
  assert.ok(email && password, "Load the private local env.ps1 before running");
  const root = resolve(".runtime/director-print-20261110");
  const checkpoint = join(root, "sample-print-state.json");
  const date = "2026-11-10";
  const state: {
    tenantId?: string;
    customerId?: string;
    recipients?: Record<string, string>;
    requests?: Record<string, string>;
    merged?: Record<string, string>;
  } = await readFile(checkpoint, "utf8")
    .then(JSON.parse)
    .catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    });
  await mkdir(root, { recursive: true });
  async function saveState() {
    await writeFile(checkpoint, JSON.stringify(state, null, 2));
  }
  let cookie = "";
  let csrf = "";
  async function response(path: string, body?: unknown, key?: string) {
    const result = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        origin,
        ...(cookie ? { cookie, "x-csrf-token": csrf } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(key ? { "idempotency-key": key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(240000),
    });
    if (!result.ok)
      throw new Error(`${path} HTTP ${result.status}: ${await result.text()}`);
    return result;
  }
  async function api<T>(
    path: string,
    body?: unknown,
    key?: string,
  ): Promise<T> {
    return (await response(path, body, key)).json() as Promise<T>;
  }
  type User = { id: string; email: string; displayName: string; role: string };
  type Artifact = {
    id: string;
    format: string;
    fileName: string;
    sha256: string;
    size: number;
    provenance: string;
  };
  type RequestDetail = {
    id: string;
    revision: number;
    status: string;
    lifecycle: string;
    issuances: Array<{ id: string }>;
    artifacts: Artifact[];
    jobs: Array<{ id: string; kind: string; status: string; error?: unknown }>;
  };
  const login = await response("/auth/login", { email, password });
  cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  csrf = ((await login.json()) as { csrfToken: string }).csrfToken;
  assert.ok(cookie && csrf);

  try {
    const context = await api<{
      tenant: { id: string; demoOnly: boolean };
      user: User;
    }>("/context");
    assert.equal(
      context.tenant.demoOnly,
      true,
      "This fixture refuses real centers",
    );
    assert.equal(context.user.role, "DIRECTOR");
    if (state.tenantId) assert.equal(context.tenant.id, state.tenantId);
    state.tenantId = context.tenant.id;
    await saveState();

    const names = [
      "Тестовый Директор",
      "Тестовый Член комиссии 1",
      "Тестовый Член комиссии 2",
    ];
    const profile = {
      nameRu: "ТОО Учебный центр — локальная проверка",
      nameKz: "Жергілікті тексеру оқу орталығы ЖШС",
      addressRu: "Тестовый адрес: г. Кызылорда, учебная улица, 1",
      addressKz: "Тест мекенжайы: Қызылорда, оқу көшесі, 1",
      cityRu: "Кызылорда",
      cityKz: "Қызылорда",
      bin: "000000000011",
      approvalBasis: "Синтетический стенд для проверки печати, 10.11.2026",
      headName: names[0],
      approved: true,
      commissionTitle: "Тестовая экзаменационная комиссия",
      commission: names.map((name, index) => ({
        name,
        position: index ? "Член комиссии" : "Председатель комиссии",
      })),
      people: [
        { name: names[0], position: "Тестовый преподаватель", role: "TEACHER" },
      ],
    };
    const currentProfile =
      await api<Record<string, unknown>>("/settings/profile");
    if (
      currentProfile?.approvalBasis !== profile.approvalBasis ||
      !currentProfile?.approved
    )
      await api("/settings/profile", profile);

    const users = await api<{ items: User[] }>("/users");
    const staff: User[] = [context.user];
    for (let index = 1; index < names.length; index++) {
      const staffEmail = `print-commission-${index}@example.test`;
      staff.push(
        users.items.find((user) => user.email === staffEmail) ||
          (await api<User>("/users", {
            email: staffEmail,
            password,
            displayName: names[index],
            role: "OPERATOR",
          })),
      );
    }
    for (const [index, role] of ["DIRECTOR", "MEMBER", "MEMBER"].entries())
      await api("/settings/signatories", {
        userId: staff[index].id,
        displayName: names[index],
        role,
        iin: `00000000000${index + 1}`,
      });
    for (const role of ["CHAIR", "TEACHER"])
      await api("/settings/signatories", {
        userId: staff[0].id,
        displayName: names[0],
        role,
        iin: "000000000001",
      });

    const manifest = JSON.parse(
      await readFile("assets/templates/manifest.json", "utf8"),
    ) as {
      templates: Array<{ id: string; version: string }>;
      groupTemplates?: Array<{ id: string; version: string }>;
      specialTemplates?: Array<{ id: string; version: string }>;
    };
    const active = [
      ...manifest.templates,
      ...(manifest.groupTemplates || []),
      ...(manifest.specialTemplates || []),
    ];
    const templates = await api<{
      items: Array<{
        id: string;
        templateId: string;
        version: string;
        approved: boolean;
      }>;
    }>("/settings/templates");
    for (const template of active) {
      const installed = templates.items.find(
        (item) =>
          item.templateId === template.id &&
          item.version === String(template.version),
      );
      assert.ok(
        installed,
        `Missing active template ${template.id}:${template.version}`,
      );
      if (!installed.approved)
        await api(`/settings/templates/${installed.id}/approve`, {
          approved: true,
        });
    }

    const company = {
      nameRu: "ТОО Тестовый Монтаж",
      nameKz: "Тест Монтаж ЖШС",
      bin: "000000000022",
      addressRu: "Тестовый адрес: г. Кызылорда, производственная улица, 2",
      addressKz: "Тест мекенжайы: Қызылорда, өндіріс көшесі, 2",
      city: "Кызылорда",
    };
    if (!state.customerId) {
      state.customerId = (
        await api<{ id: string }>(
          "/customers",
          company,
          "local_print_company_20261110",
        )
      ).id;
      await saveState();
    }
    const people = [
      {
        id: "worker-1",
        fullNameRu: "Тестов Алексей Андреевич",
        fullNameKz: "Тестов Алексей Андреевич",
        positionRu: "Электромонтёр",
        positionKz: "Электрмонтер",
      },
      {
        id: "worker-2",
        fullNameRu: "Образцов Сергей Петрович",
        fullNameKz: "Образцов Сергей Петрович",
        positionRu: "Слесарь",
        positionKz: "Слесарь",
      },
      {
        id: "worker-3",
        fullNameRu: "Пробный Марат Ерланович",
        fullNameKz: "Пробный Марат Ерланұлы",
        positionRu: "Монтажник",
        positionKz: "Монтажшы",
      },
      {
        id: "person-1",
        fullNameRu: "Учебная Анна Сергеевна",
        fullNameKz: "Учебная Анна Сергеевна",
        positionRu: "Рабочая",
        positionKz: "Жұмысшы",
      },
    ].map((person, index) => ({
      ...person,
      employeeCategory: "WORKER" as const,
      workplaceRu:
        index < 3 ? company.nameRu : "Индивидуальное обучение (тест)",
      workplaceKz: index < 3 ? company.nameKz : "Жеке оқу (тест)",
      ...(index < 3
        ? { employerId: state.customerId, personnelNumber: `TEST-${index + 1}` }
        : {}),
      externalId: `local-print-20261110-${person.id}`,
    }));
    state.recipients ||= {};
    for (const person of people) {
      if (!state.recipients[person.id]) {
        state.recipients[person.id] = (
          await api<{ id: string }>("/recipients", person)
        ).id;
        await saveState();
      }
    }
    const courses = [
      {
        id: "biot",
        templateId: "biot-worker-card",
        protocol: "biot-protocol",
        title: "Безопасность и охрана труда",
        titleKz: "Еңбек қауіпсіздігі және еңбекті қорғау",
        hours: "10",
      },
      {
        id: "ptm",
        templateId: "ptm-card",
        protocol: "ptm-protocol",
        title: "Пожарно-технический минимум",
        titleKz: "Өрт-техникалық минимум",
        hours: "16",
      },
      {
        id: "pb",
        templateId: "pb-card",
        protocol: "pb-protocol",
        title: "Промышленная безопасность",
        titleKz: "Өнеркәсіптік қауіпсіздік",
        hours: "40",
      },
    ];
    function draft(
      key: string,
      kind: "COMPANY" | "PERSON",
      title: string,
      group: boolean,
    ): Draft {
      const selected =
        kind === "COMPANY" ? people.slice(0, 3) : people.slice(3);
      const selectedCourses =
        kind === "COMPANY" ? courses : courses.slice(0, 1);
      return draftSchema.parse({
        kind,
        title,
        demoMode: true,
        schemaVersion: 2,
        businessRuleVersion: "LIVE_V1",
        customerId: kind === "COMPANY" ? state.customerId : null,
        commonFields: {
          documentDate: date,
          protocolDate: date,
          trainingStart: "2026-11-01",
          trainingEnd: "2026-11-09",
        },
        events: selectedCourses.map((course) => ({
          id: `${key}-${course.id}`,
          title: course.title,
          protocolTemplateId: course.protocol,
          protocolMode: group ? "GROUP" : "INDIVIDUAL",
          protocolModeSource: "MANUAL",
          commonFields: {
            documentDate: date,
            protocolDate: date,
            trainingStart: "2026-11-01",
            trainingEnd: "2026-11-09",
            trainingSubject: course.title,
            trainingSubjectKz: course.titleKz,
            hours: course.hours,
            ...(course.id === "biot"
              ? {
                  productionHours: "16",
                  biotCategory: "WORKER",
                  biotCheckType: "PERIODIC",
                }
              : {}),
          },
        })),
        items: selected.map((person) => ({
          ...person,
          recipientId: state.recipients![person.id],
          assignments: selectedCourses.map((course) => ({
            id: `${person.id}-${course.id}`,
            templateId: course.templateId,
            eventId: `${key}-${course.id}`,
            protocolMode: group ? "GROUP" : "INDIVIDUAL",
            outcome: {
              status: "PASSED",
              source:
                "Синтетический результат только для проверки локальной печати",
            },
            result: "Сдал",
            resultKz: "Тапсырды",
          })),
        })),
      });
    }
    state.requests ||= {};
    const scenarios = [
      {
        key: "company",
        title: "ПЕЧАТЬ — 3 работника / БиОТ, ПТМ, ПБ (тест)",
        input: draft(
          "company",
          "COMPANY",
          "ПЕЧАТЬ — 3 работника / БиОТ, ПТМ, ПБ (тест)",
          true,
        ),
        render: true,
      },
      {
        key: "person",
        title: "ПЕЧАТЬ — физлицо / БиОТ (тест)",
        input: draft(
          "person",
          "PERSON",
          "ПЕЧАТЬ — физлицо / БиОТ (тест)",
          false,
        ),
        render: true,
      },
      {
        key: "signing",
        title: "ЭЦП — согласованная заявка для проверки (тест)",
        input: draft(
          "signing",
          "PERSON",
          "ЭЦП — согласованная заявка для проверки (тест)",
          false,
        ),
        render: false,
      },
    ];
    for (const scenario of scenarios) {
      if (!state.requests[scenario.key]) {
        state.requests[scenario.key] = (
          await api<{ id: string }>(
            "/print-requests",
            scenario.input,
            `local_print_${scenario.key}_20261110`,
          )
        ).id;
        await saveState();
      }
      const id: string = state.requests[scenario.key];
      let detail: RequestDetail = await api<RequestDetail>(
        `/print-requests/${id}`,
      );
      if (!detail.issuances.length) {
        let approval = await api<{
          revision: number;
          approval: { proposalId: string; status: string } | null;
        }>(`/print-requests/${id}/approval`);
        if (
          !approval.approval ||
          !["PENDING", "APPROVED"].includes(approval.approval.status)
        )
          approval = await api(`/print-requests/${id}/approval/submit`, {
            expectedRevision: approval.revision,
          });
        assert.ok(approval.approval);
        if (approval.approval.status !== "APPROVED") {
          const proposal = await api<{ proposalHash: string }>(
            `/approvals/${approval.approval.proposalId}`,
          );
          await api(`/approvals/${approval.approval.proposalId}/decision`, {
            decision: "APPROVE",
            reason:
              "Тестовый комплект согласован для локальной проверки печати",
            expectedProposalHash: proposal.proposalHash,
          });
        }
        detail = await api<RequestDetail>(`/print-requests/${id}`);
        if (scenario.render)
          await api(
            `/print-requests/${id}/finalize`,
            { expectedRevision: detail.revision },
            `local_finalize_${scenario.key}_20261110`,
          );
      }
      console.log(
        JSON.stringify({
          scenario: scenario.key,
          requestId: id,
          approved: true,
          renderRequested: scenario.render,
        }),
      );
    }

    const report: {
      synthetic: true;
      tenantId: string;
      templates: number;
      signaturesCreated: number;
      paperAttestationsCreated: number;
      requests: Array<Record<string, unknown>>;
    } = {
      synthetic: true,
      tenantId: context.tenant.id,
      templates: active.length,
      signaturesCreated: 0,
      paperAttestationsCreated: 0,
      requests: [],
    };
    state.merged ||= {};
    for (const scenario of scenarios) {
      const id: string = state.requests[scenario.key];
      if (!scenario.render) {
        report.requests.push({
          title: scenario.title,
          id,
          url: `${origin}/requests/${id}`,
          approved: true,
          awaitingUserPreparation: true,
        });
        continue;
      }
      let detail: RequestDetail = await api<RequestDetail>(
        `/print-requests/${id}`,
      );
      const deadline = Date.now() + 15 * 60 * 1000;
      while (detail.lifecycle !== "AWAITING_SIGNATURE") {
        const failed = detail.jobs.filter((job) => job.status === "FAILED");
        assert.equal(failed.length, 0, JSON.stringify(failed));
        assert.ok(
          Date.now() < deadline,
          "Renderer did not finish within 15 minutes",
        );
        console.log(
          JSON.stringify({
            rendering: scenario.key,
            jobs: detail.jobs.reduce<Record<string, number>>((counts, job) => {
              counts[job.status] = (counts[job.status] || 0) + 1;
              return counts;
            }, {}),
          }),
        );
        await new Promise((done) => setTimeout(done, 5000));
        detail = await api<RequestDetail>(`/print-requests/${id}`);
      }
      const signing = await api<{
        documents: Array<{
          requiredSigners: Array<{ signed: boolean; bindingId: string | null }>;
          paperSignature: unknown;
        }>;
      }>(`/print-requests/${id}/signing`);
      assert.ok(
        signing.documents.every(
          (document) =>
            !document.paperSignature &&
            document.requiredSigners.every(
              (signer) => !signer.signed && signer.bindingId,
            ),
        ),
      );
      if (!state.merged[scenario.key]) {
        const merged = await api<{ artifact: Artifact }>(
          `/print-requests/${id}/print-set`,
          { format: "PDF", issuanceId: detail.issuances[0].id },
        );
        state.merged[scenario.key] = merged.artifact.id;
        await saveState();
      }
      const output = join(root, "print-ready", scenario.key);
      await mkdir(output, { recursive: true });
      const downloads: Array<Record<string, unknown>> = [];
      for (const artifact of detail.artifacts.filter(
        (item) =>
          ["PDF", "DOCX"].includes(item.format) &&
          item.provenance === "ORIGINAL",
      )) {
        const bytes = Buffer.from(
          await (await response(`/artifacts/${artifact.id}`)).arrayBuffer(),
        );
        assert.equal(
          createHash("sha256").update(bytes).digest("hex"),
          artifact.sha256,
        );
        assert.equal(bytes.length, artifact.size);
        const localFile = join(
          output,
          `${artifact.id}.${artifact.format.toLowerCase()}`,
        );
        await writeFile(localFile, bytes);
        downloads.push({
          id: artifact.id,
          fileName: artifact.fileName,
          format: artifact.format,
          size: bytes.length,
          sha256: artifact.sha256,
          localFile,
          url: `${origin}/api/artifacts/${artifact.id}`,
        });
      }
      const mergedId = state.merged[scenario.key];
      const mergedBytes = Buffer.from(
        await (await response(`/artifacts/${mergedId}`)).arrayBuffer(),
      );
      assert.ok(mergedBytes.subarray(0, 5).equals(Buffer.from("%PDF-")));
      const mergedFile = join(
        root,
        "print-ready",
        `${scenario.key === "company" ? "01-Три-работника-БиОТ-ПТМ-ПБ" : "02-Физлицо-БиОТ"}.pdf`,
      );
      await writeFile(mergedFile, mergedBytes);
      report.requests.push({
        title: scenario.title,
        id,
        url: `${origin}/requests/${id}`,
        lifecycle: detail.lifecycle,
        documents: signing.documents.length,
        mergedFile,
        mergedUrl: `${origin}/api/artifacts/${mergedId}`,
        downloads,
      });
    }
    await writeFile(
      join(root, "sample-print-report.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(
      JSON.stringify({
        ready: true,
        report: join(root, "sample-print-report.json"),
        requests: report.requests.map(
          ({ downloads: _downloads, ...request }) => request,
        ),
      }),
    );
  } finally {
    await api("/auth/logout", {});
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

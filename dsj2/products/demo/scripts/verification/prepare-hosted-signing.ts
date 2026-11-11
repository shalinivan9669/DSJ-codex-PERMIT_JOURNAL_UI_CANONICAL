/** Explicit operator helper, never an API route or startup hook.
 * --plan performs no I/O; --provision installs a separate synthetic center;
 * --prepare uses the normal authenticated HTTP workflow and existing worker.
 * Credentials come only from the process environment and are never printed.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { draftSchema, type Draft } from "../../packages/contracts/src";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const required = (env: NodeJS.ProcessEnv, key: string) => {
  const value = env[key];
  assert.ok(value, `${key}_REQUIRED`);
  return value;
};
function origin(value: string) {
  const url = new URL(value);
  assert.equal(value, url.origin, "EXACT_ORIGIN_REQUIRED");
  assert.equal(url.protocol, "https:", "HOSTED_HTTPS_REQUIRED");
  assert.ok(
    !url.username && !url.password && url.hostname.includes("."),
    "PUBLIC_ORIGIN_REQUIRED",
  );
  return value;
}
export function preparationConfig(env: NodeJS.ProcessEnv = process.env) {
  assert.equal(
    env.DEMO_HOSTED_PREPARE_APPLY,
    "1",
    "EXPLICIT_PREPARATION_OPT_IN_REQUIRED",
  );
  const key = required(env, "DEMO_HOSTED_PREPARE_KEY");
  assert.match(key, /^[a-z0-9_-]{8,40}$/, "STABLE_PREPARATION_KEY_REQUIRED");
  const webOrigin = origin(
    required(env, "DEMO_HOSTED_PREPARE_EXPECTED_ORIGIN"),
  );
  const apiOrigin = origin(
    required(env, "DEMO_HOSTED_PREPARE_EXPECTED_API_ORIGIN"),
  );
  assert.equal(env.DEMO_ORIGIN, webOrigin, "WEB_ORIGIN_MISMATCH");
  assert.equal(env.DEMO_API_ORIGIN, apiOrigin, "API_ORIGIN_MISMATCH");
  const email = required(env, "DEMO_HOSTED_PREPARE_EMAIL").toLowerCase();
  assert.match(
    email,
    /^[a-z0-9._+-]+@(?:[a-z0-9-]+\.)+test$/,
    "DEDICATED_SYNTHETIC_EMAIL_REQUIRED",
  );
  const password = required(env, "DEMO_HOSTED_PREPARE_PASSWORD");
  assert.ok(password.length >= 16, "STRONG_PREPARATION_PASSWORD_REQUIRED");
  const date = required(env, "DEMO_HOSTED_PREPARE_DATE");
  assert.match(date, /^\d{4}-\d{2}-\d{2}$/, "FIXED_PREPARATION_DATE_REQUIRED");
  assert.equal(new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10), date);
  return { key, webOrigin, apiOrigin, email, password, date };
}
export function provisionTarget(env: NodeJS.ProcessEnv = process.env) {
  const database = new URL(required(env, "DATABASE_URL"));
  assert.ok(["postgres:", "postgresql:"].includes(database.protocol));
  assert.equal(
    database.hostname,
    required(env, "DEMO_HOSTED_PREPARE_EXPECTED_DB_HOST"),
    "DATABASE_HOST_MISMATCH",
  );
  const databaseName = required(env, "DEMO_HOSTED_PREPARE_EXPECTED_DB_NAME");
  assert.equal(
    decodeURIComponent(database.pathname.slice(1)),
    databaseName,
    "DATABASE_NAME_MISMATCH",
  );
  const storage = required(env, "DEMO_ARTIFACT_ROOT");
  const expectedStorage = required(
    env,
    "DEMO_HOSTED_PREPARE_EXPECTED_ARTIFACT_ROOT",
  );
  assert.ok(
    isAbsolute(storage) && isAbsolute(expectedStorage),
    "ABSOLUTE_STORAGE_ROOT_REQUIRED",
  );
  assert.equal(
    resolve(storage),
    resolve(expectedStorage),
    "ARTIFACT_ROOT_MISMATCH",
  );
  return { databaseName };
}
export function parseCredentialFile(raw: string): {
  version: number;
  email: string;
  key: string;
  password: string;
} {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("CREDENTIAL_FILE_INVALID");
  }
}
async function configuredCredentials(allowCreate: boolean) {
  const env = { ...process.env };
  let generated = false;
  let credentialFile: string | undefined;
  if (!env.DEMO_HOSTED_PREPARE_PASSWORD) {
    credentialFile = required(env, "DEMO_HOSTED_PREPARE_CREDENTIAL_FILE");
    assert.ok(isAbsolute(credentialFile), "ABSOLUTE_CREDENTIAL_FILE_REQUIRED");
    const email = required(env, "DEMO_HOSTED_PREPARE_EMAIL").toLowerCase();
    const key = required(env, "DEMO_HOSTED_PREPARE_KEY");
    try {
      const saved = parseCredentialFile(await readFile(credentialFile, "utf8"));
      assert.equal(saved.version, 1, "CREDENTIAL_FILE_VERSION_MISMATCH");
      assert.equal(saved.email, email, "CREDENTIAL_FILE_EMAIL_MISMATCH");
      assert.equal(saved.key, key, "CREDENTIAL_FILE_KEY_MISMATCH");
      env.DEMO_HOSTED_PREPARE_PASSWORD = saved.password;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      assert.ok(allowCreate, "EXISTING_CREDENTIAL_FILE_REQUIRED");
      env.DEMO_HOSTED_PREPARE_PASSWORD = `Hosted-NCALayer-${randomBytes(24).toString("base64url")}!`;
      // Validate target-independent scope before writing any secret.
      preparationConfig(env);
      await mkdir(dirname(credentialFile), { recursive: true, mode: 0o700 });
      await writeFile(
        credentialFile,
        JSON.stringify(
          {
            version: 1,
            email,
            key,
            password: env.DEMO_HOSTED_PREPARE_PASSWORD,
          },
          null,
          2,
        ),
        { mode: 0o600, flag: "wx" },
      );
      generated = true;
    }
  }
  return { config: preparationConfig(env), generated, credentialFile };
}
const centerName = "Тест NCALayer — Railway";
const directorName = "Тестовый Директор";

async function provisionCenter() {
  const target = provisionTarget();
  const { config, generated, credentialFile } =
    await configuredCredentials(true);
  const { db } = await import("../../apps/api/src/core");
  try {
    const actual = await db.$queryRaw<
      Array<{ name: string }>
    >`SELECT current_database() AS name`;
    assert.equal(
      actual[0]?.name,
      target.databaseName,
      "ACTUAL_DATABASE_MISMATCH",
    );
    const existing = await db.user.findUnique({
      where: { email: config.email },
    });
    if (existing) {
      assert.equal(
        generated,
        false,
        "EXISTING_ACCOUNT_REQUIRES_EXISTING_CREDENTIALS",
      );
      const tenant = await db.tenant.findUniqueOrThrow({
        where: { id: existing.tenantId },
      });
      assert.equal(tenant.demoOnly, true, "EXISTING_ORDINARY_CENTER_REFUSED");
      assert.equal(tenant.name, centerName, "UNRELATED_DEMO_CENTER_REFUSED");
      assert.equal(existing.role, "DIRECTOR", "DEDICATED_DIRECTOR_REQUIRED");
      assert.equal(existing.active, true, "DIRECTOR_DISABLED");
    }
    const { provision } = await import("../setup");
    const result = await provision({
      email: config.email,
      password: config.password,
      name: centerName,
      sample: true,
    });
    console.log(
      JSON.stringify({
        phase: "PROVISIONED",
        synthetic: true,
        tenantId: result.tenantId,
        userId: result.userId,
        credentialFile,
        next: "Set DEMO_HOSTED_SIGNATURE_MOCK=1 and DEMO_HOSTED_SIGNATURE_MOCK_TENANT_ID to this tenant, then run --prepare.",
      }),
    );
  } finally {
    await db.$disconnect();
  }
}

type State = {
  version: 1;
  key: string;
  origin: string;
  apiOrigin: string;
  tenantId: string;
  customerId?: string;
  requests: Record<string, string>;
};
type Detail = {
  id: string;
  revision: number;
  status: string;
  lifecycle: string;
  issuances: Array<{ id: string }>;
  jobs: Array<{ status: string; kind: string }>;
};
type Signing = {
  issuanceId: string;
  status: string;
  testMode: boolean;
  mockMode: string | null;
  providers: { NCALAYER: { available: boolean } };
  documents: Array<{
    artifactId: string | null;
    paperSignature: unknown;
    requiredSigners: Array<{
      kind: string;
      userId: string | null;
      bindingId: string | null;
      canSign: boolean;
      signed: boolean;
    }>;
  }>;
};

export function sampleDraft(
  config: Pick<ReturnType<typeof preparationConfig>, "key" | "date">,
  company: boolean,
  customerId?: string,
): Draft {
  const key = company ? "company" : "person";
  const course = company
    ? {
        id: "pb",
        templateId: "pb-card",
        protocol: "pb-protocol",
        title: "Промышленная безопасность",
        titleKz: "Өнеркәсіптік қауіпсіздік",
        hours: "40",
      }
    : {
        id: "biot",
        templateId: "biot-worker-card",
        protocol: "biot-protocol",
        title: "Безопасность и охрана труда",
        titleKz: "Еңбек қауіпсіздігі және еңбекті қорғау",
        hours: "10",
      };
  const people = company
    ? [
        "Тестов Алексей Андреевич",
        "Образцов Сергей Петрович",
        "Пробный Марат Ерланович",
      ]
    : ["Учебная Анна Сергеевна"];
  const eventId = `${config.key}-${key}-${course.id}`;
  return draftSchema.parse({
    kind: company ? "COMPANY" : "PERSON",
    title: company
      ? "ТЕСТ ЭЦП — три работника / ПБ"
      : "ТЕСТ ЭЦП — физлицо / БиОТ",
    demoMode: true,
    schemaVersion: 2,
    businessRuleVersion: "LIVE_V1",
    customerId: company ? customerId : null,
    commonFields: {
      documentDate: config.date,
      protocolDate: config.date,
      trainingStart: config.date,
      trainingEnd: config.date,
    },
    events: [
      {
        id: eventId,
        title: course.title,
        protocolTemplateId: course.protocol,
        protocolMode: company ? "GROUP" : "INDIVIDUAL",
        protocolModeSource: "MANUAL",
        commonFields: {
          documentDate: config.date,
          protocolDate: config.date,
          trainingStart: config.date,
          trainingEnd: config.date,
          trainingSubject: course.title,
          trainingSubjectKz: course.titleKz,
          hours: course.hours,
          ...(company
            ? {}
            : {
                productionHours: "16",
                biotCategory: "WORKER",
                biotCheckType: "PERIODIC",
              }),
        },
      },
    ],
    items: people.map((fullNameRu, index) => ({
      id: `${config.key}-${key}-${index + 1}`,
      fullNameRu,
      fullNameKz: fullNameRu,
      employeeCategory: "WORKER",
      positionRu: company
        ? ["Электромонтёр", "Слесарь", "Монтажник"][index]
        : "Рабочая",
      positionKz: company
        ? ["Электрмонтер", "Слесарь", "Монтажшы"][index]
        : "Жұмысшы",
      workplaceRu: company
        ? "ТОО Тестовый Монтаж"
        : "Индивидуальное обучение (тест)",
      workplaceKz: company ? "Тест Монтаж ЖШС" : "Жеке оқу (тест)",
      ...(company
        ? { employerId: customerId, personnelNumber: `TEST-${index + 1}` }
        : {}),
      assignments: [
        {
          id: `${config.key}-${key}-${index + 1}-${course.id}`,
          eventId,
          templateId: course.templateId,
          protocolMode: company ? "GROUP" : "INDIVIDUAL",
          result: "Сдал",
          resultKz: "Тапсырды",
          outcome: {
            status: "PASSED",
            source:
              "Синтетический результат для проверки облачного интерфейса; не реальный экзамен",
          },
        },
      ],
    })),
  });
}

async function prepareCenter() {
  const { config } = await configuredCredentials(false);
  const tenantId = required(process.env, "DEMO_HOSTED_PREPARE_TENANT_ID");
  assert.match(tenantId, uuid, "EXACT_TENANT_ID_REQUIRED");
  const checkpoint = required(process.env, "DEMO_HOSTED_PREPARE_STATE");
  assert.ok(isAbsolute(checkpoint), "ABSOLUTE_CHECKPOINT_PATH_REQUIRED");
  let state: State = {
    version: 1,
    key: config.key,
    origin: config.webOrigin,
    apiOrigin: config.apiOrigin,
    tenantId,
    requests: {},
  };
  try {
    const saved = JSON.parse(await readFile(checkpoint, "utf8")) as State;
    for (const key of [
      "version",
      "key",
      "origin",
      "apiOrigin",
      "tenantId",
    ] as const)
      assert.equal(saved[key], state[key], "CHECKPOINT_SCOPE_MISMATCH");
    state = saved;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const save = async () => {
    await mkdir(dirname(checkpoint), { recursive: true });
    await writeFile(checkpoint, JSON.stringify(state, null, 2), {
      mode: 0o600,
    });
  };
  let cookie = "",
    csrf = "";
  async function response(
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ) {
    const result = await fetch(config.apiOrigin + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        origin: config.webOrigin,
        ...(cookie ? { cookie, "x-csrf-token": csrf } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(240000),
      redirect: "error",
    });
    if (!result.ok) {
      const details = (await result.json().catch(() => null)) as {
        code?: unknown;
      } | null;
      const code =
        typeof details?.code === "string" && /^[A-Z0-9_]+$/.test(details.code)
          ? details.code
          : "REQUEST_FAILED";
      throw new Error(`${path} HTTP ${result.status} ${code}`);
    }
    return result;
  }
  async function api<T>(
    path: string,
    body?: unknown,
    key?: string,
  ): Promise<T> {
    return (await response(path, body, key)).json() as Promise<T>;
  }
  const login = await response("/auth/login", {
    email: config.email,
    password: config.password,
  });
  cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  csrf = ((await login.json()) as { csrfToken: string }).csrfToken;
  assert.ok(cookie && csrf, "AUTHENTICATED_SESSION_REQUIRED");
  try {
    const context = await api<{
      tenant: { id: string; name: string; demoOnly: boolean };
      user: { id: string; role: string };
    }>("/context");
    assert.equal(context.tenant.id, tenantId, "AUTHENTICATED_TENANT_MISMATCH");
    assert.equal(context.tenant.demoOnly, true, "ORDINARY_CENTER_REFUSED");
    assert.equal(context.user.role, "DIRECTOR", "DIRECTOR_ACCOUNT_REQUIRED");
    assert.ok(
      [centerName, "Синтетический учебный центр"].includes(context.tenant.name),
      "UNRELATED_DEMO_CENTER_REFUSED",
    );
    const profile = {
      nameRu: centerName,
      nameKz: "ЭЦҚ тест оқу орталығы",
      addressRu: "Синтетический адрес: Кызылорда, учебная улица, 1",
      addressKz: "Сынақ мекенжайы: Қызылорда, оқу көшесі, 1",
      cityRu: "Кызылорда",
      cityKz: "Қызылорда",
      bin: "000000000011",
      approvalBasis: `Синтетический облачный стенд ${config.key}, ${config.date}`,
      headName: directorName,
      approved: true,
      commissionTitle: "Тестовая комиссия",
      commission: [
        directorName,
        "Тестовый Член комиссии Один",
        "Тестовый Член комиссии Два",
      ].map((name, index) => ({
        name,
        position: index ? "Член комиссии (тест)" : "Председатель комиссии",
      })),
      people: [
        {
          name: directorName,
          position: "Тестовый преподаватель",
          role: "TEACHER",
        },
      ],
    };
    const current = await api<Record<string, unknown>>("/settings/profile");
    if (current.approvalBasis !== profile.approvalBasis || !current.approved)
      await api("/settings/profile", profile);
    for (const role of ["DIRECTOR", "CHAIR", "TEACHER"])
      await api("/settings/signatories", {
        userId: context.user.id,
        displayName: directorName,
        role,
        iin: "000000000001",
      });
    const templates = await api<{
      items: Array<{ id: string; approved: boolean }>;
    }>("/settings/templates");
    for (const template of templates.items)
      if (!template.approved)
        await api(`/settings/templates/${template.id}/approve`, {
          approved: true,
        });
    if (!state.customerId) {
      state.customerId = (
        await api<{ id: string }>(
          "/customers",
          {
            nameRu: "ТОО Тестовый Монтаж",
            nameKz: "Тест Монтаж ЖШС",
            bin: "000000000022",
            addressRu: "Синтетический адрес: Кызылорда",
            addressKz: "Сынақ мекенжайы: Қызылорда",
            city: "Кызылорда",
          },
          `${config.key}_customer`,
        )
      ).id;
      await save();
    }
    for (const key of ["company", "person"]) {
      if (!state.requests[key]) {
        state.requests[key] = (
          await api<{ id: string }>(
            "/print-requests",
            sampleDraft(config, key === "company", state.customerId),
            `${config.key}_${key}_request`,
          )
        ).id;
        await save();
      }
      const id = state.requests[key];
      let detail = await api<Detail>(`/print-requests/${id}`);
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
            expectedProposalHash: proposal.proposalHash,
            reason:
              "Синтетический комплект для облачной проверки интерфейса, не реальная выдача",
          });
        }
        detail = await api<Detail>(`/print-requests/${id}`);
        await api(
          `/print-requests/${id}/finalize`,
          {
            expectedRevision: detail.revision,
            expectedProposalId: approval.approval.proposalId,
          },
          `${config.key}_${key}_finalize`,
        );
      }
      console.log(
        JSON.stringify({
          phase: "RENDER_REQUESTED",
          scenario: key,
          requestId: id,
        }),
      );
    }
    for (const [scenario, id] of Object.entries(state.requests)) {
      const deadline = Date.now() + 15 * 60_000;
      let detail = await api<Detail>(`/print-requests/${id}`);
      while (!["AWAITING_SIGNATURE", "ISSUED"].includes(detail.lifecycle)) {
        assert.ok(
          !detail.jobs.some((job) => job.status === "FAILED"),
          "GENERATION_FAILED",
        );
        assert.ok(Date.now() < deadline, "WORKER_RENDER_TIMEOUT");
        console.log(
          JSON.stringify({
            phase: "RENDERING",
            scenario,
            completed: detail.jobs.filter((job) => job.status === "SUCCEEDED")
              .length,
            total: detail.jobs.length,
          }),
        );
        await new Promise((done) => setTimeout(done, 5000));
        detail = await api<Detail>(`/print-requests/${id}`);
      }
      const signing = await api<Signing>(
        `/print-requests/${id}/signing?issuanceId=${encodeURIComponent(detail.issuances[0].id)}`,
      );
      assert.equal(
        signing.mockMode,
        "HOSTED_TEST_MOCK",
        "HOSTED_MODE_NOT_ENABLED",
      );
      assert.equal(signing.testMode, true);
      assert.equal(signing.providers.NCALAYER.available, true);
      assert.ok(signing.documents.length > 0);
      for (const document of signing.documents) {
        assert.ok(
          document.artifactId && !document.paperSignature,
          "ORIGINAL_PDF_REQUIRED",
        );
        assert.deepEqual(
          document.requiredSigners.map((signer) => signer.kind).sort(),
          ["CHAIR", "DIRECTOR", "TEACHER"],
        );
        assert.ok(
          document.requiredSigners.every(
            (signer) => signer.userId === context.user.id && signer.bindingId,
          ),
          "OWN_ROLE_BINDINGS_REQUIRED",
        );
      }
      console.log(
        JSON.stringify({
          phase: "READY",
          scenario,
          requestId: id,
          issuanceId: signing.issuanceId,
          documents: signing.documents.length,
          remainingOwnSignatures: signing.documents
            .flatMap((document) => document.requiredSigners)
            .filter((signer) => !signer.signed).length,
          url: `${config.webOrigin}/requests/${id}#signing`,
          signaturesCreatedByHelper: 0,
        }),
      );
    }
  } finally {
    await api("/auth/logout", {}).catch(() => undefined);
  }
}

async function main() {
  const mode = process.argv[2] || "--plan";
  if (mode === "--plan") {
    console.log(
      JSON.stringify(
        {
          mode: "PLAN_ONLY",
          network: false,
          database: false,
          phases: [
            "--provision: exact DB/storage pins; dedicated synthetic director; provision(sample:true)",
            "Set hosted mock flag and tenant allowlist on API, enable existing worker",
            "--prepare: exact origins/tenant; normal HTTP profile/roles/templates/approval/finalize; wait for immutable PDFs",
          ],
          environment: [
            "DEMO_HOSTED_PREPARE_APPLY=1",
            "DEMO_HOSTED_PREPARE_KEY",
            "DEMO_HOSTED_PREPARE_EMAIL (reserved .test domain)",
            "DEMO_HOSTED_PREPARE_PASSWORD (16+; not printed) OR DEMO_HOSTED_PREPARE_CREDENTIAL_FILE (absolute; generated remotely 0600)",
            "DEMO_HOSTED_PREPARE_DATE",
            "DEMO_HOSTED_PREPARE_EXPECTED_ORIGIN",
            "DEMO_HOSTED_PREPARE_EXPECTED_API_ORIGIN",
            "DEMO_HOSTED_PREPARE_EXPECTED_DB_HOST",
            "DEMO_HOSTED_PREPARE_EXPECTED_DB_NAME",
            "DEMO_HOSTED_PREPARE_EXPECTED_ARTIFACT_ROOT",
            "DEMO_HOSTED_PREPARE_TENANT_ID (prepare)",
            "DEMO_HOSTED_PREPARE_STATE (absolute checkpoint; no credentials)",
          ],
        },
        null,
        2,
      ),
    );
  } else if (mode === "--provision") await provisionCenter();
  else if (mode === "--prepare") await prepareCenter();
  else throw new Error("Use --plan, --provision or --prepare");
}
if (require.main === module)
  void main().catch((error) => {
    console.error(
      JSON.stringify({
        failed: true,
        message: error instanceof Error ? error.message : "PREPARATION_FAILED",
      }),
    );
    process.exitCode = 1;
  });

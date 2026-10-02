import { z } from "@demo/contracts";
import type { Prisma } from "@demo/database";
import {
  audit,
  db,
  fail,
  json,
  parse,
  scopedRequest,
  transaction,
  type Context,
} from "./core";
import { assertStaff } from "./approvals";
import { readArtifact, store } from "./files";
import { runRender } from "@demo/printing";

type RequiredSigner = {
  kind: "DIRECTOR" | "CHAIR" | "MEMBER";
  displayName: string;
  bindingId: string | null;
  iin: string | null;
  bin: string | null;
  userId: string | null;
};
type SigningPolicy = {
  version: 1 | 2;
  signers: RequiredSigner[];
  commission: RequiredSigner[];
  head?: RequiredSigner;
  eventHead?: Record<string, RequiredSigner>;
  eventCommission?: Record<string, RequiredSigner[]>;
  assignmentEvents?: Record<string, string>;
};
const providerSchema = z.enum(["EGOV_QR", "NCALAYER"]);
export function connectorUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return null;
    if (
      url.protocol !== "https:" &&
      !(
        process.env.NODE_ENV === "test" &&
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      )
    )
      return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}
export function signingConfiguration() {
  const verifier = connectorUrl(process.env.DEMO_SIGNATURE_VERIFIER_URL);
  const verifierToken = process.env.DEMO_SIGNATURE_VERIFIER_TOKEN;
  const egov = connectorUrl(process.env.DEMO_EGOV_SIGNING_CONNECTOR_URL);
  const egovToken = process.env.DEMO_EGOV_SIGNING_CONNECTOR_TOKEN;
  return {
    verifier,
    verifierToken,
    egov,
    egovToken,
    providers: {
      NCALAYER: {
        available: !!(verifier && verifierToken),
        reason:
          verifier && verifierToken
            ? null
            : "Не подключён сервер проверки ЭЦП НУЦ РК",
      },
      EGOV_QR: {
        available: !!(verifier && verifierToken && egov && egovToken),
        reason:
          verifier && verifierToken && egov && egovToken
            ? null
            : "Не подключены официальный eGov Mobile QR и сервер проверки ЭЦП",
      },
    },
  };
}
async function connectorRequest(
  base: string,
  path: string,
  token: string,
  body?: unknown,
) {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
    });
  } catch {
    fail(
      503,
      "SIGNING_CONNECTOR_UNAVAILABLE",
      "Сервис электронной подписи временно недоступен",
    );
  }
  if (!response.ok)
    fail(
      503,
      "SIGNING_CONNECTOR_REJECTED",
      "Сервис электронной подписи не подтвердил операцию",
    );
  const text = await response.text();
  if (text.length > 5_000_000)
    fail(502, "SIGNING_RESPONSE_INVALID", "Некорректный ответ сервиса подписи");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    fail(502, "SIGNING_RESPONSE_INVALID", "Некорректный ответ сервиса подписи");
  }
}
export async function prepareSigningPolicy(
  tx: Prisma.TransactionClient,
  c: Context,
  profile: unknown,
  events: { id: string; profile: unknown }[] = [],
  assignments: { id: string; eventId?: string }[] = [],
): Promise<SigningPolicy> {
  const bindings = await tx.signatoryBinding.findMany({
    where: { tenantId: c.tenantId, active: true },
  });
  const staff = await tx.user.findMany({
    where: { tenantId: c.tenantId, active: true },
    select: { id: true, role: true },
  });
  const directors = bindings.filter(
    (binding) =>
      binding.kind === "DIRECTOR" &&
      staff.some(
        (user) => user.id === binding.userId && user.role === "DIRECTOR",
      ),
  );
  if (directors.length > 1)
    fail(
      422,
      "SIGNATORY_AMBIGUOUS",
      "Назначьте одного действующего подписанта директора",
    );
  const director = directors[0];
  const frozen = (
    binding: typeof director,
    kind: RequiredSigner["kind"],
    displayName: string,
  ): RequiredSigner => ({
    kind,
    displayName,
    bindingId: binding?.id || null,
    iin: binding?.iin || null,
    bin: binding?.bin || null,
    userId: binding?.userId || null,
  });
  const commissionFor = (value: unknown) => {
    const members =
      (value as { commission?: { name: string }[] })?.commission || [];
    return Array.from({ length: 3 }, (_, index) => {
      const kind = index === 0 ? "CHAIR" : "MEMBER";
      const name =
        members[index]?.name?.trim() ||
        (index === 0 ? "Председатель комиссии" : `Член комиссии ${index}`);
      const matches = bindings.filter(
        (candidate) =>
          candidate.kind === kind &&
          candidate.displayName.trim() === name &&
          staff.some((user) => user.id === candidate.userId),
      );
      if (matches.length > 1)
        fail(
          422,
          "SIGNATORY_AMBIGUOUS",
          `Неоднозначное назначение подписанта: ${name}`,
        );
      return frozen(matches[0], kind, name);
    });
  };
  const headFor = (value: unknown) => {
    const name =
      (value as { headName?: string })?.headName?.trim() ||
      "Руководитель учебного центра";
    const heads = bindings.filter(
      (candidate) =>
        candidate.displayName.trim() === name &&
        staff.some((user) => user.id === candidate.userId),
    );
    const primary =
      heads.find((candidate) => candidate.kind === "DIRECTOR") || heads[0];
    if (
      heads.some(
        (candidate) =>
          candidate.userId !== primary?.userId ||
          candidate.iin !== primary?.iin ||
          candidate.bin !== primary?.bin,
      )
    )
      fail(
        422,
        "SIGNATORY_AMBIGUOUS",
        `Неоднозначное назначение руководителя: ${name}`,
      );
    return frozen(
      primary,
      (primary?.kind as RequiredSigner["kind"]) || "DIRECTOR",
      name,
    );
  };
  return {
    version: 2,
    signers: [
      frozen(director, "DIRECTOR", director?.displayName || "Директор"),
    ],
    commission: commissionFor(profile),
    head: headFor(profile),
    eventHead: Object.fromEntries(
      events.map((event) => [event.id, headFor(event.profile)]),
    ),
    eventCommission: Object.fromEntries(
      events.map((event) => [event.id, commissionFor(event.profile)]),
    ),
    assignmentEvents: Object.fromEntries(
      assignments
        .filter((assignment) => assignment.eventId)
        .map((assignment) => [assignment.id, assignment.eventId!]),
    ),
  };
}
export async function listSignatories(c: Context) {
  assertStaff(c);
  if (c.role === "VIEWER")
    fail(
      403,
      "ROLE_DENIED",
      "Настройки подписантов доступны сотрудникам центра",
    );
  const items = await db.signatoryBinding.findMany({
    where: { tenantId: c.tenantId },
    orderBy: { createdAt: "desc" },
  });
  return { items: items.map(({ kind, ...item }) => ({ ...item, role: kind })) };
}
export async function saveSignatory(c: Context, input: unknown) {
  if (c.role !== "ADMIN")
    fail(403, "ROLE_DENIED", "Подписантов назначает администратор");
  const data = parse(
    z
      .object({
        userId: z.string().uuid(),
        displayName: z.string().trim().min(2).max(255),
        role: z.enum(["DIRECTOR", "CHAIR", "MEMBER"]),
        iin: z.string().regex(/^\d{12}$/),
        bin: z
          .string()
          .regex(/^\d{12}$/)
          .optional(),
        active: z.boolean().default(true),
      })
      .strict(),
    input,
  );
  return transaction(async (tx) => {
    const user = await tx.user.findFirst({
      where: { tenantId: c.tenantId, id: data.userId, active: true },
    });
    if (
      !user ||
      !["ADMIN", "DIRECTOR", "OPERATOR"].includes(user.role) ||
      (data.role === "DIRECTOR" && user.role !== "DIRECTOR")
    )
      fail(
        422,
        "SIGNATORY_ROLE",
        "Подписант должен быть действующим сотрудником соответствующей роли",
      );
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.tenantId + ":signatory:" + data.userId + ":" + data.role},0))`;
    await tx.signatoryBinding.updateMany({
      where: {
        tenantId: c.tenantId,
        userId: data.userId,
        kind: data.role,
        active: true,
      },
      data: { active: false },
    });
    const binding = await tx.signatoryBinding.create({
      data: {
        tenantId: c.tenantId,
        userId: data.userId,
        displayName: data.displayName,
        kind: data.role,
        iin: data.iin,
        bin: data.bin,
        active: data.active,
        createdBy: c.userId,
      },
    });
    await audit(tx, c, "SIGNATORY_CONFIGURED", binding.id, {
      userId: data.userId,
      kind: data.role,
      active: data.active,
    });
    const { kind, ...value } = binding;
    return { ...value, role: kind };
  });
}
export function signersFor(
  policy: SigningPolicy,
  templateId: string,
  assignmentId?: string | null,
  groupEventId?: string | null,
) {
  const eventId =
    groupEventId || (assignmentId && policy.assignmentEvents?.[assignmentId]);
  const commission =
    (eventId && policy.eventCommission?.[eventId]) || policy.commission;
  const missing = (
    kind: RequiredSigner["kind"],
    displayName: string,
  ): RequiredSigner => ({
    kind,
    displayName,
    bindingId: null,
    iin: null,
    bin: null,
    userId: null,
  });
  const commissionSlots = (count: number) =>
    Array.from(
      { length: count },
      (_, index) =>
        commission[index] ||
        missing(
          index === 0 ? "CHAIR" : "MEMBER",
          index === 0 ? "Председатель комиссии" : `Член комиссии ${index}`,
        ),
    );
  let source: RequiredSigner[];
  if (templateId.endsWith("protocol") || templateId === "ps-card")
    source = commissionSlots(3);
  else if (templateId === "biot-worker-card") source = commissionSlots(2);
  else if (
    ["biot-itr-certificate", "pb-card", "ps-witness"].includes(templateId)
  )
    source = commissionSlots(1);
  else if (templateId === "ptm-card")
    source =
      eventId && policy.eventHead?.[eventId]
        ? [policy.eventHead[eventId]]
        : policy.head
          ? [policy.head]
          : [missing("DIRECTOR", "Руководитель учебного центра")];
  else
    fail(
      422,
      "SIGNING_TEMPLATE_UNSUPPORTED",
      "Для формы не определены обязательные подписанты",
    );
  return [
    ...(policy.signers.length
      ? policy.signers
      : [missing("DIRECTOR", "Директор")]),
    ...source,
  ].filter(
    (value, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.bindingId && candidate.bindingId === value.bindingId,
      ) === index || !value.bindingId,
  );
}
export function assertSigningPolicy(
  policy: SigningPolicy,
  documents: {
    templateId: string;
    assignmentId?: string | null;
    groupEventId?: string | null;
  }[],
) {
  const missing = documents.flatMap((document) =>
    signersFor(
      policy,
      document.templateId,
      document.assignmentId,
      document.groupEventId,
    )
      .filter((signer) => !signer.bindingId)
      .map((signer) => signer.displayName),
  );
  if (missing.length)
    fail(
      422,
      "SIGNATORY_CONFIGURATION_REQUIRED",
      "Назначьте подписантов всех форм перед оформлением",
      { missingBindings: [...new Set(missing)] },
    );
}
async function assertEligible(
  c: Context,
  issuanceId: string,
  tx: Prisma.TransactionClient = db,
) {
  const issuance = await tx.issuance.findFirst({
    where: { id: issuanceId, tenantId: c.tenantId },
  });
  if (!issuance) fail(404, "NOT_FOUND", "Выпуск не найден");
  const request = await scopedRequest(c, issuance.requestId, tx);
  const invalid = await tx.issuanceEvent.findFirst({
    where: {
      tenantId: c.tenantId,
      issuanceId,
      kind: { in: ["CANCELLED", "REPLACED"] },
    },
  });
  if (request.status !== "FINALIZED" || invalid)
    fail(
      409,
      "SIGNING_TARGET_CANCELLED",
      "Отменённый или заменённый выпуск недоступен для подписания",
    );
  return request;
}
export async function signingState(
  c: Context,
  id: string,
  tx: Prisma.TransactionClient = db,
) {
  assertStaff(c);
  const request = await scopedRequest(c, id, tx);
  const workflow = await tx.issuanceWorkflow.findFirst({
    where: { tenantId: c.tenantId, requestId: id },
    orderBy: { createdAt: "desc" },
  });
  const providers = signingConfiguration().providers;
  if (!workflow)
    return {
      status: request.status === "FINALIZED" ? "LEGACY_ISSUED" : null,
      lifecycle: request.status === "FINALIZED" ? "LEGACY_ISSUED" : null,
      archived: !!request.archivedAt,
      providers,
      documents: [],
      missingBindings: [],
      signatures: [],
    };
  const [documents, artifacts, signatures, jobs, invalid] = await Promise.all([
    tx.issuedDocument.findMany({
      where: { tenantId: c.tenantId, issuanceId: workflow.issuanceId },
    }),
    tx.artifact.findMany({
      where: {
        tenantId: c.tenantId,
        issuanceId: workflow.issuanceId,
        provenance: "ORIGINAL",
      },
    }),
    tx.documentSignature.findMany({
      where: { tenantId: c.tenantId, issuanceId: workflow.issuanceId },
    }),
    tx.generationJob.findMany({
      where: {
        tenantId: c.tenantId,
        issuanceId: workflow.issuanceId,
        kind: { not: "ZIP" },
      },
    }),
    tx.issuanceEvent.findFirst({
      where: {
        tenantId: c.tenantId,
        issuanceId: workflow.issuanceId,
        kind: { in: ["CANCELLED", "REPLACED"] },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const policy = workflow.requiredSigners as unknown as SigningPolicy;
  const details = documents.map((document) => {
    const artifact = artifacts.find(
      (item) => item.documentId === document.id && item.format === "PDF",
    );
    const required = signersFor(
      policy,
      document.templateId,
      document.assignmentId,
      document.groupEventId,
    );
    const requiredSigners = required.map((signer) => ({
      kind: signer.kind,
      role: signer.kind,
      displayName: signer.displayName,
      bindingId: signer.bindingId,
      id: signer.bindingId,
      userId: signer.userId,
      canSign:
        signer.userId === c.userId &&
        c.role !== "VIEWER" &&
        request.status === "FINALIZED" &&
        !invalid,
      signed: !!(
        artifact &&
        signer.bindingId &&
        signatures.some(
          (signature) =>
            signature.artifactId === artifact.id &&
            signature.bindingId === signer.bindingId,
        )
      ),
    }));
    return {
      documentId: document.id,
      templateId: document.templateId,
      rowId: document.rowId,
      groupEventId: document.groupEventId,
      number: document.number,
      artifactId: artifact?.id || null,
      fileName: artifact?.fileName || null,
      documentSha256: artifact?.sha256 || null,
      sha256: artifact?.sha256 || null,
      complete: !!artifact && requiredSigners.every((signer) => signer.signed),
      requiredSigners,
    };
  });
  const completeFiles =
    documents.length > 0 &&
    details.every((document) => document.artifactId) &&
    jobs.length > 0 &&
    jobs.every((job) => job.status === "SUCCEEDED");
  const completeSignatures = details.every(
    (document) =>
      document.requiredSigners.length > 0 &&
      document.requiredSigners.every((signer) => signer.signed),
  );
  let intact = true;
  if (completeFiles && completeSignatures && !workflow.completedAt) {
    try {
      for (const job of jobs) {
        const artifact = artifacts.find((value) => value.id === job.artifactId);
        if (!artifact) {
          intact = false;
          break;
        }
        const buffer = await store.read(artifact.storageKey, artifact.sha256);
        if (buffer.length !== artifact.size) {
          intact = false;
          break;
        }
      }
      for (const signature of signatures)
        await store.read(
          signature.signatureStorageKey,
          signature.signatureSha256,
        );
    } catch {
      intact = false;
    }
  }
  const status =
    request.status === "CANCELLED" || invalid
      ? "FAILED"
      : !intact
        ? "FAILED"
        : completeFiles && completeSignatures
          ? "ISSUED"
          : jobs.some((job) => job.status === "FAILED")
            ? "FAILED"
            : completeFiles
              ? "AWAITING_SIGNATURE"
              : "RENDERING";
  if (status !== workflow.status && !workflow.completedAt)
    await tx.issuanceWorkflow.update({
      where: { id: workflow.id },
      data: { status },
    });
  // Only verified signatures plus the entire generated set complete a new issuance.
  if (status === "ISSUED" && !workflow.completedAt) {
    const finish = async (inner: Prisma.TransactionClient) => {
      await inner.$executeRaw`SELECT id FROM "PrintRequest" WHERE id=${id} AND "tenantId"=${c.tenantId} FOR UPDATE`;
      const current = await inner.issuanceWorkflow.findFirst({
        where: { id: workflow.id, tenantId: c.tenantId },
      });
      if (!current || current.completedAt) return;
      await assertEligible(c, workflow.issuanceId, inner);
      await inner.issuanceWorkflow.update({
        where: { id: workflow.id },
        data: { status: "ISSUED", completedAt: new Date() },
      });
      await inner.printRequest.update({
        where: { id },
        data: { archivedAt: new Date() },
      });
      if (request.correctsIssuanceId)
        await inner.issuanceEvent.create({
          data: {
            tenantId: c.tenantId,
            issuanceId: request.correctsIssuanceId,
            kind: "REPLACED",
            reason: request.correctionReason || "Согласованное исправление",
            actorId: c.userId,
            relatedIssuanceId: workflow.issuanceId,
          },
        });
      await audit(inner, c, "ISSUANCE_COMPLETED", workflow.issuanceId, {
        requestId: id,
        archive: true,
        signatures: signatures.length,
      });
    };
    if (tx === db) await transaction(finish);
    else await finish(tx);
  }
  return {
    id: workflow.id,
    issuanceId: workflow.issuanceId,
    status,
    lifecycle: status,
    historicalLifecycle: workflow.completedAt ? "ISSUED" : null,
    invalidatedBy:
      invalid?.kind || (request.status === "CANCELLED" ? "CANCELLED" : null),
    archived: status === "ISSUED" || !!request.archivedAt,
    providers,
    documents: details,
    missingBindings: details.flatMap((document) =>
      document.requiredSigners
        .filter((signer) => !signer.bindingId)
        .map((signer) => signer.displayName),
    ),
    signatures: signatures.map(
      ({
        signatureStorageKey: _storageKey,
        verification: _verification,
        signerIin: _iin,
        signerBin: _bin,
        ...safe
      }) => safe,
    ),
  };
}
const verificationSchema = z
  .object({
    valid: z.literal(true),
    authority: z.literal("NCA_RK"),
    chainValid: z.literal(true),
    revocationStatus: z.literal("GOOD"),
    revocationCheckedAt: z.string().datetime(),
    purpose: z.literal("SIGNATURE"),
    contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
    signerIin: z.string().regex(/^\d{12}$/),
    signerBin: z
      .string()
      .regex(/^\d{12}$/)
      .nullable()
      .optional(),
    certificateSerial: z.string().min(1).max(255),
    certificateFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    notBefore: z.string().datetime(),
    notAfter: z.string().datetime(),
  })
  .strict();
export function assertVerification(
  input: unknown,
  expected: { documentSha256: string; iin: string; bin: string | null },
  now = Date.now(),
) {
  const result = verificationSchema.safeParse(input);
  if (!result.success)
    fail(
      422,
      "SIGNATURE_INVALID",
      "ЭЦП не прошла проверку подписи, цепочки доверия и отзыва",
    );
  const value = result.data;
  if (
    value.contentSha256 !== expected.documentSha256 ||
    value.signerIin !== expected.iin ||
    (expected.bin && value.signerBin !== expected.bin)
  )
    fail(
      422,
      "SIGNATURE_BINDING_MISMATCH",
      "Подпись не соответствует документу или назначенному подписанту",
    );
  if (
    new Date(value.notBefore).getTime() > now ||
    new Date(value.notAfter).getTime() <= now ||
    Math.abs(now - new Date(value.revocationCheckedAt).getTime()) > 5 * 60_000
  )
    fail(
      422,
      "SIGNATURE_CERTIFICATE_STALE",
      "Сертификат истёк или проверка отзыва устарела",
    );
  return value;
}
export async function startSigning(c: Context, id: string, input: unknown) {
  assertStaff(c, true);
  const data = parse(
    z
      .object({
        provider: providerSchema,
        artifactId: z.string().uuid(),
        bindingId: z.string().uuid().optional(),
      })
      .strict(),
    input,
  );
  const configuration = signingConfiguration();
  const request = await scopedRequest(c, id);
  const currentWorkflow = await db.issuanceWorkflow.findFirst({
    where: { requestId: id, tenantId: c.tenantId },
    orderBy: { createdAt: "desc" },
  });
  if (request.status !== "FINALIZED" || !currentWorkflow)
    fail(
      409,
      "SIGNING_NOT_READY",
      "Оформите согласованную заявку перед подписанием",
    );
  await assertEligible(c, currentWorkflow.issuanceId);
  if (!configuration.providers[data.provider].available)
    fail(
      503,
      "SIGNING_PROVIDER_UNAVAILABLE",
      configuration.providers[data.provider].reason ||
        "Сервис подписи не подключён",
    );
  const state = await signingState(c, id);
  if (state.status !== "AWAITING_SIGNATURE")
    fail(
      409,
      "SIGNING_NOT_READY",
      "Дождитесь полного формирования согласованного выпуска",
    );
  const document = state.documents.find(
    (entry) => entry.artifactId === data.artifactId,
  );
  const signer = document?.requiredSigners.find(
    (entry) =>
      entry.userId === c.userId &&
      (!data.bindingId || entry.bindingId === data.bindingId) &&
      !entry.signed,
  );
  if (!document || !signer?.bindingId)
    fail(
      403,
      "SIGNATORY_REQUIRED",
      "У вас нет назначенной непоставленной подписи этого документа",
    );
  if (signer.kind === "DIRECTOR" && c.role !== "DIRECTOR")
    fail(
      403,
      "DIRECTOR_REQUIRED",
      "Подпись директора доступна только директору",
    );
  const binding = await db.signatoryBinding.findFirst({
    where: {
      id: signer.bindingId,
      tenantId: c.tenantId,
      userId: c.userId,
      active: true,
    },
  });
  if (!binding)
    fail(
      409,
      "SIGNATORY_REVOKED",
      "Назначение подписанта отозвано. Подготовьте новый согласованный выпуск",
    );
  const artifact = await readArtifact(c, data.artifactId);
  const session = await db.signingSession.create({
    data: {
      tenantId: c.tenantId,
      issuanceId: state.issuanceId!,
      artifactId: artifact.id,
      bindingId: binding.id,
      provider: data.provider,
      documentSha256: artifact.sha256,
      inputHash: artifact.inputHash,
      createdBy: c.userId,
      expiresAt: new Date(Date.now() + 15 * 60_000),
    },
  });
  const common = {
    id: session.id,
    provider: data.provider,
    status: "PENDING",
    format: "CMS",
    artifactId: artifact.id,
    documentSha256: artifact.sha256,
  };
  if (data.provider === "NCALAYER")
    return {
      ...common,
      dataBase64: artifact.buffer.toString("base64"),
      dataToSign: artifact.buffer.toString("base64"),
      ncalayerRequest: {
        module: "kz.gov.pki.knca.basics",
        method: "sign",
        args: {
          format: "cms",
          data: artifact.buffer.toString("base64"),
          signingParams: { decode: true, encapsulate: false, digested: false },
          signerParams: {
            iin: binding.iin,
            ...(binding.bin ? { bin: binding.bin } : {}),
          },
          locale: "ru",
        },
      },
    };
  const external = parse(
    z
      .object({
        id: z.string().min(1).max(255),
        signingUrl: z.string().url().optional(),
        qrUrl: z.string().url().optional(),
      })
      .strict(),
    await connectorRequest(
      configuration.egov!,
      "/sessions",
      configuration.egovToken!,
      {
        sessionId: session.id,
        documentBase64: artifact.buffer.toString("base64"),
        documentSha256: artifact.sha256,
        format: "CMS_DETACHED",
        signerIin: binding.iin,
        signerBin: binding.bin,
        expiresAt: session.expiresAt.toISOString(),
      },
    ),
  );
  if (
    (!external.signingUrl && !external.qrUrl) ||
    [external.signingUrl, external.qrUrl].some(
      (url) => url && new URL(url).protocol !== "https:",
    )
  )
    fail(
      502,
      "SIGNING_RESPONSE_INVALID",
      "Провайдер не вернул защищённый адрес подписания",
    );
  await db.signingSession.update({
    where: { id: session.id },
    data: { providerReference: external.id },
  });
  const qrTarget = external.signingUrl || external.qrUrl!;
  const qr = await runRender("qr", { url: qrTarget });
  return {
    ...common,
    signingUrl: external.signingUrl,
    qrUrl: external.qrUrl,
    qrTarget,
    qrDataUrl: `data:image/png;base64,${qr.buffer.toString("base64")}`,
  };
}
export async function completeSigning(c: Context, id: string, input: unknown) {
  assertStaff(c, true);
  const data = parse(
    z
      .object({ signatureBase64: z.string().min(20).max(4_000_000).optional() })
      .strict(),
    input,
  );
  const session = await db.signingSession.findFirst({
    where: { id, tenantId: c.tenantId, createdBy: c.userId },
  });
  if (!session) fail(404, "NOT_FOUND", "Сеанс подписания не найден");
  await assertEligible(c, session.issuanceId);
  if (session.status === "VERIFIED")
    return {
      status: "VERIFIED",
      signatureId: (
        await db.documentSignature.findFirst({
          where: { signingSessionId: id, tenantId: c.tenantId },
        })
      )?.id,
    };
  if (session.expiresAt.getTime() <= Date.now() || session.status !== "PENDING")
    fail(409, "SIGNING_SESSION_EXPIRED", "Начните новый сеанс подписания");
  const configuration = signingConfiguration();
  if (!configuration.verifier || !configuration.verifierToken)
    fail(
      503,
      "SIGNATURE_VERIFIER_UNAVAILABLE",
      "Сервер проверки ЭЦП не подключён",
    );
  const [binding, artifact] = await Promise.all([
    db.signatoryBinding.findFirst({
      where: {
        id: session.bindingId,
        tenantId: c.tenantId,
        userId: c.userId,
        active: true,
      },
    }),
    readArtifact(c, session.artifactId),
  ]);
  if (
    !binding ||
    artifact.sha256 !== session.documentSha256 ||
    artifact.inputHash !== session.inputHash
  )
    fail(
      409,
      "SIGNING_TARGET_CHANGED",
      "Назначение или подписываемый документ изменились",
    );
  if (binding.kind === "DIRECTOR" && c.role !== "DIRECTOR")
    fail(
      403,
      "DIRECTOR_REQUIRED",
      "Подпись директора доступна только действующему директору",
    );
  let signatureBase64 = data.signatureBase64;
  if (session.provider === "EGOV_QR") {
    if (
      !configuration.egov ||
      !configuration.egovToken ||
      !session.providerReference
    )
      fail(503, "SIGNING_PROVIDER_UNAVAILABLE", "Сервис eGov QR не подключён");
    const result = parse(
      z
        .object({
          sessionId: z.string(),
          documentSha256: z.string(),
          status: z.literal("SIGNED"),
          signatureBase64: z.string().min(20).max(4_000_000),
        })
        .strict(),
      await connectorRequest(
        configuration.egov,
        `/sessions/${encodeURIComponent(session.providerReference)}`,
        configuration.egovToken,
      ),
    );
    if (result.sessionId !== id || result.documentSha256 !== artifact.sha256)
      fail(
        422,
        "SIGNATURE_BINDING_MISMATCH",
        "Ответ eGov относится к другому документу",
      );
    signatureBase64 = result.signatureBase64;
  }
  if (!signatureBase64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(signatureBase64))
    fail(
      422,
      "SIGNATURE_REQUIRED",
      "Передайте откреплённую CMS-подпись в Base64",
    );
  const verification = assertVerification(
    await connectorRequest(
      configuration.verifier,
      "/verify/cms-detached",
      configuration.verifierToken,
      {
        documentBase64: artifact.buffer.toString("base64"),
        signatureBase64,
        expectedAuthority: "NCA_RK",
        checkRevocation: true,
      },
    ),
    { documentSha256: artifact.sha256, iin: binding.iin, bin: binding.bin },
  );
  const stored = await store.put(Buffer.from(signatureBase64, "base64"), "p7s");
  const signature = await transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "SigningSession" WHERE id=${id} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const active = await tx.signingSession.findFirst({
      where: { id, tenantId: c.tenantId, status: "PENDING" },
    });
    if (!active || active.expiresAt.getTime() <= Date.now())
      fail(409, "SIGNING_SESSION_EXPIRED", "Начните новый сеанс подписания");
    const currentBinding = await tx.signatoryBinding.findFirst({
      where: { id: binding.id, tenantId: c.tenantId, active: true },
    });
    if (!currentBinding)
      fail(409, "SIGNATORY_REVOKED", "Назначение подписанта отозвано");
    const issuance = await tx.issuance.findFirstOrThrow({
      where: { id: session.issuanceId, tenantId: c.tenantId },
    });
    await tx.$executeRaw`SELECT id FROM "PrintRequest" WHERE id=${issuance.requestId} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    await assertEligible(c, session.issuanceId, tx);
    const value = await tx.documentSignature.create({
      data: {
        tenantId: c.tenantId,
        issuanceId: session.issuanceId,
        artifactId: artifact.id,
        bindingId: binding.id,
        signingSessionId: id,
        documentSha256: artifact.sha256,
        signatureSha256: stored.sha256,
        signatureStorageKey: stored.storageKey,
        signerIin: verification.signerIin,
        signerBin: verification.signerBin,
        certificateSerial: verification.certificateSerial,
        certificateFingerprint: verification.certificateFingerprint,
        provider: session.provider,
        verification: json(verification),
        createdBy: c.userId,
      },
    });
    await tx.signingSession.update({
      where: { id },
      data: { status: "VERIFIED" },
    });
    await audit(tx, c, "SIGNATURE_VERIFIED", session.issuanceId, {
      signatureId: value.id,
      artifactId: artifact.id,
      documentSha256: artifact.sha256,
    });
    return value;
  });
  const issuance = await db.issuance.findFirstOrThrow({
    where: { id: session.issuanceId, tenantId: c.tenantId },
  });
  const state = await signingState(c, issuance.requestId);
  return {
    status: "VERIFIED",
    signatureId: signature.id,
    lifecycle: state.status,
  };
}

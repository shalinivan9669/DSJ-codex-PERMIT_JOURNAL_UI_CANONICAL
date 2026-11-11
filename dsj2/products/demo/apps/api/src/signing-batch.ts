import { randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
import { isDirectorRole, z } from "@demo/contracts";
import type { Prisma } from "@demo/database";
import {
  audit,
  db,
  fail,
  hash,
  json,
  parse,
  scopedRequest,
  transaction,
  type Context,
} from "./core";
import { readArtifact } from "./files";
import {
  assertEligible,
  completeSigning,
  mockModeForRequest,
  signingConfiguration,
  signingState,
} from "./signing";
import {
  signingMockModeForProvider,
  signingMockProvider,
} from "./local-signing-mock";

const COMMAND = "START_OWN_SIGNATURE_BATCH";
const MAX_ENTRIES = 100;
const MAX_BASE64_BYTES = 24 * 1024 * 1024;
const manifestSchema = z.object({
  version: z.literal(1),
  requestId: z.string().uuid(),
  issuanceId: z.string().uuid(),
  userId: z.string().uuid(),
  localMock: z.boolean(),
  mockMode: z
    .enum(["LOCAL_TEST_MOCK", "HOSTED_TEST_MOCK"])
    .nullable()
    .optional(),
  expiresAt: z.string().datetime(),
  signerParams: z.object({
    extKeyUsageOids: z.array(z.string()),
    iin: z.string().optional(),
    bin: z.string().optional(),
  }),
  entries: z
    .array(
      z.object({
        sessionId: z.string().uuid(),
        artifactId: z.string().uuid(),
        documentId: z.string().uuid(),
        bindingId: z.string().uuid(),
        documentSha256: z.string(),
        inputHash: z.string(),
        role: z.enum(["DIRECTOR", "CHAIR", "TEACHER", "MEMBER"]),
        displayName: z.string(),
        fileName: z.string(),
      }),
    )
    .min(1)
    .max(MAX_ENTRIES),
});
type Manifest = z.infer<typeof manifestSchema>;
function manifestMockMode(manifest: Manifest) {
  return (
    manifest.mockMode ??
    (manifest.localMock ? ("LOCAL_TEST_MOCK" as const) : null)
  );
}
type BatchResult = {
  sessionId: string;
  artifactId: string;
  bindingId: string;
  status: "COMPLETED" | "FAILED";
  signatureId?: string;
  code?: string;
  error?: string;
  retryable?: boolean;
};

function assertDirector(c: Context) {
  if (!isDirectorRole(c.role))
    fail(403, "DIRECTOR_REQUIRED", "Подписание комплекта доступно директору");
}
async function assertScope(
  c: Context,
  manifest: Manifest,
  tx: Prisma.TransactionClient = db,
) {
  if (manifest.userId !== c.userId)
    fail(404, "NOT_FOUND", "Сеанс подписания комплекта не найден");
  const request = await scopedRequest(c, manifest.requestId, tx);
  await assertEligible(c, manifest.issuanceId, tx);
  const mode = manifestMockMode(manifest);
  if (mode && (await mockModeForRequest(c, request, tx)) !== mode)
    fail(
      403,
      mode === "LOCAL_TEST_MOCK"
        ? "LOCAL_SIGNING_MOCK_DENIED"
        : "HOSTED_SIGNING_MOCK_DENIED",
      "Тестовый режим отключён для этого центра",
    );
}
async function sessionsFor(
  c: Context,
  manifest: Manifest,
  tx: Prisma.TransactionClient = db,
) {
  const sessions = await tx.signingSession.findMany({
    where: {
      tenantId: c.tenantId,
      createdBy: c.userId,
      id: { in: manifest.entries.map((e) => e.sessionId) },
    },
  });
  if (
    sessions.length !== manifest.entries.length ||
    manifest.entries.some((entry) => {
      const session = sessions.find((s) => s.id === entry.sessionId);
      return (
        !session ||
        session.issuanceId !== manifest.issuanceId ||
        session.artifactId !== entry.artifactId ||
        session.bindingId !== entry.bindingId ||
        session.documentSha256 !== entry.documentSha256 ||
        session.inputHash !== entry.inputHash ||
        session.provider !== "NCALAYER" ||
        signingMockModeForProvider(session.providerReference) !==
          manifestMockMode(manifest)
      );
    })
  )
    fail(
      409,
      "SIGNING_BATCH_SESSION_MISMATCH",
      "Состав сеанса подписания не совпадает с сохранённым комплектом",
    );
  return sessions;
}
function assertNotExpired(sessions: { status: string; expiresAt: Date }[]) {
  if (
    sessions.some(
      (s) =>
        s.status !== "VERIFIED" &&
        (s.status !== "PENDING" || s.expiresAt.getTime() <= Date.now()),
    )
  )
    fail(
      409,
      "SIGNING_SESSION_EXPIRED",
      "Начните новый сеанс подписания оставшихся документов",
    );
}
async function startResponse(c: Context, batchId: string, manifest: Manifest) {
  const sessions = await sessionsFor(c, manifest);
  assertNotExpired(sessions);
  const bytes = new Map<string, string>();
  let total = 0;
  const entries = [];
  for (const entry of manifest.entries) {
    let dataBase64 = bytes.get(entry.artifactId);
    if (!dataBase64) {
      const artifact = await readArtifact(c, entry.artifactId);
      if (
        artifact.provenance !== "ORIGINAL" ||
        artifact.format !== "PDF" ||
        artifact.issuanceId !== manifest.issuanceId ||
        artifact.documentId !== entry.documentId ||
        artifact.sha256 !== entry.documentSha256 ||
        artifact.inputHash !== entry.inputHash
      )
        fail(409, "SIGNING_TARGET_CHANGED", "Подписываемый оригинал изменился");
      dataBase64 = artifact.buffer.toString("base64");
      bytes.set(entry.artifactId, dataBase64);
    }
    total += dataBase64.length;
    if (total > MAX_BASE64_BYTES)
      fail(
        413,
        "SIGNING_BATCH_TOO_LARGE",
        "Комплект превышает 24 МБ данных для подписания. Подпишите документы отдельно",
      );
    entries.push({
      ...entry,
      dataBase64,
      status: sessions.find((s) => s.id === entry.sessionId)!.status,
    });
  }
  return {
    batchId,
    issuanceId: manifest.issuanceId,
    provider: "NCALAYER" as const,
    localMock: manifest.localMock,
    mockMode: manifestMockMode(manifest),
    testMode: !!manifestMockMode(manifest),
    expiresAt: manifest.expiresAt,
    signerParams: manifest.signerParams,
    entries,
  };
}

/** Freeze all remaining assignments owned by this director, including their
 * explicit commission/teacher roles. Every (original PDF, role binding) retains
 * its own session and evidence. No key or another person's role is substituted. */
export async function startSigningBatch(
  c: Context,
  id: string,
  input: unknown,
) {
  assertDirector(c);
  const requestId = parse(z.string().uuid(), id);
  const data = parse(
    z
      .object({
        issuanceId: z.string().uuid(),
        operationKey: z.string().uuid(),
      })
      .strict(),
    input,
  );
  const payloadHash = hash({
    requestId,
    issuanceId: data.issuanceId,
    userId: c.userId,
  });
  const saved = await transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.tenantId + ":signature-batch:" + data.operationKey},0))`;
    await tx.$executeRaw`SELECT id FROM "PrintRequest" WHERE id=${requestId} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const request = await scopedRequest(c, requestId, tx);
    const issuance = await tx.issuance.findFirst({
      where: { tenantId: c.tenantId, id: data.issuanceId, requestId },
    });
    if (!issuance) fail(404, "NOT_FOUND", "Выпуск не найден в этой заявке");
    await assertEligible(c, issuance.id, tx);
    const old = await tx.idempotencyOperation.findUnique({
      where: {
        tenantId_command_idempotencyKey: {
          tenantId: c.tenantId,
          command: COMMAND,
          idempotencyKey: data.operationKey,
        },
      },
    });
    if (old) {
      if (old.payloadHash !== payloadHash)
        fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Этот ключ уже использован для другого комплекта",
        );
      const manifest = manifestSchema.parse(old.result);
      await assertScope(c, manifest, tx);
      assertNotExpired(await sessionsFor(c, manifest, tx));
      return { batchId: old.id, manifest };
    }
    const state = await signingState(c, requestId, tx, issuance.id);
    if (state.status === "ISSUED")
      fail(
        409,
        "SIGNING_BATCH_EMPTY",
        "Все доступные вам подписи этого комплекта уже поставлены",
      );
    if (state.status !== "AWAITING_SIGNATURE")
      fail(
        409,
        "SIGNING_NOT_READY",
        "Дождитесь формирования согласованного комплекта",
      );
    const targets = state.documents
      .filter((d) => !d.complete && !d.paperSignature && d.artifactId)
      .flatMap((document) =>
        document.requiredSigners
          .filter(
            (signer) =>
              signer.canSign &&
              !signer.signed &&
              signer.userId === c.userId &&
              signer.bindingId,
          )
          .map((signer) => ({ document, signer })),
      )
      .sort(
        (a, b) =>
          a.document.artifactId!.localeCompare(b.document.artifactId!) ||
          a.signer.kind.localeCompare(b.signer.kind),
      );
    if (!targets.length)
      fail(
        409,
        "SIGNING_BATCH_EMPTY",
        "Все доступные вам подписи этого комплекта уже поставлены",
      );
    if (targets.length > MAX_ENTRIES)
      fail(
        413,
        "SIGNING_BATCH_TOO_LARGE",
        "В комплекте больше 100 подписей. Подпишите документы отдельно",
      );
    const bindings = await tx.signatoryBinding.findMany({
      where: {
        tenantId: c.tenantId,
        userId: c.userId,
        active: true,
        id: { in: targets.map((t) => t.signer.bindingId!) },
      },
    });
    if (
      targets.some(
        (t) =>
          !bindings.some(
            (b) => b.id === t.signer.bindingId && b.kind === t.signer.kind,
          ),
      )
    )
      fail(
        409,
        "SIGNATORY_REVOKED",
        "Назначение подписанта отозвано. Обновите состав комплекта",
      );
    const mockMode = await mockModeForRequest(c, request, tx);
    const localMock = mockMode === "LOCAL_TEST_MOCK";
    if (
      targets.some(({ document, signer }) =>
        state.signatures.some(
          (signature) =>
            signature.artifactId === document.artifactId &&
            signature.bindingId === signer.bindingId &&
            signingMockModeForProvider(signature.provider) !== mockMode,
        ),
      )
    )
      fail(
        409,
        "SIGNATURE_MODE_MISMATCH",
        "Комплект содержит подписи другого режима. Подготовьте новый выпуск для подписания",
      );
    const configuration = signingConfiguration(!!mockMode);
    if (!configuration.providers.NCALAYER.available)
      fail(
        503,
        "SIGNING_PROVIDER_UNAVAILABLE",
        configuration.providers.NCALAYER.reason ||
          "Сервис подписи не подключён",
      );
    const requiredBins = [
      ...new Set(
        bindings.flatMap((binding) => (binding.bin ? [binding.bin] : [])),
      ),
    ];
    if (
      !mockMode &&
      (new Set(bindings.map((binding) => binding.iin)).size !== 1 ||
        requiredBins.length > 1)
    )
      fail(
        409,
        "SIGNING_BATCH_IDENTITY_MISMATCH",
        "Ваши назначения требуют разных сертификатов. Подпишите документы отдельно",
      );
    // Validate every original and the total native request size before creating
    // any session. The manifest and all sessions then commit atomically.
    const artifacts = new Map<
      string,
      Awaited<ReturnType<typeof readArtifact>>
    >();
    let total = 0;
    for (const { document } of targets) {
      let artifact = artifacts.get(document.artifactId!);
      if (!artifact) {
        artifact = await readArtifact(c, document.artifactId!);
        artifacts.set(artifact.id, artifact);
      }
      if (
        artifact.issuanceId !== issuance.id ||
        artifact.provenance !== "ORIGINAL" ||
        artifact.format !== "PDF" ||
        artifact.documentId !== document.documentId ||
        artifact.sha256 !== document.documentSha256
      )
        fail(409, "SIGNING_TARGET_CHANGED", "Подписываемый оригинал изменился");
      total += Math.ceil(artifact.size / 3) * 4;
      if (total > MAX_BASE64_BYTES)
        fail(
          413,
          "SIGNING_BATCH_TOO_LARGE",
          "Комплект превышает 24 МБ данных для подписания. Подпишите документы отдельно",
        );
    }
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    const entries: Manifest["entries"] = [];
    for (const { document, signer } of targets) {
      const artifact = artifacts.get(document.artifactId!)!;
      const sessionId = randomUUID();
      await tx.signingSession.create({
        data: {
          id: sessionId,
          tenantId: c.tenantId,
          issuanceId: issuance.id,
          artifactId: artifact.id,
          bindingId: signer.bindingId!,
          provider: "NCALAYER",
          providerReference: mockMode ? signingMockProvider(mockMode) : null,
          documentSha256: artifact.sha256,
          inputHash: artifact.inputHash,
          createdBy: c.userId,
          expiresAt,
        },
      });
      entries.push({
        sessionId,
        artifactId: artifact.id,
        documentId: document.documentId,
        bindingId: signer.bindingId!,
        documentSha256: artifact.sha256,
        inputHash: artifact.inputHash,
        role: signer.kind,
        displayName: signer.displayName,
        fileName: artifact.fileName,
      });
    }
    const first = bindings[0];
    const manifest: Manifest = {
      version: 1,
      requestId,
      issuanceId: issuance.id,
      userId: c.userId,
      localMock,
      mockMode,
      expiresAt: expiresAt.toISOString(),
      entries,
      signerParams: {
        extKeyUsageOids: ["1.3.6.1.5.5.7.3.4"],
        ...(!mockMode ? { iin: first.iin } : {}),
        ...(!mockMode && requiredBins[0] ? { bin: requiredBins[0] } : {}),
      },
    };
    const operation = await tx.idempotencyOperation.create({
      data: {
        tenantId: c.tenantId,
        command: COMMAND,
        idempotencyKey: data.operationKey,
        payloadHash,
        result: json(manifest),
      },
    });
    await audit(tx, c, "SIGNING_BATCH_STARTED", issuance.id, {
      batchId: operation.id,
      entries: entries.length,
      artifactIds: [...artifacts.keys()],
      roles: [...new Set(entries.map((entry) => entry.role))],
      localMock,
      mockMode,
    });
    return { batchId: operation.id, manifest };
  });
  return startResponse(c, saved.batchId, saved.manifest);
}

export async function completeSigningBatch(
  c: Context,
  id: string,
  input: unknown,
) {
  assertDirector(c);
  const batchId = parse(z.string().uuid(), id);
  const data = parse(
    z
      .object({
        entries: z
          .array(
            z
              .object({
                sessionId: z.string().uuid(),
                signatureBase64: z.string().min(20).max(4_000_000),
              })
              .strict(),
          )
          .min(1)
          .max(MAX_ENTRIES),
      })
      .strict(),
    input,
  );
  if (
    data.entries.reduce(
      (total, entry) => total + entry.signatureBase64.length,
      0,
    ) > MAX_BASE64_BYTES
  )
    fail(
      413,
      "SIGNING_BATCH_TOO_LARGE",
      "Ответ NCALayer превышает допустимый размер 24 МБ",
    );
  const operation = await db.idempotencyOperation.findFirst({
    where: { id: batchId, tenantId: c.tenantId, command: COMMAND },
  });
  if (!operation)
    fail(404, "NOT_FOUND", "Сеанс подписания комплекта не найден");
  const manifest = manifestSchema.parse(operation.result);
  await assertScope(c, manifest);
  const submitted = new Map(
    data.entries.map((entry) => [entry.sessionId, entry.signatureBase64]),
  );
  if (
    submitted.size !== data.entries.length ||
    data.entries.some(
      (entry) =>
        !manifest.entries.some(
          (expected) => expected.sessionId === entry.sessionId,
        ),
    )
  )
    fail(
      409,
      "SIGNING_BATCH_SESSION_MISMATCH",
      "Подпись не относится к этому комплекту или передана дважды",
    );
  const sessions = await sessionsFor(c, manifest);
  const results: BatchResult[] = new Array(manifest.entries.length);
  let cursor = 0;
  // Bound verifier concurrency; individual completion retains its existing
  // session/binding/request locks, validation, immutable evidence and replay.
  async function worker() {
    while (cursor < manifest.entries.length) {
      const index = cursor++;
      const entry = manifest.entries[index];
      const common = {
        sessionId: entry.sessionId,
        artifactId: entry.artifactId,
        bindingId: entry.bindingId,
      };
      try {
        const signatureBase64 = submitted.get(entry.sessionId);
        if (
          !signatureBase64 &&
          sessions.find((s) => s.id === entry.sessionId)!.status !== "VERIFIED"
        )
          fail(
            422,
            "SIGNATURE_REQUIRED",
            "Для документа не получена подпись NCALayer",
          );
        const result = await completeSigning(
          c,
          entry.sessionId,
          signatureBase64 ? { signatureBase64 } : {},
        );
        if (!result.signatureId)
          fail(409, "SIGNATURE_NOT_SAVED", "Сохранённая подпись не найдена");
        results[index] = {
          ...common,
          status: "COMPLETED",
          signatureId: result.signatureId,
        };
      } catch (error) {
        const response =
          error instanceof HttpException ? error.getResponse() : null;
        const detail =
          response && typeof response === "object"
            ? (response as { code?: unknown; message?: unknown })
            : null;
        results[index] = {
          ...common,
          status: "FAILED",
          retryable:
            !(error instanceof HttpException) || error.getStatus() >= 500,
          code:
            typeof detail?.code === "string"
              ? detail.code
              : "SIGNING_BATCH_ITEM_FAILED",
          error:
            typeof detail?.message === "string"
              ? detail.message
              : "Не удалось сохранить подпись. Повторите сохранение",
        };
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(4, manifest.entries.length) }, () =>
      worker(),
    ),
  );
  const completedCount = results.filter(
    (result) => result.status === "COMPLETED",
  ).length;
  return {
    batchId,
    issuanceId: manifest.issuanceId,
    localMock: manifest.localMock,
    mockMode: manifestMockMode(manifest),
    testMode: !!manifestMockMode(manifest),
    status: completedCount === results.length ? "COMPLETED" : "PARTIAL",
    results,
    total: results.length,
    completedCount,
    failedCount: results.length - completedCount,
    remainingCount: results.length - completedCount,
  };
}

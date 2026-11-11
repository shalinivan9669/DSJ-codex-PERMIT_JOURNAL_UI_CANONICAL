import { db, fail, type Context } from "./core";
import type { Prisma } from "@demo/database";
import {
  SIGNING_MOCK_PROVIDERS,
  signingMockMode,
  signingMockModeForProvider,
} from "./local-signing-mock";

export async function persistedSignatureMockMode(
  tenantId: string,
  issuanceId: string,
  tx: Prisma.TransactionClient = db,
) {
  const signature = await tx.documentSignature.findFirst({
    where: { tenantId, issuanceId, provider: { in: SIGNING_MOCK_PROVIDERS } },
    orderBy: { provider: "asc" },
    select: { provider: true },
  });
  return signingMockModeForProvider(signature?.provider);
}

/** Persisted completion of a rehearsal never grants official export elsewhere. */
export async function assertTestMockIssuancesAllowed(
  c: Context,
  issuanceIds: string[],
) {
  if (!issuanceIds.length) return;
  const signatures = await db.documentSignature.findMany({
    where: {
      tenantId: c.tenantId,
      issuanceId: { in: issuanceIds },
      provider: { in: SIGNING_MOCK_PROVIDERS },
    },
    select: { issuanceId: true, provider: true },
    distinct: ["issuanceId", "provider"],
  });
  if (!signatures.length) return;
  const affectedIds = [
    ...new Set(signatures.map((signature) => signature.issuanceId)),
  ];
  const [tenant, issuances] = await Promise.all([
    db.tenant.findFirst({
      where: { id: c.tenantId, active: true },
      select: { demoOnly: true },
    }),
    db.issuance.findMany({
      where: {
        tenantId: c.tenantId,
        id: { in: affectedIds },
      },
      select: { id: true, requestId: true },
    }),
  ]);
  const requests = await db.printRequest.findMany({
    where: {
      tenantId: c.tenantId,
      id: { in: issuances.map((issuance) => issuance.requestId) },
    },
    select: { id: true, demoMode: true },
  });
  if (
    issuances.length !== affectedIds.length ||
    requests.length !==
      new Set(issuances.map((issuance) => issuance.requestId)).size ||
    signatures.some((signature) => {
      const issuance = issuances.find(
        (issuance) => issuance.id === signature.issuanceId,
      );
      const request = requests.find(
        (request) => request.id === issuance?.requestId,
      );
      return (
        !request ||
        signingMockMode({
          tenantId: c.tenantId,
          demoOnly: tenant?.demoOnly === true,
          demoMode: request.demoMode,
        }) !== signingMockModeForProvider(signature.provider)
      );
    })
  )
    fail(
      409,
      signatures.some(
        (signature) =>
          signingMockModeForProvider(signature.provider) === "HOSTED_TEST_MOCK",
      )
        ? "HOSTED_TEST_EXPORT_ONLY"
        : "LOCAL_TEST_EXPORT_ONLY",
      "Комплект с тестовой ЭЦП доступен только в разрешённом тестовом режиме этого центра. Проверка НУЦ не выполнялась",
    );
}
// Retained import name for callers predating the explicit hosted test mode.
export const assertLocalMockIssuancesAllowed = assertTestMockIssuancesAllowed;

/** Reuse the existing official-bundle gate before either buffered or streamed reads. */
export async function assertArtifactDownloadAllowed(
  c: Context,
  artifact: {
    format: string;
    issuanceId: string | null;
    provenance?: string;
    jobId?: string;
  },
) {
  // A saved merged PDF/DOCX can carry test marks too. Its own issuanceId may
  // be null when several issuances were combined; resolve its immutable sources.
  if (artifact.provenance === "PRINT_SET_DERIVATIVE") {
    const job = artifact.jobId
      ? await db.generationJob.findFirst({
          where: { tenantId: c.tenantId, id: artifact.jobId },
          select: { snapshotId: true },
        })
      : null;
    const snapshot = job
      ? await db.renderInputSnapshot.findFirst({
          where: { tenantId: c.tenantId, id: job.snapshotId },
          select: { input: true },
        })
      : null;
    const ids = (snapshot?.input as { sourceArtifactIds?: unknown } | undefined)
      ?.sourceArtifactIds;
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.some((id) => typeof id !== "string")
    )
      fail(
        409,
        "PRINT_SET_SOURCE_MISSING",
        "Не найдены сведения об исходных документах печатного комплекта",
      );
    const sourceIds = [...new Set(ids as string[])];
    const sources = await db.artifact.findMany({
      where: {
        tenantId: c.tenantId,
        id: { in: sourceIds },
        provenance: { not: "PRINT_SET_DERIVATIVE" },
      },
      select: { issuanceId: true },
    });
    if (
      sources.length !== sourceIds.length ||
      sources.some((source) => !source.issuanceId)
    )
      fail(
        409,
        "PRINT_SET_SOURCE_MISSING",
        "Не найдены исходные документы печатного комплекта",
      );
    await assertTestMockIssuancesAllowed(c, [
      ...new Set(sources.map((source) => source.issuanceId!)),
    ]);
  }
  if (!["ZIP", "XLSX"].includes(artifact.format) || !artifact.issuanceId)
    return;
  await assertTestMockIssuancesAllowed(c, [artifact.issuanceId]);
  const workflow = await db.issuanceWorkflow.findFirst({
    where: { tenantId: c.tenantId, issuanceId: artifact.issuanceId },
  });
  if (workflow && workflow.status !== "ISSUED")
    fail(
      409,
      "ISSUANCE_NOT_COMPLETE",
      "Комплект доступен после формирования и обязательных подписей; отдельные PDF доступны для проверки и печати",
    );
  if (
    workflow &&
    artifact.format === "ZIP" &&
    artifact.provenance !== "PRINT_SET_DERIVATIVE"
  )
    fail(
      409,
      "USE_SIGNED_BUNDLE_EXPORT",
      "Скачайте актуальный комплект через экспорт ZIP: он включает проверенные откреплённые подписи и их контрольные суммы",
    );
}

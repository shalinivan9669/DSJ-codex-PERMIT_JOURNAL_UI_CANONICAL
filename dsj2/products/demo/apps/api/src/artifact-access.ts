import { db, fail, type Context } from "./core";

/** Reuse the existing official-bundle gate before either buffered or streamed reads. */
export async function assertArtifactDownloadAllowed(
  c: Context,
  artifact: { format: string; issuanceId: string | null },
) {
  if (!["ZIP", "XLSX"].includes(artifact.format) || !artifact.issuanceId) return;
  const workflow = await db.issuanceWorkflow.findFirst({
    where: { tenantId: c.tenantId, issuanceId: artifact.issuanceId },
  });
  if (workflow && workflow.status !== "ISSUED")
    fail(
      409,
      "ISSUANCE_NOT_COMPLETE",
      "Комплект доступен после формирования и обязательных подписей; отдельные PDF доступны для проверки и печати",
    );
  if (workflow && artifact.format === "ZIP")
    fail(
      409,
      "USE_SIGNED_BUNDLE_EXPORT",
      "Скачайте актуальный комплект через экспорт ZIP: он включает проверенные откреплённые подписи и их контрольные суммы",
    );
}

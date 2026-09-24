import { draftSchema, type Assignment, type Draft } from "@demo/contracts";
import { Prisma } from "@demo/database";
import { db, fail, type Context } from "./core";

type PriorDocument = {
  id: string;
  requestId: string;
  issuanceId: string;
  rowId: string | null;
  assignmentId: string | null;
  templateId: string;
  number: string;
  documentDate: string;
  groupEventId: string | null;
};
export type DuplicateIssuanceWarning = {
  code: "POSSIBLE_REPEAT_ISSUANCE";
  severity: "WARNING";
  rowId: string;
  assignmentId: string;
  message: string;
  candidates: Array<{
    documentId: string;
    requestId: string;
    issuanceId: string;
    number: string;
    documentDate: string;
    status: string;
    historyPath: string;
  }>;
};
function comparable(value: string) {
  return value
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("ru");
}
export function sameHistoricalTraining(
  current: Assignment,
  previous: Assignment,
) {
  if (current.templateId !== previous.templateId) return false;
  if (!current.trainingSubject.trim() || !previous.trainingSubject.trim())
    return false;
  if (
    comparable(current.trainingSubject) !== comparable(previous.trainingSubject)
  )
    return false;
  if (current.biotCategory !== previous.biotCategory) return false;
  // The actual knowledge/training date is evidence; createdAt and date of download are not.
  const currentBasisDate = current.protocolDate || current.trainingEnd;
  const previousBasisDate = previous.protocolDate || previous.trainingEnd;
  return Boolean(
    currentBasisDate &&
    previousBasisDate &&
    currentBasisDate === previousBasisDate,
  );
}
export function findDuplicateIssuances(
  draft: Draft,
  history: Array<{
    id: string;
    requestId: string;
    snapshot: unknown;
    events: string[];
  }>,
  documents: PriorDocument[],
): DuplicateIssuanceWarning[] {
  const parsedHistory = history.flatMap((issued) => {
    const snapshot = issued.snapshot as { draft?: unknown } | null;
    const parsed = draftSchema.safeParse(snapshot?.draft);
    return parsed.success ? [{ ...issued, draft: parsed.data }] : [];
  });
  const warnings: DuplicateIssuanceWarning[] = [];
  for (const row of draft.items) {
    if (!row.recipientId) continue;
    for (const assignment of row.assignments) {
      const candidates: DuplicateIssuanceWarning["candidates"] = [];
      for (const issued of parsedHistory) {
        for (const oldRow of issued.draft.items.filter(
          (old) => old.recipientId === row.recipientId,
        )) {
          for (const oldAssignment of oldRow.assignments.filter((old) =>
            sameHistoricalTraining(assignment, old),
          )) {
            for (const document of documents.filter(
              (document) =>
                document.issuanceId === issued.id &&
                document.templateId === assignment.templateId &&
                document.rowId === oldRow.id &&
                document.assignmentId === oldAssignment.id,
            )) {
              candidates.push({
                documentId: document.id,
                requestId: issued.requestId,
                issuanceId: issued.id,
                number: document.number,
                documentDate: document.documentDate,
                status: issued.events.includes("REPLACED")
                  ? "REPLACED"
                  : issued.events.includes("CANCELLED")
                    ? "CANCELLED"
                    : "ACTIVE_RECORD",
                historyPath: `/requests/${issued.requestId}`,
              });
            }
          }
        }
      }
      if (candidates.length)
        warnings.push({
          code: "POSSIBLE_REPEAT_ISSUANCE",
          severity: "WARNING",
          rowId: row.id,
          assignmentId: assignment.id,
          message:
            "Для этого получателя, программы и даты проверки уже есть выпуск. Откройте историю и сохранённый файл; для нового события проверьте его фактическое основание.",
          candidates: [
            ...new Map(
              candidates.map((candidate) => [candidate.documentId, candidate]),
            ).values(),
          ],
        });
    }
  }
  return warnings;
}
export async function duplicateIssuanceWarnings(
  c: Context,
  draft: Draft,
  tx: Prisma.TransactionClient = db,
  excludeRequestId?: string,
) {
  if (!["ADMIN", "OPERATOR", "VIEWER"].includes(c.role))
    fail(403, "ROLE_DENIED", "Недостаточно прав сотрудника центра");
  const recipientIds = [
    ...new Set(
      draft.items.flatMap((item) =>
        item.recipientId ? [item.recipientId] : [],
      ),
    ),
  ];
  if (!recipientIds.length) return [];
  const history = await tx.issuance.findMany({
    where: {
      tenantId: c.tenantId,
      ...(excludeRequestId ? { requestId: { not: excludeRequestId } } : {}),
      OR: recipientIds.map((recipientId) => ({
        snapshot: {
          path: ["draft", "items"],
          array_contains: [{ recipientId }],
        },
      })),
    },
    select: { id: true, requestId: true, snapshot: true },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });
  const ids = history.map((issued) => issued.id);
  const [documents, events] = await Promise.all([
    tx.issuedDocument.findMany({
      where: {
        tenantId: c.tenantId,
        issuanceId: { in: ids },
        templateId: {
          in: [
            ...new Set(
              draft.items.flatMap((row) =>
                row.assignments.map((a) => a.templateId),
              ),
            ),
          ],
        },
      },
      select: {
        id: true,
        requestId: true,
        issuanceId: true,
        rowId: true,
        assignmentId: true,
        templateId: true,
        number: true,
        documentDate: true,
        groupEventId: true,
      },
    }),
    tx.issuanceEvent.findMany({
      where: { tenantId: c.tenantId, issuanceId: { in: ids } },
      select: { issuanceId: true, kind: true },
    }),
  ]);
  return findDuplicateIssuances(
    draft,
    history.map((issued) => ({
      ...issued,
      events: events
        .filter((event) => event.issuanceId === issued.id)
        .map((event) => event.kind),
    })),
    documents,
  );
}

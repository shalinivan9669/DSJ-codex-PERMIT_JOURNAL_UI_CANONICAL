import { db, type Context } from "../core";
import { Prisma } from "@demo/database";
import { lmsTemplateTypes } from "./document-metadata";
import { isLmsStaff } from "./scope";
import { employerDownloadableResultIds } from "./employer-document-access";

/** Only call with result IDs from a scoped page or a previously authorized enrollment. */
export async function documentViews(c: Context, resultIds: string[]) {
  if (!resultIds.length) return [];
  const downloadable = new Set(
    await employerDownloadableResultIds(c, resultIds),
  );
  const [links, events] = await Promise.all([
    db.lmsDocumentLink.findMany({
      where: { tenantId: c.tenantId, resultId: { in: resultIds } },
    }),
    db.lmsResultEvent.findMany({
      where: {
        tenantId: c.tenantId,
        resultId: { in: resultIds },
        kind: { in: ["VOIDED", "SUPERSEDED"] },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
  ]);
  const issuanceIds = [
    ...new Set(links.flatMap((l) => (l.issuanceId ? [l.issuanceId] : []))),
  ];
  const requestIds = [
    ...new Set(links.filter((l) => !l.issuanceId).map((l) => l.requestId)),
  ];
  const [documents, workflows, proposals] = await Promise.all([
    db.issuedDocument.findMany({
      where: {
        tenantId: c.tenantId,
        OR: links
          .filter((link) => link.issuanceId)
          .map((link) => ({
            issuanceId: link.issuanceId!,
            assignmentId: `${link.resultId}-${link.documentType}`,
          })),
      },
      select: {
        id: true,
        issuanceId: true,
        assignmentId: true,
        templateId: true,
        number: true,
      },
    }),
    issuanceIds.length
      ? db.$queryRaw<
          Array<{
            issuanceId: string;
            status: string | null;
            requestStatus: string;
            invalidatedBy: string | null;
            reason: string | null;
          }>
        >(Prisma.sql`
          SELECT i.id AS "issuanceId",w.status,p.status AS "requestStatus",invalid.kind AS "invalidatedBy",invalid.reason
          FROM "Issuance" i
          JOIN "PrintRequest" p ON p."tenantId"=i."tenantId" AND p.id=i."requestId"
          LEFT JOIN "IssuanceWorkflow" w ON w."tenantId"=i."tenantId" AND w."issuanceId"=i.id
          LEFT JOIN LATERAL (SELECT ev.kind,ev.reason FROM "IssuanceEvent" ev
            WHERE ev."tenantId"=i."tenantId" AND ev."issuanceId"=i.id AND ev.kind IN ('CANCELLED','REPLACED')
            ORDER BY ev."createdAt" DESC,ev.id DESC LIMIT 1) invalid ON true
          WHERE i."tenantId"=${c.tenantId} AND i.id IN (${Prisma.join(issuanceIds)})`)
      : [],
    requestIds.length
      ? db.$queryRaw<
          Array<{
            requestId: string;
            requestStatus: string;
            status: string | null;
          }>
        >(Prisma.sql`
          SELECT p.id AS "requestId",p.status AS "requestStatus",proposal.status FROM "PrintRequest" p
          LEFT JOIN LATERAL (SELECT status FROM "RequestProposal" rp WHERE rp."tenantId"=p."tenantId" AND rp."requestId"=p.id
            ORDER BY revision DESC,id DESC LIMIT 1) proposal ON true
          WHERE p."tenantId"=${c.tenantId} AND p.id IN (${Prisma.join(requestIds)})`)
      : [],
  ]);
  const artifacts = documents.length
    ? await db.$queryRaw<
        Array<{
          id: string;
          documentId: string;
          format: string;
          fileName: string;
          mimeType: string;
        }>
      >(Prisma.sql`SELECT DISTINCT ON ("documentId",format) id,"documentId",format,"fileName","mimeType"
        FROM "Artifact" WHERE "tenantId"=${c.tenantId} AND "documentId" IN (${Prisma.join(documents.map((d) => d.id))})
        AND format IN ('PDF','DOCX') ORDER BY "documentId",format,"createdAt" DESC,id DESC`)
    : [];
  const eventsByResult = new Map<string, (typeof events)[number]>();
  for (const event of events)
    if (!eventsByResult.has(event.resultId))
      eventsByResult.set(event.resultId, event);
  const docsByAssignment = new Map(
    documents.map((d) => [
      `${d.issuanceId}:${d.assignmentId}:${d.templateId}`,
      d,
    ]),
  );
  const workflowsById = new Map(workflows.map((w) => [w.issuanceId, w]));
  const proposalsByRequest = new Map<string, (typeof proposals)[number]>();
  for (const proposal of proposals)
    if (!proposalsByRequest.has(proposal.requestId))
      proposalsByRequest.set(proposal.requestId, proposal);
  const filesByDocument = new Map<string, typeof artifacts>();
  for (const artifact of artifacts) {
    const files = filesByDocument.get(artifact.documentId!) || [];
    if (!files.some((file) => file.format === artifact.format))
      files.push(artifact);
    filesByDocument.set(artifact.documentId!, files);
  }
  return links.map((link) => {
    const {
      verificationTokenHash: _tokenHash,
      verificationUrl,
      ...safeLink
    } = link;
    const event = eventsByResult.get(link.resultId);
    const templateId = Object.entries(lmsTemplateTypes).find(
      ([, value]) => value === link.documentType,
    )?.[0];
    const document = docsByAssignment.get(
      `${link.issuanceId}:${link.resultId}-${link.documentType}:${templateId}`,
    );
    const proposal = proposalsByRequest.get(link.requestId);
    const workflow = workflowsById.get(link.issuanceId || "");
    const workflowStatus = workflow?.status;
    const invalidatedStatus =
      workflow?.invalidatedBy === "REPLACED"
        ? "SUPERSEDED"
        : workflow?.invalidatedBy === "CANCELLED" ||
            workflow?.requestStatus === "CANCELLED" ||
            proposal?.requestStatus === "CANCELLED"
          ? "VOIDED"
          : null;
    const documentStatus =
      workflowStatus === "RENDERING"
        ? "PREPARING"
        : workflowStatus === "FAILED"
          ? "NEEDS_REVIEW"
          : workflowStatus;
    const status =
      event?.kind ||
      invalidatedStatus ||
      documentStatus ||
      (proposal?.status === "REJECTED"
        ? "REJECTED"
        : proposal?.status === "APPROVED"
          ? "PREPARING"
          : "AWAITING_APPROVAL");
    const availableFiles =
      downloadable.has(link.resultId) && (isLmsStaff(c) || status === "ISSUED")
        ? filesByDocument.get(document?.id || "") || []
        : [];
    return {
      ...safeLink,
      verificationManaged: isLmsStaff(c) && Boolean(link.verificationTokenHash),
      verificationUrl:
        status === "ISSUED" &&
        downloadable.has(link.resultId) &&
        !link.verificationRevokedAt &&
        (!link.verificationExpiresAt || link.verificationExpiresAt > new Date())
          ? verificationUrl
          : null,
      number: document?.number || null,
      status,
      reason: event?.reason || workflow?.reason || null,
      artifacts: availableFiles.map(({ id, format, fileName, mimeType }) => ({
        id,
        kind: format,
        fileName,
        mimeType,
      })),
    };
  });
}

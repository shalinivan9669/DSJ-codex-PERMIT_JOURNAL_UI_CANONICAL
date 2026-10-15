import { db, type Context } from "../core";
import { lmsTemplateTypes } from "./document-metadata";

/** Only call with result IDs from a scoped page or a previously authorized enrollment. */
export async function documentViews(c: Context, resultIds: string[]) {
  if (!resultIds.length) return [];
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
      where: { tenantId: c.tenantId, issuanceId: { in: issuanceIds } },
    }),
    db.issuanceWorkflow.findMany({
      where: { tenantId: c.tenantId, issuanceId: { in: issuanceIds } },
    }),
    db.requestProposal.findMany({
      where: { tenantId: c.tenantId, requestId: { in: requestIds } },
      orderBy: [{ revision: "desc" }, { id: "desc" }],
    }),
  ]);
  const artifacts = await db.artifact.findMany({
    where: {
      tenantId: c.tenantId,
      documentId: { in: documents.map((d) => d.id) },
      format: { in: ["PDF", "DOCX"] },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
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
    const event = eventsByResult.get(link.resultId);
    const templateId = Object.entries(lmsTemplateTypes).find(
      ([, value]) => value === link.documentType,
    )?.[0];
    const document = docsByAssignment.get(
      `${link.issuanceId}:${link.resultId}-${link.documentType}:${templateId}`,
    );
    const proposal = proposalsByRequest.get(link.requestId);
    const workflowStatus = workflowsById.get(link.issuanceId || "")?.status;
    const documentStatus =
      workflowStatus === "RENDERING"
        ? "PREPARING"
        : workflowStatus === "FAILED"
          ? "NEEDS_REVIEW"
          : workflowStatus;
    return {
      ...link,
      number: document?.number || null,
      status:
        event?.kind ||
        documentStatus ||
        (proposal?.status === "REJECTED"
          ? "REJECTED"
          : proposal?.status === "APPROVED"
            ? "PREPARING"
            : "AWAITING_APPROVAL"),
      reason: event?.reason || null,
      artifacts: (filesByDocument.get(document?.id || "") || []).map(
        ({ id, format, fileName, mimeType }) => ({
          id,
          kind: format,
          fileName,
          mimeType,
        }),
      ),
    };
  });
}

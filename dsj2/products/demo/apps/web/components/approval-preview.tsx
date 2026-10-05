"use client";
import type { Draft } from "@/lib/types";
import { DocumentPreview } from "./document-preview";
export function ApprovalPreview({ requestId, proposalId, proposalHash, revision, draft }: {
  requestId: string; proposalId: string; proposalHash: string; revision: number;
  draft: Pick<Draft, "items" | "events">;
}) {
  return <section aria-label="PDF переданной редакции">
    <DocumentPreview requestId={requestId} draft={draft}
      source={{ revision, proposalId, expectedProposalHash: proposalHash }} samples />
  </section>;
}

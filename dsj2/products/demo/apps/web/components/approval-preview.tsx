"use client";
import type { Draft } from "@/lib/types";
import { resolveDraft } from "@demo/contracts";
import { DocumentPreview } from "./document-preview";
export function ApprovalPreview({
  requestId,
  proposalId,
  proposalHash,
  revision,
  draft,
}: {
  requestId: string;
  proposalId: string;
  proposalHash: string;
  revision: number;
  draft: Draft;
}) {
  return (
    <section aria-label="PDF переданной редакции">
      <DocumentPreview
        requestId={requestId}
        draft={resolveDraft(draft).draft}
        source={{ revision, proposalId, expectedProposalHash: proposalHash }}
        samples
      />
    </section>
  );
}

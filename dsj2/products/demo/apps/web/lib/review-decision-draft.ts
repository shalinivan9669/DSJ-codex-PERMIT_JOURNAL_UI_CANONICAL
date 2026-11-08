export type ReviewTarget = { targetType: "ATTEMPT" | "SUBMISSION"; id: string };
export type ReviewDecisionDraft = {
  feedback: string;
  scores: Record<string, 0 | 1>;
  decision: string;
  key: string;
  contentHash: string;
  revision: number;
};
export function reviewDraftKey(scope: string, target: ReviewTarget) {
  return `demo:lms:review-draft:${scope}:${target.targetType}:${target.id}`;
}
export function emptyReviewDecision(
  contentHash = "",
  revision = 0,
): ReviewDecisionDraft {
  return {
    feedback: "",
    scores: {},
    decision: "",
    key: crypto.randomUUID(),
    contentHash,
    revision,
  };
}
export function parseReviewDecision(
  raw: string | null,
): ReviewDecisionDraft | null {
  if (!raw || raw.length > 100_000) return null;
  try {
    const value = JSON.parse(raw);
    if (
      !value ||
      value.version !== 1 ||
      typeof value.feedback !== "string" ||
      value.feedback.length > 10_000 ||
      !["", "ACCEPTED", "RETURNED", "REJECTED", "GRADE"].includes(
        value.decision,
      ) ||
      typeof value.key !== "string" ||
      !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value.key) ||
      typeof value.contentHash !== "string" ||
      !/^[a-f0-9]{64}$/i.test(value.contentHash) ||
      !Number.isSafeInteger(value.revision) ||
      value.revision < 1 ||
      !value.scores ||
      typeof value.scores !== "object" ||
      Array.isArray(value.scores)
    )
      return null;
    const entries = Object.entries(value.scores);
    if (
      entries.length > 500 ||
      entries.some(
        ([id, score]) =>
          !id.length || id.length > 100 || (score !== 0 && score !== 1),
      )
    )
      return null;
    return {
      feedback: value.feedback,
      scores: Object.fromEntries(entries) as Record<string, 0 | 1>,
      decision: value.decision,
      key: value.key,
      contentHash: value.contentHash,
      revision: value.revision,
    };
  } catch {
    return null;
  }
}
export function recoverReviewDecision(
  previous: ReviewDecisionDraft | null,
  current: {
    contentHash: string;
    revision: number;
    allowedActions: string[];
    pendingQuestionIds?: string[];
  },
) {
  const empty = emptyReviewDecision(current.contentHash, current.revision);
  if (!previous || !current.allowedActions.length)
    return { draft: empty, changed: false };
  const changed =
    previous.contentHash !== current.contentHash ||
    previous.revision !== current.revision;
  if (changed)
    return { draft: { ...empty, feedback: previous.feedback }, changed: true };
  const scores = Object.fromEntries(
    Object.entries(previous.scores).filter(([id]) =>
      current.pendingQuestionIds?.includes(id),
    ),
  ) as Record<string, 0 | 1>;
  const decision = current.allowedActions.includes(previous.decision)
    ? previous.decision
    : "";
  const adjusted =
    decision !== previous.decision ||
    Object.keys(scores).length !== Object.keys(previous.scores).length;
  return {
    draft: {
      ...previous,
      scores,
      decision,
      key: adjusted ? empty.key : previous.key,
    },
    changed: false,
  };
}

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function clearReviewDecisionStorage(
  storage: Pick<Storage, "length" | "key" | "removeItem">,
  scope: string,
) {
  const prefix = `demo:lms:review-draft:${scope}:`;
  const keys = Array.from({ length: storage.length }, (_, index) =>
    storage.key(index),
  );
  for (const key of keys) if (key?.startsWith(prefix)) storage.removeItem(key);
}
/** Memory remains authoritative until a failed tab-storage write can be retried. */
export class ReviewDecisionDrafts {
  private memory = new Map<string, ReviewDecisionDraft | null>();
  private pending = new Map<string, ReviewDecisionDraft | null>();
  constructor(
    private scope: string,
    private storage: () => DraftStorage,
  ) {}
  get unsaved() {
    return [...this.pending.values()].some((value) => value !== null);
  }
  read(target: ReviewTarget) {
    const key = reviewDraftKey(this.scope, target);
    if (this.memory.has(key)) return this.memory.get(key)!;
    const raw = this.storage().getItem(key);
    const draft = parseReviewDecision(raw);
    if (raw && !draft) this.storage().removeItem(key);
    this.memory.set(key, draft);
    return draft;
  }
  write(target: ReviewTarget, draft: ReviewDecisionDraft) {
    const key = reviewDraftKey(this.scope, target);
    this.memory.set(key, draft);
    this.pending.set(key, draft);
    this.persist(key);
  }
  clear(target: ReviewTarget) {
    const key = reviewDraftKey(this.scope, target);
    this.memory.set(key, null);
    this.pending.set(key, null);
    this.persist(key);
  }
  flush() {
    for (const key of this.pending.keys()) this.persist(key);
  }
  private persist(key: string) {
    const storage = this.storage();
    const value = this.pending.get(key);
    if (value === null) storage.removeItem(key);
    else if (value) {
      const raw = JSON.stringify({
        version: 1,
        feedback: value.feedback,
        scores: value.scores,
        decision: value.decision,
        key: value.key,
        contentHash: value.contentHash,
        revision: value.revision,
      });
      if (!parseReviewDecision(raw)) throw new Error("Invalid review draft");
      storage.setItem(key, raw);
    }
    this.pending.delete(key);
  }
}

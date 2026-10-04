export type TranslationSnapshot = { source: string; destination: string };

/** A proposal only applies to the source and destination that the operator reviewed. */
export function translationReviewIsCurrent(
  snapshot: TranslationSnapshot | null,
  source: string,
  destination: string,
) {
  return (
    !!snapshot &&
    snapshot.source === source &&
    snapshot.destination === destination
  );
}

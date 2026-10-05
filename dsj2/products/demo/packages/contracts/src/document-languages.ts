import type { Draft } from "./index";

/** New work is bilingual RU/KZ. Historical JSON stays readable and is never
 * passed through this write-time policy merely because it is being viewed. */
export const DOCUMENT_LANGUAGE_POLICY = "RU_KZ" as const;

function removeEnglish(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(removeEnglish);
    return;
  }
  const fields = value as Record<string, unknown>;
  for (const key of Object.keys(fields)) {
    if (key.endsWith("En")) delete fields[key];
    else if (key === "englishAppendix") fields[key] = false;
    else if (
      (key === "lineageContext" || key === "lineageOwnContext") &&
      typeof fields[key] === "string"
    ) {
      // Category lineage contains serialized common fields. Apply the same
      // explicit language edit to both sides instead of creating a false
      // conflict from removed English metadata.
      try {
        const context = JSON.parse(fields[key]);
        removeEnglish(context);
        fields[key] = JSON.stringify(context);
      } catch {
        // Preserve an opaque legacy context so the normal conflict guard can
        // ask for an explicit correction instead of guessing its contents.
      }
    } else removeEnglish(fields[key]);
  }
}

/** Use only for a newly edited/submitted draft or a newly resolved RU/KZ draft. */
export function normalizeNewDraftLanguages<T extends Draft>(input: T): T {
  const draft = structuredClone(input);
  delete draft.frozenResolution;
  removeEnglish(draft);
  draft.englishAppendix = false;
  draft.languagePolicy = DOCUMENT_LANGUAGE_POLICY;
  return draft;
}

/** Checks legacy submitted values too, so issuing them cannot silently change
 * the director's frozen data to a different language policy. */
export function hasEnglishDraftValues(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasEnglishDraftValues);
  return Object.entries(value as Record<string, unknown>).some(
    ([key, child]) =>
      key === "englishAppendix"
        ? child === true
        : key.endsWith("En")
          ? typeof child === "string" && !!child.trim()
          : hasEnglishDraftValues(child),
  );
}

export function withoutEnglishProvenance<
  T extends Record<string, Record<string, unknown>>,
>(input: T): T {
  const provenance = structuredClone(input);
  for (const fields of Object.values(provenance))
    for (const key of Object.keys(fields))
      if (key.endsWith("En")) delete fields[key];
  return provenance;
}

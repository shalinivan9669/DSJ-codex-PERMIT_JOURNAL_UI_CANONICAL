/** Tests emptiness without rewriting significant source text. */
export function isBlankText(value: string | null | undefined): boolean {
  return !value || /^[\s\u200B-\u200D\u2060\uFEFF]*$/u.test(value);
}

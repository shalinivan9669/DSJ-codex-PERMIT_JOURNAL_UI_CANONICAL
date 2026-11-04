/** Reuse the initial row only when it still exactly matches a fresh one.
 * Comparing every field protects manually entered data and row settings. */
export function canReuseImportPlaceholder<T extends { id: string }>(rows: T[], freshRow: T): boolean {
  if (rows.length !== 1) return false;
  const { id: _oldId, ...oldValues } = rows[0];
  const { id: _newId, ...freshValues } = freshRow;
  return JSON.stringify(oldValues) === JSON.stringify(freshValues);
}

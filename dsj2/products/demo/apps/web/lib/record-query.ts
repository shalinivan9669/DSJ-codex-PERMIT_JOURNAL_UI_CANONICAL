export function recordQueryKey(
  kind: string,
  search: string,
  page: number,
): string {
  return JSON.stringify([kind, search, page]);
}

/** A response is selectable only for the precise current query and page. */
export function recordQueryIsCurrent(
  current: string,
  loaded: string | undefined,
  failed: string | undefined,
): boolean {
  return current === loaded && current !== failed;
}

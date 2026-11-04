export type ConfirmedBiotGroup = { label: string; requestId: string | null };

export class BiotGroupSubmissionError extends Error {
  constructor(
    message: string,
    readonly confirmed: number,
    readonly total: number,
    readonly currentRequestSent: boolean,
    readonly confirmedGroups: readonly ConfirmedBiotGroup[],
  ) {
    super(message);
    this.name = "BiotGroupSubmissionError";
  }
}

// A request can be saved on the server even if its response is lost.
export async function submitBiotGroups<T>(
  groups: readonly T[],
  submit: (group: T, markRequestSent: () => void) => Promise<string | null | void>,
  groupLabel: (group: T) => string,
): Promise<void> {
  const confirmedGroups: ConfirmedBiotGroup[] = [];
  for (const group of groups) {
    let sent = false;
    try {
      const requestId = await submit(group, () => { sent = true; });
      confirmedGroups.push({ label: groupLabel(group), requestId: requestId || null });
    } catch (error) {
      if (!confirmedGroups.length && !sent) throw error;
      throw new BiotGroupSubmissionError(
        error instanceof Error ? error.message : "Не удалось сформировать заявку.",
        confirmedGroups.length,
        groups.length,
        sent,
        confirmedGroups,
      );
    }
  }
}

export function describeBiotGroupFailure(
  error: BiotGroupSubmissionError,
  historyUpdated: boolean,
): string {
  const labels = error.confirmedGroups.length ? `: ${error.confirmedGroups.map((group) => group.label).join(", ")}` : "";
  const status = `Подтверждено заявок: ${error.confirmed} из ${error.total}${labels}.`;
  const uncertain = error.currentRequestSent
    ? " Последняя отправленная заявка могла сохраниться, даже если ответ не получен."
    : "";
  const history = historyUpdated
    ? " Список заявок обновлён."
    : " Не удалось обновить список заявок.";
  return `${status}${uncertain}${history} Проверьте историю перед повторной отправкой, чтобы не создать дубликаты. Причина: ${error.message}`;
}

// A returned identifier becomes a link only when the refreshed, authorized
// history actually contains that same request.
export function confirmedBiotHistoryLinks(
  error: BiotGroupSubmissionError,
  historyIds: readonly string[],
): Array<{ label: string; requestId: string }> {
  const available = new Set(historyIds);
  const added = new Set<string>();
  return error.confirmedGroups.flatMap(({ label, requestId }) => {
    if (!requestId || !/^[a-zA-Z0-9_-]{1,128}$/.test(requestId) ||
        !available.has(requestId) || added.has(requestId)) return [];
    added.add(requestId);
    return [{ label, requestId }];
  });
}

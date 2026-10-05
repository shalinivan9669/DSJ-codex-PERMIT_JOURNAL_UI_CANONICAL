import { draftPayload, type Draft } from "./types";

export type ConflictCopyAttempt = {
  readonly sourceId: string;
  readonly sourceRevision: number;
  readonly localVersion: number;
  readonly key: string;
  readonly body: string;
};

/** A retry keeps the same immutable body and key, including fresh event IDs. */
export function prepareConflictCopy(
  draft: Draft,
  localVersion: number,
  previous: ConflictCopyAttempt | null,
  newId: () => string = () => crypto.randomUUID(),
): ConflictCopyAttempt {
  if (
    previous?.sourceId === draft.id &&
    previous.sourceRevision === draft.revision &&
    previous.localVersion === localVersion
  )
    return previous;

  const payload = structuredClone(draftPayload(draft));
  const existingEvents = new Map(
    (payload.events || []).map((event) => [event.id, event]),
  );
  const derivedIdentities = new Map<
    string,
    { rootId: string; suffix: string; explicit?: boolean }
  >();
  for (const event of payload.events || []) {
    const rootId =
      event.rootEventId || event.id.replace(/(?:-(?:ITR|WORKER))+$/, "");
    const root = existingEvents.get(rootId);
    if (!root || root.id === event.id) continue;
    if (!event.rootEventId) {
      // Old drafts encode lineage only in the category suffix. Preserve that
      // relationship without adding lineage guards absent from the original.
      derivedIdentities.set(event.id, {
        rootId,
        suffix: event.id.slice(rootId.length),
      });
    } else {
      for (const category of ["ITR", "WORKER"]) {
        if (event.id === `${rootId.slice(0, 64)}-${category}`)
          derivedIdentities.set(event.id, {
            rootId,
            suffix: `-${category}`,
            explicit: true,
          });
      }
    }
  }
  const eventIds = new Map<string, string>();
  const remap = (id: string): string => {
    let fresh = eventIds.get(id);
    if (!fresh) {
      fresh = newId();
      eventIds.set(id, fresh);
    }
    return fresh;
  };
  for (const event of payload.events || []) remap(event.id);

  // Cyclic explicit roots are valid stored references, but cannot be encoded
  // as an ever-growing canonical suffix. Keep their independent fresh IDs.
  const cyclic = new Set<string>();
  const visited = new Set<string>();
  for (const id of derivedIdentities.keys()) {
    const chain: string[] = [];
    const positions = new Map<string, number>();
    let cursor = id;
    while (derivedIdentities.has(cursor) && !visited.has(cursor)) {
      const repeated = positions.get(cursor);
      if (repeated !== undefined) {
        chain.slice(repeated).forEach((entry) => cyclic.add(entry));
        break;
      }
      positions.set(cursor, chain.length);
      chain.push(cursor);
      cursor = derivedIdentities.get(cursor)!.rootId;
    }
    chain.forEach((entry) => visited.add(entry));
  }
  const children = new Map<string, string[]>();
  for (const [id, derived] of derivedIdentities) {
    if (cyclic.has(id)) continue;
    const siblings = children.get(derived.rootId) || [];
    siblings.push(id);
    children.set(derived.rootId, siblings);
  }
  const queue = [...existingEvents.keys()].filter(
    (id) => !derivedIdentities.has(id) || cyclic.has(id),
  );
  const order: string[] = [];
  for (let index = 0; index < queue.length; index++) {
    for (const child of children.get(queue[index]) || []) {
      order.push(child);
      queue.push(child);
    }
  }
  const used = new Set(eventIds.values());
  const pending = new Set(order);
  const candidateFor = (id: string) => {
    const derived = derivedIdentities.get(id)!;
    const root = remap(derived.rootId);
    return `${derived.explicit ? root.slice(0, 64) : root}${derived.suffix}`;
  };
  const assign = (id: string, value: string) => {
    used.delete(remap(id));
    eventIds.set(id, value);
    used.add(value);
    pending.delete(id);
  };
  // Reserve normal canonical and nested suffix identities before compacting
  // longer legacy chains, regardless of their original array order.
  for (const id of order) {
    if (pending.has(derivedIdentities.get(id)!.rootId)) continue;
    const candidate = candidateFor(id);
    if (candidate.length <= 80 && !used.has(candidate)) assign(id, candidate);
  }
  for (const id of order) {
    if (!pending.has(id)) continue;
    const candidate = candidateFor(id);
    if (candidate.length <= 80 && !used.has(candidate)) {
      assign(id, candidate);
      continue;
    }
    const derived = derivedIdentities.get(id)!;
    const prefix = remap(derived.rootId);
    // Two or more tokens never turn an old noncanonical nested identity into
    // root-ITR/root-WORKER, which would change category reuse semantics.
    const suffixes = [
      "-ITR-ITR",
      "-ITR-WORKER",
      "-WORKER-ITR",
      "-WORKER-WORKER",
    ].filter((suffix) => prefix.length + suffix.length <= 80);
    let compact: string | undefined;
    for (let index = 0; index < suffixes.length; index++) {
      const suffix = suffixes[index];
      if (!used.has(prefix + suffix)) {
        compact = prefix + suffix;
        break;
      }
      for (const tail of ["-ITR", "-WORKER"]) {
        if (prefix.length + suffix.length + tail.length <= 80)
          suffixes.push(suffix + tail);
      }
    }
    if (!compact)
      throw new Error(
        "Не удалось подготовить копию: слишком много связанных вариантов обучения. Исходная заявка и ваш ввод не изменены.",
      );
    assign(id, compact);
  }
  for (const event of payload.events || []) {
    event.id = remap(event.id);
    if (event.rootEventId) event.rootEventId = remap(event.rootEventId);
  }
  for (const item of payload.items)
    for (const assignment of item.assignments)
      if (assignment.eventId) assignment.eventId = remap(assignment.eventId);
  for (const policy of payload.trainingDefaults || [])
    policy.eventIds = policy.eventIds.map(remap);

  return {
    sourceId: draft.id,
    sourceRevision: draft.revision,
    localVersion,
    key: `ux-copy-${newId()}`,
    body: JSON.stringify({
      ...payload,
      title: `${draft.title} — копия изменений`,
    }),
  };
}

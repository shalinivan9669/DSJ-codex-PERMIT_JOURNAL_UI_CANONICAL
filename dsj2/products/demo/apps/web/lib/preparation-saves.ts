import {
  preparationKey,
  preparationPrefix,
  writePreparation,
  type PreparationIdentity,
  type PreparationRecord,
  type PreparationScope,
} from "./preparation-storage";

type PreparationSave = {
  key: string;
  identity: PreparationIdentity;
  title?: string;
  dirty: () => boolean;
  flush: () => boolean;
};
type PendingPreparation = {
  record: PreparationRecord<unknown> | null;
  identity?: PreparationIdentity;
  title?: string;
  expectedRaw: string | null;
  error: string;
};
type PreparationStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type UnsavedPreparation = Pick<
  PreparationIdentity,
  "targetId" | "kind"
> & { title?: string };

/** Keep failed drafts across unmounts without blocking another request's work. */
export class PreparationSaves {
  readonly activeSaves = new Map<string, PreparationSave>();
  readonly pendingRecords = new Map<string, PendingPreparation>();
  private readonly detachedSaves = new Set<string>();

  register(id: string, save: PreparationSave) {
    // A remount has loaded the retained candidate (or re-read the invalid raw
    // value). Its live callback replaces the detached owner of that exact key.
    for (const detachedId of this.detachedSaves) {
      if (this.activeSaves.get(detachedId)?.key !== save.key) continue;
      this.activeSaves.delete(detachedId);
      this.detachedSaves.delete(detachedId);
    }
    this.activeSaves.set(id, save);
  }

  release(id: string, saved: boolean) {
    if (saved) {
      this.activeSaves.delete(id);
      this.detachedSaves.delete(id);
    } else if (this.activeSaves.has(id)) this.detachedSaves.add(id);
  }

  needsSave(scope?: PreparationScope) {
    const matches = scopedKeys(scope);
    return (
      [...this.pendingRecords.keys()].some(matches) ||
      [...this.activeSaves.values()].some(
        (save) => matches(save.key) && save.dirty(),
      )
    );
  }

  unsaved(scope: PreparationScope): UnsavedPreparation | undefined {
    const matches = scopedKeys(scope);
    for (const save of this.activeSaves.values()) {
      if (!matches(save.key) || !save.dirty()) continue;
      const pending = this.pendingRecords.get(save.key);
      const target = preparationTarget(
        save.key,
        save.identity,
        pending?.record?.title ?? pending?.title ?? save.title,
      );
      if (target) return target;
    }
    for (const [key, pending] of this.pendingRecords) {
      if (!matches(key)) continue;
      const target = preparationTarget(
        key,
        pending.record?.identity ?? pending.identity,
        pending.record?.title ?? pending.title,
      );
      if (target) return target;
    }
  }

  flush(getStorage: () => PreparationStorage, scope?: PreparationScope) {
    const matches = scopedKeys(scope);
    const saves = [...this.activeSaves.values()].filter((save) =>
      matches(save.key),
    );
    const results = saves.map((save) => save.flush());
    // A collapsed/removed target retains failed preparation in memory until retry.
    for (const [key, pending] of this.pendingRecords) {
      if (!matches(key)) continue;
      if (saves.some((save) => save.key === key && save.dirty())) continue;
      try {
        writePreparation(
          getStorage(),
          key,
          pending.record,
          pending.expectedRaw,
        );
        this.pendingRecords.delete(key);
      } catch {
        results.push(false);
      }
    }
    return results.every(Boolean);
  }
}

function scopedKeys(scope?: PreparationScope) {
  const prefix = scope ? preparationPrefix(scope, scope.requestId) : "";
  return (key: string) => !scope || key.startsWith(prefix);
}

function preparationTarget(
  key: string,
  identity: PreparationIdentity | undefined,
  title: string | undefined,
): UnsavedPreparation | undefined {
  // A corrupted raw record may have no usable identity. Use registered metadata;
  // never infer a focus destination by splitting an untrusted storage key.
  if (!identity || preparationKey(identity) !== key) return;
  return { targetId: identity.targetId, kind: identity.kind, title };
}

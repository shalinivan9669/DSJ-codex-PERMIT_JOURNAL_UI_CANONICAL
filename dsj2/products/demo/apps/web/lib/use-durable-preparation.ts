"use client";
import { useEffect, useId, useRef, useState } from "react";
import { BEFORE_LOGOUT_EVENT } from "./api";
import {
  parsePreparation,
  preparationKey,
  writePreparation,
  type PreparationIdentity,
  type PreparationRecord,
} from "./preparation-storage";

const activeSaves = new Map<
  string,
  { key: string; dirty: () => boolean; flush: () => boolean }
>();
const pendingRecords = new Map<
  string,
  {
    record: PreparationRecord<unknown> | null;
    expectedRaw: string | null;
    error: string;
  }
>();
export function preparationsNeedSave() {
  return (
    pendingRecords.size > 0 ||
    [...activeSaves.values()].some((save) => save.dirty())
  );
}
export function flushPreparations() {
  const results = [...activeSaves.values()].map((save) => save.flush());
  // A collapsed/removed target retains failed preparation in memory until retry.
  for (const [key, pending] of pendingRecords) {
    if (
      [...activeSaves.values()].some((save) => save.key === key && save.dirty())
    )
      continue;
    try {
      writePreparation(localStorage, key, pending.record, pending.expectedRaw);
      pendingRecords.delete(key);
    } catch {
      results.push(false);
    }
  }
  return results.every(Boolean);
}

export function useDurablePreparation<T>({
  identity,
  defaults,
  context,
  revision,
  title,
  validate,
}: {
  identity?: PreparationIdentity;
  defaults: T;
  context: string;
  revision: number;
  title: string;
  validate: (value: unknown) => value is T;
}) {
  const instanceId = useId();
  const key = identity ? preparationKey(identity) : "";
  const [state, setState] = useState<{
    key: string;
    record: PreparationRecord<T> | null;
    status: "loading" | "saved" | "pending" | "error";
    error: string;
  }>({ key: "", record: null, status: "loading", error: "" });
  const current = useRef(state);
  const expectedRaw = useRef<string | null>(null);
  const readFailed = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef({
    identity,
    defaults,
    context,
    revision,
    title,
    validate,
  });
  latest.current = { identity, defaults, context, revision, title, validate };
  function publish(next: typeof state) {
    current.current = next;
    setState(next);
    if (next.key) {
      if (["pending", "error"].includes(next.status) && !readFailed.current)
        pendingRecords.set(next.key, {
          record: next.record,
          expectedRaw: expectedRaw.current,
          error: next.error,
        });
      else pendingRecords.delete(next.key);
    }
  }
  function load() {
    readFailed.current = false;
    try {
      const pending = pendingRecords.get(key);
      if (pending) {
        expectedRaw.current = pending.expectedRaw;
        publish({
          key,
          record: pending.record as PreparationRecord<T> | null,
          status: "error",
          error:
            pending.error ||
            "Подготовка ещё не сохранена в браузере. Повторите сохранение перед выходом.",
        });
        return;
      }
      const raw = key ? localStorage.getItem(key) : null;
      expectedRaw.current = raw;
      const record = identity
        ? parsePreparation(raw, identity, latest.current.validate)
        : null;
      publish({ key, record, status: "saved", error: "" });
    } catch (caught) {
      readFailed.current = true;
      publish({
        key,
        record: null,
        status: "error",
        error:
          caught instanceof Error
            ? caught.message
            : "Браузер не разрешил загрузить подготовку.",
      });
    }
  }
  function flush() {
    clearTimeout(timer.current);
    if (
      current.current.key !== key ||
      !["pending", "error"].includes(current.current.status)
    )
      return true;
    // A failed read is not a deletion candidate. Only an explicit cancellation
    // or new input may replace the scoped raw record after a parsing failure.
    if (readFailed.current) return false;
    try {
      if (!key)
        throw new Error(
          "Подготовка пока не привязана к пользователю. Дождитесь загрузки заявки.",
        );
      expectedRaw.current = writePreparation(
        localStorage,
        key,
        current.current.record,
        expectedRaw.current,
      );
      publish({ ...current.current, status: "saved", error: "" });
      return true;
    } catch (caught) {
      publish({
        ...current.current,
        status: "error",
        error:
          caught instanceof Error
            ? caught.message
            : "Не удалось сохранить подготовку в браузере. Повторите сохранение перед выходом.",
      });
      return false;
    }
  }
  useEffect(() => {
    load();
    const saveId = key + ":" + instanceId;
    if (key)
      activeSaves.set(saveId, {
        key,
        dirty: () =>
          current.current.key === key &&
          ["pending", "error"].includes(current.current.status),
        flush,
      });
    function storageChanged(event: StorageEvent) {
      if (event.key !== key) return;
      if (
        current.current.status === "pending" ||
        current.current.status === "error"
      ) {
        publish({
          ...current.current,
          status: "error",
          error:
            "Подготовка изменена в другом окне. Загрузите сохранённый вариант; ваш ввод остаётся на экране.",
        });
      } else load();
    }
    window.addEventListener("storage", storageChanged);
    return () => {
      const saved = flush();
      if (key && saved) activeSaves.delete(saveId);
      window.removeEventListener("storage", storageChanged);
    };
    // Identity is the storage boundary. Context changes must preserve the candidate.
  }, [key]);
  useEffect(() => {
    function unload(event: BeforeUnloadEvent) {
      if (flushPreparations()) return;
      event.preventDefault();
      event.returnValue = "";
    }
    function logout(event: Event) {
      if (flushPreparations()) return;
      (
        event as CustomEvent<{ waitUntil: (task: Promise<unknown>) => void }>
      ).detail.waitUntil(
        Promise.reject(
          new Error("Сохраните или отмените подготовку перед выходом."),
        ),
      );
    }
    function navigate(event: MouseEvent) {
      const link = (event.target as HTMLElement).closest?.("a");
      if (
        !link ||
        link.target === "_blank" ||
        link.hasAttribute("download") ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        !preparationsNeedSave()
      )
        return;
      if (!flushPreparations()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }
    window.addEventListener("beforeunload", unload);
    window.addEventListener(BEFORE_LOGOUT_EVENT, logout);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener(BEFORE_LOGOUT_EVENT, logout);
      document.removeEventListener("click", navigate, true);
    };
  }, []);
  const visible =
    state.key === key
      ? state
      : { key, record: null, status: "loading" as const, error: "" };
  function setValue(value: T, acceptContext = false) {
    if (!identity || current.current.key !== key) return;
    readFailed.current = false;
    const previous = current.current.record;
    const record: PreparationRecord<T> = {
      version: 1,
      identity,
      title,
      requestRevision: revision,
      context: acceptContext ? context : previous?.context || context,
      savedAt: new Date().toISOString(),
      value,
    };
    publish({ key, record, status: "pending", error: "" });
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 180);
  }
  function discard() {
    readFailed.current = false;
    publish({ key, record: null, status: "pending", error: "" });
    flush();
  }
  return {
    value: visible.record?.value || defaults,
    record: visible.record,
    status: visible.status,
    error: visible.error,
    stale: !!visible.record && visible.record.context !== context,
    setValue,
    discard,
    retry: () => {
      if (!readFailed.current) return flush();
      load();
      return current.current.status === "saved";
    },
    reload: () => {
      pendingRecords.delete(key);
      load();
    },
    acceptContext: () => setValue(visible.record?.value || defaults, true),
  };
}

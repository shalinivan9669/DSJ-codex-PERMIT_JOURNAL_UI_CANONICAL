"use client";

import { useEffect, useRef } from "react";

type NavigationWindow = Window & {
  navigation?: { currentEntry?: { index: number } };
  __demoUnsavedNavigation?: { onPopstate?: (event: PopStateEvent) => void };
};

// Register while the application module loads, before Next installs its effect
// listener. A window-targeted event cannot rely on capture to reorder listeners.
// The singleton also avoids duplicate listeners after a development hot reload.
const dispatcher =
  typeof window === "undefined"
    ? undefined
    : ((window as NavigationWindow).__demoUnsavedNavigation ??= (() => {
        const value: { onPopstate?: (event: PopStateEvent) => void } = {};
        window.addEventListener(
          "popstate",
          (event) => value.onPopstate?.(event),
          true,
        );
        return value;
      })());

/** Keep Next's popstate listener from unmounting an editor before its save settles. */
export function useUnsavedNavigation({
  requestId,
  dirty,
  flush,
  onError,
  replace,
}: {
  requestId: string;
  dirty: () => boolean;
  flush: () => Promise<unknown>;
  onError: (error: unknown) => void;
  replace: (url: string) => void;
}) {
  const latest = useRef({ dirty, flush, onError, replace });
  latest.current = { dirty, flush, onError, replace };
  useEffect(() => {
    const browser = window as NavigationWindow;
    let active = true;
    let saving = false;
    let state: "idle" | "restoring" | "saving" | "leaving" = "idle";
    let editorUrl = window.location.href;
    let editorState = window.history.state;
    let editorIndex = browser.navigation?.currentEntry?.index;
    let pending: { delta?: number; url: string } | undefined;

    const saveAndLeave = async () => {
      if (!pending || !active || saving) return;
      saving = true;
      state = "saving";
      try {
        await latest.current.flush();
        if (!active || !pending) return;
        state = "leaving";
        if (pending.delta !== undefined) window.history.go(-pending.delta);
        else latest.current.replace(pending.url);
      } catch (error) {
        if (active) latest.current.onError(error);
        pending = undefined;
        state = "idle";
      } finally {
        saving = false;
      }
    };
    const popstate = (event: PopStateEvent) => {
      if (!active) return;
      if (state === "leaving") {
        if (!latest.current.dirty()) return;
        // A final keystroke can land between flush completion and the queued
        // history traversal. Capture and save it before allowing that traversal.
        state = "idle";
      }
      const editor = new URL(editorUrl);
      if (
        state === "idle" &&
        window.location.pathname === editor.pathname &&
        window.location.search === editor.search
      ) {
        // Fragment traversal remains ordinary in-page navigation.
        editorUrl = window.location.href;
        editorState = window.history.state;
        editorIndex = browser.navigation?.currentEntry?.index;
        return;
      }
      if (state === "idle" && !latest.current.dirty()) return;
      // The module dispatcher runs before Next; the editor stays mounted.
      event.stopImmediatePropagation();
      if (state === "restoring" && window.location.href === editorUrl) {
        void saveAndLeave();
        return;
      }
      const destinationIndex = browser.navigation?.currentEntry?.index;
      const delta =
        editorIndex !== undefined && destinationIndex !== undefined
          ? editorIndex - destinationIndex
          : undefined;
      if (state === "idle") {
        pending = { delta: delta || undefined, url: window.location.href };
      }
      if (delta) {
        state = "restoring";
        window.history.go(delta);
      } else {
        // Older browsers do not expose history indices. Preserve the editor
        // and its input, then replace the destination only after a good save.
        window.history.pushState(editorState, "", editorUrl);
        if (state !== "saving") void saveAndLeave();
      }
    };
    if (dispatcher) dispatcher.onPopstate = popstate;
    return () => {
      active = false;
      if (dispatcher?.onPopstate === popstate)
        dispatcher.onPopstate = undefined;
    };
  }, [requestId]);
}

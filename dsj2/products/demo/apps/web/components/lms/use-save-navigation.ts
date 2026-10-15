"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useUnsavedNavigation } from "@/lib/use-unsaved-navigation";

/** Reuse DEMO's history protection; links leave only after the active save succeeds. */
export function useLmsSaveNavigation(
  id: string,
  dirty: () => boolean,
  flush: () => Promise<unknown>,
  onError: (error: unknown) => void,
) {
  const router = useRouter();
  const latest = useRef({ dirty, flush, onError });
  latest.current = { dirty, flush, onError };
  useUnsavedNavigation({
    requestId: id,
    dirty,
    flush,
    onError,
    replace: router.replace,
  });
  useEffect(() => {
    const navigate = (event: MouseEvent) => {
      const link = (event.target as HTMLElement).closest("a");
      if (
        !link ||
        !latest.current.dirty() ||
        link.target === "_blank" ||
        link.hasAttribute("download") ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      const target = new URL(link.href);
      if (
        target.origin !== window.location.origin ||
        target.pathname.startsWith("/api/") ||
        (target.pathname === window.location.pathname &&
          target.search === window.location.search)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      void latest.current
        .flush()
        .then(() => router.push(target.pathname + target.search + target.hash))
        .catch((error) => latest.current.onError(error));
    };
    document.addEventListener("click", navigate, true);
    return () => document.removeEventListener("click", navigate, true);
  }, [router]);
}

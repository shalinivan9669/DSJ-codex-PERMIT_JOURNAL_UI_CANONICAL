"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";

export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      tabIndex={-1}
      aria-labelledby={heading}
      className={wide ? "modal modal-wide" : "modal"}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            "button, a[href], input, select, textarea, summary, [tabindex]",
          ),
        ).filter(
          (element) =>
            element.tabIndex >= 0 &&
            !element.matches(":disabled, [aria-hidden=true]") &&
            element.getClientRects().length > 0,
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first) {
          event.preventDefault();
          event.currentTarget.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="modal-head">
        <h2 id={heading}>{title}</h2>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Закрыть диалог"
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function Icon({
  name,
  size = 20,
}: {
  name:
    | "print"
    | "plus"
    | "person"
    | "company"
    | "download"
    | "check"
    | "search"
    | "chevron"
    | "upload";
  size?: number;
}) {
  const paths = {
    print: (
      <>
        <path d="M6 9V3h12v6M6 17H3V9h18v8h-3" />
        <path d="M6 14h12v7H6zM17 11h1" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    person: (
      <>
        <circle cx="12" cy="7" r="4" />
        <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
      </>
    ),
    company: (
      <>
        <path d="M4 21V3h12v18M16 9h4v12M2 21h20M8 7h4M8 11h4M8 15h4M10 21v-3" />
      </>
    ),
    download: <path d="M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6" />,
    check: <path d="m5 12 4 4L19 6" />,
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 6 6" />
      </>
    ),
    chevron: <path d="m9 5 7 7-7 7" />,
    upload: <path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

export function Notice({
  children,
  kind = "error",
}: {
  children: ReactNode;
  kind?: "error" | "info" | "success";
}) {
  return (
    <div
      className={`notice ${kind}`}
      role={kind === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}

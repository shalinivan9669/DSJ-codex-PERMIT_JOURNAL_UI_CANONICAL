"use client";

import { useEffect, useRef, useState } from "react";
import { Notice } from "@demo/ui";

/** Print every saved PDF page at its physical size, including mixed page sizes. */
export async function printPdfArtifact(artifactId: string) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const task = pdfjs.getDocument({
    url: `/api/artifacts/${encodeURIComponent(artifactId)}?inline=1`,
    withCredentials: true,
  });
  const frame = document.createElement("iframe");
  frame.className = "pdf-print-frame";
  frame.title = "Печать сохранённого PDF";
  frame.setAttribute("aria-hidden", "true");
  document.body.append(frame);
  try {
    const pdf = await task.promise;
    const target = frame.contentDocument;
    if (!target || !frame.contentWindow)
      throw new Error("Окно печати недоступно");
    const style = target.createElement("style");
    style.textContent =
      "html,body{margin:0;padding:0}img{display:block}section{break-after:page;overflow:hidden}section:last-child{break-after:auto}@page{margin:0}";
    target.head.append(style);
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const size = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: 300 / 72 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      const section = target.createElement("section");
      section.style.page = `pdfPage${number}`;
      section.style.width = `${size.width}pt`;
      section.style.height = `${size.height}pt`;
      style.textContent += `@page pdfPage${number}{size:${size.width}pt ${size.height}pt;margin:0}`;
      const picture = target.createElement("img");
      picture.alt = `Страница ${number}`;
      picture.style.width = `${size.width}pt`;
      picture.style.height = `${size.height}pt`;
      picture.src = canvas.toDataURL("image/png");
      section.append(picture);
      target.body.append(section);
      await picture.decode();
      canvas.width = canvas.height = 0;
    }
    frame.contentWindow.addEventListener("afterprint", () => frame.remove(), {
      once: true,
    });
    frame.contentWindow.focus();
    frame.contentWindow.print();
    // Embedded browsers may suppress native print UI; don't retain a hidden document indefinitely.
    setTimeout(() => frame.remove(), 120000);
  } catch (error) {
    frame.remove();
    throw error;
  } finally {
    await task.destroy();
  }
}

/** Displays the saved PDF bytes without depending on a browser PDF plug-in. */
export function PdfPreview({ artifactId }: { artifactId: string }) {
  const pages = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let task: { destroy: () => Promise<void> } | undefined;
    const controller = new AbortController();
    const root = pages.current;
    root?.replaceChildren();
    setLoading(true);
    setError("");
    const timeout = setTimeout(() => {
      if (cancelled) return;
      cancelled = true;
      controller.abort();
      void task?.destroy().catch(() => {});
      root?.replaceChildren();
      setLoading(false);
      setError(
        "Открытие PDF заняло больше 30 секунд. Проверьте связь и повторите открытие.",
      );
    }, 30_000);
    void (async () => {
      const pdfjs = await import("pdfjs-dist");
      if (cancelled || !root) return;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      // Fetch once so the storage error code remains available; pdf.js only
      // reports an HTTP status for URL loading and cannot distinguish a lost
      // saved artifact from a temporary upstream failure.
      const response = await fetch(
        `/api/artifacts/${encodeURIComponent(artifactId)}?inline=1`,
        {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        let code = "";
        try {
          code = ((await response.json()) as { code?: string }).code || "";
        } catch {
          /* A proxy may return a non-JSON error body. */
        }
        throw Object.assign(new Error("PDF_DOWNLOAD_FAILED"), {
          name:
            response.status === 404 || code === "ARTIFACT_UNAVAILABLE"
              ? "MissingPDFException"
              : "UnexpectedResponseException",
          status: response.status,
        });
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (cancelled) return;
      const loadingTask = pdfjs.getDocument({ data: bytes });
      task = loadingTask;
      const pdf = await loadingTask.promise;
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        if (cancelled) return;
        const page = await pdf.getPage(pageNumber);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(
          1.5,
          Math.max(0.5, (root.clientWidth - 32) / base.width),
        );
        const viewport = page.getViewport({ scale });
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width * pixelRatio);
        canvas.height = Math.ceil(viewport.height * pixelRatio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        canvas.setAttribute("role", "img");
        canvas.setAttribute(
          "aria-label",
          `Страница ${pageNumber} из ${pdf.numPages}`,
        );
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Не удалось открыть просмотр PDF");
        await page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform:
            pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
        }).promise;
        if (cancelled) return;
        const label = document.createElement("p");
        label.textContent = `Страница ${pageNumber} из ${pdf.numPages}`;
        root.append(label, canvas);
      }
      if (!cancelled) {
        clearTimeout(timeout);
        setLoading(false);
      }
    })().catch((cause) => {
      if (!cancelled) {
        clearTimeout(timeout);
        root?.replaceChildren();
        console.error("PDF preview failed", cause);
        const failure = cause as { name?: string; status?: number };
        setError(
          failure.name === "MissingPDFException" || failure.status === 404
            ? "Файл PDF отсутствует в хранилище. Повторите подготовку предпросмотра."
            : failure.name === "InvalidPDFException"
              ? "Сохранённый файл не удалось прочитать как PDF. Повторите подготовку или скачайте DOCX."
              : "Не удалось загрузить или показать PDF. Проверьте связь и повторите открытие.",
        );
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
      void task?.destroy().catch(() => {});
    };
  }, [artifactId, retry]);
  return (
    <>
      {loading && <p role="status">Открываем страницы PDF…</p>}
      {error && (
        <Notice>
          {error}{" "}
          <button onClick={() => setRetry((value) => value + 1)}>
            Повторить открытие PDF
          </button>
        </Notice>
      )}
      <div
        className="pdf-pages"
        ref={pages}
        aria-label="Страницы сохранённого PDF"
      />
    </>
  );
}

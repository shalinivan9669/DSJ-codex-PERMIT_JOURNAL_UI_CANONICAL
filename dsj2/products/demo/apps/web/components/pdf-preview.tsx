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
  useEffect(() => {
    let cancelled = false;
    let task: { destroy: () => Promise<void> } | undefined;
    const root = pages.current;
    root?.replaceChildren();
    setLoading(true);
    setError("");
    void (async () => {
      const pdfjs = await import("pdfjs-dist");
      if (cancelled || !root) return;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      const loadingTask = pdfjs.getDocument({
        url: `/api/artifacts/${encodeURIComponent(artifactId)}?inline=1`,
        withCredentials: true,
      });
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
      if (!cancelled) setLoading(false);
    })().catch((cause) => {
      console.error("PDF preview failed", cause);
      if (!cancelled) {
        setError(
          "Не удалось показать PDF. Скачайте сохранённый файл или повторно откройте просмотр.",
        );
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [artifactId]);
  return (
    <>
      {loading && <p role="status">Открываем страницы PDF…</p>}
      {error && <Notice>{error}</Notice>}
      <div
        className="pdf-pages"
        ref={pages}
        aria-label="Страницы сохранённого PDF"
      />
    </>
  );
}

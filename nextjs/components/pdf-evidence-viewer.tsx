"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import styles from "./pdf-evidence-viewer.module.css";

type Props = {
  url: string;
  page: number;
  bbox: [number, number, number, number];
  label: string;
};

export default function PdfEvidenceViewer({ url, page, bbox, label }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => setWidth(Math.max(1, Math.floor(container.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width < 1 || !Number.isSafeInteger(page) || page < 1) return;
    let cancelled = false;
    let renderTask: { cancel: () => void } | null = null;
    let loadingTask: { destroy: () => Promise<void> } | null = null;
    setState("loading");

    void (async () => {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      const task = pdfjs.getDocument({ url, withCredentials: false });
      loadingTask = task;
      const document = await task.promise;
      if (cancelled || page > document.numPages) throw new Error("PDF_PAGE_UNAVAILABLE");
      const pdfPage = await document.getPage(page);
      const natural = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: width / natural.width });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("PDF_CANVAS_UNAVAILABLE");
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      const activeRender = pdfPage.render({ canvas, canvasContext: context, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      renderTask = activeRender;
      await activeRender.promise;
      if (!cancelled) setState("ready");
    })().catch((error: unknown) => {
      if (!cancelled && !(error instanceof Error && error.name === "RenderingCancelledException")) setState("unavailable");
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
      void loadingTask?.destroy();
    };
  }, [page, url, width]);

  return (
    <div ref={containerRef} className={styles.viewer} aria-label={label} data-state={state} data-sensitive="content">
      <canvas ref={canvasRef} aria-hidden={state !== "ready"} />
      {state === "ready" ? (
        <i
          aria-label={`Evidence bounding box ${bbox.join(", ")}`}
          style={{
            "--bbox-left": `${bbox[0] / 10}%`,
            "--bbox-top": `${bbox[1] / 10}%`,
            "--bbox-width": `${(bbox[2] - bbox[0]) / 10}%`,
            "--bbox-height": `${(bbox[3] - bbox[1]) / 10}%`,
          } as CSSProperties}
        />
      ) : <span>{state === "loading" ? "Rendering source page…" : "Source page unavailable"}</span>}
    </div>
  );
}

"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import styles from "./pdf-evidence-viewer.module.css";

type Props = {
  data: Uint8Array;
  page: number;
  bbox: [number, number, number, number];
  label: string;
};

// A settled render and the exact request it was drawn for.
type Rendered = { data: Uint8Array; page: number; width: number; state: "ready" | "unavailable" };

export default function PdfEvidenceViewer({ data, page, bbox, label }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [rendered, setRendered] = useState<Rendered | null>(null);
  // Derived rather than reset by the effect: the commit that changes source, page or width is already
  // "loading", so a finished render never lends its overlay or image name to a newer request.
  const state = rendered?.data === data && rendered.page === page && rendered.width === width ? rendered.state : "loading";

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => setWidth(Math.max(1, Math.floor(container.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // A layout effect, so the superseded page is cancelled and its pixels wiped in the same commit as
  // the new props: a slow or failed render never leaves older evidence on screen.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = 0;
    canvas.height = 0;
    if (width < 1 || !Number.isSafeInteger(page) || page < 1) return;
    let cancelled = false;
    let renderTask: { cancel: () => void } | null = null;
    let loadingTask: { destroy: () => Promise<void> } | null = null;
    const settle = (outcome: Rendered["state"]) => setRendered({ data, page, width, state: outcome });

    void (async () => {
      const pdfjs = await import("pdfjs-dist");
      if (cancelled) return;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      // The worker may transfer the input buffer; retain the original for resize.
      const task = pdfjs.getDocument({ data: data.slice() });
      loadingTask = task;
      const document = await task.promise;
      if (cancelled || page > document.numPages) throw new Error("PDF_PAGE_UNAVAILABLE");
      const pdfPage = await document.getPage(page);
      if (cancelled) return;
      const natural = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: width / natural.width });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      // Draw off-screen and copy only a render that is still current: one that reports back after a
      // newer request started can never paint over it.
      const offscreen = canvas.ownerDocument.createElement("canvas");
      const offscreenContext = offscreen.getContext("2d", { alpha: false });
      const context = canvas.getContext("2d", { alpha: false });
      if (!offscreenContext || !context) throw new Error("PDF_CANVAS_UNAVAILABLE");
      offscreen.width = Math.floor(viewport.width * ratio);
      offscreen.height = Math.floor(viewport.height * ratio);
      const activeRender = pdfPage.render({ canvas: offscreen, canvasContext: offscreenContext, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      renderTask = activeRender;
      await activeRender.promise;
      if (cancelled) return;
      canvas.width = offscreen.width;
      canvas.height = offscreen.height;
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      context.drawImage(offscreen, 0, 0);
      offscreen.width = 0;
      offscreen.height = 0;
      settle("ready");
    })().catch((error: unknown) => {
      if (!cancelled && !(error instanceof Error && error.name === "RenderingCancelledException")) settle("unavailable");
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
      void loadingTask?.destroy();
    };
  }, [page, data, width]);

  return (
    <div ref={containerRef} className={styles.viewer} role="group" aria-label={label} data-state={state} data-sensitive="content">
      <canvas ref={canvasRef} role="img" aria-label={`${label}, page ${page}, evidence bounding box ${bbox.join(", ")}`} aria-hidden={state !== "ready"} />
      {state === "ready" ? (
        <i
          aria-hidden="true"
          data-evidence-bbox=""
          style={{
            "--bbox-left": `${bbox[0] / 10}%`,
            "--bbox-top": `${bbox[1] / 10}%`,
            "--bbox-width": `${(bbox[2] - bbox[0]) / 10}%`,
            "--bbox-height": `${(bbox[3] - bbox[1]) / 10}%`,
          } as CSSProperties}
        />
      ) : <span role="status">{state === "loading" ? "Rendering source page…" : "Source page unavailable"}</span>}
    </div>
  );
}

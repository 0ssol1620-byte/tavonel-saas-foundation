"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from "pdfjs-dist";
import type { VisualEvidence } from "@/lib/visual-world-model";
import { boundedPixelRatio, publicPdfPath, sameSourcePage, sourceRectStyle, sourceScale } from "@/lib/source-page-geometry";
import styles from "./original-source-page.module.css";

type Props = { active: VisualEvidence; regions: VisualEvidence[]; onSelectRegion?: (id: string) => void; compact?: boolean };
type Phase = "idle" | "loading" | "ready" | "error";
const MAX_BYTES = 16 * 1024 * 1024;

/** A real, hash-checked PDF page. No extracted text is typeset into the page canvas. */
export default function OriginalSourcePage({ active, regions, onSelectRegion, compact = false }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const paper = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const documentRef = useRef<PDFDocumentProxy | null>(null);
  const renderRef = useRef<RenderTask | null>(null);
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [generation, setGeneration] = useState(0);
  const [loaded, setLoaded] = useState(0);
  const [size, setSize] = useState({ width: 640, height: compact ? 420 : 560 });
  const [zoom, setZoom] = useState(1);
  const [overlay, setOverlay] = useState(true);
  const [rotationSupported, setRotationSupported] = useState(false);
  const [renderedKey, setRenderedKey] = useState("");
  const path = publicPdfPath(active.href);
  const sourceKey = `${path}:${active.digest}`;
  const pageKey = `${sourceKey}:${active.sourceVersionId}:${active.page}`;
  const samePage = regions.filter(region => sameSourcePage(active, region));
  const ready = phase === "ready" && renderedKey === pageKey;
  const rectangle = rotationSupported ? sourceRectStyle(active.bbox1000) : null;

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "120px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 32 && rect.height > 32) setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let disposed = false;
    let task: PDFDocumentLoadingTask | undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 20_000);
    const run = async () => {
      setPhase("loading"); setError(""); setRenderedKey(""); setZoom(1);
      if (!path || !/^sha256:[0-9a-f]{64}$/.test(active.digest)) throw new Error("A verified public PDF is not available for this source.");
      const response = await fetch(path, { signal: controller.signal, credentials: "omit", redirect: "error" });
      if (!response.ok) throw new Error("The original file could not be loaded.");
      const declaredSize = Number(response.headers.get("content-length"));
      if (declaredSize > MAX_BYTES) throw new Error("The file exceeds this public preview's size limit.");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("This browser could not read the original file.");
      const chunks: Uint8Array[] = []; let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_BYTES) { await reader.cancel(); throw new Error("The file exceeds this public preview's size limit."); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") throw new Error("The response is not the expected PDF.");
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), n => n.toString(16).padStart(2, "0")).join("");
      if (`sha256:${hash}` !== active.digest) throw new Error("The file does not match the recorded source. The preview has been stopped.");
      const pdfjs = await import("pdfjs-dist");
      if (disposed) return;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      // PDF.js 6 no longer exposes isEvalSupported or PDFDocumentProxy.destroy.
      // The loading task owns worker/document teardown. Source identity and bounds stay enforced.
      task = pdfjs.getDocument({ data: bytes, enableXfa: false, stopAtErrors: true, maxImageSize: 16_000_000 });
      const pdf = await task.promise;
      if (disposed) { await task.destroy(); return; }
      if (pdf.numPages !== active.pageCount) { await task.destroy(); throw new Error("The page count differs from the recorded source."); }
      documentRef.current = pdf;
      setLoaded(value => value + 1);
    };
    void run().catch(cause => {
      if (!disposed) { setPhase("error"); setError(cause instanceof Error ? cause.message : "The source preview is unavailable."); }
    }).finally(() => window.clearTimeout(timer));
    return () => {
      disposed = true; controller.abort(); window.clearTimeout(timer); renderRef.current?.cancel();
      documentRef.current = null; if (task) void task.destroy().catch(() => undefined);
    };
  }, [sourceKey, visible, generation, path, active.digest, active.pageCount]);

  useEffect(() => {
    const pdf = documentRef.current;
    const output = canvas.current;
    const sheet = paper.current;
    if (!pdf || !output || !sheet) return;
    let disposed = false; let task: RenderTask | undefined;
    const run = async () => {
      setPhase("loading"); setRenderedKey("");
      const previous = renderRef.current; previous?.cancel();
      if (previous) await previous.promise.catch(() => undefined);
      const page = await pdf.getPage(active.page);
      if (disposed) return;
      const natural = page.getViewport({ scale: 1 });
      const scale = sourceScale(natural.width, natural.height, size.width, size.height, zoom);
      const view = page.getViewport({ scale });
      const ratio = boundedPixelRatio(view.width, view.height, window.devicePixelRatio);
      output.width = Math.ceil(view.width * ratio); output.height = Math.ceil(view.height * ratio);
      output.style.width = `${view.width}px`; output.style.height = `${view.height}px`;
      sheet.style.width = `${view.width}px`; sheet.style.height = `${view.height}px`;
      task = page.render({ canvas: output, viewport: view, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      renderRef.current = task;
      await task.promise;
      if (!disposed) { setRotationSupported(page.rotate === 0); setRenderedKey(pageKey); setPhase("ready"); }
    };
    void run().catch(cause => {
      if (!disposed && !(cause instanceof Error && cause.name === "RenderingCancelledException")) {
        setPhase("error"); setError("This page could not be rendered. The original file remains available.");
      }
    });
    return () => { disposed = true; task?.cancel(); };
  }, [loaded, active.page, pageKey, size.width, size.height, zoom]);

  return <section ref={root} className={styles.root} data-original-source="" data-render-state={ready ? "ready" : phase === "ready" ? "loading" : phase} data-source-page={active.page} data-source-digest={active.digest}>
    <div className={styles.toolbar} aria-label="Original page controls">
      <span className={styles.kind}>{active.representationKind === "reference_render" ? "Reference-render PDF" : "Original PDF"}</span>
      <div className={styles.controls}>
        <button type="button" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - .5))}>−</button>
        <button type="button" onClick={() => { setZoom(1); viewport.current?.scrollTo({ top: 0, left: 0 }); }}>Fit page</button>
        <button type="button" aria-label="Zoom in" disabled={zoom >= 4} onClick={() => setZoom(value => Math.min(4, value + .5))}>+</button>
        <button type="button" aria-pressed={overlay} onClick={() => setOverlay(value => !value)}>Highlight</button>
      </div>
    </div>
    <div ref={viewport} className={styles.viewport} data-compact={compact ? "1" : "0"} tabIndex={0} aria-label="Original document page; use the zoom controls to read and the parsed-text view to select a passage">
      {!ready ? <div className={styles.message} role="status">
        {phase === "error" ? <><strong>Original preview unavailable</strong><span>{error}</span><button type="button" onClick={() => setGeneration(value => value + 1)}>Retry preview</button></> : <span>Loading the source page…</span>}
      </div> : null}
      <div ref={paper} className={styles.page} style={{ visibility: ready ? "visible" : "hidden" }} onPointerUp={event => {
        if (!ready || !rotationSupported || !onSelectRegion) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width * 1000;
        const y = (event.clientY - rect.top) / rect.height * 1000;
        const match = samePage.find(region => x >= region.bbox1000[0] && x <= region.bbox1000[2] && y >= region.bbox1000[1] && y <= region.bbox1000[3]);
        if (match) onSelectRegion(match.id);
      }}>
        <canvas ref={canvas} aria-label={`${active.filename}, PDF page ${active.page} of ${active.pageCount}`} role="img" />
        {ready && overlay && rectangle ? <span className={styles.selection} style={rectangle} data-original-region={active.id} aria-hidden="true" /> : null}
      </div>
    </div>
    <div className={styles.caption}><span>PDF page {active.page} / {active.pageCount}</span><span>{ready ? "Source bytes verified" : "Original remains available below"}</span></div>
    {ready && !rotationSupported ? <p className={styles.notice}>This rotated page is shown without a region overlay.</p> : null}
  </section>;
}

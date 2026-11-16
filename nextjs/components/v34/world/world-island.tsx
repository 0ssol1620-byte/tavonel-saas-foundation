"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  CAMERA_LIMITS,
  clampCamera,
  DEFAULT_CAMERA,
  describeOverview,
  describeParts,
  idsDigest,
  layoutWorld,
  pick,
  projectLayout,
  recordSource,
} from "@/lib/v34/world-geometry";
import type { Camera, CorpusNode, WorldCorpus, WorldKind, WorldLayout, WorldMode } from "@/lib/v34/world-geometry";
import type { WorldRenderer } from "./renderer-types";
import styles from "./world.module.css";

/*
  The interactive half of the world instrument. The server renders the static SVG (passed in as
  children), the legend and the counts; this island adds the live view on top of them and never
  replaces what they say.

  Nothing loads on mount. The corpus is fetched, with subresource integrity, when the instrument is
  near the viewport (after an idle moment on a fine pointer; only on "Explore the layers" for the
  home hero on a coarse pointer) or on the first interaction. Graphics are WebGL, then Canvas2D, then
  the static image that is already on the page.

  Test hooks for the QA harness (documented in the lane receipt):
    data-mode          webgl | canvas2d | static   what is drawing now
    data-node-count    records the active mode drew
    data-edge-count    relationships the active mode drew
    data-ids-sha       SHA-256 of the sorted ids and a|relation|b lines (absent when crypto.subtle is)
    data-forced        the force switches in effect: no-webgl, no-2d
    ?v34-world=no-webgl | no-2d | no-webgl,no-2d   (or localStorage "v34-world") force a mode down
    document.documentElement.dataset.v34WorldInstances   live instance count (leak check)
*/

type Gfx = "webgl" | "canvas2d" | "static";
type Load = "idle" | "loading" | "ready" | "error";

export type WorldIslandProps = {
  variant: "hero" | "full";
  corpusPath: string;
  corpusIntegrity: string;
  /** What the static SVG on the page draws, computed on the server from the same layout. */
  expected: { records: number; relations: number; idsSha: string };
  overview: string;
  legend: { kind: WorldKind; layer: number; color: string; count: number }[];
  /** The static SVG `<img>`. It stays on the page until a live mode is drawing. */
  children: ReactNode;
};

const STATUS = {
  loading: "Loading the interactive view…",
  webgl: "Interactive World · drag to orbit · select a record to inspect",
  canvas2d: "Interactive World · compatible graphics mode · drag to orbit",
  lost: "Graphics context lost · continuing in compatible graphics mode · drag to orbit",
  static: "Static overview · select a record to inspect it",
  error: "Couldn't load the interactive view",
} as const;

const FRAME_MS = { webgl: 25, canvas2d: 45 } as const;
const AMBIENT = { yawPerFrame: 0.0018, frameMs: 25 } as const;

function isWorldCorpus(value: unknown): value is WorldCorpus {
  const v = value as Partial<WorldCorpus> | null;
  return !!v && typeof v === "object" && Array.isArray(v.nodes) && Array.isArray(v.edges) && typeof v.sources === "object" && v.sources !== null;
}

/** The force switches the QA harness uses; read once per mount. */
function readForced(): { noWebgl: boolean; no2d: boolean; label: string } {
  let raw = "";
  try {
    raw = new URLSearchParams(window.location.search).get("v34-world") ?? "";
  } catch {
    raw = "";
  }
  if (!raw) {
    try {
      raw = window.localStorage.getItem("v34-world") ?? "";
    } catch {
      raw = "";
    }
  }
  const tokens = raw.split(",").map((t) => t.trim());
  const noWebgl = tokens.includes("no-webgl");
  const no2d = tokens.includes("no-2d");
  return { noWebgl, no2d, label: [noWebgl ? "no-webgl" : "", no2d ? "no-2d" : ""].filter(Boolean).join(",") };
}

export function WorldIsland({ variant, corpusPath, corpusIntegrity, expected, overview, legend, children }: WorldIslandProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<Camera>({ ...DEFAULT_CAMERA });
  const layoutRef = useRef<WorldLayout | null>(null);
  const rendererRef = useRef<WorldRenderer | null>(null);
  const motionRef = useRef(false);
  const visibleRef = useRef(false);
  const dirtyRef = useRef(false);
  const loop = useRef({ frame: 0, last: 0, t0: 0, anchor: null as Camera | null });

  const [hydrated, setHydrated] = useState(false);
  const [wantLoad, setWantLoad] = useState(false);
  const [load, setLoad] = useState<Load>("idle");
  const [corpus, setCorpus] = useState<WorldCorpus | null>(null);
  const [gfx, setGfx] = useState<Gfx>("webgl");
  const [forced, setForced] = useState({ noWebgl: false, no2d: false, label: "" });
  const [renderer, setRenderer] = useState<WorldRenderer | null>(null);
  const [lost, setLost] = useState(false);
  const [mode, setMode] = useState<WorldMode>("layers");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [motion, setMotion] = useState(false);
  const [rendered, setRendered] = useState<{ nodes: number; edges: number; sha: string | null } | null>(null);

  const layout = useMemo(() => (corpus ? layoutWorld(corpus, mode) : null), [corpus, mode]);
  const byId = useMemo(() => new Map((corpus?.nodes ?? []).map((n) => [n.id, n])), [corpus]);
  const records = useMemo(
    () => [...(corpus?.nodes ?? [])].sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label)),
    [corpus],
  );
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? records.filter((n) => [n.label, n.domain, n.kind, n.note].join(" ").toLowerCase().includes(q)) : records;
  }, [records, query]);

  /* The render loop runs only while something is moving. A drag, a mode switch or a resize marks the
     scene dirty and takes one frame; ambient motion keeps the loop going while the instrument is
     on screen, the tab is visible and the camera is not paused. */
  const kick = useCallback(() => {
    const s = loop.current;
    if (s.frame) return;
    const step = (t: number) => {
      s.frame = 0;
      const r = rendererRef.current;
      if (!r) return;
      let again = false;
      if (motionRef.current && visibleRef.current && !document.hidden) {
        again = true;
        if (t - s.last >= FRAME_MS[r.kind]) {
          const dt = Math.min(t - (s.last || t - AMBIENT.frameMs), 100);
          s.last = t;
          const c = cameraRef.current;
          if (variant === "hero") {
            // The target's hero sway, anchored where the camera was so that resuming never jumps.
            if (!s.anchor) {
              s.anchor = { ...c };
              s.t0 = t;
            }
            const phase = (t - s.t0) * 0.00014;
            cameraRef.current = clampCamera({
              yaw: s.anchor.yaw + Math.sin(phase) * 0.28,
              pitch: s.anchor.pitch + Math.sin(phase * 0.7) * 0.075,
              distance: s.anchor.distance + Math.sin(phase * 0.9) * 0.55,
            });
          } else {
            cameraRef.current = { ...c, yaw: c.yaw + AMBIENT.yawPerFrame * (dt / AMBIENT.frameMs) };
          }
          dirtyRef.current = true;
        }
      } else {
        s.anchor = null;
      }
      if (dirtyRef.current) {
        dirtyRef.current = false;
        r.draw(cameraRef.current);
      }
      if (again) s.frame = requestAnimationFrame(step);
    };
    s.frame = requestAnimationFrame(step);
  }, [variant]);

  const invalidate = useCallback(() => {
    dirtyRef.current = true;
    kick();
  }, [kick]);

  /* A camera the user set. Drops the ambient anchor so the sway resumes from here instead of snapping back. */
  const setCamera = useCallback(
    (next: Camera) => {
      cameraRef.current = clampCamera(next);
      loop.current.anchor = null;
      invalidate();
    },
    [invalidate],
  );

  const stopMotion = useCallback(() => {
    motionRef.current = false;
    setMotion(false);
  }, []);

  /* Mount: counters, force switches, motion preference, visibility, and the lazy-load trigger. */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const dataset = document.documentElement.dataset;
    const state = loop.current;
    dataset.v34WorldInstances = String(Number(dataset.v34WorldInstances ?? "0") + 1);
    const f = readForced();
    setForced(f);
    setGfx(f.noWebgl ? (f.no2d ? "static" : "canvas2d") : "webgl");
    setHydrated(true);

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const coarse = window.matchMedia("(pointer: coarse)");
    // No ambient motion under reduced motion, and none on a coarse pointer until the user asks for it.
    const startMotion = !reduce.matches && !coarse.matches;
    motionRef.current = startMotion;
    setMotion(startMotion);
    const onReduce = () => {
      if (reduce.matches) {
        motionRef.current = false;
        setMotion(false);
      }
    };
    reduce.addEventListener("change", onReduce);

    let requested = false;
    let idleHandle: number | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting);
        visibleRef.current = visible;
        if (visible) kick();
        const autoLoad = !(variant === "hero" && coarse.matches);
        if (visible && autoLoad && !requested) {
          requested = true;
          if (typeof window.requestIdleCallback === "function") idleHandle = window.requestIdleCallback(() => setWantLoad(true), { timeout: 1500 });
          else timeoutHandle = setTimeout(() => setWantLoad(true), 150);
        }
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(stageRef.current ?? root);

    const onVisibility = () => {
      if (!document.hidden) kick();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      dataset.v34WorldInstances = String(Math.max(0, Number(dataset.v34WorldInstances ?? "1") - 1));
      if (dataset.v34WorldInstances === "0") delete dataset.v34WorldInstances;
      reduce.removeEventListener("change", onReduce);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      if (idleHandle !== null) window.cancelIdleCallback(idleHandle);
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
      cancelAnimationFrame(state.frame);
      state.frame = 0;
    };
  }, [kick, variant]);

  useEffect(() => {
    motionRef.current = motion;
    if (motion) kick();
  }, [motion, kick]);

  /* Corpus: fetched once, verified by the browser against the SRI token, never retried silently. */
  useEffect(() => {
    if (!wantLoad) return;
    const controller = new AbortController();
    setLoad("loading");
    (async () => {
      try {
        const response = await fetch(corpusPath, { integrity: corpusIntegrity, cache: "force-cache", signal: controller.signal });
        if (!response.ok) throw new Error(`corpus request failed with ${response.status}`);
        const data: unknown = await response.json();
        if (!isWorldCorpus(data)) throw new Error("corpus has an unexpected shape");
        layoutWorld(data, "layers");
        setCorpus(data);
        setLoad("ready");
      } catch {
        if (!controller.signal.aborted) setLoad("error");
      }
    })();
    return () => controller.abort();
  }, [wantLoad, corpusPath, corpusIntegrity]);

  /* Graphics: the effect owns one canvas, its renderer and its listeners, and releases all of them. A failure
     moves one step down the chain on a fresh canvas, because a canvas that has held a GL context cannot give a 2D one. */
  useEffect(() => {
    const stage = stageRef.current;
    if (load !== "ready" || gfx === "static" || !stage) return;
    const canvas = document.createElement("canvas");
    canvas.className = styles.canvas;
    canvas.setAttribute("data-v34-layer", "");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Interactive projection of the public reference corpus. Use the record finder below to inspect a record.");
    canvas.tabIndex = -1;
    stage.append(canvas);

    let cancelled = false;
    let made: WorldRenderer | null = null;
    const fallback = (from: Gfx): Gfx => (from === "webgl" && !forced.no2d ? "canvas2d" : "static");

    const pointers = new Map<number, { x: number; y: number }>();
    let travel = 0;
    let startX = 0;
    let startY = 0;
    const orbit = (dx: number, dy: number) => {
      const c = cameraRef.current;
      setCamera({ ...c, yaw: c.yaw + dx * 0.008, pitch: c.pitch + dy * 0.008 });
    };
    const zoom = (ratio: number) => setCamera({ ...cameraRef.current, distance: cameraRef.current.distance * ratio });
    const onDown = (e: PointerEvent) => {
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* a pointer that is already gone cannot be captured; the gesture just ends */
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        startX = e.clientX;
        startY = e.clientY;
        travel = 0;
      }
      stopMotion();
      canvas.focus({ preventScroll: true });
    };
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      if (e.pointerType === "touch") {
        // One finger belongs to the page (vertical scroll); two fingers orbit and pinch.
        if (pointers.size === 2) {
          const other = [...pointers].find(([pid]) => pid !== e.pointerId)?.[1];
          if (other) {
            const before = Math.hypot(prev.x - other.x, prev.y - other.y);
            const after = Math.hypot(cur.x - other.x, cur.y - other.y);
            orbit((cur.x - prev.x) / 2, (cur.y - prev.y) / 2);
            if (before > 0 && after > 0) zoom(before / after);
          }
        }
      } else if (pointers.size === 1) {
        orbit(cur.x - prev.x, cur.y - prev.y);
      }
      pointers.set(e.pointerId, cur);
      travel = Math.max(travel, Math.hypot(cur.x - startX, cur.y - startY));
    };
    const onUp = (e: PointerEvent) => {
      if (pointers.size === 1 && pointers.has(e.pointerId) && travel < 5 && layoutRef.current) {
        const rect = canvas.getBoundingClientRect();
        const hit = pick(projectLayout(layoutRef.current, cameraRef.current, rect.width, rect.height), e.clientX - rect.left, e.clientY - rect.top);
        if (hit) setFocusId(hit);
      }
      pointers.delete(e.pointerId);
    };
    const onCancel = (e: PointerEvent) => void pointers.delete(e.pointerId);
    // The wheel zooms only with ctrl/pinch or once the canvas has focus; otherwise it scrolls the page.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && document.activeElement !== canvas) return;
      e.preventDefault();
      zoom(Math.exp(e.deltaY * 0.0015));
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") canvas.blur();
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onCancel);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("keydown", onKey);
    const resize = new ResizeObserver(() => invalidate());
    resize.observe(stage);

    (async () => {
      try {
        if (gfx === "webgl") {
          const m = await import("./webgl-renderer");
          if (cancelled) return;
          made = m.createWebglRenderer(canvas, {
            onContextLost: () => {
              setLost(true);
              setGfx(fallback("webgl"));
            },
          });
        } else {
          const m = await import("./canvas2d-renderer");
          if (cancelled) return;
          made = m.createCanvas2dRenderer(canvas);
        }
        rendererRef.current = made;
        setRenderer(made);
      } catch {
        if (!cancelled) setGfx(fallback(gfx));
      }
    })();

    return () => {
      cancelled = true;
      resize.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("keydown", onKey);
      made?.dispose();
      if (rendererRef.current === made) rendererRef.current = null;
      setRenderer(null);
      setRendered(null);
      canvas.remove();
    };
  }, [load, gfx, forced.no2d, invalidate, setCamera, stopMotion]);

  useLayoutEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  /* Scene: drawn synchronously on change so the static image is never swapped for a blank canvas. */
  useLayoutEffect(() => {
    if (!renderer || !layout) return;
    renderer.setScene(layout, focusId);
    renderer.draw(cameraRef.current);
  }, [renderer, layout, focusId]);

  /* What the active mode actually drew, and the digest of it, for the QA data attributes. */
  useEffect(() => {
    if (!renderer || !layout) return;
    let stale = false;
    const { nodes, edges } = renderer.stats();
    idsDigest(layout)
      .catch(() => null)
      .then((sha) => {
        if (!stale) setRendered({ nodes, edges, sha });
      });
    return () => {
      stale = true;
    };
  }, [renderer, layout]);

  const requestLoad = () => setWantLoad(true);

  const active: Gfx = renderer ? renderer.kind : "static";
  const status =
    load === "error"
      ? STATUS.error
      : load === "loading" || (load === "ready" && gfx !== "static" && !renderer)
        ? STATUS.loading
        : renderer?.kind === "webgl"
          ? STATUS.webgl
          : renderer?.kind === "canvas2d"
            ? lost
              ? STATUS.lost
              : STATUS.canvas2d
            : STATUS.static;

  const focusNode: CorpusNode | undefined = focusId ? byId.get(focusId) : undefined;
  const parts = focusNode && corpus ? describeParts(focusNode, corpus) : null;
  const source = focusNode && corpus ? recordSource(corpus, focusNode) : null;
  const live = renderer !== null;

  const reset = () => {
    setFocusId(null);
    setQuery("");
    setCamera({ ...DEFAULT_CAMERA });
  };
  const zoomBy = (step: number) => setCamera({ ...cameraRef.current, distance: cameraRef.current.distance + step });

  return (
    <div
      ref={rootRef}
      className={styles.root}
      data-world-root=""
      data-variant={variant}
      data-hydrated={hydrated}
      data-load={load}
      data-ready={live}
      data-measured={rendered !== null}
      data-mode={active}
      data-forced={forced.label || undefined}
      data-node-count={rendered ? rendered.nodes : expected.records}
      data-edge-count={rendered ? rendered.edges : expected.relations}
      data-ids-sha={rendered ? (rendered.sha ?? undefined) : expected.idsSha}
      data-animating={motion && live ? "true" : undefined}
      onPointerDownCapture={requestLoad}
      onFocusCapture={requestLoad}
    >
      <div ref={stageRef} className={styles.stageCrop}>
        <div className={styles.fallback} data-v34-layer="">{children}</div>
        <button type="button" className={styles.explore} data-v34-layer="" onClick={requestLoad} disabled={load !== "idle"}>
          Explore the layers
        </button>
      </div>

      <div className={styles.toolbar} role="group" aria-label="World view controls" data-world-tools="">
        <div className={styles.segment} role="group" aria-label="Arrangement">
          {(["layers", "world"] as const).map((m) => (
            <button key={m} type="button" className={styles.control} aria-pressed={mode === m} disabled={!live} onClick={() => setMode(m)} data-world-mode={m}>
              {m === "layers" ? "Layers" : "World"}
            </button>
          ))}
        </div>
        <button type="button" className={styles.control} aria-label="Zoom in" disabled={!live} onClick={() => zoomBy(-CAMERA_LIMITS.zoomStep)}>
          +
        </button>
        <button type="button" className={styles.control} aria-label="Zoom out" disabled={!live} onClick={() => zoomBy(CAMERA_LIMITS.zoomStep)}>
          −
        </button>
        <button type="button" className={styles.control} disabled={!live} onClick={reset}>
          Reset
        </button>
        <button type="button" className={styles.control} aria-pressed={live && motion} disabled={!live} onClick={() => setMotion((m) => !m)}>
          {live && motion ? "Pause camera" : "Play camera"}
        </button>
      </div>

      <p className={styles.status} role="status" data-world-status="">
        {status}
      </p>

      <div className={styles.finder}>
        <label className={styles.field} htmlFor={`${id}-search`}>
          <span>Find a record</span>
          <input
            id={`${id}-search`}
            type="search"
            className={styles.input}
            value={query}
            placeholder="Search by name, domain or kind"
            autoComplete="off"
            aria-describedby={`${id}-count`}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <p id={`${id}-count`} className={styles.count}>
          {corpus ? `${shown.length.toLocaleString("en-US")} ${query.trim() ? "matching " : ""}records` : load === "loading" ? "Loading records…" : "Records load when you search"}
        </p>
        <label className={styles.field} htmlFor={`${id}-select`}>
          <span>Record</span>
          <select id={`${id}-select`} className={styles.input} value={focusId ?? ""} onChange={(e) => setFocusId(e.target.value || null)} data-world-select="">
            <option value="">Choose a record</option>
            {focusNode && !shown.some((n) => n.id === focusNode.id) ? (
              <option value={focusNode.id}>
                {focusNode.kind} · {focusNode.label} (selected)
              </option>
            ) : null}
            {shown.map((n) => (
              <option key={n.id} value={n.id}>
                {n.kind} · {n.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.info} aria-live="polite" aria-atomic="true" data-world-info="">
        {parts ? (
          <p className={styles.infoLine}>
            <strong>{parts.title}</strong> {parts.body}
          </p>
        ) : (
          <p className={styles.infoLine}>{corpus ? describeOverview(corpus, mode) : overview}</p>
        )}
        {source ? (
          <a className={styles.source} href={source.url} target="_blank" rel="noopener noreferrer">
            Inspect source →<span className={styles.visuallyHidden}> (opens in a new tab)</span>
          </a>
        ) : null}
      </div>

      <ul className={styles.legend} aria-label="Record kinds, one layer each">
        {legend.map((item) => (
          <li key={item.kind} className={styles.legendItem}>
            <span className={styles.swatch} style={{ backgroundColor: item.color }} aria-hidden="true" />
            <span className={styles.layerNumber}>{String(item.layer).padStart(2, "0")}</span> {item.kind} <span className={styles.legendCount}>{item.count.toLocaleString("en-US")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

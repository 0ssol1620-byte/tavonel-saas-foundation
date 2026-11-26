"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { clampCamera, DEFAULT_CAMERA, layoutWorld, pick, projectLayout } from "@/lib/v34/world-geometry";
import type { Camera } from "@/lib/v34/world-geometry";
import type { WorldRenderer } from "@/components/v34/world/renderer-types";
import {
  adaptWorldForPicture,
  fallbackGraphics,
  PICTURE_LINE_NOTE,
  PICTURE_LIVE_QUERY,
  pictureAriaLabel,
  pictureBranch,
  showingLine,
} from "@/lib/workspace-world-picture";
import type { Graphics } from "@/lib/workspace-world-picture";
import type { WorldReadModel } from "@/lib/world-read-model";
import styles from "./world-picture.module.css";

/*
  WO-WS-5: the workspace's World, drawn.

  The renderers are the public pages' (WebGL, then Canvas2D); what is new is only the input. The
  graph is the World read model the workspace already holds, adapted without sampling
  (lib/workspace-world-picture.ts). Nothing here loads a corpus file or draws a sample.

  Motion encodes meaning, so there is none of its own: the frame is still, the camera moves when
  the reader drags, and a selection lights the object and its relations. Reduced motion also
  takes the drag away (a click still selects). Below 900 px no canvas is mounted at all: the list
  under the picture is the whole component, and it is always there as the keyboard route to the
  same objects the canvas shows.
*/

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    const sync = () => setMatches(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [query]);
  return matches;
}

const n = (value: number) => value.toLocaleString("en-US");

type Props = {
  model: WorldReadModel;
  /** The reader for one evidence record. Called with an evidence id the World holds. */
  onOpenEvidence: (evidenceId: string) => void;
  openLabel: string;
};

export default function WorldPicture({ model, onOpenEvidence, openLabel }: Props) {
  const wide = useMedia(PICTURE_LIVE_QUERY);
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const { live, orbit } = pictureBranch({ wide, reducedMotion: reduced });
  const [gfxState, setGfxState] = useState<Graphics>("webgl");
  const [renderer, setRenderer] = useState<WorldRenderer | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<Camera>({ ...DEFAULT_CAMERA });
  const orbitRef = useRef(orbit);
  useEffect(() => {
    orbitRef.current = orbit;
  }, [orbit]);

  const built = useMemo(() => {
    try {
      const picture = adaptWorldForPicture(model);
      return { picture, layout: layoutWorld(picture.corpus, "world"), error: null };
    } catch (error) {
      return { picture: null, layout: null, error: error instanceof Error ? error.message : "world_picture_failed" };
    }
  }, [model]);
  const { picture, layout } = built;
  const gfx: Graphics = live ? gfxState : "summary";

  useEffect(() => setFocusId(null), [model]);

  /* One canvas, one renderer and their listeners per effect run, all released by its cleanup. A failure moves one step down the chain on a fresh canvas
     (a canvas that has held a GL context cannot give a 2D one); the last step is the list. */
  useEffect(() => {
    const stage = stageRef.current;
    if (gfx === "summary" || !stage || !layout || !picture) return;
    const canvas = document.createElement("canvas");
    canvas.className = styles.canvas;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", pictureAriaLabel(picture));
    stage.append(canvas);

    let cancelled = false;
    let made: WorldRenderer | null = null;
    let frame = 0;
    const redraw = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        made?.draw(cameraRef.current);
      });
    };

    let last: { x: number; y: number } | null = null;
    let start = { x: 0, y: 0 };
    let travel = 0;
    const onDown = (e: PointerEvent) => {
      last = start = { x: e.clientX, y: e.clientY };
      travel = 0;
      if (orbitRef.current && e.pointerType !== "touch") {
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {
          /* a pointer that is already gone cannot be captured; the gesture just ends */
        }
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!last) return;
      travel = Math.max(travel, Math.hypot(e.clientX - start.x, e.clientY - start.y));
      if (orbitRef.current && e.pointerType !== "touch") {
        const c = cameraRef.current;
        cameraRef.current = clampCamera({ ...c, yaw: c.yaw + (e.clientX - last.x) * 0.008, pitch: c.pitch + (e.clientY - last.y) * 0.008 });
        redraw();
      }
      last = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (last && travel < 5) {
        const rect = canvas.getBoundingClientRect();
        setFocusId(pick(projectLayout(layout, cameraRef.current, rect.width, rect.height), e.clientX - rect.left, e.clientY - rect.top));
      }
      last = null;
    };
    const onCancel = () => void (last = null);
    // The wheel zooms only with ctrl or a pinch; otherwise it scrolls the page.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || !orbitRef.current) return;
      e.preventDefault();
      cameraRef.current = clampCamera({ ...cameraRef.current, distance: cameraRef.current.distance * Math.exp(e.deltaY * 0.0015) });
      redraw();
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onCancel);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    const resize = new ResizeObserver(redraw);
    resize.observe(stage);

    (async () => {
      try {
        if (gfx === "webgl") {
          const m = await import("@/components/v34/world/webgl-renderer");
          if (cancelled) return;
          made = m.createWebglRenderer(canvas, { onContextLost: () => setGfxState(fallbackGraphics("webgl")) });
        } else {
          const m = await import("@/components/v34/world/canvas2d-renderer");
          if (cancelled) return;
          made = m.createCanvas2dRenderer(canvas);
        }
        setRenderer(made);
      } catch {
        if (!cancelled) setGfxState(fallbackGraphics(gfx));
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("wheel", onWheel);
      made?.dispose();
      setRenderer(null);
      canvas.remove();
    };
  }, [gfx, layout, picture]);

  /* Scene: drawn on change, so a selection lights its neighbourhood at once. */
  useLayoutEffect(() => {
    if (!renderer || !layout) return;
    renderer.setScene(layout, focusId);
    renderer.draw(cameraRef.current);
  }, [renderer, layout, focusId]);

  if (!picture) {
    return <p role="alert" className={styles.error}>This World could not be drawn ({built.error}). The Review queue and the evidence reader still hold every record.</p>;
  }

  const selected = focusId ? picture.info.get(focusId) ?? null : null;
  return (
    <div className={styles.root} data-world-picture="" data-mode={gfx} data-orbit={orbit ? "true" : "false"} data-node-count={picture.drawn.objects} data-edge-count={picture.drawn.relations}>
      {gfx !== "summary" ? <div className={styles.stage} ref={stageRef} /> : null}
      <ul className={styles.legend} aria-label="What the colours mean">
        {picture.legend.map((entry) => (
          <li key={entry.kind}>
            <i className={styles.swatch} style={{ background: entry.color }} aria-hidden="true" />
            {entry.label} <b>{n(entry.total)}</b>
          </li>
        ))}
      </ul>
      <p className={styles.line}>{PICTURE_LINE_NOTE}</p>
      <p className={styles.showing} role="status">{showingLine(picture)}</p>
      <h3 className={styles.listTitle}>Most connected</h3>
      <ol className={styles.list}>
        {picture.top.map((item) => (
          <li key={item.id}>
            <button type="button" aria-pressed={focusId === item.id} onClick={() => setFocusId(focusId === item.id ? null : item.id)}>
              <span>{item.label}</span>
              <small>{item.typeLabel} · {n(item.relationCount)} {item.relationCount === 1 ? "relation" : "relations"} · {n(item.evidenceCount)} evidence</small>
            </button>
          </li>
        ))}
      </ol>
      {selected ? (
        <div className={styles.detail} role="group" aria-label="Selected object">
          <strong>{selected.label}</strong>
          <span>{selected.typeLabel} · {n(selected.relationCount)} {selected.relationCount === 1 ? "relation" : "relations"} · {n(selected.evidenceCount)} evidence</span>
          {selected.evidenceId ? (
            <button type="button" onClick={() => onOpenEvidence(selected.evidenceId as string)}>{openLabel}</button>
          ) : (
            <span>No evidence region is recorded for this object.</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

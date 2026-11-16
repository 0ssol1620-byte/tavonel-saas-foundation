/**
 * World mode forcing (architecture sections 3.8 and 5). The island writes data-mode
 * ("webgl" | "canvas2d" | "static"), data-node-count, data-edge-count and, when crypto.subtle
 * exists, data-ids-sha on its root. This forces each mode by wrapping
 * HTMLCanvasElement.prototype.getContext before the page scripts run, reads those attributes and
 * checks the modes agree with each other and with the static SVG's own node and edge counts.
 */

import type { Page } from "@playwright/test";
import type { Violation } from "./v34-measure";

export type WorldMode = "webgl" | "canvas2d" | "static";
export type WorldState = { mode: string | null; nodes: number | null; edges: number | null; sha: string | null };

/** Selector of the island root; the F-world lane exposes data-mode with the counts beside it. */
export const WORLD_ROOT = "[data-mode][data-node-count]";

/** Call before `page.goto`. "webgl" leaves the browser alone; the others null the contexts the island tries. */
export async function forceWorldMode(page: Page, mode: WorldMode): Promise<void> {
  await page.addInitScript((m: WorldMode) => {
    if (m === "webgl") return;
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (/webgl/i.test(type)) return null;
      if (m === "static" && type === "2d") return null;
      return (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof original;
  }, mode);
}

/**
 * Reads the island root once it has settled. The server renders data-mode="static" and the expected
 * counts before any renderer exists, so reading on attach would compare the server with itself:
 * wait for data-measured="true" (the renderer drew and reported), or, for a forced "static" run,
 * for data-load to reach ready/error. A timeout still reads, so a stuck island reports its state.
 */
export async function readWorldState(page: Page, wanted: WorldMode = "webgl", timeout = 15_000): Promise<WorldState> {
  const root = page.locator(WORLD_ROOT).first();
  await root.waitFor({ state: "attached", timeout }).catch(() => undefined);
  await page
    .waitForFunction(
      ([sel, m]) => {
        const e = document.querySelector(sel);
        if (!e) return false;
        if (e.getAttribute("data-measured") === "true") return true;
        const load = e.getAttribute("data-load");
        return m === "static" && (load === "ready" || load === "error");
      },
      [WORLD_ROOT, wanted] as const,
      { timeout },
    )
    .catch(() => undefined);
  return root
    .evaluate(e => ({
      mode: e.getAttribute("data-mode"),
      nodes: e.hasAttribute("data-node-count") ? Number(e.getAttribute("data-node-count")) : null,
      edges: e.hasAttribute("data-edge-count") ? Number(e.getAttribute("data-edge-count")) : null,
      sha: e.getAttribute("data-ids-sha"),
    }))
    .catch(() => ({ mode: null, nodes: null, edges: null, sha: null }));
}

/** Node and edge counts as drawn in the static SVG (`<circle data-id>`, `<line data-a data-b>`). */
export async function staticSvgCounts(page: Page, url = "/v34/world-layers.svg"): Promise<{ nodes: number; edges: number; ids: string[] }> {
  const res = await page.request.get(url);
  const body = await res.text();
  const ids = [...body.matchAll(/<circle[^>]*\sdata-id="([^"]+)"/g)].map(m => m[1]).sort();
  const edges = [...body.matchAll(/<line[^>]*\sdata-a="[^"]+"[^>]*\sdata-b="[^"]+"/g)].length;
  return { nodes: ids.length, edges, ids };
}

/**
 * Digest equality across modes: counts and ids-sha identical in every mode, each requested mode
 * actually reached, and the island counts equal to the static SVG's. `expectedSha`, when the
 * caller can compute it from the corpus, is compared too.
 */
export function assertWorldAgreement(
  states: Partial<Record<WorldMode, WorldState>>,
  svg?: { nodes: number; edges: number },
  expectedSha?: string,
): Violation[] {
  const out: Violation[] = [];
  const v = (detail: string) => out.push({ pass: "world-digest", selector: WORLD_ROOT, detail });
  const entries = Object.entries(states) as [WorldMode, WorldState][];
  for (const [mode, s] of entries) {
    if (s.mode !== mode) v(`forced ${mode} but data-mode is ${s.mode ?? "absent"}`);
    if (s.nodes == null || s.edges == null) v(`${mode}: data-node-count or data-edge-count missing`);
  }
  const ref = entries[0]?.[1];
  if (!ref) return out;
  for (const [mode, s] of entries.slice(1)) {
    if (s.nodes !== ref.nodes) v(`${mode} nodes ${s.nodes} != ${entries[0][0]} ${ref.nodes}`);
    if (s.edges !== ref.edges) v(`${mode} edges ${s.edges} != ${entries[0][0]} ${ref.edges}`);
    if (s.sha !== ref.sha) v(`${mode} ids-sha ${s.sha ?? "absent"} != ${entries[0][0]} ${ref.sha ?? "absent"}`);
  }
  if (svg && (svg.nodes !== ref.nodes || svg.edges !== ref.edges)) v(`static SVG ${svg.nodes}/${svg.edges} != island ${ref.nodes}/${ref.edges}`);
  if (expectedSha && entries.some(([, s]) => s.sha && s.sha !== expectedSha)) v(`ids-sha differs from the expected digest ${expectedSha.slice(0, 12)}`);
  return out;
}

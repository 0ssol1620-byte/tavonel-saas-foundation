/**
 * Landing ↔ Explore visual continuity capture (blueprint §29).
 *
 *   usage: node scripts/visual-continuity.mjs [out-dir]
 *   env:   VISUAL_CONTINUITY_BASE   default http://127.0.0.1:3136
 *          VISUAL_CONTINUITY_DATE   default today (UTC, YYYY-MM-DD)
 *
 * Requires a server already answering at VISUAL_CONTINUITY_BASE (see the lane's own
 * `pnpm start --port 3136`, or PLAYWRIGHT_EXTERNAL_SERVER-style usage) — this script does not
 * start one, the same division of labour as scripts/record-film-2x.mjs and record-film-4.mjs.
 *
 * Route note: the lane contract that specced this script named `/film-4` as the film side.
 * `/film-4` is now `notFound()` — an intentional stable 404 for a retired inbound URL (see
 * app/film-4/page.tsx). Cut 4 (`components/opening-film-4.tsx`) is not retired: it plays inline
 * as the "WORLD" stage of `CompileStagePlayer` inside the landing page's Scene 03 (`#s3`,
 * `data-band="change"`). The code wins over the document (repo root CLAUDE.md / lane contract
 * §0.2) — this script reaches the same locked cut through the surface that actually renders it:
 * scroll `#s3` into view, select the "WORLD" tab (`#compile-stage-tab-world`), then freeze/seek
 * the mounted `opening-film-4` canvas exactly as the contract's hook names describe.
 *
 * Explore side: waits for `[data-visual-world="explore"]` per lane contract §4.2. At the time
 * this script was written the `explore` lane (agent/cl-explore) had not landed those attributes
 * on this branch yet — expected, since it runs in parallel (lane contract §29 spec). When the
 * root is absent this script does not fail: it records what /explore currently renders, marks
 * the explore side "pending" (not "failed") in explore.json, and says why. Re-run once the
 * explore lane's markup is merged to get a real capture.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", ".."); // nextjs/scripts -> nextjs -> repo root
const BASE = (process.env.VISUAL_CONTINUITY_BASE || "http://127.0.0.1:3136").replace(/\/$/, "");
const DATE = process.env.VISUAL_CONTINUITY_DATE || new Date().toISOString().slice(0, 10);
const OUT_DIR = process.argv[2]
  ? resolve(process.argv[2])
  : join(REPO_ROOT, "docs", "audit", "visual-continuity", DATE);

const SEEK_SECONDS = 16.8; // blueprint §29's locked beat, inside opening-film-4's 18s loop (RUN = 18)
const NODE_STATES = ["current", "changed", "affected", "unresolved", "candidate", "dim"];

mkdirSync(OUT_DIR, { recursive: true });

function summarizeErrors(page, label) {
  const errors = [];
  page.on("pageerror", (e) => errors.push({ source: label, kind: "pageerror", message: e.message }));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push({ source: label, kind: "console.error", message: msg.text() });
  });
  return errors;
}

async function captureCut4(browser) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();
  const errors = summarizeErrors(page, "cut4");

  await page.goto(`${BASE}/#s3`, { waitUntil: "networkidle", timeout: 90_000 });
  await page.evaluate(() => {
    document.getElementById("s3")?.scrollIntoView({ behavior: "instant", block: "center" });
  });
  // Scene 03 mounts the live canvas only once IntersectionObserver (threshold 0.35) reports it
  // in view; give that a moment to fire before selecting the stage.
  await page.waitForTimeout(400);

  const tab = page.locator("#compile-stage-tab-world");
  await tab.waitFor({ state: "attached", timeout: 15_000 });
  /*
    CompileStagePlayer auto-advances every 5s once in view, and the tab's SSR markup is
    "attached" well before React hydrates and attaches its onClick — a click landing in that
    window is silently dropped, leaving the player on whatever stage the timer reached on its
    own (measured happening under this machine's parallel-lane load). Retry the click until the
    tab actually reports selected, instead of clicking once and trusting it.
    */
  {
    const deadline = Date.now() + 15_000;
    let selected = false;
    while (Date.now() < deadline && !selected) {
      await tab.click();
      selected = (await tab.getAttribute("aria-selected")) === "true";
      if (!selected) await page.waitForTimeout(250);
    }
    if (!selected) {
      throw new Error('the "WORLD" stage tab never reported aria-selected="true" after repeated clicks');
    }
  }

  const canvas = page.locator(".compile-film-live canvas.film-canvas");
  let canvasFound = true;
  try {
    await canvas.waitFor({ state: "attached", timeout: 15_000 });
    await page.waitForFunction(() => {
      const c = document.querySelector(".compile-film-live canvas.film-canvas");
      return c instanceof HTMLCanvasElement && c.width > 800;
    }, { timeout: 15_000 });
  } catch {
    canvasFound = false;
  }

  const result = {
    route: `${BASE}/#s3`,
    stageSelector: "#compile-stage-tab-world",
    seekSeconds: SEEK_SECONDS,
    canvasFound,
    canvasBackingSize: null,
    canvasCssSize: null,
    drawnGeometryExposed: false,
    note:
      "opening-film-4 exposes window.__filmFreeze (bool) and window.__filmSeek(t) for capture, " +
      "and window.__filmElapsed for the recorder's own clock, but no drawn-geometry data " +
      "structure (nodes/edges/labels) on window — recording the PNG and canvas backing size only.",
    errors: [],
  };

  if (!canvasFound) {
    result.note = "canvas.film-canvas inside .compile-film-live never attached — capturing whatever rendered instead.";
    await page.screenshot({ path: join(OUT_DIR, "cut4.png") });
    result.errors = errors;
    await context.close();
    return result;
  }

  await page.evaluate(() => {
    window.__filmFreeze = true;
  });
  await page.evaluate((t) => {
    window.__filmSeek?.(t);
  }, SEEK_SECONDS);
  // __filmSeek draws synchronously; one rAF tick of settle time before the shot.
  await page.waitForTimeout(50);

  const sizes = await page.evaluate(() => {
    const c = document.querySelector(".compile-film-live canvas.film-canvas");
    const rect = c.getBoundingClientRect();
    return {
      backing: { width: c.width, height: c.height },
      css: { width: rect.width, height: rect.height },
    };
  });
  result.canvasBackingSize = sizes.backing;
  result.canvasCssSize = sizes.css;

  await canvas.screenshot({ path: join(OUT_DIR, "cut4.png") });
  result.errors = errors;
  await context.close();
  return result;
}

async function captureExplore(browser) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();
  const errors = summarizeErrors(page, "explore");

  await page.goto(`${BASE}/explore?act=world`, { waitUntil: "networkidle", timeout: 90_000 });

  const root = page.locator('[data-visual-world="explore"]');
  let rootFound = true;
  try {
    await root.waitFor({ state: "attached", timeout: 8_000 });
  } catch {
    rootFound = false;
  }

  if (!rootFound) {
    await page.screenshot({ path: join(OUT_DIR, "explore.png") });
    const record = {
      status: "pending",
      reason:
        'The explore stage root [data-visual-world="explore"] was not found at /explore?act=world. ' +
        "Lane contract §4.2 defines this attribute for the redesigned Explore stage, which the " +
        "`explore` lane (agent/cl-explore) builds in parallel and had not landed on this branch " +
        "at capture time. This is expected, not a failure — the screenshot records whatever " +
        "/explore currently renders on this branch (the pre-redesign page), for reference only; " +
        "it is not the Interactive Product Film the comparison is meant to check. Re-run this " +
        "script once the explore lane's markup is merged.",
      route: `${BASE}/explore?act=world`,
      nodes: [],
      edges: [],
      compositionBounds: null,
      errors,
    };
    await context.close();
    return record;
  }

  const worldAct = await root.getAttribute("data-world-act");
  const compositionBounds = await root.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });

  const nodes = await page.$$eval("[data-visual-node]", (els) =>
    els.map((el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return {
        id: el.getAttribute("data-node-id"),
        kind: el.getAttribute("data-node-kind"),
        state: el.getAttribute("data-node-state"),
        label: el.textContent?.trim().slice(0, 200) ?? "",
        bbox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        color: style.color,
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
      };
    }),
  );

  const edges = await page.$$eval("[data-visual-edge]", (els) =>
    els.map((el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return {
        from: el.getAttribute("data-edge-from"),
        to: el.getAttribute("data-edge-to"),
        state: el.getAttribute("data-edge-state"),
        bbox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        color: style.color,
        borderColor: style.borderColor,
      };
    }),
  );

  await root.screenshot({ path: join(OUT_DIR, "explore.png") });

  const record = {
    status: "captured",
    route: `${BASE}/explore?act=world`,
    worldAct,
    compositionBounds,
    nodeCount: nodes.length,
    nodeCountInBand: nodes.length >= 7 && nodes.length <= 12,
    nodes,
    edges,
    unknownStates: [...new Set(nodes.map((n) => n.state).filter((s) => s && !NODE_STATES.includes(s)))],
    errors,
  };
  await context.close();
  return record;
}

function buildReport({ cut4, explore }) {
  const lines = [];
  lines.push(`# Landing ↔ Explore visual continuity — ${DATE}`);
  lines.push("");
  lines.push(
    "Blueprint §29: compare Film Cut 4's locked frame (`__filmSeek(16.8)`) against the Explore " +
      "stage's initial snapshot. Not required to be pixel-perfect; the point is to catch drift " +
      "in focal object, node layout, relation topology, camera bounds, key labels, state color " +
      "and major geometry.",
  );
  lines.push("");
  lines.push("## Route note");
  lines.push("");
  lines.push(
    "Lane contract §29 named `/film-4` as the film route. That route is now `notFound()` — a " +
      "deliberate stable 404 for a retired inbound URL (`app/film-4/page.tsx`). Cut 4 " +
      "(`opening-film-4`) itself is not retired: it renders inline as the \"WORLD\" tab of " +
      "`CompileStagePlayer` in the landing page's Scene 03 (`#s3`). Per repo-root `CLAUDE.md` " +
      "and lane contract §0.2 (code wins over a disagreeing document), this capture reaches " +
      "the cut through `/#s3` → click `#compile-stage-tab-world`, not through `/film-4`.",
  );
  lines.push("");
  lines.push("## Cut 4 (film side)");
  lines.push("");
  lines.push(`- Route: \`${cut4.route}\` → \`${cut4.stageSelector}\``);
  lines.push(`- Hooks used: \`window.__filmFreeze = true\`, \`window.__filmSeek(${cut4.seekSeconds})\` (both confirmed present in \`components/opening-film-4.tsx\`)`);
  lines.push(`- Canvas found: ${cut4.canvasFound ? "yes" : "no"}`);
  if (cut4.canvasBackingSize) {
    lines.push(`- Canvas backing store: ${cut4.canvasBackingSize.width}×${cut4.canvasBackingSize.height}px (device pixels, DSF 2)`);
    lines.push(`- Canvas CSS size: ${cut4.canvasCssSize.width}×${cut4.canvasCssSize.height}px`);
  }
  lines.push(`- Drawn-geometry data exposed on \`window\`: ${cut4.drawnGeometryExposed ? "yes" : "no"} — ${cut4.note}`);
  lines.push(`- Console/page errors during capture: ${cut4.errors.length}`);
  for (const e of cut4.errors) lines.push(`  - [${e.kind}] ${e.message}`);
  lines.push(`- Image: \`cut4.png\``);
  lines.push("");
  lines.push("## Explore stage (world side)");
  lines.push("");
  lines.push(`- Status: **${explore.status}**`);
  if (explore.status === "pending") {
    lines.push(`- Reason: ${explore.reason}`);
  } else {
    lines.push(`- Route: \`${explore.route}\``);
    lines.push(`- \`data-world-act\`: \`${explore.worldAct}\``);
    lines.push(`- Node count: ${explore.nodeCount} (7–12 band: ${explore.nodeCountInBand ? "yes" : "no"})`);
    lines.push(`- Edge count: ${explore.edges.length}`);
    if (explore.unknownStates.length) {
      lines.push(`- **Unknown states not in the §4.2 \`VisualState\` union**: ${explore.unknownStates.join(", ")}`);
    }
  }
  lines.push(`- Console/page errors during capture: ${explore.errors.length}`);
  for (const e of explore.errors) lines.push(`  - [${e.kind}] ${e.message}`);
  lines.push(`- Image: \`explore.png\`${explore.status === "pending" ? " (current /explore on this branch, not the redesigned stage — reference only)" : ""}`);
  lines.push("");
  lines.push("## Comparison");
  lines.push("");
  if (explore.status !== "captured") {
    lines.push(
      "Not yet possible: the explore side has no `[data-visual-world=\"explore\"]` markup on " +
        "this branch. This is `not_yet`, not a failed comparison — re-run this script after the " +
        "`explore` lane merges its Interactive Product Film rebuild.",
    );
  } else {
    lines.push("| Check | Film (cut 4) | Explore | Match |");
    lines.push("|---|---|---|---|");
    lines.push(`| Node/composition present | canvas ${cut4.canvasFound ? "rendered" : "missing"} | ${explore.nodeCount} nodes | ${cut4.canvasFound && explore.nodeCount > 0 ? "yes" : "no"} |`);
    lines.push(`| Node count in 7–12 band | n/a (canvas has no discrete node list) | ${explore.nodeCount} | ${explore.nodeCountInBand ? "yes" : "no"} |`);
    lines.push("| Camera / composition bounds | 1440×900 viewport, canvas fills its column | see `explore.json` `compositionBounds` | manual review |");
    lines.push("| State color | n/a (canvas draws directly, no discrete state attributes) | see `explore.json` node `color`/`backgroundColor` | manual review |");
  }
  lines.push("");
  lines.push("## Reproduce");
  lines.push("");
  lines.push("```bash");
  lines.push("cd nextjs && pnpm build && pnpm start --hostname 127.0.0.1 --port 3136 &");
  lines.push("VISUAL_CONTINUITY_BASE=http://127.0.0.1:3136 node scripts/visual-continuity.mjs");
  lines.push("```");
  return lines.join("\n") + "\n";
}

const browser = await chromium.launch({ headless: true });
const cut4 = await captureCut4(browser);
const explore = await captureExplore(browser);
await browser.close();

writeFileSync(join(OUT_DIR, "cut4.json"), JSON.stringify(cut4, null, 2) + "\n");
writeFileSync(join(OUT_DIR, "explore.json"), JSON.stringify(explore, null, 2) + "\n");
writeFileSync(join(OUT_DIR, "report.md"), buildReport({ cut4, explore }));

console.log(`cut4: canvasFound=${cut4.canvasFound} errors=${cut4.errors.length}`);
console.log(`explore: status=${explore.status} errors=${explore.errors.length}`);
console.log(`wrote ${OUT_DIR}`);

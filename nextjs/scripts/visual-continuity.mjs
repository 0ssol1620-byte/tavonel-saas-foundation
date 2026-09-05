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
 * Hook verification (why this script refuses instead of shrugging): the film side is a capture
 * of the *locked beat* only if `window.__filmSeek` actually redrew the canvas at 16.8s. An
 * optional call (`window.__filmSeek?.(t)`) against a renamed or removed hook leaves a canvas
 * that is still running, an empty console and a plausible-looking PNG — the exact drift this
 * lane exists to detect, absorbed silently. So before the shot is taken this script (a) records
 * the observed types of the capture hooks on `window`, (b) refuses, naming the hook, when
 * `__filmSeek` is not callable, and (c) proves the seek and the freeze did something: it digests
 * the canvas at a probe time and at the locked beat (they must differ) and again after a hold at
 * the locked beat (it must not have moved). Everything the report says about the hooks comes
 * from those observations; none of it is hardcoded. On any of those failures nothing is written,
 * so a previously committed baseline is never overwritten by a frame that is not the locked beat.
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
// A second, clearly different beat of the same cut. The seek hook is proven by the frame at
// SEEK_SECONDS differing from the frame here, so this only has to be far from 16.8 in the cut's
// own timeline; opening-film-4 draws purely as a function of t (no Math.random, no wall clock),
// so the pair is deterministic on a given renderer.
const PROBE_SECONDS = 3.2;
// Long enough that an unfrozen loop (rAF, ~60fps, elapsed advancing in real time) would have
// advanced the cut by a third of a second and redrawn ~20 times, and short enough that the whole
// verify-and-shoot sequence fits inside CompileStagePlayer's 5s auto-advance window (STAGE_MS in
// components/compile-stage-player.tsx, which a manual tab click does not stop).
const FREEZE_HOLD_MS = 350;
// The frame digest is taken from a downscale, not the 2704x1494 backing store: encoding the full
// canvas to PNG three times costs about a second, which is most of the auto-advance budget.
const DIGEST_THUMB = { width: 320, height: 180 };
const CANVAS_SELECTOR = ".compile-film-live canvas.film-canvas";
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

/**
 * sha256 of a downscale of the canvas, computed in the page. Used only to compare two frames
 * taken by the same browser in the same run — rasterisation and GPU differences make it a
 * within-run change detector, not a cross-machine baseline.
 */
async function frameDigest(page, selector, thumb) {
  return page.evaluate(async ({ sel, size }) => {
    const canvas = document.querySelector(sel);
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error(`no canvas at ${sel} when digesting a frame`);
    const scaled = document.createElement("canvas");
    scaled.width = size.width;
    scaled.height = size.height;
    const ctx = scaled.getContext("2d");
    if (!ctx) throw new Error("no 2d context for the frame digest");
    ctx.drawImage(canvas, 0, 0, size.width, size.height);
    const bytes = new TextEncoder().encode(scaled.toDataURL("image/png"));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }, { sel: selector, size: thumb });
}

async function captureCut4(browser) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    reducedMotion: "no-preference",
  });
  try {
    return await captureCut4InContext(context);
  } finally {
    await context.close();
  }
}

async function captureCut4InContext(context) {
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
  const selectWorldStage = async () => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if ((await tab.getAttribute("aria-selected")) === "true") return;
      await tab.click();
      if ((await tab.getAttribute("aria-selected")) === "true") return;
      await page.waitForTimeout(250);
    }
    throw new Error('the "WORLD" stage tab never reported aria-selected="true" after repeated clicks');
  };
  const worldStageSelected = async () => (await tab.getAttribute("aria-selected")) === "true";

  const canvas = page.locator(CANVAS_SELECTOR);
  const waitForLiveCanvas = async () => {
    try {
      await canvas.waitFor({ state: "attached", timeout: 15_000 });
      await page.waitForFunction((sel) => {
        const c = document.querySelector(sel);
        return c instanceof HTMLCanvasElement && c.width > 800;
      }, CANVAS_SELECTOR, { timeout: 15_000 });
      return true;
    } catch {
      return false;
    }
  };

  await selectWorldStage();
  const canvasFound = await waitForLiveCanvas();

  const result = {
    route: `${BASE}/#s3`,
    stageSelector: "#compile-stage-tab-world",
    canvasSelector: CANVAS_SELECTOR,
    seekSeconds: SEEK_SECONDS,
    canvasFound,
    canvasBackingSize: null,
    canvasCssSize: null,
    drawnGeometryExposed: false,
    hooksObserved: null,
    seekVerification: null,
    note: "",
    errors: [],
  };

  if (!canvasFound) {
    /*
      Fail closed. The old behaviour screenshotted whatever the page happened to show into
      cut4.png and returned exit 0, which overwrites a committed baseline with a frame that is
      not the cut. Keep the diagnostic shot under a name nothing cites, and refuse.
    */
    await page.screenshot({ path: join(OUT_DIR, "cut4-failed.png") });
    throw new Error(
      `${CANVAS_SELECTOR} never attached (or never grew past 800px of backing width) at ` +
        `${BASE}/#s3 after the WORLD stage was selected. Wrote cut4-failed.png for diagnosis and ` +
        "left the previous baseline untouched. Page/console errors seen: " +
        (errors.length ? errors.map((e) => `[${e.kind}] ${e.message}`).join(" | ") : "none"),
    );
  }

  /*
    Everything from here to the screenshot has to happen on one uninterrupted mount of the film:
    CompileStagePlayer's auto-advance (STAGE_MS = 5s) is not stopped by a manual tab click, and
    when it fires it unmounts this canvas. So the sequence is kept short (downscaled digests, a
    350ms freeze hold) and the stage is re-checked after it; if the player moved on, the attempt
    is discarded and the stage re-selected, which starts a fresh 5s window. A drifted attempt is
    never reported as a capture.
  */
  const attemptLockedBeat = async () => {
    const hooksObserved = await page.evaluate(() => ({
      /*
        Read from the page, never assumed. `opening-film-4.tsx` defines `__filmSeek` and
        publishes `__filmElapsed` inside `startLoop`, and only *reads* `__filmFreeze` in its rAF
        tick — so `__filmFreeze` is legitimately "undefined" here, before this script sets it,
        and that observation is recorded rather than dressed up.
      */
      __filmSeek: typeof window.__filmSeek,
      __filmFreeze: typeof window.__filmFreeze,
      __filmElapsed: typeof window.__filmElapsed,
    }));
    result.hooksObserved = hooksObserved;

    if (hooksObserved.__filmSeek !== "function") {
      throw new Error(
        `window.__filmSeek is not callable (observed type: ${hooksObserved.__filmSeek}); ` +
          `window.__filmElapsed observed as ${hooksObserved.__filmElapsed}. ` +
          "components/opening-film-4.tsx defines both inside startLoop; a rename, a removal, or a " +
          "reduced-motion render (which returns before defining them) all land here. Refusing to " +
          "capture: seeking through a missing hook would write a frame that is not the locked beat " +
          "while still looking successful.",
      );
    }

    await page.evaluate(() => {
      window.__filmFreeze = true;
    });
    const freezeFlagType = await page.evaluate(() => typeof window.__filmFreeze);

    // Probe beat first, then the locked beat: two different times through the same hook.
    await page.evaluate((t) => window.__filmSeek(t), PROBE_SECONDS);
    await page.waitForTimeout(50); // __filmSeek draws synchronously; a tick of settle time.
    const probeDigest = await frameDigest(page, CANVAS_SELECTOR, DIGEST_THUMB);

    await page.evaluate((t) => window.__filmSeek(t), SEEK_SECONDS);
    await page.waitForTimeout(50);
    const lockedDigest = await frameDigest(page, CANVAS_SELECTOR, DIGEST_THUMB);

    await page.waitForTimeout(FREEZE_HOLD_MS);
    const heldDigest = await frameDigest(page, CANVAS_SELECTOR, DIGEST_THUMB);

    if (!(await worldStageSelected())) return { drifted: true };

    const seekVerification = {
      method:
        `sha256 of a ${DIGEST_THUMB.width}x${DIGEST_THUMB.height} downscale of the canvas, taken ` +
        "in-page at the probe beat, at the locked beat, and again after a hold at the locked beat. " +
        "Within-run change detection only — the digests are renderer-specific and are not a " +
        "cross-machine baseline.",
      probeSeconds: PROBE_SECONDS,
      lockedSeconds: SEEK_SECONDS,
      freezeHoldMs: FREEZE_HOLD_MS,
      freezeFlagTypeAfterSet: freezeFlagType,
      probeDigestSha256: probeDigest,
      lockedDigestSha256: lockedDigest,
      heldDigestSha256: heldDigest,
      frameChangedOnSeek: probeDigest !== lockedDigest,
      frameStableUnderFreeze: lockedDigest === heldDigest,
    };
    result.seekVerification = seekVerification;

    if (!seekVerification.frameChangedOnSeek) {
      throw new Error(
        `window.__filmSeek(${PROBE_SECONDS}) and window.__filmSeek(${SEEK_SECONDS}) produced the ` +
          `same frame (sha256 ${lockedDigest}). The hook exists but did not redraw, so this capture ` +
          "cannot be called the locked beat. Refusing to write the baseline.",
      );
    }
    if (!seekVerification.frameStableUnderFreeze) {
      throw new Error(
        `the frame moved during a ${FREEZE_HOLD_MS}ms hold after seeking to ${SEEK_SECONDS}s ` +
          `(${lockedDigest} then ${heldDigest}). window.__filmFreeze did not stop the loop, so the ` +
          "PNG would be an arbitrary frame near the beat rather than the beat. Refusing to write " +
          "the baseline.",
      );
    }

    const sizes = await page.evaluate((sel) => {
      const c = document.querySelector(sel);
      const rect = c.getBoundingClientRect();
      return {
        backing: { width: c.width, height: c.height },
        css: { width: rect.width, height: rect.height },
      };
    }, CANVAS_SELECTOR);

    try {
      await canvas.screenshot({ path: join(OUT_DIR, "cut4.png"), timeout: 10_000 });
    } catch (error) {
      if (!(await worldStageSelected())) return { drifted: true };
      throw error;
    }
    if (!(await worldStageSelected())) return { drifted: true };

    result.canvasBackingSize = sizes.backing;
    result.canvasCssSize = sizes.css;
    result.note =
      "opening-film-4 exposes no drawn-geometry data structure (nodes/edges/labels) on window, so " +
      "this capture records the PNG and the canvas backing size only. Capture hooks as observed in " +
      `the page: __filmSeek=${hooksObserved.__filmSeek}, __filmElapsed=${hooksObserved.__filmElapsed}, ` +
      `__filmFreeze=${hooksObserved.__filmFreeze} before this script set it (the film reads that flag ` +
      `in its rAF tick and never defines it; typeof after setting it: ${freezeFlagType}). The seek and ` +
      "the freeze were verified by frame digest — see seekVerification.";
    return { drifted: false };
  };

  const MAX_ATTEMPTS = 4;
  let captured = false;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS && !captured; attempt += 1) {
    if (attempt > 1) {
      await selectWorldStage();
      if (!(await waitForLiveCanvas())) {
        throw new Error(
          `${CANVAS_SELECTOR} did not come back after the stage was re-selected on attempt ${attempt}.`,
        );
      }
    }
    const outcome = await attemptLockedBeat();
    captured = !outcome.drifted;
  }
  if (!captured) {
    throw new Error(
      `the WORLD stage auto-advanced away from the film during every one of ${MAX_ATTEMPTS} capture ` +
        "attempts (CompileStagePlayer STAGE_MS = 5s, not stopped by a manual click), so no frame " +
        "here is provably the locked beat. Nothing written; the previous baseline stands.",
    );
  }

  result.errors = errors;
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
  const hooks = cut4.hooksObserved;
  lines.push(
    `- Hooks used: \`window.__filmFreeze = true\`, \`window.__filmSeek(${cut4.seekSeconds})\`. ` +
      (hooks
        ? `Observed on \`window\` in the running page before the seek: \`__filmSeek\` → ${hooks.__filmSeek}, ` +
          `\`__filmElapsed\` → ${hooks.__filmElapsed}, \`__filmFreeze\` → ${hooks.__filmFreeze} ` +
          "(the film reads that flag in its rAF tick and never defines it, so `undefined` before " +
          "the capture sets it is the expected observation). The capture refuses when `__filmSeek` " +
          "is not callable."
        : "Hook types were not recorded in this run — treat the frame as unverified."),
  );
  const seek = cut4.seekVerification;
  if (seek) {
    lines.push(
      `- Seek/freeze verified by frame digest: seeking ${seek.probeSeconds}s → ${seek.lockedSeconds}s ` +
        `changed the frame (${seek.frameChangedOnSeek ? "yes" : "no"}: sha256 ` +
        `\`${seek.probeDigestSha256.slice(0, 16)}…\` → \`${seek.lockedDigestSha256.slice(0, 16)}…\`), and the ` +
        `frame did not move over a ${seek.freezeHoldMs}ms hold (${seek.frameStableUnderFreeze ? "yes" : "no"}: ` +
        `\`${seek.heldDigestSha256.slice(0, 16)}…\`). ${seek.method}`,
    );
  } else {
    lines.push("- Seek/freeze verification: not recorded in this run.");
  }
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
let cut4;
let explore;
try {
  // A film-side refusal stops the run: nothing is written, the previous baseline stands, and the
  // exit code is non-zero. An unverified frame is worse than no frame.
  cut4 = await captureCut4(browser);
  explore = await captureExplore(browser);
} finally {
  await browser.close();
}

writeFileSync(join(OUT_DIR, "cut4.json"), JSON.stringify(cut4, null, 2) + "\n");
writeFileSync(join(OUT_DIR, "explore.json"), JSON.stringify(explore, null, 2) + "\n");
writeFileSync(join(OUT_DIR, "report.md"), buildReport({ cut4, explore }));

console.log(
  `cut4: canvasFound=${cut4.canvasFound} __filmSeek=${cut4.hooksObserved?.__filmSeek} ` +
    `seekChangedFrame=${cut4.seekVerification?.frameChangedOnSeek} ` +
    `frozen=${cut4.seekVerification?.frameStableUnderFreeze} errors=${cut4.errors.length}`,
);
console.log(`explore: status=${explore.status} errors=${explore.errors.length}`);
console.log(`wrote ${OUT_DIR}`);

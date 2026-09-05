/**
 * Phone evidence for agent/cl-integration AFTER the mobile lane was merged in.
 *
 *   usage: node docs/audit/mobile/2026-09-06/final/capture.mjs [out-dir]
 *   env:   MOBILE_EVIDENCE_BASE   default http://127.0.0.1:3140
 *
 * This is the "after" to docs/audit/mobile/2026-09-05/integration/, which measured the same
 * three defects on the same branch one merge earlier. Same method, so the two are comparable:
 * a production server is required to be answering already (this script does not start one, so
 * that the thing measured stays inspectable afterwards), every screenshot is a viewport shot
 * rather than a full-page stitch (a panel hanging off the left edge does not appear in a
 * stitched capture -- which is exactly the defect being looked for), and every number in
 * capture.json is read out of the live layout instead of typed.
 *
 * Two browser/viewport pairs, as asked: chromium at 412x915 and webkit at 360x780.
 *
 * What it records, per pair:
 *
 *   1. the top of the landing page with MENU open, plus the open panel's rectangle against the
 *      viewport -- overflowLeftPx and overflowRightPx are the defect in one number, and both
 *      being 0 is the fix;
 *   2. Scene 03 at each of its four stages, with the frame's measured aspect ratio (the film is
 *      16:10 = 1.6), whether the four stage tabs share one line, whether any two text boxes in
 *      the strip intersect, and which element is actually painting the stage;
 *   3. how long stage 1 holds before the player advances itself. The harness arms its own
 *      IntersectionObserver on .compile-film-sequence at threshold 0.35 -- the same element and
 *      the same threshold the component uses -- so t0 is the moment the component's own timer
 *      arms, not the moment the script happened to scroll. t1 is the first aria-selected change
 *      on the tablist. FILM_DURATION is 18, so STAGE_MS is 18000 and that is what this should
 *      report;
 *   4. horizontal overflow: document scrollWidth against innerWidth, at the top of the page and
 *      again at Scene 03.
 *
 * Two deliberate differences from the 09-05 script, both forced by this build rather than
 * chosen:
 *
 *   a. navigation waits for `domcontentloaded` and then for the stage strip to be present,
 *      instead of for `load`. `load` waits on every film asset on the page and took minutes
 *      here; the strip being in the DOM is the readiness signal this capture actually depends
 *      on, and it is checked rather than slept through. Every measurement is still taken after
 *      that wait plus a settle, so nothing is read off a half-laid-out page.
 *
 *   b. every stage gets its own freshly loaded page, the menu and tabs are driven through the
 *      DOM rather than through Playwright's actionability wait, and every step runs under an
 *      explicit timeout.
 *
 *      This is WebKit-on-Windows, not a preference. Reproduced three times: on this page at
 *      360px, once the narrow path has mounted its fallback <video>, WebKit's renderer can wedge
 *      so hard that `page.evaluate` never settles -- and `evaluate` takes no timeout argument,
 *      so a wedged renderer hangs the script forever rather than failing. A probe isolated it:
 *      with the MP4 allowed to load and left playing, evaluate and screenshot both succeed
 *      (screenshots cost ~20s each); with the MP4 request aborted, evaluate hung and the
 *      screenshot timed out. So the decoder is not the problem -- a <video> that has been
 *      interfered with is. Nothing here pauses, blocks or mutes a decoder for that reason.
 *
 *      A fresh page per stage keeps one wedged renderer from taking the rest of the capture with
 *      it, and every timeout is recorded in capture.json as a timeout. Nothing is inferred to
 *      fill a gap: a shot that could not be taken says so.
 *
 *   c. WebKit's four Scene 03 stage shots are taken with `prefers-reduced-motion: reduce`, and
 *      are labelled that way in capture.json (`stageShotsReducedMotion`). With motion allowed,
 *      WebKit-on-Windows wedged on all four -- click, screenshot and measurement all timed out,
 *      three runs in a row -- so the alternative was no WebKit stage evidence at all.
 *
 *      Reduced motion is a real state a real reader can be in, not a synthetic one, and it is
 *      the state this project already treats as first-class. It renders the identical frame from
 *      the authored 1440x900 poster still instead of the fallback <video>, so every geometry
 *      question asked here -- 16:10 frame, four tabs on one line, no text box overlapping
 *      another, no sideways scroll -- is answered on the same layout. What it cannot answer is
 *      anything about playback, so the stage-1 hold is NOT measured here: reduced motion arms no
 *      timer by design, and that measurement is taken on a motion-allowed page instead.
 *
 *      This is a limitation of Playwright's WebKit build on Windows. It is NOT evidence about
 *      iOS Safari, which is a different port with a different media stack and cannot be tested
 *      from this machine. Do not read it as either a pass or a failure there.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/*
  Resolved from nextjs/package.json for the same reason the 09-05 capture does it: this file
  lives beside its evidence, which puts it outside the package that owns @playwright/test.
*/
const require = createRequire(resolve(HERE, "..", "..", "..", "..", "..", "nextjs", "package.json"));
const { chromium, webkit } = require("@playwright/test");

const BASE = (process.env.MOBILE_EVIDENCE_BASE || "http://127.0.0.1:3140").replace(/\/$/, "");
const OUT_DIR = process.argv[2] ? resolve(process.argv[2]) : HERE;

const PAIRS = [
  { browser: "chromium", type: chromium, viewport: { width: 412, height: 915 } },
  { browser: "webkit", type: webkit, viewport: { width: 360, height: 780 } },
];
const STAGES = ["sources", "read", "structure", "world"];

/** The poster and the first painted frame each need a beat after a tab change. */
const SETTLE_MS = 1200;

/**
 * Navigate and wait for the thing being measured, rather than for every asset on the page.
 * Returns how long it took, so the record says what the capture cost instead of implying it
 * was instant.
 */
async function openLanding(page, base) {
  const started = Date.now();
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  await page.locator(".compile-film-sequence").first().waitFor({ state: "attached", timeout: 60_000 });
  await page.waitForTimeout(SETTLE_MS);
  return Date.now() - started;
}

/**
 * Every step runs under one of these. `page.evaluate` accepts no timeout of its own, so a
 * wedged WebKit renderer would otherwise hang the process with no error to report.
 */
const TIMED_OUT = Symbol("timed-out");
async function withTimeout(promise, ms, label) {
  let timer;
  const guard = new Promise((res) => { timer = setTimeout(() => res(TIMED_OUT), ms); });
  try {
    const value = await Promise.race([promise, guard]);
    if (value === TIMED_OUT) {
      console.log(`  ! ${label}: timed out after ${ms}ms`);
      return { ok: false, timedOut: true, label };
    }
    return { ok: true, value };
  } catch (error) {
    console.log(`  ! ${label}: ${String(error).slice(0, 120)}`);
    return { ok: false, error: String(error).slice(0, 200), label };
  } finally {
    clearTimeout(timer);
  }
}

/** A real DOM click, without Playwright's actionability wait (which is where WebKit stalls). */
async function domClick(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!(el instanceof HTMLElement)) return false;
    el.click();
    return true;
  }, selector);
}

async function scrollSceneIntoView(page) {
  await page.evaluate(() => {
    document.getElementById("s3")?.scrollIntoView({ behavior: "instant", block: "center" });
  });
}

/* Nothing is paused or blocked first -- see note (b). WebKit costs ~20s a shot at 360px. */
async function shoot(page, outDir, file) {
  return withTimeout(page.screenshot({ path: join(outDir, file), timeout: 90_000 }), 100_000, `screenshot ${file}`);
}
/** Ceiling for the auto-advance measurement: 18s expected, so 40s is a generous give-up. */
const ADVANCE_CAP_MS = 40_000;

function rectOf(el) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    left: Math.round(r.left), right: Math.round(r.right),
    top: Math.round(r.top), bottom: Math.round(r.bottom),
    width: Math.round(r.width), height: Math.round(r.height),
  };
}

async function measureOverflow(page, where) {
  return page.evaluate((label) => ({
    where: label,
    viewportWidth: window.innerWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    horizontalOverflowPx: Math.max(
      0,
      Math.round(Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth),
    ),
  }), where);
}

async function measureStrip(page) {
  return page.evaluate(() => {
    const round = (r) => ({
      left: Math.round(r.left), right: Math.round(r.right),
      top: Math.round(r.top), bottom: Math.round(r.bottom),
      width: Math.round(r.width), height: Math.round(r.height),
    });
    const sequence = document.querySelector(".compile-film-sequence");
    const viewport = document.getElementById("compile-stage-panel");
    if (!sequence || !viewport) return { found: false };

    const tabs = [...sequence.querySelectorAll('[role="tab"]')].map((t) => ({
      id: t.id,
      label: (t.textContent || "").trim(),
      selected: t.getAttribute("aria-selected") === "true",
      rect: round(t.getBoundingClientRect()),
      /* A label that does not fit its button is clipped; scrollWidth exceeds clientWidth. */
      clipped: t.scrollWidth > t.clientWidth + 1,
    }));
    const tops = [...new Set(tabs.map((t) => t.rect.top))];

    const intersects = (a, b) =>
      a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    /* Text boxes in the strip that must not sit on top of one another. */
    const caption = sequence.querySelector(".compile-film-caption p");
    const progress = sequence.querySelector(".compile-film-progress");
    const textBoxes = [
      ...tabs.map((t) => ({ what: t.id, rect: t.rect })),
      caption ? { what: "caption", rect: round(caption.getBoundingClientRect()) } : null,
      progress ? { what: "progress", rect: round(progress.getBoundingClientRect()) } : null,
    ].filter(Boolean);
    const overlaps = [];
    for (let i = 0; i < textBoxes.length; i += 1) {
      for (let j = i + 1; j < textBoxes.length; j += 1) {
        if (intersects(textBoxes[i].rect, textBoxes[j].rect)) {
          overlaps.push(`${textBoxes[i].what} x ${textBoxes[j].what}`);
        }
      }
    }

    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.01;
    };
    const frameRect = round(viewport.getBoundingClientRect());
    const canvases = [...viewport.querySelectorAll("canvas")].filter(visible);
    const videos = [...viewport.querySelectorAll("video")].filter(visible);
    const images = [...viewport.querySelectorAll("img")].filter(visible);

    return {
      found: true,
      renderer: sequence.getAttribute("data-film-renderer"),
      frameRect,
      /* The film is 16:10. 1.6 is the target; this is the measured value, whatever it is. */
      frameAspect: frameRect.height > 0 ? Number((frameRect.width / frameRect.height).toFixed(3)) : null,
      tabsOnOneLine: tops.length === 1,
      tabLineTops: tops,
      tabsClipped: tabs.filter((t) => t.clipped).map((t) => t.id),
      tabs,
      textOverlaps: overlaps,
      selectedTab: tabs.find((t) => t.selected)?.id ?? null,
      painter: {
        canvas: canvases.map((c) => ({ ...round(c.getBoundingClientRect()), backing: `${c.width}x${c.height}` })),
        video: videos.map((v) => ({ ...round(v.getBoundingClientRect()), src: v.currentSrc || v.getAttribute("src") || "", paused: v.paused })),
        img: images.map((i) => ({ ...round(i.getBoundingClientRect()), src: i.currentSrc || i.getAttribute("src") || "" })),
      },
    };
  });
}

/*
  Measure the stage-1 hold on a page that has never been touched: a tap on a tab HOLDS that
  stage (the merged player will not take a chosen stage back), so any click before this point
  would disarm the very timer being measured. Hence a fresh load.
*/
async function measureAutoAdvance(page, base, capMs) {
  await openLanding(page, base);
  const result = await page.evaluate(async (cap) => {
    const sequence = document.querySelector(".compile-film-sequence");
    const strip = sequence?.querySelector('[role="tablist"]');
    if (!sequence || !strip) return { measured: false, reason: "no compile-film-sequence on the page" };

    const selected = () => [...strip.querySelectorAll('[role="tab"]')].find((t) => t.getAttribute("aria-selected") === "true")?.id ?? null;

    return await new Promise((resolveOuter) => {
      let t0 = null;
      let firstStage = null;
      let settled = false;
      const finish = (value) => { if (!settled) { settled = true; resolveOuter(value); } };

      /*
        The component arms its timer from an IntersectionObserver on this element at threshold
        0.35. Re-creating that exactly is what makes t0 the arming moment rather than the
        scrolling moment.
      */
      const io = new IntersectionObserver((entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting || t0 !== null) return;
        t0 = performance.now();
        firstStage = selected();
      }, { threshold: 0.35 });
      io.observe(sequence);

      const mo = new MutationObserver(() => {
        if (t0 === null) return;
        const now = selected();
        if (now && now !== firstStage) {
          const elapsed = Math.round(performance.now() - t0);
          io.disconnect(); mo.disconnect();
          finish({ measured: true, fromStage: firstStage, toStage: now, heldMs: elapsed });
        }
      });
      mo.observe(strip, { attributes: true, attributeFilter: ["aria-selected"], subtree: true });

      sequence.scrollIntoView({ block: "center", behavior: "instant" });

      window.setTimeout(() => {
        io.disconnect(); mo.disconnect();
        finish({ measured: false, reason: `no stage change within ${cap}ms`, fromStage: firstStage, armedAt: t0 });
      }, cap);
    });
  }, capMs);
  return result;
}

async function run() {
  mkdirSync(OUT_DIR, { recursive: true });
  const record = {
    capturedAgainst: BASE,
    capturedAt: new Date().toISOString(),
    branch: "agent/cl-integration",
    note: "Viewport screenshots, not full-page: a panel outside the viewport does not appear in a stitched full-page shot.",
    expected: { frameAspect: 1.6, stageHoldMs: 18000, horizontalOverflowPx: 0, menuOverflowPx: 0 },
    runs: [],
  };

  for (const pair of PAIRS) {
    const instance = await pair.type.launch();
    const label = `${pair.browser}-${pair.viewport.width}x${pair.viewport.height}`;
    const contextOptions = {
      viewport: pair.viewport,
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: pair.browser === "chromium",
    };
    const context = await instance.newContext(contextOptions);
    let page = await context.newPage();
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(String(e)));

    const run = { browser: pair.browser, viewport: pair.viewport, label, shots: [], errors: [] };

    const firstOpen = await withTimeout(openLanding(page, BASE), 90_000, "landing open");
    run.openedInMs = firstOpen.ok ? firstOpen.value : null;
    console.log(`${label}: landing ready in ${run.openedInMs}ms`);
    await withTimeout(page.evaluate(() => window.scrollTo(0, 0)), 30_000, "scroll top");
    const topOverflow = await withTimeout(measureOverflow(page, "landing top"), 30_000, "top overflow");
    run.overflowAtTop = topOverflow.ok ? topOverflow.value : null;

    /* 1. Page top, MENU open. */
    const triggerClick = await withTimeout(domClick(page, ".mobile-primary-nav summary"), 30_000, "menu open");
    if (triggerClick.ok && triggerClick.value) await page.waitForTimeout(600);
    const menuMeasure = await withTimeout(page.evaluate(() => {
      const round = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          left: Math.round(r.left), right: Math.round(r.right),
          top: Math.round(r.top), bottom: Math.round(r.bottom),
          width: Math.round(r.width), height: Math.round(r.height),
        };
      };
      const holder = document.querySelector(".mobile-primary-nav");
      const panel = holder?.querySelector("nav") ?? null;
      const rect = round(panel);
      const summary = round(holder?.querySelector("summary"));
      return {
        triggerFound: Boolean(holder),
        triggerLabel: (holder?.querySelector("summary")?.textContent || "").trim(),
        summaryRect: summary,
        open: holder instanceof HTMLDetailsElement ? holder.open : undefined,
        panelRect: rect,
        linkCount: panel ? panel.querySelectorAll("a").length : 0,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        overflowLeftPx: rect ? Math.max(0, -rect.left) : null,
        overflowRightPx: rect ? Math.max(0, rect.right - window.innerWidth) : null,
        overflowTopPx: rect ? Math.max(0, -rect.top) : null,
        fullyInsideViewport: rect
          ? rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth
          : null,
      };
    }), 30_000, "menu measure");
    run.menu = menuMeasure.ok ? menuMeasure.value : null;
    const menuShot = `${label}-01-top-menu-open.png`;
    const menuShotResult = await shoot(page, OUT_DIR, menuShot);
    run.shots.push({
      file: menuShot,
      what: "landing top with MENU open; panel measured against the viewport",
      captured: menuShotResult.ok,
      ...(menuShotResult.ok ? {} : { failure: menuShotResult }),
    });
    console.log(`${label}: menu shot ${menuShotResult.ok ? "done" : "FAILED"} (inside viewport = ${run.menu?.fullyInsideViewport})`);
    await page.close().catch(() => {});

    /*
      2. Scene 03, one shot per stage, each on its own freshly loaded page.

      Tapping a tab HOLDS that stage (the merged player will not take a chosen stage back), so
      one load per stage is enough and the strip cannot drift between the click and the shot.
    */
    /*
      See note (c): WebKit's stage pages run reduced-motion, which renders the poster still and
      no <video>, because with motion allowed every one of these four shots wedged the renderer.
    */
    const stageReducedMotion = pair.browser === "webkit";
    run.stageShotsReducedMotion = stageReducedMotion;
    run.stageShotsNote = stageReducedMotion
      ? "Scene 03 shots taken with prefers-reduced-motion: reduce (poster still, no <video>): WebKit-on-Windows wedged on all four with motion allowed. Layout is identical; playback is not evidenced here. Not a statement about iOS Safari."
      : "Scene 03 shots taken with motion allowed, on the narrow video-fallback path.";
    const stageContext = stageReducedMotion
      ? await instance.newContext({ ...contextOptions, reducedMotion: "reduce" })
      : context;

    for (const [index, stage] of STAGES.entries()) {
      const stagePage = await stageContext.newPage();
      stagePage.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      stagePage.on("pageerror", (e) => errors.push(String(e)));
      const file = `${label}-02-s3-${String(index + 1).padStart(2, "0")}-${stage}.png`;
      const entry = { file, what: `Scene 03 at stage ${stage.toUpperCase()}` };

      const opened = await withTimeout(openLanding(stagePage, BASE), 90_000, `${stage}: open`);
      if (opened.ok) {
        await withTimeout(scrollSceneIntoView(stagePage), 30_000, `${stage}: scroll`);
        await stagePage.waitForTimeout(SETTLE_MS);
        if (index === 0) {
          const overflow = await withTimeout(measureOverflow(stagePage, "scene 03"), 30_000, "scene overflow");
          if (overflow.ok) run.overflowAtScene = overflow.value;
        }
        const clicked = await withTimeout(domClick(stagePage, `#compile-stage-tab-${stage}`), 30_000, `${stage}: click`);
        entry.tabFound = clicked.ok ? clicked.value : false;
        await stagePage.waitForTimeout(SETTLE_MS);
        await withTimeout(scrollSceneIntoView(stagePage), 30_000, `${stage}: rescroll`);
        await stagePage.waitForTimeout(400);

        const shotResult = await shoot(stagePage, OUT_DIR, file);
        entry.captured = shotResult.ok;
        if (!shotResult.ok) entry.failure = shotResult;

        const strip = await withTimeout(measureStrip(stagePage), 30_000, `${stage}: measure`);
        entry.strip = strip.ok ? strip.value : null;
        if (!strip.ok) entry.stripFailure = strip;
      } else {
        entry.captured = false;
        entry.failure = opened;
      }

      run.shots.push(entry);
      console.log(
        `${label}: s3 ${stage} -> captured=${entry.captured} selected=${entry.strip?.selectedTab} ` +
        `aspect=${entry.strip?.frameAspect} renderer=${entry.strip?.renderer}`,
      );
      await stagePage.close().catch(() => {});
    }
    page = await context.newPage();
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(String(e)));

    /* 3. Auto-advance timing, on a page nobody has tapped. */
    console.log(`${label}: measuring the stage-1 hold (up to ${ADVANCE_CAP_MS}ms)`);
    const advance = await withTimeout(measureAutoAdvance(page, BASE, ADVANCE_CAP_MS), ADVANCE_CAP_MS + 90_000, "auto-advance");
    run.autoAdvance = advance.ok ? advance.value : { measured: false, reason: `harness ${advance.timedOut ? "timeout" : "error"}`, detail: advance };
    console.log(`${label}: stage-1 hold = ${run.autoAdvance?.heldMs ?? run.autoAdvance?.reason}`);

    run.errors = errors;
    record.runs.push(run);
    if (stageContext !== context) await stageContext.close().catch(() => {});
    await context.close().catch(() => {});
    await instance.close().catch(() => {});
  }

  writeFileSync(join(OUT_DIR, "capture.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  const shots = record.runs.reduce((n, r) => n + r.shots.length, 0);
  console.log(`wrote ${shots} screenshots and capture.json to ${OUT_DIR}`);
  for (const run of record.runs) {
    console.log(
      `${run.label}: menuInsideViewport=${run.menu?.fullyInsideViewport} ` +
      `menuOverflowLeft=${run.menu?.overflowLeftPx} overflowTop=${run.overflowAtTop?.horizontalOverflowPx} ` +
      `overflowScene=${run.overflowAtScene?.horizontalOverflowPx} ` +
      `aspects=${run.shots.filter((s) => s.strip).map((s) => s.strip.frameAspect).join(",")} ` +
      `tabsOneLine=${run.shots.filter((s) => s.strip).every((s) => s.strip.tabsOnOneLine)} ` +
      `overlaps=${run.shots.filter((s) => s.strip).reduce((n, s) => n + s.strip.textOverlaps.length, 0)} ` +
      `stage1HoldMs=${run.autoAdvance?.heldMs ?? run.autoAdvance?.reason} errors=${run.errors.length}`,
    );
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

/**
 * Landing ↔ Explore visual continuity (blueprint §29).
 *
 * The full comparison (node layout, camera bounds, state color, geometry) is produced by
 * `scripts/visual-continuity.mjs` into `docs/audit/visual-continuity/<date>/`; this spec is the
 * lighter CI-side gate that runs on every `pnpm exec playwright test`. It asserts the film side
 * (Cut 4, reached through the landing page's Scene 03 — see the route note below) on every
 * project this suite runs, including `reduced-motion`, where the component swaps the live canvas
 * for its static poster and the assertion follows that path instead of skipping.
 *
 * What the film side actually asserts: that the capture hooks the audit script depends on are
 * still there and still work. `window.__filmSeek?.(t)` against a renamed or deleted hook renders
 * a perfectly healthy canvas and an empty console, so a size check alone would keep passing while
 * `scripts/visual-continuity.mjs` quietly photographed an arbitrary frame instead of the locked
 * beat. This spec therefore requires `__filmSeek` to be callable, requires two different seek
 * times to produce two different frames, and requires the frame to stand still while
 * `__filmFreeze` is set.
 *
 * The explore side only exists once the `explore` lane (agent/cl-explore) lands the redesigned
 * Interactive Product Film and its `[data-visual-world="explore"]` markup (lane contract §4.2).
 * Until then this test.skip()s with a named reason rather than failing or asserting nothing.
 *
 * Route note: lane contract §29 named `/film-4`. That route is `notFound()` — a deliberate
 * stable 404 for a retired inbound URL (`app/film-4/page.tsx`); the cut itself lives inline as
 * the "WORLD" tab of `CompileStagePlayer` in the landing page's Scene 03 (`#s3`). Code wins over
 * a disagreeing document (repo-root `CLAUDE.md`; lane contract §0.2), so this spec reaches Cut 4
 * the way it is actually rendered today.
 *
 * Context note (`reduced-motion` project): this suite's own `page` fixture — built from
 * `playwright.config.ts`'s project `use` block — does not deliver `reducedMotion: "reduce"` to
 * the page's `window.matchMedia("(prefers-reduced-motion: reduce)")`; verified by direct
 * comparison in this environment (Playwright 1.62.0/Chromium): a context built by hand with the
 * identical option (`browser.newContext({ reducedMotion: "reduce" })`) reports it correctly,
 * the fixture-built one does not, deterministically across repeated runs. `playwright.config.ts`
 * is not this lane's file to change (lane contract §3 ownership), so every test below builds its
 * own context from the `browser` fixture instead of using the ambient `page`, matching each
 * project's own viewport/reducedMotion `use` values by hand. Worth a founder/shared-config look —
 * see the structured report's risks.
 */

const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

type Locator = {
  waitFor: (options?: { state?: string; timeout?: number }) => Promise<void>;
  click: () => Promise<void>;
  getAttribute: (name: string) => Promise<string | null>;
  isVisible: () => Promise<boolean>;
  count: () => Promise<number>;
};

type Page = {
  goto: (url: string, options?: { waitUntil?: string }) => Promise<unknown>;
  evaluate: <T>(fn: (...args: never[]) => T, arg?: unknown) => Promise<T>;
  waitForFunction: (fn: (...args: never[]) => unknown, arg?: unknown, options?: { timeout?: number }) => Promise<unknown>;
  waitForTimeout: (ms: number) => Promise<void>;
  locator: (selector: string) => Locator;
  $$eval: <T>(selector: string, fn: (...args: never[]) => T) => Promise<T>;
  on: (event: string, handler: (value: never) => void) => void;
};

type ProjectUse = { viewport?: { width: number; height: number } | null; reducedMotion?: string; baseURL?: string };

type BrowserLike = {
  newContext: (options?: Record<string, unknown>) => Promise<{
    newPage: () => Promise<Page>;
    close: () => Promise<void>;
  }>;
};

const SEEK_SECONDS = 16.8; // opening-film-4's RUN is 18s; matches scripts/visual-continuity.mjs
const PROBE_SECONDS = 3.2; // a clearly different beat of the same cut; matches the script
const FREEZE_HOLD_MS = 350; // an unfrozen rAF loop would advance the cut and redraw ~20 times
const CANVAS_SELECTOR = ".compile-film-live canvas.film-canvas";
// Digest a downscale, not the full backing store: three full-size PNG encodes cost about a
// second, and everything here has to finish inside CompileStagePlayer's 5s auto-advance window.
const DIGEST_THUMB = { width: 320, height: 180 };
const NODE_STATES = ["current", "changed", "affected", "unresolved", "candidate", "dim"];

/** sha256 of a downscale of the canvas, computed in the page; compared only against another
 *  frame of the same run in the same browser, never against a stored value. */
async function frameDigest(page: Page, selector: string): Promise<string> {
  return page.evaluate(async (arg: { sel: string; size: { width: number; height: number } }) => {
    const canvas = document.querySelector(arg.sel);
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error(`no canvas at ${arg.sel}`);
    const scaled = document.createElement("canvas");
    scaled.width = arg.size.width;
    scaled.height = arg.size.height;
    const ctx = scaled.getContext("2d");
    if (!ctx) throw new Error("no 2d context for the frame digest");
    ctx.drawImage(canvas, 0, 0, arg.size.width, arg.size.height);
    const bytes = new TextEncoder().encode(scaled.toDataURL("image/png"));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }, { sel: selector, size: DIGEST_THUMB });
}

async function goToSceneThree(page: Page) {
  await page.goto("/#s3", { waitUntil: "networkidle" });
  await page.evaluate(() => {
    document.getElementById("s3")?.scrollIntoView({ behavior: "instant" as ScrollBehavior, block: "center" });
  });
  await page.waitForTimeout(400);
  const tab = page.locator("#compile-stage-tab-world");
  await tab.waitFor({ state: "visible", timeout: 25_000 });
  /*
    CompileStagePlayer auto-advances every 5s (STAGE_MS) once in view, and the tab's SSR markup
    is "attached" well before React hydrates and attaches its onClick — a click that lands in
    that window is silently dropped, and the player is then found on whatever stage the
    auto-advance timer reached on its own. Asserting `aria-selected` (auto-retrying) and
    re-clicking until it actually flips is what makes this deterministic instead of racy.
  */
  await expect(async () => {
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 1_000 });
  }).toPass({ timeout: 25_000 });
}

test.describe("visual continuity — cut 4 (film side)", () => {
  test("the WORLD stage of the compile film reaches its locked beat", async ({ browser }: { browser: BrowserLike }, testInfo) => {
    // Default 30s is razor-thin against this test's own sub-waits (hydration 25s + canvas 25s +
    // the retried seek/verify block 45s + the backing re-read 20s) once several lanes are
    // building in parallel on this machine (measured: a clean ~25s run under contention exceeded
    // 30s when all three projects ran together in one invocation — same cause as the
    // reduced-motion hydration note above). The retried blocks exist because the film's stage
    // player auto-advances every 5s; the budget is the worst case, not the expected cost (a
    // healthy run finishes in ~20s). This raises no assertion's bar and hides no failure: a real
    // regression fails every retry and is reported at the first deadline it hits.
    test.setTimeout(120_000);
    const use = testInfo.project.use as ProjectUse;
    const context = await browser.newContext({
      viewport: use.viewport ?? { width: 1440, height: 900 },
      reducedMotion: use.reducedMotion,
      baseURL: use.baseURL,
    });
    try {
      await runCut4Test(context, testInfo);
    } finally {
      await context.close();
    }
  });
});

async function runCut4Test(
  context: { newPage: () => Promise<Page> },
  testInfo: { project: { name: string } },
) {
  const page = await context.newPage();

    const errors: string[] = [];
    page.on("console", (message: { type: () => string; text: () => string }) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error: { message: string }) => errors.push(error.message));

    await goToSceneThree(page);

    const reducedMotion = testInfo.project.name === "reduced-motion";
    if (reducedMotion) {
      // §1 standing rule: reduced motion removes transitions, never content — the still poster
      // for the selected stage must still be there and still be the WORLD stage, not blank.
      // Dynamic-import + hydration under this suite's shared-machine load can take a few
      // seconds (measured up to ~3s locally under contention), well short of this budget.
      const poster = page.locator(".compile-film-viewport img.compile-film-still");
      await poster.waitFor({ state: "visible", timeout: 25_000 });
      const alt = await poster.getAttribute("alt");
      expect(alt ?? "").toMatch(/WORLD/i);
      const canvasCount = await page.locator(CANVAS_SELECTOR).count();
      expect(canvasCount).toBe(0);
    } else {
      const canvas = page.locator(CANVAS_SELECTOR);
      await canvas.waitFor({ state: "attached", timeout: 25_000 });
      // A viewport-relative bound, not a fixed pixel count: at the 390 project's CSS width the
      // canvas's own backing store is ~700px (ratio ~2x of a much narrower CSS box), while at
      // 1440 it is ~2700px — both real, neither near the other's number. The check that matters
      // here is "the canvas actually drew something", not a specific viewport's pixel count.
      await page.waitForFunction(() => {
        const c = document.querySelector(".compile-film-live canvas.film-canvas");
        return c instanceof HTMLCanvasElement && c.width > 200 && c.height > 100;
      }, undefined, { timeout: 25_000 });

      const worldTab = page.locator("#compile-stage-tab-world");

      /*
        The capture contract, asserted rather than assumed. `scripts/visual-continuity.mjs`
        commits a baseline PNG of the beat at SEEK_SECONDS; that artifact only means what it
        claims while these hooks exist and work. `opening-film-4.tsx` defines `__filmSeek` and
        publishes `__filmElapsed` inside `startLoop`, and only *reads* `__filmFreeze` in its rAF
        tick — so `__filmFreeze` is undefined until a capture sets it, and asserting on its type
        here would assert nothing.

        Kept outside the retried block below and on a short budget: a renamed or deleted hook is
        not contention, and it should say so in seconds with the observed type in the message
        rather than being retried for a minute. It is polled only because `__filmSeek` is
        assigned in `startLoop` and `__filmElapsed` on the first rAF tick, either of which can be
        a frame behind the canvas gaining its backing size. Both globals survive an unmount, so
        stage drift cannot make this check flap.
      */
      await expect(async () => {
        const hooks = await page.evaluate(() => {
          const win = window as unknown as { __filmSeek?: unknown; __filmElapsed?: unknown };
          return { seek: typeof win.__filmSeek, elapsed: typeof win.__filmElapsed };
        });
        expect(hooks.seek).toBe("function");
        expect(hooks.elapsed).toBe("number");
      }).toPass({ timeout: 10_000 });

      /*
        Seek, freeze and the three frames they produce are retried as one unit because
        CompileStagePlayer auto-advances 5s after a stage is selected and a manual click does not
        stop it (STAGE_MS in components/compile-stage-player.tsx): if the player moves on
        mid-sequence this canvas is unmounted, which is contention, not a regression.
        Re-selecting the stage starts a fresh window. A seek that does not redraw and a freeze
        that does not hold still fail — they fail on every attempt.
      */
      await expect(async () => {
        if ((await worldTab.getAttribute("aria-selected")) !== "true") {
          await worldTab.click();
          await expect(worldTab).toHaveAttribute("aria-selected", "true", { timeout: 2_000 });
          await page.waitForFunction((sel: string) => {
            const c = document.querySelector(sel);
            return c instanceof HTMLCanvasElement && c.width > 200 && c.height > 100;
          }, CANVAS_SELECTOR, { timeout: 15_000 });
        }

        await page.evaluate(() => {
          (window as unknown as { __filmFreeze?: boolean }).__filmFreeze = true;
        });
        await page.evaluate((t: number) => {
          (window as unknown as { __filmSeek: (t: number) => void }).__filmSeek(t);
        }, PROBE_SECONDS);
        await page.waitForTimeout(50);
        const probeDigest = await frameDigest(page, CANVAS_SELECTOR);

        await page.evaluate((t: number) => {
          (window as unknown as { __filmSeek: (t: number) => void }).__filmSeek(t);
        }, SEEK_SECONDS);
        await page.waitForTimeout(50);
        const lockedDigest = await frameDigest(page, CANVAS_SELECTOR);

        // The hook redrew: two different beats of a cut drawn purely as a function of t cannot
        // be the same frame. This is what fails if `__filmSeek` is renamed, removed or inert.
        expect(lockedDigest).not.toBe(probeDigest);

        // And the freeze held: the beat photographed is the beat asked for, not a later one.
        await page.waitForTimeout(FREEZE_HOLD_MS);
        expect(await frameDigest(page, CANVAS_SELECTOR)).toBe(lockedDigest);

        // The film stayed mounted for the whole sequence, so those three frames are one film.
        await expect(worldTab).toHaveAttribute("aria-selected", "true", { timeout: 1_000 });
      }).toPass({ timeout: 45_000 });

      // Same auto-advance caveat: the canvas can be gone by the time this runs, so re-select
      // and re-read rather than dereferencing whatever the player left behind.
      await expect(async () => {
        if ((await worldTab.getAttribute("aria-selected")) !== "true") {
          await worldTab.click();
          await expect(worldTab).toHaveAttribute("aria-selected", "true", { timeout: 2_000 });
        }
        const backing = await page.evaluate((sel: string) => {
          const c = document.querySelector(sel);
          if (!(c instanceof HTMLCanvasElement)) return null;
          const rect = c.getBoundingClientRect();
          return { width: c.width, height: c.height, cssWidth: rect.width };
        }, CANVAS_SELECTOR);
        expect(backing).not.toBeNull();
        // The canvas backing store scales with devicePixelRatio (opening-film-4.tsx forces a
        // ratio between 2 and 3 regardless of the real DPR) — a backing width no wider than its
        // own CSS width would mean the fix in record-film-2x.mjs's own comment (soft on HiDPI)
        // regressed, at whatever viewport this project runs.
        expect(backing!.width).toBeGreaterThan(backing!.cssWidth * 1.5);
        expect(backing!.height).toBeGreaterThan(100);
      }).toPass({ timeout: 20_000 });
    }

  expect(errors).toEqual([]);
}

test.describe("visual continuity — explore stage (world side)", () => {
  test("the explore stage's initial composition matches the film's focal object and node band", async ({ page }, testInfo) => {
    await page.goto("/explore?act=world");

    const root = page.locator('[data-visual-world="explore"]');
    let present = false;
    try {
      await root.waitFor({ state: "attached", timeout: 8_000 });
      present = true;
    } catch {
      present = false;
    }

    testInfo.skip(
      !present,
      "explore stage root [data-visual-world=\"explore\"] absent — the explore lane " +
        "(agent/cl-explore) had not landed the redesigned Interactive Product Film on this " +
        "branch yet (lane contract §29/§4.2); expected while it runs in parallel.",
    );

    const nodeStates = await page.$$eval("[data-visual-node]", (els) =>
      (els as Element[]).map((el) => el.getAttribute("data-node-state")),
    );
    expect(nodeStates.length).toBeGreaterThanOrEqual(7);
    expect(nodeStates.length).toBeLessThanOrEqual(12);
    for (const state of nodeStates) {
      expect(NODE_STATES).toContain(state);
    }

    const edgeEndpoints = await page.$$eval("[data-visual-edge]", (els) =>
      (els as Element[]).map((el) => ({
        from: el.getAttribute("data-edge-from"),
        to: el.getAttribute("data-edge-to"),
      })),
    );
    const nodeIds = await page.$$eval("[data-visual-node]", (els) =>
      (els as Element[]).map((el) => el.getAttribute("data-node-id")),
    );
    for (const edge of edgeEndpoints) {
      expect(nodeIds).toContain(edge.from);
      expect(nodeIds).toContain(edge.to);
    }
  });
});

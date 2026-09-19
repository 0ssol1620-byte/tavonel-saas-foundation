import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
  The landing's motion contract (blueprint §23, §26, §4.1, §11.2; lane contract rules 8 and 11).

  This file is not a screenshot and it is not a pin of the sheet's text. Everything below is
  RECOMPUTED from `app/landing-v2.css` and the scene module sheets every run: the storyboard's
  beat times, how many things move at the same instant, which durations are tokens, and whether a
  running animation is reachable by the pause control. A keyframe edited by eye fails here on the
  measurement, which is the only way a 16-second loop nobody can see in CI stays honest.

  WHY A UNIT TEST AND NOT AN e2e. The sequence is pure CSS on a shared 16s timeline with no
  delays, so the whole of it is declared in the stylesheet -- there is nothing a browser would
  tell us about the timings that the sheet does not already state. What a browser IS needed for
  (that the beats are legible, that the phone composition holds, that reduced motion looks
  composed) belongs to the QA stage's Playwright run and to a human looking at it.

  Newlines are normalised: this repository checks CSS out with CRLF on Windows and LF in CI.
*/

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const SCENE_DIR = "components/landing-v2/scenes";
const MODULE_SHEETS = readdirSync(new URL(`../${SCENE_DIR}`, import.meta.url))
  .filter((name) => name.endsWith(".module.css"))
  .map((name) => `${SCENE_DIR}/${name}`);
/** Every stylesheet this lane owns: the landing's shared sheet plus each scene's module sheet. */
const SHEETS = ["app/landing-v2.css", ...MODULE_SHEETS];

/** The 16-second hero timeline: 14 seconds of storyboard and a 2-second hold (§11.2, D11). */
const LOOP_SECONDS = 16;
/** §11.2 is written to a tenth of a second; the lane measures the built sheet against it at 0.2. */
const TOLERANCE = 0.2;
const seconds = (percent: number) => (percent / 100) * LOOP_SECONDS;

/* ============================================================================ a very small CSS reader */

type Rule = { prelude: string; body: string; context: string[] };

/**
 * Split a stylesheet into declaration blocks, carrying the at-rules each one sits inside.
 *
 * Deliberately not a CSS parser: it matches braces and nothing else. That is enough for the
 * questions below (which declarations exist, under which selector, inside which @media) and it
 * has no dependency, which matters more here than completeness -- the sheets it reads are ours.
 * `@keyframes` blocks are returned whole, body included, and read by `keyframes()` instead.
 */
function blocks(css: string, context: string[] = [], out: Rule[] = []): Rule[] {
  let i = 0;
  let prelude = "";
  while (i < css.length) {
    const ch = css[i];
    if (ch === "{") {
      let depth = 1;
      let j = i + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === "{") depth += 1;
        else if (css[j] === "}") depth -= 1;
        j += 1;
      }
      const body = css.slice(i + 1, j - 1);
      const head = prelude.trim();
      if (head.startsWith("@media") || head.startsWith("@supports")) blocks(body, [...context, head], out);
      else out.push({ prelude: head, body, context });
      prelude = "";
      i = j;
    } else if (ch === "}") {
      prelude = "";
      i += 1;
    } else {
      prelude += ch;
      i += 1;
    }
  }
  return out;
}

/** The declarations of one block, as `property -> value`. Later wins, as the cascade has it. */
function declarations(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of body.replace(/\{[^{}]*\}/g, "").split(";")) {
    const at = part.indexOf(":");
    if (at < 0) continue;
    const property = part.slice(0, at).trim();
    if (!property || property.startsWith("--") || property.startsWith("@")) continue;
    out.set(property, part.slice(at + 1).trim());
  }
  return out;
}

type Stop = { percent: number; declarations: Map<string, string> };

/** Every `@keyframes` in a sheet, as name -> stops sorted by time. */
function keyframes(css: string): Map<string, Stop[]> {
  const out = new Map<string, Stop[]>();
  for (const match of css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)) {
    const stops: Stop[] = [];
    for (const frame of match[2]!.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const decls = declarations(frame[2]!);
      for (const raw of frame[1]!.split(",")) {
        const key = raw.trim();
        const percent = key === "from" ? 0 : key === "to" ? 100 : Number.parseFloat(key);
        if (Number.isNaN(percent)) continue;
        stops.push({ percent, declarations: decls });
      }
    }
    out.set(match[1]!, stops.sort((a, b) => a.percent - b.percent));
  }
  return out;
}

const landing = stripComments(read("app/landing-v2.css"));
const landingKeyframes = keyframes(landing);
const landingBlocks = blocks(landing);

/* ================================================================================== §11.2 storyboard */

/*
  The storyboard, as the blueprint writes it, in seconds. Every row names the element the beat
  belongs to, the keyframe that drives it, and the property whose value says the element is "on".

  `window` is when that element is fully in its beat state. Two shapes appear, and both are the
  blueprint's: an element that ARRIVES over its beat (the page rises through 0.0-1.2s and is
  simply there afterwards, so its window opens at the beat's END) and an element that HOLDS for
  its beat and then goes (the captions, the slot's four panels, the coordinate label).
*/
const STORYBOARD: { beat: string; keyframe: string; property: string; on: string; window: [number, number | null] }[] = [
  // 0.0-1.2 Source arrives -- the strip and the thumbnail rise together and stay.
  { beat: "source", keyframe: "lv2-b-source", property: "opacity", on: "1", window: [1.2, null] },
  // 1.2-2.4 Read -- the box on the page, and the line that reaches it.
  { beat: "read/region", keyframe: "lv2-b-read", property: "opacity", on: "1", window: [2.4, null] },
  { beat: "read/line", keyframe: "lv2-b-read-line", property: "transform", on: "scaleY(1)", window: [2.4, null] },
  // 2.4-4.0 Compile -- the line draws down, the claim arrives bound to it.
  { beat: "compile/line", keyframe: "lv2-b-claim-line", property: "transform", on: "scaleY(1)", window: [4.0, null] },
  { beat: "compile/claim", keyframe: "lv2-b-compile", property: "opacity", on: "1", window: [4.0, null] },
  // 4.0-5.8 Structure -- the objects bound to the region. Held through Verify: see the note below.
  { beat: "structure", keyframe: "lv2-slot-structure", property: "opacity", on: "1", window: [4.0, 7.2] },
  // 5.8-7.2 Verify -- the state the World gives the object, one dot pulse, and the coordinate.
  { beat: "verify/state", keyframe: "lv2-b-verify", property: "opacity", on: "1", window: [5.8, null] },
  { beat: "verify/pulse", keyframe: "lv2-b-pulse", property: "transform", on: "scale(1.9)", window: [6.12, 6.12] },
  { beat: "verify/coordinate", keyframe: "lv2-b-coordinate", property: "opacity", on: "1", window: [5.8, 7.2] },
  // 7.2-9.5 Change, 9.5-11.5 Recompile, 11.5-14 Use, then the 2-second hold.
  { beat: "change", keyframe: "lv2-slot-change", property: "opacity", on: "1", window: [7.2, 9.5] },
  { beat: "recompile", keyframe: "lv2-slot-recompile", property: "opacity", on: "1", window: [9.5, 11.5] },
  { beat: "use", keyframe: "lv2-slot-use", property: "opacity", on: "1", window: [11.5, 14.0] },
  { beat: "hold", keyframe: "lv2-slot-hold", property: "opacity", on: "1", window: [14.0, 16.0] },
];

/** The 8 narration captions, one per §11.2 beat, in order. */
const CAPTION_BEATS: [number, number][] = [
  [0.0, 1.2],
  [1.2, 2.4],
  [2.4, 4.0],
  [4.0, 5.8],
  [5.8, 7.2],
  [7.2, 9.5],
  [9.5, 11.5],
  // The last caption describes the composed hero, so it holds through the 2-second pause.
  [11.5, 16.0],
];

/** The maximal stretch, in seconds, over which `property` holds the value `on`. */
function onWindow(name: string, property: string, on: string): [number, number] {
  const stops = landingKeyframes.get(name);
  expect(stops, `@keyframes ${name} is declared`).toBeTruthy();
  const hits = stops!.filter((stop) => (stop.declarations.get(property) ?? "").replace(/\s+/g, "") === on);
  expect(hits.length, `@keyframes ${name} sets ${property}: ${on}`).toBeGreaterThan(0);
  return [seconds(hits[0]!.percent), seconds(hits[hits.length - 1]!.percent)];
}

describe("the hero storyboard matches §11.2", () => {
  it("is one 16-second loop: 14 seconds of beats and a 2-second hold", () => {
    const timeline = landingBlocks.find((rule) => rule.body.includes("animation-iteration-count: infinite"));
    expect(timeline?.body).toContain(`animation-duration: ${LOOP_SECONDS}s`);
    expect(timeline?.body).toContain("animation-iteration-count: infinite");
    // One easing pair for the whole sequence (§23.3).
    expect(timeline?.body).toContain("animation-timing-function: var(--ease-scene)");
  });

  it.each(STORYBOARD)("$beat lands within ±0.2s of the storyboard", ({ keyframe, property, on, window }) => {
    const [start, end] = onWindow(keyframe, property, on);
    expect(Math.abs(start - window[0]), `${keyframe} starts at ${start}s, storyboard says ${window[0]}s`).toBeLessThanOrEqual(
      TOLERANCE + 1e-9,
    );
    if (window[1] !== null) {
      expect(Math.abs(end - window[1]), `${keyframe} ends at ${end}s, storyboard says ${window[1]}s`).toBeLessThanOrEqual(
        TOLERANCE + 1e-9,
      );
    }
  });

  it.each(CAPTION_BEATS.map((beat, index) => ({ caption: index + 1, beat })))(
    "caption $caption reads for its own beat and no other",
    ({ caption, beat }) => {
      const [start, end] = onWindow(`lv2-cap-${caption}`, "opacity", "1");
      expect(Math.abs(start - beat[0]), "caption start drift").toBeLessThanOrEqual(TOLERANCE + 1e-9);
      expect(Math.abs(end - beat[1]), "caption end drift").toBeLessThanOrEqual(TOLERANCE + 1e-9);
    },
  );

  it("never shows two narration captions at once", () => {
    const windows = CAPTION_BEATS.map((_, index) => onWindow(`lv2-cap-${index + 1}`, "opacity", "1"));
    for (let i = 1; i < windows.length; i += 1) {
      expect(windows[i]![0], `caption ${i + 1} opens after caption ${i} has closed`).toBeGreaterThanOrEqual(
        windows[i - 1]![1]!,
      );
    }
  });

  it("pulses the state dot exactly once", () => {
    const stops = landingKeyframes.get("lv2-b-pulse")!;
    const swells = stops.filter((stop) => /scale\(/.test(stop.declarations.get("transform") ?? ""));
    expect(swells.length, "one swell, not a heartbeat").toBe(1);
    // It ends where it started, so the resting dot -- and every screenshot of it -- is unscaled.
    expect(stops[0]!.declarations.get("transform")).toBe("none");
    expect(stops[stops.length - 1]!.declarations.get("transform")).toBe("none");
  });

  it("draws the Evidence Line and the region without a moving gradient or a scan beam", () => {
    /*
      §11.2 bars the scanning beam explicitly, and §4.1 makes the line a drawn hairline rather
      than a lit one. Both defects have the same tell in CSS: an animated gradient, or a
      background/mask that travels. The line is drawn by `scaleY` from a `transform-origin: top`
      1px column (`components/landing-v2/evidence-line.tsx`); the region is revealed as a whole.
    */
    for (const [name, stops] of landingKeyframes) {
      for (const stop of stops) {
        for (const [property, value] of stop.declarations) {
          expect(/gradient/.test(value), `@keyframes ${name} paints a gradient`).toBe(false);
          expect(
            /^(background-position|background|mask-position|mask|filter|box-shadow)$/.test(property),
            `@keyframes ${name} animates ${property}, which is how a scan beam is built`,
          ).toBe(false);
        }
      }
    }
    expect(landing).toContain("transform-origin: top");
  });
});

/* ============================================================== §23.2: at most three things at once */

/** The [from, to) stretches, in percent, over which a keyframe's value is actually changing. */
function movingRanges(stops: Stop[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 1; i < stops.length; i += 1) {
    const before = stops[i - 1]!;
    const after = stops[i]!;
    const properties = new Set([...before.declarations.keys(), ...after.declarations.keys()]);
    let changes = false;
    for (const property of properties) {
      if (before.declarations.get(property) !== after.declarations.get(property)) changes = true;
    }
    if (changes && after.percent > before.percent) out.push([before.percent, after.percent]);
  }
  return out;
}

describe("§23: at most three objects move at the same time", () => {
  /*
    THE READING OF THE RULE, STATED SO IT IS NOT QUIETLY RE-READ LATER.

    The blueprint says "동시에 움직이는 object는 최대 3개" -- at most three moving AT ONCE -- and the
    timeline is sampled here every 10ms to check it. The other reading, "at most three elements
    move anywhere inside a 100ms window", cannot be satisfied by any sequential storyboard: at
    every handover the outgoing beat and the incoming one are adjacent by construction, so a
    window straddling a boundary contains up to six elements' ends and starts while never more
    than three are moving at any instant in it. Handovers are what the ±0.2s check above governs.
  */
  const bindings = [...landing.matchAll(/([^{};]+)\{[^{}]*animation-name:\s*([\w-]+)/g)].map((match) => ({
    selector: match[1]!.trim().split("\n").pop()!.trim(),
    keyframe: match[2]!,
  }));

  it("binds every beat to an element", () => {
    // Nine stage elements, eight captions, four slot beats and the resting stack.
    expect(bindings.length).toBe(22);
  });

  it("never has a fourth element in motion", () => {
    const moving = bindings.map((binding) => ({
      selector: binding.selector,
      ranges: movingRanges(landingKeyframes.get(binding.keyframe) ?? []),
    }));
    let worst = { at: 0, movers: [] as string[] };
    for (let percent = 0; percent < 100; percent += (0.01 / LOOP_SECONDS) * 100) {
      const movers = moving
        .filter((entry) => entry.ranges.some(([from, to]) => percent > from && percent < to))
        .map((entry) => entry.selector);
      if (movers.length > worst.movers.length) worst = { at: seconds(percent), movers };
    }
    expect(worst.movers.length, `at ${worst.at.toFixed(2)}s: ${worst.movers.join(", ")}`).toBeLessThanOrEqual(3);
  });
});

/* ======================================================================== §23: tokens, not numbers */

const DURATION_PROPERTIES = /^(transition|transition-duration|animation|animation-duration)$/;
const TIME_LITERAL = /(?<![\w-])(\d+(?:\.\d+)?)(ms|s)(?![\w-])/g;
const REDUCED = /prefers-reduced-motion:\s*reduce/;

/** Every time literal in a declaration value, in milliseconds. */
function times(value: string): number[] {
  return [...value.matchAll(TIME_LITERAL)].map(([, amount, unit]) => Number(amount) * (unit === "s" ? 1000 : 1));
}

describe("§23: every duration is a motion token", () => {
  for (const sheet of SHEETS) {
    const css = stripComments(read(sheet));
    const rules = blocks(css);

    it(`${sheet} writes no duration of its own outside the reduced-motion cap`, () => {
      const offenders: string[] = [];
      for (const rule of rules) {
        const reduced = rule.context.some((at) => REDUCED.test(at));
        for (const [property, value] of declarations(rule.body)) {
          if (!DURATION_PROPERTIES.test(property)) continue;
          const literals = times(value);
          if (reduced) {
            /*
              §26 allows one thing to survive reduced motion: an opacity transition of 120ms or
              less. The block also collapses running animations to 1ms so they land on their
              final frame rather than their first -- which is a static state, not motion.
            */
            for (const ms of literals) if (ms > 120) offenders.push(`${rule.prelude} { ${property}: ${value} }`);
            continue;
          }
          if (property.startsWith("transition")) {
            if (!value.includes("var(--motion-")) offenders.push(`${rule.prelude} { ${property}: ${value} }`);
            for (const ms of literals) offenders.push(`${rule.prelude} { ${property}: ${ms}ms is a number, not a token }`);
            continue;
          }
          /*
            Animations get one literal and it is the hero's own loop length. `--motion-scene` is
            700ms; a 16-second storyboard is not a token value, it is the timeline every beat's
            percentages are measured against, and it is declared exactly once.
          */
          for (const ms of literals) {
            if (ms !== LOOP_SECONDS * 1000) offenders.push(`${rule.prelude} { ${property}: ${value} }`);
          }
          if (literals.length === 0 && !value.includes("var(--motion-")) {
            // A duration-less animation is only legal on a scroll timeline, where duration has
            // no meaning: the progress is the scroll position (Scene 05's connector draw).
            const timeline = declarations(rule.body).get("animation-timeline");
            if (!timeline) offenders.push(`${rule.prelude} { ${property}: ${value} } has no duration and no timeline`);
          }
        }
      }
      expect(offenders).toEqual([]);
    });

    it(`${sheet} uses the one easing pair`, () => {
      const offenders: string[] = [];
      for (const rule of rules) {
        for (const [property, value] of declarations(rule.body)) {
          if (!DURATION_PROPERTIES.test(property) && property !== "animation-timing-function") continue;
          if (/cubic-bezier|\bease-(in|out|in-out)\b|\bease\b(?!-)/.test(value.replace(/var\(--ease-[\w-]+\)/g, ""))) {
            offenders.push(`${rule.prelude} { ${property}: ${value} }`);
          }
        }
      }
      // `linear` is allowed: it is what a scroll-linked draw must use, since the scroll is the
      // curve. Everything timed carries --ease-ui or --ease-scene.
      expect(offenders).toEqual([]);
    });

    it(`${sheet} never grows anything on hover (§23 금지: card hover scale)`, () => {
      /*
        The banned thing is a hover that changes an element's SIZE -- the card lift every AI
        landing has. `scaleY(1)` is not that: it is how the Evidence Line's draw is completed
        when a reader holds the signature interaction, and 1 is the line's resting length. So
        the check is on the factor, not on the word: any scale argument other than 1 is a grow.
      */
      const offenders: string[] = [];
      for (const rule of rules) {
        if (!rule.prelude.includes(":hover")) continue;
        const transform = declarations(rule.body).get("transform") ?? "";
        for (const scale of transform.matchAll(/scale[XYZ]?\(([^)]*)\)/g)) {
          const factors = scale[1]!.split(/[,\s]+/).filter(Boolean).map(Number);
          if (factors.some((factor) => factor !== 1)) offenders.push(`${rule.prelude} { transform: ${transform} }`);
        }
      }
      expect(offenders).toEqual([]);
    });

    it(`${sheet} answers prefers-reduced-motion if it animates at all`, () => {
      const animates = /@keyframes|animation-name:|animation:/.test(css);
      if (!animates) return;
      /*
        Either shape counts. `app/landing-v2.css` collapses its animations inside a `reduce`
        block; Scene 05 declares its scroll-linked draw only inside `no-preference`, which is the
        same guarantee written the other way round and is the only form that works on a view
        timeline (collapsing a duration does nothing to an animation driven by the scroll).
      */
      expect(/prefers-reduced-motion/.test(css), `${sheet} animates with no reduced-motion answer`).toBe(true);
    });
  }

  it("app/landing-v2.css caps reduced motion at 120ms of opacity and nothing else", () => {
    const reduced = blocks(landing).filter((rule) => rule.context.some((at) => REDUCED.test(at)));
    const universal = reduced.find((rule) => rule.prelude.includes(".lv2 *"));
    expect(universal, "a universal collapse under .lv2").toBeTruthy();
    const decls = declarations(universal!.body);
    expect(decls.get("transition-property")).toBe("opacity !important");
    expect(times(decls.get("transition-duration") ?? "")[0]).toBeLessThanOrEqual(120);
    // One iteration and a 1ms duration leave the LAST frame on screen, which is the composed
    // hero (every element's base style is its finished state). `animation: none` would not.
    expect(decls.get("animation-iteration-count")).toBe("1 !important");
    expect(times(decls.get("animation-duration") ?? "")[0]).toBeLessThanOrEqual(120);
  });
});

/* ============================================ §23.4: the loop never runs where it cannot be stopped */

describe("§23: every animation is reachable by the pause control", () => {
  it("scopes the whole sequence to the demo root", () => {
    /*
      The pause rule is `animation-play-state: paused` on the demo's descendants. An animation
      bound to a bare primitive class -- `.lv2-region`, `.lv2-line`, `.lv2-claim-state` -- would
      run on Scene 02 and Scene 04 as well, where there is no control, no hover pause and no
      IntersectionObserver, and where the element belongs to no sequence at all.
    */
    const animated = blocks(landing)
      // The reduced-motion block collapses every animation from `.lv2 *` on purpose: it is what
      // makes a beat land on its final frame. It binds nothing, so it is not a binding.
      .filter((rule) => !rule.context.some((at) => REDUCED.test(at)))
      .filter((rule) => /animation-name\s*:|animation-iteration-count\s*:/.test(rule.body));
    expect(animated.length, "the sheet declares bindings at all").toBeGreaterThan(10);
    for (const rule of animated) {
      for (const selector of rule.prelude.split(",")) {
        const head = selector.trim();
        if (!head) continue;
        expect(head.startsWith(".lv2-demo"), `${head} animates outside the demo root`).toBe(true);
      }
    }
  });

  it("stops for the control, for a pointer, for focus and for a hero off screen", () => {
    for (const trigger of [
      '.lv2-demo[data-playing="0"] *',
      '.lv2-demo[data-offscreen="1"] *',
      ".lv2-demo:hover *",
      ".lv2-demo:focus-within *",
    ]) {
      expect(landing, `${trigger} pauses the sequence`).toContain(trigger);
    }
    expect(landing).toContain("animation-play-state: paused");
  });

  it("leaves the control in the markup, and reduced motion starts paused", () => {
    const demo = read("components/landing-v2/hero-compiler-demo.tsx");
    expect(demo).toContain('className="lv2-demo-control"');
    expect(demo).toContain('window.matchMedia("(prefers-reduced-motion: reduce)").matches');
    // 44px touch floor on the one control the sequence has (rule 8).
    expect(landing).toMatch(/\.lv2-demo-control\s*\{[^}]*min-height:\s*44px/);
  });
});

/* ================================================================== §4.1: one signature, three scenes */

describe("§4.1: the signature interaction behaves the same in every scene that has it", () => {
  const RING = "outline: 2px solid var(--source)";
  const OFFSET = "outline-offset: 2px";

  it.each([
    ["the hero", "app/landing-v2.css"],
    ["Scene 02", `${SCENE_DIR}/proof.module.css`],
    ["Scene 04", `${SCENE_DIR}/evidence.module.css`],
  ])("%s rings the source region and colours its label", (_scene, sheet) => {
    const css = stripComments(read(sheet));
    expect(css).toContain(RING);
    expect(css).toContain(OFFSET);
    expect(css).toContain("color: var(--source)");
    // Reached by pointer AND by keyboard, in both directions of the cascade.
    expect(/:hover/.test(css) && /:focus-visible/.test(css)).toBe(true);
  });

  it("moves the label's colour at one duration everywhere", () => {
    for (const [sheet, selector] of [
      ["app/landing-v2.css", ".lv2-read-label"],
      [`${SCENE_DIR}/proof.module.css`, ".citation"],
      [`${SCENE_DIR}/evidence.module.css`, ".caption"],
    ] as const) {
      const rule = blocks(stripComments(read(sheet))).find((entry) =>
        entry.prelude.split(",").some((head) => head.trim() === selector),
      );
      expect(rule, `${sheet} declares ${selector}`).toBeTruthy();
      expect(declarations(rule!.body).get("transition"), `${selector} in ${sheet}`).toBe(
        "color var(--motion-ui) var(--ease-ui)",
      );
    }
  });
});

/* ========================================================================================= §26: focus */

describe("§26: focus is visible on every landing control", () => {
  it("rings dark grounds in the source colour and paper in ink, both at 2px/2px", () => {
    const rules = blocks(landing).filter((rule) => rule.prelude.includes(":focus-visible"));
    expect(rules.length, "focus is declared").toBeGreaterThan(0);
    const dark = rules.find((rule) => rule.prelude.includes(".lv2 a:focus-visible"));
    expect(declarations(dark!.body).get("outline")).toBe("2px solid var(--source)");
    expect(declarations(dark!.body).get("outline-offset")).toBe("2px");
    const paper = rules.find((rule) => rule.prelude.includes(".lv2-paper a:focus-visible"));
    expect(declarations(paper!.body).get("outline-color")).toBe("var(--text-on-paper)");
    // Every interactive kind, not only links.
    for (const kind of ["a:focus-visible", "button:focus-visible", "summary:focus-visible", "[tabindex]:focus-visible"]) {
      expect(landing).toContain(kind);
    }
  });

  it("no sheet this lane owns removes an outline", () => {
    for (const sheet of SHEETS) {
      for (const rule of blocks(stripComments(read(sheet)))) {
        const outline = declarations(rule.body).get("outline");
        if (outline === undefined) continue;
        expect(/^(none|0)\b/.test(outline), `${sheet}: ${rule.prelude} removes the focus ring`).toBe(false);
      }
    }
  });
});

/* ============================================================== §23: nothing decorative, nothing loud */

describe("the landing plays no sound and reveals nothing it would hide without JS", () => {
  const COMPONENT_DIR = "components/landing-v2";
  const components = [
    ...readdirSync(new URL(`../${COMPONENT_DIR}`, import.meta.url), { withFileTypes: true }).flatMap((entry) =>
      entry.isFile() && entry.name.endsWith(".tsx")
        ? [`${COMPONENT_DIR}/${entry.name}`]
        : entry.isDirectory()
          ? readdirSync(new URL(`../${COMPONENT_DIR}/${entry.name}`, import.meta.url))
              .filter((name) => name.endsWith(".tsx"))
              .map((name) => `${COMPONENT_DIR}/${entry.name}/${name}`)
          : [],
    ),
  ];

  it("reads more than one component", () => {
    expect(components.length).toBeGreaterThan(8);
  });

  it.each(components)("%s plays no audio", (path) => {
    const source = read(path);
    for (const tell of ["<audio", "new Audio", "HTMLAudioElement", "AudioContext", ".mp3", ".wav", ".ogg"]) {
      expect(source.includes(tell), `${path} carries ${tell}`).toBe(false);
    }
  });

  it("has no scroll reveal that would leave content invisible if JS never runs", () => {
    /*
      §27 puts the first frame on the server, so a resting `opacity: 0` waiting for a class that
      hydration adds is content that a reader with a failed bundle never sees. Scene 05's
      connector draw is the only scroll-driven reveal on the page and it is built the other way
      round: the drawn line is the BASE state and the animation only exists inside
      `@supports (animation-timeline: view())`, so no engine and no motion setting can end
      anywhere but the finished picture.
    */
    const recompile = stripComments(read(`${SCENE_DIR}/recompile.module.css`));
    expect(recompile).toContain("@supports (animation-timeline: view())");
    expect(recompile).toMatch(/\.fan path\s*\{[^}]*stroke-dashoffset:\s*0/);
    for (const sheet of MODULE_SHEETS) {
      const css = stripComments(read(sheet));
      for (const rule of blocks(css)) {
        if (declarations(rule.body).get("opacity") !== "0") continue;
        /*
          An `opacity: 0` resting state is legal only where something else guarantees the
          element is decoration or is restored without JavaScript. Nothing in the scene sheets
          needs one today, so the rule is simply that there is none.
        */
        expect.fail(`${sheet}: ${rule.prelude} rests at opacity 0`);
      }
    }
  });
});

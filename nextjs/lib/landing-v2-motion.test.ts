import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
  The landing's motion contract (blueprint §23, §26, §4.1, §11.2; lane contract rules 8 and 11).

  This file is not a screenshot and it is not a pin of the sheet's text. Everything below is
  RECOMPUTED from `app/landing-v2.css` and the scene module sheets every run: which durations
  are tokens, whether any sheet grows something on hover, whether every sheet that animates
  answers `prefers-reduced-motion`, and whether the signature interaction is one interaction.

  AMENDED 2026-09-20. Until today the largest half of this file recomputed §11.2's 16-second
  hero storyboard out of the stylesheet -- beat times to ±0.2s, at most three things moving at
  any instant, one caption legible at a time. The founder replaced that hero with a centered
  statement over the four locked compile films, so there is no timeline in CSS left to measure
  and the first section says so as a fact rather than leaving a measurement of nothing.

  WHY A UNIT TEST AND NOT AN e2e. What is left here is declared in the stylesheets, so a browser
  would add nothing. What a browser IS needed for (that the film plays, that the phone
  composition holds, that reduced motion shows the poster) belongs to the QA stage's Playwright
  run and to a human looking at it.

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

/*
  `LOOP_SECONDS`, `TOLERANCE` and `seconds()` were declared here: the 16-second hero timeline
  every beat below was measured against. The timeline left with the compiler-demo hero on
  2026-09-20 (founder decision) and nothing on this landing runs a keyframe any more, so the
  three constants would be a clock with nothing to time.
*/

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

/* ============================================= §11.2: the hero storyboard, and where it went */

/*
  THE 16-SECOND STORYBOARD WAS MEASURED HERE, AND THERE IS NO LONGER ONE TO MEASURE.

  Until 2026-09-20 this file recomputed §11.2's beats out of `app/landing-v2.css`: twelve keyframe
  windows against the storyboard at ±0.2s, seven captions that never overlapped, one dot pulse,
  a hold in which nothing moved, and a sweep of the timeline every 10ms that failed if a fourth
  element was ever in motion at one instant. All of it described the compiler-demo hero, which
  the founder replaced with a centered statement over the four locked compile films.

  The films are recordings. Their timing is in the bytes, which `lib/one-path-contract.test.ts`
  holds to a length and a sha256, and the only clock left in the hero is the stage timer in
  `components/compile-stage-player.tsx` -- `FILM_DURATION` from `lib/film-script.ts`, checked in
  the player's own guards rather than by reading CSS. So the measurement is gone because the thing
  it measured is, and what is asserted in its place is the fact that replaces it: this lane's
  stylesheet declares no keyframe animation of its own at all.

  Everything below this point is unchanged and still recomputed: durations are tokens, the hover
  rules grow nothing, every sheet that animates answers `prefers-reduced-motion`, the signature
  interaction is one interaction in every scene that has it, focus is visible, and nothing on the
  page is revealed by a scroll listener.
*/

describe("§11.2: the hero's motion is a recording, not a timeline this sheet owns", () => {
  it("declares no keyframe animation in the landing's own stylesheet", () => {
    expect([...landingKeyframes.keys()], "the landing sheet declares a keyframe again").toEqual([]);
    const bindings = landingBlocks
      // The reduced-motion block collapses animations from `.lv2 *`; it binds none.
      .filter((rule) => !rule.context.some((at) => /prefers-reduced-motion:\s*reduce/.test(at)))
      .filter((rule) => /animation-name\s*:/.test(rule.body))
      .map((rule) => rule.prelude);
    expect(bindings, "the landing sheet binds an animation again").toEqual([]);
  });

  /*
    The film's clock is the film's, and it is read rather than typed.

    `STAGE_MS` used to be 5,000ms against an 18-second cut, so a visitor saw the first 28% of each
    film and never reached an ending. The number comes from `lib/film-script.ts` now, which is what
    the locked cuts actually run on -- if one is ever re-recorded at a different length the strip
    follows it instead of drifting. That is the whole of the hero's timing, so that is what is
    checked here.
  */
  it("takes the stage length from the film script rather than from a literal", () => {
    const player = read("components/compile-stage-player.tsx");
    expect(player).toContain('import { FILM_DURATION } from "@/lib/film-script"');
    expect(player).toContain("const STAGE_MS = FILM_DURATION * 1_000");
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
            An animation duration has to be a token now, with no literal exempted.

            One literal used to be allowed here and it was the hero storyboard's own loop length:
            16 seconds is not a token value, it is the timeline every beat's percentages were
            measured against. That storyboard left with the compiler-demo hero on 2026-09-20, so
            the exemption goes with it rather than staying open for the next number that wants it.
          */
          if (literals.length > 0) offenders.push(`${rule.prelude} { ${property}: ${value} }`);
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

describe("§23: the hero's film is stoppable, and the landing binds no loop of its own", () => {
  /*
    REWRITTEN 2026-09-20. This used to check that every animation binding in the sheet sat under
    `.lv2-demo`, so that the demo's `animation-play-state: paused` rule could reach all of them --
    a real concern, because `.lv2-region`, `.lv2-line` and `.lv2-claim-state` are shared primitives
    and an unscoped binding once ran the hero's 16-second loop on Scene 02, far below the fold,
    where there was no control and no observer to stop it.

    The demo is gone and the sheet binds nothing, which is a stronger version of the same
    guarantee: there is no animation on this landing that a pause rule could fail to reach. What
    is left to check is the film, and the film's stops are behaviour rather than CSS -- the
    control, the off-screen observer, the hidden tab, the reduced-motion hold and the Save-Data
    hold all live in the player. Each is asserted as the state that drives it, because a selector
    pinned to a class name would pass over a player that had stopped reading the state.
  */
  it("keeps every stop the film's autoplay needs", () => {
    const player = read("components/compile-stage-player.tsx");
    for (const stop of [
      "prefers-reduced-motion",
      "saveData",
      "documentVisible",
      "inView",
      "paused",
      "videoError",
    ]) {
      expect(player, `the player stopped reading ${stop}`).toContain(stop);
    }
    // WCAG 2.2.2: the control is rendered in every state, including the two that hold a still.
    expect(player).toContain('className="compile-film-motion-control"');
    expect(player).toContain("filmMotionControl");
  });

  it("holds the film's own controls to the 44px touch floor", () => {
    // The site sheet raises the stage tabs only under (pointer: coarse); a thumb is a thumb
    // whatever the pointer reports, so the landing's frame states the floor unconditionally.
    expect(landing).toMatch(/\.lv2-film \.compile-film-stages button\s*\{[^}]*min-height:\s*44px/);
    expect(stripComments(read("app/tavonel.css"))).toMatch(
      /\.compile-film-motion-control\s*\{[^}]*height:\s*44px/,
    );
  });
});

/* ================================================================== §4.1: one signature, three scenes */

describe("§4.1: the signature interaction behaves the same in every scene that has it", () => {
  const RING = "outline: 2px solid var(--source)";
  const OFFSET = "outline-offset: 2px";

  /*
    Two scenes, not three. The hero ran this interaction until 2026-09-20 -- hover or focus a
    compiled claim, the line draws in full, the region it was read from is ringed and its
    coordinate label reads in the source colour -- and it went with the compiler-demo hero.
    Scenes 02 and 04 are where a reader meets a compiled passage beside its page now, so they
    are where the signature has to be one interaction rather than two spellings of one.
  */
  it.each([
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

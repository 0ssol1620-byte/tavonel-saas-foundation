import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { PIPELINE_STAGES } from "./pipeline-vocabulary";
import { BRAND_LINE } from "./site-navigation";

/*
  The token contract, asserted where it can be asserted cheaply.

  `scripts/check-type-floor.mjs` already fails the build on a sub-12px size or a --decor text
  colour. What it cannot see is a value coming back: a sixth radius, the crosshair cursor, the
  bracket focus ring, an ungated :hover, a second positioning line. Those are one grep each, and
  each of them was a real regression once.

  Newlines are normalised: this repository checks CSS out with CRLF on Windows and LF in CI.
*/
const css = readFileSync(new URL("../app/tavonel.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("design token contract", () => {
  it("declares the cascade before importing anything into it", () => {
    // The header comment talks about @import order, so read past the comments before looking.
    const code = globals.replace(/\/\*[\s\S]*?\*\//g, "");
    const layerAt = code.indexOf("@layer reset, tokens, base, components, utilities, overrides;");
    const importAt = code.indexOf("@import");
    expect(layerAt, "the layer order is declared").toBeGreaterThan(-1);
    expect(layerAt, "and declared before the first @import, or the order is whatever loads first").toBeLessThan(importAt);
    // The four folded sheets are gone; an @import of one of them means the fold came undone.
    for (const sheet of ["ux-polish.css", "responsive-polish.css", "ux-120-final.css", "evidence-first.css"]) {
      expect(code, `${sheet} was folded into tavonel.css`).not.toContain(sheet);
    }
  });

  /*
    2026-09-18. `@import "./x.css" layer(overrides);` read as correct and was dead: Next 15.5's CSS
    pipeline rewrites the qualifier into `@media layer(overrides) { … }`, an invalid media query,
    so product-polish.css, workspace-final-polish.css and workspace-no1.css shipped without a
    single rule applying -- the workspace rendered tavonel.css's older faces and nothing in this
    suite could tell. The layer is therefore declared inside each sheet, and the import is plain.
  */
  it("layers the route sheets in-file, never at the @import", () => {
    const code = globals.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const line of code.split("\n").filter((l) => l.startsWith("@import"))) {
      expect(line, "an @import qualifier the build turns into a dead @media block").not.toMatch(/layer\(|supports\(/);
    }
    for (const sheet of ["product-polish.css", "workspace-final-polish.css", "workspace-no1.css"]) {
      expect(code, `${sheet} is still imported`).toContain(`@import "./${sheet}";`);
      const body = readFileSync(new URL(`../app/${sheet}`, import.meta.url), "utf8")
        .replace(/\r\n/g, "\n")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .trim();
      expect(body.startsWith("@layer overrides {"), `${sheet} opens with its layer`).toBe(true);
      expect(body.endsWith("}"), `${sheet} closes it`).toBe(true);
    }
  });

  it("keeps every global rule inside a named layer", () => {
    for (const layer of ["@layer tokens {", "@layer reset {", "@layer base {", "@layer components {", "@layer utilities {", "@layer overrides {"]) {
      expect(css).toContain(layer);
    }
  });

  it("has exactly five radius tokens and no radius literals", () => {
    for (const token of ["--r-paper:", "--r-paper-lg:", "--r-inst:", "--r-inst-lg:", "--r-media:"]) {
      expect(css).toContain(token);
    }
    // 50% is a circle and 0 is a square; every other literal is a sixth radius nobody agreed to.
    const literals = [...css.matchAll(/border-radius:\s*([^;}]+)/g)]
      .map((match) => match[1].trim())
      .filter((value) => !value.startsWith("var(") && value !== "50%" && value !== "0" && value !== "inherit");
    expect(literals, `radius literals: ${literals.join(", ")}`).toEqual([]);
  });

  it("uses the system cursor and one focus ring", () => {
    expect(css, "no SVG cursor").not.toContain("cursor: url(");
    expect(css).toContain(":focus-visible { outline: 2px solid var(--verified); outline-offset: 2px; }");
    // The bracket ring forced position: relative onto every focusable element on the page.
    expect(css).not.toContain(":focus-visible::after");
    const rings = [...css.matchAll(/:focus-visible[^{]*\{[^}]*outline:/g)];
    expect(rings, "one ring, not eight").toHaveLength(1);
    /*
      Widened 2026-09-18. The guard read only the rings a sheet paints, so the three declarations
      that painted nothing -- two `outline: none` and one `outline: 0`, on a contact input, the
      docs search field and the board search -- passed it while taking the ring off three keyboard
      paths. A suppressed outline is the failure this rule exists to catch, not a second ring.
    */
    const suppressed = [...css.matchAll(/outline: *(?:none|0);/g)].map((match) => match[0]);
    expect(suppressed, `outline suppressed in ${suppressed.length} place(s)`).toEqual([]);
  });

  it("gates every hover on a pointer that can hover", () => {
    const ungated: string[] = [];
    const stack: string[] = [];
    for (const line of css.split("\n")) {
      if (line.includes(":hover") && !/hover:\s*hover/.test(line) && !stack.some((open) => /hover:\s*hover/.test(open))) {
        ungated.push(line.trim());
      }
      for (const character of line) {
        if (character === "{") stack.push(line);
        else if (character === "}") stack.pop();
      }
    }
    expect(ungated, `ungated :hover rules:\n${ungated.join("\n")}`).toEqual([]);
  });

  it("has one reduced-motion block, and it zeroes the duration tokens", () => {
    // Any media query that mentions the setting counts, not only the bare one: a second block
    // spelled `@media (pointer: coarse), (prefers-reduced-motion: reduce)` also answered the
    // setting, and an exact-match regex read the file as compliant while two rules disagreed.
    const blocks = [...css.matchAll(/@media[^{]*prefers-reduced-motion:\s*reduce/g)];
    expect(blocks, "eight of these is not a contract, it is a search").toHaveLength(1);
    expect(css).toContain("--dur-1: 0ms");
  });

  it("does not paint atmosphere", () => {
    expect(css, "no backdrop blur").not.toContain("backdrop-filter");
    expect(css, "no grain overlay").not.toContain("feTurbulence");
    const shadows = [...css.matchAll(/box-shadow:\s*([^;}]+)/g)]
      .map((match) => match[1].trim())
      .filter((value) => !value.startsWith("var(--depth") && !value.startsWith("inset") && value !== "none");
    expect(shadows, `shadows outside the three depth tokens: ${shadows.join(" | ")}`).toEqual([]);
  });

  /*
    Moved 2026-09-18 with D24, and the intent is stronger than the rule it replaces.

    This used to assert that `--text-xlo` survived as a deprecated alias that nothing read, which
    was the right shape while four other lanes still had call sites. The alias is deleted now, so
    the assertion is that the name is gone entirely -- a definition coming back is how a deprecated
    token becomes a permanent one. `scripts/check-type-floor.mjs` carries the other half across
    every stylesheet in the repository: a sheet that still reads the name fails the build, because
    there is nothing behind it to resolve to.
  */
  it("does not define --text-xlo at all", () => {
    // The declaration and every read, not the word: the comment above the text tones explains
    // what the fourth tone was and why it went, which is the part worth keeping.
    expect(css, "the alias is back").not.toContain("--text-xlo:");
    expect(css, "tavonel.css reads a token that no longer exists").not.toContain("var(--text-xlo)");
  });

  it("names the gutter and the two display sizes the scale stops short of", () => {
    // BQ-053: one side gutter, so the header edge and the body edge cannot drift apart.
    expect(css).toContain("--gutter: clamp(16px, 3vw, 30px);");
    expect(css).toContain("padding: 0 var(--gutter);");
    // BQ-006: the section h2 and the design-partners h2 had no token and stayed literal.
    expect(css).toContain("--t-h2: clamp(28px, 3.3vw, 44px);");
    expect(css).toContain("--t-h2-sm: clamp(22px, 2.1vw, 30px);");
  });

  it("defines the accessible-name utility once, and unscoped", () => {
    // D25. Undefined, `.sr-only` renders as visible text beside the control it names.
    expect(css).toContain("@layer utilities {");
    expect(css).toMatch(/\.sr-only \{[\s\S]*?clip-path: inset\(50%\);/);
  });

  it("names the pipeline stages once, and the positioning line once", () => {
    expect(PIPELINE_STAGES.map((stage) => stage.key)).toEqual(["source", "read", "organize", "ready"]);
    expect(PIPELINE_STAGES.every((stage) => stage.ko.length > 0)).toBe(true);
    // D5 / blueprint §0: the founder's new headline, approved through the 2026-09-19 Landing V2
    // design master blueprint. `lib/site-navigation.ts` carries the decision beside the constant.
    expect(BRAND_LINE.headline).toBe("AI-ready knowledge. Traceable to every source.");
    expect(BRAND_LINE.descriptor).toBe("Knowledge compiled with a traceable path back to every source.");
  });

  it("keeps one kicker face and drops the rule ornament beside it", () => {
    expect(css).toContain(".eyebrow,\n  .slate,\n  .kicker {");
    expect(css, "the 34px rule beside every kicker").not.toContain(".slate span { width: 34px");
    expect(css).toContain(".state-label {");

    // The contract is .06em, and a later layer had been quietly winning with 0.1em. Two rules may
    // set tracking on a kicker: the canonical face, and the Korean face (Hangul at .06em crowds).
    const tracked = [...css.matchAll(/\.eyebrow[^{}]*\{[^}]*?letter-spacing:\s*([^;}]+)/g)].map((m) => m[1].trim());
    expect(tracked, `tracking set on .eyebrow: ${tracked.join(" | ")}`).toEqual(["0.06em", "0.02em"]);
  });

  /*
    D34 -- one link contract, and the specificity trap that made type-01.

    type-01 was three primary CTAs rendered cream-on-cream at 1.00:1: `.policy-copy a` set a link
    colour at (0,1,1) and outranked `.btn, .btn-primary` at (0,1,0) inside the same layer, so every
    button on a policy page kept the fill and lost its label. The shape is a container rule that
    repaints an anchor without saying which anchors it does not mean.

    What is asserted is that shape, not the contrast: the contract's own selectors all qualify the
    anchor -- `:not([class])` for prose, an explicit class for the two action faces -- so the new
    rule cannot grow into the old defect, and the fix that closed type-01 stays put.

    A wider guard was measured and not landed. "Every rule that colours a bare descendant `a` must
    exclude .btn" flags sixteen pre-existing rules across four other lanes' families -- a
    cross-lane change, not a test. It is written up in this pass's lane report.
  */
  it("colours a link without ever repainting a control's label", () => {
    const contract = css.slice(css.indexOf("D34 -- one link contract"), css.indexOf("@layer utilities"));
    expect(contract, "the contract is in @layer components").toContain("a.link-verify");

    const rules = contract.replace(/^[\s\S]*?\*\//, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const anchors = [...rules.matchAll(/([^{}]+)\{/g)]
      .flatMap((m) => m[1].split(","))
      .map((one) => one.trim())
      .filter((one) => /(^|[\s>+~])a(?![\w-])/.test(one));
    expect(anchors.length, `anchor selectors found: ${anchors.join(" | ")}`).toBeGreaterThan(5);
    for (const selector of anchors) {
      expect(selector, `${selector} never says which anchors it is not`).toMatch(/:not\(\[class\]\)|a\.link/);
    }

    // landing-07 survived the first pass at D34 because the prose half was written as a list of
    // four container classes copied from the rule it replaced -- and the paragraph the finding
    // names (`p.design-partners-fine` on `/` and `/ko`) is in none of the four, so the contract
    // read as written and changed nothing on the route it was written for. The container list is
    // itself the defect: it is a closed set, and every section added later is born outside it.
    // The rule is rooted at `main`, with `:not([class])` and `:not(nav a)` doing the excluding.
    expect(contract, "the prose half is one rule rooted at main, not a list of containers")
      .toMatch(/main :is\([^)]*\) a:not\(\[class\]\):not\(nav a\)/);
    expect(contract, "the container list is gone, not kept beside the general rule")
      .not.toMatch(/\.scene p > a|\.policy-copy :is|\.docs-body :is|\.fine :is/);

    // The fix that closed type-01: a container's link colour has to exclude the button classes.
    expect(css).toContain(".policy-copy a:not(.btn) {");

    // --verified on a link means one thing -- this link opens a surface where the claim can be
    // checked. Any other link class spending it is the two-meanings defect type-04 names.
    const verifiedLinks = [...css.matchAll(/(a\.[\w-]+)[^{}]*\{[^}]*color: var\(--verified\)/g)].map((m) => m[1]);
    expect(verifiedLinks).toEqual(["a.link-verify"]);
  });
});

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
    expect(BRAND_LINE.headline).toBe("Bring your knowledge. TAVONEL makes it ready for AI.");
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
});

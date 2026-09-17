import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMPILE_STAGES } from "./compile-stages";
import { CUSTOMER_NAV, customerNavOwns } from "./site-navigation";
import films from "./locked-film-assets.json";

const text = (relative: string) => readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8");

describe("approved one-path experience", () => {
  it("has exactly three shared customer destinations", () => {
    expect(CUSTOMER_NAV).toEqual([
      { href: "/product", label: "How it works" },
      { href: "/integrations", label: "Connect" },
      { href: "/pricing", label: "Pricing" },
    ]);
    expect(text("components/site-nav/desktop-primary-nav.tsx")).toContain("CUSTOMER_NAV.map");
    expect(text("components/mobile-primary-nav.tsx")).toContain("CUSTOMER_NAV.map");
  });
  it("does not confuse a prefix with an unrelated route", () => {
    expect(customerNavOwns("/product", "/product/document-intelligence/")).toBe(true);
    expect(customerNavOwns("/product", "/productivity")).toBe(false);
    expect(customerNavOwns("/integrations", "/sources/")).toBe(true);
    expect(customerNavOwns("/pricing", "/privacy")).toBe(false);
  });
  it.each(films.files)("preserves the approved $file bytes", ({ file, bytes, sha256 }) => {
    const data = readFileSync(fileURLToPath(new URL(`../public/film/${file}`, import.meta.url)));
    expect(data.length).toBe(bytes);
    expect(createHash("sha256").update(data).digest("hex")).toBe(sha256);
  });
  it("orders the customer story as Hero → Works → Connect → Proof → Current → AI", () => {
    const page = text("components/home-page-client.tsx");
    expect(page.match(/<CompileStagePlayer/g)).toHaveLength(2);
    expect(page).toContain("playbackRate={1.5} compact");
    expect(page).toContain("You bring the source.");
    const works = page.indexOf('id="how-it-works"');
    const connect = page.indexOf('id="connect"');
    const proof = page.indexOf('id="proof"');
    const current = page.indexOf('id="stays-current"');
    const ready = page.indexOf('id="ready-for-ai"');
    expect(works).toBeGreaterThan(0);
    expect(works).toBeLessThan(connect);
    expect(connect).toBeLessThan(proof);
    expect(proof).toBeLessThan(current);
    expect(current).toBeLessThan(ready);
    expect(page.indexOf("<CompileStagePlayer")).toBeLessThan(proof);
    /*
      G1-003 / G1-004. The note this used to pin -- "the approved source film is preserved and
      presented at a faster 12-second pace" -- disclosed the *edit* and not the thing a visitor
      could mistake the film for. The cuts draw an extracted table as a ruled grid, a
      section-and-line locator and `.csv` sources, none of which this deployment produces, and the
      bytes are locked, so the note names the recreation and says what a compile emits instead.
      The guard follows the fact rather than the sentence: a landing page that stops separating
      the film from the product still fails here.
    */
    expect(page).toContain("A directed film, not a screen recording");
    expect(page).toContain("the page it was read from");
    expect(page).toContain("/explore?act=source");
  });
  /*
    BQ-013. The locale thread reached the chrome and stopped at the film.

    /ko reused `COMPILE_STAGES[1]` and `[2]` verbatim, so the Korean page rendered English tab
    labels and an English caption, and the player kept the tablist name, the three control names
    and the decoder-failure sentence in English whatever page it was on. None of that is visible
    marketing copy, which is why it survived every copy pass; all of it is the accessible name of
    a control. The guard follows the prop rather than the strings: a film that stops taking the
    locale fails here.
  */
  it("names the film and its controls in the language of the page they are on", () => {
    const ko = text("app/ko/page.tsx");
    expect(ko.match(/<CompileStagePlayer[^>]*korean/g)).toHaveLength(2);
    expect(ko, "the Korean works film may not reuse the English stage labels verbatim")
      .not.toContain("const KO_WORK_STAGES = [COMPILE_STAGES[1]!, COMPILE_STAGES[2]!]");
    const player = text("components/compile-stage-player.tsx");
    for (const wired of ["aria-label={text.stages}", "FILM_CONTROL_LABEL_KO[control]", "{text.error}", "text.errorLong"]) {
      expect(player, `${wired} must read the locale, not a literal`).toContain(wired);
    }
    expect(text("app/one-path.css"), "and the swipe caption is overridden on both Korean films")
      .toContain(".one-path-ko .one-path-works-film::after");
  });
  /*
    landing-01 / regressions-01. A film stage that reaches a server component as a client
    reference paints nothing.

    /ko built its works stages by spreading COMPILE_STAGES out of the "use client" player
    module. Every export of a client module arrives in a server component as a reference, not a
    value, so id/src/poster came through undefined and the second Korean film rendered as a blank
    panel with a src-less <img> and no <video> -- a silent fallback on a locked asset. The list is
    a plain module now. Two halves to the guard: the values themselves are complete, and neither
    page reads them back out of the player.
  */
  it("gives every film stage a real asset, from a module a server component can read", () => {
    expect(COMPILE_STAGES.length).toBeGreaterThan(0);
    for (const stage of COMPILE_STAGES) {
      for (const field of ["id", "src", "poster"] as const) {
        expect(stage[field], `stage ${stage.id || "?"} has no ${field}`).toBeTruthy();
      }
      expect(stage.src).toMatch(/^\/film\/.+\.mp4$/);
      expect(stage.poster).toMatch(/^\/film\/.+\.webp$/);
    }
    expect(text("components/compile-stage-player.tsx"), "the strip may not live in the client module again")
      .not.toContain("export const COMPILE_STAGES");
    for (const page of ["app/ko/page.tsx", "components/home-page-client.tsx"]) {
      expect(text(page), `${page} must read the stages from the plain module`)
        .toContain('import { COMPILE_STAGES } from "@/lib/compile-stages"');
    }
  });
  it("preserves state-controlled entry and actual public proof", () => {
    expect(text("components/home-page-client.tsx")).toContain("liveCommerce ? SELF_SERVE_CTA : ACCESS_CTA");
    expect(text("app/page.tsx")).toContain("isLiveCommerce()");
    expect(text("app/page.tsx")).toContain("<SolutionProofSample");
    expect(text("app/ko/page.tsx")).toContain("playbackRate={1.5} compact");
    /*
      BQ-056. This pinned "01 / TAVONEL WORKS" -- one of five numbered section kickers that made a
      third ordinal system on a page which already numbers a six-step grid inside one of those
      sections. They are deleted, so the guard follows what it was there for: /ko runs the same
      sections in the same order as `/`, identified by their headings rather than by a count.
    */
    const korean = text("app/ko/page.tsx");
    // Comments stripped: the rationale for deleting them names the strings it deleted.
    expect(korean.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, ""), "a numbered section kicker is not a section name")
      .not.toMatch(/0\d \/ /);
    for (const heading of ["ko-works-title", "ko-intake-title", "ko-proof-title", "ko-current-title", "ko-use-title"]) {
      expect(korean).toContain(`id="${heading}"`);
    }
    expect(korean.indexOf("ko-works-title")).toBeLessThan(korean.indexOf("ko-proof-title"));
    expect(korean.indexOf("ko-proof-title")).toBeLessThan(korean.indexOf("ko-use-title"));
    expect(korean).toContain('canonical: "/ko"');
  });
  it("keeps low-motion, Save-Data and hidden-tab playback protections", () => {
    const player = text("components/compile-stage-player.tsx");
    expect(player).toContain("prefers-reduced-motion");
    expect(player).toContain("saveData");
    expect(player).toContain("documentVisible");
    expect(player).toContain("videoError");
    expect(player).toContain("filmMotionControl");
  });
  it("preserves advanced surfaces and only presents a real pending review", () => {
    const shell = text("components/workspace-ultimate-shell.tsx");
    const primary = shell.slice(shell.indexOf("const NAV_ITEMS"), shell.indexOf("const MORE_ITEMS"));
    expect(primary.match(/surface:/g)).toHaveLength(3);
    expect(primary).toContain('label: "Use with AI"');
    for (const surface of ["review", "changes", "world", "connections", "developer", "activity", "settings"]) {
      expect(shell).toContain(`surface: "${surface}"`);
    }
    expect(shell).toContain('aria-label="More workspace tools"');
    expect(text("app/workspace/page.tsx")).toContain("candidateReady={candidateNeedsDecision}");
  });
  it("never records guide opening or package download as external connection success", () => {
    const page = text("app/workspace/page.tsx");
    expect(page).toContain("const aiConnectionTaken = false;");
    expect(page).not.toContain("setAiConnectionTaken(true)");
    expect(text("components/workspace-use-with-ai.tsx")).toContain("An external AI connection has not been verified");
  });
  it("retains cost approval, automatic durable compile and human activation boundaries", () => {
    const page = text("app/workspace/page.tsx");
    expect(page).toContain("stagedSelection");
    expect(page).toContain("if (judgeCorpusSet(ids.length).ok) await startDurableCompile(ids)");
    expect(page).toContain("activationPolicy.customerIntake.enabled");
    expect(page).toContain("promoteCandidate");
    expect(page).toContain("rollbackWorld");
  });
});

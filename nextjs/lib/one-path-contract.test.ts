import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMPILE_STAGES } from "./compile-stages";
import { CUSTOMER_NAV, customerNavOwns } from "./site-navigation";
import films from "./locked-film-assets.json";

const text = (relative: string) => readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8");

describe("approved one-path experience", () => {
  /*
    Landing V2, 2026-09-19 (blueprint §8, contract D2). Three became five.

    The order is the reader's path through the site rather than the repository's: what it is,
    how it works, what to read, how to build, what it costs. Both chromes render the same array,
    which is the half of this that used to be the defect -- the desktop bar and the phone sheet
    read two different constants and made two different offers at two widths.
  */
  it("has exactly five shared customer destinations", () => {
    expect(CUSTOMER_NAV).toEqual([
      { href: "/product", label: "Product" },
      { href: "/knowledge-compiler", label: "How it works" },
      { href: "/resources", label: "Resources" },
      { href: "/docs", label: "Docs" },
      { href: "/pricing", label: "Pricing" },
    ]);
    expect(text("components/site-nav/desktop-primary-nav.tsx")).toContain("CUSTOMER_NAV.map");
    expect(text("components/mobile-primary-nav.tsx")).toContain("CUSTOMER_NAV.map");
  });
  it("does not confuse a prefix with an unrelated route", () => {
    expect(customerNavOwns("/product", "/product/document-intelligence/")).toBe(true);
    expect(customerNavOwns("/product", "/productivity")).toBe(false);
    expect(customerNavOwns("/docs", "/docs/mcp")).toBe(true);
    expect(customerNavOwns("/docs", "/docsearch")).toBe(false);
    expect(customerNavOwns("/pricing", "/privacy")).toBe(false);
  });
  /*
    What Resources speaks for, and what nothing in the bar does.

    The hub collects nine destinations; five of them have no bar item of their own, and a reader
    on one of those five is in the Resources section whether or not the URL says so. The failure
    path is the second half: /sources lost its owner when Integrations left the bar, and marking
    some other item current there would tell the reader something false about where they are.
  */
  it("lets Resources own the five hub pages that have no bar item, and leaves /sources unowned", () => {
    for (const path of ["/research", "/research/notes", "/evidence", "/reproducibility", "/benchmarks", "/changelog"]) {
      expect(customerNavOwns("/resources", path), path).toBe(true);
    }
    for (const href of CUSTOMER_NAV.map((item) => item.href)) {
      expect(customerNavOwns(href, "/sources"), `${href} claims /sources`).toBe(false);
      expect(customerNavOwns(href, "/integrations"), `${href} claims /integrations`).toBe(false);
    }
    // /explore and /api are hub entries too, and deliberately not Resources' to claim.
    expect(customerNavOwns("/resources", "/explore")).toBe(false);
    expect(customerNavOwns("/resources", "/api")).toBe(false);
  });
  it.each(films.files)("preserves the approved $file bytes", ({ file, bytes, sha256 }) => {
    const data = readFileSync(fileURLToPath(new URL(`../public/film/${file}`, import.meta.url)));
    expect(data.length).toBe(bytes);
    expect(createHash("sha256").update(data).digest("hex")).toBe(sha256);
  });
  /*
    Landing V2, 2026-09-19 (D1, D9, §9). Five sections became nine, and the film left the page.

    What this used to pin -- one decoder in the hero, the Hero → Compile → Why → Sources → Start
    order, and the sentence separating the directed film from what a compile emits -- described a
    page that no longer exists. The rule it was written for is unchanged and is what is asserted
    here: the landing runs one ordered story, every scene is a named focusable landmark, and
    nothing on the page is a recreation that has to be disclosed as one. The film note went with
    the film; §21 and contract rule 2 now allow the entry pages only committed real rasters and
    vector UI drawn from real World data, which is a stronger guarantee than a disclosure.
  */
  it("orders the landing as the nine V2 scenes, with no film on the page", () => {
    const page = text("components/landing-v2/landing-page.tsx");
    expect(page.match(/<CompileStagePlayer/g), "no decoder on the entry pages").toBeNull();
    /*
      The order is read off the copy deck each scene is handed -- the one decision the
      composition still makes about all nine. It used to be read off `<Scene scene={copy.<id>}>`,
      the generic shell the P0 skeleton rendered eight times; that shell is gone, because scenes
      02-09 are now whole `<section>`s under `components/landing-v2/scenes/` that carry their own
      landmark and their own next action. `lib/landing-v2-page.test.ts` holds the same order
      against the rendered markup, which is the stronger half of this pair.
    */
    const scenes = [...page.matchAll(/copy=\{copy\.([a-z]+)\}/g)].map((match) => match[1]);
    expect(scenes).toEqual([
      "hero", "proof", "sources", "evidence", "recompile", "why", "use", "trust", "start",
    ]);
    // The hero is still a named, focusable landmark here; the other eight are pinned in the
    // render walk and in each scene's own guard, where the markup they own actually lives.
    expect(page).toContain("tabIndex={-1}");
    expect(page).toContain('aria-labelledby="lv2-hero-title"');
    // The retired page's own landmarks, so none of them returns by copy-paste.
    for (const gone of ['id="top"', 'id="compile"', 'id="how-it-works"', 'id="connect"', "one-path-works-film", "one-path-film-note"]) {
      expect(page, `${gone} belongs to the retired landing`).not.toContain(gone);
    }
  });

  /*
    BQ-013. The locale thread reached the chrome and stopped at the film.

    /ko reused `COMPILE_STAGES[1]` and `[2]` verbatim, so the Korean page rendered English tab
    labels and an English caption, and the player kept the tablist name, the three control names
    and the decoder-failure sentence in English whatever page it was on. None of that is visible
    marketing copy, which is why it survived every copy pass; all of it is the accessible name of
    a control. The guard follows the prop rather than the strings: a film that stops taking the
    locale fails here.

    Landing replan, 2026-09-18: /ko plays one film, not two, so the count moves with the page.
    The Korean works film, its `KO_WORK_STAGES` table and the swipe caption that film needed are
    all gone; the locale wiring the row exists for is not.
  */
  it("names the film and its controls in the language of the page they are on", () => {
    /*
      Landing V2, 2026-09-19. /ko plays no film, so the half of this that counted its players is
      gone and the half that is a fact about the component stays.

      BQ-013 was the real defect: the player kept the tablist name, the three control names and
      the decoder-failure sentence in English whatever page it was on. None of that is visible
      marketing copy, which is why it survived every copy pass; all of it is the accessible name
      of a control. The wiring is still there and is still the thing worth guarding -- a film that
      stops taking the locale fails here, on whichever route grows one next.
    */
    const ko = text("app/ko/page.tsx");
    expect(ko.match(/<CompileStagePlayer/g), "the Korean entry page plays no film").toBeNull();
    expect(ko, "the Korean film may not reuse the English stage labels verbatim")
      .not.toContain("const KO_WORK_STAGES");
    const player = text("components/compile-stage-player.tsx");
    for (const wired of ["aria-label={text.stages}", "FILM_CONTROL_LABEL_KO[control]", "{text.error}", "text.errorLong"]) {
      expect(player, `${wired} must read the locale, not a literal`).toContain(wired);
    }
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
    /*
      Landing V2, 2026-09-19. Neither entry page reads the table any more, because neither plays
      a film. The rule -- a server component reads the stages from a plain module, never back out
      of the "use client" player, where every export arrives as a reference rather than a value --
      is asserted where it can still be broken: the table is a plain module, and the player does
      not re-export it.
    */
    expect(text("lib/compile-stages.ts"), "the table stays a plain module a server component can read")
      .not.toMatch(/^\s*["']use client["']/m);
    for (const page of ["app/page.tsx", "app/ko/page.tsx"]) {
      expect(text(page), `${page} plays no film and must not import the stage table`)
        .not.toContain('from "@/lib/compile-stages"');
    }
  });
  it("preserves state-controlled entry and keeps the two locales on one story", () => {
    /*
      Landing V2, 2026-09-19. One composition serves both locales, so "the same sections in the
      same order" stops being a thing two files can disagree about -- which is what this case was
      really defending. What is left to check is the two halves that are still separable: the
      commercial posture is resolved on the server and chooses between the two access actions
      rather than writing a third, and /ko renders the same composition with the Korean copy.
    */
    const composition = text("components/landing-v2/landing-page.tsx");
    expect(composition, "the posture is resolved where the flags are readable")
      .toContain("primaryCallToAction()");
    expect(composition, "and the Korean label is that action's own, keyed by destination")
      .toContain("KO_CHROME.cta[access.href]");
    const korean = text("app/ko/page.tsx");
    expect(korean, "/ko renders the same composition in the other language").toContain("<LandingPage korean");
    expect(korean).toContain('canonical: "/ko"');
    // Comments stripped: the rationale for deleting them names the strings it deleted.
    expect(korean.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, ""), "a numbered section kicker is not a section name")
      .not.toMatch(/0\d \/ /);
    expect(text("app/page.tsx"), "the proof block is not on the landing any more").not.toContain("<SolutionProofSample");
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

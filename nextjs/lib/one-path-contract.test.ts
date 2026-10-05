import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMPILE_STAGES } from "./compile-stages";
import { CUSTOMER_NAV, HEADER_NAV, customerNavOwns } from "./site-navigation";
import films from "./locked-film-assets.json";

const text = (relative: string) => readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8");

describe("approved one-path experience", () => {
  /*
    One shared row carries the product, inspectable public sample, developer entry and pricing.
    Desktop and phone render the same route list, including the same sign-in destination.
  */
  it("has exactly four shared customer destinations", () => {
    expect(CUSTOMER_NAV).toEqual([
      { href: "/product", label: "Product" },
      { href: "/explore", label: "Explore" },
      { href: "/developers", label: "Developers" },
      { href: "/pricing", label: "Pricing" },
    ]);
    expect(HEADER_NAV).toEqual(CUSTOMER_NAV.filter((item) => item.href !== "/pricing"));
    expect(text("components/site-nav/desktop-primary-nav.tsx")).toContain("HEADER_NAV.map");
    expect(text("components/mobile-primary-nav.tsx")).toContain("HEADER_NAV.map");
    expect(text("components/public-site-chrome.tsx")).toContain('href={korean ? "/ko/pricing" : "/pricing"}');
  });
  it("does not confuse a prefix with an unrelated route", () => {
    expect(customerNavOwns("/product", "/product/document-intelligence/")).toBe(true);
    expect(customerNavOwns("/product", "/productivity")).toBe(false);
    expect(customerNavOwns("/developers", "/docs/mcp")).toBe(true);
    expect(customerNavOwns("/explore", "/explore")).toBe(true);
    expect(customerNavOwns("/developers", "/docsearch")).toBe(false);
    expect(customerNavOwns("/pricing", "/privacy")).toBe(false);
  });
  /*
    Product owns its related source and solution routes; Developers owns docs, API and changelog.
    Explore owns its public sample. Research and trust remain reachable from the footer.
  */
  it("marks Product and developer pages from the shared bar and leaves unrelated pages unowned", () => {
    for (const path of ["/developers", "/docs", "/docs/mcp", "/api", "/changelog"]) {
      expect(customerNavOwns("/developers", path), path).toBe(true);
    }
    for (const path of ["/sources", "/integrations", "/solutions", "/knowledge-compiler"]) {
      expect(CUSTOMER_NAV.filter(({ href }) => customerNavOwns(href, path)).map(({ href }) => href), path)
        .toEqual(["/product"]);
    }
    for (const path of ["/research", "/trust", "/contact", "/privacy", "/sources-extra", "/integrations-old", "/solutions-extra", "/knowledge-compiler-extra"]) {
      expect(CUSTOMER_NAV.filter(({ href }) => customerNavOwns(href, path)), path).toEqual([]);
    }
    expect(customerNavOwns("/explore", "/research")).toBe(false);
    expect(customerNavOwns("/explore", "/api")).toBe(false);
  });
  it.each(films.files)("preserves the approved $file bytes", ({ file, bytes, sha256 }) => {
    const data = readFileSync(fileURLToPath(new URL(`../public/film/${file}`, import.meta.url)));
    expect(data.length).toBe(bytes);
    expect(createHash("sha256").update(data).digest("hex")).toBe(sha256);
  });
  /*
    The film opens under the centered hero message. Scene 02 follows with the source-linked
    CompilerSpecimen and public Evidence Inspector. The order below is read as positions so
    this contract keeps the buyer's first-visit sequence explicit.
  */
  it("orders the landing as source evidence, explanation, proof, change, trust and action", () => {
    const page = text("components/landing-v2/landing-page.tsx");
    expect(page.match(/<CompileStagePlayer/g), "the composition mounts a player of its own").toBeNull();
    expect(page).toContain("<HeroSourceCard");
    expect(page).toContain("<HeroFilm");
    expect(page).toContain("<CompilerSpecimen");
    const order = [
      'id="s1"',
      'id="lv2-hero-title"',
      "<HeroActions",
      "<HeroSourceCard",
      'id="s2"',
      "<CompilerSpecimen",
      "<HeroFilm",
      "<HeroProof",
      "<ProofScene",
      "<RecompileScene",
      "<TrustScene",
      "<StartScene",
    ].map(token => page.indexOf(token));
    expect(order.every((at, index) => at >= 0 && (index === 0 || at > order[index - 1]!))).toBe(true);
    expect(page).toContain("tabIndex={-1}");
    expect(page).toContain('aria-labelledby="lv2-hero-title"');
    for (const gone of ['id="top"', 'id="compile"', 'id="how-it-works"', 'id="connect"', "one-path-works-film", "one-path-film-note"]) {
      expect(page, `${gone} belongs to the retired landing`).not.toContain(gone);
    }
    const film = text("components/landing-v2/hero-film.tsx");
    expect(film).not.toContain('"use client"');
    expect(film).toContain("<HeroFilmDisclosure");
    expect(film).toContain('src: "/film/compile-cut.mp4"');
    expect(film).toContain('fallbackSrc: "/film/compile-cut-hq.mp4"');
    expect(film).toContain('fallbackPhoneSrc: "/film/compile-cut-hq-1440.mp4"');
    expect(film).toContain('poster: "/film/poster-1-hero-2x.webp"');
    /* The client disclosure gates the real player, not a still-hidden native details subtree. */
    const disclosure = text("components/landing-v2/hero-film-disclosure.tsx");
    expect(disclosure).toContain('"use client"');
    expect(disclosure).toContain('className="lv2-film-story" onToggle=');
    expect(disclosure).toContain("{open ? (");
    expect(disclosure).toContain('<CompileStagePlayer stages={stages} preferVideo');
    expect(disclosure).not.toContain("priorityPoster");
    expect(film, "internal recreation disclaimers do not belong on the customer route")
      .not.toContain("landingV2HeroExtra");
    expect(film).not.toContain("lv2-film-note");
    expect(text("lib/landing-v2-hero-copy.ts")).not.toContain("filmNote");
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
      BQ-013 was the real defect: the player kept the tablist name, the three control names and
      the decoder-failure sentence in English whatever page it was on. None of that is visible
      marketing copy, which is why it survived every copy pass; all of it is the accessible name
      of a control.

      Amended 2026-09-20: /ko plays the four cuts again, and it reaches them the way the English
      page does -- through the shared composition, with `korean` passed down. So the page file
      itself still mounts no player, and the locale now has to travel two ways: into the player's
      own control names (unchanged, below) and into the four stage labels and captions, which are
      a Korean table joined to `COMPILE_STAGES` by position rather than a second stage list with its
      own `src` and `poster` -- the landing-01 defect that painted a blank panel on /ko.
    */
    const ko = text("app/ko/page.tsx");
    expect(ko.match(/<CompileStagePlayer/g), "the Korean entry page mounts its own player").toBeNull();
    expect(ko, "the Korean film may not reuse the English stage labels verbatim")
      .not.toContain("const KO_WORK_STAGES");
    const film = text("components/landing-v2/hero-film.tsx");
    expect(film, "the film takes the locale").toContain("korean={korean}");
    expect(film, "and the Korean captions are copy, joined by position")
      .toContain("LANDING_V2_FILM_STAGES_KO");
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
    /* The server-side HeroFilm reads the stage table from a plain module. The entry pages share
       LandingPage and must not duplicate or mutate that table themselves. */
    expect(text("lib/compile-stages.ts"), "the table stays a plain module a server component can read")
      .not.toMatch(/^\s*["']use client["']/m);
    for (const page of ["app/page.tsx", "app/ko/page.tsx"]) {
      expect(text(page), `${page} must not duplicate the shared HeroFilm stage table`)
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
    expect(composition, "the pricing link remains in the Korean journey")
      .toContain('href={korean ? "/ko/pricing" : "/pricing"}');
    expect(composition, "evaluation remains localized while live entry stays state controlled").toContain('access.href === "/contact" ? (korean ? "/ko/evaluation" : "/evaluation") : startActions.accessHref');
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
    expect(page).toContain("const ids = approvedCompilableDocumentIds(final, fileKeys)");
    expect(page).toContain("if (!ids || ids.length !== processingManifest.length || !judgeCorpusSet(ids.length).ok)");
    expect(page).toContain("await startDurableCompile(ids)");
    expect(page).toContain("activationPolicy.customerIntake.enabled");
    expect(page).toContain("promoteCandidate");
    expect(page).toContain("rollbackWorld");
  });
});

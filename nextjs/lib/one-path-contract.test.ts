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
    The hero opens source first: a short statement and its actions over one full-width workbench
    (source -> highlighted passage -> record). Scene 02 says why that passage is hard and keeps
    the optional film behind a closed disclosure; the record, change, trust and action beats
    follow. The CompilerSpecimen, HeroProof and ProofScene of the retired layout are not composed.
    The order below is read as positions so this contract keeps the first-visit sequence explicit.
  */
  it("orders the landing as source workbench, difficulty and optional film, record, change, trust and action", () => {
    const page = text("components/landing-v2/landing-page.tsx");
    expect(page.match(/<CompileStagePlayer/g), "the composition mounts a player of its own").toBeNull();
    for (const gone of ["<CompilerSpecimen", "<HeroProof", "<ProofScene"]) {
      expect(page, `${gone} belongs to the retired layout`).not.toContain(gone);
    }
    const order = [
      'id="s1"',
      "<HeroStatement",
      "<HeroActions",
      "<HeroSourceCard",
      'id="s2"',
      'id="lv2-difficulty-title"',
      "<HeroFilm",
      'id="s3"',
      "<RecompileScene",
      "<TrustScene",
      "<StartScene",
    ].map(token => page.indexOf(token));
    expect(order.every((at, index) => at >= 0 && (index === 0 || at > order[index - 1]!))).toBe(true);
    const hero = page.slice(page.indexOf('id="s1"'), page.indexOf('id="s2"'));
    expect(hero, "the film is not in the hero any more").not.toContain("<HeroFilm");
    /*
      Full width: the workbench is the hero layout's own item after the closed intro block, not a
      column beside the statement, and the layout grid sets no columns of its own.
    */
    const intro = hero.slice(hero.indexOf("<div className={heroStyles.intro}>"), hero.indexOf("<HeroSourceCard"));
    expect(hero.indexOf("<div className={heroStyles.intro}>"), "the hero's intro block").toBeGreaterThan(-1);
    expect(intro, "the statement and its actions lead the hero").toContain("<HeroActions");
    expect(intro.match(/<div\b/g)?.length, "the intro block closes before the workbench").toBe(intro.match(/<\/div>/g)?.length);
    const css = text("components/landing-v2/landing-hero.module.css");
    const layout = css.slice(css.indexOf("section.hero .layout {"), css.indexOf("}", css.indexOf("section.hero .layout {")));
    expect(layout).toContain("display: grid");
    expect(layout).not.toContain("grid-template-columns");
    /* The workbench takes the case the server selected, so the reserved case can never lead it. */
    expect(page).toContain("selectHomeCase([buildHomeEvidenceCase(buildHeroView(), buildProofTabs()), HOME_RESERVED_CASE])");
    expect(page).toContain("{home ? <HeroSourceCard view={home} korean={korean} /> : null}");
    expect(page).toContain("tabIndex={-1}");
    expect(page).toContain('aria-labelledby="lv2-hero-title"');
    for (const gone of ['id="top"', 'id="compile"', 'id="how-it-works"', 'id="connect"', "one-path-works-film", "one-path-film-note"]) {
      expect(page, `${gone} belongs to the retired landing`).not.toContain(gone);
    }
    const film = text("components/landing-v2/hero-film.tsx");
    expect(film).not.toContain('"use client"');
    expect(film).toContain('src: "/film/compile-cut.mp4"');
    expect(film).toContain('fallbackSrc: "/film/compile-cut-hq.mp4"');
    expect(film).toContain('fallbackPhoneSrc: "/film/compile-cut-hq-1440.mp4"');
    expect(film).toContain('poster: "/film/poster-1-hero-2x.webp"');
    expect(film).toContain("<HeroFilmDisclosure");
    /*
      The source raster is the hero's paint now. The film sits closed in scene 02: its player is
      not mounted until the disclosure opens, and its poster may not take the eager image slot.
    */
    const disclosure = text("components/landing-v2/hero-film-disclosure.tsx");
    expect(disclosure).toContain('"use client"');
    const details = disclosure.slice(disclosure.indexOf("<details"), disclosure.indexOf("<summary"));
    expect(details, "the disclosure has a native <details>").not.toBe("");
    expect(details, "the disclosure is closed on load").not.toMatch(/\sopen[\s={]/);
    expect(disclosure).toContain("useState(false)");
    expect(disclosure, "the player mounts only once the disclosure is open")
      .toMatch(/\{open \? \([\s\S]*<CompileStagePlayer[\s\S]*\) : null\}/);
    expect(disclosure).toMatch(/<CompileStagePlayer[^>]*preferVideo/);
    for (const source of [film, disclosure]) {
      expect(source, "the closed film does not prioritize its poster").not.toMatch(/<CompileStagePlayer[^>]*priorityPoster/);
    }
    /* The landing asks for the whole frame explicitly; a caller that omits the view also gets "fit". */
    expect(disclosure).toContain('LANDING_MOBILE_FILM_VIEW: MobileFilmView = "fit"');
    expect(disclosure).toMatch(/<CompileStagePlayer[^>]*initialMobileFilmView=\{LANDING_MOBILE_FILM_VIEW\}/);
    expect(text("components/compile-stage-player.tsx")).toContain('initialMobileFilmView = "fit"');
    expect(film, "internal recreation disclaimers do not belong on the customer route")
      .not.toContain("landingV2HeroExtra");
    expect(film).not.toContain("lv2-film-note");
    expect(disclosure).not.toContain("lv2-film-note");
    expect(text("lib/landing-v2-hero-copy.ts")).not.toContain("filmNote");
  });

  /*
    `hero_demo_interact` is delegated by selector, so moving the film out of the hero silently
    stops counting its controls unless the selector moves with it. The film is the one demo left
    on Home, in scene 02; the workbench's region buttons are reading, not a demo, and stay uncounted.
  */
  it("counts demo engagement on the scene-two film controls", () => {
    const analytics = text("components/landing-v2/landing-analytics.tsx");
    const onDemo = analytics.slice(analytics.indexOf("const onDemo"), analytics.indexOf('main.addEventListener("click"'));
    expect(onDemo, "the demo listener").not.toBe("");
    expect(onDemo).toContain('trackFunnelOnce("hero_demo_interact", arm)');
    const selector = onDemo.match(/target\.closest\("([^"]+)"\)/)?.[1] ?? "";
    const parts = selector.split(",").map(part => part.trim());
    expect(parts, "the film's controls, where the film now is").toContain("#s2 .compile-film-sequence button");
    expect(selector, "the film is not in the hero any more").not.toMatch(/#s1\b/);
    const page = text("components/landing-v2/landing-page.tsx");
    const sceneTwo = page.slice(page.indexOf('id="s2"'), page.indexOf('id="s3"'));
    expect(page.indexOf('id="s3"')).toBeGreaterThan(page.indexOf('id="s2"'));
    expect(sceneTwo).toContain("<HeroFilm");
    expect(text("components/compile-stage-player.tsx")).toContain('className="compile-film-sequence');
  });

  /*
    The workbench's own contract, read where it is written: native selection, real citations,
    full filing access and the agreed status line. The rendered behaviour is held by
    `components/landing-v2/hero-source-card.test.tsx`; this keeps the composition from swapping
    the card for one without them.
  */
  it("keeps native region selection, exact citations, full filing access and the prepared status", () => {
    const card = text("components/landing-v2/hero-source-card.tsx");
    expect(card).toContain('type="button"');
    expect(card).toContain("aria-pressed={region.id === active.id}");
    expect(card).toContain("aria-controls={passageId}");
    expect(card).toContain('aria-live="polite"');
    expect(card).toContain("data-hero-evidence");
    expect(card).toContain("href={page.image.src}");
    expect(card).toContain("href={source.officialFiling.href}");
    expect(card).toContain('"Open full filing (SEC)"');
    expect(card).toContain('"Prepared demonstration / processing not yet run"');
    expect(card).toContain('"준비된 시연 / 아직 처리를 실행하지 않음"');
    expect(card, "the status is chosen by run, not derived by splitting a string").not.toMatch(/status\.split\(/);
    expect(card).not.toContain("Prepared demonstration ·");
    const view = text("lib/home-evidence-view.ts");
    expect(view, "the helper stays a projection, never the corpus build").not.toMatch(/from "\.\/(explore-sample|compile|corpus)/);
    expect(view).not.toMatch(/[A-Z]:[\\/]/);
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
    expect(text("components/landing-v2/scenes/start.tsx"), "the pricing link remains in the Korean journey")
      .toContain('"/ko/pricing"');
    expect(composition, "evaluation remains localized while live entry stays state controlled").toContain('access.href === "/contact" ? (korean ? "/ko/evaluation" : "/evaluation") : startActions.accessHref');
    expect(composition, "the hero's access action is the one resolved above, not a fixed /pricing")
      .toContain("startHref={heroStart.href}");
    expect(composition).not.toContain("pricingHref");
    expect(composition, "the close keeps the resolved access actions").toContain("actions={startActions}");
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

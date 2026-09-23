import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { activationPolicy } from "./activation-policy";
import { primaryCallToAction } from "./commercial-state";
import { EXPLORE_COPY } from "./explore-story";
import {
  ACCESS_CTA,
  BRAND_LINE,
  EXPLORE_CTA,
  PRODUCT_NOUNS,
  SELF_SERVE_CTA,
} from "./site-navigation";

/**
 * SPEC 13.3 -- phrases the product may not use, enforced.
 *
 * This list previously lived as a doc comment at the top of `lib/cinematic/copy.ts`, which held
 * the copy deck for the 56-second replay. It said "nothing here may drift toward them" and
 * nothing checked that it hadn't. When the replay was removed the comment would have gone with
 * it, taking a real brand rule out of the repository along with some dead code -- so the rule
 * moved here, where it applies to the copy that actually ships and fails a run if it is broken.
 *
 * The barred phrases are the ones 13.3 names. "better than RAG" is barred until the external
 * experiment closes; it stays on this list until someone can point at that result, and the
 * right way to lift it is to delete the entry in a commit that cites the evidence.
 *
 * This checks source text, not rendered output. That is deliberate: it catches a barred phrase
 * the moment it is written, in whichever file it is written, without needing a browser.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

/** Every file that carries public-facing copy. Add new surfaces here as they are built. */
const COPY_SURFACES = [
  "app/page.tsx",
  /*
    Landing V2, 2026-09-19 (D1). The landing page is a copy deck and a composition now.

    `components/home-page-client.tsx` is deleted. Every sentence a visitor reads at `/` and
    `/ko` is in `lib/landing-v2-copy.ts`, in both languages; `landing-page.tsx` arranges them
    and `scene-actions.ts` carries the eight next-action labels. `read` takes a literal path
    and never follows an import, so each of the three needs its own row.
  */
  "components/landing-v2/landing-page.tsx",
  "components/landing-v2/scene-actions.ts",
  "lib/landing-v2-copy.ts",
  "app/layout.tsx",
  "app/workspace/page.tsx",
  "app/auth/callback/page.tsx",
  "components/world-explorer.tsx",
  "app/login/page.tsx",
  "app/not-found.tsx",
  "app/error.tsx",
  "lib/capabilities.ts",
  "lib/checkout-intent.ts",
  /*
    The recipe hop, registered with the checkout hop it copies. `read` takes a literal path and
    never follows an import, so the preflight the sign-in page renders is unguarded until its own
    row is here -- and the preflight is where a cost sentence and an entitlement sentence live.
  */
  "lib/recipe-intent.ts",
  "components/recipe-preflight.tsx",
  "lib/funnel-events.ts",
  "lib/demo-world.ts",
  "lib/film-script.ts",
  "components/opening-film.tsx",
  "components/compile-stage-player.tsx",
  "components/compile-stage.tsx",
  "app/film/page.tsx",
  "app/research/page.tsx",
  "app/benchmarks/page.tsx",
  // Most of what /benchmarks says is written in the registry, not in the page that arranges it.
  "lib/benchmark-registry.ts",
  "app/developers/page.tsx",
  /*
    /docs, added at integration (stage 2 C23c) as the root fix for devx finding 2.

    The whole of /docs is written in docs-content.ts and arranged by one dynamic route, and
    neither was on this list -- so the largest body of prose on the site was checked by nothing
    here, and docs-content.test.ts grew its own copy of the barred-phrase list to compensate.
    One list, checked once.
  */
  "lib/docs-content.ts",
  "app/docs/[section]/page.tsx",
  "app/docs/page.tsx",
  "app/pricing/page.tsx",
  "app/product/page.tsx",
  "app/product/knowledge-compiler/page.tsx",
  "app/product/document-understanding/page.tsx",
  "app/product/compiled-world/page.tsx",
  "app/product/continuous-knowledge/page.tsx",
  "lib/compiler-contract.ts",
  // The drawing is copy, not geometry: ten stage titles, a legend whose stroke weight asserts
  // what runs in this deployment, and the <desc> paragraph that is the whole of what a screen
  // reader gets from it. `read` takes a literal path and never follows an import, so a component
  // the page renders is unguarded until its own row is here.
  "components/compiler-contract-diagram.tsx",
  "app/enterprise/page.tsx",
  /*
    The Explore stage, added at integration rather than by the lane that built it.

    `/explore` was a public route before this campaign and had no row here at all, so the
    rebuild did not remove a guard -- it inherited a missing one. The rebuild is the moment to
    fix that, because almost every visible word on the route now lives in `explore-story.ts`
    and in the six act components, none of which `read` would reach on its own: it takes a
    literal path and never follows an import. `explore-change.ts` is on the list for one
    sentence, the equivalence reason the Change Act prints verbatim -- the sentence most likely
    to be rewritten into a claim later.
  */
  "app/explore/page.tsx",
  "lib/explore-story.ts",
  "lib/explore-change.ts",
  "components/explore/explore-stage.tsx",
  "components/explore/world-act.tsx",
  "components/explore/evidence-act.tsx",
  "components/explore/change-act.tsx",
  "components/explore/ask-overlay.tsx",
  "components/explore/technical-details.tsx",
  /*
    The workspace Change Inbox. `app/workspace/page.tsx` has been on this list since it was
    written, and the changes surface it now renders puts its own sentences on screen from
    these two files.
  */
  "components/change-inbox.tsx",
  "lib/change-inbox.ts",
  /*
    The support matrix. `../shared/capabilityManifest.ts` is on the list because most of the
    words on /sources are in it -- the tiers, the preserved lists and every limitation are data,
    and a barred phrase written into a manifest entry would render on the page while the page's
    own source stayed clean.
  */
  "app/sources/page.tsx",
  "components/source-capability-table.tsx",
  "../shared/capabilityManifest.ts",
  /*
    The trust provisions table and the public sample frame (gaps #6, #14 and #15 of the
    2026-09-22 audit). Both are copy on three sales surfaces and neither is a `page.tsx`:
    every sentence /trust, /security and /enterprise publish about what is provided is in
    the content module, and a barred phrase written into a row would render on all three
    while each page's own source stayed clean.
  */
  "components/trust-provisions.tsx",
  "components/sample-world-frame.tsx",
  "content/trust/provisions.ts",
  /*
    The surfaces the positioning pass (RESOLVED A-1, A-4, A-6) rewrote, none of which had a row.

    Every one of them carries a claim of the exact kind this file exists to guard -- what
    evidence is bound to, which connectors are reachable, and what state a service is in -- and
    each was edited in this pass without any check that the edit stayed inside the rules.

    The two lib files are here because their strings are public copy that no page contains:
    `activation-policy.ts` is served verbatim from /api/status and rendered on /security, and
    `operations.ts` writes the detail line under every row on /status. The share card is here
    for the same reason: it repeats the hero, and a barred phrase reaching it would be the one
    place a reader sees before the page loads.
  */
  "app/evidence/page.tsx",
  "app/knowledge-compiler/page.tsx",
  "app/resources/page.tsx",
  "app/integrations/page.tsx",
  "app/security/page.tsx",
  "app/status/page.tsx",
  "app/opengraph-image.tsx",
  "lib/activation-policy.ts",
  "lib/operations.ts",
  /*
    Repair, 2026-09-06. Two surfaces a reader reaches from the primary nav that the positioning
    pass neither edited nor disclosed: /solutions still published "Citations back to page
    regions", "Page and bbox provenance" and "Page-level citation inspection", and /api
    "page-and-bbox-bound citations" -- the abstraction A-1 retires, on pages the nav points at.
    Neither had a row here, so nothing would have caught the drift on the way in either.
  */
  "app/solutions/[slug]/page.tsx",
  "app/api/page.tsx",
  // The /solutions hub, added with the route. Its cards are read from the record on the detail
  // page above, so the only copy of its own it carries is the title, the intro and the closing
  // pointer -- which is exactly the kind of sentence this file exists to hold to the rules.
  "app/solutions/page.tsx",
  /*
    The conversion pass, 2026-09-08. Three surfaces a buyer reads in order, none of which had a
    row. The pricing client is the one that matters: the plan cards, the six §12.1 answers and
    the rollover sentence are all written there, and it was guarded only through
    `app/pricing/page.tsx` -- fifteen lines of wiring with no copy in it at all.
  */
  "app/docs/page.tsx",
  "components/pricing-page-client.tsx",
  "components/trust-next.tsx",
  // `/trust` stopped being a redirect and became a page, which makes it a copy surface.
  "app/trust/page.tsx",
  /*
    The cookbooks, 2026-09-11. Six drafts, and almost every word of them is in the library rather
    than in the one route that arranges them -- the same shape as /docs, and the same reason both
    files are listed: `read` takes a literal path and never follows an import.
  */
  "lib/cookbook-content.ts",
  "app/cookbooks/[slug]/page.tsx",
  // The cookbook index, 2026-09-11 (BA-210). Its lede and card copy are written on the page.
  "app/cookbooks/page.tsx",
  /*
    The §12.4 Korean entry page. A barred phrase does not stop being barred in translation, and
    the list below is matched against source text, so the row is here for the English words this
    page does carry -- the plan label it reads from `billing-catalog.ts`, the page names it links
    to, and its own comments. What it cannot check is a Korean sentence that means one of these
    things; that is a review, and it is why this page states no claim it does not link to.
  */
  "app/ko/page.tsx",
  /*
    `llms.txt` is public copy that no guard read.

    It is prose, it is served verbatim to crawlers and AI tools, and it was the one public surface
    here checked by nothing -- which is how it came to carry a dated, attributed claim about how
    Google treats AI discovery files, with no receipt behind it. The claim is gone; the reason it
    survived was the missing row, so the row is here. A barred phrase or a readiness overclaim in
    it now fails the same way it does on a page.
  */
  "public/llms.txt",
  /*
    The published support target. It is one exported string rendered on `/status` and `/contact`,
    and neither page's own source contains the words -- so without a row here the only support
    commitment on the site would be guarded by nothing in this file.
  */
  "lib/support-targets.ts",
  // `/contact` carries three addresses and the support target, and had no row.
  "app/contact/page.tsx",
  /*
    The navigation, 2026-09-11. The menu became prose.

    A flat bar was eight one-word labels with nothing to guard. The IA redesign's panels carry
    column titles, link labels and audience lines -- "Supported files and what is preserved",
    "Trust center", "AI and platform engineers" -- written in the nav data and rendered by both
    chromes, which makes them public copy on every page of the site, checked by nothing. The
    components are listed alongside the data because a label written straight into the JSX would
    otherwise slip past a guard that only reads the array.
  */
  "lib/site-navigation.ts",
  "components/site-nav/desktop-primary-nav.tsx",
  "components/mobile-primary-nav.tsx",
  "components/public-site-chrome.tsx",
  "components/policy-layout.tsx",
  // BA-232: the header's action is a rendered button on every public page, so it is a copy
  // surface. It wrote three labels of its own; it reads the shared two now.
  "components/public-primary-cta.tsx",
];

const BARRED = [
  "unlock your data",
  "second brain",
  "100% accurate",
  "never hallucinates",
  "better than rag",
  "ai brain",
  /*
    The 2026-09-06 blueprint's §42 guardrails, added by the lane that built /sources.

    A support matrix is exactly where "supports every file" gets written, and it is the one
    sentence this product may never say: the architecture is meant to accept any source, the
    deployment reads eleven MIME types, and collapsing that distinction is how a page becomes a
    promise the upload route refuses. The other five are the same shape -- each asserts an
    absolute no evidence here reaches.

    "all files" was left out of the first version of this list on the theory that it is ordinary
    English ("all files in the archive") and would fire on innocent prose. It does not: no copy
    surface in this repository contains it. The contract lists it, the check is cheap, and a
    surface that one day needs the innocent reading can say "every file in the archive".

    "industry-leading" is barred outright rather than "without evidence". The qualified version
    is not testable, and the unqualified version has never appeared in this repository; if a
    receipt ever supports the claim the right move is to delete this entry in the commit that
    cites the receipt, the way "better than RAG" is meant to leave.
  */
  "supports every file",
  "all files",
  "perfect parsing",
  "best ocr",
  "never stale",
  "always current",
  "industry-leading",
  /*
    RESOLVED A-2 (2026-09-06), added with the re-derived hero.

    "100% accurate" and "never hallucinates" were already here; these three are the rest of
    that decision's list. Each is the absolute form of something this deployment does at best
    effort: the reader is a converted-to-PDF OCR path, so "every file supported" and "lossless
    for every format" are contradicted by the manifest on /sources, and "fully autonomous
    truth" is contradicted by the promotion gate that requires a person.
  */
  "every file supported",
  "lossless for every format",
  "fully autonomous truth",
];

/**
 * Claims that assert a capability is finished. The page is allowed to demonstrate selective
 * recompilation and knowledge architecture at length; it is not allowed to say they ship. The
 * status grid labels both "Direction" for exactly this reason.
 */
const OVERCLAIMS = [
  "generally available",
  "production-ready",
  "fully automated ontology",
];

function read(surface: string): string {
  return readFileSync(join(root, surface), "utf8");
}

/**
 * Every marketing `page.tsx`, walked rather than listed (BQ-029).
 *
 * `app/api` is route handlers, `app/workspace` and `app/dev` are behind sign-in, and neither is
 * a surface a first-time reader meets. Everything else under `app/` is.
 */
function marketingPageFiles(directory = "app", found: string[] = []): string[] {
  for (const entry of readdirSync(join(root, directory), {
    withFileTypes: true,
  })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (
        ["api", "workspace", "dev", "auth"].includes(entry.name) &&
        directory === "app"
      )
        continue;
      marketingPageFiles(path, found);
    } else if (entry.name === "page.tsx") {
      found.push(path);
    }
  }
  return found;
}

/*
  The landing page, as a visitor reads it (Landing V2, 2026-09-19).

  Six files, and the film modules are deliberately not among them any more: this landing plays no
  film, so `compile-stage-player.tsx` and `lib/compile-stages.ts` are no longer part of what a
  visitor sees at `/`. What replaced them is the two route files, the composition, the two copy
  modules, and the hero's data module -- the last because every figure on this page comes out of
  it, and a barred phrase written into a label there would render on the page while every page
  file stayed clean.

  THIS IS NOT THE WHOLE OF THE LANDING'S COPY, AND IT IS NOT MEANT TO BE (corrected 2026-09-19).
  It said the hero's components carried no copy of their own, which was true of the P0 skeleton.
  Eight scene lanes have written since: `lib/landing-v2-sources.ts`, `-evidence.ts`,
  `-recompile.ts`, `-hero-copy.ts` and four scene components each carry reader-facing strings in
  both languages. They are swept where a reader meets them -- `lib/landing-v2-page.test.ts`
  renders `/` and `/ko` and runs BARRED, OVERCLAIMS, RETIRED_NAMES, §20.2 and `koTermDrift` over
  the rendered `<main>` -- because several of those components legitimately NAME a forbidden
  phrase in a comment saying why it is not used, which a source sweep cannot tell from copy.
*/
function landingSource(): string {
  return [
    read("app/page.tsx"),
    read("app/ko/page.tsx"),
    read("components/landing-v2/landing-page.tsx"),
    read("components/landing-v2/scene-actions.ts"),
    read("lib/landing-v2-copy.ts"),
    /*
      `lib/landing-v2-hero.ts` was the sixth surface here. It resolved the region, the compiled
      object and the entity chips the §11.1 hero drew, and it was deleted on 2026-09-20 with that
      hero (founder decision: a centered statement over the four locked films). What the walk
      reads in its place is the two files the new hero is made of -- the film frame and the
      campaign’s own copy module -- so the barred-phrase, overclaim and figure sweeps still cover
      every string the entry pages put on screen that the copy deck does not own.
    */
    read("components/landing-v2/hero-film.tsx"),
    read("lib/landing-v2-hero-copy.ts"),
  ].join("\n");
}

describe("public copy", () => {
  it.each(COPY_SURFACES)("keeps every barred phrase out of %s", surface => {
    const source = read(surface).toLowerCase();
    for (const phrase of BARRED) {
      expect(source, `SPEC 13.3 bars "${phrase}"`).not.toContain(phrase);
    }
  });

  it.each(COPY_SURFACES)("makes no readiness overclaim in %s", surface => {
    const source = read(surface).toLowerCase();
    for (const phrase of OVERCLAIMS) {
      expect(
        source,
        `"${phrase}" asserts a readiness this deployment has not established`
      ).not.toContain(phrase);
    }
  });

  it("keeps fixture disclosure with the fixture and off the nine-scene landing page", () => {
    const disclosure = read("lib/demo-world.ts");
    expect(disclosure).toContain("fictional demonstration data");
    expect(disclosure).toContain("not a recording of a compiler run");
    expect(landingSource()).not.toContain("DISCLOSURE.fixture");
  });

  it("keeps unshipped capability records off the public landing sequence", () => {
    const grid = read("lib/capabilities.ts");
    expect(grid).toContain('state: "Direction"');
    expect(grid).toContain("Knowledge architecture");
    expect(grid).toContain("Selective recompilation");
    expect(landingSource()).not.toContain("readCapabilities");
  });

  /*
    The homepage is six deliberate beats: hero film, compiler specimen, proof, change, trust, and close.
    Each remains a named focusable landmark and the page carries no second instrument navigation.

    The order is read off the composition rather than off a count of `data-scene` attributes,
    The rendered DOM test holds the same order in both locales.
  */
  it("composes the six homepage beats in order, with no second instrument navigation", () => {
    const page = read("components/landing-v2/landing-page.tsx");
    /*
      Each surviving beat is handed its own copy, and the order here is the order a reader gets.
      `lib/landing-v2-page.test.ts` pins the same order against both rendered locales.
    */
    const rendered = [...page.matchAll(/copy=\{copy\.([a-z]+)\}/g)].map(
      match => match[1]!
    );
    expect(rendered).toEqual(["hero", "proof", "recompile", "trust", "start"]);
    for (const removed of ["sources", "evidence", "why", "use"]) {
      expect(page).not.toContain(`copy={copy.${removed}}`);
    }
    expect(page).toContain('id="s1"');
    expect(page).toContain('id="s2"');
    expect(page).toContain('data-scene="1"');
    // The skip-target contract, for the one scene this file still renders in full.
    expect(page).toContain("tabIndex={-1}");
    expect(page).not.toContain('className="bar"');
    expect(page, "the phone jump nav went with the old landing").not.toContain(
      "one-path-jump"
    );
  });
  /*
    The lock, re-derived three times, and moved once more here.

    It has never been a claim that the headline is right forever; it is a claim that the headline
    does not drift without a decision. RESOLVED A-1 moved it, D8 moved it, and the Landing V2
    design master blueprint moves it again -- this time by taking the string out of the page
    altogether. The H1 is a rendering of `BRAND_LINE.headline`: `hero-statement.tsx` splits the
    constant so one phrase can carry the editorial serif (D3), and the copy deck imports it
    rather than spelling it. So what is pinned is the constant, plus the two places that read it
    without repeating it.
  */
  it("keeps the brand line the hero is written from, and writes it in no second place", () => {
    expect(BRAND_LINE.headline).toBe(
      "Your documents. Knowledge you can verify."
    );
    expect(BRAND_LINE.descriptor).toBe(
      "Knowledge compiled with a traceable path back to every source."
    );
    expect(
      read("lib/landing-v2-copy.ts"),
      "the copy deck imports the headline rather than typing it"
    ).toContain("headline: BRAND_LINE.headline");
    const hero = read("components/landing-v2/hero-statement.tsx");
    expect(
      hero,
      "the H1 is a rendering of the constant, not a copy of it"
    ).toContain("copy.headline.split(");
    // Comments stripped: the rationale for deleting them names the strings it deleted.
    const page = landingSource().replace(/\{?\/\*[\s\S]*?\*\/\}?/g, "");
    expect(page, "a numbered section kicker is not a section name").not.toMatch(
      /0\d \/ /
    );
    expect(page).not.toContain("evidence back to the page");
  });

  /*
    REVERSED BY THE FOUNDER, 2026-09-20. The entry pages play the four locked films again.

    This row asserted the opposite until today, and the reasoning behind it was sound: §27 bars
    an autoplay video from being the LCP element, §28 puts the hero in DOM and CSS, and the V2
    hero was a real source page with a real compiled object beside it. The founder overruled it
    after seeing the result, verbatim: "경쟁 웹사이트들을 레퍼런스로 우리도 통일해줘. 중앙 정렬하고
    비주얼은 그다음에 보여주되 그전에 있던 4개 비디오 영상이 더 낫지않나? 너가 마지막에 우측에 만든
    비주얼은 너가 봐도 텍스트가 너무 많아서 무슨말인지 모르겠지않아?"

    So what is pinned is the reverse, and it is pinned rather than deleted because both halves
    of the decision are load-bearing and neither is readable off the markup:

      - the hero reaches for ALL FOUR cuts, through the one player. A hero that quietly fell
        back to the single cut the previous landing played would look correct in a screenshot
        and lose three quarters of what was asked for.
      - §27's rule is still kept. What paints above the fold is the poster, an <img> the player
        server-renders; the decoder starts on intersection. The preload names that poster, which
        is why it is asserted on the two entry pages rather than anywhere else.

    The bytes are untouched either way: `lib/one-path-contract.test.ts` still holds every cut and
    every poster to its length and its sha256, and nothing in this campaign re-encodes one.
  */
  it("opens on the live inspector, then the four-cut film and the deterministic specimen", () => {
    const page = landingSource();
    /* 2026-09-22, gap #1: the hero is the Evidence Inspector on the public sample World, and the
       film opens the landmark that explains how the World was compiled. The entry pages preload
       the hero's own raster because that is the image above the fold now. */
    expect(page.indexOf("<HeroStatement")).toBeLessThan(page.indexOf("<CompilerSpecimen"));
    expect(page.indexOf("<CompilerSpecimen")).toBeLessThan(page.indexOf("<HeroProof"));
    expect(page.indexOf("<HeroProof")).toBeLessThan(page.indexOf("<HeroFilm"));
    expect(page).toContain('id="s1"');
    expect(page).toContain('id="s2"');
    expect(page).toContain("CompilerSpecimen");
    expect(read("components/landing-v2/compiler-specimen.tsx")).not.toContain(
      "<video"
    );
    expect(read("app/page.tsx")).not.toContain("HERO_PROOF_IMAGE");
    expect(read("app/ko/page.tsx")).not.toContain("HERO_PROOF_IMAGE");
    expect(read("components/landing-v2/hero-film.tsx")).not.toContain("lv2-film-note");
  });

  /*
    D26. One tab-title pattern with one named exception, so the pattern is a rule rather than the
    six spellings the audit counted. Every advertised page is "X — TAVONEL"; the home page is
    "TAVONEL — <descriptor>" because it has no section to name, and both halves of it are
    BRAND_LINE rather than a positioning sentence typed into the page.
  */
  it("writes one tab-title pattern and names its one exception", () => {
    const home = read("app/page.tsx");
    expect(home).toContain("title: `TAVONEL — ${BRAND_LINE.descriptor}`");
    expect(home).toContain("title: BRAND_LINE.headline");
    expect(
      home,
      "the home exception does not write its own positioning sentence"
    ).not.toContain("Make your knowledge ready for AI");
    expect(
      read("app/layout.tsx"),
      "the inherited fallback follows the site pattern"
    ).toContain('title: "Knowledge Compiler for AI — TAVONEL"');
    for (const file of ["app/explore/page.tsx", "app/contact/page.tsx"]) {
      const titles = [
        ...read(file).matchAll(/title: "([^"]*TAVONEL[^"]*)"/g),
      ].map(match => match[1]!);
      expect(titles.length, `${file} declares a title`).toBeGreaterThan(0);
      for (const title of titles) expect(title, file).toMatch(/ — TAVONEL$/);
    }
  });

  it("does not wrap the films in a clickable link", () => {
    const player = read("components/compile-stage-player.tsx");
    expect(player).not.toContain("href");
    expect(player).not.toContain("CanvasTransitionLink");
  });

  /*
    One player owns every landing film, and the scene files hand-roll none.

    The hero was twice rewritten as a bare <video> — once for an LCP experiment, once in a
    server-component split — and both times it lost the playback logic it needs: the observer,
    the resume on visibility change, the resume on a decoder stall. Bands further down hide
    that failure because scrolling back restarts them; a film on screen from load crosses its
    loop point untouched and simply freezes.

    That logic now lives in `CompileStagePlayer` rather than a per-band component, because the
    four cuts share one viewport and the interesting invariant is that only one of them holds a
    decoder. The scene files must still contain no <video> of their own.
  */
  it("hand-rolls no <video> on the entry pages, and keeps the one decoder in the player", () => {
    for (const file of [
      "app/page.tsx",
      "app/ko/page.tsx",
      "components/landing-v2/landing-page.tsx",
      "components/landing-v2/hero-film.tsx",
    ]) {
      // Comments in these files discuss the <video> element by name, so the check is run
      // against the source with comments stripped -- otherwise it fails on its own rationale.
      const source = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(source, `${file} must not hand-roll a <video>`).not.toMatch(
        /<video[\s>]/
      );
      expect(source, `${file} must not inline an aspect ratio`).not.toContain(
        "aspectRatio"
      );
    }
    const player = read("components/compile-stage-player.tsx");
    expect(player, "the player owns exactly one <video> template").toMatch(
      /<video/
    );
    /*
      BQ-130. The guard moved with the mechanism it guards, and the mechanism is unchanged: one
      decoder, open on the active cut, not remounted per stage -- which is what cancelled
      `compile-cut-2.mp4` mid-fetch on every advance. Read as a shape rather than as a literal,
      because the element takes a narrow-screen encode when the stage declares one.
    */
    expect(
      player,
      "the one decoder plays the active stage and nothing else"
    ).toContain("src={videoSrc}");
    expect(player).toContain(
      "const preferredVideoSrc = narrow && active.phoneSrc ? active.phoneSrc : active.src"
    );
    expect(
      player,
      "and is not remounted per stage, which aborted the fetch in flight"
    ).not.toContain("<video key=");
  });

  /*
    Scene 3 is one frame, not four stacked ones.

    The four cuts used to be four `FilmBand`s in a column: the scene counter said five and the
    reader scrolled through eight screens of film, while four <video> elements competed for
    bandwidth and, on a phone, for a limited number of hardware decoders.
  */
  it("keeps the stage strip in the reader's voice and its controls selectable", () => {
    /*
      Landing V2, 2026-09-19. The landing half of this case went with the film.

      What it pinned -- one player, `playbackRate={1.5} compact`, no second viewport -- was about
      a page that no longer plays a film. The strip itself is unchanged and is still read by
      `/film`, so the half that is a fact about the component stays exactly as it was.

      BQ-056: the labels are sentence case, and this guard reads the strip rather than the file,
      because the uppercase list it used to assert went on passing after the change -- the commit
      note above `COMPILE_STAGES` quotes the old names.
    */
    const player = read("components/compile-stage-player.tsx").replace(
      /\/\*[\s\S]*?\*\//g,
      ""
    );
    const strip = read("lib/compile-stages.ts");
    for (const stage of [
      `label: "Files"`,
      `label: "Updates"`,
      `label: "Use with AI"`,
    ]) {
      expect(strip, `the stage strip must offer ${stage}`).toContain(stage);
    }
    expect(
      strip,
      "the one stage that is a pipeline stage takes its name from the constant"
    ).toContain("label: PIPELINE_STAGES[2].label");
    expect(
      strip,
      "and the strip is not set in the instrument voice any more"
    ).not.toContain(`label: "ORGANIZE"`);
    expect(player, "stages must be selectable, not decorative").toContain(
      'role="tab"'
    );
    expect(player, "reduced motion gets stills and no timer").toContain(
      "prefers-reduced-motion"
    );
  });

  /*
    No invented instrument readings.

    The bar read WORLD v184 / FACTS 128,470 / NEEDS REVIEW 1, from a demo fixture. While the
    page still carried a large "this is a demonstration" banner those were legible as
    illustration; the banner came off and the numbers stayed, leaving three precise fabricated
    figures reading as results from a real deployment.
  */
  it("keeps fabricated world metrics off the landing instrument bar", () => {
    const landing = landingSource()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    expect(landing).not.toContain("FACTS");
    expect(landing).not.toContain("NEEDS REVIEW");
    expect(
      landing,
      "the demo fixture must not reach the landing page"
    ).not.toContain("demo-world");
  });

  /*
    A poster that does not exist renders a broken-image icon and the alt text.

    Cuts 2-4 shipped for one deploy with their posters deleted as a bandwidth saving, which the
    reduced-motion branch turned into `<img src={undefined}>` — a visitor with that setting saw
    a broken image where the film should be. Both halves are asserted: every band names a
    poster, and every poster it names is a file in the repo.
  */
  /*
    The masters are 2x, so a HiDPI display has real pixels to paint.

    A 1440-wide master is upscaled ~1.7x on a 2x screen — measured 1440 source pixels stretched
    into 2460 device pixels — and the small mono type in these cuts is the first thing to smear.
    That is why a film could look sharp on one monitor and mushy on another.

    This asserts the shipped bytes, not the recording script, because the two have drifted
    before: `deviceScaleFactor` looks like it should raise the recorded resolution and does not,
    and a 2880 viewport raises it while silently breaking the composition.
  */
  it("ships the compile cuts at 2x so HiDPI screens do not upscale them", () => {
    const film = join(root, "public", "film");
    for (const name of [
      "compile-cut",
      "compile-cut-2",
      "compile-cut-3",
      "compile-cut-4",
    ]) {
      const file = join(film, `${name}.mp4`);
      expect(existsSync(file), `${name}.mp4 is missing`).toBe(true);
      /*
        Read the dimensions from the file rather than shelling out to ffprobe, which is not on
        every machine that runs these tests.

        `tkhd` ends with width and height as 16.16 fixed-point, 80 bytes past the type field in
        a version-0 box — located by searching the box for the known pair rather than counting
        the spec's fields, after three hand-counted offsets each produced plausible wrong
        numbers (68 gave "1800x0", 76 the unity matrix's 16384, 84 "1800x0" again). The
        assertion prints what it read so a future drift is legible rather than a bare false.
      */
      const bytes = readFileSync(file);
      const at = bytes.indexOf(Buffer.from("tkhd"));
      expect(at, `${name}.mp4 has no tkhd box`).toBeGreaterThan(0);
      expect(bytes[at + 4], `${name}.mp4 is not a version-0 tkhd`).toBe(0);
      const width = bytes.readUInt32BE(at + 80) >> 16;
      const height = bytes.readUInt32BE(at + 84) >> 16;
      expect(`${name}: ${width}x${height}`).toBe(`${name}: 2880x1800`);
    }
  });

  it("gives every film stage a poster file that actually exists", () => {
    // Landing V2: the posters are the stage table's and the player's now. The landing names none.
    const page = [
      read("lib/compile-stages.ts"),
      read("components/compile-stage-player.tsx"),
    ].join("\n");
    /*
      Match the path wherever it is written, not only in a JSX attribute.

      The old pattern required `poster="/film/..."` literally. Posters are now declared once in
      the stage table and passed through as `poster={stage.poster}`, so an attribute-shaped
      regex found none of them and the check silently had nothing to assert.
    */
    const posters = [...page.matchAll(/["'](\/film\/poster-[^"']+)["']/g)].map(
      match => match[1]!
    );
    expect(posters.length, "every stage names a poster").toBeGreaterThanOrEqual(
      4
    );
    for (const poster of posters) {
      expect(
        existsSync(join(root, "public", poster)),
        `${poster} is referenced but missing from public/`
      ).toBe(true);
    }
  });

  /*
    n15. Five of these were still files with no importer: `answer-switch`, `change-lattice` and
    `identity-resolve` were reached only by the copy-surface list in this test, and
    `canvas-transition-link` and `reading-demo` by nothing at all. A component that renders
    nowhere is copy nobody reviews and a widget the next reader assumes is live, so the guard that
    kept them off the landing page now keeps them out of the repository -- which is the same rule,
    stated where it cannot be satisfied by deleting one import.
  */
  it("does not restage widgets the films already show", () => {
    const page = landingSource();
    expect(page).not.toContain("CompilePipeline");
    expect(page).not.toContain("RebuildConsole");
    for (const orphan of [
      "components/answer-switch.tsx",
      "components/canvas-transition-link.tsx",
      "components/change-lattice.tsx",
      "components/identity-resolve.tsx",
      "components/reading-demo.tsx",
      "lib/demo-reading.ts",
    ]) {
      expect(existsSync(join(root, orphan)), `${orphan} renders nowhere`).toBe(
        false
      );
    }
  });

  /*
    Nine scenes, and the source proof is one scroll below the hero rather than inside it.

    The replan's answer to "where is the proof" was three screenshots of /explore under the film;
    the V2 answer put a committed render of a real filing page in the hero itself. The founder's
    2026-09-20 decision moves it once more: the hero is a centered statement over the four locked
    films, and Scene 02 immediately under it is the proof -- three prepared questions this public
    World answers, each with the passage the retriever scored and the page and box it was read
    from, each opening the Evidence act of the route that holds both.

    So the assertion follows the proof rather than the hero. What it still owes is unchanged:
    the page reaches the real record rather than a picture of it, every figure on it declares
    that it was measured, and no locator vocabulary is taught to a first-time reader.

    `LANDING_FRAMES` and its six captures were deleted on 2026-09-22 -- the last of the eight
    DELETE rows in UNWIRED_INVENTORY_2026-09-22 §3. The record was kept on the theory that a
    later scene might use them; no scene does, and an unrendered screenshot record is a caption
    nobody reads guarding six files nobody is served. What this test owes is unchanged, and it
    is owed by `components/landing-v2/scenes/proof.tsx`, which is actually on the page.
  */
  it("reaches original-source proof from the page without teaching locator jargon", () => {
    const proof = read("components/landing-v2/scenes/proof.tsx");
    expect(proof, "the quoted passage opens the evidence behind it").toContain(
      "tab.openHref"
    );
    expect(
      proof,
      "every figure in the proof declares that it was measured"
    ).toContain('data-derived="1"');
    expect(
      read("lib/landing-v2-proof.ts"),
      "the deep link is the product's own URL shape"
    ).toContain("/explore?act=evidence&evidence=");
    expect(landingSource()).not.toContain("Exact bbox");
  });
  it("stages a customer's own upload in the workspace, not a fixture world", () => {
    const stage = read("components/compile-stage.tsx");
    /* Moved 2026-09-17 with BQ-083: the chapter names are no longer four mono-caps literals in
       this file, they are the shared pipeline vocabulary. What this guards is unchanged --
       the authenticated stage draws the visitor's own run. */
    expect(stage).toContain(
      'import { PIPELINE_STAGES } from "@/lib/pipeline-vocabulary"'
    );
    // The landing fixture must never be pasted into the authenticated surface: no import of
    // the demo world, and no census figure. (The file may name them in prose to say so.)
    expect(stage).not.toMatch(/from ["']@\/lib\/demo-world["']/);
    expect(stage).not.toContain("SOURCE_CENSUS");
  });

  /* Qualification words remain valid internal states, but a buyer-facing source path uses the
     access mode and an actionable connection check instead of an unexplained maturity badge. */
  const A4_WORDS = ["QUALIFIED", "BETA", "ENTERPRISE-ASSISTED", "UNSUPPORTED"];

  it("keeps qualification details reachable without leading the landing page with a beta badge", () => {
    const source = landingSource();
    const workspace = read("app/workspace/page.tsx");
    expect(source).not.toContain('<span className="st">BETA</span>');
    expect(source).not.toContain(
      '<span className="st">ENTERPRISE-ASSISTED</span>'
    );
    expect(source).not.toContain(
      "Provider qualification and last-tested evidence stay visible on Integrations."
    );
    expect(source).not.toContain("The ZIP archive itself is never compiled");
    /*
      BA-009's two facts -- the archive is expanded in the browser, and only the manifest's
      formats leave the machine -- were in a `<details>` fold under the Connect card grid. The
      landing replan deleted the grid, the fold and the three cards (four equal grids in a row
      was the composition problem the replan was opened about), and with them that exact wording.

      The fact is still published -- `lib/docs-content.ts` says the archive is expanded before
      upload and why the ceilings are browser limits -- so that is where the guard follows it. On
      the landing what a reader is still owed is the choice itself: three ways in, each one a real
      destination rather than a promise, with `/sources` among them so the format rules stay one
      click from the decision they qualify.
    */
    expect(source, "the fold and its grid are on /sources now").not.toContain(
      "one-path-source-options"
    );
    /* The outcome-led entry keeps format detail one click away instead of repeating it on /home. */
    expect(source).toContain("Check accepted sources");
    expect(source).toContain('href: "/sources"');
    expect(read("app/sources/page.tsx")).toContain(
      '<Link href="/integrations">Integrations</Link>'
    );
    expect(
      read("lib/docs-content.ts"),
      "and the ZIP fact travels with the format list"
    ).toContain("A ZIP archive is expanded before upload");
    expect(workspace).not.toContain(
      '{ name: "Google Drive", availability: "Beta" }'
    );
    expect(workspace).toContain(
      '{ name: "Google Drive", availability: "Read-only" }'
    );
    expect(workspace).toContain(
      '{ name: "File Server", availability: "Assisted setup" }'
    );
  });

  it("keeps internal qualification vocabulary out of the integration buying path", () => {
    const source = read("app/integrations/page.tsx").replace(
      /\/\*[\s\S]*?\*\//g,
      " "
    );
    for (const word of A4_WORDS)
      expect(source.toUpperCase()).not.toContain(`>${word}<`);
    expect(source).not.toContain("SUPPORT_LEVELS");
    expect(source).toContain('access: "Read-only"');
    // BA-071: "and", like every other fold label on the site.
    expect(source).toContain("Security and sync details");
    expect(source).toContain(
      "Verify the provider account in Workspace before the first sync."
    );

    /*
      BA-061 / BA-065. This test's own subject, pinned the other way round.

      Every connector's Deletion row ended on our internal qualification state, and the page's
      last paragraph before "Connect a source" said no customer install had ever been qualified
      end to end. Each row now states what the adapter does at that event; the monitoring fact
      -- a real buying input -- moved into the fold as "Monitoring", written as where a failed
      run surfaces. So: none of that vocabulary comes back, and the behaviour it displaced is
      still on the page.
    */
    expect(source).not.toMatch(/qualification is still required/);
    expect(source).not.toContain(
      "No customer-run install of this agent has been qualified"
    );
    expect(
      source.match(/nothing compiles from a source we can no longer read/g),
      "one per connector"
    ).toHaveLength(3);
    expect(source).toContain("your scheduler is where a failed run surfaces");
    expect(source).toContain("no inbound port");
  });

  /*
    RESOLVED A-1: one locator shape may not be published as the shape of all evidence.
    Repair, 2026-09-06.

    The positioning pass applied A-1 to six pages and left /solutions -- a PRIMARY_NAV
    destination -- and /api carrying "Citations back to page regions", "Page and bbox
    provenance", "Page-level citation inspection" and "page-and-bbox-bound citations". A guard
    over the pages A-1 governs is what makes the decision stick past the commit that made it.

    Block comments are stripped first, deliberately: a file is allowed to quote the wording it
    retired in order to explain why, and `app/evidence/page.tsx` does exactly that. Product
    surfaces that print a real locator value are not on this list and are not meant to be --
    `/sources` states what the manifest preserves (page, paragraph text, bbox1000), the workspace
    and the evidence viewer read back the actual region on screen, and the OpenAPI description
    names the literal response fields. Those are values, not claims about what evidence is.
  */
  const RETIRED_LOCATOR_WORDING = [
    "page and bbox",
    "page-and-bbox",
    "page regions",
    "page-level citation",
    "evidence back to the page",
    "page number and bounding box",
    // Repair, 2026-09-06: /product/compiled-world published "a document version, page and
    // region" as what every qualified claim points at. Retired for the same reason as the rest.
    "version, page and region",
  ];
  /*
    Landing V2, 2026-09-19. The composition takes the deleted client's row.

    NOT `lib/landing-v2-copy.ts`, and that is a reported finding rather than an omission: the
    copy deck's Evidence scene and its fourth trust proof both publish "version, page and region"
    -- the universal form RESOLVED A-1 retires -- because blueprint §14 asks for that sentence by
    name. Which of the two wins is a decision about what a public claim says, which is not an
    implementer's to take, so the wording is named in the lane report instead of being quietly
    rewritten here or quietly passed by adding the file to a list it would fail.
  */
  const A1_SURFACES = [
    "components/landing-v2/landing-page.tsx",
    "app/product/compiled-world/page.tsx",
    "app/solutions/[slug]/page.tsx",
    "app/api/page.tsx",
    "app/evidence/page.tsx",
    "app/enterprise/page.tsx",
    "app/product/document-understanding/page.tsx",
    "app/knowledge-compiler/page.tsx",
    "app/resources/page.tsx",
  ];

  it.each(A1_SURFACES)(
    "publishes no retired PDF-locator wording in %s",
    surface => {
      const copy = read(surface)
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .toLowerCase();
      for (const phrase of RETIRED_LOCATOR_WORDING) {
        expect(copy, `RESOLVED A-1 retires "${phrase}"`).not.toContain(phrase);
      }
    }
  );

  /*
    BA-078, the other half of A-1, and the most expensive contradiction the 2026-09-11 audit found.

    A-1 stopped one locator shape being published as the shape of all evidence, and /evidence
    answered it with a model: eight locator families, one tile each. Every tile then stated its
    locator in the present tense, eight capability-shaped panels as the page's largest visual
    element, while exactly one of the eight has a reader -- and /sources says so in as many words,
    because every accepted format there preserves page, paragraph text and region. A buyer who
    read both pages caught the brand contradicting itself on the subject the brand is built on.

    The model is not the fix and is not what this checks. What it checks is that the two pages
    cannot drift apart again: /evidence may lead with exactly one locator, it must be the one
    /sources actually preserves a region for, and every other family must carry a state chip in
    the grid rather than a correction folded underneath it.
  */
  it("marks one shipped locator on /evidence, and states the rest as unshipped", () => {
    const page = read("app/evidence/page.tsx");
    const shipped = page.match(/const READING_TODAY = \["([^"]+)"/);
    expect(
      shipped,
      "/evidence no longer names the locator that reads today"
    ).not.toBeNull();
    expect(shipped![1]).toBe("PDF");

    // Every other family is in the contracted list, and none of them is the shipped one.
    const contracted = page.match(
      /const CONTRACTED_LOCATORS = \[([\s\S]*?)\n\] as const;/
    );
    expect(
      contracted,
      "the evidence model is no longer published"
    ).not.toBeNull();
    const families = [...contracted![1]!.matchAll(/\["([^"]+)",/g)].map(
      match => match[1]!
    );
    expect(
      families.length,
      "the model is eight families: one shipped, seven contracted"
    ).toBe(7);
    expect(families).not.toContain(shipped![1]);

    /*
      The status is above the grid, not folded under it, and it says what it is.

      BQ-112 moved it off the tiles: the same four words on all seven of them was one fact
      printed seven times as the loudest element in the section. What BA-078 was defending is
      the position, not the repetition -- the correction must be read before the grid rather
      than discovered behind a click -- so that is what is pinned. It is prose in the heading's
      block, and it is not inside a `<details>`.
    */
    expect(
      page,
      "the locator that reads today is marked as the one that does"
    ).toContain("Reading today");
    expect(
      [...page.matchAll(/Reader not shipped/g)],
      "one statement, not one per tile"
    ).toHaveLength(1);
    expect(
      page
        .slice(page.indexOf("Reader not shipped"))
        .indexOf("CONTRACTED_LOCATORS.map"),
      "the state is read before the grid, not after it"
    ).toBeGreaterThan(0);
    expect(page, "the correction may not go back into a fold").not.toContain(
      "See current locator coverage"
    );
    // And may not be put inside one: nothing above the statement opens a disclosure at all.
    expect(page.slice(0, page.indexOf("Reader not shipped"))).not.toContain(
      "<details"
    );

    /*
      And the claim is the one `/sources` supports. `LIVE_PRESERVED` is the manifest's own list,
      so a day when the pipeline starts preserving a spreadsheet cell fails here instead of
      leaving /evidence understating what it does.
    */
    const manifest = read("../shared/capabilityManifest.ts");
    expect(manifest).toContain(
      'const LIVE_PRESERVED = ["page", "paragraph_text", "bbox1000"]'
    );

    // BA-099: one casing rule across the grid -- the site writes "and", never a spaced slash.
    for (const family of families) {
      expect(
        family,
        "a space-slash pair in a name the site would write with 'and'"
      ).not.toContain(" / ");
    }
  });

  /*
    §17's five pages are one sequence, and the sequence is what breaks first.

    Before this pass each of them ended in three sibling links to two or three of the others, in
    a different order every time, and /reproducibility and /research had no way onward at all.
    That state passed every test in this repository, because nothing checked that the pages knew
    about each other. This does: each page must render `TrustNext` naming itself, so a page
    dropped out of the funnel -- or given someone else's position -- fails here rather than
    quietly ending the reader's journey.
  */
  const TRUST_PAGES: Array<[string, string]> = [
    ["app/security/page.tsx", "/security"],
    ["app/evidence/page.tsx", "/evidence"],
    ["app/benchmarks/page.tsx", "/benchmarks"],
    ["app/reproducibility/page.tsx", "/reproducibility"],
    ["app/research/page.tsx", "/research"],
  ];

  it.each(TRUST_PAGES)(
    "%s ends on its own step of the §17 trust sequence",
    (surface, href) => {
      const source = read(surface);
      expect(source, `${surface} must render the shared next step`).toContain(
        "TrustNext"
      );
      expect(
        source,
        `${surface} must name itself, not another page's position`
      ).toContain(`from="${href}"`);
    }
  );

  it("gives every step of the trust sequence a precise next action", () => {
    const source = read("components/trust-next.tsx");
    // Every href declared in the order must also have an action, or a page renders an empty CTA.
    const steps = [...source.matchAll(/href: "([^"]+)"/g)].map(
      match => match[1]!
    );
    const actions = [...source.matchAll(/"(\/[a-z]+)": "([^"]+)"/g)];
    expect(steps.length).toBeGreaterThanOrEqual(5);
    for (const step of steps.slice(0, -1)) {
      const action = actions.find(([, href]) => href === step);
      expect(action, `${step} has no next action`).toBeDefined();
      // §22 bars the generic CTA where a precise next action exists, which is every step here.
      expect(action![2]!.toLowerCase()).not.toContain("learn more");
      expect(action![2]!.toLowerCase()).not.toContain("read more");
    }
  });

  /*
    A published file list is a promise about bytes.

    /developers prints the contents of a signed export. It used to describe them in prose, which
    drifts silently; now it prints `REQUIRED_PACKAGE_PATHS` plus the files the exporter adds on
    the way out, and this checks each of those strings against the module that writes them. A
    file renamed in the exporter fails here instead of on a customer's `unzip`.
  */
  it("names only files the exporter actually writes, on every page that lists them", () => {
    const page = read("app/developers/page.tsx");
    const contents = read("lib/package-contents.ts");
    const exporter = read("lib/collection-download.ts");
    const extras = contents.match(
      /const PACKAGE_EXTRAS = \[([\s\S]*?)\n\] as const;/
    );
    expect(
      extras,
      "the extra-file list is still declared in lib/package-contents.ts"
    ).not.toBeNull();
    const paths = [...extras![1]!.matchAll(/"([^"]+)"/g)].map(
      match => match[1]!
    );
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(
        exporter,
        `lib/collection-download.ts never writes ${path}`
      ).toContain(`"${path}"`);
    }
    expect(
      contents,
      "the required paths come from the exporter, not a second list"
    ).toContain("REQUIRED_PACKAGE_PATHS");
    // G3-007: the three surfaces render the one list rather than each keeping their own.
    expect(page, "/developers went back to its own file list").toContain(
      "PACKAGE_CONTENTS"
    );
    expect(
      read("lib/docs-content.ts"),
      "the docs tables went back to their own file lists"
    ).toContain("PACKAGE_CONTENTS");
    // §16.4: the export is a semantic projection, never a claimed OWL ontology.
    expect(page.toLowerCase()).not.toContain("complete owl");
    expect(page).toContain("semantic projection");
  });

  /*
    §22: no generic CTA on a conversion surface where a precise next action exists.

    Every one of these pages has a specific thing the reader should do next -- run the
    quickstart, open a result at its source, start an evaluation -- and "Learn more" is what a
    page says when nobody decided which.
  */
  const CONVERSION_SURFACES = [
    "components/landing-v2/landing-page.tsx",
    "components/landing-v2/scene-actions.ts",
    "lib/landing-v2-copy.ts",
    "components/pricing-page-client.tsx",
    "app/sources/page.tsx",
    "app/security/page.tsx",
    "app/evidence/page.tsx",
    "app/benchmarks/page.tsx",
    "app/research/page.tsx",
    "app/developers/page.tsx",
    "app/docs/page.tsx",
  ];

  it.each(CONVERSION_SURFACES)(
    "uses no generic call to action in %s",
    surface => {
      const copy = read(surface)
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .toLowerCase();
      for (const generic of ["learn more", "read more", "find out more"]) {
        expect(
          copy,
          `§22 asks for the precise next action, not "${generic}"`
        ).not.toContain(generic);
      }
    }
  );

  /*
    §10.2's proof strip must stay proof rather than becoming a statistics row.

    A strip under a hero is where invented figures arrive: "10M pages compiled", "99.9% uptime",
    a customer count. §35 bars every one of them and none is measured here, so each item is a
    link to the page that substantiates it and the strip may carry no digit-bearing figure at
    all. This reads the rendered items, not the file, so a number added in any of them fails.
  */
  it("orders the scenes proof-first and adds no invented result figure", () => {
    const page = read("components/landing-v2/landing-page.tsx");
    expect(page).not.toContain('className="hero-proof"');
    // §9's order, read as positions: the hero, then the instant proof, then the rest.
    expect(page.indexOf('data-scene="1"')).toBeLessThan(
      page.indexOf("copy.proof")
    );
    expect(page.indexOf("copy.proof")).toBeLessThan(page.indexOf("copy.trust"));
    /*
      The strip under a hero is where invented figures arrive: "10M pages compiled", "99.9%
      uptime", a customer count. §35 bars every one of them, none is measured here, and the copy
      deck is digit-free by construction -- `lib/landing-v2-copy.test.ts` fails on a digit in any
      string in it, so the only figures that can reach this page come from a module that read the
      compiled World.
    */
    const deck = read("lib/landing-v2-copy.ts");
    expect(deck).not.toMatch(
      /\d[\d,.]*\s*(?:million|billion|% accuracy|customers served|pages processed)/i
    );
    expect(landingSource()).not.toContain("128,470");
  });

  /*
    §54's purchase friction map, checked as coverage rather than as wording.

    The blueprint names seventeen objections and asks that each have a public answer. Fourteen had
    one on some page; three -- readiness, lock-in and deletion -- had none, which is the state
    this list was added to fix. Each row is matched by the words that make it that objection and
    not a neighbouring one, so an answer may be rewritten freely and may not quietly disappear.

    The second assertion is the reason this belongs on the pricing page rather than in a marketing
    fold: an answer with no destination is a paragraph, and every one of these is a question a
    reader would rather verify than be told.
  */
  const PURCHASE_OBJECTIONS = [
    "just OCR",
    "vector database",
    "exactly is a World",
    "relate to RAG",
    "verify an answer",
    "source document changes",
    "Office files",
    "agent use it",
    "uncertain",
    "data safe",
    "What is ready to use",
    "much does it cost",
    "setup is required",
    "locked in",
    "Can I export",
    "delete my data",
    "security review approve",
  ];

  const purchaseFaq = () =>
    read("components/pricing-page-client.tsx").match(
      /const PURCHASE_FAQ[\s\S]*?\n\];/
    )?.[0] ?? "";

  it.each(PURCHASE_OBJECTIONS)(
    "answers the §54 objection about %s on /pricing",
    objection => {
      const faq = purchaseFaq();
      expect(
        faq,
        "the §54 answers are still declared on the pricing page"
      ).not.toBe("");
      expect(faq).toContain(objection);
    }
  );

  it("points every §54 answer at the page that maintains it", () => {
    const rows = [...purchaseFaq().matchAll(/^ {2}\[".*\],$/gm)].map(
      match => match[0]
    );
    expect(rows.length, "§54 lists seventeen objections").toBe(17);
    for (const row of rows) {
      expect(
        row,
        `${row.slice(0, 40)}… answers without offering the page that says it in full`
      ).toMatch(/"\/[a-z/-]+" as Route/);
    }
  });

  /*
    Audit B01 / U02, added deliberately with the three job cards under the hero.

    The locked hero stays exactly as it is -- the test above pins all five of its strings -- and
    the cards go under it because the page went from that hero straight into World, compile,
    candidate and ontology without ever naming a job. Two things can go wrong with a card like
    this and both are checked: a link to a solution page that does not exist, and a figure. Every
    href must resolve to a real `app/solutions/[slug]` key, because a dead link under the hero is
    the worst place on the site for one, and no card body may carry a digit.
  */
  it("keeps the five homepage beats ordered and leaves source and solution pages intact", () => {
    /*
      Audit B01 / U02. The hero is followed by a named way in rather than by a jump straight into
      World, compile, candidate and ontology. Two things can go wrong and both are still checked:
      a link to a page that does not exist, and a figure. The copy deck declares the three intake
      paths with a real destination each, and the landing itself reaches /sources and
      /integrations from Scene 07's intake rows.

      Scene 07 links its decision rows from `copy.outbound`, so the deck below is the one place
      that decides where "Check accepted sources" sends a reader. Format detail stays on the
      source page rather than being repeated on the outcome-led home page.
    */
    const deck = read("lib/landing-v2-copy.ts");
    expect(deck).toContain("Check accepted sources");
    expect(deck).toContain('href: "/sources"');
    expect(read("app/sources/page.tsx")).toContain(
      '<Link href="/integrations">Integrations</Link>'
    );
    expect(
      read("components/landing-v2/scenes/use.tsx"),
      "the landing offers the format rules one click from the decision they qualify"
    ).toContain("copy.inbound.map");
    // §9's order, read as positions.
    const page = read("components/landing-v2/landing-page.tsx");
    const order = [
      'id="s1"',
      "<HeroActions",
      "<CompilerSpecimen",
      'id="s2"',
      "<HeroProof",
      "<HeroFilm",
      "<ProofScene",
      "copy.recompile",
      "copy.trust",
      "copy.start",
    ].map(id => page.indexOf(id));
    expect(
      order.every(
        (at, index) => at > 0 && (index === 0 || at > order[index - 1]!)
      )
    ).toBe(true);
    expect(read("app/solutions/[slug]/page.tsx")).toContain(
      "ai-ready-knowledge"
    );
  });

  /*
    Audit B02. Five solution pages answered the same reader. Each now declares who it is for, as
    a field, so the label cannot drift from the copy under it and a new solution cannot ship
    without one.
  */
  it("gives every solution page an audience", () => {
    const solutions = read("app/solutions/[slug]/page.tsx");
    const slugs = [...solutions.matchAll(/^ {2}"([a-z-]+)": \{\r?$/gm)].map(
      match => match[1]!
    );
    const audiences = [
      ...solutions.matchAll(/^ {4}audience: "([^"]+)",\r?$/gm),
    ].map(match => match[1]!);
    expect(slugs.length).toBeGreaterThanOrEqual(5);
    expect(audiences, "every solution declares its reader").toHaveLength(
      slugs.length
    );
    expect(solutions, "and the page renders it").toContain(
      "For: {solution.audience}"
    );
  });

  /*
    Audit E04 / G06. The Apple sample's representativeness limit, and the take-away asset, both
    at the demo rather than two pages away from it.
  */
  it("states what the Apple sample does not represent, next to the sample", () => {
    const stage = read("components/explore/explore-stage.tsx");
    /*
      BA-037 rewrote the note this guards: six scoping clauses at 11px sitting under the page's
      central promise became three sentences at 15px, and "Apple&apos;s" became U+2019. The fact
      is unchanged and the case is tighter rather than looser -- the limit is still required
      here, the corpus is still named, both documents are still reachable, and the note may no
      longer be typeset below the 12px floor it was under.
    */
    expect(stage).toContain("compiled from Apple’s public SEC filings");
    expect(
      stage,
      "no straight apostrophe between letters in this note"
    ).not.toContain("Apple&apos;s own public SEC filings");
    expect(
      stage,
      "the limit still names what the corpus does not represent"
    ).toContain("not a claim about a mixed internal corpus");
    expect(
      stage,
      "and the reproducible asset is reachable from the sample"
    ).toContain('href="/reproducibility"');
    expect(
      stage,
      "and what the read does not recover is still one link away"
    ).toContain('href="/sources"');
    expect(read("components/explore/explore-stage.module.css")).toMatch(
      /\.entryNote \{[^}]*font-size: 1[5-9]px/
    );
  });
});

/* ============================================================ BA-232 / BA-252: one verb, one name

  The site-wide vocabulary rules, owned here because this file is where the naming rules that
  apply to every surface already live (audit §5 rule 1: other lanes send their additions here
  rather than editing the shared lists in parallel).

  These assertions are scoped to the chrome -- the navigation data, the two nav components, the
  shared header and footer, the header's action and the policy layout. That is where the same
  action was spelled two ways at two widths, and it is the whole of what this lane can make true:
  the page-level strings the audit lists (`app/product/page.tsx`, `app/login/page.tsx`,
  `lib/explore-story.ts`, `app/trust/page.tsx`, `app/solutions/[slug]/page.tsx`) belong to four
  other lanes and arrive as cross-lane patches. The list widens to `CONVERSION_SURFACES` in the
  commit that lands the last of them; widening it before is a red suite, not a stricter rule.
*/

/** Spellings that were in use for one of `PRODUCT_NOUNS` and are retired. */
const RETIRED_NAMES = [
  "Trust center",
  "Technical evidence",
  "Explore a World",
  "Explore the public World",
  "Explore a public sample",
  "ENTER WORLD",
  "Get started",
  "Start with the data path",
  "Start free",
] as const;

/** The chrome: rendered on every public page, and the only surfaces this lane owns. */
const CHROME_SURFACES = [
  "lib/site-navigation.ts",
  "components/site-nav/desktop-primary-nav.tsx",
  "components/mobile-primary-nav.tsx",
  "components/public-site-chrome.tsx",
  "components/public-primary-cta.tsx",
  "components/policy-layout.tsx",
] as const;

/** Comments explain what a name replaced and must not count as the name. */
const prose = (surface: string) =>
  read(surface)
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");

describe("the site's own vocabulary", () => {
  it("declares two access actions and one Explore action, and no more", () => {
    expect(ACCESS_CTA).toEqual({ href: "/contact", label: "Request access" });
    expect(SELF_SERVE_CTA).toEqual({
      href: "/login",
      label: "Start with your files",
    });
    expect(EXPLORE_CTA).toEqual({
      href: "/explore",
      label: "Explore a Compiled World",
    });
    // The two names the audit found spelled four ways between them, in the table every surface
    // is held to. `RETIRED_NAMES` below is the other half of the same rule.
    expect(PRODUCT_NOUNS).toContain("Compiled World");
    expect(PRODUCT_NOUNS).toContain("Trust Center");
    // BQ-098: the category noun is in the table too, and no public page writes it in lower case.
    expect(PRODUCT_NOUNS).toContain("Knowledge Compiler");
    for (const file of marketingPageFiles()) {
      expect(prose(file), `${file} lower-cases the category noun`).not.toMatch(
        /knowledge compiler/
      );
    }
    // The commercial posture chooses between the two; it does not write a third.
    expect(primaryCallToAction({})).toEqual(ACCESS_CTA);
    /*
      G1-001 / G1-010 / G2-026. This used to assert that the three billing flags alone produce
      "Start with your files", and they did -- on `/` and `/pricing`, which resolve them at request
      time, while every prerendered page resolved the same call at build time with the flags
      scrubbed and rendered "Request access". One site, two primary actions, and the louder one
      promised the compile this deployment does not run.

      The fact being pinned is the same one, with the condition it was missing: the self-serve
      action requires the customer-data gate as well as the card. The gate is closed, so the
      billing flags no longer change the answer -- and when it opens, this case is the one that
      says so out loud rather than a CTA changing under nobody's decision.
    */
    expect(
      activationPolicy.customerData.enabled,
      "the gate below is what this case turns on"
    ).toBe(false);
    expect(
      primaryCallToAction({
        COMMERCIAL_MODE: "live",
        TAVONEL_BILLING_LAUNCH_APPROVED: "true",
        VERCEL_ENV: "production",
      })
    ).toEqual(ACCESS_CTA);
  });

  /*
    D9. One verb for the act, in the copy a reader sees: a candidate is *activated*, never
    *promoted*.

    The decision lets the code keep the older name -- the route is still
    `app/api/collections/[id]/promote/route.ts` and the gate is still `candidatePromotion`, and
    renaming either is a migration rather than a copy fix -- so a line naming one of those two
    is not reader copy and does not count here. /privacy and /terms are the founder's legal
    text and are not an implementer's to rewrite at all.

    Comments are stripped by `prose`, which is what makes the rule checkable: the pages are full
    of paragraphs explaining which word was there before.
  */
  it("activates a candidate, and never promotes one, in reader copy (D9)", () => {
    const LEGAL = ["app/privacy/page.tsx", "app/terms/page.tsx"];
    for (const file of marketingPageFiles()) {
      if (LEGAL.includes(file)) continue;
      const lines = prose(file)
        .split(/\r?\n/)
        .filter(line => !/candidatePromotion|promote\/route/.test(line))
        .filter(line => /\bpromot/i.test(line));
      expect(
        lines,
        `${file} writes the promote verb in copy a reader sees`
      ).toEqual([]);
    }
  });

  /*
    G1-001: /explore's closing action is the site's access action, not a fourth spelling of it.

    `lib/explore-story.ts` is reachable from the client bundle, where the commercial flags inline
    as `undefined`, so it names `ACCESS_CTA` directly instead of resolving the posture. That is
    only honest while the gate is closed, which is exactly what this asserts.
  */
  it("closes the public sample on the same access action the header offers", () => {
    expect(activationPolicy.customerData.enabled).toBe(false);
    const primary = EXPLORE_COPY.endActions.find(action => action.primary);
    expect(primary).toEqual({
      label: ACCESS_CTA.label,
      href: ACCESS_CTA.href,
      primary: true,
    });
  });

  it.each(CHROME_SURFACES)("publishes no retired name in %s", surface => {
    const source = prose(surface);
    for (const name of RETIRED_NAMES) {
      expect(
        source,
        `"${name}" is a retired spelling; the table is PRODUCT_NOUNS`
      ).not.toContain(name);
    }
  });

  /*
    BQ-029, and the widening the comment above `RETIRED_NAMES` promised.

    The audit counted thirteen spellings of the contact action and fourteen of the Explore
    action across the marketing routes: "Open the read-only sample", "Explore a World", "See a
    compiled World", "See a page and its regions", "Talk to us about your corpus", "Talk to us
    about your sources", "Talk about a pilot". None of them was wrong on its own page; together
    they meant a reader could not learn one name for one thing.

    This walks the marketing routes rather than a list of surfaces, so a page added tomorrow is
    checked without anybody remembering to add it. A **button** to either destination reads its
    label from the constant. Prose is deliberately not covered: a link inside a sentence is part
    of the sentence, and forcing a constant into one produces English nobody writes.

    A context variant is still allowed where the destination is a genuinely different
    conversation, and it is allowed by being named here rather than by not being noticed --
    today, scoping an Enterprise pilot and asking a security-review question.
  */
  const CTA_VARIANTS = [
    "Scope an Enterprise pilot",
    "Ask a security review question",
    "Ask a privacy question",
    // BQ-136: /status closes on the thing it asks for twice in its own prose -- report what
    // you are seeing rather than wait for it to appear here. "Request access" on a page a
    // reader opened because something looks broken is a different conversation from this one.
    "Report an outage",
  ];

  it("names the two site-wide actions from their constants on every marketing route", () => {
    const routes = marketingPageFiles();
    expect(
      routes.length,
      "no marketing routes found -- the walk is out of date"
    ).toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const file of routes) {
      const source = prose(file);
      for (const [, label] of source.matchAll(
        /<Link className="btn[^"]*" href=(?:"\/(?:explore|contact)"|\{"\/(?:explore|contact)" as Route\})>([^<{][^<]*)<\/Link>/g
      )) {
        if (!CTA_VARIANTS.includes(label.trim()))
          offenders.push(`${file}: "${label.trim()}"`);
      }
    }
    expect(
      offenders,
      "a button writes its own label for an action that has a constant"
    ).toEqual([]);
  });

  /*
    The failure the audit measured: the desktop bar said "Contact" and the 390 header said
    "Request access", because the two chromes read two different constants. One object reaches
    both now, so neither may carry a label of its own.
  */
  it("gives the two widths one action, from one object", () => {
    const chrome = prose("components/public-site-chrome.tsx");
    /*
      G1-043. The header renders `ctaLabel`, not `cta.label`, and the two lines below are why that
      is still one action from one object rather than a label of the header's own: `ctaLabel` is
      `cta.label` unless the page is /ko, where it is that action's Korean name keyed by the same
      destination. The chrome may still write neither English literal itself.
    */
    expect(
      chrome,
      "the header derives the Pricing label from the navigation model"
    ).toContain(
      'const pricingLabel = korean ? KO_CHROME.nav["/pricing"] : "Pricing";'
    );
    expect(chrome, "and renders that").toContain("{pricingLabel}");
    for (const literal of ["Request access", "Start with your files"]) {
      expect(
        chrome,
        `the header writes "${literal}" instead of reading it`
      ).not.toContain(literal);
    }
    /*
      BQ-059. The phone sheet no longer carries the action, so the guard stops asking it to.

      It used to be handed `{...cta, label: ctaLabel}` and drew the button a second time, forty
      pixels below the one in the header that is visible at every width. The header keeps the
      action -- it is the one thing that may not sit behind a disclosure -- and the sheet is the
      three sections it was always for. What this still has to guarantee is the thing the row was
      opened about: neither chrome writes an action label of its own.
    */
    expect(
      chrome,
      "the phone sheet is given no action to draw twice"
    ).not.toContain("<MobilePrimaryNav cta=");
    const sheet = prose("components/mobile-primary-nav.tsx");
    for (const literal of [
      "Contact<",
      "Request access",
      "Start with your files",
    ]) {
      expect(
        sheet,
        `the phone sheet writes "${literal}" instead of reading it`
      ).not.toContain(literal);
    }
  });

  /*
    BA-232's other half: no page paints a placeholder action and then replaces it.

    `PublicPrimaryCta` painted "Get started", asked `/api/status` from the browser and swapped the
    label -- on the most prominent control of every page that used the header's fallback. The
    commercial state is read where it lives instead, which is also why this component must stay
    off the client: `process.env` flags without the public prefix inline as `undefined` there.
  */
  it("resolves the access action on the server, with no placeholder to replace", () => {
    const cta = read("components/public-primary-cta.tsx");
    expect(
      cta,
      "a client component cannot read the commercial flags"
    ).not.toContain('"use client"');
    expect(cta, "and must not ask the browser for them").not.toContain(
      "fetch("
    );
    expect(cta).toContain("primaryCallToAction()");
    const chrome = prose("components/public-site-chrome.tsx");
    expect(
      chrome,
      "the header takes the resolved action rather than a component that guesses it"
    ).not.toContain("PublicPrimaryCta");
  });
});

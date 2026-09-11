import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
  "components/home-page-client.tsx",
  "app/layout.tsx",
  "app/workspace/page.tsx",
  "app/auth/callback/page.tsx",
  "components/answer-switch.tsx",
  "components/change-lattice.tsx",
  "components/compile-pipeline.tsx",
  "components/evidence-tether.tsx",
  "components/identity-resolve.tsx",
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
const OVERCLAIMS = ["generally available", "production-ready", "fully automated ontology"];

function read(surface: string): string {
  return readFileSync(join(root, surface), "utf8");
}

/*
  The landing page is three files now.

  Scene 3's four stacked bands became one pinned player, so the film sources, posters and stage
  labels moved into `compile-stage-player.tsx`. Every assertion below is about what a visitor
  sees at `/`, so the player is part of the landing source they read.
*/
function landingSource(): string {
  return [
    read("app/page.tsx"),
    read("components/home-page-client.tsx"),
    read("components/compile-stage-player.tsx"),
  ].join("\n");
}

describe("public copy", () => {
  it.each(COPY_SURFACES)("keeps every barred phrase out of %s", (surface) => {
    const source = read(surface).toLowerCase();
    for (const phrase of BARRED) {
      expect(source, `SPEC 13.3 bars "${phrase}"`).not.toContain(phrase);
    }
  });

  it.each(COPY_SURFACES)("makes no readiness overclaim in %s", (surface) => {
    const source = read(surface).toLowerCase();
    for (const phrase of OVERCLAIMS) {
      expect(source, `"${phrase}" asserts a readiness this deployment has not established`).not.toContain(phrase);
    }
  });

  it("keeps fixture disclosure with the fixture and off the five-scene landing page", () => {
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

  it("names each scene the same way in the eyebrow and the instrument bar", () => {
    const page = landingSource();
    const barLabels = [...page.matchAll(/\{ id: \d+, label: "([^"]+)"/g)].map((m) => m[1]);
    const eyebrows = [...page.matchAll(/eyebrow="([^"]+)"/g)].map((m) => m[1]);

    expect(barLabels.length).toBeGreaterThan(1);
    for (const label of barLabels.slice(1)) {
      expect(eyebrows, `scene "${label}" must use its bar label as its eyebrow`).toContain(label);
    }
  });

  /*
    The lock, re-derived. RESOLVED A-2 (2026-09-06).

    The previous lock pinned "Turn documents and connected systems / into a source-grounded
    world your AI can use." and a lede ending "evidence back to the page." That lede is the
    reason this test changes rather than the headline alone: "back to the page" is only true
    while every accepted format is converted to PDF before reading, and it is the wording
    RESOLVED A-1 retires across the site. A lock is not a claim that the string is right
    forever; it is a claim that the string does not drift without a decision. This is that
    decision, so the lock moves with it instead of being deleted.
  */
  it("keeps the locked current-and-traceable hero and its two definitions", () => {
    const page = landingSource();
    expect(page).toContain("Your AI needs more than searchable files.");
    expect(page).toContain("It needs a current, traceable world.");
    expect(page).toContain("TAVONEL compiles your own sources into that world");
    // Both adjectives are defined on the page, not left as adjectives.
    expect(page).toContain("recompiled when those sources change");
    expect(page).toContain("stays traceable to its exact source location");
    // The retired wording must not come back by hand.
    expect(page).not.toContain("evidence back to the page");
  });

  it("puts the locked hero proof and three motion cuts on the landing page", () => {
    const page = landingSource();
    expect(page).toContain("/film/poster-1.webp");
    expect(page).toContain("/film/compile-cut-2.mp4");
    expect(page).toContain("/film/compile-cut-3.mp4");
    expect(page).toContain("/film/compile-cut-4.mp4");
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
  it("keeps every landing film inside the stage player, never in a scene file", () => {
    for (const file of ["app/page.tsx", "components/home-page-client.tsx"]) {
      // Comments in these files discuss the <video> element by name, so the check is run
      // against the source with comments stripped — otherwise it fails on its own rationale.
      const source = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(source, `${file} must not hand-roll a <video>`).not.toMatch(/<video[\s>]/);
      expect(source, `${file} must not inline an aspect ratio`).not.toContain("aspectRatio");
    }
    const player = read("components/compile-stage-player.tsx");
    expect(player, "the player owns exactly one <video> template").toMatch(/<video/);
    expect(player, "only the active and admitted stages may hold a source")
      .toContain("admitted.has(position) ?");
  });

  /*
    Scene 3 is one frame, not four stacked ones.

    The four cuts used to be four `FilmBand`s in a column: the scene counter said five and the
    reader scrolled through eight screens of film, while four <video> elements competed for
    bandwidth and, on a phone, for a limited number of hardware decoders.
  */
  it("presents the compile film as a single staged viewport", () => {
    const landing = read("components/home-page-client.tsx");
    expect(landing).toContain("<CompileStagePlayer");
    expect(landing.match(/<CompileStagePlayer/g)).toHaveLength(1);

    const player = read("components/compile-stage-player.tsx");
    for (const stage of ["SOURCES", "READ", "STRUCTURE", "WORLD"]) {
      expect(player, `the stage strip must offer ${stage}`).toContain(stage);
    }
    expect(player, "stages must be selectable, not decorative").toContain('role="tab"');
    expect(player, "reduced motion gets stills and no timer").toContain("prefers-reduced-motion");
  });

  /*
    No invented instrument readings.

    The bar read WORLD v184 / FACTS 128,470 / NEEDS REVIEW 1, from a demo fixture. While the
    page still carried a large "this is a demonstration" banner those were legible as
    illustration; the banner came off and the numbers stayed, leaving three precise fabricated
    figures reading as results from a real deployment.
  */
  it("keeps fabricated world metrics off the landing instrument bar", () => {
    const landing = read("components/home-page-client.tsx")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    expect(landing).not.toContain("FACTS");
    expect(landing).not.toContain("NEEDS REVIEW");
    expect(landing, "the demo fixture must not reach the landing page").not.toContain("demo-world");
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
    for (const name of ["compile-cut", "compile-cut-2", "compile-cut-3", "compile-cut-4"]) {
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
    const page = landingSource();
    /*
      Match the path wherever it is written, not only in a JSX attribute.

      The old pattern required `poster="/film/..."` literally. Posters are now declared once in
      the stage table and passed through as `poster={stage.poster}`, so an attribute-shaped
      regex found none of them and the check silently had nothing to assert.
    */
    const posters = [...page.matchAll(/["'](\/film\/poster-[^"']+)["']/g)].map((match) => match[1]!);
    expect(posters.length, "every stage names a poster").toBeGreaterThanOrEqual(4);
    for (const poster of posters) {
      expect(
        existsSync(join(root, "public", poster)),
        `${poster} is referenced but missing from public/`,
      ).toBe(true);
    }
  });

  it("does not restage widgets the films already show", () => {
    const page = landingSource();
    expect(page).not.toContain("ReadingDemo");
    expect(page).not.toContain("CompilePipeline");
    expect(page).not.toContain("RebuildConsole");
    expect(page).not.toContain("ChangeLattice");
    expect(page).not.toContain("IdentityResolve");
  });

  it("keeps the landing to five scenes and names the exact evidence path", () => {
    const page = landingSource();
    expect(page.match(/<Scene id=/g)).toHaveLength(4);
    expect(page).toContain('id="s1"');
    expect(page).toContain("Object");
    expect(page).toContain("Relation");
    /*
      The path ends at a source location, not a page (RESOLVED A-1). "Document page" and
      "Exact bbox" were the last two steps; they describe a PDF locator, and the landing page
      may not present one locator as the shape of all evidence.
    */
    expect(page).toContain("Source version");
    expect(page).toContain("Exact location");
    expect(page).not.toContain("Exact bbox");
  });

  it("stages a customer's own upload in the workspace, not a fixture world", () => {
    const stage = read("components/compile-stage.tsx");
    expect(stage).toContain("SOURCES");
    expect(stage).toContain("WORLD");
    // The landing fixture must never be pasted into the authenticated surface: no import of
    // the demo world, and no census figure. (The file may name them in prose to say so.)
    expect(stage).not.toMatch(/from ["']@\/lib\/demo-world["']/);
    expect(stage).not.toContain("SOURCE_CENSUS");
  });

  /* Qualification words remain valid internal states, but a buyer-facing source path uses the
     access mode and an actionable connection check instead of an unexplained maturity badge. */
  const A4_WORDS = ["QUALIFIED", "BETA", "ENTERPRISE-ASSISTED", "UNSUPPORTED"];

  it("keeps qualification details reachable without leading the landing page with a beta badge", () => {
    const source = read("components/home-page-client.tsx");
    const workspace = read("app/workspace/page.tsx");
    expect(source).not.toContain('<span className="st">BETA</span>');
    expect(source).not.toContain('<span className="st">ENTERPRISE-ASSISTED</span>');
    expect(source).not.toContain("Provider qualification and last-tested evidence stay visible on Integrations.");
    expect(source).not.toContain("The ZIP archive itself is never compiled");
    /*
      BA-009 turned "ZIPs open locally. Only supported files inside are uploaded." around, so the
      scene where a visitor decides to hand over their own material leads with what happens
      rather than with what is refused. Both facts stay pinned, and now separately: the archive
      is expanded in the browser, and the manifest's formats are what leaves the machine. Two
      substrings rather than one, because either half going missing is the defect this line
      exists for -- copy that says only "supported files" has stopped saying where the ZIP opened.
    */
    expect(source).toContain("ZIPs open on your machine");
    expect(source).toContain("the supported files inside compile straight into your World.");
    expect(source).toContain('className="intake-flow rv"');
    expect(source).toContain('href="/integrations"');
    expect(workspace).not.toContain('{ name: "Google Drive", availability: "Beta" }');
    expect(workspace).toContain('{ name: "Google Drive", availability: "Read-only" }');
    expect(workspace).toContain('{ name: "File Server", availability: "Assisted setup" }');
  });

  it("keeps internal qualification vocabulary out of the integration buying path", () => {
    const source = read("app/integrations/page.tsx").replace(/\/\*[\s\S]*?\*\//g, " ");
    for (const word of A4_WORDS) expect(source.toUpperCase()).not.toContain(`>${word}<`);
    expect(source).not.toContain("SUPPORT_LEVELS");
    expect(source).toContain('access: "Read-only"');
    expect(source).toContain("Security & sync details");
    expect(source).toContain("Verify the provider account in Workspace before the first sync.");
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
  const A1_SURFACES = [
    "components/home-page-client.tsx",
    "app/product/compiled-world/page.tsx",
    "app/solutions/[slug]/page.tsx",
    "app/api/page.tsx",
    "app/evidence/page.tsx",
    "app/enterprise/page.tsx",
    "app/product/document-understanding/page.tsx",
    "app/knowledge-compiler/page.tsx",
    "app/resources/page.tsx",
  ];

  it.each(A1_SURFACES)("publishes no retired PDF-locator wording in %s", (surface) => {
    const copy = read(surface).replace(/\/\*[\s\S]*?\*\//g, " ").toLowerCase();
    for (const phrase of RETIRED_LOCATOR_WORDING) {
      expect(copy, `RESOLVED A-1 retires "${phrase}"`).not.toContain(phrase);
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

  it.each(TRUST_PAGES)("%s ends on its own step of the §17 trust sequence", (surface, href) => {
    const source = read(surface);
    expect(source, `${surface} must render the shared next step`).toContain("TrustNext");
    expect(source, `${surface} must name itself, not another page's position`)
      .toContain(`from="${href}"`);
  });

  it("gives every step of the trust sequence a precise next action", () => {
    const source = read("components/trust-next.tsx");
    // Every href declared in the order must also have an action, or a page renders an empty CTA.
    const steps = [...source.matchAll(/href: "([^"]+)"/g)].map((match) => match[1]!);
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
  it("names only files the exporter actually writes on /developers", () => {
    const page = read("app/developers/page.tsx");
    const exporter = read("lib/collection-download.ts");
    const extras = page.match(/const PACKAGE_EXTRAS = \[([\s\S]*?)\n\] as const;/);
    expect(extras, "the extra-file list is still declared on the page").not.toBeNull();
    const paths = [...extras![1]!.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(exporter, `lib/collection-download.ts never writes ${path}`).toContain(`"${path}"`);
    }
    expect(page, "the required paths come from the exporter, not a second list")
      .toContain("REQUIRED_PACKAGE_PATHS");
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
    "components/home-page-client.tsx",
    "components/pricing-page-client.tsx",
    "app/sources/page.tsx",
    "app/security/page.tsx",
    "app/evidence/page.tsx",
    "app/benchmarks/page.tsx",
    "app/research/page.tsx",
    "app/developers/page.tsx",
    "app/docs/page.tsx",
  ];

  it.each(CONVERSION_SURFACES)("uses no generic call to action in %s", (surface) => {
    const copy = read(surface).replace(/\/\*[\s\S]*?\*\//g, " ").toLowerCase();
    for (const generic of ["learn more", "read more", "find out more"]) {
      expect(copy, `§22 asks for the precise next action, not "${generic}"`).not.toContain(generic);
    }
  });

  /*
    §10.2's proof strip must stay proof rather than becoming a statistics row.

    A strip under a hero is where invented figures arrive: "10M pages compiled", "99.9% uptime",
    a customer count. §35 bars every one of them and none is measured here, so each item is a
    link to the page that substantiates it and the strip may carry no digit-bearing figure at
    all. This reads the rendered items, not the file, so a number added in any of them fails.
  */
  it("keeps the landing proof strip linked and free of invented figures", () => {
    const landing = read("components/home-page-client.tsx");
    const strip = landing.match(/<ul className="hero-proof"[\s\S]*?<\/ul>/);
    expect(strip, "the hero proof strip is still on the landing page").not.toBeNull();
    const items = [...strip![0].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((match) => match[1]!);
    expect(items.length, "§10.2 asks for the strip, not one item").toBeGreaterThanOrEqual(4);
    for (const item of items) {
      expect(item, "every proof item points at the page that substantiates it").toContain("href=");
      const text = item.replace(/<[^>]*>/g, "");
      expect(text, `"${text.trim()}" carries a figure; §35 bars invented metrics`)
        .not.toMatch(/[0-9]/);
    }
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
    "just OCR", "vector database", "exactly is a World", "relate to RAG", "verify an answer",
    "source document changes", "Office files", "agent use it", "uncertain", "data safe",
    "What is ready to use", "much does it cost", "setup is required", "locked in", "Can I export",
    "delete my data", "security review approve",
  ];

  const purchaseFaq = () =>
    read("components/pricing-page-client.tsx").match(/const PURCHASE_FAQ[\s\S]*?\n\];/)?.[0] ?? "";

  it.each(PURCHASE_OBJECTIONS)("answers the §54 objection about %s on /pricing", (objection) => {
    const faq = purchaseFaq();
    expect(faq, "the §54 answers are still declared on the pricing page").not.toBe("");
    expect(faq).toContain(objection);
  });

  it("points every §54 answer at the page that maintains it", () => {
    const rows = [...purchaseFaq().matchAll(/^ {2}\[".*\],$/gm)].map((match) => match[0]);
    expect(rows.length, "§54 lists seventeen objections").toBe(17);
    for (const row of rows) {
      expect(row, `${row.slice(0, 40)}… answers without offering the page that says it in full`)
        .toMatch(/"\/[a-z/-]+" as Route/);
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
  it("puts three job cards under the locked hero, each pointing at a real solution", () => {
    const landing = read("components/home-page-client.tsx");
    const jobs = landing.match(/const JOBS = \[([\s\S]*?)\n\] as const;/);
    expect(jobs, "the job cards are still declared on the landing page").not.toBeNull();
    const hrefs = [...jobs![1]!.matchAll(/href: "([^"]+)" as Route/g)].map((match) => match[1]!);
    expect(hrefs, "B01 asks for one card per job, not a single door").toHaveLength(3);

    const solutions = read("app/solutions/[slug]/page.tsx");
    for (const href of hrefs) {
      const slug = href.replace("/solutions/", "");
      expect(solutions, `${href} is linked from the hero and is not a solution slug`)
        .toContain(`"${slug}": {`);
    }
    const bodies = [...jobs![1]!.matchAll(/body: "([^"]*)"/g)].map((match) => match[1]!);
    expect(bodies).toHaveLength(3);
    for (const body of bodies) {
      expect(body, `"${body.slice(0, 40)}…" carries a figure; §35 bars invented metrics`)
        .not.toMatch(/[0-9]/);
    }
  });

  /*
    Audit B06, added deliberately with the caption under the compile film.

    Four evidence levels share this page and the film is the one a visitor is most likely to read
    as a screen recording of the product. The rule above keeps the *fixture* disclosure off the
    landing page, which is a different thing: it bars importing `DISCLOSURE.fixture`, a defensive
    paragraph about a demo world. This asserts one sentence separating a directed recreation from
    the working interface, which is the affirmative version of the same job.
  */
  it("says the compile film is a recreation and points at the working interface", () => {
    const landing = read("components/home-page-client.tsx");
    expect(landing).toContain("directed recreation of a compile, not a screen recording");
    /*
      The pointer without its label, which is the only part of this that changed at integration.

      It pinned `label="See the working interface"`, and that collided with the other rule about
      this page: landing.spec.ts requires every unqualified /explore link to read "Explore a
      Compiled World", and a link carrying its own wording has to be a named proof (?act=...).
      Two merged lanes disagreeing about one element, and the label lost -- it pointed at the
      working interface in general, which is what the door already is.

      What this test is for is untouched. `btn ghost` is the 44px control, and the failure it was
      written against is a link inside the 14px `.fine` caption, which is about 18px tall under a
      coarse pointer. That is still exactly what it asserts.
    */
    expect(landing, "and the pointer is a 44px control, not a link in fine print")
      .toContain(String.raw`<ExploreLink className="btn ghost" />`);
  });

  /*
    Audit B02. Five solution pages answered the same reader. Each now declares who it is for, as
    a field, so the label cannot drift from the copy under it and a new solution cannot ship
    without one.
  */
  it("gives every solution page an audience", () => {
    const solutions = read("app/solutions/[slug]/page.tsx");
    const slugs = [...solutions.matchAll(/^ {2}"([a-z-]+)": \{\r?$/gm)].map((match) => match[1]!);
    const audiences = [...solutions.matchAll(/^ {4}audience: "([^"]+)",\r?$/gm)].map((match) => match[1]!);
    expect(slugs.length).toBeGreaterThanOrEqual(5);
    expect(audiences, "every solution declares its reader").toHaveLength(slugs.length);
    expect(solutions, "and the page renders it").toContain("For: {solution.audience}");
  });

  /*
    Audit E04 / G06. The Apple sample's representativeness limit, and the take-away asset, both
    at the demo rather than two pages away from it.
  */
  it("states what the Apple sample does not represent, next to the sample", () => {
    const stage = read("components/explore/explore-stage.tsx");
    expect(stage).toContain("Apple&apos;s own public SEC filings");
    expect(stage, "the limit names the four things it does not represent")
      .toContain("not a claim about a mixed internal corpus");
    expect(stage, "and the reproducible asset is reachable from the demo")
      .toContain('href="/reproducibility"');
  });
});

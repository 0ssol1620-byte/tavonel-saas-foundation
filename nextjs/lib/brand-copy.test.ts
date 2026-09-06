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
  "components/rebuild-console.tsx",
  "components/world-explorer.tsx",
  "app/login/page.tsx",
  "app/not-found.tsx",
  "app/error.tsx",
  "lib/capabilities.ts",
  "lib/checkout-intent.ts",
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
    expect(page).toContain("Document page");
    expect(page).toContain("Exact bbox");
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
});

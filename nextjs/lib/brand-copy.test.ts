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
  "components/film-band.tsx",
  "components/compile-stage.tsx",
  "app/film/page.tsx",
  "app/research/page.tsx",
  "app/developers/page.tsx",
  "app/pricing/page.tsx",
  "app/product/page.tsx",
  "app/product/knowledge-compiler/page.tsx",
  "app/product/document-understanding/page.tsx",
  "app/product/compiled-world/page.tsx",
  "app/product/continuous-knowledge/page.tsx",
  "app/enterprise/page.tsx",
];

const BARRED = [
  "unlock your data",
  "second brain",
  "100% accurate",
  "never hallucinates",
  "better than rag",
  "ai brain",
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

function landingSource(): string {
  return `${read("app/page.tsx")}\n${read("components/home-page-client.tsx")}`;
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

  it("still says on the landing page that the demonstration is fictional", () => {
    // The disclosure is the counterweight to nine scenes of invented figures. If it is ever
    // edited away, the page starts reading as a record of a real run.
    const disclosure = read("lib/demo-world.ts");
    expect(disclosure).toContain("fictional demonstration data");
    expect(disclosure).toContain("not a recording of a compiler run");
    expect(landingSource()).toContain("DISCLOSURE.fixture");
  });

  it("still labels the two unshipped capabilities as directions", () => {
    // The grid moved from app/page.tsx into lib/capabilities.ts so its fail-closed behaviour could
    // be tested. This assertion follows it: the rule is about the two labels, not their address.
    const grid = read("lib/capabilities.ts");
    expect(grid).toContain('state: "Direction"');
    expect(grid).toContain("Knowledge architecture");
    expect(grid).toContain("Selective recompilation");
    expect(landingSource()).toContain("readCapabilities");
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

  it("keeps the locked hero line and a one-line lede", () => {
    const page = landingSource();
    expect(page).toContain("Compile your knowledge");
    expect(page).toContain("into a world AI can reason about.");
    expect(page).toContain("Files go in. A world an AI can cite comes out.");
  });

  it("puts the locked hero proof and three motion cuts on the landing page", () => {
    const page = landingSource();
    expect(page).toContain("/film/poster-1.webp");
    expect(page).toContain("/film/compile-cut-2.mp4");
    expect(page).toContain("/film/compile-cut-3.mp4");
    expect(page).toContain("/film/compile-cut-4.mp4");
  });

  it("does not wrap the films in a clickable link", () => {
    const band = read("components/film-band.tsx");
    expect(band).not.toContain("href");
    expect(band).not.toContain("CanvasTransitionLink");
    expect(landingSource()).not.toMatch(/FilmBand[\s\S]{0,200}href=/);
  });

  /*
    Every band on the landing page goes through FilmBand.

    The hero was twice rewritten as a hand-written <video> — once for an LCP experiment, once in
    a server-component split — and both times it lost the playback logic that lives in
    FilmBand: the observer, the resume on visibility change, the resume on decoder stall. The
    other cuts hide that failure because scrolling back to them restarts them; the hero is on
    screen from load, crosses its loop point untouched, and simply freezes.

    It also carried inline `aspectRatio: 1280 / 800` describing a resolution the masters no
    longer have, which overrode the stylesheet's viewport-fitting rules from an attribute.
  */
  it("renders every landing film through FilmBand, never a hand-written video element", () => {
    for (const file of ["app/page.tsx", "components/home-page-client.tsx"]) {
      // Comments in these files discuss the <video> element by name, so the check is run
      // against the source with comments stripped — otherwise it fails on its own rationale.
      const source = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(source, `${file} must not hand-roll a <video>`).not.toMatch(/<video[\s>]/);
      expect(source, `${file} must not inline an aspect ratio`).not.toContain("aspectRatio");
    }
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
    const cuts = ["compile-cut", "compile-cut-2", "compile-cut-3", "compile-cut-4"];
    // Both the 4:4:4 master and its 4:2:0 fallback: a client that cannot decode High 4:4:4
    // Predictive gets the second file, and it must not be a lower resolution.
    for (const name of [...cuts, ...cuts.map((c) => `${c}-420`)]) {
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

  it("gives every film band a poster file that actually exists", () => {
    const page = landingSource();
    const posters = [...page.matchAll(/\b(?:poster|src)="(\/film\/poster-[^"]+)"/g)]
      .map((match) => match[1]);
    expect(posters.length).toBeGreaterThanOrEqual(4);
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

  it("names the artifacts that leave the compiler", () => {
    // The films show the compile. What a buyer cannot see in a loop is what they receive,
    // and that is the difference between this and a retrieval index.
    const page = landingSource();
    expect(page).toContain("ontology.ttl");
    expect(page).toContain("graph.csv");
    expect(page).toContain("provenance");
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

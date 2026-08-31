import { readFileSync } from "node:fs";
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
    expect(read("app/page.tsx")).toContain("DISCLOSURE.fixture");
  });

  it("still labels the two unshipped capabilities as directions", () => {
    // The grid moved from app/page.tsx into lib/capabilities.ts so its fail-closed behaviour could
    // be tested. This assertion follows it: the rule is about the two labels, not their address.
    const grid = read("lib/capabilities.ts");
    expect(grid).toContain('state: "Direction"');
    expect(grid).toContain("Knowledge architecture");
    expect(grid).toContain("Selective recompilation");
    expect(read("app/page.tsx")).toContain("readCapabilities");
  });

  it("names each scene the same way in the eyebrow and the instrument bar", () => {
    const page = read("app/page.tsx");
    const barLabels = [...page.matchAll(/\{ id: \d+, label: "([^"]+)"/g)].map((m) => m[1]);
    const eyebrows = [...page.matchAll(/eyebrow="([^"]+)"/g)].map((m) => m[1]);

    expect(barLabels.length).toBeGreaterThan(1);
    for (const label of barLabels.slice(1)) {
      expect(eyebrows, `scene "${label}" must use its bar label as its eyebrow`).toContain(label);
    }
  });

  it("keeps the locked hero line and a one-line lede", () => {
    const page = read("app/page.tsx");
    expect(page).toContain("Compile your knowledge");
    expect(page).toContain("into a world AI can reason about.");
    expect(page).toContain("Files go in. A world an AI can cite comes out.");
  });

  it("puts the three locked compile cuts on the landing page", () => {
    const page = read("app/page.tsx");
    expect(page).toContain("/film/compile-cut.mp4");
    expect(page).toContain("/film/compile-cut-2.mp4");
    expect(page).toContain("/film/compile-cut-3.mp4");
  });

  it("does not wrap the films in a clickable link", () => {
    const band = read("components/film-band.tsx");
    expect(band).not.toContain("href");
    expect(band).not.toContain("CanvasTransitionLink");
    expect(read("app/page.tsx")).not.toMatch(/FilmBand[\s\S]{0,200}href=/);
  });

  it("does not restage widgets the films already show", () => {
    const page = read("app/page.tsx");
    expect(page).not.toContain("ReadingDemo");
    expect(page).not.toContain("CompilePipeline");
    expect(page).not.toContain("RebuildConsole");
    expect(page).not.toContain("ChangeLattice");
    expect(page).not.toContain("IdentityResolve");
  });

  it("names the artifacts that leave the compiler", () => {
    // The films show the compile. What a buyer cannot see in a loop is what they receive,
    // and that is the difference between this and a retrieval index.
    const page = read("app/page.tsx");
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

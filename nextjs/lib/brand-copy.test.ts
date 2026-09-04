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
  "components/compile-stage-vector-film.tsx",
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

/*
  The landing page is four files now.

  Scene 3 owns one stage player. The player owns stage selection and timing while the vector film
  owns the visible proof surface. Keeping both in the landing source means public-copy rules apply
  to the text a visitor actually sees, not just to the wrapper around it.
*/
function landingSource(): string {
  return [
    read("app/page.tsx"),
    read("components/home-page-client.tsx"),
    read("components/compile-stage-player.tsx"),
    read("components/compile-stage-vector-film.tsx"),
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

  it("keeps the locked source-grounded hero and concise lede", () => {
    const page = landingSource();
    expect(page).toContain("Turn documents and connected systems");
    expect(page).toContain("into a source-grounded world your AI can use.");
    expect(page).toContain("TAVONEL reads difficult sources");
    expect(page).toContain("evidence back to the page.");
  });

  it("keeps the legacy motion masters addressable while the landing uses vector proof", () => {
    const page = landingSource();
    expect(page).toContain("/film/poster-1.webp");
    expect(page).toContain("/film/compile-cut-2.mp4");
    expect(page).toContain("/film/compile-cut-3.mp4");
    expect(page).toContain("/film/compile-cut-4.mp4");
    expect(page).toContain("CompileStageVectorFilm");
  });

  it("does not wrap the films in a clickable link", () => {
    const player = read("components/compile-stage-player.tsx");
    expect(player).not.toContain("href");
    expect(player).not.toContain("CanvasTransitionLink");
  });

  /*
    One player owns the landing proof, and scene files hand-roll no raster playback.

    The visible stage used to depend on a video/canvas master whose tiny raster type could look
    soft when the frame was enlarged. The landing renderer is now DOM + SVG: the browser shapes
    text and geometry at the device's native scale. Legacy MP4s remain addressable for dedicated
    film surfaces, but they are not the visible renderer inside the landing stage player.
  */
  it("keeps every landing film inside the stage player as resolution-independent vector proof", () => {
    for (const file of ["app/page.tsx", "components/home-page-client.tsx"]) {
      const source = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(source, `${file} must not hand-roll a <video>`).not.toMatch(/<video[\s>]/);
      expect(source, `${file} must not hand-roll a <canvas>`).not.toMatch(/<canvas[\s>]/);
      expect(source, `${file} must not inline an aspect ratio`).not.toContain("aspectRatio");
    }

    const player = read("components/compile-stage-player.tsx");
    expect(player).toContain("CompileStageVectorFilm");
    expect(player).toContain('data-film-renderer="vector-dom-svg"');
    expect(player, "the landing player must not rasterize its visible proof through video").not.toMatch(/<video[\s>]/);
    expect(player, "the landing player must not rasterize its visible proof through canvas").not.toMatch(/<canvas[\s>]/);

    const vector = read("components/compile-stage-vector-film.tsx");
    expect(vector, "the vector film must contain SVG geometry").toContain("<svg");
    expect(vector, "the vector film must not embed a raster video/canvas/image surface")
      .not.toMatch(/<(?:video|canvas|img)[\s>]/);
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
    expect(player, "reduced motion disables automatic stage cycling").toContain("prefers-reduced-motion");
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
    The legacy masters remain 2x for the dedicated film surfaces and as archival fallbacks.
    They are no longer the landing's visible proof renderer, but keeping their dimensions pinned
    prevents a future route from silently reintroducing the original 1440-wide upscale problem.
  */
  it("keeps the legacy compile masters at 2x", () => {
    const film = join(root, "public", "film");
    for (const name of ["compile-cut", "compile-cut-2", "compile-cut-3", "compile-cut-4"]) {
      const file = join(film, `${name}.mp4`);
      expect(existsSync(file), `${name}.mp4 is missing`).toBe(true);
      const bytes = readFileSync(file);
      const at = bytes.indexOf(Buffer.from("tkhd"));
      expect(at, `${name}.mp4 has no tkhd box`).toBeGreaterThan(0);
      expect(bytes[at + 4], `${name}.mp4 is not a version-0 tkhd`).toBe(0);
      const width = bytes.readUInt32BE(at + 80) >> 16;
      const height = bytes.readUInt32BE(at + 84) >> 16;
      expect(`${name}: ${width}x${height}`).toBe(`${name}: 2880x1800`);
    }
  });

  it("gives every legacy film stage a poster file that actually exists", () => {
    const page = landingSource();
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
    expect(stage).not.toMatch(/from ["']@\/lib\/demo-world["']/);
    expect(stage).not.toContain("SOURCE_CENSUS");
  });
});

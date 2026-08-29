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
  "components/rebuild-console.tsx",
  "lib/demo-world.ts",
];

const BARRED = [
  "unlock your data",
  "second brain",
  "100% accurate",
  "never hallucinates",
  "better than rag",
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
    const page = read("app/page.tsx");
    expect(page).toContain('state: "Direction"');
    expect(page).toContain("Knowledge architecture");
    expect(page).toContain("Selective recompilation");
  });
});

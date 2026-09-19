import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { LANDING_V2_IMAGES } from "./landing-v2-assets";

/*
  The design record has to still describe the code.

  `docs/LANDING_V2_2026-09-19.md` is canonical for `/` and `/ko`, and a canonical document that
  has quietly fallen behind the tree is worse than none: the next person reads it, believes the
  inventory, and builds against a component that no longer exists or misses one that does. The
  three checks below are the ones a reviewer cannot make by reading the diff -- that every
  landing component and every landing data module is named in the record, that the README still
  points a reader at it, and that the document it supersedes says so on its own first screen.

  This is a completeness check, not a prose check. It says a name appears; it cannot say the
  sentence around the name is true. What it does buy is that adding
  `components/landing-v2/scenes/<new>.tsx` and shipping it undocumented fails here, at the same
  moment as the code review, rather than months later when someone trusts the list.

  PATHS. The record and the README both live above `nextjs/`: `nextjs/README.md` links out to
  `../docs/`, which `nextjs/README.md` has named as the canonical location since before this
  landing. So the repository root is two levels up from this file.
*/

const packageRoot = join(import.meta.dirname, "..");
const repoRoot = join(packageRoot, "..");

const RECORD = join(repoRoot, "docs", "LANDING_V2_2026-09-19.md");
const SUPERSEDED = join(repoRoot, "docs", "UI_ARCHITECTURE_2026-08-29.md");
const README = join(packageRoot, "README.md");

const record = readFileSync(RECORD, "utf8");

/** Every `.ts`/`.tsx` file under `components/landing-v2`, as a path relative to that folder. */
function landingComponents(): string[] {
  const root = join(packageRoot, "components", "landing-v2");
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return /\.tsx?$/.test(entry.name) ? [relative(root, full).split(sep).join("/")] : [];
    });
  return walk(root).sort();
}

/** The landing's data modules: `lib/landing-v2-*.ts`, tests excluded. */
function landingModules(): string[] {
  return readdirSync(join(packageRoot, "lib"))
    .filter((name) => /^landing-v2-.+\.ts$/.test(name) && !name.endsWith(".test.ts"))
    .sort();
}

describe("the Landing V2 design record", () => {
  it("exists, and is a record rather than a stub", () => {
    expect(record.length, "docs/LANDING_V2_2026-09-19.md").toBeGreaterThan(4000);
    expect(record).toContain("# TAVONEL Landing V2 — design record");
  });

  it("names every component the entry pages render", () => {
    const components = landingComponents();
    // The walk has to be finding the folder at all, or an empty list would pass vacuously.
    expect(components.length).toBeGreaterThan(15);
    const missing = components.filter((path) => !record.includes(path.replace(/^.*\//, "")));
    expect(missing, "components in the tree that the design record does not name").toEqual([]);
  });

  it("names every landing data module", () => {
    const modules = landingModules();
    expect(modules).toContain("landing-v2-copy.ts");
    const missing = modules.filter((name) => !record.includes(name));
    expect(missing, "lib/landing-v2-* modules the design record does not name").toEqual([]);
  });

  it("is what the README sends a reader to for the entry pages", () => {
    const readme = readFileSync(README, "utf8");
    expect(readme).toContain("docs/LANDING_V2_2026-09-19.md");
    // And the older document is still named, because it is still canonical for the workspace.
    expect(readme).toContain("docs/UI_ARCHITECTURE_2026-08-29.md");
  });

  it("is declared on the first screen of the document it supersedes", () => {
    /*
      A superseding pointer buried at the bottom is a pointer nobody follows. The status line of
      the 2026-08-29 record is where a reader decides whether to keep reading, so that is where
      the exception for `/` and `/ko` has to be.
    */
    const head = readFileSync(SUPERSEDED, "utf8").split("\n").slice(0, 12).join("\n");
    expect(head).toContain("LANDING_V2_2026-09-19.md");
  });
});

describe("the committed image derivatives", () => {
  /*
    The reverse of `landing-v2-assets.test.ts`'s coverage case.

    That test fails when a region the hero or the proof scenes resolve to has no derivative.
    This one fails the other way: a file sitting in `public/landing/v2/` that the manifest does
    not list is a byte nothing can reach and nothing can verify -- left behind by a render set
    that changed, and shipped to every visitor's CDN edge for as long as it stays.
  */
  it("holds no file the manifest does not account for", () => {
    const declared = new Set(
      LANDING_V2_IMAGES.flatMap((image) => image.outputs.map((output) => output.src.split("/").pop()!)),
    );
    declared.add("manifest.json");
    const onDisk = readdirSync(join(packageRoot, "public", "landing", "v2"));
    expect(onDisk.length).toBeGreaterThan(declared.size - 2);
    const orphans = onDisk.filter((name) => !declared.has(name));
    expect(orphans, "derivatives on disk that no manifest entry claims").toEqual([]);
  });
});

/**
 * Four counts the public sample World actually holds, for the strip under the home hero.
 *
 * Gap #9 of `NO1_COMPETITOR_VISUAL_GAP_2026-09-22.md`: every competitor puts a headline number
 * above the fold, and this site put none. The difference between theirs and this one is that
 * every figure below is recomputed from the compiled artifact on each build -- `hero-stats.test.ts`
 * derives all four a second way and fails on any drift -- and each one links to the surface a
 * reader can go and count it on.
 *
 * SERVER ONLY, for `lib/evidence-regions.ts`'s reason: it reads the compiled public World.
 *
 * Four rules, all of them the repository's own:
 *
 *   1. **Nothing is rounded and nothing is estimated.** `1,281` is a thousand separator and not
 *      "over 1,000"; there is no "+", no "~" and no order-of-magnitude headline here.
 *   2. **Every rate carries its denominator.** Pages is two numbers -- what this World compiled
 *      and what the filings contain -- because §57 already refused a UI that prints only one.
 *   3. **A World-scale count, never a throughput claim.** §7.1 of the gap document: the manifest
 *      caps a source at 5 MB and 80 pages, so no figure here may read as a capacity, a rate or a
 *      "large documents are fine" implication. These are what one published World contains.
 *   4. **A digest is not a score.** The fourth entry is the manifest digest of the artifact the
 *      other three were counted from, so the strip names the thing it counted rather than
 *      inviting a reader to trust three loose numbers.
 */

import { EXPLORE_SAMPLE_DIGEST, exploreSampleDocuments, exploreSampleWorld } from "./explore-sample";
import { toVisualWorldModel } from "./visual-world-model";

export type HeroStat = Readonly<{
  /** Stable key, so the test names a row rather than an index. */
  id: "filings" | "pages" | "regions" | "digest";
  /** The figure as it is printed. Grouped with thousands separators; never abbreviated. */
  value: string;
  /** Where a reader goes to count it themselves. */
  href: string;
  /** True for the digest, which is a name rather than a quantity. */
  mono: boolean;
}>;

const world = toVisualWorldModel(exploreSampleWorld, exploreSampleDocuments);

const group = (value: number) => value.toLocaleString("en-US");

/**
 * How many pages this World compiled, and how many the filings behind it contain.
 *
 * `compiledPageCount` falls back to `pageCount` only when a document record omits it, which is
 * the same rule `components/explore/*` uses; the sample's records all carry both today.
 */
const pages = exploreSampleDocuments.reduce(
  (total, document) => ({
    compiled: total.compiled + (document.compiledPageCount ?? document.pageCount),
    filed: total.filed + document.pageCount,
  }),
  { compiled: 0, filed: 0 },
);

export const HERO_STATS: readonly [HeroStat, HeroStat, HeroStat, HeroStat] = [
  {
    id: "filings",
    value: group(exploreSampleDocuments.length),
    href: "/explore?act=world",
    mono: false,
  },
  {
    id: "pages",
    value: `${group(pages.compiled)} / ${group(pages.filed)}`,
    href: "/explore?act=world",
    mono: false,
  },
  {
    id: "regions",
    value: group(world.totals.regions),
    href: "/explore?act=evidence",
    mono: false,
  },
  {
    /* The first eight hex characters, which is the prefix every other surface on this site
       prints a digest by. The whole 64 are on /explore's technical details, which is where
       this links. */
    id: "digest",
    value: EXPLORE_SAMPLE_DIGEST.replace(/^sha256:/, "sha256 ").slice(0, 15),
    href: "/explore?act=world",
    mono: true,
  },
];

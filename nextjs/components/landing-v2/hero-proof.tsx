import Link from "next/link";
import type { Route } from "next";
import RegionHighlight from "@/components/evidence/region-highlight";
import { sampleEvidencePage } from "@/lib/evidence-regions";
import { HERO_PROOF_COPY } from "@/lib/hero-proof-copy";
import { HERO_STATS } from "@/lib/hero-stats";

/*
  The home hero's working surface: a live Evidence Inspector, and four counts under it.

  Gaps #1 and #9 of `NO1_COMPETITOR_VISUAL_GAP_2026-09-22.md`. Six of seven competitors put a
  real product surface or a real document above the fold; this hero put a film of one. The film
  is not deleted -- it moves down to Scene 02, "How it compiles", which is the "how it works"
  position it was always explaining -- and what takes its place is the thing itself, on the public
  sample World, with no login and no form in front of it.

  WHY IT REUSES `RegionHighlight` RATHER THAN DRAWING A HERO VERSION
  The component /evidence and /product/document-understanding already share is exactly this
  panel: a committed page raster resolved by the source's own sha256, the compiler's own
  `bbox1000` boxes over it as real buttons, and the excerpt and locator of whichever one the
  reader is on. A second, hero-shaped copy of it would be a drawing of the first within a week.
  What this file adds is the hero's frame, its caption, and the stat strip.

  NO CANVAS, AT ANY WIDTH
  The panel is an `<img>`, absolutely positioned `<button>`s and text. There is no canvas, no
  WebGL, no rAF loop and no animation in it or under it -- `hero-proof.test.ts` asserts that over
  the rendered markup and over the module graph -- so the "no live canvas below ~900px" rule is
  not satisfied by a fallback here, it is satisfied by there being nothing to fall back from. What
  changes below 900px is layout only: `app/landing-v2.css` gives the strip one column and
  `region-highlight.module.css` stacks the page above its excerpt at 880px, so a phone gets the
  server-rendered first region as a static panel and no extra bytes.

  SERVER-RENDERED FIRST REGION
  `RegionHighlight` selects region 1 in its initial state, so the excerpt, the locator and the
  source line are in the HTML before any script runs. A reader with JavaScript off reads a real
  passage bound to a real page; a reader with it on can move through the other nine.

  WHAT THIS PANEL MUST NOT DO, and does not
  It renders no table, no row and no cell -- the capability manifest records
  `no_table_or_formula_extraction` -- and the word "accuracy" appears nowhere in it or in the
  copy module behind it. Both are asserted rather than remembered.
*/

/*
  The view, resolved once per process. `sampleEvidencePage()` is pure over a World frozen at
  build time, and `/` and `/ko` are `force-dynamic` for the commercial posture -- so without
  this the page would re-derive it on every request to the two most-visited routes, for the same
  answer. The same reasoning `landing-page.tsx` gives for its own memo.
*/
const view = sampleEvidencePage();

/** The raster the hero paints first, so `app/page.tsx` can preload the one image above the fold. */
export const HERO_PROOF_IMAGE: string | null = view.image?.src ?? null;

export default function HeroProof({ korean = false }: { korean?: boolean }) {
  const copy = HERO_PROOF_COPY[korean ? "ko" : "en"];
  return (
    <div className="lv2-hero-proof">
      <div className="lv2-hero-inspector">
        <RegionHighlight
          view={view}
          caption={copy.caption}
          /*
            The figcaption below the raster already names the filename, the representation and
            the page out of its page count, so an alt repeating them makes a screen reader read
            the same line twice. `lib/landing-v2-page.test.ts` separately bars a digit in any alt
            on this page, and a page number is a digit.
          */
          imageAlt=""
          imageEager
        />
      </div>
      <ul className="lv2-hero-stats" aria-label={copy.stripLabel}>
        {HERO_STATS.map((stat, index) => (
          <li key={stat.id}>
            <Link href={stat.href as Route}>
              <span className="lv2-hero-stat-value" data-mono={stat.mono ? "1" : undefined} data-derived="1">
                {stat.value}
              </span>
              <span className="lv2-hero-stat-label">{copy.stats[index]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

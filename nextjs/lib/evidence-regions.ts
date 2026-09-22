/**
 * One page of the public sample World, with every evidence region this World read out of it.
 *
 * `components/evidence/region-highlight.tsx` draws what this returns. Both exist because two
 * marketing pages were describing evidence binding in prose beside an empty column, while the
 * product already had the real thing: a committed render of a filing page and the compiler's own
 * per-mille boxes over it.
 *
 * SERVER ONLY, for the reason `lib/landing-v2-proof.ts` gives: this reads the compiled public
 * World. `evidence-regions.test.ts` fails if a `"use client"` file imports it.
 *
 * Four rules it follows, all of them rules this repository already has:
 *
 *   1. **Real coordinates or nothing.** The boxes are `bbox1000` as the compiler stored them.
 *      Nothing here invents, rounds or nudges a coordinate, and a region whose box is not a
 *      drawable box is dropped rather than repaired.
 *   2. **Never draw a page that was not rendered.** The image is a committed raster resolved by
 *      the source's own sha256 and page number. When there is no raster for a page, the view
 *      carries `image: null` and the reason, and the component draws a neutral frame that says
 *      so. It never draws a document-looking rectangle.
 *   3. **Paragraphs and boxes, never cells.** The capability manifest records
 *      `no_table_or_formula_extraction`, so nothing here exposes a cell, a row, a column or a
 *      table structure, and the component renders no grid. A region is a rectangle on a page and
 *      an excerpt of text, which is exactly what the compiler has.
 *   4. **The excerpt is the source's own text.** Trimmed at a word boundary with the truncation
 *      marked, by `excerptPreview`, which is what /explore already does. Never rewritten.
 */

import { excerptPreview } from "./explore-entry-proof";
import { exploreSampleDocuments, exploreSampleWorld } from "./explore-sample";
import { isSourceRegionBox } from "./source-region-box";
import { sourcePageQualifier, sourcePageRaster } from "./source-page-rasters";
import { toVisualWorldModel } from "./visual-world-model";

export type EvidenceRegionView = Readonly<{
  id: string;
  /** [x0, y0, x1, y1] in per mille of the page, as the compiler recorded it. */
  bbox1000: readonly [number, number, number, number];
  excerpt: string;
  excerptTruncated: boolean;
  /** The locator a reader can quote back: page, box and the digest of the bytes it was read from. */
  locator: string;
  /** Where /explore opens this exact region. */
  href: string;
}>;

export type EvidencePageView = Readonly<{
  source: Readonly<{
    filename: string;
    digest: string;
    page: number;
    pageCount: number;
    /** "original PDF" or "reference render" -- which bytes the page is a picture of. */
    qualifier: string;
  }>;
  /** The committed render of the page, or null with a reason when none is published. */
  image: Readonly<{ src: string; width: number; height: number }> | null;
  imageAbsentReason: string | null;
  regions: readonly EvidenceRegionView[];
}>;

const EXCERPT_LIMIT = 320;

const world = toVisualWorldModel(exploreSampleWorld, exploreSampleDocuments);

function viewOf(region: (typeof world.evidence)[number]): EvidenceRegionView | null {
  if (!isSourceRegionBox(region.bbox1000)) return null;
  const preview = excerptPreview(region.excerpt.trim(), EXCERPT_LIMIT);
  return {
    id: region.id,
    bbox1000: region.bbox1000,
    excerpt: preview.text,
    excerptTruncated: preview.truncated,
    locator: `p.${region.page} of ${region.pageCount} · bbox ${region.bbox1000.join(",")} (per mille) · ${region.digest}`,
    href: `/explore?act=evidence&evidence=${encodeURIComponent(region.id)}`,
  };
}

/**
 * The page of the sample World with the most regions on it that also has a committed render.
 *
 * "Most regions" is the selection rule because the component's subject is that a page carries
 * several bound passages, and a page with one box demonstrates the mechanism less than a page
 * with four. It is a presentation choice over a fixed corpus and never a ranking of quality,
 * confidence or correctness.
 *
 * When no page in this World has both, the function still returns a view -- of the page with the
 * most regions, with `image: null` and the reason. A caller never has to decide whether to draw
 * something; the component states the absence.
 */
export function sampleEvidencePage(): EvidencePageView {
  const byPage = new Map<string, typeof world.evidence>();
  for (const region of world.evidence) {
    const key = `${region.digest}#${region.page}`;
    byPage.set(key, [...(byPage.get(key) ?? []), region]);
  }

  const candidates = [...byPage.values()]
    .map((regions) => ({ regions, raster: sourcePageRaster(regions[0]!.digest, regions[0]!.page) }))
    .sort((a, b) => {
      /* A page with a render first, then the page carrying the most regions, then by id so the
         choice is the same on every build rather than dependent on Map insertion order. */
      if (Boolean(a.raster) !== Boolean(b.raster)) return a.raster ? -1 : 1;
      if (a.regions.length !== b.regions.length) return b.regions.length - a.regions.length;
      return a.regions[0]!.id < b.regions[0]!.id ? -1 : 1;
    });

  const chosen = candidates[0];
  if (!chosen) throw new Error("evidence_regions_world_has_no_region");

  const first = chosen.regions[0]!;
  const regions = chosen.regions
    .map(viewOf)
    .filter((region): region is EvidenceRegionView => region !== null);
  if (regions.length === 0) throw new Error(`evidence_regions_no_drawable_box: ${first.id}`);

  return {
    source: {
      filename: first.filename,
      digest: first.digest,
      page: first.page,
      pageCount: first.pageCount,
      qualifier: sourcePageQualifier(first.representationKind),
    },
    image: chosen.raster
      ? { src: chosen.raster.file, width: chosen.raster.width, height: chosen.raster.height }
      : null,
    imageAbsentReason: chosen.raster
      ? null
      : "page image not published for this sample",
    regions,
  };
}

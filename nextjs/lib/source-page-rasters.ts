/**
 * The committed rasters of the source pages the public proof block opens on, and the one noun
 * the whole site uses for that artefact.
 *
 * Two things live here because they are the same thing seen twice. `scripts/render-source-pages.mjs`
 * writes `public/explore-sample/pages/pages.manifest.json` -- a render of a committed source PDF,
 * keyed by that PDF's own sha256 and the page number -- and every surface that shows it used to
 * invent its own name for it: reference render, source render, page render, original page, source
 * page, reference page. Six names for one artefact is how a reader stops believing any of them.
 *
 * The raster is the first paint, never the proof. `components/world-visual/original-source-page.tsx`
 * still fetches the committed PDF, hashes it and paints it with PDF.js; what a picture cannot do is
 * check its own bytes, so the live reader stays and the raster only removes the blank frame a
 * reader used to look at while the 1 MB fetch ran -- and the blank frame it left behind when the
 * fetch failed.
 *
 * A page with no committed raster is normal: /explore can open any of the World's regions and only
 * the pages a shipped proof pick uses are rendered ahead of time. The lookup returns null and the
 * surface falls back to the live reader alone.
 */
import manifest from "@/public/explore-sample/pages/pages.manifest.json";

export type SourcePageRaster = {
  /** Public path of the full-page render. */
  file: string;
  width: number;
  height: number;
  sha256: string;
  /** sha256 of the source PDF this was rendered from -- the same digest the compiler recorded. */
  sourceSha256: string;
  page: number;
};

export type SourceRegionRaster = {
  file: string;
  width: number;
  height: number;
  sha256: string;
  bbox1000: readonly number[];
};

/**
 * One noun for the page artefact, and one qualifier for the bytes behind it.
 *
 * `representationKind` is a fact about the committed bytes, not a second name: four of the five
 * filings are deterministic renders of the SEC HTML primary document rather than an issuer PDF,
 * and that distinction is carried as a qualifier on the same noun.
 */
export const SOURCE_PAGE_NOUN = "Source page" as const;

/*
  n34: the noun and the qualifier in the one other language this site publishes. `korean` is
  optional and false is the English this function already returned, so no English surface moves.
*/
export function sourcePageLabel(representationKind?: string, korean?: boolean): string {
  if (korean) return representationKind === "reference_render" ? "원문 페이지 · 기준 렌더" : "원문 페이지";
  return representationKind === "reference_render" ? "Source page · reference render" : SOURCE_PAGE_NOUN;
}

export function sourcePageQualifier(representationKind?: string, korean?: boolean): string {
  if (korean) return representationKind === "reference_render" ? "기준 렌더" : "원본 PDF";
  return representationKind === "reference_render" ? "reference render" : "original PDF";
}

export function sourcePageRaster(sourceSha256: string, page: number): SourcePageRaster | null {
  const entry = manifest.pages.find((item) => item.sourceSha256 === sourceSha256 && item.page === page);
  if (!entry) return null;
  return {
    file: entry.file,
    width: entry.width,
    height: entry.height,
    sha256: entry.sha256,
    sourceSha256: entry.sourceSha256,
    page: entry.page,
  };
}

/**
 * How many raster pixels stand for one page pixel in a region crop. The region files are rendered
 * at `regionScale` times the 1400px page width so a zoomed reader stays sharp; a surface that shows
 * a crop at page scale divides its width by this, or the statement header on
 * /product/document-understanding reads as 40px display type.
 */
export const REGION_SCALE: number = manifest.regionScale;

export function sourceRegionRaster(
  sourceSha256: string,
  page: number,
  bbox1000: readonly number[],
): SourceRegionRaster | null {
  const entry = manifest.pages.find((item) => item.sourceSha256 === sourceSha256 && item.page === page);
  const region = entry?.regions.find((item) => item.bbox1000.join(",") === bbox1000.join(","));
  return region ? { file: region.file, width: region.width, height: region.height, sha256: region.sha256, bbox1000: region.bbox1000 } : null;
}

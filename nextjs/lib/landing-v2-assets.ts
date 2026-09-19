import manifest from "@/public/landing/v2/manifest.json";

/**
 * The Landing V2 image derivatives, looked up by the source they came from.
 *
 * `scripts/build-landing-v2-assets.mjs` writes `public/landing/v2/manifest.json`: for each
 * committed page raster it emits, at a few widths, a WebP and an AVIF of the whole page or of one
 * per-mille region, and records the sha256 of the source raster and of every file it wrote. This
 * module is the read side, and it is deliberately the only one -- a component that built its own
 * `/landing/v2/...` path by string concatenation would be one rename away from a broken image
 * with a correct-looking `src`.
 *
 * The key is the fact, not a name: a page is addressed by the source PDF's sha256 and the page
 * number -- the same pair `lib/source-page-rasters.ts` uses -- and a region by that pair plus its
 * bbox. So `lib/landing-v2-hero.ts` and `lib/landing-v2-proof.ts` ask for the region they
 * resolved out of the compiled World, and a region with no derivative returns `null` rather than
 * a guess. `landing-v2-assets.test.ts` fails when a region either module resolves to is missing,
 * so the script's render set cannot silently fall behind the modules.
 */

export type LandingV2Output = {
  bytes: number;
  format: string;
  height: number;
  sha256: string;
  src: string;
  width: number;
};

export type LandingV2Image = {
  kind: "page" | "region";
  /** Public path of the committed raster this was cut from. */
  source: string;
  /** sha256 of the source PDF, as the compiler recorded it. */
  sourceSha256: string;
  page: number;
  /** The per-mille box, for a region derivative; `null` for a whole page. */
  bbox1000: number[] | null;
  /** Intrinsic size of the largest WebP -- what a `width`/`height` pair on the element states. */
  width: number;
  height: number;
  /** The largest WebP, as the `src` fallback beside the two source sets. */
  src: string;
  /** `srcSet` for WebP, ascending by width. */
  srcSet: string;
  /** `srcSet` for AVIF, or an empty string when the encoder produced none. */
  avifSrcSet: string;
  outputs: LandingV2Output[];
};

/** Whether the build emitted AVIF at all. False means every set below is WebP only. */
export const LANDING_V2_AVIF: boolean = manifest.avif;

function setOf(outputs: LandingV2Output[], format: string): string {
  return outputs
    .filter((output) => output.format === format)
    .sort((left, right) => left.width - right.width)
    .map((output) => `${output.src} ${output.width}w`)
    .join(", ");
}

function build(entry: (typeof manifest.entries)[number]): LandingV2Image {
  const outputs = [...entry.outputs] as LandingV2Output[];
  const webp = outputs.filter((output) => output.format === "webp").sort((left, right) => left.width - right.width);
  const largest = webp[webp.length - 1];
  if (!largest) throw new Error(`landing_v2_asset_has_no_webp: ${entry.source}`);
  return {
    kind: entry.kind === "region" ? "region" : "page",
    source: entry.source,
    sourceSha256: entry.sourceSha256,
    page: entry.page,
    bbox1000: "bbox1000" in entry ? [...(entry as { bbox1000: number[] }).bbox1000] : null,
    width: largest.width,
    height: largest.height,
    src: largest.src,
    srcSet: setOf(outputs, "webp"),
    avifSrcSet: setOf(outputs, "avif"),
    outputs,
  };
}

export const LANDING_V2_IMAGES: readonly LandingV2Image[] = manifest.entries.map(build);

/** The whole-page derivative set for one page of one source, or `null` if none was emitted. */
export function landingV2PageImage(sourceSha256: string, page: number): LandingV2Image | null {
  return (
    LANDING_V2_IMAGES.find(
      (image) => image.kind === "page" && image.sourceSha256 === sourceSha256 && image.page === page,
    ) ?? null
  );
}

/** The region crop for one per-mille box on one page, or `null` if none was emitted. */
export function landingV2RegionImage(
  sourceSha256: string,
  page: number,
  bbox1000: readonly number[],
): LandingV2Image | null {
  const key = bbox1000.join(",");
  return (
    LANDING_V2_IMAGES.find(
      (image) =>
        image.kind === "region" &&
        image.sourceSha256 === sourceSha256 &&
        image.page === page &&
        image.bbox1000?.join(",") === key,
    ) ?? null
  );
}

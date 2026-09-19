import SourceRegion from "./source-region";

/*
  The source page: a committed raster of a real filing page, with the read region drawn on it.

  No image is generated here and none is styled to look like a document -- §21 allows exactly
  three kinds of pixel on this landing and this is the first of them, a resize of a page
  `scripts/render-source-pages.mjs` rendered from the committed PDF. `lib/landing-v2-assets.ts`
  resolved the derivative by the source digest and page number, so the bytes and the metadata
  beside them cannot drift apart.

  WebP only, deliberately, even though the build also emits AVIF. The hero image is the one
  resource the page preloads, and a `<picture>` with an AVIF source makes the preload a guess:
  it either has to carry `type="image/avif"` (and be skipped, unpreloaded, where the type is not
  honoured) or it preloads bytes the browser then declines to use. One format, one `<img>`, one
  `<link rel="preload">` that is always the resource the layout paints. The AVIF set stays in the
  manifest for a surface that is not the LCP element.

  Alt text carries no figure (contract rule 4): the form, the date, the page number and the
  region coordinates are `[data-derived]` metadata beside the image, where a reader can see what
  each number counts.
*/
export default function SourcePage({
  src,
  srcSet,
  sizes,
  width,
  height,
  alt,
  bbox1000,
  regionLabel,
  priority = false,
  children,
}: {
  src: string;
  srcSet: string;
  sizes: string;
  width: number;
  height: number;
  alt: string;
  bbox1000?: readonly number[];
  regionLabel?: string;
  /** The hero's page is the LCP candidate; every other use of this is below the fold. */
  priority?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <span className="lv2-page lv2-document">
      {/* eslint-disable-next-line @next/next/no-img-element -- the derivative is already sized and
          hashed by scripts/build-landing-v2-assets.mjs; the loader would re-encode committed bytes. */}
      <img
        className="lv2-page-img"
        src={src}
        srcSet={srcSet}
        sizes={sizes}
        width={width}
        height={height}
        alt={alt}
        decoding="async"
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
      />
      {bbox1000 ? <SourceRegion bbox1000={bbox1000} label={regionLabel} /> : null}
      {children}
    </span>
  );
}


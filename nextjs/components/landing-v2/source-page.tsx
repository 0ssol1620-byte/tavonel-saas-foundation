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

/** The whole image, as a per-mille box: the strip below IS the region, so its outline is its edge. */
const WHOLE_IMAGE: readonly number[] = [0, 0, 1000, 1000];

/**
 * The READ strip: the committed crop of one region, drawn large enough to be read.
 *
 * The hero's key visual since the 2026-09-19 recomposition (§22, §43). It is the same committed
 * bytes as the page thumbnail beside it -- `scripts/build-landing-v2-assets.mjs` cuts the crop
 * out of that page raster rather than re-rendering it -- at the width that makes the filing's own
 * sentences legible instead of a grey texture. §22 allows exactly this: a crop at the level where
 * the content is understood.
 *
 * WHY THERE ARE TWO <img> AND NOT ONE.
 * The crop is about eight times wider than it is tall. Across a 708px stage that is a readable
 * strip; across a 350px phone it is six-pixel glyphs, which is a picture of a document rather
 * than a document. So on a phone the same crop is re-flowed as two stacked halves: the second
 * element is the same resource with `object-position: 100%`, so the browser fetches one file and
 * paints it twice, and nothing has to be dragged or scrolled to read the far end of the line.
 * Above 768 the second half is not rendered at all and the first shows the whole crop.
 *
 * `--lv2-read-half-ar` is that half's shape, written here rather than typed into the sheet: it
 * is the derivative's own intrinsic width over its height, halved, so a re-render at a different
 * crop cannot leave the stylesheet holding the old proportion. The phone rule uses it with
 * `object-fit: cover` to take the half by painting instead of by laying the element out at twice
 * the column -- which is what used to put a 680px box inside a 350px viewport (QA round 4).
 *
 * The second half carries an empty alt -- it is the same picture continued, and a screen reader
 * that read the description twice would be describing two documents.
 */
export function SourceStrip({
  src,
  srcSet,
  sizes,
  width,
  height,
  alt,
  priority = false,
}: {
  src: string;
  srcSet: string;
  sizes: string;
  width: number;
  height: number;
  alt: string;
  priority?: boolean;
}) {
  const half = (which: "a" | "b") => (
    /* eslint-disable-next-line @next/next/no-img-element -- the derivative is already sized and
       hashed by scripts/build-landing-v2-assets.mjs; the loader would re-encode committed bytes. */
    <img
      className={`lv2-read-img lv2-read-img--${which}`}
      src={src}
      srcSet={srcSet}
      sizes={sizes}
      width={width}
      height={height}
      alt={which === "a" ? alt : ""}
      decoding="async"
      loading={priority ? "eager" : "lazy"}
      /* One resource, two elements, and only one of them may claim the priority: `fetchPriority`
         on both would be the page telling the browser it has two most-important images. */
      fetchPriority={priority && which === "a" ? "high" : undefined}
    />
  );
  return (
    <span
      className="lv2-read-frame lv2-document"
      /* CSP `style-src-elem 'self'` bars a <style> element; a style ATTRIBUTE is allowed (rule 9). */
      style={{ "--lv2-read-half-ar": `${width / 2 / height}` } as React.CSSProperties}
    >
      {half("a")}
      {half("b")}
      {/*
        No accessible name on this box, deliberately. §4.1's coordinate label is rendered as the
        strip's own caption, in text, right underneath -- giving the outline the same string as an
        `aria-label` would read the coordinate twice and describe the box as a second image.
      */}
      <SourceRegion bbox1000={WHOLE_IMAGE} className="lv2-region--strip" />
    </span>
  );
}

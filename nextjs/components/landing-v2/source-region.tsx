import { isSourceRegionBox } from "@/lib/source-region-box";

/*
  The Source Region (blueprint §4.1, §22), as a design primitive.

  A 1px Source Blue outline over the exact box a passage was read from, with a 6% fill -- §22's
  4-7% band -- drawn by a pseudo-element rather than by a translucent colour literal, so the
  border stays at full strength and the sheet keeps to tokens.

  The box arrives as `bbox1000`: four per-mille coordinates of the page, which is what the
  compiler stored. Per mille converts to a percentage by dividing by ten, and the raster behind
  it is the whole page, so the mapping is exact at every rendered size and needs no layout
  measurement. Nothing here rounds, and nothing here invents a coordinate: a region with no box
  is not drawn.

  Copy-free by design (D10). The label beside it belongs to the caller, which is the only place
  that knows whether the unit has already been stated.
*/
export default function SourceRegion({
  bbox1000,
  className = "",
  label,
}: {
  /** [x0, y0, x1, y1] in per mille of the page, as the compiler recorded it. */
  bbox1000: readonly number[];
  className?: string;
  /** The accessible name of the box, e.g. the assembled `SOURCE · 10-K · p.4 · [...]` string. */
  label?: string;
}) {
  if (!isSourceRegionBox(bbox1000)) return null;
  const [x0, y0, x1, y1] = bbox1000;
  return (
    <span
      className={`lv2-region ${className}`.trim()}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{
        left: `${x0! / 10}%`,
        top: `${y0! / 10}%`,
        width: `${(x1! - x0!) / 10}%`,
        height: `${(y1! - y0!) / 10}%`,
      }}
    />
  );
}


/*
  The same box cut out of the page instead of drawn on it (brief move 8), for the place beside a
  passage where a reader matches the extractor's text to the printed lines it came from.

  No new pixels, no canvas and no `<img>`: the committed page raster the caller already serves is
  the element's background, sized and positioned so only `bbox1000` shows. A background has no
  box of its own, so nothing overflows and nothing has to be clipped. The element keeps the box's
  true aspect (box width x raster width over box height x raster height), so nothing is stretched;
  it takes the width it is given, capped so a tall box never grows past `maxHeight`. The record's
  coordinates are written back as `data-bbox1000`.

  Background percentages: a size of 1000/w per mille of the page puts the page at the right scale,
  and a position p% places the image's p% point on the box's p% point, so the box's left edge lands
  on x0 when p = x0 / (1000 - w). A box spanning the full width has nothing to offset (p = 0).

  DISPLAY MARGIN
  The extractor's box is tight: on the Home page its bottom edge runs through the last printed row.
  So the window shown is the box grown by `marginPx` raster pixels on every side (clamped to the
  page), and everything above -- size, position, aspect -- is computed on that window. The margin
  is part of the picture, so it scales with the crop at every width. It is display only: the record's
  box is still what `data-bbox1000` says, and the window shown is written as `data-crop1000`.

  Hidden from assistive technology: the passage beside it is the same content as text.
*/
/** Raster pixels shown around the record's box, at the page raster's own 1x scale. */
export const CROP_MARGIN_PX = 16;

export function SourceRegionCrop({
  src,
  width,
  height,
  bbox1000,
  maxHeight = "12rem",
  marginPx = CROP_MARGIN_PX,
  className,
}: {
  /** The committed page raster -- the same file the page view serves, not a derivative. */
  src: string;
  width: number;
  height: number;
  bbox1000: readonly number[];
  maxHeight?: string;
  /** Display-only margin in raster pixels; never changes the cited box. */
  marginPx?: number;
  className?: string;
}) {
  if (!isSourceRegionBox(bbox1000)) return null;
  const mx = (1000 * marginPx) / width;
  const my = (1000 * marginPx) / height;
  const x0 = Math.max(0, bbox1000[0]! - mx);
  const y0 = Math.max(0, bbox1000[1]! - my);
  const x1 = Math.min(1000, bbox1000[2]! + mx);
  const y1 = Math.min(1000, bbox1000[3]! + my);
  const w = x1 - x0;
  const h = y1 - y0;
  const aspect = (w * width) / (h * height);
  const at = (start: number, span: number) => (span === 1000 ? 0 : (100 * start) / (1000 - span));
  return (
    <span
      className={className}
      aria-hidden="true"
      data-derived="1"
      data-bbox1000={bbox1000.join(",")}
      data-crop1000={[x0, y0, x1, y1].join(",")}
      style={{ display: "flex", alignItems: "center" }}
    >
      <span
        style={{
          display: "block",
          width: "100%",
          maxWidth: `calc(${maxHeight} * ${aspect})`,
          aspectRatio: String(aspect),
          backgroundImage: `url(${JSON.stringify(src)})`,
          backgroundRepeat: "no-repeat",
          backgroundSize: `${100000 / w}% ${100000 / h}%`,
          backgroundPosition: `${at(x0, w)}% ${at(y0, h)}%`,
        }}
      />
    </span>
  );
}

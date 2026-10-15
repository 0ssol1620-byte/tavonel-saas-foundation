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

  No new pixels and no canvas: it is the page raster the caller already serves, positioned so only
  `bbox1000` shows. The per-mille box maps to percentages exactly as above, and the crop keeps the
  box's true aspect (box width x raster width over box height x raster height), so nothing is
  stretched. The frame fills whatever height its row gives it and centres the crop; the crop takes
  the frame's width, capped so a tall box never grows past `maxHeight`. The coordinates are written
  back onto the frame as `data-bbox1000`, the record's own numbers.

  Hidden from assistive technology: the passage beside it is the same content as text.
*/
export function SourceRegionCrop({
  src,
  width,
  height,
  bbox1000,
  maxHeight = "12rem",
  className,
}: {
  /** The committed page raster -- the same file the page view shows, not a derivative. */
  src: string;
  width: number;
  height: number;
  bbox1000: readonly number[];
  maxHeight?: string;
  className?: string;
}) {
  if (!isSourceRegionBox(bbox1000)) return null;
  const [x0, y0, x1, y1] = bbox1000;
  const boxWidth = x1 - x0;
  const boxHeight = y1 - y0;
  const aspect = (boxWidth * width) / (boxHeight * height);
  return (
    <span
      className={className}
      aria-hidden="true"
      data-derived="1"
      data-bbox1000={bbox1000.join(",")}
      style={{ display: "flex", alignItems: "center" }}
    >
      <span
        style={{
          position: "relative",
          display: "block",
          overflow: "hidden",
          width: "100%",
          maxWidth: `calc(${maxHeight} * ${aspect})`,
          aspectRatio: String(aspect),
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a committed raster, positioned rather than re-encoded */}
        <img
          src={src}
          width={width}
          height={height}
          alt=""
          loading="lazy"
          decoding="async"
          style={{
            position: "absolute",
            maxWidth: "none",
            width: `${100000 / boxWidth}%`,
            height: `${100000 / boxHeight}%`,
            left: `${(-100 * x0) / boxWidth}%`,
            top: `${(-100 * y0) / boxHeight}%`,
          }}
        />
      </span>
    </span>
  );
}

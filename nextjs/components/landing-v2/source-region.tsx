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

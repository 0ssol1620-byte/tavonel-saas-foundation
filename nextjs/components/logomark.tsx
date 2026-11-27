import mark from "@/lib/brand-mark.json";

/**
 * The V34 blueprint mark: a dark green tile turned -12 degrees with a lime pill in its middle.
 *
 * The blueprint draws it in CSS (`route_preview/assets/site.css`, `.mark` and `.mark:after`). Its base
 * rule is 35 x 35, but the cascade that renders on every page ends at 31 x 31 (30 on a phone), radius 10,
 * `#142b23`, rotated -12deg, holding an 11 x 19 pill, radius 5, `#c9f2a5`; this is that rendered geometry.
 * This is that geometry as inline SVG so it scales to the header, footer, workspace and empty-state
 * sizes without a second drawing. `size` is the tile's layout box, as the CSS `width` is; the turned
 * tile overhangs it by about 3px a side, as it does in the blueprint, so the SVG does not clip.
 *
 * Both colours are fixed, not `currentColor`: the lime pill sits on the deep green tile on a paper
 * header and on a dark ground alike, so there is no inverse to define. `lib/brand-mark.json` is the
 * one source `public/icon.svg`, the favicons, the apple icon and the share cards are drawn from.
 *
 * Decorative by default, because the wordmark sits beside it. Pass `label` where it stands alone.
 */
export default function Logomark({ size = 24, label, className }: { size?: number; label?: string; className?: string }) {
  const { tile, pill, rotate } = mark;
  const centre = tile.size / 2;
  return (
    <svg
      className={className ? `logomark ${className}` : "logomark"}
      viewBox={mark.viewBox}
      width={size}
      height={size}
      overflow="visible"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <g transform={`rotate(${rotate} ${centre} ${centre})`}>
        <rect width={tile.size} height={tile.size} rx={tile.radius} fill={tile.fill} />
        <rect x={pill.x} y={pill.y} width={pill.width} height={pill.height} rx={pill.radius} fill={pill.fill} />
      </g>
    </svg>
  );
}

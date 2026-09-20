import mark from "@/lib/brand-mark.json";

/**
 * LOCUS: a source page with its corner cut, and the one box on it that a compiled sentence can
 * point back to.
 *
 * Adopted 2026-09-18 (landing replan; the candidates and their 16/24/32/64/160px renders are in
 * `site-review-0915/reports/landing-0918/marks-candidates.png`). It replaces A-06's two pages and
 * thread, which at 16px merged into one grey blob and needed two opacities to hold its depth. This
 * mark is two elements, two stroke weights, no opacity, and it says the product's promise in the
 * product's own nouns: the page, and the region on it.
 *
 * Geometry, on a 24 grid: the page is 15 x 17 with its corner cut from (14.5,3.5) to (19.5,7) --
 * 35 degrees, the site's own diagonal (DESIGN_MASTER_V3 §8.1), not the file icon's 45. The inner
 * mark is the bottom-left corner of the evidence box: a 4-unit rise and a 5.5-unit rule, kept at
 * least 2.25 units (1.5px at 16px) from every page edge so it never touches the frame. Strokes
 * are 2.5 for the page and 2.0 for the box. Both take `currentColor`: a brand mark carries no
 * state colour (BA-230), and it has to survive one-colour reproduction, greyscale and a blur.
 */
export default function Logomark({ size = 20 }: { size?: number }) {
  return (
    <svg
      className="logomark"
      viewBox={mark.viewBox}
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="square"
      aria-hidden="true"
    >
      {mark.paths.map(path => <path key={path.d} d={path.d} strokeWidth={path.strokeWidth} />)}
    </svg>
  );
}

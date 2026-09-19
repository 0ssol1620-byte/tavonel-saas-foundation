/*
  The Evidence Line (blueprint §4.1), as a design primitive.

  One hairline that says a compiled object came from a source region, and nothing else. It is a
  1px column rather than an SVG path for a reason that outlives this landing: a `<div>` with a
  background scales correctly at every width without a viewBox to keep in step with the layout
  around it, and `scaleY` from the top is the whole of the "draw" animation. An SVG line would
  need `vector-effect="non-scaling-stroke"` and a second set of coordinates to stay 1px.

  Token-only and copy-free (D10), so the product can reuse it: the caller positions it and says
  which semantic colour it carries. It carries no meaning of its own -- the caller's markup says
  what the two ends are.
*/
export default function EvidenceLine({
  className = "",
  tone = "source",
}: {
  className?: string;
  /** Which semantic relation the line stands for. Blue = source, violet = relation (§5.2). */
  tone?: "source" | "relation";
}) {
  return <span aria-hidden="true" className={`lv2-line lv2-line--${tone} ${className}`.trim()} />;
}

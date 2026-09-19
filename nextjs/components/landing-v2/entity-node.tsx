import Link from "next/link";
import type { Route } from "next";

/*
  One object the compiler bound to the region the hero is showing, with the relation that reaches
  it.

  `via` AND `predicate` ARE BOTH ON THE ROW, and that is the honesty condition of this beat.
  `lib/landing-v2-hero.ts` draws the candidates from the Document node's edges, because the
  compiled Claim carries exactly one relation in this World and a Structure beat drawn from the
  Claim's own edges alone would be a single grey box. Drawing them from the document is only
  honest while the markup says which node each relation actually leaves, on every row: one label
  above three rows is the first thing a layout hides, which is what an earlier QA round measured
  when the revision panel covered it.

  `title` carries the caveat the object's own kind deserves. The Entity labels in this fixed
  sample come from a capitalised-token heuristic and /explore publishes that fact in
  `EXPLORE_COPY.entityDisclaimer`; a chip that showed one of them with no caveat anywhere would
  be the landing making a stronger claim about the compiler than the product does.

  A link rather than a chip. The objects are in the World act of /explore, the destination is
  real, and a focusable element that navigates nowhere is a tab stop that owes the reader
  something it does not have.
*/
export default function EntityNode({
  label,
  kind,
  predicate,
  via,
  href,
  title,
}: {
  label: string;
  kind: string;
  /** The compiler's own predicate, spelled as it is stored: `mentions_entity`. */
  predicate: string;
  /** The node this relation leaves, so a relation is never attributed upward to the Claim. */
  via: string;
  href: string;
  /** The caveat this object's kind carries in the product, where it carries one. */
  title?: string;
}) {
  return (
    <Link className="lv2-node" href={href as Route} prefetch={false} title={title}>
      <span className="lv2-node-label">{label}</span>
      <span className="lv2-node-meta lv2-meta">
        {/* A filing label carries its filing date, so the origin is a measured value like the rest. */}
        <span className="lv2-node-via" data-derived="1">
          {via}
        </span>
        {" · "}
        <b className="lv2-node-rel">{predicate.replace(/_/g, " ")}</b>
        {" · "}
        {kind}
      </span>
    </Link>
  );
}

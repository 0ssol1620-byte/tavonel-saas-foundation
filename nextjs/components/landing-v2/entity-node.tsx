import Link from "next/link";
import type { Route } from "next";

/*
  One object the compiler bound to the same filing, with the relation that reaches it.

  `via` AND `predicate` ARE BOTH ON THE ROW, and that is the honesty condition of this beat.
  `lib/landing-v2-hero.ts` widened the candidate set to the Document node's edges, because the
  compiled Claim carries one relation in this World and a Structure beat drawn from the Claim's
  own edges alone would be a single grey box. Widening it is only honest while the markup says
  which node each relation actually leaves. It was stated once for the whole group until this
  round, which was wrong twice over: candidates from both anchors are sorted together before the
  slice, so a mixed set is possible even where this corpus does not currently produce one -- and
  one label above three rows is the first thing a layout hides, which is what the QA round
  measured when the revision panel covered it.

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
}: {
  label: string;
  kind: string;
  /** The compiler's own predicate, spelled as it is stored: `discusses_topic`. */
  predicate: string;
  /** The node this relation leaves, so a relation is never attributed upward to the Claim. */
  via: string;
  href: string;
}) {
  return (
    <Link className="lv2-node" href={href as Route} prefetch={false}>
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

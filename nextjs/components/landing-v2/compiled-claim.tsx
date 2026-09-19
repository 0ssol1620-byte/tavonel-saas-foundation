import Link from "next/link";
import type { Route } from "next";

/*
  The compiled object the source region states, as the reader meets it first.

  It is a link, not a card: the one thing a visitor should be able to do with a compiled claim is
  open the evidence behind it, and making that a real `<a>` is also what puts the §4.1 signature
  interaction on the keyboard path -- focusing this link runs the same state that hovering it
  does, because the CSS reads `:focus-visible` alongside `:hover`.

  The state word is passed in rather than derived. `lib/visual-world-model.ts` gives every object
  of this deterministic public sample the state `candidate`, which the product names PUBLISHED
  SAMPLE; a component that mapped states to words itself would be a second vocabulary for a fact
  the World already spells. The colour is not the carrier either -- the word is beside the dot.
*/
export default function CompiledClaim({
  kind,
  state,
  stateLabel,
  excerpt,
  truncated,
  href,
  className = "",
}: {
  kind: string;
  /*
    The World's own state and the World's own word for it. Both, because the colour is chosen
    from the state rather than from the tone of the sentence around it: a deterministic public
    sample is a published sample, not a verification, so it is not painted mint. See the
    data-state rules in app/landing-v2.css.
  */
  state: string;
  stateLabel: string;
  excerpt: string;
  truncated: boolean;
  href: string;
  className?: string;
}) {
  return (
    <Link className={`lv2-claim lv2-panel ${className}`.trim()} href={href as Route} prefetch={false}>
      <span className="lv2-claim-head lv2-meta">
        <span className="lv2-claim-kind">{kind}</span>
        <span className="lv2-claim-state" data-state={state}>
          <i aria-hidden="true" />
          {stateLabel}
        </span>
      </span>
      <span className="lv2-claim-text">
        {excerpt}
        {truncated ? "…" : ""}
      </span>
    </Link>
  );
}

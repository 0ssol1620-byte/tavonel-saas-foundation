import type { ReactNode } from "react";

/**
 * The one small line above a heading.
 *
 * Four classes were doing this job — `.eyebrow`, `.slate`, `.kicker` and one-path's
 * `.one-path-eyebrow` — at four sizes, in two typefaces, with two separator syntaxes, above 108
 * headings. This component is the single emitter, and `app/tavonel.css` carries the single face:
 * sans, 12px, sentence case, no dot, no rule line.
 *
 * Two modes, and the distinction is what the line *is*, not how it should look:
 *
 * - a kicker names the section a reader is entering — `<Kicker>Review queue</Kicker>`;
 * - a state label reads a machine's state back — `<Kicker state>READY · 3</Kicker>` — and it is
 *   the only one of the two that stays monospace, because that is what monospace is for here.
 *
 * A kicker that restates the heading under it is deleted, not passed through this component.
 * Numbered kickers (`01 / …`) are gone with it: an ordinal means sequence, and sequence belongs
 * to a real step grid.
 */
export function Kicker({
  children,
  state = false,
  id,
}: {
  children: ReactNode;
  state?: boolean;
  id?: string;
}) {
  return (
    <p className={state ? "state-label" : "eyebrow"} id={id}>
      {children}
    </p>
  );
}

export default Kicker;

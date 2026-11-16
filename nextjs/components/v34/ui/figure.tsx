import type { ReactNode } from "react";
import { Tag, type TagKind } from "./tag";
import s from "./figure.module.css";

/**
 * A concept drawing or a screen, with its caption and a Tag that says what it is. `art` is an
 * inline SVG (or an img) the route supplies, with its own `role="img"` and label; this component
 * only frames it. A route's art is drawn for that route: the frame is shared, the drawing is not.
 * The frame is the one place besides the scroll table that clips overflow, because it is a media
 * crop and holds no text.
 */
export function Figure({ art, caption, kind = "Illustration", framed = true }: {
  art: ReactNode;
  caption: string;
  kind?: TagKind;
  /** The dark panel the split-hero drawings sit in. */
  framed?: boolean;
}) {
  return (
    <figure className={s.figure}>
      <div className={framed ? s.frame : s.bare}>{art}</div>
      <figcaption className={s.caption}>
        <Tag kind={kind} />
        <span className={s.text}>{caption}</span>
      </figcaption>
    </figure>
  );
}

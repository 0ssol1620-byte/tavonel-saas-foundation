import { useId, type ReactNode } from "react";
import { surfaceClass, type V34Surface } from "./surface";
import { Eyebrow, Lead } from "./text";
import s from "./section.module.css";

/**
 * One band of a page. `surface` picks one of the surface classes, which sets the colour and the
 * background together, so nothing in the band depends on what the band above it was.
 * `title` is an h2 and names the region; a band without one is an unnamed region and gets no label.
 */
export function Section({ surface = "paper", id, eyebrow, title, lead, children }: {
  surface?: V34Surface;
  id?: string;
  eyebrow?: string;
  title?: ReactNode;
  lead?: ReactNode;
  children?: ReactNode;
}) {
  const headingId = useId();
  return (
    <section id={id} className={`${surfaceClass(surface)} ${s.section}`} aria-labelledby={title ? headingId : undefined}>
      <div className={s.shell}>
        {title || eyebrow || lead ? (
          <header className={s.head}>
            <div className={s.headMain}>
              {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
              {title ? <h2 id={headingId} className={s.title}>{title}</h2> : null}
            </div>
            {lead ? <div className={s.headLead}><Lead>{lead}</Lead></div> : null}
          </header>
        ) : null}
        {children}
      </div>
    </section>
  );
}

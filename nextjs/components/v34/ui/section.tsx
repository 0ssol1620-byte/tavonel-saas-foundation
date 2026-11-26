import { useId, type ReactNode } from "react";
import { surfaceClass, type V34Surface } from "./surface";
import { Eyebrow, Lead } from "./text";
import s from "./section.module.css";

/**
 * One band of a page. `surface` picks one of the surface classes, which sets the colour and the
 * background together, so nothing in the band depends on what the band above it was.
 * `title` is an h2 and names the region; a band without one is an unnamed region and gets no label.
 * `aside` turns the band into two columns: the heading, the lead and the children on the left, the
 * aside on the right (a stacked column under 900px).
 * `className` is for a route to add one rule of its own to the band (Home defers its below-the-fold bands); it
 * is appended after the surface and band classes and changes no markup.
 */
export function Section({ surface = "paper", id, className, eyebrow, title, lead, aside, children }: {
  surface?: V34Surface;
  id?: string;
  className?: string;
  eyebrow?: string;
  title?: ReactNode;
  lead?: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  const headingId = useId();
  const head = title || eyebrow || lead ? (
    <header className={s.head}>
      <div className={s.headMain}>
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        {title ? <h2 id={headingId} className={s.title}>{title}</h2> : null}
      </div>
      {lead ? <div className={s.headLead}><Lead>{lead}</Lead></div> : null}
    </header>
  ) : null;
  return (
    <section id={id} className={`${surfaceClass(surface)} ${s.section}${className ? ` ${className}` : ""}`} aria-labelledby={title ? headingId : undefined}>
      <div className={s.shell}>
        {aside ? (
          <div className={s.split}>
            <div className={s.splitMain}>
              {head}
              {children}
            </div>
            <div className={s.splitAside}>{aside}</div>
          </div>
        ) : (
          <>
            {head}
            {children}
          </>
        )}
      </div>
    </section>
  );
}

import type { ReactNode } from "react";
import { surfaceClass } from "./surface";
import s from "./record-card.module.css";

const EXTERNAL = /^https?:\/\//;

/**
 * A source record: what kind of thing it is, its label, where the original lives and its status.
 * It sits on its own light panel and restates that panel's colours, so it reads the same on a
 * dark scene as on paper.
 */
export function RecordCard({ kind, label, as: Heading = "h3", source, status, children }: {
  kind: string;
  label: string;
  as?: "h3" | "h4";
  source?: { href: string; label: string };
  status?: string;
  children?: ReactNode;
}) {
  return (
    <article className={`${surfaceClass("nestedLight")} ${s.card}`}>
      <header className={s.top}>
        <p className={s.kind}>{kind}</p>
        {status ? <p className={s.status}>{status}</p> : null}
      </header>
      <Heading className={s.label}>{label}</Heading>
      {children ? <div className={s.body}>{children}</div> : null}
      {source ? (
        <p className={s.source}>
          {EXTERNAL.test(source.href)
            ? <a className={s.link} href={source.href} target="_blank" rel="noopener noreferrer">{source.label}<span className={s.visuallyHidden}> (opens in a new tab)</span></a>
            : <a className={s.link} href={source.href}>{source.label}</a>}
        </p>
      ) : null}
    </article>
  );
}

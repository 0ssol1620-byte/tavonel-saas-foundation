import type { ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import { surfaceClass } from "./surface";
import { Eyebrow } from "./text";
import s from "./article-layout.module.css";

export type ArticleBlock =
  | { readonly kind: "h2" | "h3" | "p" | "quote"; readonly text: string }
  | { readonly kind: "list"; readonly items: readonly string[] }
  | { readonly kind: "figure"; readonly node: ReactNode };

export interface ArticleSource {
  readonly label: string;
  readonly href: string;
  readonly note?: string;
}

const WORDS_PER_MINUTE = 220;

/** Words in the text blocks, divided by 220, rounded up, at least one minute. A figure counts as no words. */
export function articleReadMinutes(blocks: readonly ArticleBlock[]): number {
  const words = blocks.reduce((total, block) => {
    const text = block.kind === "figure" ? "" : block.kind === "list" ? block.items.join(" ") : block.text;
    return total + (text.trim() ? text.trim().split(/\s+/).length : 0);
  }, 0);
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

/**
 * A journal article: breadcrumb, h1, byline, date, a computed read time, an optional cover, the
 * body, and the numbered sources. The author is the organization, "TAVONEL", never a person. The
 * body is data (blocks) so prose has one stylesheet and the read time is counted from the words
 * that are actually printed. The article's JSON-LD is the page's job and uses the same strings.
 */
export function ArticleLayout({ title, dek, published, modified, author = "TAVONEL", breadcrumb, cover, blocks, sources }: {
  title: string;
  dek?: string;
  /** ISO date, YYYY-MM-DD. */
  published: string;
  modified?: string;
  author?: string;
  breadcrumb: readonly { href: string; label: string }[];
  cover?: ReactNode;
  blocks: readonly ArticleBlock[];
  sources: readonly ArticleSource[];
}) {
  const minutes = articleReadMinutes(blocks);
  return (
    <article className={`${surfaceClass("paper")} ${s.article}`} aria-labelledby="v34-title">
      <div className={s.column}>
        <nav aria-label="Breadcrumb">
          <ol className={s.crumbs}>
            {breadcrumb.map((crumb) => (
              <li key={crumb.href} className={s.crumb}>
                <Link className={s.crumbLink} href={crumb.href as Route} prefetch={false}>{crumb.label}</Link>
              </li>
            ))}
          </ol>
        </nav>
        <header className={s.head}>
          <Eyebrow>Journal</Eyebrow>
          <h1 id="v34-title" className={s.title}>{title}</h1>
          {dek ? <p className={s.dek}>{dek}</p> : null}
          <p className={s.byline}>
            <span>{author}</span>
            <time dateTime={published}>{formatDate(published)}</time>
            {modified && modified !== published ? <span>Updated <time dateTime={modified}>{formatDate(modified)}</time></span> : null}
            <span>{minutes} min read</span>
          </p>
        </header>
        {cover ? <div className={s.cover}>{cover}</div> : null}
        <div className={s.reader}>
        <div className={s.body}>
          {blocks.map((block, index) => {
            switch (block.kind) {
              case "h2": return <h2 key={index} className={s.h2}>{block.text}</h2>;
              case "h3": return <h3 key={index} className={s.h3}>{block.text}</h3>;
              case "p": return <p key={index} className={s.p}>{block.text}</p>;
              case "quote": return <blockquote key={index} className={s.quote}>{block.text}</blockquote>;
              case "list": return <ul key={index} className={s.list}>{block.items.map((item) => <li key={item} className={s.listItem}>{item}</li>)}</ul>;
              case "figure": return <div key={index} className={s.figure}>{block.node}</div>;
            }
          })}
        </div>
        {sources.length > 0 ? (
          <section className={s.sources} aria-labelledby="v34-sources">
            <h2 id="v34-sources" className={s.h2}>Sources</h2>
            <ol className={s.sourceList}>
              {sources.map((source) => (
                <li key={source.href} className={s.sourceItem}>
                  <a className={s.sourceLink} href={source.href} target="_blank" rel="noopener noreferrer">
                    {source.label}<span className={s.visuallyHidden}> (opens in a new tab)</span>
                  </a>
                  {source.note ? <span className={s.sourceNote}> {source.note}</span> : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}
        </div>
      </div>
    </article>
  );
}

import type { ReactNode } from "react";
import type { Route } from "next";
import Link from "next/link";
import { PublicSiteFooter, PublicSiteHeader } from "@/components/public-site-chrome";
import styles from "./public-proof-registry.module.css";

export type RegistryRow = { key: string; description: string; state: string };

/*
  BA-020. A record page needs an address for each record, and a way past the ones you did not
  come for.

  /knowledge-compiler was ten of these rows in sequence: 4,796px at 1280 and 7,284px at 390, no
  anchor on any section, nothing to skip with, and the first call to action at the very bottom.
  Three additions, every one optional, so `/reproducibility` renders exactly as it did:

    - every section takes a stable id, so it can be linked to and an index can point at it
    - `index` renders that index under the hero
    - `collapsed` puts a section's body in a `<details>`, which is what a glossary, an FAQ and a
      when-not-to-use-this list are -- reference a reader consults, not argument they read

  Native `<details>` rather than a state hook: the whole behaviour is open and closed, it needs
  no JavaScript, and the browser's own find-in-page reaches inside a closed one.
*/
const sectionId = (title: string) =>
  `section-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;

/**
 * The record layout used by the reproducibility and category pages.
 *
 * Two things were removed rather than restyled.
 *
 * Its own three-link nav pointed at /reproducibility, /benchmarks and /research/experiments,
 * both of the last two calling notFound() at the time, so the site was navigating visitors into
 * deliberate 404s from its own header. It now wears the standard chrome like every other public
 * page. (/benchmarks has since become a real page: it publishes the compilation benchmark
 * protocol and the receipt contract, and still shows no results table, because there are no
 * qualified records. /research/experiments is still a deliberate 404.)
 *
 * The `empty` panel rendered a large "NO QUALIFIED RECORDS" block whenever a section had
 * nothing in it. Publishing an empty table is not more honest than publishing no table; it is
 * a page about an absence. A section with nothing to show is now simply not shown, and the
 * `empty` prop is kept only so callers do not have to change.
 */
export default function PublicProofRegistry({ title, eyebrow, summary, state, index, sections, footer }: {
  title: string;
  eyebrow: string;
  summary: string;
  /** BA-020: render the section index under the hero. Off for a page short enough to read. */
  index?: boolean;
  /*
    The status badge is optional because it belongs to a proof registry, not to every page
    that reuses this shell. `/knowledge-compiler` is a category guide and the only indexed
    page here; it was carrying "CATEGORY DEFINITION - NOT A PERFORMANCE CLAIM" beside its
    own title, which answers an accusation nobody reading a category guide has made. The
    registries that do report a state -- benchmarks, customers, experiments -- still pass one.
  */
  state?: string;
  /*
    `figure`, `faq` and `links` exist for the category guide, which masterplan 13.11 asks to
    carry a comparison drawing, a glossary, a FAQ and a way onward. They are optional and the
    registries that report measurements pass none of them: a proof registry with a FAQ would be
    a proof registry arguing.
  */
  sections: Array<{
    title: string;
    body: string;
    rows?: RegistryRow[];
    empty?: string;
    download?: { href: string; label: string };
    figure?: ReactNode;
    faq?: Array<{ question: string; answer: string }>;
    links?: Array<{ href: Route; label: string }>;
    /** BA-019: references under the actions, as a list rather than as more buttons. */
    readNext?: Array<{ href: Route; label: string }>;
    /** BA-020: reference material, behind a disclosure rather than in the reading path. */
    collapsed?: boolean;
  }>;
  /*
    One next step under the body, for a page that is a step in a sequence rather than a terminus.

    `/reproducibility` sits in the middle of the §17 trust funnel and had no way onward at all.
    Every other page in that funnel ends with `TrustNext`; this is how a registry-shaped page
    gets the same ending without hand-writing the order a second time.
  */
  footer?: ReactNode;
}) {
  return <div className={styles.page}>
    <PublicSiteHeader />
    <main id="main">
      <section className={styles.hero}><div><p className={styles.eyebrow}>{eyebrow}</p><h1>{title}</h1></div><aside>{state ? <span className={styles.status}>{state}</span> : null}<p>{summary}</p></aside></section>
      <div className={styles.body}>
        {index ? (
          <nav className={styles.index} aria-label="On this page">
            <p>On this page</p>
            <ol>
              {sections.map((section) => (
                <li key={section.title}><a href={`#${sectionId(section.title)}`}>{section.title}</a></li>
              ))}
            </ol>
          </nav>
        ) : null}
        {sections.map((section) => {
          const body = <div className={styles.rowBody}>
            <p>{section.body}</p>
            {section.figure ? <figure className={styles.figure}>{section.figure}</figure> : null}
            {section.rows ? <ol className={styles.protocol}>{section.rows.map((row) => <li key={row.key}><b>{row.key}</b><span>{row.description}</span><em>{row.state}</em></li>)}</ol> : null}
            {section.faq ? <dl className={styles.faq}>{section.faq.map((entry) => <div key={entry.question}><dt>{entry.question}</dt><dd>{entry.answer}</dd></div>)}</dl> : null}
            {section.links ? <p className={styles.links}>{section.links.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}</p> : null}
            {section.readNext ? <div className={styles.readNext}><p>Read next</p><ul>{section.readNext.map((link) => <li key={link.href}><Link href={link.href}>{link.label}</Link></li>)}</ul></div> : null}
            {section.download ? <a className={styles.download} href={section.download.href} download>{section.download.label}</a> : null}
          </div>;
          return <section className={styles.row} id={sectionId(section.title)} key={section.title}>
            <h2>{section.title}</h2>
            {section.collapsed
              ? <details className={styles.disclosure}><summary>Open {section.title.toLowerCase()}</summary>{body}</details>
              : body}
          </section>;
        })}
      </div>
      {footer ? <div className={styles.body}>{footer}</div> : null}
    </main>
    <PublicSiteFooter />
  </div>;
}

import type { ReactNode } from "react";
import type { Route } from "next";
import Link from "next/link";
import { PublicSiteFooter, PublicSiteHeader } from "@/components/public-site-chrome";
import styles from "./public-proof-registry.module.css";

export type RegistryRow = { key: string; description: string; state: string };

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
export default function PublicProofRegistry({ title, eyebrow, summary, state, sections }: {
  title: string;
  eyebrow: string;
  summary: string;
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
  }>;
}) {
  return <div className={styles.page}>
    <PublicSiteHeader />
    <main id="main">
      <section className={styles.hero}><div><p className={styles.eyebrow}>{eyebrow}</p><h1>{title}</h1></div><aside>{state ? <span className={styles.status}>{state}</span> : null}<p>{summary}</p></aside></section>
      <div className={styles.body}>{sections.map((section) => <section className={styles.row} key={section.title}><h2>{section.title}</h2><div className={styles.rowBody}><p>{section.body}</p>{section.figure ? <figure className={styles.figure}>{section.figure}</figure> : null}{section.rows ? <ol className={styles.protocol}>{section.rows.map((row) => <li key={row.key}><b>{row.key}</b><span>{row.description}</span><em>{row.state}</em></li>)}</ol> : null}{section.faq ? <dl className={styles.faq}>{section.faq.map((entry) => <div key={entry.question}><dt>{entry.question}</dt><dd>{entry.answer}</dd></div>)}</dl> : null}{section.links ? <p className={styles.links}>{section.links.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}</p> : null}{section.download ? <a className={styles.download} href={section.download.href} download>{section.download.label}</a> : null}</div></section>)}</div>
    </main>
    <PublicSiteFooter />
  </div>;
}

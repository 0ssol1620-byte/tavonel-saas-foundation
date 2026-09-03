import { PublicSiteFooter, PublicSiteHeader } from "@/components/public-site-chrome";
import styles from "./public-proof-registry.module.css";

export type RegistryRow = { key: string; description: string; state: string };

/**
 * The record layout used by the reproducibility and category pages.
 *
 * Two things were removed rather than restyled.
 *
 * Its own three-link nav pointed at /reproducibility, /benchmarks and /research/experiments.
 * The last two call notFound() on purpose — there are no qualified benchmark records to publish
 * yet — so the site was navigating visitors into deliberate 404s from its own header. It now
 * wears the standard chrome like every other public page.
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
  sections: Array<{ title: string; body: string; rows?: RegistryRow[]; empty?: string; download?: { href: string; label: string } }>;
}) {
  return <div className={styles.page}>
    <PublicSiteHeader />
    <main id="main">
      <section className={styles.hero}><div><p className={styles.eyebrow}>{eyebrow}</p><h1>{title}</h1></div><aside>{state ? <span className={styles.status}>{state}</span> : null}<p>{summary}</p></aside></section>
      <div className={styles.body}>{sections.map((section) => <section className={styles.row} key={section.title}><h2>{section.title}</h2><div className={styles.rowBody}><p>{section.body}</p>{section.rows ? <ol className={styles.protocol}>{section.rows.map((row) => <li key={row.key}><b>{row.key}</b><span>{row.description}</span><em>{row.state}</em></li>)}</ol> : null}{section.download ? <a className={styles.download} href={section.download.href} download>{section.download.label}</a> : null}</div></section>)}</div>
    </main>
    <PublicSiteFooter />
  </div>;
}

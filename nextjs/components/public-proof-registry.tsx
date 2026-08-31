import Link from "next/link";
import Logomark from "@/components/logomark";
import styles from "./public-proof-registry.module.css";

export type RegistryRow = { key: string; description: string; state: string };

export default function PublicProofRegistry({ title, eyebrow, summary, state, sections }: {
  title: string;
  eyebrow: string;
  summary: string;
  state: string;
  sections: Array<{ title: string; body: string; rows?: RegistryRow[]; empty?: string; download?: { href: string; label: string } }>;
}) {
  return <div className={styles.page}>
    <header className={styles.nav}>
      <Link href="/" className={styles.wordmark} aria-label="TAVONEL home"><Logomark /><b>TAVONEL</b></Link>
      <nav aria-label="Proof registry"><a href="/reproducibility">Reproducibility</a><a href="/benchmarks">Benchmarks</a><a href="/research/experiments">Experiments</a></nav>
      <Link href="/explore">Explore sample</Link>
    </header>
    <main id="main">
      <section className={styles.hero}><div><p className={styles.eyebrow}>{eyebrow}</p><h1>{title}</h1></div><aside><span className={styles.status}>{state}</span><p>{summary}</p></aside></section>
      <div className={styles.body}>{sections.map((section) => <section className={styles.row} key={section.title}><h2>{section.title}</h2><div className={styles.rowBody}><p>{section.body}</p>{section.rows ? <ol className={styles.protocol}>{section.rows.map((row) => <li key={row.key}><b>{row.key}</b><span>{row.description}</span><em>{row.state}</em></li>)}</ol> : null}{section.empty ? <div className={styles.empty}><strong>NO QUALIFIED RECORDS</strong>{section.empty}</div> : null}{section.download ? <a className={styles.download} href={section.download.href} download>{section.download.label}</a> : null}</div></section>)}</div>
    </main>
  </div>;
}

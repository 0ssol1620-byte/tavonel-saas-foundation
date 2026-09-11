import type { Metadata, Route } from "next";
import Link from "next/link";
import { PublicPageShell } from "@/components/public-page-shell";
import PublicPrimaryCta from "@/components/public-primary-cta";
import { SOLUTIONS } from "./[slug]/page";
import styles from "./solutions.module.css";

export const metadata: Metadata = {
  title: "Solutions — TAVONEL",
  description:
    "Five documented uses of the compiler: who each one is for, the workflow it follows, what it leaves behind and where it stops.",
  alternates: { canonical: "/solutions" },
  openGraph: { url: "/solutions" },
};

/*
  The hub the top-level "Solutions" link was already promising.

  It pointed at /solutions/ai-ready-knowledge -- one of five pages, wearing the label of the
  whole section -- so a reader who wanted the graph page or the operations page landed on the
  RAG page and had to guess. Nothing here is new content: every card is read from the same
  `SOLUTIONS` record the detail pages render, so a solution cannot exist on one and be missing
  from the other, and the audience line cannot drift from the page it summarises.

  There is no sixth card. `technical-document-assistant` is named in the masterplan and has no
  route, and a hub that lists a destination the router answers with a 404 is worse than a hub
  that lists four.
*/

const ENTRIES = Object.entries(SOLUTIONS);

export default function SolutionsPage() {
  return (
    <PublicPageShell>
      <section className="scene doc"><div className="shell"><div className="body">
        <div className="stack">
          <p className="slate"><b>SOLUTIONS</b><span />TAVONEL</p>
          <h1 className="document-title">What people use<br />the compiler for.</h1>
        </div>
        <div className="stack">
          {/*
            What a solution page is, said before a reader opens one. Each describes a use the
            product is built for -- the workflow, the result and the limits -- written from the
            product's own behaviour. A named customer and their figures appear on this site only
            where that customer has agreed to publish them, and none of the five pages below is
            one of those.
          */}
          <p className="lede">
            Each page below is a described use: who it is for, the path from source to World, what
            the workflow leaves behind, and where it stops. A described use is not a completed
            customer case, and none of these five pages is written as one.
          </p>
          <div className="tiles">
            {ENTRIES.map(([slug, solution]) => (
              <article className={`tile ${styles.card}`} key={slug}>
                <p className="n">{solution.eyebrow}</p>
                <h2><Link href={`/solutions/${slug}` as Route}>{solution.title}</Link></h2>
                <p className={styles.audience}>For: {solution.audience}</p>
                <p>{solution.lede}</p>
                <p className={styles.problem}>{solution.problem}</p>
              </article>
            ))}
          </div>
          <div className="actions">
            <PublicPrimaryCta className="btn" />
            <Link className="btn ghost" href="/explore">Explore a World</Link>
          </div>
          <p className="fine">
            Next: the guides, samples and research in the{" "}
            <Link href="/resources">resources hub</Link>, or the exact product contract in the{" "}
            <Link href="/docs">documentation</Link>.
          </p>
        </div>
      </div></div></section>
    </PublicPageShell>
  );
}

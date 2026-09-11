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
          {/*
            BA-054: the descriptor slot says what this section is. It read "SOLUTIONS · TAVONEL",
            which fills the slot with the brand and so says nothing -- the pattern everywhere else
            on the site is the section plus what it holds.
          */}
          <p className="slate"><b>SOLUTIONS</b><span />FIVE DOCUMENTED USES</p>
          <h1 className="document-title">What people use<br />the compiler for.</h1>
        </div>
        <div className="stack">
          {/*
            What a solution page is, said before a reader opens one. Each describes a use the
            product is built for -- the workflow, the result and the limits -- written from the
            product's own behaviour.

            BA-040. The lede closed on "A described use is not a completed customer case, and none
            of these five pages is written as one." A page whose job is to answer "who is this
            for" opened by disqualifying its own five entries, and that second sentence was
            written to protect us rather than to help the reader. It is still true and still
            published: it is the last line of the page now, where a reader who wants to know
            whether these are case studies will find it, and where it is not the first thing
            anybody reads.
          */}
          <p className="lede">
            Five ways teams put the compiler to work. Each page gives the audience, the path from
            source to World, what the workflow leaves behind, and the limits that come with it.
          </p>
          <div className="tiles">
            {/*
              BA-040 in the cards: each one closed on its problem sentence under a hairline, so
              five cards read as five complaints and the hub read as a disclaimer. The problem is
              one sentence, it comes before what the workflow gives you, and the card ends on the
              product rather than on the difficulty.

              BA-052: a card-shaped surface with a border and a background has to be clickable.
              It was a ~200px text target inside a 330px card with no hover state at all. The
              title's anchor is expanded over the whole article by `styles.cardTitle`, which keeps
              one link per card rather than nesting a second one around it.
            */}
            {ENTRIES.map(([slug, solution]) => (
              <article className={`tile ${styles.card}`} key={slug}>
                <p className="n">{solution.eyebrow}</p>
                <h2 className={styles.cardTitle}>
                  <Link href={`/solutions/${slug}` as Route}>{solution.title}</Link>
                </h2>
                <p className={styles.audience}>For: {solution.audience}</p>
                <p className={styles.problem}>{solution.problem}</p>
                <p>{solution.lede}</p>
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
            <Link href="/docs">documentation</Link>. A described use is not a completed customer
            case, and none of these five pages is written as one.
          </p>
        </div>
      </div></div></section>
    </PublicPageShell>
  );
}

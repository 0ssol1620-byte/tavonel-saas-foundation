import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import CompilerContractDiagram from "@/components/compiler-contract-diagram";
import { PublicSitePage } from "@/components/public-site-chrome";
import {
  CONTRACT_CLAUSES,
  CONTRACT_STATE,
  INTEROP_STANDARDS,
  PACKAGE_FORMATS,
  type ContractClauseState,
} from "@/lib/compiler-contract";
import styles from "./continuous-knowledge.module.css";

export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/product/continuous-knowledge" },
  openGraph: { url: "/product/continuous-knowledge" },
  title: "Continuous recompilation — TAVONEL",
  description:
    "The Compiler Contract: eight clauses that say what a compile guarantees when a source changes, each carrying the state it holds in this deployment.",
};

/*
  This route was a `notFound()` stub kept as a stable 404 for retired inbound URLs. It is a page
  now because the contract it describes is the product's actual argument, and the argument was
  only being made in motion on the landing films and in fragments across four other pages.

  Two decisions shaped what is here.

  The states are data, not markup. Every clause carries its state in `lib/compiler-contract.ts`
  and a test asserts that nothing is upgraded to "qualified" without a receipt attached, because
  the failure this page invites is not a broken layout -- it is one adjective quietly moving in a
  copy pass on a page whose entire argument is that "built" and "proven" are different words.

  And there is no results table. A page about equivalence is exactly where a PASS badge wants to
  appear; there is no equivalence receipt on this deployment, so the diagram draws pass and
  refuse as the two outcomes of a rule and marks the rule itself as not yet executed here.
*/

/** The two states this page actually uses, in the order a reader meets them. */
const STATE_KEY: readonly ContractClauseState[] = ["demonstrated", "direction"];

export default function ContinuousKnowledgePage() {
  return (
    <PublicSitePage>
      <section className="scene doc">
        <div className="shell">
          <div className="body">
            <div className="stack">
              <p className="slate"><b>PRODUCT</b><span />CONTINUOUS RECOMPILATION</p>
              <h1 className="document-title">Continuous recompilation — the Compiler Contract.</h1>
            </div>
            <div className="stack">
              <p className="lede">
                Knowledge is not compiled once. Sources keep moving, and a compiler that cannot say
                what a change did to the knowledge standing on it is an indexer with extra steps.
                <b> The Compiler Contract is the eight promises a compile has to keep</b> — and,
                on this page, the state each one actually holds here.
              </p>
              <dl className={styles.key}>
                {STATE_KEY.map((state) => (
                  <div key={state} data-state={state}>
                    <dt><span className={styles.state}>{CONTRACT_STATE[state].label}</span></dt>
                    <dd>{CONTRACT_STATE[state].meaning}</dd>
                  </div>
                ))}
              </dl>
              <p className="fine">
                No clause on this page is marked {CONTRACT_STATE.qualified.label}. That state
                requires a named corpus and a receipt, and this deployment publishes neither — the
                measurements it does publish are in the{" "}
                <Link href={"/research/notes" as Route}>research notes</Link>.
              </p>
            </div>
          </div>

          <section className={styles.section} aria-labelledby="clauses">
            <h2 id="clauses">The eight clauses</h2>
            <ol className={styles.clauses} data-contract-clauses="">
              {CONTRACT_CLAUSES.map((clause, index) => (
                <li className={styles.clause} data-contract-clause="" data-state={clause.state} id={clause.id} key={clause.id}>
                  <div className={styles.head}>
                    <span className={styles.index}>{String(index + 1).padStart(2, "0")}</span>
                    <h3>{clause.name}</h3>
                    <span className={styles.state} data-state-label="">{CONTRACT_STATE[clause.state].label}</span>
                  </div>
                  <p className={styles.promise}>{clause.promise}</p>
                  <p className={styles.explain}>{clause.body}</p>
                  <p className={styles.check}><b>WHERE TO CHECK IT</b>{clause.evidence}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className={styles.section} aria-labelledby="flow">
            <h2 id="flow">What a source change does</h2>
            <p className="lede">
              A revision arrives. The compiler reads what the change <i>means</i> rather than which
              bytes moved, resolves which knowledge units stand on the changed region, and splits
              the world in two: what is untouched is carried over, what is affected is rebuilt.
              <b> The rebuilt result is then compared against what a full rebuild would have
              produced</b>, and a mismatch refuses to publish rather than shipping a world that
              looks finished.
            </p>
            <CompilerContractDiagram />
            <p className="fine">
              Solid stages run in this deployment; dashed stages are the contract this compiler is
              written to. A compile here rebuilds the collection it is given and produces a
              candidate version for a person to activate — the selective path between the two is
              the work described above, not a description of what runs today. The version a
              candidate replaces stays intact and readable either way.
            </p>
          </section>

          <section className={styles.section} aria-labelledby="interop">
            <h2 id="interop">Leaving the compiler</h2>
            <p className="lede">
              A compiled World that can only be read inside the tool that made it is not an asset.
              The internal representation stays ours; what leaves is a signed package in formats
              other systems already read.
            </p>
            <dl className={styles.formats}>
              {PACKAGE_FORMATS.map(([format, path]) => (
                <div key={format}>
                  <dt>{format}</dt>
                  <dd>{path}</dd>
                </div>
              ))}
            </dl>
            <p className="fine">
              Every path above is written by the same function that compiles a customer&rsquo;s
              documents. The archive carries a signed file inventory and the public verification
              key, and <b>pnpm verify:export</b> checks it offline against a fingerprint obtained
              from somewhere other than the archive.
            </p>

            <h3>Interchange standards</h3>
            <ul className={styles.standards} data-interop-standards="">
              {INTEROP_STANDARDS.map((standard) => (
                <li className={styles.standard} data-interop-standard="" data-state={standard.state} key={standard.name}>
                  <b>{standard.name}</b>
                  <span className={styles.state} data-state-label="">{CONTRACT_STATE[standard.state].label}</span>
                  <p>{standard.note}</p>
                </li>
              ))}
            </ul>
          </section>

          <div className={styles.section}>
            <div className="actions">
              <Link className="btn" href={"/explore" as Route}>See a compiled World</Link>
              <Link className="btn ghost" href="/product/compiled-world">What a World contains</Link>
              <Link className="btn ghost" href="/evidence">What has been measured</Link>
            </div>
          </div>
        </div>
      </section>
    </PublicSitePage>
  );
}

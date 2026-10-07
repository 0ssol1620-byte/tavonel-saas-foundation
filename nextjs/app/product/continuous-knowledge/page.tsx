import type { Metadata } from "next";
import { Fragment } from "react";
import Link from "next/link";
import type { Route } from "next";
import CompilerContractDiagram from "@/components/compiler-contract-diagram";
import { PublicSitePage } from "@/components/public-site-chrome";
import BreadcrumbJsonLd, { DocBreadcrumb } from "@/components/breadcrumb-json-ld";
import WorldRecompileTimeline from "@/components/world-recompile-timeline";
import {
  CONTRACT_CLAUSES,
  CONTRACT_STATE,
  INTEROP_STANDARDS,
  PACKAGE_FORMATS,
  type ContractClauseState,
} from "@/lib/compiler-contract";
import styles from "./continuous-knowledge.module.css";
import { EXPLORE_CTA } from "@/lib/site-navigation";

export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/product/continuous-knowledge" },
  openGraph: { url: "/product/continuous-knowledge" },
  title: "Continuous recompilation — TAVONEL",
  description:
    "Compare World versions after a source changes, then inspect the Compiler Contract and the current state of each clause.",
  /*
    No `robots` field here, and one line elsewhere is still wrong.

    An earlier revision of this branch declared the page noindex, on the reasoning that
    `app/robots.ts` has disallowed this route since it was a `notFound()` stub, so the page should
    agree with it. That was two mistakes. The lane specification asks for this page in the
    sitemap, which is an instruction to advertise it; and a `noindex` behind a
    `Disallow` is inert anyway -- a crawler that obeys robots.txt never fetches the page, so it
    never reads the meta tag, while `/product` goes on publishing an ordinary crawlable link to
    the URL from a page that is itself indexed. Three surfaces were reported as agreeing when
    only one of them could act, and it was the weaker one.

    So the two surfaces this lane owns now say the same thing -- the sitemap lists the route and
    the page makes no `noindex` claim about itself -- and the disallow entry in `app/robots.ts:5`
    is left as the conflict it is: a file this campaign assigns to no lane, still carrying a line
    written when this route was a 404. Deleting `"/product/continuous-knowledge"` from that array
    is the one edit that finishes this, and it is the founder's to make.
  */
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

/** G1-026: the clauses in two halves, so the page's first action can sit between them. */
const MID_CLAUSE = Math.ceil(CONTRACT_CLAUSES.length / 2);
const CLAUSE_HALVES = [
  [0, CONTRACT_CLAUSES.slice(0, MID_CLAUSE)],
  [MID_CLAUSE, CONTRACT_CLAUSES.slice(MID_CLAUSE)],
] as const;

/** One trail, read by the crawler and by the reader. See `DocBreadcrumb` (BQ-137). */
const TRAIL = [
  { name: "Product", path: "/product" },
  { name: "Continuous knowledge", path: "/product/continuous-knowledge" },
];

export default function ContinuousKnowledgePage() {
  return (
    <PublicSitePage>
      <BreadcrumbJsonLd trail={TRAIL} />
      <section className="scene doc">
        <div className="shell">
          <div className={`body ${styles.intro}`} data-continuous-intro="">
            <div className={styles.introHeading}>
              <DocBreadcrumb trail={TRAIL} />
              <h1 className="document-title">See what changed before you activate it.</h1>
            </div>
              <aside className={styles.summary} aria-labelledby="working-summary">
                <h2 id="working-summary">From a source change to a reviewed version</h2>
                <ol className={styles.workflow}>
                  <li><h3>Compile a candidate</h3><p>A compile rebuilds the collection you give it into a new candidate World.</p></li>
                  <li><h3>Compare the versions</h3><p>Inspect what changed and follow the evidence back to the source it came from.</p></li>
                  <li><h3>Choose what becomes current</h3><p>A person activates the candidate. The version it replaces stays intact and readable.</p></li>
                </ol>
                <p className={styles.currentBoundary}>Current compilation rebuilds the whole collection. The public timeline compares complete compiles after the fact.</p>
                <nav className={styles.summaryActions} aria-label="Compare versions or read the contract">
                  <Link className={styles.changeLink} href={"/explore?act=change" as Route}>Compare the public World versions</Link>
                  <Link href="#clauses">Read the eight-clause Compiler Contract</Link>
                </nav>
              </aside>
            <div className={styles.timeline}>
              {/*
                G1-019 / gap #10 (2026-09-22). Six hundred words about knowledge not being
                compiled once ran down the right half of this page while the left half held the
                h1 and then nothing. What fills it is the subject: every version of the public
                sample World in arrival order, with each pair's manifest digests and the diff
                between them. Every figure is read out of five frozen compiles; no copy on this
                page changes, and nothing here is an illustration of a diff.
              */}
              <WorldRecompileTimeline />
            </div>
          </div>

          <section className={styles.section} aria-labelledby="clauses">
            <h2 id="clauses">The eight clauses</h2>
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
                requires a named corpus and a receipt, and TAVONEL publishes neither — the
                measurements it does publish are in the{" "}
                <Link href={"/research/notes" as Route}>research notes</Link>.
              </p>
            {/*
              G1-026. One list became two, with the page's first action between them.

              This page is about 5,800px of prose and its first action was at the very bottom, so a
              reader who took the argument at clause 03 had nothing to do about it for five screens.
              The break is halfway, derived from the clause count rather than written as a 4, and it
              asks for the sample before it asks for anything else -- the contract's own claim is
              that it can be checked, not that it should be bought. The closing row keeps its three
              actions; this is not a second copy of them.

              Two `<ol>` elements rather than an item inside one, because the list is a two-column
              grid at 1100px and an aside cell inside it would need a column-span rule in CSS this
              lane does not own. The numbering is unaffected: it is computed from the clause's index
              in `CONTRACT_CLAUSES`, not from the list it is rendered in.
            */}
            {CLAUSE_HALVES.map(([from, half], group) => (
              <Fragment key={from}>
                {group === 1 ? (
                  <p className="fine">
                    {from} clauses in, and every one of them is checkable on a World that is already
                    compiled.{" "}
                    <Link href={"/explore" as Route}>Open the public Compiled World</Link> and follow
                    a fact back to the page it was read from, or{" "}
                    <Link href="/contact">request access</Link> to compile your own sources.
                  </p>
                ) : null}
                <ol className={styles.clauses} data-contract-clauses="" start={from + 1}>
                  {half.map((clause, index) => (
                    <li className={styles.clause} data-contract-clause="" data-state={clause.state} id={clause.id} key={clause.id}>
                      <div className={styles.head}>
                        <span className={styles.index}>{String(from + index + 1).padStart(2, "0")}</span>
                        <h3>{clause.name}</h3>
                        <span className={styles.state} data-state-label="">{CONTRACT_STATE[clause.state].label}</span>
                      </div>
                      <p className={styles.promise}>{clause.promise}</p>
                      <details className={styles.detail} data-contract-detail="">
                        <summary aria-label={`Read ${clause.name}: explanation and evidence`}>Explanation and evidence</summary>
                        <div className={styles.detailBody}>
                          <p className={styles.explain}>{clause.body}</p>
                          <p className={styles.check}><b>WHERE TO CHECK IT</b>{clause.evidence}</p>
                        </div>
                      </details>
                    </li>
                  ))}
                </ol>
              </Fragment>
            ))}
          </section>

          <section className={styles.section} aria-labelledby="flow">
            <h2 id="flow">What a source change does</h2>
            <details className={styles.reference} data-contract-reference="flow">
              <summary>Read the source-change contract and diagram</summary>
              <div className={styles.referenceBody}>
            <p className="lede">
              The contract describes one path. A revision arrives; the change is read for what it{" "}
              <i>means</i> rather than which bytes moved; the units standing on the changed region
              are resolved; the untouched half is carried over and the affected half rebuilt; and
              the result is compared against what a full rebuild would have produced, with a
              mismatch refusing to publish rather than shipping a world that looks finished.{" "}
              <b>Two stages of that path run in TAVONEL today.</b> The drawing says which two,
              and the solid line down its left side is what happens here instead.
            </p>
            <CompilerContractDiagram />
            <p className="fine">
              Solid is what TAVONEL executes: a source revision arrives, and a compile
              rebuilds the whole collection it is given into a candidate version a person
              activates. Everything dashed — the semantic diff, the dependency impact, the
              preserve-and-rebuild split, the equivalence comparison and the pass or refuse it
              would end in — is the contract this compiler is written to and does not run here,
              which is what clause 05 says in words. The kept previous World is dashed for that
              reason and not because a version is discarded: there is no equivalence check here to
              refuse, and the version a candidate replaces stays intact and readable either way.
              That is clause 04, and it is demonstrated.
            </p>
              </div>
            </details>
          </section>

          <section className={styles.section} aria-labelledby="interop">
            <h2 id="interop">Leaving the compiler</h2>
            <details className={styles.reference} data-contract-reference="interop">
              <summary>Read the formats and interchange standards</summary>
              <div className={styles.referenceBody}>
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
              documents. The archive carries a signed file inventory — every listed file checked
              by sha256, then those exact manifest bytes signed with Ed25519 — and the public key
              the signature was made with, so <b>the check runs offline</b>, against a key
              fingerprint taken from somewhere other than the archive. What the archive does not
              carry is the verifier: it names the algorithm and the two files to compare, and the
              program that compares them is yours to run.
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
              </div>
            </details>
          </section>

          <div className={styles.section}>
            <div className="actions">
              <Link className="btn" href={EXPLORE_CTA.href as Route}>{EXPLORE_CTA.label}</Link>
              <Link className="btn ghost" href="/product/compiled-world">What a World contains</Link>
              <Link className="btn ghost" href="/evidence">What has been measured</Link>
            </div>
          </div>
        </div>
      </section>
    </PublicSitePage>
  );
}

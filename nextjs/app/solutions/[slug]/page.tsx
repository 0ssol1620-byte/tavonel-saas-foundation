import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicPageShell } from "@/components/public-page-shell";
import PublicPrimaryCta from "@/components/public-primary-cta";
import SolutionProofSample from "@/components/solution-proof-sample";
import { RESOURCE_TAG_LABELS, resourceFilterHref, type ResourceTag } from "@/lib/site-navigation";
import styles from "../solutions.module.css";

/*
  RESOLVED A-1 (2026-09-06), applied here in the repair pass rather than in the pass that
  changed six other pages. /solutions is a PRIMARY_NAV destination and was still publishing the
  PDF locator as the general shape of evidence -- "Citations back to page regions", "Page and
  bbox provenance", "Page-level citation inspection" -- which is the wording A-1 retires. The
  outcomes are the claim-shaped lines, so they take the base wording; the flow steps and the
  document-intelligence lede keep "pages and regions", because they describe what the
  sanitize-to-PDF reading path literally does today and generalizing them would make them less
  true. `brand-copy.test.ts` now guards this file and /api against the retired wording.
*/
export const SOLUTIONS = {
  "ai-ready-knowledge": {
    resources: "build",
    audience: "AI and platform engineers",
    eyebrow: "AI-READY KNOWLEDGE",
    title: "Give every AI project the same grounded knowledge asset.",
    lede: "Compile document collections into a versioned World before retrieval, assistants or agent workflows consume them.",
    problem: "Teams repeatedly clean, chunk and index the same sources for each model or application. Identity, relationships and provenance drift between projects.",
    flow: ["Connect sources", "Read and reconstruct", "Resolve identity and relations", "Review evidence", "Publish a portable World"],
    outcomes: ["One governed source of knowledge", "Retrieval as a World projection", "Citations back to the exact source location", "Signed portable artifacts"],
    limitations: [
      "A compile costs a reading pass and a review. One project over one small corpus is cheaper to do by hand.",
      "Retrieval quality still depends on the questions asked of it; a World makes an answer traceable, not automatically better.",
      "Nothing here replaces a source of record. A World is compiled from documents and is only as current as its last compile.",
    ],
  },
  "document-intelligence": {
    resources: "evaluate",
    audience: "Document and operations teams",
    eyebrow: "DOCUMENT INTELLIGENCE",
    title: "Read the source before asking AI to reason over it.",
    /*
      BA-048. The lede and the second flow step still published the PDF locator as the general
      shape of evidence -- "without losing the page and region each result came from", "Read pages
      and regions". That is the wording RESOLVED A-1 retires, and `brand-copy.test.ts` catches its
      other forms only, so the "page and region" variant survived the sweep on this page.
      /evidence was rewritten to say a locator is whatever points at one place in that kind of
      source; this page now says the same, and the guard list gains the phrase so it cannot come
      back (cross-lane, `nav-global`).
    */
    lede: "Move from difficult PDFs and scans to reviewable structure, without losing the exact source location each result came from.",
    problem: "A clean text dump hides layout, tables, uncertainty and the exact source geometry needed to review an extraction.",
    flow: ["Quarantine and sanitize", "Read the source and its regions", "Recover document structure", "Route uncertainty to review", "Bind results to evidence"],
    outcomes: ["Provenance to the exact source location", "Visible confidence and review reasons", "Immutable OCR output", "Structure ready for compilation"],
    limitations: [
      "Where a format does not state a page count, the quote is an estimate and is labelled one. Spreadsheets have no decided billable unit at all.",
      // Nothing detects handwriting, a stamp or scan degradation: review is opened on an OCR
      // failure, and this deployment has no quality score and deliberately does not route on one.
      "A page the reader cannot read fails visibly and is opened for review; nothing guesses at handwriting, stamps or degraded scans, and review is a person's time.",
      "No accuracy figure is published without a same-condition benchmark.",
    ],
  },
  "knowledge-graph": {
    resources: "build",
    audience: "Data and knowledge architects",
    eyebrow: "KNOWLEDGE GRAPH",
    title: "Compile a graph people can inspect and machines can reuse.",
    lede: "Turn document facts into stable semantic objects and evidence-bound relations inside a versioned World.",
    problem: "A graph that cannot show why an edge exists is difficult to review, govern or trust downstream.",
    flow: ["Create semantic objects", "Resolve duplicate identities", "Bind source evidence", "Create actual relations", "Promote a reviewed World"],
    outcomes: ["Stable object and relation IDs", "Ontology and graph exports", "Version history and rollback", "Evidence for every qualified edge"],
    limitations: [
      "The graph is compiled from documents, so an object exists only where a source region supports it.",
      /*
        BA-050. Two of these three limits were "no X yet" and "not calibrated": the reader was
        handed our roadmap and our internal calibration state instead of the two facts that
        change what they would do. Both facts survive, stated as the behaviour a buyer plans
        around -- you load the exports into the store you already run, and an uncertain merge is
        held rather than decided. The uncalibrated-threshold statement itself is not deleted from
        the site: it is a first-class row on /evidence ("Most thresholds are uncalibrated ...
        nothing here presents an uncalibrated threshold as a measured result",
        `lib/evidence-record.ts`), which is where a reader who wants it looks.
      */
      "Exports are Turtle, JSON-LD and CSV — load them into any store you already run.",
      "An uncertain merge is never decided silently: it is held for review with the regions that support each side.",
    ],
  },
  "source-grounded-assistants": {
    resources: "use-elsewhere",
    audience: "Application and agent developers",
    eyebrow: "GROUNDED ASSISTANTS",
    title: "Let an answer travel all the way back to the source.",
    lede: "Ask, API and MCP consume the same current World and return evidence from the same version.",
    problem: "An answer can sound confident while depending on stale, conflicting or untraceable source material.",
    flow: ["Ask the active World", "Retrieve qualified objects", "Generate with version context", "Attach evidence", "Decline when nothing matched"],
    /*
      BA-042. The outcome read "Explicit abstention" and the limitation forty lines below said
      the World does not abstain in the case that matters -- so a reader who opened the fold
      watched the headline outcome being withdrawn, which is worse than never claiming it. The
      outcome is now the fact: it declines when nothing matched. The limitation leads with the
      behaviour rather than with the judgement the product does not make, and hands the reader
      the thing they actually have -- the evidence to judge with.
    */
    outcomes: ["Answer and evidence share one World version", "Citation inspection at the exact source location", "Declines when nothing matched", "Model-independent knowledge"],
    limitations: [
      "The World returns the regions that matched and their locators, and declines when nothing matched at all. Judging whether what matched answers the question is the reader’s call, and the evidence is there to make it.",
      "Ask, the API and MCP read the same active revision, so an assistant is as current as the last promotion.",
      "Model choice is yours; the World is the contract.",
    ],
  },
  "knowledge-operations": {
    resources: "verify",
    audience: "Knowledge owners and security reviewers",
    eyebrow: "KNOWLEDGE OPERATIONS",
    title: "Review, promote and govern knowledge as an operational asset.",
    lede: "Separate candidate compilation from the active World, preserve change history and keep human decisions explicit.",
    problem: "Automated extraction becomes operational risk when updates silently replace the knowledge used by production systems.",
    flow: ["Compile a candidate", "Route review reasons", "Inspect source versus result", "Promote explicitly", "Rollback when needed"],
    outcomes: ["Candidate-to-active lifecycle", "Human promotion gate", "Activity and audit records", "Budget and retention controls"],
    limitations: [
      "Promotion is a human decision by design.",
      /*
        BA-049. "Membership is not available yet for shared workspaces; Team remains contact-only
        until tenancy is complete" put an internal engineering milestone in front of knowledge
        owners and security reviewers. The commercial fact is unchanged and is the one a buyer has
        to plan for: Team is `saleChannel: "contact"` in `lib/billing-catalog.ts`, so it is set up
        with us rather than bought at a checkout. The roadmap half belongs in the pricing footnote
        where a reader is comparing plans, and goes to `copy-commerce-legal` as a cross-lane item.
      */
      "Team workspaces are set up with us rather than bought at a checkout — we provision the tenant and the roles with you.",
      "Rollback restores a prior revision. It does not undo downstream use of an older answer.",
    ],
  },
} as const;

export type SolutionSlug = keyof typeof SOLUTIONS;

/*
  WG-048: every solution page ends at the hub and at the documentation, not at a dead end.

  `resources` above is one of the hub's own tags, so this link lands on a filter that exists
  and is labelled with the hub's own words. Nothing here links to `/cookbooks/*`: that route is
  a proposal, and a draft page is not offered to a reader as the next step.
*/
const resourceTagOf = (solution: (typeof SOLUTIONS)[SolutionSlug]): ResourceTag => solution.resources;

export function generateStaticParams() {
  return Object.keys(SOLUTIONS).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const solution = SOLUTIONS[slug as SolutionSlug];
  if (!solution) return {};
  return {
    title: `${solution.eyebrow} — TAVONEL`,
    description: solution.lede,
    alternates: { canonical: `/solutions/${slug}` },
    openGraph: { url: `/solutions/${slug}` },
  };
}

export default async function SolutionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const solution = SOLUTIONS[slug as SolutionSlug];
  if (!solution) notFound();

  return (
    <PublicPageShell>
      <section className="scene doc solution-page"><div className="shell">
        <div className="body solution-hero">
          <div className="stack">
            <p className="slate"><b>SOLUTION</b><span />{solution.eyebrow}</p>
            <h1 className="document-title">{solution.title}</h1>
          </div>
          <div className="stack solution-hero-copy">
            {/*
              Audit B02. Five solution pages repeat the same concepts and the same sample figures,
              and nothing told a reader which of the five answers *their* question -- a developer,
              an operations owner and a security reviewer were handed the same five doors. The
              audience is a field on the solution rather than a sentence written into each page, so
              it cannot drift from the copy under it, and it renders as a wrapping paragraph rather
              than a mono label because the longest of them is wider than a 360px phone.
            */}
            <p className="fine">For: {solution.audience}</p>
            <p className="lede">{solution.lede}</p>
            <p>{solution.problem}</p>
          </div>
          <SolutionProofSample />
        </div>

        <section className="solution-section" aria-labelledby="solution-flow-title">
          <div className="solution-section-heading">
            <p className="slate"><b>WORKFLOW</b><span />FROM SOURCE TO WORLD</p>
            <h2 id="solution-flow-title">A traceable compilation path.</h2>
          </div>
          {/*
            BA-045. The five step cards put the number at the top and the title at the bottom of
            a 190px box with `justify-content: space-between`, so about 60px between them was
            dead, and the last one was tinted green -- decorative colour in a system where colour
            reports state, which said the fifth step is a different kind of thing when nothing
            makes it one. The step's number and its title are one block now and the card is as
            tall as the block; at 390 the five are a single column rather than a 2+2+1 grid with
            three different heights.
          */}
          <ol className={`solution-flow ${styles.flow}`}>
            {solution.flow.map((item, index) => (
              <li key={item} className={styles.flowStep}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h3>{item}</h3>
              </li>
            ))}
          </ol>
        </section>

        <section className="solution-section" aria-labelledby="solution-outcomes-title">
          <div className="solution-section-heading">
            <p className="slate"><b>OUTCOMES</b><span />WHAT YOU CAN USE</p>
            <h2 id="solution-outcomes-title">What the workflow leaves behind.</h2>
          </div>
          {/*
            BA-046. This was four 136px cards holding a heading and nothing else, one line
            vertically centred in each -- a section-shaped container for a four-item list. The
            audit offers two fixes: give every outcome a sentence of substance, or drop the cards
            and typeset the list. It is a list, so it is typeset as one. Writing twenty new
            sentences of product capability to fill four boxes is the more expensive fix and the
            one with something to get wrong.
          */}
          <ul className={styles.outcomes}>
            {solution.outcomes.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>

        {/*
          BA-044. The fold was titled by an absence on all five pages -- "WHERE THIS STOPS" is
          how we talk about scope internally and reads as a warning label to a buyer. Same
          content, stated as an input to a decision.
        */}
        <details className="solution-notes">
          <summary><span>WHAT TO PLAN FOR</span> · Before your first compile</summary>
          <div>
            {solution.limitations.map((item) => <p key={item}>{item}</p>)}
          </div>
        </details>

        {/*
          BA-047. This line was the last thing on the page, in 11px mono, under the CTA row and
          competing with it, with a nav label pushed through `.toLowerCase()` into the middle of a
          sentence ("build on it", "use a world somewhere else") and a 73x14px tap target on a
          phone. It is above the actions now, in the text face, and it names its destinations.
        */}
        <p className={styles.next}>
          Next:{" "}
          <Link href={resourceFilterHref(resourceTagOf(solution)) as Route}>
            {RESOURCE_TAG_LABELS[resourceTagOf(solution)]}
          </Link>{" "}
          in Resources, or the exact product contract in the{" "}
          <Link href="/docs">documentation</Link>.
        </p>

        <div className="actions solution-actions">
          <PublicPrimaryCta className="btn" />
          <Link className="btn ghost" href="/explore">Explore a World</Link>
        </div>
      </div></section>
    </PublicPageShell>
  );
}

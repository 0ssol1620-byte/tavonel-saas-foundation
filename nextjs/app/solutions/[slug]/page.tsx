import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicPageShell } from "@/components/public-page-shell";
import PublicPrimaryCta from "@/components/public-primary-cta";
import SolutionProofSample from "@/components/solution-proof-sample";
import DesignPartners from "@/components/design-partners";
import { EXPLORE_CTA, RESOURCE_TAG_LABELS, resourceFilterHref, type ResourceTag } from "@/lib/site-navigation";
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
    name: "AI-ready knowledge",
    title: "Give every AI project the same grounded knowledge asset.",
    lede: "Compile document collections into a versioned World before retrieval, assistants or agent workflows consume them.",
    problem: "Teams repeatedly clean, chunk and index the same sources for each model or application. Identity, relationships and provenance drift between projects.",
    /*
      G1-009, same class as the knowledge-graph step below. "Resolve identity and relations" is
      the present tense of a Compiler Contract clause marked DIRECTION: cross-source identity is
      not merged automatically on this deployment. The step says what a compile does do.
    */
    flow: ["Connect sources", "Read and reconstruct", "Bind identity, hold what is uncertain", "Review evidence", "Publish a portable World"],
    headings: {
      flow: "From five filings to one portable World.",
      outcomes: "What every project downstream inherits.",
    },
    proof: {
      form: "10-K",
      match: /PART I Item 1\. Business Company Background/,
      framing: "One region out of the annual filing, in the shape every project downstream receives it: the passage, the page it was printed on and the box it sat in.",
    },
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
    name: "Document intelligence",
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
    /*
      G1-008. This sentence named tables as something a text dump hides, which reads as a promise
      that the compiler does not hide them -- against `no_table_or_formula_extraction` -- and the
      third flow step promised recovered structure against `no_native_structure_reader_yet`. Both
      now say what the read actually produces, which is the harder and truer claim: the printed
      order and the exact place, kept.
    */
    problem: "A clean text dump hides the printed order, the uncertainty and the exact source geometry needed to review an extraction.",
    flow: ["Quarantine and sanitize", "Read the source and its regions", "Read regions in printed order", "Route uncertainty to review", "Bind results to evidence"],
    headings: {
      flow: "From a difficult scan to a reviewable read.",
      outcomes: "What a reviewer gets to check.",
    },
    proof: {
      form: "10-Q",
      match: /CONDENSED CONSOLIDATED STATEMENTS OF OPERATIONS/,
      framing: "A printed financial statement, read the way this deployment reads one: every figure stays readable and locatable as the paragraphs it was printed as, while the grid that arranged them is not recovered.",
    },
    outcomes: ["Provenance to the exact source location", "Visible confidence and review reasons", "Immutable OCR output", "Regions ready for compilation"],
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
    name: "Knowledge graph",
    title: "Compile a graph people can inspect and machines can reuse.",
    lede: "Turn document facts into stable semantic objects and evidence-bound relations inside a versioned World.",
    problem: "A graph that cannot show why an edge exists is difficult to review, govern or trust downstream.",
    /*
      G1-009 and G1-041. Step 02 said "Resolve duplicate identities" in the present tense while
      Compiler Contract clause 02 is DIRECTION -- merging two strings into one object is the part
      this deployment does not do automatically -- and step 04's "Create actual relations" was not
      English anyone writes. Both steps now name the behaviour a buyer plans around.
    */
    flow: ["Create semantic objects", "Hold uncertain identities for review", "Bind source evidence", "Emit evidence-bound relations", "Activate a reviewed World"],
    headings: {
      flow: "From filing text to objects and edges.",
      outcomes: "What loads into the store you already run.",
    },
    proof: {
      form: "DEF 14A",
      match: /Nominees to Apple’s Board of Directors Apple is overseen/,
      framing: "A proxy passage naming people and roles — the kind of region an object and its relations are compiled from, with the evidence that supports each one still attached.",
    },
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
    name: "Source-grounded assistants",
    title: "Let an answer travel all the way back to the source.",
    lede: "Ask, API and MCP consume the same current World and return evidence from the same version.",
    problem: "An answer can sound confident while depending on stale, conflicting or untraceable source material.",
    flow: ["Ask the active World", "Retrieve qualified objects", "Generate with version context", "Attach evidence", "Decline when nothing matched"],
    headings: {
      flow: "From a question to a citation you can open.",
      outcomes: "What an answer carries with it.",
    },
    proof: {
      form: "10-Q",
      match: /Segment Operating Performance The following table shows net sales by reportable segment/,
      framing: "The region behind one of the sample questions on /explore — an answer's citation, opened at the exact place in the filing it was read from.",
    },
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
      "Ask, the API and MCP read the same active revision, so an assistant is as current as the last activation.",
      "Model choice is yours; the World is the contract.",
    ],
  },
  "knowledge-operations": {
    resources: "verify",
    audience: "Knowledge owners and security reviewers",
    eyebrow: "KNOWLEDGE OPERATIONS",
    name: "Knowledge operations",
    title: "Review, activate and govern knowledge as an operational asset.",
    lede: "Separate candidate compilation from the active World, preserve change history and keep human decisions explicit.",
    problem: "Automated extraction becomes operational risk when updates silently replace the knowledge used by production systems.",
    flow: ["Compile a candidate", "Route review reasons", "Inspect source versus result", "Activate explicitly", "Rollback when needed"],
    headings: {
      flow: "From a new filing to an approved revision.",
      outcomes: "What a reviewer signs, and what stays on record.",
    },
    proof: {
      form: "DEF 14A",
      match: /Audit Committee Ron Sugar/,
      framing: "A governance passage from the proxy — the kind of region a reviewer opens beside the compiled result before activating a candidate.",
    },
    outcomes: ["Candidate-to-active lifecycle", "Human activation gate", "Activity and audit records", "Budget and retention controls"],
    limitations: [
      "Activation is a human decision by design.",
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
    /*
      G1-029. Five titles were all-caps, which a browser tab and a search result render literally.
      `name` is the sentence-case spelling of the same page rather than a `.toLowerCase()` of the
      eyebrow, because lower-casing turns "AI-READY" into "Ai-ready" and there is no rule that
      knows which words are acronyms. Five strings, written once.
    */
    title: `${solution.name} — TAVONEL`,
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
          <SolutionProofSample pick={solution.proof} />
        </div>

        <section className="solution-section" aria-labelledby="solution-flow-title">
          <div className="solution-section-heading">
            {/* G1-016. Five pages shared these two headings verbatim; each now names its own
                corpus and audience, so the outline of one page is not the outline of five. */}
            <h2 id="solution-flow-title">{solution.headings.flow}</h2>
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
            <h2 id="solution-outcomes-title">{solution.headings.outcomes}</h2>
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
        {/*
          G1-017. The index page sells "the limits that come with it" and then every one of the
          five pages folded them shut, so the site's strongest differentiator rendered as an empty
          row with a `+` on the right. It opens by default. The `<details>` element stays so a
          reader who has read them can put them away.
        */}
        <details className="solution-notes" open>
          {/*
            No separator between the two halves: `.solution-notes summary` is
            `justify-content: space-between`, so a "·" written between them lands at the start of
            the right-hand phrase with nothing on its left -- which is how the old title rendered
            and is a punctuation mark doing no work.
          */}
          <summary><span>WHAT TO PLAN FOR</span> Before your first compile</summary>
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
        {/* SD-10. What a design partner gets, where a logo wall would otherwise go. */}
        <DesignPartners className="solution-section" />

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
          <Link className="btn ghost" href={EXPLORE_CTA.href as Route}>{EXPLORE_CTA.label}</Link>
        </div>
      </div></section>
    </PublicPageShell>
  );
}

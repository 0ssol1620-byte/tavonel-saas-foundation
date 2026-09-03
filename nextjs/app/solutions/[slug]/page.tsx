import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicPageShell } from "@/components/public-page-shell";

const SOLUTIONS = {
  "ai-ready-knowledge": {
    eyebrow: "AI-READY KNOWLEDGE",
    title: "Give every AI project the same grounded knowledge asset.",
    lede: "Compile document collections into a versioned World before retrieval, assistants or agent workflows consume them.",
    problem: "Teams repeatedly clean, chunk and index the same sources for each model or application. Identity, relationships and provenance drift between projects.",
    flow: ["Connect sources", "Read and reconstruct", "Resolve identity and relations", "Review evidence", "Publish a portable World"],
    outcomes: ["One governed source of knowledge", "Retrieval as a World projection", "Citations back to page regions", "Signed portable artifacts"],
    limitations: [
      "A compile costs a reading pass and a review. One project over one small corpus is cheaper to do by hand.",
      "Retrieval quality still depends on the questions asked of it; a World makes an answer traceable, not automatically better.",
      "Nothing here replaces a source of record. A World is compiled from documents and is only as current as its last compile.",
    ],
  },
  "document-intelligence": {
    eyebrow: "DOCUMENT INTELLIGENCE",
    title: "Read the source before asking AI to reason over it.",
    lede: "Move from difficult PDFs and scans to reviewable structure, without losing the page and region each result came from.",
    problem: "A clean text dump hides layout, tables, uncertainty and the exact source geometry needed to review an extraction.",
    flow: ["Quarantine and sanitize", "Read pages and regions", "Recover document structure", "Route uncertainty to review", "Bind results to evidence"],
    outcomes: ["Page and bbox provenance", "Visible confidence and review reasons", "Immutable OCR output", "Structure ready for compilation"],
    limitations: [
      "Where a format does not state a page count, the quote is an estimate and is labelled one. Spreadsheets have no decided billable unit at all.",
      "Handwriting, stamps and heavily degraded scans are routed to review rather than guessed at, and review is a person's time.",
      "No accuracy figure is published, because no same-condition benchmark has been run. A vendor score is not a substitute.",
    ],
  },
  "knowledge-graph": {
    eyebrow: "KNOWLEDGE GRAPH",
    title: "Compile a graph people can inspect and machines can reuse.",
    lede: "Turn document facts into stable semantic objects and evidence-bound relations inside a versioned World.",
    problem: "A graph that cannot show why an edge exists is difficult to review, govern or trust downstream.",
    flow: ["Create semantic objects", "Resolve duplicate identities", "Bind source evidence", "Create actual relations", "Promote a reviewed World"],
    outcomes: ["Stable object and relation IDs", "Ontology and graph exports", "Version history and rollback", "Evidence for every qualified edge"],
    limitations: [
      "The graph is compiled from documents, so an object exists only where a source region supports it.",
      "Exports are Turtle, JSON-LD and CSV. There is no live connector into a graph database; a load is a load.",
      "Identity resolution across a corpus is the hard part and its thresholds are not calibrated. Merges are reviewable for that reason.",
    ],
  },
  "source-grounded-assistants": {
    eyebrow: "GROUNDED ASSISTANTS",
    title: "Let an answer travel all the way back to the source.",
    lede: "Ask, API and MCP consume the same current World and return evidence from the same version.",
    problem: "An answer can sound confident while depending on stale, conflicting or untraceable source material.",
    flow: ["Ask the active World", "Retrieve qualified objects", "Generate with version context", "Attach evidence", "Abstain when support is insufficient"],
    outcomes: ["Answer and evidence share one World version", "Page-level citation inspection", "Explicit abstention", "Model-independent knowledge"],
    limitations: [
      "The World abstains where the sources do not support an answer. An assistant that must always answer is the wrong fit.",
      "Ask, the API and MCP read the same active revision, so an assistant is exactly as current as the last promotion.",
      "Model choice is yours; the World is the contract. Nothing here evaluates a model for you.",
    ],
  },
  "knowledge-operations": {
    eyebrow: "KNOWLEDGE OPERATIONS",
    title: "Review, promote and govern knowledge as an operational asset.",
    lede: "Separate candidate compilation from the active World, preserve change history and keep human decisions explicit.",
    problem: "Automated extraction becomes operational risk when updates silently replace the knowledge used by production systems.",
    flow: ["Compile a candidate", "Route review reasons", "Inspect source versus result", "Promote explicitly", "Rollback when needed"],
    outcomes: ["Candidate-to-active lifecycle", "Human promotion gate", "Activity and audit records", "Budget and retention controls"],
    limitations: [
      "Promotion is a human decision by design. Without somebody to make it, a candidate never becomes the World anyone answers from.",
      "Membership is not available: one workspace belongs to one account today, and shared review queues need a tenancy change first.",
      "Rollback restores a prior revision. It does not undo what was done elsewhere with an answer from the one being rolled back.",
    ],
  },
} as const;

type SolutionSlug = keyof typeof SOLUTIONS;

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

/*
  Masterplan 13.22 asks every solution page for its limitations, and it is the section that
  decides whether the rest of the page is a description or a pitch. Each entry below names
  something this product genuinely does not do for that buyer -- an uncalibrated threshold, an
  abstention, a tenancy limit -- rather than a difficulty it happens to solve.
*/
export default async function SolutionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const solution = SOLUTIONS[slug as SolutionSlug];
  if (!solution) notFound();
  return (
    <PublicPageShell>
      <section className="scene doc"><div className="shell">
        <div className="body"><div className="stack"><p className="slate"><b>SOLUTION</b><span />{solution.eyebrow}</p><h1 className="document-title">{solution.title}</h1></div><div className="stack"><p className="lede">{solution.lede}</p><p>{solution.problem}</p></div></div>
        <div className="body"><div className="stack"><p className="slate"><b>WORKFLOW</b><span />FROM SOURCE TO WORLD</p><h2>A traceable compilation path.</h2></div><div className="chain">{solution.flow.map((item, index) => <article className="link" key={item}><span className="st">{String(index + 1).padStart(2, "0")}</span><h3>{item}</h3></article>)}</div></div>
        <div className="body"><div className="stack"><p className="slate"><b>OUTCOMES</b><span />ACTUAL PRODUCT CONTRACT</p><h2>What the workflow leaves behind.</h2></div><div className="chain">{solution.outcomes.map((item) => <article className="link" key={item}><h3>{item}</h3></article>)}</div></div>
        <div className="body"><div className="stack"><p className="slate"><b>LIMITS</b><span />WHERE THIS STOPS</p><h2>What it does not do.</h2></div><div className="chain">{solution.limitations.map((item) => <article className="link" key={item}><p>{item}</p></article>)}</div></div>
        <div className="actions"><Link className="btn" href="/login">Compile your own sources</Link><Link className="btn ghost" href="/explore">Explore a Compiled World</Link></div>
      </div></section>
    </PublicPageShell>
  );
}

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
  },
  "document-intelligence": {
    eyebrow: "DOCUMENT INTELLIGENCE",
    title: "Read the source before asking AI to reason over it.",
    lede: "Move from difficult PDFs and scans to reviewable structure, without losing the page and region each result came from.",
    problem: "A clean text dump hides layout, tables, uncertainty and the exact source geometry needed to review an extraction.",
    flow: ["Quarantine and sanitize", "Read pages and regions", "Recover document structure", "Route uncertainty to review", "Bind results to evidence"],
    outcomes: ["Page and bbox provenance", "Visible confidence and review reasons", "Immutable OCR output", "Structure ready for compilation"],
  },
  "knowledge-graph": {
    eyebrow: "KNOWLEDGE GRAPH",
    title: "Compile a graph people can inspect and machines can reuse.",
    lede: "Turn document facts into stable semantic objects and evidence-bound relations inside a versioned World.",
    problem: "A graph that cannot show why an edge exists is difficult to review, govern or trust downstream.",
    flow: ["Create semantic objects", "Resolve duplicate identities", "Bind source evidence", "Create actual relations", "Promote a reviewed World"],
    outcomes: ["Stable object and relation IDs", "Ontology and graph exports", "Version history and rollback", "Evidence for every qualified edge"],
  },
  "source-grounded-assistants": {
    eyebrow: "GROUNDED ASSISTANTS",
    title: "Let an answer travel all the way back to the source.",
    lede: "Ask, API and MCP consume the same current World and return evidence from the same version.",
    problem: "An answer can sound confident while depending on stale, conflicting or untraceable source material.",
    flow: ["Ask the active World", "Retrieve qualified objects", "Generate with version context", "Attach evidence", "Abstain when support is insufficient"],
    outcomes: ["Answer and evidence share one World version", "Page-level citation inspection", "Explicit abstention", "Model-independent knowledge"],
  },
  "knowledge-operations": {
    eyebrow: "KNOWLEDGE OPERATIONS",
    title: "Review, promote and govern knowledge as an operational asset.",
    lede: "Separate candidate compilation from the active World, preserve change history and keep human decisions explicit.",
    problem: "Automated extraction becomes operational risk when updates silently replace the knowledge used by production systems.",
    flow: ["Compile a candidate", "Route review reasons", "Inspect source versus result", "Promote explicitly", "Rollback when needed"],
    outcomes: ["Candidate-to-active lifecycle", "Human promotion gate", "Activity and audit records", "Budget and retention controls"],
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
        <div className="actions"><Link className="btn" href="/login">Compile your own sources</Link><Link className="btn ghost" href="/explore">Explore a Compiled World</Link></div>
      </div></section>
    </PublicPageShell>
  );
}

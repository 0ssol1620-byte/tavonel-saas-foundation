import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { PublicSitePage } from "@/components/public-site-chrome";
import BreadcrumbJsonLd from "@/components/breadcrumb-json-ld";
import { CONTRACT_STATE, clause } from "@/lib/compiler-contract";

export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/product/compiled-world" },
  openGraph: { url: "/product/compiled-world" },
  title: "Compiled World — TAVONEL",
  description:
    "The output of a TAVONEL compile: objects, relations, evidence and versions, portable as one signed package.",
};

/*
  A product page lists what the product does.

  The fifth card here was "DIRECTION — Automated ontology", describing a capability the page
  then said is "not a shipped capability", closing with a footnote reading "Knowledge
  architecture is labelled Direction in this deployment. Live capability is fail-closed; see
  /status." A prospect came away with four things the product does and one it does not, with no
  reason to weight them differently. Work that is not built belongs on the research page, where
  it is the subject rather than an asterisk on a sales page.
*/
/*
  The identity and relation cards are written against the Compiler Contract's own clause states.

  Audit M02 and M03. This page said "the same thing named in two documents is one thing in the
  world" and "what supports, supersedes, depends on or contradicts what" in the present tense,
  one click from `lib/compiler-contract.ts`, which marks cross-string identity merge `direction`
  and names the edges the compiler actually emits. Two pages on the same site disagreeing about
  the same compiler is worse than either sentence alone, so the two cards now import their clause
  and print the registry's own state word under themselves. The day a clause flips to
  `demonstrated`, the word on the card flips with it and `product-claims-sync.test.ts` requires
  the sentence to be re-derived rather than left standing.
*/
const IDENTITY = clause("stable-semantic-identity");
const RELATIONS = clause("typed-dependencies");

type Part = {
  state: string;
  title: string;
  body: string;
  /** The contract clause this card is derived from, printed with its state and its meaning. */
  clause?: typeof IDENTITY;
};

/*
  A product page lists what the product does.

  The fifth card here was "DIRECTION — Automated ontology", describing a capability the page
  then said is "not a shipped capability", closing with a footnote reading "Knowledge
  architecture is labelled Direction in this deployment. Live capability is fail-closed; see
  /status." A prospect came away with four things the product does and one it does not, with no
  reason to weight them differently. Work that is not built belongs on the research page, where
  it is the subject rather than an asterisk on a sales page.
*/
const PARTS: readonly Part[] = [
  {
    state: "OBJECTS",
    title: "The things themselves",
    body: "Entities, claims and the documents they were read from get a stable key derived from their content, so recompiling the same source lands on the same object instead of a new one. Two different strings for one real-world thing — FP-200 and Feedwater Pump 200 — are not merged automatically: where the evidence does not settle identity the compiler leaves it unresolved for a person rather than guessing, and automatic resolution across sources is a direction.",
    clause: IDENTITY,
  },
  {
    state: "RELATIONS",
    title: "What connects to what",
    body: "Every edge is typed and carries the evidence ids that justify it — an edge naming no evidence is not a row this emitter can produce. What a compile emits on this deployment is the claim-to-evidence edge: a claim is supported_by one exact document version. The engine behind the public Explore sample also emits two document-level edges from text heuristics, mentions_entity from a capitalised-token scan and discusses_topic from a small set of keyword rules. Business relations — what supports, what replaces what, what depends on what — and detecting that two claims conflict are directions: the gate in front of retrieval does not check them.",
    clause: RELATIONS,
  },
  /*
    RESOLVED A-1 (2026-09-06), applied here in the repair pass rather than in the pass that
    changed the other eight surfaces. This row published the PDF locator -- "a document version,
    page and region" -- as the general shape of all evidence, which is the wording A-1 retires.
    A cell in a spreadsheet and a MIME part in an email are exact locations with no page. The
    per-source forms are set out once, on /evidence, rather than repeated here.
  */
  {
    state: "EVIDENCE",
    title: "Where a fact came from",
    body: "Every qualified claim points at a source version and its exact location inside it. A world holding an unresolved link is not emitted at all.",
  },
  {
    state: "VERSIONS",
    title: "What changed, and when",
    body: "A compile produces a candidate version. A person activates it, and the version it replaced stays intact and readable.",
  },
  /*
    "One world, read by Ask, search, the API and MCP" was the old third sentence here. The package
    does carry all five projections; which of them a live answer is served from depends on whether
    that World carries a compiled retrieval run, and the answer reports the path it took. Stating
    the artifact and pointing at the per-answer report is the half of that sentence this page can
    keep.
  */
  {
    state: "PROJECTIONS",
    title: "How it is consumed",
    body: "Ontology, graph, retrieval corpus, directory and validation artifacts, written into one package from one world. Every Ask answer names the retrieval path that produced it, so which projection an answer came from is reported rather than assumed.",
  },
  {
    state: "PACKAGE",
    title: "What you can take",
    body: "A signed package, hash-verified on the way out. The public key is published at /api/export/trust, so a recipient can verify it without asking us.",
  },
];

export default function CompiledWorldPage() {
  return (
    <PublicSitePage>
      <BreadcrumbJsonLd trail={[{ name: "Product", path: "/product" }, { name: "Compiled World", path: "/product/compiled-world" }]} />
      <section className="scene doc">
        <div className="shell">
          <div className="body">
            <div className="stack">
              <p className="slate"><b>PRODUCT</b><span />COMPILED WORLD</p>
              <h1 className="document-title">Not searchable files. A world an AI can reason about.</h1>
            </div>
            <div className="stack">
              <p className="lede">
                The output of a compile is a Compiled World: objects, relations, evidence,
                versions and the artifacts that project them.
                <b> One world, used by retrieval, agents, MCP, APIs and applications.</b>
              </p>
              <div className="tiles">
                {PARTS.map((part) => (
                  <article className="tile" key={part.title}>
                    <span className="n">{part.state}</span>
                    <h3>{part.title}</h3>
                    <p>{part.body}</p>
                    {part.clause ? (
                      <p className="fine">
                        <b>{CONTRACT_STATE[part.clause.state].label}</b>{" "}
                        {CONTRACT_STATE[part.clause.state].meaning}{" "}
                        <Link href={`/product/continuous-knowledge#${part.clause.id}` as Route}>
                          {part.clause.name} in the Compiler Contract
                        </Link>
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
              <p className="fine">
                Every compile emits the same package shape, so a world built today can be read by
                a tool written against one built last month.
              </p>
              <div className="actions">
                <Link className="btn" href={"/explore" as Route}>Explore a Compiled World</Link>
                <Link className="btn ghost" href="/docs/use-with-ai">Use the result with AI</Link>
                <Link className="btn ghost" href="/docs/ontology-output">Use the ontology output</Link>
                <Link className="btn ghost" href="/evidence">How evidence is bound</Link>
                <Link className="btn ghost" href="/developers">Read it from your code</Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </PublicSitePage>
  );
}

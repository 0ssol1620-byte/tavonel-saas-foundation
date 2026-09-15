import type { Metadata } from "next";
import Link from "next/link";
import { PublicPageShell } from "@/components/public-page-shell";
import PublicPrimaryCta from "@/components/public-primary-cta";

export const metadata: Metadata = {
  alternates: { canonical: "/product" },
  openGraph: { url: "/product" },
  title: "Product — TAVONEL",
  description: "TAVONEL is a Knowledge Compiler. Documents, scans, code and connected systems go in. A Compiled World comes out.",
};

const SURFACES = [
  ["/knowledge-compiler", "CATEGORY", "Knowledge Compiler", "Read sources, reconstruct structure, resolve identities, map relationships, keep evidence attached, and compile the result."],
  // Audit M01: /product/document-understanding now derives what the read recovers from the
  // capability manifest, and typed structure is not in it. This card stops promising it.
  ["/product/document-understanding", "READING", "Document understanding", "Recover text, reading order and coordinates from documents and scans before anything is compiled."],
  ["/product/compiled-world", "OUTPUT", "Compiled World", "Structured knowledge with provenance and reusable retrieval artifacts — not a pile of searchable files."],
  ["/product/continuous-knowledge", "CONTRACT", "Continuous recompilation", "What a compile promises when a source changes: eight clauses, each carrying the state it holds in this deployment."],
] as const;

const PRODUCT_FLOW = [
  ["SOURCE", "Files, folders, ZIP and connected systems"],
  // "Pages, tables, regions and coordinates" said a table is read as a table. Audit M01: what
  // survives the read is the paragraph, the page and the box it sat in, and
  // /product/document-understanding now derives that sentence from the capability manifest. This
  // row stops contradicting it.
  ["READ", "Pages, paragraphs, regions and coordinates"],
  ["STRUCTURE", "Entities, claims, relations and review"],
  ["WORLD", "Evidence, graph, retrieval and portable export"],
] as const;

/*
  Audit ST03. Which layer this replaces and which it plugs into, said once, with no competitor
  named and no competitor's number quoted.

  The boundary already existed in exactly one place -- /solutions/knowledge-graph's "Exports are
  Turtle, JSON-LD and CSV. There is no live connector into a graph database yet." -- where a buyer
  comparing platforms would never look for it. A read-only source-grounded knowledge supplier is a
  position, not a shortfall, and a page that states the position does not have to answer for every
  write workflow it never offered.
*/
/*
  BA-022. Every row says what the layer gets, and the boundary is where that sentence stops.

  Three of the five opened with "There is no ...", on the page that answers "what is this". None
  of the three facts changed: exports are files a graph database or an ontology tool imports, so
  modelling stays in that tool; the MCP surface is read-only, so an action stays in the
  orchestrator that took it. Those are the same boundaries, written as where the work happens
  rather than as something missing here. The one limit that is a *gap* rather than a division of
  labour -- no live connector into a graph database yet -- is published on
  /solutions/knowledge-graph, which is the page a reader comparing graph platforms is already on.

  "Connected to" became "Connects to" so the column reads as one two-word phrase at every width:
  it was wrapping as "Connected / to" at 1280.
*/
const LAYERS = [
  ["Document parsing and OCR", "Replaced", "Reading is a compile step here: sanitize, read, keep the location and the uncertainty, and carry both into review."],
  ["Ingestion and cleanup scripts", "Replaced", "One compile over a collection, versioned, producing a candidate a person promotes, with the revision it replaces still readable."],
  ["Enterprise search", "Connects to", "The package carries a retrieval corpus, and the API and MCP are read-only. An existing search product keeps its index; what changes is that a result can name the source version behind it."],
  ["Ontology and knowledge platforms", "Connects to", "Turtle, JSON-LD and CSV leave in a signed package that a graph database or an ontology tool imports, so modelling and business rules stay in the tool your team already runs."],
  ["Agent and workflow orchestration", "Connects to", "Eight read-only MCP tools and an HTTP API: an agent reads a World, and the actions it takes stay in the orchestrator that took them."],
] as const;

export default function ProductPage() {
  return (
    <PublicPageShell>
      <section className="scene doc product-overview">
        <div className="shell">
          <div className="body product-hero">
            <div className="stack">
              <p className="slate"><b>PRODUCT</b><span />KNOWLEDGE COMPILER</p>
              {/*
                BA-023. "actually" was doing the reader's arguing for them -- it concedes that
                they arrived expecting the opposite. The home page's headline already carries the
                contrast; this page does not have to win it a second time.
              */}
              <h1 className="document-title">Compile documents into a World your AI can use.</h1>
            </div>
            <div className="stack">
              <p className="lede">Documents, scans and connected systems go in. A source-grounded, versioned Compiled World comes out — with evidence still attached.</p>
              <div className="actions"><PublicPrimaryCta className="btn" /><Link className="btn ghost" href="/explore">Explore a World</Link></div>
            </div>
          </div>

          <div className="product-flow" aria-label="TAVONEL product flow" data-visual>
            {PRODUCT_FLOW.map(([stage, detail], index) => (
              <article key={stage}>
                <span>{String(index + 1).padStart(2, "0")} · {stage}</span>
                <strong>{detail}</strong>
              </article>
            ))}
          </div>

          <div className="product-surface-grid">
            {SURFACES.map(([href, state, title, body]) => (
              <Link className="product-surface" href={href} key={href}>
                <span>{state}</span>
                <h2>{title}</h2>
                <p>{body}</p>
                <b>Open →</b>
              </Link>
            ))}
          </div>

          <section className="product-boundary" aria-labelledby="product-layers-title">
            <p className="slate"><b>BOUNDARY</b><span />WHAT THIS REPLACES, WHAT IT CONNECTS TO</p>
            {/*
              BA-027. "Two of these layers are ours. Three of them are yours." was a riddle whose
              answer was the table under it, and on the page where the other question a buyer
              brings is who holds their data, ours-versus-yours is the wrong axis to be ambiguous
              about. The eyebrow above already says it; this says it in a sentence.
            */}
            <h2 id="product-layers-title">What we replace, and what we plug into.</h2>
            <table className="docs-table">
              <thead>
                <tr>
                  <th scope="col">Layer</th>
                  <th scope="col">Position</th>
                  <th scope="col">What that means here</th>
                </tr>
              </thead>
              <tbody>
                {LAYERS.map(([layer, position, meaning]) => (
                  <tr key={layer}>
                    <th scope="row">{layer}</th>
                    <td className="product-boundary-position">{position}</td>
                    <td>{meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/*
            BA-018. The page the navigation sends every buyer to ended on a five-row table and
            about 150px of empty floor, with its only actions 2,000px above in the hero. This is
            the closing pattern the other product pages already use: one line, one primary, one
            secondary. Neither is `PublicPrimaryCta` -- the hero's is the page's access action
            and a second copy of it would be the same button twice.
          */}
          <section className="product-close">
            <h2>Four surfaces, one compiled World.</h2>
            <div className="actions">
              <Link className="btn" href="/explore">Explore a Compiled World</Link>
              <Link className="btn ghost" href="/sources">See supported sources</Link>
            </div>
          </section>
        </div>
      </section>
    </PublicPageShell>
  );
}

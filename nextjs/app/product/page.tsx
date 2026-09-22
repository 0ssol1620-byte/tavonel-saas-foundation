import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { PublicPageShell } from "@/components/public-page-shell";
import ExploreFrame from "@/components/explore/explore-frame";
import PublicPrimaryCta from "@/components/public-primary-cta";
import { EXPLORE_CTA } from "@/lib/site-navigation";
import tableStyles from "@/components/docs/docs-table.module.css";

export const metadata: Metadata = {
  alternates: { canonical: "/product" },
  openGraph: { url: "/product" },
  title: "Product — TAVONEL",
  // G1-006: "code" named a format the capability manifest does not accept, in the one sentence a
  // search result shows. The page's own lede never claimed it.
  description: "TAVONEL is a Knowledge Compiler. Documents, scans and connected systems go in. A Compiled World comes out.",
};

const SURFACES = [
  ["/knowledge-compiler", "Category", "Knowledge Compiler", "Read sources, reconstruct structure, resolve identities, map relationships, keep evidence attached, and compile the result."],
  // Audit M01: /product/document-understanding now derives what the read recovers from the
  // capability manifest, and typed structure is not in it. This card stops promising it.
  ["/product/document-understanding", "Reading", "Document understanding", "Recover text, reading order and coordinates from documents and scans before anything is compiled."],
  ["/product/compiled-world", "Output", "Compiled World", "Structured knowledge with provenance and reusable retrieval artifacts — not a pile of searchable files."],
  ["/product/continuous-knowledge", "Contract", "Continuous recompilation", "What a compile promises when a source changes: eight clauses, each carrying the state it holds in TAVONEL."],
] as const;

/*
  BQ-109. The flow strip that used to stand here is gone, and the surface cards are the one
  representation of the path left on this page.

  It printed SOURCE / READ / STRUCTURE / WORLD directly above four cards reading CATEGORY /
  READING / OUTPUT / CONTRACT -- the same four beats, the same order, two visual systems, and
  a reader asking which of the two to follow. The cards win because they are the only half
  that goes anywhere: each one is a link to the page that answers it. What the strip carried
  and the cards do not is the sentence under the H1 ("Documents, scans and connected systems
  go in") and the list of sources, which is a link in the closing row.
*/
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
  ["Ingestion and cleanup scripts", "Replaced", "One compile over a collection, versioned, producing a candidate a person activates, with the revision it replaces still readable."],
  ["Enterprise search", "Connects to", "The package carries a retrieval-ready index, and the API and MCP are read-only. An existing search product keeps its index; what changes is that a result can name the source version behind it."],
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
              {/*
                BA-023. "actually" was doing the reader's arguing for them -- it concedes that
                they arrived expecting the opposite. The home page's headline already carries the
                contrast; this page does not have to win it a second time.
              */}
              <h1 className="document-title">Compile documents into a World your AI can use.</h1>
            </div>
            <div className="stack">
              <p className="lede">Documents, scans and connected systems go in. A source-grounded, versioned Compiled World comes out — with evidence still attached.</p>
              <div className="actions"><PublicPrimaryCta className="btn" /><Link className="btn ghost" href={EXPLORE_CTA.href as Route}>{EXPLORE_CTA.label}</Link></div>
              {/*
                Gap #8. The hub for "a World your AI can use" had no World on it.

                The same renderer /explore draws, over the same compiled artifact, above the
                fold on the page that makes the claim -- not a diagram of one. It is the frame
                the category guide carries too, from one component, so the two cannot drift.
              */}
              <ExploreFrame caption="A Compiled World, drawn from the published sample" />
            </div>
          </div>

          <div className="product-surface-grid">
            {SURFACES.map(([href, state, title, body]) => (
              <Link className="product-surface" href={href} key={href}>
                <span className="eyebrow">{state}</span>
                <h2>{title}</h2>
                <p>{body}</p>
                {/*
                  BQ-134: "Open →" is gone from all four cards. The whole `<article>` is the
                  anchor, so it was a second label for a link the reader is already inside, set
                  in 9px tracked mono -- below the type floor, and the least useful four
                  characters on the card. The heading names the destination.
                */}
              </Link>
            ))}
          </div>

          <section className="product-boundary" aria-labelledby="product-layers-title">
            {/*
              BA-027. "Two of these layers are ours. Three of them are yours." was a riddle whose
              answer was the table under it, and on the page where the other question a buyer
              brings is who holds their data, ours-versus-yours is the wrong axis to be ambiguous
              about. BQ-099 deleted the eyebrow that used to say it above this; the heading says
              it in a sentence, and it is the only heading this section has.
            */}
            <h2 id="product-layers-title">What we replace, and what we plug into.</h2>
            {/*
              BQ-049. Three columns, the last of them a sentence: on a phone the column that says
              what the position means is the one off the right edge, which is the same as not
              publishing it. `data-label` is the whole opt-in -- `app/tavonel.css` stacks any
              `.docs-table` whose cells carry one below 620px -- and `rowHeader` is the half that
              cannot be done from outside, because this table names its rows with `<th scope="row">`
              rather than with a first cell.
            */}
            <div className="table-scroll">
              <table className={`docs-table ${tableStyles.rowHeader}`}>
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
                      <td className="product-boundary-position" data-label="Position">{position}</td>
                      <td data-label="What that means here">{meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/*
            BA-018. The page the navigation sends every buyer to ended on a five-row table and
            about 150px of empty floor, with its only actions 2,000px above in the hero. This is
            the closing pattern the other product pages already use: one line, one primary, one
            secondary. Neither is `PublicPrimaryCta` -- the hero's is the page's access action
            and a second copy of it would be the same button twice.
          */}
          <section className="product-close">
            {/*
              G1-040. "Four surfaces" counted the cards above it and nothing on the page said so,
              so a reader arriving at the closing line had to go back and count. The eyebrows are
              read off `SURFACES` rather than typed, so a fifth card renames this heading.
            */}
            <h2>{SURFACES.map(([, state]) => state.charAt(0) + state.slice(1).toLowerCase()).join(" · ")} — one compiled World.</h2>
            <div className="actions">
              <Link className="btn" href={EXPLORE_CTA.href as Route}>{EXPLORE_CTA.label}</Link>
              <Link className="btn ghost" href="/sources">See supported sources</Link>
            </div>
          </section>
        </div>
      </section>
    </PublicPageShell>
  );
}

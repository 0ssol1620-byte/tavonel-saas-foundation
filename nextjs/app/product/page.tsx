import type { Metadata, Route } from "next";
import Link from "next/link";
import { PublicPageShell } from "@/components/public-page-shell";
import ExploreFrame from "@/components/explore/explore-frame";
import PublicPrimaryCta from "@/components/public-primary-cta";
import { EXPLORE_CTA } from "@/lib/site-navigation";
import { MCP_TOOL_COUNT_WORD } from "@/lib/mcp-tools";
import { buildHeroView, buildProofTabs } from "@/lib/landing-v2-runtime";
import { buildHomeEvidenceCase, selectHomeCase } from "@/lib/home-evidence-view";
import tableStyles from "@/components/docs/docs-table.module.css";
import styles from "@/components/marketing-story.module.css";

export const metadata: Metadata = {
  alternates: { canonical: "/product" },
  openGraph: { url: "/product" },
  title: "Product — TAVONEL",
  description: "Inspect a Compiled World, follow source-cited knowledge, compare versions and connect the output to your AI stack.",
};
const LAYERS = [
  ["Document parsing and OCR", "Replaced", "Reading is a compile step here: sanitize, read, keep the location and the uncertainty, and carry both into review."],
  ["Ingestion and cleanup scripts", "Replaced", "One compile over a collection, versioned, producing a candidate a person activates, with the revision it replaces still readable."],
  ["Enterprise search", "Connects to", "The package carries a retrieval-ready index, and the API and MCP are read-only. An existing search product keeps its index; what changes is that a result can name the source version behind it."],
  ["Ontology and knowledge platforms", "Connects to", "Turtle, JSON-LD and CSV leave in a signed package that a graph database or an ontology tool imports, so modelling and business rules stay in the tool your team already runs."],
  ["Agent and workflow orchestration", "Connects to", `The ${MCP_TOOL_COUNT_WORD} read-only MCP tools and an HTTP API let an agent read a World; the actions it takes stay in the orchestrator that took them.`],
] as const;
const OUTCOMES = [
  { title: "Inspect the evidence", body: "Follow a passage to its document, source version, page and region. The published sample lets you inspect those links yourself.", href: "/evidence", action: "Inspect a source region" },
  { title: "Keep versions readable", body: "Compare complete corpus snapshots, see the objects later filings reached, and keep candidate and active versions distinct. The recompilation contract records the current selective-rebuild boundary.", href: "/product/continuous-knowledge", action: "See versions and changes" },
  { title: "Give your AI the output", body: "Read through HTTP API or MCP. Request a signed portable package when export checks pass, with retrieval material and source references still attached.", href: "/docs", action: "Connect your AI" },
] as const;

export default function ProductPage() {
  const sample = selectHomeCase([buildHomeEvidenceCase(buildHeroView(), buildProofTabs())]);
  const region = sample?.regions.find(item => item.id === sample.selectedRegionId && item.status === "extracted" && item.passage && item.href);
  const source = region && sample?.sources.find(item => item.id === region.sourceId);
  return <PublicPageShell>
    <section className={`scene doc product-overview ${styles.product}`}>
      <div className="shell">
        <div className={styles.lead}>
          <h1 className="document-title">Your sources.<br />A World you can inspect.</h1>
          <div>
            <p className="lede">Your sources become a versioned knowledge artifact, with the evidence still attached.</p>
            <div className="actions"><PublicPrimaryCta className="btn" /><Link className="btn ghost" href={EXPLORE_CTA.href as Route}>{EXPLORE_CTA.label}</Link></div>
          </div>
        </div>
        <div className={styles.world}><ExploreFrame caption="A Compiled World, drawn from the published sample" /></div>
        <div className={styles.outcomes}>
          {OUTCOMES.map(outcome => <section className={styles.outcome} key={outcome.title}>
            <h2>{outcome.title}</h2>
            <div>
              <p>{outcome.body}</p>
              {outcome.href === "/evidence" && region && source ? <figure className={styles.proof}>
                <blockquote>{region.passage}{region.passageTruncated ? " …" : ""}</blockquote>
                <figcaption>{source.filename} · page {region.page} · <code>{source.digest.slice(0, 12)}</code>
                  <span>Extracted public sample. Context unresolved; no interpreted claim.</span>
                </figcaption>
              </figure> : null}
              <Link href={(outcome.href === "/evidence" && region?.href ? region.href : outcome.href) as Route}>{outcome.action}</Link>
            </div>
          </section>)}
        </div>
        <details className={styles.boundary}>
          <summary>Where TAVONEL fits in your stack</summary>
          <div className="table-scroll">
            <table className={`docs-table ${tableStyles.rowHeader}`}>
              <thead><tr><th scope="col">Layer</th><th scope="col">Position</th><th scope="col">What that means here</th></tr></thead>
              <tbody>{LAYERS.map(([layer, position, meaning]) => <tr key={layer}><th scope="row">{layer}</th><td data-label="Position">{position}</td><td data-label="What that means here">{meaning}</td></tr>)}</tbody>
            </table>
          </div>
        </details>
        <div className={styles.close}>
          <Link className="btn" href={"/how-it-works" as Route}>Follow the compilation process</Link>
          <Link className="btn ghost" href="/evaluation">Evaluate your documents</Link>
          <Link className="btn ghost" href="/sources">See supported sources</Link>
        </div>
      </div>
    </section>
  </PublicPageShell>;
}

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
  ["/product/document-understanding", "READING", "Document understanding", "Recover text, layout and structure from documents and scans before anything is compiled."],
  ["/product/compiled-world", "OUTPUT", "Compiled World", "Structured knowledge with provenance and reusable retrieval artifacts — not a pile of searchable files."],
] as const;

const PRODUCT_FLOW = [
  ["SOURCE", "Files, folders, ZIP and connected systems"],
  ["READ", "Pages, tables, regions and coordinates"],
  ["STRUCTURE", "Entities, claims, relations and review"],
  ["WORLD", "Evidence, graph, retrieval and portable export"],
] as const;

export default function ProductPage() {
  return (
    <PublicPageShell>
      <section className="scene doc product-overview">
        <div className="shell">
          <div className="body product-hero">
            <div className="stack">
              <p className="slate"><b>PRODUCT</b><span />KNOWLEDGE COMPILER</p>
              <h1 className="document-title">Compile documents into a World an AI can actually use.</h1>
            </div>
            <div className="stack">
              <p className="lede">Documents, scans and connected systems go in. A source-grounded, versioned Compiled World comes out — with evidence still attached.</p>
              <div className="actions"><PublicPrimaryCta className="btn" /><Link className="btn ghost" href="/explore">Explore a World</Link></div>
            </div>
          </div>

          <div className="product-flow" aria-label="TAVONEL product flow">
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
        </div>
      </section>
    </PublicPageShell>
  );
}

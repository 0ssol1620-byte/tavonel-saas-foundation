import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { PublicSitePage } from "@/components/public-site-chrome";

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
const PARTS = [
  ["OBJECTS", "The things themselves", "Entities, topics and claims with stable identities that survive a source being revised, so the same thing named in two documents is one thing in the world."],
  ["RELATIONS", "What connects to what", "Typed edges between objects: what supports, supersedes, depends on or contradicts what, each carrying the source region that justifies it."],
  ["EVIDENCE", "Where a fact came from", "Every qualified claim points at a document version, page and region. A world holding an unresolved link is not emitted at all."],
  ["VERSIONS", "What changed, and when", "A compile produces a candidate version. A person activates it, and the version it replaced stays intact and readable."],
  ["PROJECTIONS", "How it is consumed", "Ontology, graph, retrieval corpus, directory and validation artifacts. One world, read by Ask, search, the API and MCP."],
  ["PACKAGE", "What you can take", "A signed package, hash-verified on the way out. The public key is published at /api/export/trust, so a recipient can verify it without asking us."],
] as const;

export default function CompiledWorldPage() {
  return (
    <PublicSitePage>
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
                {PARTS.map(([state, title, body]) => (
                  <article className="tile" key={title}>
                    <span className="n">{state}</span>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </article>
                ))}
              </div>
              <p className="fine">
                Every compile emits the same package shape, so a world built today can be read by
                a tool written against one built last month.
              </p>
              <div className="actions">
                <Link className="btn" href={"/explore" as Route}>Explore a Compiled World</Link>
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

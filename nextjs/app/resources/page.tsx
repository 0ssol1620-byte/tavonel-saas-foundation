import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { PublicSitePage } from "@/components/public-site-chrome";
import { RESOURCE_LINKS } from "@/lib/site-navigation";

export const metadata: Metadata = {
  alternates: { canonical: "/resources" },
  openGraph: { url: "/resources" },
  title: "Resources — TAVONEL",
  description:
    "Explore a compiled world, read the documentation and API, and inspect the research and evidence behind the compiler.",
};

/*
  The hub the navigation was already promising.

  "Resources" in the top nav pointed straight at /research — one page, wearing the label of a
  section. Anyone who clicked it expecting docs, the API reference or a changelog landed on a
  research page instead and had to go looking. The links below already existed; nothing here is
  new except somewhere to find them.
*/

const DESCRIPTIONS: Record<string, string> = {
  "/explore": "Follow a result from an answer back to the exact source location it came from, without signing in.",
  "/knowledge-compiler": "What a knowledge compiler is, and how it differs from a parser, a RAG pipeline and a graph database.",
  "/docs": "Quickstart, concepts, supported files, compiling, review, and using a world through Ask, the API and MCP.",
  "/api": "Endpoints, authentication, errors and limits, with the machine-readable OpenAPI document alongside.",
  "/changelog": "What changed, in the order it changed, written for the people using it.",
  "/research": "The open problems in compiling documents into evidence-bound, versioned knowledge.",
  "/benchmarks": "The eight metric families, the receipt a result must carry, and the rules that decide whether it may be compared.",
  "/evidence": "What an exact source location is for each kind of source, how a result stays bound to one, and how to verify a signed package.",
  "/reproducibility": "Fixture identity and the material needed to reproduce a published run.",
};

export default function ResourcesPage() {
  return (
    <PublicSitePage>
      <section className="scene doc">
        <div className="shell">
          <div className="body">
            <div className="stack">
              <p className="slate"><b>RESOURCES</b><span />TAVONEL</p>
              <h1 className="document-title">Everything that explains<br />how this works.</h1>
            </div>
            <div className="stack">
              <p className="lede">
                A sample world you can take apart, the documentation and API you build against,
                and the research and evidence behind the compiler.
              </p>
              <div className="tiles">
                {RESOURCE_LINKS.map((link) => (
                  <article className="tile" key={link.href}>
                    <h3><Link href={link.href as Route}>{link.label}</Link></h3>
                    <p>{DESCRIPTIONS[link.href]}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </PublicSitePage>
  );
}

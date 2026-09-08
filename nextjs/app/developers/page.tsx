import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { PublicSitePage } from "@/components/public-site-chrome";
import { TrackedLink } from "@/components/tracked-link";
import { REQUIRED_PACKAGE_PATHS } from "@/lib/collection-download";

export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/developers" },
  openGraph: { url: "/developers" },
  title: "Developers — TAVONEL",
  description: "Compile knowledge once, then reach it live over MCP and the API, or take it away as a signed portable package.",
};

/*
  Three ways to hand a World to something that will use it (§16.1).

  This page opened with five tiles named after API operations -- Compile, Read World, Ask,
  Export, MCP -- which is the shape of the endpoint list, not the shape of the decision a
  developer arrives with. The question is "how does my agent get this", and there are three
  answers, differing on the two things that matter: whether the reader gets the current World or
  a snapshot of it, and whether the reader is a program or a person.

  The operations are still named, inside the path each one belongs to, so nothing was dropped in
  the reorganisation.

  The hand-rolled header went with it. This page carried its own four-link nav ending in "Back
  to the compiler" -- one of the four chromes `lib/site-navigation.ts` exists to remove, and the
  last one still standing, so a reader arriving from the primary nav watched the site's
  structure change under them and lost the way to every other page.
*/
const PATHS = [
  {
    kind: "LIVE",
    title: "MCP and the API",
    body: "Read the active World over HTTP, or give an agent the read-only MCP server: eight tools over sources, World, search, Ask, objects, relations, evidence and package. Always the current revision, with no copy to keep in step.",
    detail: "No write tool, and the server refuses to start if one is added.",
  },
  {
    kind: "PORTABLE",
    title: "A signed package",
    body: "Take the World away as files: JSON-LD and Turtle semantic projections, graph nodes and relationships, a retrieval corpus, provenance activities and a validation report, under a signed manifest with a digest for every file.",
    detail: "Verifiable without asking us — and a snapshot, so it ages the moment the sources do.",
  },
  {
    kind: "HUMAN",
    title: "Ask and the workspace",
    body: "A person asks a question and gets an answer whose citations open the exact source location behind them, or a statement that the available evidence is insufficient rather than a filled gap.",
    detail: "The same World the two machine paths read, with a reviewer in front of it.",
  },
] as const;

/* §16.2, in the order the product enforces: nothing is queryable before a person activates it. */
const JOURNEY = [
  ["Compile and activate a World", "Upload or connect sources, review the candidate, and activate it. Activation is a human decision, and nothing is served from a candidate."],
  ["Create access", "Mint a scoped API key, or point an agent at the MCP server. Creating, rotating and revoking a key each write an audit row."],
  ["Query the active World", "Search, read objects and relations, or ask a question against the revision that is live right now."],
  ["Receive evidence-bound context", "Every result carries the source version and the exact location inside it that it was compiled from."],
  ["Follow citations back to source", "Open that location and read the original. Where the evidence does not support an answer, the answer says so."],
] as const;

/*
  What the package holds, read out of the writer.

  `REQUIRED_PACKAGE_PATHS` is the list `buildSignedCollectionArchive` refuses to emit without.
  The five below are files the same function adds on the way out -- the two guidance documents,
  the entrypoint, the candidate world, the export manifest and its detached signature.
  `brand-copy.test.ts` checks every string here against `lib/collection-download.ts`, so a file
  this page names is a file that module writes.
*/
const PACKAGE_EXTRAS = [
  "README.md",
  "AGENTS.md",
  "manifest/ai-entrypoint.json",
  "manifest/candidate-world.json",
  "manifest/export-manifest.json",
  "signatures/export-manifest.ed25519.json",
] as const;

export default function DevelopersPage() {
  return (
    <PublicSitePage>
      <section className="scene doc">
        <div className="shell">
          <div className="body">
            <div className="stack">
              <p className="slate"><b>DEVELOPERS</b><span />ONE WORLD</p>
              <h1 className="document-title">Give every model the same grounded world.</h1>
            </div>
            <div className="stack">
              <p className="lede">
                Compile knowledge once, then reach it live over MCP and the API, or take it away
                as a signed portable package. The model is replaceable. The compiled knowledge is
                the asset.
              </p>

              <p className="slate"><span />THREE WAYS TO USE A COMPILED WORLD</p>
              <div className="chain dev-paths">
                {PATHS.map((path) => (
                  <article className="link" key={path.kind}>
                    <span className="st">{path.kind}</span>
                    <h2>{path.title}</h2>
                    <p>{path.body}</p>
                    <p className="fine">{path.detail}</p>
                  </article>
                ))}
              </div>

              <p className="slate"><span />FROM SOURCES TO A GROUNDED ANSWER</p>
              <ol className="dev-journey">
                {JOURNEY.map(([title, body]) => (
                  <li key={title}>
                    <b>{title}</b>
                    <span>{body}</span>
                  </li>
                ))}
              </ol>

              <p className="fine">
                The endpoint reference, the error catalogue and the package format are in{" "}
                <Link href="/docs">the documentation</Link>. If you are deciding between live
                MCP/API access and a portable package, start with{" "}
                <Link href={"/docs/use-with-ai" as Route}>Use your results with AI</Link>. Current
                availability is published at <Link href={"/status" as Route}>/status</Link>.
              </p>

              <div className="stack">
                <p className="slate"><b>PUBLIC TOOLING</b><span />VERSIONED FILES</p>
                <h3>Start with the contract, then a scoped key.</h3>
                <pre><code>{`curl -H "Authorization: Bearer $TAVONEL_API_KEY" \\
  https://tavonel.com/api/v1/documents`}</code></pre>
                <div className="tiles">
                  <article className="tile"><h3>OpenAPI</h3><p>Machine-readable v1 HTTP contract.</p><TrackedLink event="developer_api_started" href="/openapi.json">Open schema</TrackedLink></article>
                  <article className="tile"><h3>CLI</h3><p>Node.js 20+ client with immutable version and update check.</p><a href="/developer/tavonel-cli.mjs" download>Download CLI</a></article>
                  <article className="tile"><h3>MCP</h3><p>Eight stdio tools: sources, World, search, Ask, objects, relations, evidence, package. No write tool, and it refuses to start if one is added.</p><TrackedLink event="developer_mcp_started" href="/developer/tavonel-mcp.mjs" download>Download MCP server</TrackedLink></article>
                  {/*
                    The tile stays because the agent is real; its wording changes because
                    "connector agent" is not what it is. RESOLVED A-4 (2026-09-06).

                    `public/developer/tavonel-source-agent.py` is in this repository, scans a
                    mounted directory or an S3-compatible bucket, and posts to two endpoints
                    that also exist here (`app/api/v1/uploads/capability` and
                    `app/api/v1/connections/[id]/sync`). But the customer runs it and it
                    pushes outward; TAVONEL connects to nothing. Describing it as an "SMB,
                    NFS, SFTP and S3-compatible connector" put four connectors on a page that
                    has none.
                  */}
                  <article className="tile"><h3>Source agent</h3><p>Runs inside your network and pushes to TAVONEL, which reaches into nothing. Reads a mounted directory — an SMB, NFS or SFTP mount included — or an S3-compatible bucket. An assisted import route, not a self-serve connector.</p><a href="/developer/tavonel-source-agent.py" download>Download source agent</a></article>
                </div>
                <p className="fine">Verify versions and SHA-256 values against <a href="/developer/channel.json">the public distribution channel</a>. The <a href="/developer/README.md">setup and safety contract</a> documents scopes, secret handling and fail-closed behavior.</p>
              </div>

              <div className="stack">
                <p className="slate"><b>PORTABLE PACKAGE</b><span />WHAT IS IN THE ARCHIVE</p>
                <p className="fine">
                  Every signed export contains these files, written by the exporter and named in
                  a manifest carrying a digest for each one. The two ontology files are the
                  Compiled World&rsquo;s RDF / JSON-LD semantic projection — a projection of the
                  compiled objects and relations, not a hand-authored OWL schema.
                </p>
                <ul className="dev-package">
                  {[...REQUIRED_PACKAGE_PATHS, ...PACKAGE_EXTRAS].map((path) => <li key={path}>{path}</li>)}
                </ul>
              </div>

              <p className="slate"><span />NEXT</p>
              <div className="actions">
                <Link className="btn" href={"/docs/quickstart" as Route}>Run the quickstart</Link>
                <Link className="btn ghost" href={"/api" as Route}>API reference</Link>
                <Link className="btn ghost" href="/evidence">How evidence is bound</Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </PublicSitePage>
  );
}

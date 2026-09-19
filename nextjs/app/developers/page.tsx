import { Fragment } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { PublicSitePage } from "@/components/public-site-chrome";
import { DocsCopyButton } from "@/components/docs-copy-button";
import { TrackedLink } from "@/components/tracked-link";
import { PageToc, tocEntries } from "@/components/docs/page-toc";
import { PACKAGE_CONTENTS } from "@/lib/package-contents";
import { MCP_TOOL_COUNT_WORD, MCP_TOOL_NAMES } from "@/lib/mcp-tools";
import { FIRST_CALL } from "@/lib/developer-snippets";

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
/* The curl block above the tooling tiles, hoisted so the copy control and the <pre> are one
   string rather than two that have to agree. */
// The two lines the landing page also prints, from one string (`lib/developer-snippets.ts`).

const PATHS = [
  {
    kind: "Live",
    title: "MCP and the API",
    body: `Read the active World over HTTP, or give an agent the read-only MCP server: ${MCP_TOOL_COUNT_WORD} tools over sources, Worlds, one World, search, Ask, objects, relations, evidence and package. Always the current revision, with no copy to keep in step.`,
    detail: "No write tool, and the server refuses to start if one is added.",
  },
  {
    kind: "Portable",
    title: "A signed package",
    body: "Take the World away as files: JSON-LD and Turtle semantic projections, graph nodes and relationships, a retrieval corpus, provenance activities and a validation report, under a signed manifest with a digest for every file.",
    detail: "Verifiable offline against a fingerprint you fetch separately. It is a snapshot of one revision — take the live path when the reader must stay current.",
  },
  {
    kind: "Human",
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
  A package path that can wrap (measured, webkit at 390).

  The paths are in a `.docs-table` cell now, and `signatures/export-manifest.ed25519.json` in a
  `<code>` has no break opportunity in it, so WebKit pushed the document 48px wider than the
  viewport rather than scrolling the table's own container. `<wbr>` after each separator is the
  standard answer and needs no rule in `app/tavonel.css`, which this lane does not own -- and the
  break points it gives (after a slash, after a hyphen) are the ones a reader would choose. The
  root fix, `overflow-wrap: anywhere` on `.docs-table code`, is in the report as a cross-lane
  request, because the same 48px is waiting for the next long value any table on the site prints.
*/
function breakable(path: string) {
  return path.split(/(?<=[/-])/).map((part, index) => (
    <Fragment key={index}>{part}<wbr /></Fragment>
  ));
}


/*
  BQ-100. The four sections of this page, in order, as the title column's navigation.

  The decision puts navigation beside the heading on a reference route and collapses every other
  route to one reading measure; the collapse in `app/product-polish.css` is written as the
  condition -- an H1 alone in that column -- so naming the sections here is the whole of the fix.
  "Next" is not in the list: it is the closing action row, and a jump list whose last entry is
  "the end of the page" is a scrollbar with words on it.
*/
const SECTIONS = [
  "Three ways to use a Compiled World",
  "From sources to a grounded answer",
  "Public tooling",
  "What is in a portable package",
] as const;

export default function DevelopersPage() {
  const sections = tocEntries(SECTIONS);

  return (
    <PublicSitePage>
      <section className="scene doc">
        <div className="shell">
          <div className="body">
            <div className="stack">
              <h1 className="document-title">Give every model the same grounded world.</h1>
              <PageToc entries={sections} />
            </div>
            <div className="stack">
              <p className="lede">
                Compile knowledge once, then reach it live over MCP and the API, or take it away
                as a signed portable package. The model is replaceable. The compiled knowledge is
                the asset.
              </p>

              <h2 id={sections[0].id}>Three ways to use a Compiled World</h2>
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

              <h2 id={sections[1].id}>From sources to a grounded answer</h2>
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
                availability is on the <Link href={"/status" as Route}>status page</Link>.
              </p>

              <div className="stack">
                <h2 id={sections[2].id}>Public tooling</h2>
                <h3>Start with the contract, then a scoped key.</h3>
                <figure className="docs-code">
                  <figcaption>
                    <span>Your first authenticated read</span>
                    <DocsCopyButton value={FIRST_CALL} />
                  </figcaption>
                  <pre tabIndex={0} role="region" aria-label="First API request example"><code>{FIRST_CALL}</code></pre>
                </figure>
                <div className="tiles">
                  <article className="tile"><h3>OpenAPI</h3><p>Machine-readable v1 HTTP contract.</p><TrackedLink className="btn ghost" event="developer_api_started" href="/api/openapi">OpenAPI contract</TrackedLink></article>
                  <article className="tile"><h3>CLI</h3><p>Node.js 20+ client with immutable version and update check.</p><a className="btn ghost" href="/developer/tavonel-cli.mjs" download>Download CLI</a></article>
                  <article className="tile"><h3>MCP</h3><p>{MCP_TOOL_NAMES.length} stdio tools: <code>{MCP_TOOL_NAMES.join(", ")}</code>. No write tool, and it refuses to start if one is added.</p><TrackedLink className="btn ghost" event="developer_mcp_started" href="/developer/tavonel-mcp.mjs" download>Download MCP server</TrackedLink></article>
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
                  <article className="tile"><h3>Source agent</h3><p>Runs inside your network and pushes to TAVONEL, which reaches into nothing. Reads a mounted directory — an SMB, NFS or SFTP mount included — or an S3-compatible bucket. An assisted import route, not a self-serve connector.</p><a className="btn ghost" href="/developer/tavonel-source-agent.py" download>Download source agent</a></article>
                  {/*
                    The two reference verifiers, added when channel.json went from four assets to
                    six (devx CROSS-LANE 1). A customer who could not find them here could still
                    reach them by URL, which is a worse contract than not shipping them: the whole
                    claim of an offline-verifiable export is that the holder has the checker.

                    Hard-coded, like the three above it, and that is the remaining defect (devx M07):
                    a seventh asset can go unlisted the same way these two did. Generating the tiles
                    from channel.json is the root fix and a larger change than this campaign.
                  */}
                  <article className="tile"><h3>Export verifier</h3><p>Checks a downloaded archive offline: the Ed25519 signature against a fingerprint you fetch separately, every file against the digest we signed, and nothing added. Node.js 20+, no dependency.</p><a className="btn ghost" href="/developer/tavonel-verify-export.mjs" download>Download export verifier</a></article>
                  <article className="tile"><h3>Package verifier</h3><p>Checks what is inside the archive: relations resolve, every region sits inside its page in the 0-1000 frame, and the Turtle, JSON-LD and CSV describe the same graph. Add <code>tavonel-verify-roundtrip.py</code> to load it into SQLite and query the ids back.</p><a className="btn ghost" href="/developer/tavonel-verify-package.mjs" download>Download package verifier</a></article>
                </div>
                <p className="fine">Verify versions and SHA-256 values against <a href="/developer/channel.json">the public distribution channel</a>. The <a href="/developer/README.md">setup and safety contract</a> documents scopes, secret handling and fail-closed behavior.</p>
                {/*
                  G3-017. The two recipe scripts /docs/integration-recipes tells a reader to run
                  were in a private repository, so a page whose premise is "these recipes are
                  executed, so a drifted one fails a check rather than your afternoon" asked the
                  reader to take that on trust. They are in the channel now, pinned like the rest.
                */}
                <p className="fine">
                  The two runnable recipes are published too:{" "}
                  <a href="/developer/tavonel-public-sample.py" download>tavonel-public-sample.py</a>{" "}
                  reads the public sample World with no key, and{" "}
                  <a href="/developer/tavonel-recipe-smoke.mjs" download>tavonel-recipe-smoke.mjs</a>{" "}
                  runs all three against a deployment. Every request either one makes is an
                  unauthenticated GET.
                </p>
              </div>

              <div className="stack">
                <h2 id={sections[3].id}>What is in a portable package</h2>
                <p className="fine">
                  Every signed export contains these files, written by the exporter and named in
                  a manifest carrying a digest for each one. The two ontology files are the
                  Compiled World&rsquo;s RDF / JSON-LD semantic projection — a projection of the
                  compiled objects and relations, with no schema for you to author.
                </p>
                <div className="table-scroll">
                <table className="docs-table">
                  <thead><tr><th>Path</th><th>Use it for</th></tr></thead>
                  <tbody>
                    {/*
                      G3-007. This table, /docs/exports and /docs/use-with-ai printed three
                      different archives -- 14 paths, 9 and 11 -- and one of them named a file
                      the exporter does not write. All three render `PACKAGE_CONTENTS` now, which
                      is `REQUIRED_PACKAGE_PATHS` plus the six the writer adds on the way out.
                    */}
                    {PACKAGE_CONTENTS.map(([path, purpose]) => (
                      <tr key={path}>
                        <td data-label="Path"><code>{breakable(path)}</code></td>
                        <td data-label="Use it for">{purpose}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>

              <h2>Next</h2>
              <div className="actions">
                <Link className="btn" href={"/docs/quickstart" as Route}>Run the quickstart</Link>
                {/* BA-184 is reversed here: /api is a rendered reference now, not a stub. G3-004. */}
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

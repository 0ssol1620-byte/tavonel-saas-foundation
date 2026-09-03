import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { PublicSitePage } from "@/components/public-site-chrome";

export const metadata: Metadata = {
  title: "Enterprise — TAVONEL",
  description:
    "Compile enterprise knowledge into a source-grounded, reviewable, portable world, with activation under human control.",
  alternates: { canonical: "/enterprise" },
  openGraph: { url: "/enterprise" },
};

/*
  Rewritten from a boundary diagram into a buyer page.

  The previous version rendered the internal deployment record: cards labelled POLICY-GATED,
  DEPLOYMENT-SPECIFIC, NOT YET and REVIEW REQUIRED, the GPU vendor named in the data path, and a
  summary opening with what the page was not. Every sentence was true and none of it was written
  for the person deciding whether to run a pilot — it showed them our qualification backlog
  instead of what they get.

  What is on this page is what the deployment actually does today. Capabilities that need a
  contract or an unfinished build — SSO and SCIM, dedicated infrastructure, region pinning,
  contractual SLAs — are not listed as "when qualified" cards. They are absent, which is what
  not having them looks like.
*/

const VALUE = [
  [
    "Connected sources",
    "Compile what you already have. Files, folders and archives, or the systems your knowledge lives in — shared drives, object storage and a file-server agent for what never leaves your network.",
  ],
  [
    "Source-level evidence",
    "Every qualified claim and relation carries the document version, page and region it came from. Reviewers and auditors open the actual page, not a paraphrase of it.",
  ],
  [
    "Governed activation",
    "A compile produces a candidate world. It becomes the active world only when a person approves it. Automated extraction never silently becomes organizational truth.",
  ],
  [
    "Versions and rollback",
    "Worlds are versioned. You can see what a compile added, changed and removed, who approved it, and return to the previous version.",
  ],
  [
    "Portable outputs",
    "Ontology, graph, retrieval corpus, provenance and validation leave as one signed package, hash-verified on the way out. Your knowledge is not held by the tool that built it.",
  ],
  [
    "Tenant isolation",
    "Source bytes move between your browser or agent and tenant-scoped storage under a short-lived capability. The application coordinates the work and never proxies a document body.",
  ],
] as const;

const OPERATIONS = [
  ["Identity", "Google sign-in, workspace-scoped access, and tenant identity derived server-side from an authenticated session rather than anything the browser supplies."],
  ["Data handling", "Quarantine, content disarm and isolated analysis before any model sees a document. Customer documents are not used to train shared models."],
  ["Retention and deletion", "Source material, derived artifacts and packages are deletable on request, with the deletion path described in the privacy notice."],
  ["Audit", "Workspace-scoped, append-only records of intake, compilation, review decisions and exports, available as an export."],
  ["Deployment review", "Before a pilot we walk through your sources, volumes, network path, retention needs and the security questions your team has to answer internally."],
  ["Support", "A named contact through the pilot, with response expectations agreed in writing rather than published as a badge."],
] as const;

export default function EnterprisePage() {
  return (
    <PublicSitePage>
      <section className="scene doc">
        <div className="shell">
          <div className="body">
            <div className="stack">
              <p className="slate"><b>ENTERPRISE</b><span />KNOWLEDGE COMPILER</p>
              <h1 className="document-title">Compile enterprise knowledge<br />without giving up control.</h1>
            </div>
            <div className="stack">
              <p className="lede">
                Technical manuals, specifications, contracts, policies and reports become one
                versioned world that your search, your agents and your applications all read from
                — with every result traceable to the page it came from, and activation in the
                hands of your own reviewers.
              </p>

              <div className="tiles">
                {VALUE.map(([title, body]) => (
                  <article className="tile" key={title}>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </article>
                ))}
              </div>

              <p className="slate"><span />HOW IT IS RUN</p>
              <div className="chain">
                {OPERATIONS.map(([title, body]) => (
                  <article className="link" key={title}>
                    <h2>{title}</h2>
                    <p>{body}</p>
                  </article>
                ))}
              </div>

              <div className="actions">
                <Link className="btn" href={"/contact" as Route}>Talk about a pilot</Link>
                <Link className="btn ghost" href={"/explore" as Route}>Explore a Compiled World</Link>
                <Link className="btn ghost" href="/security">How your documents are handled</Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </PublicSitePage>
  );
}

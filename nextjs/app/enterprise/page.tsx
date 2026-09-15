import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import PolicyJumpIndex from "@/components/policy-jump-index";
import { PublicSitePage } from "@/components/public-site-chrome";
import { TrustDisclosures } from "@/components/trust-disclosures";

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
    "Upload files and archives, connect cloud documents read-only, or import private repositories through your own network.",
  ],
  [
    "Source-level evidence",
    "Open a compiled fact at the exact location and source version behind it.",
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
          <div className="body policy-copy">
            <div className="stack">
              <p className="slate"><b>ENTERPRISE</b><span />KNOWLEDGE COMPILER</p>
              <h1 className="document-title">Compile enterprise knowledge<br />without giving up control.</h1>
              {/* G2-040 / G2-041: one jump index for long documents, from the shared component. */}
              <PolicyJumpIndex />
            </div>
            <div className="stack">
              <p className="lede">
                Compile manuals, contracts, policies and reports into one versioned World for
                search, agents and applications. Your reviewers control what becomes active.
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

              {/*
                G2-004 / G2-023 / G2-028. The honesty already existed and was published on
                /trust, which is not the page an enterprise reviewer lands on. A reviewer who
                arrives here from a search result and converts on "Talk about a pilot" used to
                reach a contract conversation without having read one of these lines.

                The rows are `lib/trust-disclosures.ts`, rendered identically on /trust and
                /security, so this page cannot drift into carrying the shorter list.
              */}
              <TrustDisclosures />
              <p className="fine">
                The longer answers are on <Link href={"/trust" as Route}>Trust</Link> and{" "}
                <Link href={"/security" as Route}>Security</Link>, and the{" "}
                <a href="/policy/TAVONEL_DPA_v1_2026-09-11.md">data processing agreement</a> is
                readable now as a draft v1 under review, not as a signed agreement.
              </p>

              {/*
                G2-023's pricing anchor. What this page may state is what the site already
                charges for and how an enterprise number is arrived at; the bands themselves are
                the founder's to set, and the withdrawn sheet is why an invented one is worse
                than none.
              */}
              <p className="slate"><span />WHAT AN ENGAGEMENT COSTS</p>
              <p>
                The published plans and the per-page rate above them are on{" "}
                <Link href={"/pricing#enterprise-pricing" as Route}>Pricing</Link>, in US dollars and excluding tax.
                An enterprise number is quoted after the deployment review, against your page
                volume, your source types and the work that connecting them takes — never before
                it, because every part of that quote depends on what the review finds.
              </p>

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

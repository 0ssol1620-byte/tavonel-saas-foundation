import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import PolicyJumpIndex, { IndexedPolicyBody } from "@/components/policy-jump-index";
import { PublicSitePage } from "@/components/public-site-chrome";
import { EXPLORE_CTA } from "@/lib/site-navigation";

export const metadata: Metadata = {
  title: "Enterprise — TAVONEL",
  description:
    "Compile enterprise knowledge into a source-grounded, reviewable, portable world, with activation under human control.",
  alternates: { canonical: "/enterprise" },
  openGraph: { url: "/enterprise" },
};

const TASKS = [
  [
    "Find answers in approved material",
    "Search the active World and open the source version and exact region behind an answer.",
  ],
  [
    "Review what changed",
    "Compare a candidate with the active World before a person decides whether it becomes available.",
  ],
  [
    "Take a verifiable result with you",
    "Export a signed candidate package with its source inventory, provenance and validation record.",
  ],
] as const;

const PILOT_STEPS = [
  ["Scope", "Agree the decision to improve, the permitted source set and the supported intake path."],
  ["Evaluate", "Compile approved material in a controlled pilot and keep unavailable states visible."],
  ["Measure", "Review source evidence, changes, refusals and the agreed result measures together."],
  ["Activate", "Contract and enable a customer workspace only after the evidence and control gates pass."],
] as const;

const OPERATIONS = [
  ["Identity", "Workspace access is authenticated and scoped to the workspace throughout protected operations."],
  ["Data handling", "Sources enter a workspace-scoped intake boundary and are sanitized before downstream processing. Current processors are listed in the Trust Center."],
  ["Retention and deletion", "Source material, derived artifacts and packages are deletable on request, with the deletion path described in the privacy notice."],
  ["Review records", "Compile progress, review decisions, and relevant administration events can be included in the evidence agreed during scoping."],
  ["Deployment review", "Before a pilot we walk through your sources, volumes, network path, retention needs and the security questions your team has to answer internally."],
  ["Support", "A named contact through the pilot, with response expectations agreed in writing during scoping."],
] as const;

export default function EnterprisePage() {
  return (
    <PublicSitePage>
      <section className="scene doc">
        <div className="shell">
          <div className="body policy-copy"><IndexedPolicyBody>
            <div className="stack">
              <h1 className="document-title">Keep control of the knowledge your AI uses.</h1>
              <PolicyJumpIndex />
            </div>
            <div className="stack">
              <p className="lede">
                Turn approved manuals, contracts, policies and reports into a versioned World.
                Every answer can return to its source, and your reviewers control what becomes active.
              </p>

              <h2>What your team can do</h2>
              <div className="tiles">
                {TASKS.map(([title, body]) => (
                  <article className="tile" key={title}>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </article>
                ))}
              </div>

              <h2>Follow one result back to its source</h2>
              <p className="fine">PUBLIC SAMPLE · SYNTHETIC DATA</p>
              <div className="chain">
                <article className="link"><h3>Source</h3><p>A labeled sample page and source version.</p></article>
                <article className="link"><h3>Change</h3><p>A candidate records what was added, changed or removed.</p></article>
                <article className="link"><h3>Approval</h3><p>A person accepts or refuses the candidate; there is no silent activation.</p></article>
                <article className="link"><h3>Result</h3><p>An answer opens its evidence, and a signed candidate package can be verified offline.</p></article>
              </div>
              <p className="fine">
                This public sample demonstrates the web product contract. It is not customer-path,
                benchmark or production Core evidence.
              </p>

              <h2>How it is run</h2>
              <div className="chain">
                {OPERATIONS.map(([title, body]) => (
                  <article className="link" key={title}>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </article>
                ))}
              </div>

              <h2>From scope to activation</h2>
              <div className="chain">
                {PILOT_STEPS.map(([title, body]) => (
                  <article className="link" key={title}>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </article>
                ))}
              </div>
              <p>
                A pilot produces an agreed source inventory, reviewable candidate results,
                evidence-linked findings and a written go/no-go record. We agree the permitted
                inputs and named-contact support before any material is provided. Processing your
                own documents is arranged with us and is not enabled by purchasing a plan.
              </p>
              <p className="fine">
                Review the maintained public record in the <Link href={"/trust" as Route}>Trust Center</Link> and{" "}
                <Link href={"/security" as Route}>Security</Link>. Deployment-specific architecture,
                control evidence and questionnaire responses are provided during a qualified review.
                The <a href="/policy/TAVONEL_DPA_v1_2026-09-11.md">data processing agreement</a> is
                available as a draft for review and is not presented as a signed agreement.
              </p>

              <h2>What an engagement costs</h2>
              <p>
                The published plans and the per-page rate above them are on{" "}
                <Link href={"/pricing#enterprise-pricing" as Route}>Pricing</Link>, in US dollars and excluding tax.
                An enterprise number is quoted after the deployment review, against your page
                volume, your source types and the work that connecting them takes — never before
                it, because every part of that quote depends on what the review finds.
              </p>

              <div className="actions">
                <Link className="btn" href={"/contact" as Route}>Scope an Enterprise pilot</Link>
                <Link className="btn ghost" href={EXPLORE_CTA.href as Route}>{EXPLORE_CTA.label}</Link>
                <Link className="btn ghost" href="/security">How your documents are handled</Link>
              </div>
            </div>
          </IndexedPolicyBody></div>
        </div>
      </section>
    </PublicSitePage>
  );
}

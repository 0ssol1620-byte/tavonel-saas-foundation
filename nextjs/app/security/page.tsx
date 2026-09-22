import type { Metadata, Route } from "next";
import Link from "next/link";
import { PublicSitePage } from "@/components/public-site-chrome";
import { TrustNext } from "@/components/trust-next";
import TrustProvisions from "@/components/trust-provisions";
import { TRAINING_DATA_CLAIM } from "@/lib/security-claims";

export const metadata: Metadata = {
  alternates: { canonical: "/security" },
  openGraph: { url: "/security" },
  title: "Security — TAVONEL",
  description:
    "How TAVONEL protects source material, separates workspaces, preserves evidence, and keeps activation under human control.",
};

const PROCESSING_PATH = [
  ["Isolate", "Sources enter a workspace-scoped intake boundary and remain separated from other workspaces."],
  ["Sanitize", "Required safety checks complete before source material can move to document analysis."],
  ["Compile", "Only admitted source versions can contribute evidence to a candidate World."],
  ["Review", "A candidate remains inactive until an authorized person approves it."],
] as const;

const CONTROLS = [
  ["Workspace isolation", "Identity and workspace membership are resolved server-side. Data access is scoped to the authenticated workspace and rechecked at protected operations."],
  ["Data protection", "Traffic is encrypted in transit, stored objects are encrypted at rest, and service credentials remain on trusted server boundaries."],
  [TRAINING_DATA_CLAIM.label, TRAINING_DATA_CLAIM.body],
  ["Source controls", "A source that is suspended, deleted or cannot be verified is refused before it can be searched, exported or activated."],
  ["Evidence and audit", "Source versions, evidence references, review decisions and sensitive administration events are recorded so an authorized reviewer can trace what happened."],
  ["Human activation", "Automated processing can prepare a candidate. It cannot silently replace the active World."],
  ["Retention and deletion", "Retention and deletion follow the applicable workspace policy and legal-hold state. The public privacy notice describes the customer-facing process."],
  ["Fail-closed operation", "If a required identity, policy, source or processing check cannot be completed, the protected action is refused rather than treated as successful."],
] as const;

export default function SecurityPage() {
  return (
    <PublicSitePage>
      <section className="scene doc">
        <div className="shell">
          <div className="body">
            <div className="stack">
              <h1 className="document-title">How document processing is controlled.</h1>
            </div>
            <div className="stack">
              <p className="lede">
                Sources remain workspace-scoped through intake, analysis and review. Activation
                remains under human control, and a check that cannot complete blocks the action
                rather than allowing it.
              </p>

              <nav className="fine" aria-label="On this page">
                <b>On this page:</b>{" "}
                <a href="#boundary">Processing boundary</a> ·{" "}
                <a href="#controls">Controls</a> ·{" "}
                <a href="#security-provisions-title">What is in place</a> ·{" "}
                <a href="#assurance">Assurance and review</a>
              </nav>

              <h2 id="boundary">The enforced processing boundary</h2>
              <div className="chain">
                {PROCESSING_PATH.map(([name, text], index) => (
                  <article className="link" key={name}>
                    <span className="st">{String(index + 1).padStart(2, "0")}</span>
                    <h3>{name}</h3>
                    <p>{text}</p>
                  </article>
                ))}
              </div>

              <h2 id="controls">Controls customers can rely on</h2>
              <div className="tiles">
                {CONTROLS.map(([title, body]) => (
                  <article className="tile" key={title}>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </article>
                ))}
              </div>

              {/*
                Gap #6, 2026-09-22. The controls above are what is in place. A reviewer's
                next question is what is not, and the answer was four pages of prose away.
                One content module, three surfaces; this page adds no wording of its own.
              */}
              <TrustProvisions id="security-provisions" />

              <h2 id="assurance">Assurance and review</h2>
              <p>
                Public privacy, subprocessor and disclosure records are maintained in the{" "}
                <Link href={"/trust" as Route}>Trust Center</Link>. A qualified review can also
                receive the architecture, control evidence and questionnaire responses relevant
                to its deployment under an appropriate review process.
              </p>
              <p className="fine">
                Retention and deletion are described in the{" "}
                <Link href={"/privacy" as Route}>privacy notice</Link>. Security questions and
                responsible disclosure reports can be sent through the{" "}
                <Link href={"/contact" as Route}>contact page</Link>.
              </p>

              <div className="actions">
                <Link className="btn" href={"/trust" as Route}>Open the Trust Center</Link>
                <Link className="btn ghost" href={"/subprocessors" as Route}>Subprocessors</Link>
              </div>
            </div>
            <TrustNext from="/security" />
          </div>
        </div>
      </section>
    </PublicSitePage>
  );
}

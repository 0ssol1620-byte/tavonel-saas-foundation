import type { Metadata } from "next";
import Link from "next/link";
import Logomark from "@/components/logomark";
import { BOUNDARY } from "@/lib/evidence-record";
import { activationPolicy } from "@/lib/activation-policy";

export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/security" },
  openGraph: { url: "/security" },
  title: "Where your documents go — TAVONEL",
  description:
    "The path a document takes through TAVONEL, what holds its bytes, what never sees them, and the current capability controls.",
};

/**
 * D2 -- the question a buyer asks second, answered in one place.
 *
 * The first question is "what does it do", and the front page answers it. The second is "where
 * do my documents go", and before this page the answer was four sentences inside a marketing
 * scene. That is not enough for the person who has to sign off on it, and it is too much for the
 * person still deciding whether to read on -- which is exactly why the two now live apart.
 *
 * Everything here is written from `docs/SECURITY_BOUNDARIES.md`. Nothing on this page is a
 * certification, an audit result or a compliance claim: this deployment holds none, and saying
 * otherwise is barred. What it can honestly say is what the architecture does and does not do,
 * and which capabilities are switched off right now.
 */

const CAPABILITY_LABELS = {
  customerIntake: "Customer document intake",
  cdr: "Content disarm and reconstruction",
  ocrGpu: "GPU OCR candidate processing",
  candidatePromotion: "Candidate promotion into a live world",
} as const;

const PATH = [
  ["The browser", "Holds a short-lived, narrowly scoped upload capability, issued only after the server has checked who you are, what you are entitled to, and what quota is left. It never holds a service key, a webhook secret, storage credentials or a signing credential."],
  ["Object storage", "Tenant-scoped quarantine holds the bytes. This is the only place a document body exists."],
  ["The application", "Coordinates contracts and never proxies a document body. A large file does not pass through a request handler."],
  ["The database", "Stores metadata and immutable proof references. It never stores document bytes."],
] as const;

export default function SecurityPage() {
  return (
    <div className="page">
      <header className="nav" data-stuck={1}>
        <Link href="/" className="wordmark" aria-label="TAVONEL home">
          <Logomark />
          <b>TAVONEL</b>
        </Link>
        <nav aria-label="Sections">
          <Link href="/">Back to the compiler</Link>
          <Link href="/evidence">Evidence</Link>
        </nav>
        <Link className="btn small" href="/login">Sign in</Link>
      </header>

      <main id="main" tabIndex={-1}>
        <section className="scene doc">
          <div className="shell">
            <div className="body">
              <div className="stack">
                <p className="slate"><b>RECORD</b><span />SECURITY &amp; DATA PATH</p>
                <h1 className="document-title">Where your documents go,<br />and what never sees them.</h1>
              </div>
              <div className="stack">
                <p className="lede">
                  Automation can propose. Promotion is a decision. The path:
                  browser (signed direct upload) → quarantine → sanitize / CDR → isolated analysis → candidate world → human promotion.
                  <b> Every external operation fails closed</b> — a control opens only after the one before it is qualified.
                  This page holds no certification and claims none.
                </p>

                <p className="slate"><span />THE BOUNDARY, IN THE ORDER IT IS ENFORCED</p>
                <div className="chain">
                  {BOUNDARY.map(([num, name, text]) => (
                    <article className="link" key={num}>
                      <span className="st">{num}</span>
                      <h2>{name}</h2>
                      <p>{text}</p>
                    </article>
                  ))}
                </div>

                <p className="slate"><span />WHAT HOLDS WHAT</p>
                <div className="chain">
                  {PATH.map(([name, text]) => (
                    <article className="link" key={name}>
                      <h2>{name}</h2>
                      <p>{text}</p>
                    </article>
                  ))}
                </div>
                <p className="fine">
                  Tenant identity is derived server-side from an authenticated session, never from
                  an identifier the browser supplies. Provider credentials &mdash; authentication,
                  billing, storage, content disarm &mdash; are managed server-side secrets; the
                  browser may hold a provider&rsquo;s own publishable token and nothing else.
                </p>

                <p className="slate"><span />CURRENT DEPLOYMENT CONTROLS</p>
                <div className="status-list">
                  {Object.entries(activationPolicy).map(([key, value]) => (
                    <article key={key} data-state={value.enabled ? "operational" : "restricted"}>
                      <span>{value.enabled ? "enabled" : "human gate"}</span>
                      <h2>{CAPABILITY_LABELS[key as keyof typeof CAPABILITY_LABELS]}</h2>
                      <p>{value.reason}</p>
                    </article>
                  ))}
                </div>
                <p className="fine">
                  Intake, content disarm and GPU OCR opened only after the recorded 2026-08-29
                  full-sequence qualification. Promotion remains closed by design: a candidate
                  becomes active only after an authenticated human approval.
                </p>

                <div className="actions">
                  <Link className="btn" href="/evidence">What we measured</Link>
                  <Link className="btn ghost" href="/#s5">See what access is open</Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="site">
        <div className="shell">
          <span className="wordmark"><Logomark /><b>TAVONEL</b></span>
          <p className="fine">
            Nothing on this page is a demonstration, an audit result or a compliance claim. It
            describes the architecture and current controls this deployment enforces.
          </p>
        </div>
      </footer>
    </div>
  );
}

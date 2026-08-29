"use client";

/**
 * Home — SPEC §1.4: not a company page, a 56-second product demonstration that becomes the tool
 * on its last frame, with below-the-fold sections as supporting evidence.
 *
 * Section order is §1.4's: Compilation Replay → Public Proof → Personal/Team/Enterprise →
 * Security → Research → CTA. Each below-fold section answers exactly one objection.
 *
 * Routes are only linked when they exist (§8.6). `/demo/world`, `/demo/dart` and `/demo/sec`
 * live in the Core Engine repository and are not deployed here, so they are described rather
 * than linked — the same fail-closed rule the rest of foundation mode runs on.
 */

import Link from "next/link";
import { useState } from "react";
import ReplayStage from "@/components/replay-stage";
import { ACTS, SHOTS } from "@/lib/cinematic/shots";
import { CTA, MOTION_LAW } from "@/lib/cinematic/copy";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

const plans = [
  ["Observer", "$29", "A considered first step."],
  ["Studio", "$99", "For teams building a governed corpus."],
  ["Institution", "Talk to us", "For policy-led knowledge operations."],
] as const;

const creditPacks = [
  ["Starter", "$12", "100 credits"],
  ["Builder", "$30", "300 credits"],
  ["Scale", "$75", "800 credits"],
] as const;

const scales = [
  ["PERSONAL", "Your PC already contains\na world.", "Your projects. Your people. Your decisions.\nAlways connected. Always current."],
  ["TEAM", "One person has context.\nA team needs shared truth.", "Shared context. Shared decisions.\nShared truth."],
  ["ENTERPRISE", "Now connect\nthe company.", "One continuously updated view\nof what your organization knows."],
] as const;

const chain = [
  ["01", "Quarantine", "Browser-direct, tenant-scoped intake. Document bytes never pass through the application or the database.", "held"],
  ["02", "Sanitize", "Antivirus and mandatory content disarm, with the sanitization proof kept as evidence.", "held"],
  ["03", "Understand", "Only sanitized artifacts reach analysis. A parser gets no tools, no broad credentials, no outbound network.", "held"],
  ["04", "Review", "A person decides before anything is promoted. Automated analysis produces a candidate, never a world.", "review"],
] as const;

export default function HomePage() {
  const [notice, setNotice] = useState<string | null>(null);

  const showNotice = () =>
    setNotice("Foundation mode is active. Provider configuration and sandbox qualification are required before this action is available.");
  const showCreditNotice = () =>
    setNotice("This credit pack is staged for Paddle sandbox only. No payment session or GPU capacity is created in foundation mode.");
  const showProofNotice = () =>
    setNotice("The public-filing proof surface is built in the Core Engine repository and is not deployed here yet. It is described rather than linked, because a route that does not exist is not advertised.");

  const signIn = async () => {
    const client = getSupabaseBrowserClient();
    if (!client) return showNotice();
    const redirectTo = `${window.location.origin}/auth/callback`;
    const { error } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
    if (error) setNotice("Google sign-in could not start. Testing-mode users only.");
  };

  return (
    <>
      <header className="masthead">
        <div>
          <Link href="/" className="wordmark">
            <b>TAVONEL</b>
            <span>THE KNOWLEDGE COMPILER</span>
          </Link>
          <span className="mode" title="Foundation mode: no document bytes, payment sessions or GPU capacity are created.">
            <i aria-hidden="true" />FOUNDATION MODE
          </span>
          <nav>
            <a href="#argument">Sequence</a>
            <a href="#proof">Proof</a>
            <a href="#scale">Scale</a>
            <a href="#security">Security</a>
            <a href="#pricing">Pricing</a>
          </nav>
          <button className="signin" onClick={signIn}>Sign in</button>
          <button className="btn small" onClick={showNotice}>{CTA.primary}</button>
        </div>
      </header>

      <main>
        {/* ---------------------------------------------------------- the replay */}
        <section className="shell stage-wrap">
          <div className="stage-lead">
            <p className="t-brand">THE KNOWLEDGE COMPILER</p>
            <h1 className="t-statement">Watch scattered files become one current world.</h1>
            <p className="t-lead">
              Fifty-six seconds, then the controls are yours. Nothing below is a recording of a
              screen — it is the interface drawing a compilation from its own event stream.
            </p>
          </div>
          <ReplayStage />
          <p className="law">{MOTION_LAW}</p>
        </section>

        {/* ---------------------------------------------------------- static argument layer */}
        <section id="argument" className="shell band">
          <div className="band-head">
            <span className="kicker">THE WHOLE SEQUENCE</span>
            <h2 className="t-section">Written out, in case you would rather read it.</h2>
            <span className="objection">reduced motion · search · without JavaScript</span>
          </div>
          <p className="prose t-body" style={{ marginBottom: 22 }}>
            This is the same argument the replay makes, in text. It is one build serving four
            jobs — the reduced-motion path, the document a crawler indexes, the accessibility
            route, and the first thing painted. One truth, several projections.
          </p>
          <div className="argument">
            {ACTS.map((act) => (
              <div key={act.id} style={{ display: "contents" }}>
                <div className="arg-act">
                  <b>{act.title}</b>
                  <span>{act.from.toFixed(2)} – {act.to.toFixed(2)}s</span>
                </div>
                {SHOTS.filter((s) => s.act === act.id).map((s) => (
                  <div className="arg-beat" key={s.id} data-gate={s.gate ? 1 : 0}>
                    <span className="id">{s.id}</span>
                    <span className="tt">{s.startSeconds.toFixed(2)}–{s.endSeconds.toFixed(2)}</span>
                    <span className="nm">{s.beat}</span>
                    <span className="tk">{s.takeaway}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------- 1 · public proof */}
        <section id="proof" className="shell band">
          <div className="band-head">
            <span className="kicker">PUBLIC PROOF</span>
            <h2 className="t-section">Not only a sample that flatters us.</h2>
            <span className="objection">“that world was built to look good”</span>
          </div>
          <p className="prose t-body" style={{ marginBottom: 22 }}>
            The sequence above runs on a fictional fixture, and says so on screen. The
            counterweight is a real public filing: real page rasters, real bounding boxes, real
            tables, a real source receipt — opened and checked by you, not asserted by us.
          </p>
          <div className="tiles">
            <article className="tile">
              <span className="n">DART</span>
              <h3>Korean public filings</h3>
              <p>Compile a disclosure and compare two revisions. What changed in meaning, and what only changed in wording.</p>
            </article>
            <article className="tile">
              <span className="n">SEC</span>
              <h3>US public filings</h3>
              <p>The same treatment on EDGAR documents, where every figure returns to a page and a cell.</p>
            </article>
            <article className="tile">
              <span className="n">WHY THIS INSTEAD</span>
              <h3>No customer logos, on purpose</h3>
              <p>A brand rule here bars customer logos, certifications and performance claims without registered evidence. A document you can open yourself is the stronger substitute.</p>
            </article>
          </div>
          <p style={{ marginTop: 16 }}>
            <button className="btn ghost small" onClick={showProofNotice}>Why this is not linked yet</button>
          </p>
        </section>

        {/* ---------------------------------------------------------- 2 · scale */}
        <section id="scale" className="shell band">
          <div className="band-head">
            <span className="kicker">ONE WORLD, THREE SCALES</span>
            <h2 className="t-section">The same compiler, pointed at more of your life.</h2>
            <span className="objection">“why would I need this”</span>
          </div>
          <div className="scales">
            {scales.map(([lv, head, body]) => (
              <article className="scale" key={lv}>
                <span className="lv">{lv}</span>
                <h3>{head}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------- 3 · security */}
        <section id="security" className="shell band dark">
          <div className="band-head">
            <span className="kicker">SOURCE BOUNDARY</span>
            <h2 className="t-section">Every document is treated as hostile data.</h2>
            <span className="objection">“why would I give you my files”</span>
          </div>
          <div className="chain">
            {chain.map(([n, name, text, state]) => (
              <article className="link" key={n}>
                <span className="st">{n}</span>
                <h3>{name}</h3>
                <p>{text}</p>
                <span className="state" data-s={state}>{state}</span>
              </article>
            ))}
          </div>
          <p className="fine block" style={{ marginTop: 18 }}>
            Designed to fail closed. Each control opens only after the one before it is qualified,
            and every state above is the live one — not an illustration. No document bytes are
            accepted during foundation mode.
          </p>
        </section>

        {/* ---------------------------------------------------------- 4 · research */}
        <section id="research" className="shell band">
          <div className="band-head">
            <span className="kicker">EVIDENCE</span>
            <h2 className="t-section">What is measured, and what is only built.</h2>
            <span className="objection">“does any of this actually work”</span>
          </div>
          <div className="tiles">
            <article className="tile">
              <span className="n">MEASURED</span>
              <h3>Recovery changes the outcome</h3>
              <p>On a public benchmark with an unmodified scoring path, the recovery runtime moved a document extraction score substantially. It is our own measurement, published with its confidence interval — never placed beside a competitor’s number as if reproduced.</p>
            </article>
            <article className="tile">
              <span className="n">MEASURED</span>
              <h3>Compilation refuses more than it emits, sometimes</h3>
              <p>Of a thousand documents offered in one campaign, four hundred and four were refused — every one for a link the compiler could not resolve. A vault with a broken link is not emitted, by design.</p>
            </article>
            <article className="tile">
              <span className="n">NOT SUPPORTED</span>
              <h3>Blind quality detection failed</h3>
              <p>We tested whether prediction-only signals could pick the worst documents without ground truth. They could not beat ranking by length alone. It is published as unsupported and is not shipped as a feature.</p>
            </article>
            <article className="tile">
              <span className="n">BUILT, NOT PROVEN</span>
              <h3>Most thresholds are uncalibrated</h3>
              <p>Tests show the code does what its author intended. They do not show a threshold is right. Nothing here presents an uncalibrated threshold as a measured result.</p>
            </article>
          </div>
        </section>

        {/* ---------------------------------------------------------- 5 · pricing / CTA */}
        <section id="pricing" className="shell band">
          <div className="band-head">
            <span className="kicker">MEASURED ACCESS</span>
            <h2 className="t-section">Plans for serious work.</h2>
            <span className="objection">“so what do I do next”</span>
          </div>
          <p className="prose t-body" style={{ marginBottom: 22 }}>
            Presentation-only prices. A signed Paddle sandbox entitlement is required before
            checkout can be opened.
          </p>
          <div className="plans">
            {plans.map(([name, price, text]) => (
              <article className="plan" key={name} data-featured={name === "Studio" ? 1 : 0}>
                <span className="tag">{name === "Studio" ? "PRIVATE PILOT CHOICE" : ""}</span>
                <h3>{name}</h3>
                <span className="price">{price}{price.startsWith("$") ? <small> / month</small> : null}</span>
                <p>{text}</p>
                <button className="btn ghost" onClick={showNotice}>
                  {name === "Institution" ? "Start a conversation" : "Choose this plan"}
                </button>
              </article>
            ))}
          </div>

          <div className="band-head" style={{ marginTop: 48 }}>
            <span className="kicker">DELIBERATE COMPUTE</span>
            <h2 className="t-section">Access is steady. GPU work is measured.</h2>
          </div>
          <p className="prose t-body" style={{ marginBottom: 22 }}>
            Credits are reserved before a qualified job, settled against observed runtime, and
            never created by a checkout redirect. A future verified signup is designed for one
            2-credit, 7-day trial; issuance remains unavailable until the controlled processing
            path is qualified.
          </p>
          <div className="packs">
            {creditPacks.map(([name, price, credits]) => (
              <article className="pack" key={name}>
                <span className="tag">PREPAID CAPACITY</span>
                <h3>{name}</h3>
                <span className="price">{price} <small>{credits}</small></span>
                <button className="btn ghost" onClick={showCreditNotice}>Preview pack</button>
              </article>
            ))}
          </div>
          <p className="fine block" style={{ marginTop: 18 }}>
            No unlimited GPU plans. Hard job and workspace caps remain active even after a future
            credit purchase.
          </p>

          <div style={{ display: "flex", gap: 12, marginTop: 34, flexWrap: "wrap" }}>
            <button className="btn" onClick={showNotice}>{CTA.primary}</button>
            <Link className="btn ghost" href="/workspace">Explore the foundation</Link>
          </div>
        </section>
      </main>

      <footer className="site shell">
        <div className="row2">
          <span className="wordmark"><b>TAVONEL</b><span>THE KNOWLEDGE COMPILER</span></span>
        </div>
        <p style={{ marginTop: 16 }}>
          The sequence above runs on a declared fictional fixture and is labelled as such on
          screen. It is not a recording of a compiler run: the canonical event schema and a
          recorded run are both prerequisites that do not exist yet, and the label will change
          only when they do. Prices are presentation-only. No document bytes, payment sessions or
          GPU capacity are created in foundation mode.
        </p>
      </footer>

      {notice ? (
        <p className="notice" role="status">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss">Dismiss</button>
        </p>
      ) : null}
    </>
  );
}

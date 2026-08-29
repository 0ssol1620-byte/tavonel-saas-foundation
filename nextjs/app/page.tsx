"use client";

/**
 * Home.
 *
 * Structure (8 scenes, one continuous world):
 *
 *   Act I   01 The mess -> 02 Compile -> 03 The compiled world
 *   ---     interlude
 *   Act II  04 Something changes -> 05 Rebuild & verify
 *   Act III 06 The answer -> 07 Evidence & boundary -> 08 Access
 *
 * Act I earns the world before Act II protects it. An earlier version opened on a document
 * revision and spent nine scenes on selective recompilation -- the harder half of the
 * engineering and the smaller half of the value. Leading with it invites one reaction from a
 * first-time visitor: *so?* Recompilation only becomes interesting once the thing being
 * recompiled exists.
 *
 * This was twelve scenes and 13.3 screens. It is eight, and nothing was cut but repetition:
 * connect/compile/work-that-stops all argued that the preparation disappears, the rebuild
 * console and the publish record printed the same nine figures twice, and the boundary chain
 * duplicated the status grid's open-or-closed reading. Where two sections carried one claim,
 * the claim stayed and the second section went.
 *
 * Scenes 07 and 08 are not demonstration. The source boundary and the research posture describe
 * this deployment's real state, and the capability grid reads it live from `/api/status` --
 * fail-closed, so an unreachable endpoint reports "unknown" and never "available". Everything in
 * scenes 01-06 is declared fictional fixture data, said on screen in the hero and the footer.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AnswerSwitch from "@/components/answer-switch";
import ChangeLattice from "@/components/change-lattice";
import CompilePipeline from "@/components/compile-pipeline";
import Logomark from "@/components/logomark";
import RebuildConsole from "@/components/rebuild-console";
import WorldField, { type WorldMode } from "@/components/world-field";
import { AREAS, CHANGE, DISCLOSURE, KEPT, REBUILT, SOURCE_CENSUS, WORLD, n } from "@/lib/demo-world";
import { useCheckout } from "@/lib/use-checkout";
import { loginUrlForOffer } from "@/lib/checkout-intent";
import { trackFunnel } from "@/lib/funnel-events";
import type { BillingOfferCode } from "@/lib/billing-catalog";
import { readCapabilities, type StatusResponse } from "@/lib/capabilities";
import { useScrollProgress, useScrollScenes } from "@/lib/use-scroll-scenes";

/* ------------------------------------------------------------------ scene definitions */

const SCENES = [
  { id: 1, label: "THE MESS", mode: "scatter", state: "SCATTERED", version: "v0", facts: null },
  { id: 2, label: "COMPILE", mode: "structure", state: "COMPILING", version: "v0", facts: null },
  { id: 3, label: "COMPILED WORLD", mode: "current", state: "COMPILED", version: `v${WORLD.versionBefore}`, facts: WORLD.facts },
  { id: 4, label: "SOMETHING CHANGES", mode: "change", state: "CHANGED", version: `v${WORLD.versionBefore}`, facts: WORLD.facts },
  { id: 5, label: "REBUILD & VERIFY", mode: "recompile", state: "VERIFIED", version: `v${WORLD.versionAfter}`, facts: WORLD.facts },
  { id: 6, label: "THE ANSWER", mode: "answer", state: "CURRENT", version: `v${WORLD.versionAfter}`, facts: WORLD.facts },
  { id: 7, label: "EVIDENCE & BOUNDARY", mode: "current", state: "CURRENT", version: `v${WORLD.versionAfter}`, facts: WORLD.facts },
  { id: 8, label: "ACCESS", mode: "current", state: "CURRENT", version: `v${WORLD.versionAfter}`, facts: WORLD.facts },
] as const;

/** Filenames as a visitor's own drive would show them: dated, versioned, and not tidy. */
const DEBRIS = [
  "Handbook_2026_FINAL.pdf", "Handbook_2026_FINAL_v2.pdf", "scan_0140.pdf",
  "Q3 forecast.xlsx", "acme/product-docs", "Untitled folder (3)",
  "Customer Research 2026.zip", "Operations Manual.docx", "pricing_OLD.csv",
  "support.acme.com", "Board deck.pptx", "contract_signed.pdf",
];

/**
 * The kinds of system a compile points at. One chip each: the six-row ledger this replaced said
 * the same thing at six times the height, and the shape of the answer is the point rather than
 * a per-source byte count nobody reads.
 */
const SOURCES = ["Shared drives", "Document stores", "Code repositories", "Scanned archives", "Help centre", "Long-lived threads"];

/** The preparation work a team normally does by hand before any retrieval system is trusted. */
const STOPS = [
  "Collecting the files", "Deciding which copy is real", "Running OCR on scans",
  "Choosing a parser per format", "Pulling tables out of PDFs", "Rebuilding heading structure",
  "Cleaning metadata", "Merging duplicate entities", "Resolving naming conflicts",
  "Deciding chunk boundaries", "Writing the taxonomy", "Mapping relationships",
  "Wiring citations back to sources", "Re-running all of it next quarter",
];

/**
 * Scene 07 -- real. The document boundary this deployment enforces. Deliberately carries no
 * state pill: whether each control is open right now is the status grid's job, one scene down,
 * and having both say it was the clearest duplication on the old page.
 */
const BOUNDARY = [
  ["01", "Quarantine", "Browser-direct, tenant-scoped intake. Document bytes never pass through the application or the database."],
  ["02", "Sanitize", "Antivirus and mandatory content disarm, with the sanitization proof kept as evidence."],
  ["03", "Understand", "Only sanitized artifacts reach analysis. A parser gets no tools, no broad credentials, no outbound network."],
  ["04", "Review", "A person decides before anything is promoted. Automated analysis produces a candidate, never a world."],
] as const;

/** Scene 07 -- real. What has been measured, and what has only been built. */
const EVIDENCE = [
  ["measured", "Recovery changes the outcome", "On a public benchmark with an unmodified scoring path, the recovery runtime moved a document extraction score substantially. Our own measurement, published with its confidence interval, and never placed beside a competitor's number as if reproduced."],
  ["measured", "Compilation refuses more than it emits, sometimes", "Of a thousand documents offered in one campaign, four hundred and four were refused, every one for a link the compiler could not resolve. A vault with a broken link is not emitted, by design."],
  ["unsupported", "Blind quality detection failed", "We tested whether prediction-only signals could pick the worst documents without ground truth. They could not beat ranking by length alone. Published as unsupported, and not shipped as a feature."],
  ["unproven", "Most thresholds are uncalibrated", "Tests show the code does what its author intended. They do not show a threshold is right. Nothing here presents an uncalibrated threshold as a measured result."],
] as const;

const PLANS = [
  ["Observer", "$29", "A considered first step.", "observer_access"],
  ["Studio", "$99", "For teams building a governed corpus.", "studio_access"],
  ["Institution", "Talk to us", "For policy-led knowledge operations.", null],
] as const;

const PACKS = [
  ["Starter", "$12", "100 credits", "credit_starter"],
  ["Builder", "$30", "300 credits", "credit_builder"],
  ["Scale", "$75", "800 credits", "credit_scale"],
] as const;

/* ----------------------------------------------------------------------------- the page */

export default function HomePage() {
  const [notice, setNotice] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const { start: startCheckout, busy: billingBusy } = useCheckout(setNotice);

  const scene = useScrollScenes(SCENES.length);
  const progress = useScrollProgress();
  const active = SCENES.find((s) => s.id === scene) ?? SCENES[0];
  const capabilities = useMemo(() => readCapabilities(status, statusFailed), [status, statusFailed]);
  /**
   * Gates the grid does not report as open. Direction rows are excluded on purpose: they are not
   * gates that could be opened, so counting them here would overstate what is being withheld.
   */
  const heldRows = useMemo(
    () => capabilities.filter((cap) => cap.tone !== "open" && cap.tone !== "direction"),
    [capabilities],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/status", { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as StatusResponse;
        if (!cancelled) setStatus(body);
      } catch {
        if (!cancelled) setStatusFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { getSupabaseBrowserClient } = await import("@/lib/supabase-browser");
      const client = getSupabaseBrowserClient();
      if (!client || cancelled) return;
      const { data } = await client.auth.getSession();
      if (!cancelled) setSignedIn(Boolean(data.session));
      client.auth.onAuthStateChange((_event, session) => {
        if (!cancelled) setSignedIn(Boolean(session));
      });
    })();
    return () => { cancelled = true; };
  }, []);

  const showNotice = () =>
    setNotice("Foundation mode is active. Provider configuration and sandbox qualification are required before this action is available.");

  /**
   * R1 -- the intent to buy survives the sign-in.
   *
   * All six controls in scene 08 used to end here for a signed-out visitor: a toast saying "sign
   * in first", and then a workspace that had forgotten which plan they picked. The choice is now
   * carried to /login and resumed on the other side. The URL names an offer code and never a
   * price; the server still owns the allow-list.
   */
  const chooseOffer = (offerCode: BillingOfferCode) => {
    trackFunnel("offer_selected", { offer: offerCode, signedIn: signedIn ? "yes" : "no" });
    if (signedIn) {
      void startCheckout(offerCode);
      return;
    }
    window.location.assign(loginUrlForOffer(offerCode));
  };

  const jump = (id: number) => {
    document.getElementById(`s${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  /**
   * What the bar offers, by where the reader is. The page argues in order -- mess, compile,
   * world, change, rebuild, answer, evidence, access -- so the useful control is the next link in
   * that argument, not the last one.
   */
  const nextStep = ((): { label: string; run: () => void } => {
    if (scene <= 2) return { label: "SEE THE COMPILED WORLD", run: () => jump(3) };
    if (scene <= 4) return { label: "SEE IT REBUILD", run: () => jump(5) };
    if (scene === 5) return { label: "SEE THE ANSWER", run: () => jump(6) };
    if (scene === 6) return { label: "SEE THE EVIDENCE", run: () => jump(7) };
    if (scene === 7) return { label: "GET ACCESS", run: () => jump(8) };
    return signedIn
      ? { label: "OPEN WORKSPACE", run: () => window.location.assign("/workspace") }
      : { label: "SIGN IN", run: () => window.location.assign("/login") };
  })();

  return (
    <div className="page">
      <WorldField mode={active.mode as WorldMode} />

      <header className="nav" data-stuck={progress > 0.005 ? 1 : 0}>
        <Link href="/" className="wordmark" aria-label="TAVONEL home">
          <Logomark />
          <b>TAVONEL</b>
        </Link>
        <span className="mode" title="Foundation mode: billing is sandbox-only and GPU capacity remains separately gated.">
          <i aria-hidden="true" />
          FOUNDATION MODE
        </span>
        <nav aria-label="Sections">
          <button type="button" onClick={() => jump(2)}>Compile</button>
          <button type="button" onClick={() => jump(5)}>Keep current</button>
          <button type="button" onClick={() => jump(7)}>Evidence</button>
          <button type="button" onClick={() => jump(8)}>Access</button>
        </nav>
        {/*
          R4 -- the nav carried one verb, and it was the wrong one for most visitors. "Sign in" is
          what a returning pilot user needs; a first-time reader has no account to sign in to and
          nothing else to click. The primary verb now points at what this page can actually give
          them -- the access section, with the live capability grid at the top of it -- and sign-in
          stays as the quieter control for people who already have a workspace.
        */}
        {signedIn ? (
          <Link className="btn small" href="/workspace">Open workspace</Link>
        ) : (
          <>
            <button className="btn small ghost" type="button" onClick={() => jump(8)}>Get access</button>
            <Link className="btn small" href="/login">Sign in</Link>
          </>
        )}
      </header>

      <div className="rail" aria-hidden="true">
        {SCENES.map((s) => (
          <button key={s.id} type="button" className={s.id === scene ? "tick on" : "tick"} onClick={() => jump(s.id)} tabIndex={-1}>
            <i />
            {String(s.id).padStart(2, "0")}
          </button>
        ))}
      </div>

      <main>
        {/* ═══════════════════════════════════════════════════ 01 · the mess */}
        <section className="scene hero" id="s1" data-scene="1">
          <div className="shell">
            <p className="slate rv"><b>TAVONEL</b><span /> KNOWLEDGE COMPILER</p>
            <h1>
              <span className="line"><i>Your knowledge is everywhere.</i></span>
              <span className="line dim"><i>Compile it.</i></span>
            </h1>
            <p className="lede rv">
              TAVONEL turns scattered files, documents, cloud drives and repositories into
              structured, <b>AI-ready knowledge</b> &mdash; and keeps it correct as your sources change.
            </p>
            <div className="actions rv">
              <button className="btn" type="button" onClick={() => jump(2)}>Watch it compile</button>
              {/* "Request access" pointed at /login, which is a sign-in and not a request. The hero now
                  uses the same verb as the nav and sends people to the section that can answer it. */}
              <button className="btn ghost" type="button" onClick={() => jump(8)}>Get access</button>
            </div>
            <div className="debris rv">
              {DEBRIS.map((name) => <span className="frag" key={name}>{name}</span>)}
            </div>
            <div className="chaos rv">
              <Cell value={n(SOURCE_CENSUS.files)} label="Files" />
              <Cell value={SOURCE_CENSUS.bytes} label={`Across ${SOURCE_CENSUS.systems} systems`} />
              <Cell value={n(SOURCE_CENSUS.nearDuplicates)} label="Near-duplicates" warn />
              <Cell value={n(SOURCE_CENSUS.competingVersions)} label="Competing versions" warn />
              <Cell value={n(SOURCE_CENSUS.scansWithoutTextLayer)} label="Scans with no text layer" warn />
              <Cell value="&mdash;" label="Relationships between any of it" warn />
            </div>
            <p className="fine rv">
              This is what a company actually looks like before anyone tries to put an AI on top
              of it. {DISCLOSURE.fixture}
            </p>
          </div>
        </section>

        {/* ═══════════════════════ 02 · compile (was connect + compile + work that stops) */}
        <Scene id={2} eyebrow="COMPILE" title={<>Six passes turn {n(SOURCE_CENSUS.files)} files into a world.</>}>
          <p className="lede rv">
            You point at the systems your work already lives in and leave them exactly as they
            are &mdash; no export, no restructuring, no tidying the drive first. Reading them is the
            easy part. What takes a team months is everything after it: what a document actually
            says, which of four copies is real, what each thing <i>is</i>, and how it all
            connects. <b>That is the compile</b> &mdash; and every task in the second list below
            stops being a project the moment it runs.
          </p>
          <div className="sources rv">
            {SOURCES.map((source) => <span className="src" key={source}>{source}</span>)}
          </div>
          <CompilePipeline active={scene >= 2} />
          <div className="stops rv">
            {STOPS.map((task, index) => (
              // The index drives the sweep delay, so the fourteen strikes read as one authored
              // pass down the list rather than fourteen simultaneous cross-outs.
              <span className="stop" key={task} style={{ "--i": index } as React.CSSProperties}><i /><span>{task}</span></span>
            ))}
          </div>
          <div className="beforeafter rv">
            <span><b data-tone="changed">Weeks</b>by hand, before</span>
            <span><b data-tone="verified">A compile</b>after</span>
          </div>
        </Scene>

        {/* ═══════════════════════════════════════════════════ 03 · the compiled world */}
        <Scene id={3} eyebrow="COMPILED WORLD" title={<>Not searchable files.<br />An organization an&nbsp;AI can reason about.</>}>
          <p className="lede rv">
            TAVONEL works out how your knowledge fits together &mdash; what the things are, what area
            they belong to, what supports them and what they affect. <b>This returns a structure.</b>
          </p>
          <div className="panel rv">
            <div className="panel-head"><span>knowledge architecture</span><span className="right">GENERATED &middot; {AREAS.length} AREAS</span></div>
            <div className="arch">
              <div className="t1">COMPANY KNOWLEDGE<span>{n(WORLD.facts)}</span></div>
              {AREAS.map((area) => (
                <div className="t2" key={area.name}>{area.name}<span>{n(area.facts)}</span></div>
              ))}
            </div>
          </div>
          <div className="panel rv">
            <div className="panel-head"><span>one fact, and where it came from</span><span className="right">DEMO DATA</span></div>
            <div className="chain2">
              <p className="fact">Employees work from the office 2 days per week</p>
              {[
                ["Source", `${CHANGE.document} · version ${CHANGE.revisionTo}`],
                ["Evidence", "“Employees are expected in the office 2 days per week, down from 3 under the previous policy.” · §3.2 · page 7 · lines 14–16"],
                ["Entity", "Office attendance policy"],
                ["Depends on", "New-hire onboarding guide · Remote-work exception process"],
              ].map(([k, v]) => (
                <div className="cr" key={k}><span className="k">{k}</span><span className="v">{v}</span></div>
              ))}
            </div>
          </div>
          <p className="fine rv">{DISCLOSURE.ontology}</p>
        </Scene>

        <ChangeLattice />

        {/* ═══════════════════════════════════════════════════ 04 · something changes */}
        <Scene id={4} eyebrow="SOMETHING CHANGES" title="A compile that only ever runs once is worthless.">
          <p className="lede rv">
            Contracts get amended. Specs move. Policies are revised, code lands, prices change,
            people leave. Compiling your knowledge is the first half of the job.
            <b> Keeping it true is the half that never ends</b> &mdash; and the half that quietly breaks
            every retrieval system built on a schedule.
          </p>
          <div className="panel rv">
            <div className="panel-head"><span>{CHANGE.document}</span><span className="right">VERSION {CHANGE.revisionFrom} &rarr; {CHANGE.revisionTo}</span></div>
            <div className="diff">
              <p className="ctx">§3.2 Office attendance</p>
              <p className="del">Employees work from the office 3 days per week</p>
              <p className="add">Employees work from the office 2 days per week</p>
              <p className="ctx">§5.4 Expense approval</p>
              <p className="del">Expenses above $500 need director approval</p>
              <p className="add">Expenses above $1,000 need director approval</p>
              <p className="ctx">§9.1 Parental leave &middot; 12 weeks &rarr; 16 weeks</p>
            </div>
          </div>
          <div className="legend rv">
            <div className="lg"><span className="pill" data-v="stale">CHANGED</span><p>The source now says something different.</p></div>
            <div className="lg"><span className="pill" data-v="held">NEEDS REVIEW</span><p>Two readings are possible. TAVONEL will not pick one for you.</p></div>
            <div className="lg"><span className="pill" data-v="current">AFFECTED</span><p>Not edited, but depends on something that was.</p></div>
            <div className="lg"><span className="pill" data-v="unchanged">UNTOUCHED</span><p>Proven unconnected to the change, and carried across.</p></div>
          </div>
        </Scene>

        {/* ═══════════════════════════ 05 · rebuild & verify (was rebuild + verify) */}
        <Scene id={5} eyebrow="REBUILD & VERIFY" title={<>Rebuild {REBUILT}.<br />Keep {n(KEPT)}.</>}>
          <p className="lede rv">
            Three lines moved in one handbook. A system that re-indexes on a schedule would read
            all {n(WORLD.facts)} facts again to find them. TAVONEL follows the dependency graph,
            rebuilds the {REBUILT} facts the change actually reached, carries the rest forward
            untouched &mdash; and then <b>nothing goes live until it passes.</b>
          </p>
          <RebuildConsole active={scene >= 5} />
          <div className="checks rv">
            {[
              "Every fact still points at real text",
              "Nothing depends on something deleted",
              "Kept facts proven unconnected to the change",
              "Documents rebuilt from current facts only",
              "Version history unbroken",
              `${CHANGE.held} fact held back for review`,
            ].map((check, index) => (
              <span className="check" key={check} data-hold={index === 5 ? 1 : 0}><i />{check}</span>
            ))}
          </div>
          <p className="fine rv">
            Signed build #{n(WORLD.buildNumber)} &middot; world v{WORLD.versionBefore} &rarr; v{WORLD.versionAfter},
            set off by {CHANGE.document} version {CHANGE.revisionFrom} &rarr; {CHANGE.revisionTo}. A draft world is
            not a live world, and the record of what produced it is kept &mdash; so any answer your AI
            gives can be traced back to the exact version it came from.
          </p>
        </Scene>

        {/* ═══════════════════════════════════════════════════ 06 · the answer */}
        <Scene id={6} eyebrow="THE ANSWER" title={<>The same question,<br />asked of two worlds.</>}>
          <p className="lede rv">
            On the left is the world as it stood before the handbook changed &mdash; the one a system
            that re-indexes on a schedule would still be answering from. On the right, the world
            TAVONEL published two minutes later. <b>Same question. Same files. Different truth.</b>
          </p>
          <AnswerSwitch />
        </Scene>

        {/* ═══════════════════ 07 · evidence & boundary (was source boundary + evidence) */}
        <Scene id={7} eyebrow="EVIDENCE & BOUNDARY" title={<>What we enforce,<br />and what we actually measured.</>}>
          <p className="lede rv">
            Everything above this line is a demonstration. Everything below it is not. There are no
            customer logos on this page and no certifications &mdash; a brand rule bars them without
            registered evidence &mdash; so what follows is our own record instead, <b>including the
            part of it that did not work.</b>
          </p>
          <div className="chain rv">
            {BOUNDARY.map(([num, name, text]) => (
              <article className="link" key={num}>
                <span className="st">{num}</span>
                <h3>{name}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
          <div className="tiles rv">
            {EVIDENCE.map(([state, title, body]) => (
              <article className="tile" key={title} data-state={state}>
                <span className="n">{state === "measured" ? "MEASURED" : state === "unsupported" ? "NOT SUPPORTED" : "BUILT, NOT PROVEN"}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
          <p className="fine rv">
            Designed to fail closed: each control opens only after the one before it is qualified,
            and document bytes never pass through the application or the database. Whether each
            control is open in this deployment right now is the grid below.
          </p>
        </Scene>

        {/* ═══════════════════════════════════════════════════ 08 · access */}
        <Scene id={8} eyebrow="ACCESS" title={<>Stop preparing<br />data for AI.</>}>
          <p className="lede rv">
            TAVONEL compiles everything you know into a structured, AI-ready world &mdash; and keeps
            that world correct as reality changes.
          </p>

          {/*
            R3 -- the boundary is stated before the price, not after it.

            The grid used to sit below both pricing blocks, so a visitor read six controls and a
            currency symbol before they were told which of those controls this deployment actually
            has open. Reversing the order costs the page nothing, and it removes the one thing that
            makes a fail-closed product read as an overclaiming one.
          */}
          <div className="band-head rv"><span className="kicker">STATUS</span><h3>What exists in this deployment, right now.</h3></div>
          <div className="caps rv">
            {capabilities.map((cap) => (
              <div className="cap" key={cap.name} data-tone={cap.tone} title={cap.note}>
                <span className="cap-n">{cap.name}</span>
                <span className="cap-s">{cap.state}</span>
              </div>
            ))}
          </div>
          <p className="fine rv">
            Read live from this deployment when the page loads, not written by hand. A row this
            page cannot confirm reads <b>Unknown</b> &mdash; it never defaults to available.
          </p>

          {heldRows.length > 0 ? (
            <p className="fine rv held">
              {heldRows.length} of the {capabilities.length} controls above {heldRows.length === 1 ? "is" : "are"} not
              open in this deployment. Buying access does not open any of them &mdash; each opens
              only when the control behind it is qualified.
            </p>
          ) : null}

          <div className="band-head rv"><span className="kicker">MEASURED ACCESS</span><h3>Plans for serious work.</h3></div>
          <div className="plans rv">
            {PLANS.map(([name, price, text, offerCode]) => (
              <article className="plan" key={name} data-featured={name === "Studio" ? 1 : 0}>
                <span className="tag">{name === "Studio" ? "PRIVATE PILOT CHOICE" : " "}</span>
                <h3>{name}</h3>
                <span className="price">{price}{price.startsWith("$") ? <small> / month</small> : null}</span>
                <p>{text}</p>
                <button
                  className="btn ghost"
                  type="button"
                  disabled={Boolean(billingBusy)}
                  onClick={() => (offerCode ? chooseOffer(offerCode) : showNotice())}
                >
                  {name === "Institution" ? "Start a conversation" : billingBusy === offerCode ? "Opening checkout…" : signedIn ? "Choose this plan" : "Choose this plan → sign in"}
                </button>
              </article>
            ))}
          </div>

          <div className="band-head rv"><span className="kicker">DELIBERATE COMPUTE</span><h3>Access is steady. GPU work is measured.</h3></div>
          <div className="packs rv">
            {PACKS.map(([name, price, credits, offerCode]) => (
              <article className="pack" key={name}>
                <span className="tag">PREPAID CAPACITY</span>
                <h3>{name}</h3>
                <span className="price">{price} <small>{credits}</small></span>
                <button className="btn ghost" type="button" disabled={Boolean(billingBusy)} onClick={() => chooseOffer(offerCode)}>
                  {billingBusy === offerCode ? "Opening checkout…" : signedIn ? "Buy credits" : "Buy credits → sign in"}
                </button>
              </article>
            ))}
          </div>
          <p className="fine rv">
            Secure Paddle sandbox checkout, for signed-in pilot users. Access changes only after a
            signed, idempotently persisted webhook &mdash; never on a checkout redirect. Credits are
            reserved before a qualified job and settled against observed runtime. No unlimited GPU
            plans; hard job and workspace caps stay active even after a purchase.
          </p>

          <div className="actions rv" style={{ marginTop: 30 }}>
            <Link className="btn" href={signedIn ? "/workspace" : "/login"}>
              {signedIn ? "Open workspace" : "Sign in with Google"}
            </Link>
            <button className="btn ghost" type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
              Replay from the start
            </button>
          </div>
        </Scene>
      </main>

      <footer className="site">
        <div className="shell">
          <span className="wordmark"><Logomark /><b>TAVONEL</b></span>
          <p className="fine">
            {DISCLOSURE.staged} Paddle checkout is sandbox-only; signed webhooks persist access and
            prepaid credits, while GPU capacity remains separately gated. No customer,
            certification, benchmark or performance claim is represented on this page.
          </p>
        </div>
      </footer>

      <div className="bar" role="status" aria-live="off">
        <span className="scroll" style={{ width: `${progress * 100}%` }} />
        <span className="bc"><span className="bk">WORLD</span><span className="bv">{active.version}</span></span>
        <span className="bc"><span className="bk">STATE</span><span className="bv state" data-s={active.state.toLowerCase()}>{active.state}</span></span>
        <span className="bc opt"><span className="bk">FACTS</span><span className="bv">{active.facts ? n(active.facts) : "—"}</span></span>
        <span className="bc opt"><span className="bk">NEEDS REVIEW</span><span className="bv">{scene >= 4 ? CHANGE.held : 0}</span></span>
        {/*
          R5 -- the scene rail is hidden below 900px, which left a phone with no way to move
          through an eight-scene page except by scrolling all of it. The ticks come back here,
          in the one element that is on screen at every scroll position.
        */}
        <span className="bar-ticks" aria-label="Scenes">
          {SCENES.map((sc) => (
            <button
              key={sc.id}
              type="button"
              className={sc.id === scene ? "bt on" : "bt"}
              aria-label={`Scene ${sc.id}: ${sc.label}`}
              aria-current={sc.id === scene ? "true" : undefined}
              onClick={() => jump(sc.id)}
            />
          ))}
        </span>
        <span className="bc right"><span className="bv">SCENE {String(active.id).padStart(2, "0")} &middot; {active.label}</span></span>
        {/*
          R2 -- the bar reported state and never offered a move. A visitor three scenes in had the
          whole argument in front of them and no control anywhere on screen. This one changes with
          the scene, so it is always the next thing rather than a fixed CTA following them down
          the page.
        */}
        <button className="bar-next" type="button" onClick={nextStep.run}>{nextStep.label}</button>
      </div>

      {notice ? (
        <p className="notice" role="status">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">Dismiss</button>
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------------ pieces */

function Cell({ value, label, warn }: { value: string; label: string; warn?: boolean }) {
  return (
    <div className="ch">
      <span className={warn ? "ch-v warn" : "ch-v"} dangerouslySetInnerHTML={{ __html: value }} />
      <span className="ch-k">{label}</span>
    </div>
  );
}

function Scene({
  id,
  eyebrow,
  title,
  children,
}: {
  id: number;
  eyebrow: string;
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="scene" id={`s${id}`} data-scene={id}>
      <div className="shell">
        <div className="body">
          <div className="stack">
            <p className="slate rv"><b>SCENE {String(id).padStart(2, "0")}</b><span />{eyebrow}</p>
            <h2 className="rv">{title}</h2>
          </div>
          <div className="stack">{children}</div>
        </div>
      </div>
    </section>
  );
}

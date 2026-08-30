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
import ReadingDemo from "@/components/reading-demo";
import Logomark from "@/components/logomark";
import RebuildConsole from "@/components/rebuild-console";
import WorldField, { type WorldMode } from "@/components/world-field";
import { AREAS, CHANGE, DISCLOSURE, KEPT, REBUILT, SOURCE_CENSUS, WORLD, n } from "@/lib/demo-world";
import { useCheckout } from "@/lib/use-checkout";
import { loginUrlForOffer } from "@/lib/checkout-intent";
import { trackFunnel, trackSceneDepth } from "@/lib/funnel-events";
import type { BillingOfferCode } from "@/lib/billing-catalog";
import { readCapabilities, type StatusResponse } from "@/lib/capabilities";
import { useScrollProgress, useScrollScenes } from "@/lib/use-scroll-scenes";

/* ------------------------------------------------------------------ scene definitions */

/**
 * B1 -- five scenes, seven states of the world.
 *
 * There were eight numbered scenes, and a first-time reader had to agree to eight full-viewport
 * stops before reaching anything they could buy. Two pairs argued the same point twice -- the
 * compile and what it produced, the change and the rebuild that answers it -- so each pair is
 * now one scene. The eighth, our own evidence record, is a page of its own at /evidence: it is
 * the most convincing thing we have and the least useful thing to put in front of someone who
 * has not yet decided what this is.
 *
 * What the merge must not cost is the field behind the page, which has a distinct state for
 * every step of the argument. So the two are separated: a scene is what the rail and the
 * eyebrow count, a band is what the world does. A merged scene contains two bands and moves
 * the world twice while the reader counts one.
 */
const SCENES = [
  { id: 1, label: "THE MESS" },
  { id: 2, label: "COMPILE" },
  { id: 3, label: "KEEPING IT TRUE" },
  { id: 4, label: "THE ANSWER" },
  { id: 5, label: "ACCESS" },
] as const;

type BandName = "scatter" | "structure" | "world" | "change" | "rebuild" | "answer" | "access";

const BANDS: Record<BandName, { mode: WorldMode; state: string; version: string; facts: number | null }> = {
  scatter: { mode: "scatter", state: "SCATTERED", version: "v0", facts: null },
  structure: { mode: "structure", state: "COMPILING", version: "v0", facts: null },
  world: { mode: "current", state: "COMPILED", version: `v${WORLD.versionBefore}`, facts: WORLD.facts },
  change: { mode: "change", state: "CHANGED", version: `v${WORLD.versionBefore}`, facts: WORLD.facts },
  rebuild: { mode: "recompile", state: "VERIFIED", version: `v${WORLD.versionAfter}`, facts: WORLD.facts },
  answer: { mode: "answer", state: "CURRENT", version: `v${WORLD.versionAfter}`, facts: WORLD.facts },
  access: { mode: "current", state: "CURRENT", version: `v${WORLD.versionAfter}`, facts: WORLD.facts },
};

/** Reading order, so "have we reached the change yet" is one comparison rather than a set. */
const BAND_ORDER: BandName[] = ["scatter", "structure", "world", "change", "rebuild", "answer", "access"];

/** Filenames as a visitor's own drive would show them: dated, versioned, and not tidy. */
const DEBRIS = [
  "Agreement_FINAL.pdf", "Agreement_FINAL_v2.pdf", "scan_0140.pdf",
  "Q3 forecast.xlsx", "acme/product-docs", "Untitled folder (3)",
  "Customer Research 2026.zip", "Operations Manual.docx", "pricing_OLD.csv",
  "support.acme.com", "Board deck.pptx", "Employee Handbook 2026.pdf",
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

  const { scene, band } = useScrollScenes(SCENES.length);
  const progress = useScrollProgress();
  const active = SCENES.find((s) => s.id === scene) ?? SCENES[0];
  const world = BANDS[(band as BandName) in BANDS ? (band as BandName) : "scatter"];
  const reachedChange = BAND_ORDER.indexOf(band as BandName) >= BAND_ORDER.indexOf("change");
  const capabilities = useMemo(() => readCapabilities(status, statusFailed), [status, statusFailed]);
  /**
   * Gates the grid does not report as open. Direction rows are excluded on purpose: they are not
   * gates that could be opened, so counting them here would overstate what is being withheld.
   */
  const heldRows = useMemo(
    () => capabilities.filter((cap) => cap.tone !== "open" && cap.tone !== "direction"),
    [capabilities],
  );

  /**
   * E2 -- where people stop reading.
   *
   * This is the one number the page cannot get from inspection. Everything else about the
   * argument -- whether it is clear, whether it is honest, whether it is too long -- can be
   * judged by looking at it. Whether anyone gets past scene 03 cannot.
   */
  useEffect(() => { trackSceneDepth(scene); }, [scene]);

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
   * Calls to action are counted by *where they sit*, not by what they say. Labels are copy and
   * copy gets rewritten; "hero_primary" survives the rewrite and stays comparable across it.
   *
   * The scene rail and the nav's section links are deliberately not counted here. They are
   * navigation -- a reader moving around inside the argument -- and folding them in would make
   * a page that is easy to browse look like a page that converts.
   */
  const cta = (name: string, run: () => void) => () => {
    trackFunnel("cta_clicked", { cta: name, scene: String(scene) });
    run();
  };

  /**
   * What the bar offers, by where the reader is. The page argues in order -- mess, compile,
   * keeping it true, answer, access -- so the useful control is the next link in that argument,
   * not the last one.
   */
  const nextStep = ((): { label: string; run: () => void } => {
    if (scene <= 1) return { label: "WATCH IT COMPILE", run: () => jump(2) };
    if (scene === 2) return { label: "SEE IT KEEP UP", run: () => jump(3) };
    if (scene === 3) return { label: "SEE THE ANSWER", run: () => jump(4) };
    if (scene === 4) return { label: "GET ACCESS", run: () => jump(5) };
    return signedIn
      ? { label: "OPEN WORKSPACE", run: () => window.location.assign("/workspace") }
      : { label: "SIGN IN", run: () => window.location.assign("/login") };
  })();

  return (
    <div className="page">
      <WorldField mode={world.mode} />

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
          <button type="button" onClick={() => jump(3)}>Keep current</button>
          <Link href="/evidence">Evidence</Link>
          <button type="button" onClick={() => jump(5)}>Access</button>
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
          <Link className="btn small" href="/login">Sign in</Link>
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

      <main id="main">
        {/* ═══════════════════════════════════════════════════ 01 · the mess */}
        <section className="scene hero" id="s1" data-scene="1" data-band="scatter">
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
            {/*
              C1 -- who this is for, said as a situation rather than an industry.
              Naming a vertical would exclude everyone outside it and convince nobody inside it.
              A situation does the opposite: a reader either recognises it in the first clause or
              is told, in the second, that they can stop reading. The disqualifier is not modesty;
              it is the fastest way to be believed by the people who do recognise it.
            */}
            <p className="who rv">
              For teams whose answers live in documents that keep changing — agreements, specs,
              policies, price lists, procedures. <b>If your files never change, you do not need this.</b>
            </p>
            {/*
              A4 -- one verb above the fold. There were four controls in the first screen: two in
              the nav and two here, offering three different next steps to a reader who had been
              given one sentence to decide on. The page's own argument is that it is worth
              watching, so the fold now asks for exactly that, and sign-in stays as the quiet
              control for people who already have a workspace.
            */}
            <div className="actions rv">
              <button className="btn" type="button" onClick={cta("hero_primary", () => jump(2))}>Watch it compile</button>
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

        {/*
          C2 -- the rule this page is built on, moved up from the footer.
          It was true before and legible only to whoever read the small print at the very bottom.
          Stated here, it is a claim the rest of the page can be checked against rather than a
          disclaimer filed after the argument is over.
        */}
        <div className="creed">
          <div className="shell">
            <span className="creed-k">THE RULE</span>
            <p>
              No customer logos. No certifications. No benchmark numbers. <b>A brand rule bars them
              without registered evidence</b> — so rather than borrow anyone else’s credibility, we
              publish <Link href="/evidence">our own record</Link>, including the part of it that
              did not work.
            </p>
          </div>
        </div>
        {/* ═══════════════════════ 02 · compile (was connect + compile + work that stops) */}
        <Scene id={2} band="structure" eyebrow="COMPILE" title={<>Six passes turn {n(SOURCE_CENSUS.files)} files into a world.</>}>
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
          {/*
            B5 -- the first pass, shown rather than summarised.
            Reading is one line in the ledger below and it is the line people do not believe, so
            it happens here first: a page of the agreement, region by region, with the words that
            came out of each one and the confidence the reader gave it. It is the same view the
            workspace draws during a real read, on declared fixture data like everything else in
            this demonstration.
          */}
          <ReadingDemo active={scene >= 2} />
          <p className="fine rv">
            One page of {CHANGE.documentPages}, at the reader’s own pace.
            The region marked at 0.57 is an ink stamp, and it is shown as uncertain because it is
            — a reader that never reports doubt cannot be believed later when it says a document
            needs a person.
          </p>
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

        {/* ──────────────── 02b · what the compile produced (was scene 03) */}
        <SceneMore id={2} band="world" eyebrow="COMPILED WORLD" title={<>Not searchable files.<br />An organization an&nbsp;AI can reason about.</>}>
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
              <p className="fact">Invoices are due 30 days after receipt</p>
              {[
                ["Source", `${CHANGE.document} · version ${CHANGE.revisionTo}`],
                ["Evidence", "“Payment is due within 30 days of receipt of a valid invoice, reduced from 45 under the previous schedule.” · §3.2 · page 7 · lines 14–16"],
                ["Entity", "Payment terms"],
                ["Depends on", "Purchase order template · Late-payment escalation"],
              ].map(([k, v]) => (
                <div className="cr" key={k}><span className="k">{k}</span><span className="v">{v}</span></div>
              ))}
            </div>
          </div>
          <p className="fine rv">{DISCLOSURE.ontology}</p>
        </SceneMore>

        <ChangeLattice />

        {/* ═══════════════════════════════════════════════════ 04 · something changes */}
        <Scene id={3} band="change" eyebrow="KEEPING IT TRUE" title="A compile that only ever runs once is worthless.">
          <p className="lede rv">
            Contracts get amended. Specs move. Policies are revised, code lands, prices change,
            people leave. Compiling your knowledge is the first half of the job.
            <b> Keeping it true is the half that never ends</b> &mdash; and the half that quietly breaks
            every retrieval system built on a schedule.
          </p>
          <div className="panel rv">
            <div className="panel-head"><span>{CHANGE.document}</span><span className="right">VERSION {CHANGE.revisionFrom} &rarr; {CHANGE.revisionTo}</span></div>
            <div className="diff">
              <p className="ctx">§3.2 Payment terms</p>
              <p className="del">Invoices are due 45 days after receipt</p>
              <p className="add">Invoices are due 30 days after receipt</p>
              <p className="ctx">§5.4 Change orders</p>
              <p className="del">Work above $50,000 needs a signed change order</p>
              <p className="add">Work above $25,000 needs a signed change order</p>
              <p className="ctx">§9.1 Termination notice &middot; 30 days &rarr; 60 days</p>
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
        <SceneMore id={3} band="rebuild" eyebrow="REBUILD & VERIFY" title={<>Rebuild {REBUILT}.<br />Keep {n(KEPT)}.</>}>
          <p className="lede rv">
            Three lines moved in one contract. A system that re-indexes on a schedule would read
            all {n(WORLD.facts)} facts again to find them. TAVONEL follows the dependency graph,
            rebuilds the {REBUILT} facts the change actually reached, carries the rest forward
            untouched &mdash; and then <b>nothing goes live until it passes.</b>
          </p>
          <RebuildConsole active={scene >= 3} />
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
        </SceneMore>

        {/* ═══════════════════════════════════════════════════ 06 · the answer */}
        <Scene id={4} band="answer" eyebrow="THE ANSWER" title={<>The same question,<br />asked of two worlds.</>}>
          <p className="lede rv">
            On the left is the world as it stood before the contract changed &mdash; the one a system
            that re-indexes on a schedule would still be answering from. On the right, the world
            TAVONEL published two minutes later. <b>Same question. Same files. Different truth.</b>
          </p>
          <AnswerSwitch />
        </Scene>

        {/* ═══════════════════════════════════════════════════ 08 · access */}
        <Scene id={5} band="access" eyebrow="ACCESS" title={<>Stop preparing<br />data for AI.</>}>
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
          {/*
            The two pages that carry the claims this one makes. They are in the footer rather
            than the nav because that is where someone goes looking for them -- after the
            argument, not during it -- and the rule band already links the record from the top.
          */}
          <nav className="site-links" aria-label="More">
            <Link href="/evidence">What we measured</Link>
            <Link href="/security">Where your documents go</Link>
          </nav>
          <p className="fine">
            {DISCLOSURE.staged} Paddle checkout is sandbox-only; signed webhooks persist access and
            prepaid credits, while GPU capacity remains separately gated. No customer,
            certification, benchmark or performance claim is represented on this page.
          </p>
        </div>
      </footer>

      <div className="bar" role="status" aria-live="off">
        <span className="scroll" style={{ width: `${progress * 100}%` }} />
        <span className="bc"><span className="bk">WORLD</span><span className="bv">{world.version}</span></span>
        <span className="bc"><span className="bk">STATE</span><span className="bv state" data-s={world.state.toLowerCase()}>{world.state}</span></span>
        <span className="bc opt"><span className="bk">FACTS</span><span className="bv">{world.facts ? n(world.facts) : "—"}</span></span>
        <span className="bc opt"><span className="bk">NEEDS REVIEW</span><span className="bv">{reachedChange ? CHANGE.held : 0}</span></span>
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
        <button className="bar-next" type="button" onClick={cta("instrument_bar", nextStep.run)}>{nextStep.label}</button>
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
  band,
  eyebrow,
  title,
  children,
}: {
  id: number;
  band: BandName;
  eyebrow: string;
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="scene" id={`s${id}`} data-scene={id} data-band={band}>
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

/**
 * The second half of a merged scene: the same scene number, the next state of the world.
 *
 * It reports the scene it continues, so the rail and the instrument bar do not count it, and it
 * carries its own band, so the field moves under it. No number in the margin, a lighter heading
 * and no viewport floor -- the reader should experience one scene that develops, not two scenes
 * where one forgot its number.
 */
function SceneMore({
  id,
  band,
  eyebrow,
  title,
  children,
}: {
  id: number;
  band: BandName;
  eyebrow: string;
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="scene cont" data-scene={id} data-band={band}>
      <div className="shell">
        <div className="body">
          <div className="stack">
            <p className="slate rv"><span />{eyebrow}</p>
            <h3 className="rv sub">{title}</h3>
          </div>
          <div className="stack">{children}</div>
        </div>
      </div>
    </section>
  );
}

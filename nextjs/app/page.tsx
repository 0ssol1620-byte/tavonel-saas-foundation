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
import type { Route } from "next";
import { Fragment, cloneElement, isValidElement, useEffect, useMemo, useRef, useState } from "react";
import AnswerSwitch from "@/components/answer-switch";
import CanvasTransitionLink from "@/components/canvas-transition-link";
import ChangeLattice from "@/components/change-lattice";
import CompilePipeline from "@/components/compile-pipeline";
import ReadingDemo from "@/components/reading-demo";
import EvidenceTether from "@/components/evidence-tether";
import IdentityResolve from "@/components/identity-resolve";
import Logomark from "@/components/logomark";
import RebuildConsole from "@/components/rebuild-console";
import WorldField, { type WorldMode } from "@/components/world-field";
import { AREAS, CHANGE, DISCLOSURE, KEPT, REBUILT, SOURCE_CENSUS, WORLD, n } from "@/lib/demo-world";
import { trackFunnel, trackSceneDepth } from "@/lib/funnel-events";
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
  { id: 4, label: "USE THE WORLD" },
  { id: 5, label: "PROOF & ACCESS" },
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

const DESTINATIONS = ["Retrieval", "Agents", "MCP", "API", "Search", "Your applications"];

/**
 * C6 -- what leaves with the customer. Every line is a thing the workspace already does.
 *
 * Written from the export path rather than from ambition: the package is a hash-verified
 * directory of files, it is signed with Ed25519, and the public half of the signing key is
 * served at /api/export/trust so the signature can be checked without an account here.
 */
const TAKEAWAY = [
  ["The package", "A directory of files, not a database dump: the ontology, the graph, the retrieval corpus and the provenance, each one hash-verified on the way out."],
  ["The signature", "Signed with Ed25519 over the payload digest. A package that has been altered stops verifying."],
  ["The public key", "Published, so the signature can be checked by a third party who has no account here and no reason to trust us."],
] as const;

/* ----------------------------------------------------------------------------- the page */

export default function HomePage() {
  const [notice, setNotice] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);

  const { scene, band } = useScrollScenes(SCENES.length);
  const progress = useScrollProgress();
  const active = SCENES.find((s) => s.id === scene) ?? SCENES[0];
  const world = BANDS[(band as BandName) in BANDS ? (band as BandName) : "scatter"];
  /**
   * The opening move.
   *
   * The field had seven states and reached none of them until the reader scrolled into scene 02.
   * On a wide screen that was survivable -- the graph sits beside the panels and a fresh load
   * still looks alive. On a phone the panels fill the width, the field is behind them, and the
   * first two and a half screens of the most watchable thing on this page were completely
   * still. So the world starts drawing itself as soon as the page is up: scattered on arrival,
   * then pulled a third of the way in, under the headline, before anyone has scrolled at all.
   *
   * `ingest` already existed as a mode and no scene ever used it. It is exactly this state.
   *
   * It waits rather than starting at zero because the move has to be seen to begin. A field
   * that is already drifting when the first frame paints reads as a static texture; one that is
   * still, and then starts, reads as a machine that just woke up.
   */
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setTimeout(() => setOpened(true), 900);
    return () => window.clearTimeout(timer);
  }, []);

  /**
   * D9 -- one button gets to lean toward the reader.
   *
   * The instrument bar's control is where every scene's argument funnels to, so it is the one
   * place a magnetic pull earns its keep. Applied to more than one control it would read as a
   * page-wide tic rather than an emphasis, which is why this ref points at exactly one button.
   *
   * Written through `--mx`/`--my` rather than a bare inline `transform` so `.bar-next:active` in
   * CSS can still win the property outright on click -- a press should settle the button, not
   * keep it leaning toward wherever the pointer last was.
   */
  const barNextRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const button = barNextRef.current;
    if (!button) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    const RANGE = 70;
    const PULL = 0.32;
    let raf = 0;
    const reset = () => { button.style.removeProperty("--mx"); button.style.removeProperty("--my"); };
    const onMove = (event: PointerEvent) => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        const box = button.getBoundingClientRect();
        const dx = event.clientX - (box.left + box.width / 2);
        const dy = event.clientY - (box.top + box.height / 2);
        const dist = Math.hypot(dx, dy);
        if (dist < RANGE) {
          const pull = (1 - dist / RANGE) * PULL;
          button.style.setProperty("--mx", `${dx * pull}px`);
          button.style.setProperty("--my", `${dy * pull}px`);
        } else {
          reset();
        }
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (raf) window.cancelAnimationFrame(raf);
      reset();
    };
  }, []);
  const fieldMode: WorldMode = band === "scatter" && opened ? "ingest" : world.mode;
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
    if (scene <= 1) return { label: "WATCH IT COMPILE", run: () => window.location.assign("/film") };
    if (scene === 2) return { label: "KEEPING IT TRUE", run: () => jump(3) };
    if (scene === 3) return { label: "USE THE WORLD", run: () => jump(4) };
    if (scene === 4) return { label: "PROOF & ACCESS", run: () => jump(5) };
    return signedIn
      ? { label: "OPEN WORKSPACE", run: () => window.location.assign("/workspace") }
      : { label: "SIGN IN", run: () => window.location.assign("/login") };
  })();

  return (
    <div className="page landing-page">
      <WorldField mode={fieldMode} />

      <header className="nav" data-stuck={progress > 0.005 ? 1 : 0}>
        <Link href="/" className="wordmark" aria-label="TAVONEL home">
          <Logomark />
          <b>TAVONEL</b>
        </Link>
        {/*
          C3 -- the same facts, named as the decision they are.
          "FOUNDATION MODE" reads to a buyer as "not finished yet". It is not: this deployment is
          deliberately closed while each control is qualified, the search index is closed too,
          and the plans already call the middle tier the private pilot choice. The badge now says
          which of those it is, and the exact meaning stays one hover away rather than being
          replaced by a vaguer word.
        */}
        <span className="mode" title="Private pilot: this deployment is invitation-only, billing runs in Paddle sandbox, and GPU capacity stays separately gated until each control is qualified.">
          <i aria-hidden="true" />
          PRIVATE PILOT
        </span>
        <nav aria-label="Sections">
          <button type="button" onClick={() => jump(2)}>Compile</button>
          <Link href="/product">Product</Link>
          <Link href="/research">Research</Link>
          <Link href="/developers">Developers</Link>
          <Link href="/evidence">Evidence</Link>
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

      <main id="main" tabIndex={-1}>
        {/* ═══════════════════════════════════════════════════ 01 · the mess */}
        <section className="scene hero" id="s1" data-scene="1" data-band="scatter">
          <div className="shell">
            <p className="slate"><b>TAVONEL</b><span /> KNOWLEDGE COMPILER</p>
            <h1>
              <span className="line"><i>{revealWords("Compile your knowledge")}</i></span>
              <span className="line dim"><i>{revealWords("into a world AI can reason about.", 4)}</i></span>
            </h1>
            <p className="lede rv">
              Documents, scans, code and connected systems go in.
              <b> Structured knowledge, evidence, graph and retrieval artifacts come out.</b>
            </p>
            <div className="actions rv">
              <CanvasTransitionLink href="/film" className="btn">Watch it compile</CanvasTransitionLink>
              <Link className="btn ghost" href={signedIn ? "/workspace" : "/login"}>Compile sample data</Link>
            </div>
            <p className="fine rv">
              <Link href="/evidence">Read the evidence</Link>
              {" · "}Measured where we have evidence. Marked as research where we do not.
            </p>
            {/*
              The mess, arriving as one.

              This is the only element on the first screen whose subject is disorder, and it was
              the tidiest thing on it: an evenly spaced, left-aligned, perfectly wrapped list of
              filenames, which reads as a set of tags rather than as somebody's drive. Each chip
              now sits at its own slight angle and arrives on its own beat. The offsets come from
              the index rather than from a random draw, so the server and the client render the
              same page and the disorder is the same disorder every time.
            */}
            <div className="debris">
              {DEBRIS.map((name, index) => (
                <span
                  className="frag"
                  key={name}
                  style={{ "--i": index, "--tilt": `${(((index * 37) % 11) - 5) * 0.5}deg` } as React.CSSProperties}
                >
                  {name}
                </span>
              ))}
            </div>
            <div className="chaos">
              <Cell value={n(SOURCE_CENSUS.files)} label="Files" />
              <Cell value={SOURCE_CENSUS.bytes} label={`Across ${SOURCE_CENSUS.systems} systems`} />
              <Cell value={n(SOURCE_CENSUS.nearDuplicates)} label="Near-duplicates" warn />
              <Cell value={n(SOURCE_CENSUS.competingVersions)} label="Competing versions" warn />
              <Cell value={n(SOURCE_CENSUS.scansWithoutTextLayer)} label="Scans with no text layer" warn />
              <Cell value="&mdash;" label="Relationships between any of it" warn />
            </div>
            <p className="fine">
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
              <b>Measured where we have evidence. Marked as research where we do not.</b>
              {" "}Detail lives in the <Link href="/evidence">evidence record</Link>.
            </p>
          </div>
        </div>
        {/* ═══════════════════════ 02 · compile (was connect + compile + work that stops) */}
        <Scene id={2} band="structure" eyebrow="COMPILE" title="Files are only the source material.">
          <p className="lede rv">
            TAVONEL reads the document, reconstructs its structure, resolves versions and identities,
            maps relationships, keeps the evidence attached, and compiles the result into reusable
            knowledge. <b>READ → RECONSTRUCT → RESOLVE → MODEL → VERIFY → COMPILE.</b>
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
          <IdentityResolve active={scene >= 2} />
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
          <EvidenceTether active={scene >= 2} />
          <p className="fine rv">{DISCLOSURE.ontology}</p>
        </SceneMore>

        <ChangeLattice />

        {/* ═══════════════════════════════════════════════════ 04 · something changes */}
        <Scene id={3} band="change" eyebrow="KEEPING IT TRUE" title="Knowledge changes when reality does.">
          <p className="lede rv">
            A revised source should not silently leave yesterday’s answer in today’s AI.
            <b> The compiler is designed to follow those dependencies, hold ambiguity, and rebuild
            only what the change reached.</b>
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
          <p className="fine rv">
            Research direction shown on declared demonstration data until measurement closes.
            {DISCLOSURE.fixture}
          </p>
        </Scene>
        <SceneMore id={3} band="rebuild" eyebrow="REBUILD & VERIFY" title={<>Rebuild {REBUILT}.<br />Keep {n(KEPT)}.</>}>
          <p className="lede rv">
            Three lines moved in one contract. A system that re-indexes on a schedule would read
            all {n(WORLD.facts)} facts again to find them. The compiler is designed to follow the
            dependency graph and rebuild the {REBUILT} facts the change actually reached.
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
        <Scene id={4} band="answer" eyebrow="USE THE WORLD" title={<>One compiled world.<br />Every AI.</>}>
          <p className="lede rv">
            Use the same grounded knowledge across retrieval, agents, MCP, APIs and your own applications.
            <b> The model can change. Your knowledge should remain traceable.</b>
          </p>
          <div className="sources rv">
            {DESTINATIONS.map((name) => <span className="src" key={name}>{name}</span>)}
          </div>
          <AnswerSwitch />
        </Scene>

        <Scene id={5} band="access" eyebrow="PROOF & ACCESS" title={<>Stop rebuilding knowledge<br />for every AI project.</>}>
          <p className="lede rv">
            TAVONEL compiles everything you know into a structured, AI-ready world &mdash; and is
            designed to keep that world aligned as sources change.
          </p>

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

          <div className="band-head rv"><span className="kicker">NO LOCK-IN</span><h3>What you can take with you.</h3></div>
          <div className="caps rv">
            {TAKEAWAY.map(([name, text]) => (
              <article className="cap" key={name}>
                <h3>{name}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>

          <div className="actions rv" style={{ marginTop: 30 }}>
            <Link className="btn" href={signedIn ? "/workspace" : "/login"}>
              {signedIn ? "Open workspace" : "Compile sample data"}
            </Link>
            <Link className="btn ghost" href="/evidence">Inspect evidence</Link>
            <Link className="btn ghost" href={"/contact" as Route}>Talk to us</Link>
          </div>
          <p className="fine rv">
            Plans live on <Link href="/pricing">pricing</Link>. Measured compute. Hard spend limits.
          </p>
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
            <CanvasTransitionLink href="/film">Watch it compile</CanvasTransitionLink>
            <Link href="/research">Research</Link>
            <Link href="/developers">Developers</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/evidence">What we measured</Link>
            <Link href="/security">Where your documents go</Link>
            <Link href={"/contact" as Route}>Talk to us</Link>
            <Link href={"/status" as Route}>Service status</Link>
            <Link href={"/privacy" as Route}>Privacy</Link>
            <Link href={"/terms" as Route}>Terms</Link>
            <Link href={"/refunds" as Route}>Refunds</Link>
          </nav>
          <p className="fine">
            {DISCLOSURE.staged} No customer, certification, benchmark or performance claim is represented on this page.
          </p>
        </div>
      </footer>

      <div className="bar" role="status" aria-live="off" data-scene={scene}>
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
        <button ref={barNextRef} className="bar-next" type="button" onClick={cta("instrument_bar", nextStep.run)}>{nextStep.label}</button>
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

/** Long enough to read as a count, short enough that nobody waits for the total. */
const COUNT_MS = 900;

/**
 * A census cell that arrives at its number instead of already holding it.
 *
 * The six figures under the hero were the second thing a visitor saw and they were a table. A
 * table is something you read; a number climbing to 37,842 is something you watch, and watching
 * is what this page is asking for. Nothing about the figure changes -- it is the same declared
 * fixture, and it lands on exactly the value the server rendered.
 *
 * Three things this deliberately does not do. It does not animate a value that is not a number:
 * "18.4 GB" and the em dash for "no relationships" are printed as they are, because counting a
 * unit up would be a flourish pretending to be a measurement. It does not run under reduced
 * motion. And it does not render an empty or zero cell on the server -- the markup ships the
 * final figure, so a reader with no JavaScript, or a crawler, sees the census complete, and the
 * ramp is written straight to the node on mount rather than through state.
 */
function Cell({ value, label, warn }: { value: string; label: string; warn?: boolean }) {
  const node = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const element = node.current;
    if (!element) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const target = Number(value.replace(/,/g, ""));
    if (!Number.isFinite(target) || target <= 0 || !/^[\d,]+$/.test(value)) return;

    let frame = 0;
    const started = performance.now();
    const step = (now: number) => {
      // Cubic ease-out: fast enough at the start to read as a burst, slow enough at the end
      // that the last few hundred are legible rather than a blur settling.
      const t = Math.min(1, (now - started) / COUNT_MS);
      const eased = 1 - (1 - t) ** 3;
      element.textContent = Math.round(target * eased).toLocaleString("en-US");
      if (t < 1) frame = window.requestAnimationFrame(step);
    };
    element.textContent = "0";
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [value]);

  return (
    <div className="ch">
      <span
        ref={node}
        className={warn ? "ch-v warn" : "ch-v"}
        dangerouslySetInnerHTML={{ __html: value }}
      />
      <span className="ch-k">{label}</span>
    </div>
  );
}

/**
 * D9 -- a headline arrives one word at a time, not as a block.
 *
 * Walks whatever a title actually is -- a plain string, or one of the JSX fragments a few
 * scenes pass (a `<br />`, an interpolated count from `n(...)`) -- and wraps each word of text
 * in its own `.rv.word` span, leaving everything that is not text untouched. `<br />` stays a
 * `<br />`; a number interpolation becomes one word rather than being torn apart mid-digit.
 *
 * This does not introduce a second reveal mechanism. `.rv.word` is still `.rv`, so the single
 * IntersectionObserver in use-scroll-scenes.ts fires these exactly the way it fires every other
 * reveal element already on the page.
 */
function revealWords(node: React.ReactNode, startAt = 0): React.ReactNode {
  const at = { current: startAt };
  const walk = (child: React.ReactNode): React.ReactNode => {
    if (typeof child === "string" || typeof child === "number") {
      const text = String(child);
      return text.split(/(\s+)/).map((part, i) => {
        if (part === "" || /^\s+$/.test(part)) return part;
        const index = at.current++;
        return (
          <span key={`w${index}-${i}`} className="rv word" style={{ "--i": index } as React.CSSProperties}>
            {part}
          </span>
        );
      });
    }
    if (Array.isArray(child)) {
      return child.map((c, i) => <Fragment key={i}>{walk(c)}</Fragment>);
    }
    if (isValidElement(child)) {
      if (child.type === "br") return child;
      const props = child.props as { children?: React.ReactNode };
      return cloneElement(child, undefined, walk(props.children));
    }
    return child;
  };
  return walk(node);
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
            <h2>{revealWords(title)}</h2>
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
            <h3 className="sub">{revealWords(title)}</h3>
          </div>
          <div className="stack">{children}</div>
        </div>
      </div>
    </section>
  );
}

"use client";

/**
 * Home.
 *
 * Structure (12 scenes, one continuous world):
 *
 *   Act I   01 The mess -> 02 Connect -> 03 Compile -> 04 Work that stops -> 05 The compiled world
 *   ---     interlude
 *   Act II  06 Something changes -> 07 Rebuild -> 08 Verify
 *   Act III 09 The answer -> 10 Source boundary -> 11 Evidence -> 12 Access
 *
 * Act I is roughly two thirds of the scroll, and that split is the whole argument for this
 * ordering. An earlier version opened on a document revision and spent nine scenes on selective
 * recompilation -- the harder half of the engineering and the smaller half of the value. Leading
 * with it invites one reaction from a first-time visitor: *so?* Recompilation only becomes
 * interesting once the thing being recompiled exists, so the page earns the world first and
 * holds selective rebuild back as the payoff.
 *
 * Scenes 10 and 11 are not demonstration. The source boundary and the research posture describe
 * this deployment's real state, and scene 12's capability grid reads it live from `/api/status`
 * rather than asserting it -- fail-closed, so an unreachable status endpoint reports "unknown"
 * and never "available". Everything in scenes 01-09 is declared fictional fixture data, said on
 * screen in three places.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AnswerSwitch from "@/components/answer-switch";
import ChangeLattice from "@/components/change-lattice";
import CompilePipeline from "@/components/compile-pipeline";
import RebuildConsole from "@/components/rebuild-console";
import WorldField, { type WorldMode } from "@/components/world-field";
import type { BillingOfferCode } from "@/lib/billing-catalog";
import { AREAS, CHANGE, DISCLOSURE, KEPT, REBUILT, SOURCE_CENSUS, WORLD, n } from "@/lib/demo-world";
import { useScrollProgress, useScrollScenes } from "@/lib/use-scroll-scenes";

/* ------------------------------------------------------------------ scene definitions */

const SCENES = [
  { id: 1, label: "THE MESS", mode: "scatter", state: "SCATTERED", version: "v0", facts: null },
  { id: 2, label: "CONNECT", mode: "ingest", state: "CONNECTED", version: "v0", facts: null },
  { id: 3, label: "COMPILE", mode: "structure", state: "COMPILING", version: "v0", facts: null },
  { id: 4, label: "WORK THAT STOPS", mode: "structure", state: "COMPILING", version: "v0", facts: null },
  { id: 5, label: "COMPILED WORLD", mode: "current", state: "COMPILED", version: `v${WORLD.versionBefore}`, facts: WORLD.facts },
  { id: 6, label: "SOMETHING CHANGES", mode: "change", state: "CHANGED", version: `v${WORLD.versionBefore}`, facts: WORLD.facts },
  { id: 7, label: "REBUILD", mode: "recompile", state: "REBUILDING", version: `v${WORLD.versionBefore}`, facts: WORLD.facts },
  { id: 8, label: "VERIFY", mode: "verify", state: "VERIFIED", version: `v${WORLD.versionAfter}`, facts: WORLD.facts },
  { id: 9, label: "THE ANSWER", mode: "answer", state: "CURRENT", version: `v${WORLD.versionAfter}`, facts: WORLD.facts },
  { id: 10, label: "SOURCE BOUNDARY", mode: "current", state: "CURRENT", version: `v${WORLD.versionAfter}`, facts: WORLD.facts },
  { id: 11, label: "EVIDENCE", mode: "current", state: "CURRENT", version: `v${WORLD.versionAfter}`, facts: WORLD.facts },
  { id: 12, label: "ACCESS", mode: "current", state: "CURRENT", version: `v${WORLD.versionAfter}`, facts: WORLD.facts },
] as const;

/** Filenames as a visitor's own drive would show them: dated, versioned, and not tidy. */
const DEBRIS = [
  "Handbook_2026_FINAL.pdf", "Handbook_2026_FINAL_v2.pdf", "scan_0140.pdf",
  "Q3 forecast.xlsx", "acme/product-docs", "Untitled folder (3)",
  "Customer Research 2026.zip", "Operations Manual.docx", "pricing_OLD.csv",
  "support.acme.com", "Board deck.pptx", "contract_signed.pdf",
];

/** The preparation work a team normally does by hand before any retrieval system is trusted. */
const STOPS = [
  "Collecting the files", "Deciding which copy is real", "Running OCR on scans",
  "Choosing a parser per format", "Pulling tables out of PDFs", "Rebuilding heading structure",
  "Cleaning metadata", "Merging duplicate entities", "Resolving naming conflicts",
  "Deciding chunk boundaries", "Writing the taxonomy", "Mapping relationships",
  "Wiring citations back to sources", "Re-running all of it next quarter",
];

/** Scene 10 -- real. The document boundary this deployment actually enforces. */
const BOUNDARY = [
  ["01", "Quarantine", "Browser-direct, tenant-scoped intake. Document bytes never pass through the application or the database.", "held"],
  ["02", "Sanitize", "Antivirus and mandatory content disarm, with the sanitization proof kept as evidence.", "held"],
  ["03", "Understand", "Only sanitized artifacts reach analysis. A parser gets no tools, no broad credentials, no outbound network.", "held"],
  ["04", "Review", "A person decides before anything is promoted. Automated analysis produces a candidate, never a world.", "review"],
] as const;

/** Scene 11 -- real. What has been measured, and what has only been built. */
const EVIDENCE = [
  ["measured", "Recovery changes the outcome", "On a public benchmark with an unmodified scoring path, the recovery runtime moved a document extraction score substantially. It is our own measurement, published with its confidence interval, and never placed beside a competitor's number as if reproduced."],
  ["measured", "Compilation refuses more than it emits, sometimes", "Of a thousand documents offered in one campaign, four hundred and four were refused, every one for a link the compiler could not resolve. A vault with a broken link is not emitted, by design."],
  ["unsupported", "Blind quality detection failed", "We tested whether prediction-only signals could pick the worst documents without ground truth. They could not beat ranking by length alone. It is published as unsupported and is not shipped as a feature."],
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

/* -------------------------------------------------------------------- live capability state */

type StatusResponse = {
  mode?: string;
  activationPolicy?: Record<string, { enabled?: boolean; reason?: string }>;
  auth?: string;
  billing?: string;
  r2?: string;
};

type Cap = { name: string; state: string; tone: "open" | "closed" | "direction" | "unknown"; note: string };

/**
 * Fail-closed by construction: the starting value for every row is "unknown", and only a
 * successful response moves a row to "open". A status endpoint that is unreachable, slow or
 * malformed leaves the grid saying it does not know -- never that a capability is available.
 */
function readCapabilities(status: StatusResponse | null, failed: boolean): Cap[] {
  const policy = status?.activationPolicy ?? {};
  const gate = (key: string, name: string, openText: string, closedText: string): Cap => {
    if (failed) return { name, state: "Unknown", tone: "unknown", note: "Status could not be read from this deployment." };
    const entry = policy[key];
    if (!status || entry?.enabled === undefined) return { name, state: "Checking", tone: "unknown", note: "Reading live deployment state." };
    return entry.enabled
      ? { name, state: "Open", tone: "open", note: entry.reason ?? openText }
      : { name, state: "Closed", tone: "closed", note: entry.reason ?? closedText };
  };
  const flag = (value: string | undefined, name: string, openValues: string[], openText: string, closedText: string): Cap => {
    if (failed) return { name, state: "Unknown", tone: "unknown", note: "Status could not be read from this deployment." };
    if (!status || !value) return { name, state: "Checking", tone: "unknown", note: "Reading live deployment state." };
    return openValues.includes(value)
      ? { name, state: "Configured", tone: "open", note: openText }
      : { name, state: "Not configured", tone: "closed", note: closedText };
  };

  return [
    gate("customerIntake", "Document intake", "Private-pilot intake is open.", "Intake is closed in this deployment."),
    gate("cdr", "Content disarm", "Sanitization runs before anything is read.", "Sanitization is not active."),
    gate("ocrGpu", "OCR on scans", "Qualified GPU OCR is available.", "GPU OCR is gated."),
    gate("candidatePromotion", "Promotion to the live world", "", "Promotion is always an explicit human decision. It is closed on purpose, not pending."),
    flag(status?.auth, "Google sign-in", ["google_oauth_configured"], "Sign-in is available to pilot users.", "No auth provider is configured here."),
    flag(status?.billing, "Checkout and credits", ["sandbox_checkout_ready"], "Paddle sandbox checkout is complete. Live mode is not enabled.", "Sandbox checkout is not fully configured."),
    flag(status?.r2, "Quarantine storage", ["signer_configured"], "The scoped upload signer is configured.", "No upload signer is configured here."),
    { name: "Knowledge architecture", state: "Direction", tone: "direction", note: DISCLOSURE.ontology },
    { name: "Selective recompilation", state: "Direction", tone: "direction", note: "Demonstrated above on fixture data. Not offered as a shipped capability in this deployment." },
  ];
}

/* ----------------------------------------------------------------------------- the page */

export default function HomePage() {
  const [notice, setNotice] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [billingBusy, setBillingBusy] = useState<BillingOfferCode | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);

  const scene = useScrollScenes(SCENES.length);
  const progress = useScrollProgress();
  const active = SCENES.find((s) => s.id === scene) ?? SCENES[0];
  const capabilities = useMemo(() => readCapabilities(status, statusFailed), [status, statusFailed]);

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
    return () => {
      cancelled = true;
    };
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
    return () => {
      cancelled = true;
    };
  }, []);

  const showNotice = () =>
    setNotice("Foundation mode is active. Provider configuration and sandbox qualification are required before this action is available.");

  const signIn = async () => {
    const { getSupabaseBrowserClient } = await import("@/lib/supabase-browser");
    const client = getSupabaseBrowserClient();
    if (!client) return showNotice();
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) setNotice("Google sign-in could not start. Testing-mode users only.");
  };

  const signOut = async () => {
    const { getSupabaseBrowserClient } = await import("@/lib/supabase-browser");
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const { error } = await client.auth.signOut();
    setNotice(error ? "Sign-out could not be completed." : "Signed out from this browser.");
  };

  const startCheckout = async (offerCode: BillingOfferCode) => {
    const { getSupabaseBrowserClient } = await import("@/lib/supabase-browser");
    const client = getSupabaseBrowserClient();
    if (!client) return showNotice();
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setNotice("Sign in with Google before opening the secure Paddle checkout.");
      return;
    }
    setBillingBusy(offerCode);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ offerCode }),
      });
      const checkout = (await response.json()) as {
        code?: string;
        environment?: "sandbox" | "production";
        clientToken?: string;
        offer?: { priceId?: string; label?: string };
        customer?: { email?: string };
        customData?: Record<string, string>;
      };
      if (!response.ok || !checkout.clientToken || !checkout.environment || !checkout.offer?.priceId || !checkout.customData) {
        setNotice(`Checkout is unavailable (${checkout.code ?? response.status}).`);
        return;
      }
      const { initializePaddleBrowser } = await import("@/lib/paddle-browser");
      const paddle = await initializePaddleBrowser({
        token: checkout.clientToken,
        environment: checkout.environment,
        eventCallback: (event) => {
          if (event.name === "checkout.completed") {
            setNotice("Paddle accepted the sandbox payment. Access and credits remain pending until the signed webhook is persisted.");
          }
        },
      });
      if (!paddle) {
        setNotice("Paddle checkout could not initialize.");
        return;
      }
      paddle.Checkout.open({
        items: [{ priceId: checkout.offer.priceId, quantity: 1 }],
        customer: checkout.customer?.email ? { email: checkout.customer.email } : undefined,
        customData: checkout.customData,
        settings: { displayMode: "overlay", theme: "dark", locale: "en" },
      });
      setNotice(`${checkout.offer.label ?? "Selected offer"} sandbox checkout opened. Only a verified webhook can change entitlements.`);
    } catch {
      setNotice("Paddle checkout could not be opened. No entitlement was changed.");
    } finally {
      setBillingBusy(null);
    }
  };

  const jump = (id: number) => {
    document.getElementById(`s${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

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
          <button type="button" onClick={() => jump(3)}>Compile</button>
          <button type="button" onClick={() => jump(7)}>Keep current</button>
          <button type="button" onClick={() => jump(10)}>Security</button>
          <button type="button" onClick={() => jump(11)}>Evidence</button>
          <button type="button" onClick={() => jump(12)}>Access</button>
        </nav>
        <button className="btn ghost small" type="button" onClick={() => void (signedIn ? signOut() : signIn())}>
          {signedIn ? "Sign out" : "Sign in"}
        </button>
        {signedIn ? (
          <Link className="btn small" href="/workspace">Open workspace</Link>
        ) : (
          <button className="btn small" type="button" onClick={() => jump(12)}>Request access</button>
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
              <button className="btn" type="button" onClick={() => jump(3)}>Watch it compile</button>
              <button className="btn ghost" type="button" onClick={() => jump(4)}>What you stop doing</button>
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
              This is what a company actually looks like before anyone tries to put an AI on top of it.
              {" "}{DISCLOSURE.fixture}
            </p>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════ 02 · connect */}
        <Scene id={2} eyebrow="CONNECT" title="You point at it. That is the whole setup.">
          <p className="lede rv">
            No export, no restructuring, no &ldquo;please tidy the drive first&rdquo;. Connect the systems
            your work already lives in and leave them exactly as they are.
          </p>
          <div className="panel rv">
            <div className="panel-head"><span>sources in this demonstration</span><span className="right">DEMO DATA</span></div>
            <div className="conn">
              {[
                ["DRV", "Shared drives", "14,206 files", "8.1 GB"],
                ["DOC", "Document stores", "9,880 files", "4.4 GB"],
                ["REP", "Code repositories", "6,412 files", "1.9 GB"],
                ["SCN", "Scanned archives", "9,006 files", "3.1 GB"],
                ["WEB", "Public site & help centre", "1,338 pages", "0.6 GB"],
                ["MSG", "Long-lived threads", "—", "0.3 GB"],
              ].map(([code, name, count, size]) => (
                <div className="cn" key={code}>
                  <span className="cn-i">{code}</span>
                  <span className="cn-n">{name}<span>{count}</span></span>
                  <span className="cn-s">{size}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="fine rv">
            The list above is fixture data illustrating a shape. Which source types this deployment
            can actually accept today is shown live in <button className="ilink" type="button" onClick={() => jump(12)}>the capability grid</button>.
          </p>
        </Scene>

        {/* ═══════════════════════════════════════════════════ 03 · compile */}
        <Scene id={3} eyebrow="COMPILE" title={`Six passes turn ${n(SOURCE_CENSUS.files)} files into a world.`}>
          <p className="lede rv">
            Reading is the easy part. What takes a team months is everything after it: working out
            what a document actually says, which of four copies is the real one, what each thing{" "}
            <i>is</i>, and how it all connects. <b>That is the compile.</b>
          </p>
          <CompilePipeline active={scene >= 3} />
        </Scene>

        {/* ═══════════════════════════════════════════════════ 04 · work that stops */}
        <Scene id={4} eyebrow="WORK THAT STOPS" title="Everything on this list stops being a project." split>
          <>
            <p className="lede rv">
              This is the real cost of putting AI on company data, and almost none of it is the
              model. It is the weeks in front of the model &mdash; and it is work nobody wanted to own
              in the first place.
            </p>
            <p className="fine rv">
              These are the preparation steps a team normally does by hand before any retrieval
              system can be trusted. TAVONEL performs them as part of the compile.
            </p>
          </>
          <>
            <div className="stops rv">
              {STOPS.map((task) => (
                <span className="stop" key={task}><i /><span>{task}</span></span>
              ))}
            </div>
            <div className="beforeafter rv">
              <span><b data-tone="changed">Weeks</b>before</span>
              <span><b data-tone="verified">A compile</b>after</span>
            </div>
          </>
        </Scene>

        {/* ═══════════════════════════════════════════════════ 05 · the compiled world */}
        <Scene id={5} eyebrow="THE COMPILED WORLD" title={<>Not searchable files.<br />An organization an&nbsp;AI can reason about.</>}>
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
                ["Status", "Current · verified against version 18"],
              ].map(([k, v]) => (
                <div className="cr" key={k}><span className="k">{k}</span><span className="v">{v}</span></div>
              ))}
            </div>
          </div>
          <p className="fine rv">{DISCLOSURE.ontology}</p>
        </Scene>

        <ChangeLattice />

        {/* ═══════════════════════════════════════════════════ 06 · something changes */}
        <Scene id={6} eyebrow="SOMETHING CHANGES" title="A compile that only ever runs once is worthless.">
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

        {/* ═══════════════════════════════════════════════════ 07 · rebuild */}
        <Scene id={7} eyebrow="REBUILD ONLY WHAT MOVED" title={<>Rebuild {REBUILT}.<br />Keep {n(KEPT)}.</>}>
          <p className="lede rv">
            Three lines moved in one handbook. A system that re-indexes on a schedule would read
            all {n(WORLD.facts)} facts again to find them. TAVONEL follows the dependency graph,
            rebuilds the {REBUILT} facts the change actually reached, and carries the rest forward
            untouched &mdash; which is why it can do this <b>every time a file moves</b>, instead of overnight.
          </p>
          <RebuildConsole active={scene >= 7} />
        </Scene>

        {/* ═══════════════════════════════════════════════════ 08 · verify */}
        <Scene id={8} eyebrow="VERIFY BEFORE PUBLISHING" title="Nothing goes live until it passes.">
          <p className="lede rv">
            A draft world is not a live world. It goes live only after its checks pass &mdash; and what
            was written down, so any answer your AI gives can be traced back to the exact version
            that produced it.
          </p>
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
          <div className="panel rv">
            <div className="panel-head"><span>publish record</span><span className="right">SIGNED</span></div>
            <div className="record">
              {[
                ["Build", `#${n(WORLD.buildNumber)}`],
                ["World version", `v${WORLD.versionBefore} → v${WORLD.versionAfter}`],
                ["Set off by", `${CHANGE.document} · version ${CHANGE.revisionFrom} → ${CHANGE.revisionTo}`],
                ["What changed", `${CHANGE.changed} facts of ${n(WORLD.facts)}`],
                ["What it affected", `${CHANGE.affected} further facts · ${CHANGE.documentsRegenerated} documents`],
                ["Rebuilt", `${REBUILT} facts · ${((REBUILT / WORLD.facts) * 100).toFixed(2)}% of the world`],
                ["Kept as-is", `${n(KEPT)} facts · never touched`],
                ["Held for review", `${CHANGE.held} fact · needs a person to decide`],
                ["Checks", `${WORLD.checksPassed} of ${WORLD.checksTotal} passed`],
              ].map(([k, v]) => (
                <div className="rr" key={k}><span className="k">{k}</span><span className="v">{v}</span></div>
              ))}
            </div>
          </div>
        </Scene>

        {/* ═══════════════════════════════════════════════════ 09 · the answer */}
        <Scene id={9} eyebrow="WHY ANY OF THIS MATTERS" title={<>The same question,<br />asked of two worlds.</>}>
          <p className="lede rv">
            On the left is the world as it stood before the handbook changed &mdash; the one a system
            that re-indexes on a schedule would still be answering from. On the right, the world
            TAVONEL published two minutes later. <b>Same question. Same files. Different truth.</b>
          </p>
          <AnswerSwitch />
        </Scene>

        {/* ═══════════════════════════════════════════════════ 10 · source boundary (real) */}
        <Scene id={10} eyebrow="SOURCE BOUNDARY" title="Every document is treated as hostile data.">
          <p className="lede rv">
            The sequence above is a demonstration. This is not. Each control below opens only
            after the one before it is qualified, and the states shown are the ones this
            deployment actually enforces.
          </p>
          <div className="chain rv">
            {BOUNDARY.map(([num, name, text, state]) => (
              <article className="link" key={num}>
                <span className="st">{num}</span>
                <h3>{name}</h3>
                <p>{text}</p>
                <span className="pill" data-v={state === "review" ? "held" : "current"}>{state === "review" ? "HUMAN DECISION" : "ENFORCED"}</span>
              </article>
            ))}
          </div>
          <p className="fine rv">
            Designed to fail closed. Document bytes never pass through the application or the
            database, and automated analysis produces a candidate, never a world.
          </p>
        </Scene>

        {/* ═══════════════════════════════════════════════════ 11 · evidence (real) */}
        <Scene id={11} eyebrow="EVIDENCE" title="What is measured, and what is only built.">
          <p className="lede rv">
            There are no customer logos on this page, and no certifications. A brand rule bars
            them without registered evidence &mdash; so what follows is our own record instead,
            including the part of it that did not work.
          </p>
          <div className="tiles rv">
            {EVIDENCE.map(([state, title, body]) => (
              <article className="tile" key={title} data-state={state}>
                <span className="n">{state === "measured" ? "MEASURED" : state === "unsupported" ? "NOT SUPPORTED" : "BUILT, NOT PROVEN"}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </Scene>

        {/* ═══════════════════════════════════════════════════ 12 · access (real, wired) */}
        <Scene id={12} eyebrow="ACCESS" title={<>Stop preparing<br />data for AI.</>}>
          <p className="lede rv">
            TAVONEL compiles everything you know into a structured, AI-ready world &mdash; and keeps
            that world correct as reality changes.
          </p>

          <div className="band-head rv"><span className="kicker">MEASURED ACCESS</span><h3>Plans for serious work.</h3></div>
          <p className="fine rv">
            Secure Paddle sandbox checkout is available to signed-in pilot users. Access changes
            only after a signed, idempotently persisted webhook.
          </p>
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
                  onClick={() => (offerCode ? void startCheckout(offerCode) : showNotice())}
                >
                  {name === "Institution" ? "Start a conversation" : billingBusy === offerCode ? "Opening checkout…" : "Choose this plan"}
                </button>
              </article>
            ))}
          </div>

          <div className="band-head rv"><span className="kicker">DELIBERATE COMPUTE</span><h3>Access is steady. GPU work is measured.</h3></div>
          <p className="fine rv">
            Credits are reserved before a qualified job, settled against observed runtime, and
            never created by a checkout redirect. No unlimited GPU plans; hard job and workspace
            caps stay active even after a credit purchase.
          </p>
          <div className="packs rv">
            {PACKS.map(([name, price, credits, offerCode]) => (
              <article className="pack" key={name}>
                <span className="tag">PREPAID CAPACITY</span>
                <h3>{name}</h3>
                <span className="price">{price} <small>{credits}</small></span>
                <button className="btn ghost" type="button" disabled={Boolean(billingBusy)} onClick={() => void startCheckout(offerCode)}>
                  {billingBusy === offerCode ? "Opening checkout…" : "Buy credits"}
                </button>
              </article>
            ))}
          </div>

          <div className="band-head rv"><span className="kicker">STATUS</span><h3>What exists in this deployment, right now.</h3></div>
          <p className="fine rv">
            Read live from this deployment when the page loads, not written by hand. A row this
            page cannot confirm reads <b>Unknown</b> &mdash; it never defaults to available.
          </p>
          <div className="caps rv">
            {capabilities.map((cap) => (
              <div className="cap" key={cap.name} data-tone={cap.tone} title={cap.note}>
                <span className="cap-n">{cap.name}</span>
                <span className="cap-s">{cap.state}</span>
              </div>
            ))}
          </div>

          <div className="actions rv" style={{ marginTop: 34 }}>
            {signedIn ? (
              <Link className="btn" href="/workspace">Open workspace</Link>
            ) : (
              <button className="btn" type="button" onClick={() => void signIn()}>Sign in with Google</button>
            )}
            <button className="btn ghost" type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
              Replay from the start
            </button>
          </div>
        </Scene>
      </main>

      <footer className="site">
        <div className="shell">
          <span className="wordmark"><Logomark /><b>TAVONEL</b></span>
          <p className="fine">{DISCLOSURE.fixture} {DISCLOSURE.staged}</p>
          <p className="fine">
            Paddle checkout is sandbox-only; signed webhooks persist access and prepaid credits,
            while GPU capacity remains separately gated. No customer, certification, benchmark or
            performance claim is represented on this page.
          </p>
        </div>
      </footer>

      <div className="bar" role="status" aria-live="off">
        <span className="scroll" style={{ width: `${progress * 100}%` }} />
        <span className="bc"><span className="bk">WORLD</span><span className="bv">{active.version}</span></span>
        <span className="bc"><span className="bk">STATE</span><span className="bv state" data-s={active.state.toLowerCase()}>{active.state}</span></span>
        <span className="bc opt"><span className="bk">FACTS</span><span className="bv">{active.facts ? n(active.facts) : "—"}</span></span>
        <span className="bc opt"><span className="bk">NEEDS REVIEW</span><span className="bv">{scene >= 6 ? CHANGE.held : 0}</span></span>
        <span className="bc right"><span className="bv">SCENE {String(active.id).padStart(2, "0")} &middot; {active.label}</span></span>
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

/** Nine cells, one lit: the lattice at its smallest, and the same idea as the interlude. */
function Logomark() {
  return (
    <svg className="logomark" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      {[0, 1, 2].map((row) =>
        [0, 1, 2].map((col) => {
          const lit = row === 1 && col === 1;
          return (
            <rect
              key={`${row}-${col}`}
              x={3 + col * 7}
              y={3 + row * 7}
              width={5}
              height={5}
              rx={0.5}
              fill={lit ? "var(--verified)" : "none"}
              stroke={lit ? "none" : "currentColor"}
              strokeWidth={1}
              opacity={lit ? 1 : 0.42}
            />
          );
        }),
      )}
    </svg>
  );
}

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
  split,
}: {
  id: number;
  eyebrow: string;
  title: React.ReactNode;
  children: React.ReactNode;
  split?: boolean;
}) {
  const kids = Array.isArray(children) ? children : [children];
  return (
    <section className="scene" id={`s${id}`} data-scene={id}>
      <div className="shell">
        <div className={split ? "body split" : "body"}>
          <div className="stack">
            <p className="slate rv"><b>SCENE {String(id).padStart(2, "0")}</b><span />{eyebrow}</p>
            <h2 className="rv">{title}</h2>
            {split ? kids[0] : null}
          </div>
          <div className="stack">{split ? kids[1] : kids}</div>
        </div>
      </div>
    </section>
  );
}

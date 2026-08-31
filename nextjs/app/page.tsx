"use client";

/**
 * Home. Three locked compile cuts carry the argument.
 * Copy is the headline, one lede, two band lines, then proof.
 */

import Link from "next/link";
import type { Route } from "next";
import { Fragment, cloneElement, isValidElement, useEffect, useMemo, useRef, useState } from "react";
import AnswerSwitch from "@/components/answer-switch";
import CanvasTransitionLink from "@/components/canvas-transition-link";
import FilmBand from "@/components/film-band";
import Logomark from "@/components/logomark";
import WorldField, { type WorldMode } from "@/components/world-field";
import { CHANGE, DISCLOSURE, WORLD, n } from "@/lib/demo-world";
import { trackFunnel, trackSceneDepth } from "@/lib/funnel-events";
import { readCapabilities, type StatusResponse } from "@/lib/capabilities";
import { useScrollProgress, useScrollScenes } from "@/lib/use-scroll-scenes";

const SCENES = [
  { id: 1, label: "COMPILE" },
  { id: 2, label: "STRUCTURE" },
  { id: 3, label: "KEEP TRUE" },
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

const BAND_ORDER: BandName[] = ["scatter", "structure", "world", "change", "rebuild", "answer", "access"];

const DESTINATIONS = ["Retrieval", "Agents", "MCP", "API", "Search", "Your applications"];

/**
 * What the compile hands back. The films show the work; this is the receipt.
 *
 * Every line is a file the workspace already writes into the signed package, which is why the
 * ontology is named by its real extension rather than described as "a knowledge layer". A buyer
 * comparing this against a retrieval product is comparing artifacts, not adjectives.
 */
const ARTIFACTS = [
  ["ontology.ttl", "OWL classes and object properties — the shape of your domain, in a standard a triple store reads."],
  ["graph.csv", "Entities and the relations between them, resolved across versions and spellings."],
  ["corpus/", "Retrieval documents rebuilt from current facts, so an index is downstream of the world, not a copy of your drive."],
  ["provenance/", "Every fact back to a file, a section and a line. An answer that cannot be traced does not ship."],
] as const;

export default function HomePage() {
  const [signedIn, setSignedIn] = useState(false);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);

  const { scene, band } = useScrollScenes(SCENES.length);
  const progress = useScrollProgress();
  const active = SCENES.find((s) => s.id === scene) ?? SCENES[0];
  const world = BANDS[(band as BandName) in BANDS ? (band as BandName) : "scatter"];
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setTimeout(() => setOpened(true), 900);
    return () => window.clearTimeout(timer);
  }, []);

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
  const heldRows = useMemo(
    () => capabilities.filter((cap) => cap.tone !== "open" && cap.tone !== "direction"),
    [capabilities],
  );

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

  const cta = (name: string, run: () => void) => () => {
    trackFunnel("cta_clicked", { cta: name, scene: String(scene) });
    run();
  };

  const nextStep = ((): { label: string; run: () => void } => {
    if (scene <= 1) return { label: "STRUCTURE", run: () => jump(2) };
    if (scene === 2) return { label: "KEEP TRUE", run: () => jump(3) };
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
        <span className="mode" title="Private pilot: this deployment is invitation-only, billing runs in Paddle sandbox, and GPU capacity stays separately gated until each control is qualified.">
          <i aria-hidden="true" />
          PRIVATE PILOT
        </span>
        <nav aria-label="Sections">
          <button type="button" onClick={() => jump(2)}>Structure</button>
          <Link href="/product">Product</Link>
          <Link href="/research">Research</Link>
          <Link href="/developers">Developers</Link>
          <Link href="/evidence">Evidence</Link>
        </nav>
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
        <section className="scene hero" id="s1" data-scene="1" data-band="scatter">
          <div className="shell">
            <p className="slate"><b>TAVONEL</b><span /> KNOWLEDGE COMPILER</p>
            <h1>
              <span className="line"><i>{revealWords("Compile your knowledge")}</i></span>
              <span className="line dim"><i>{revealWords("into a world AI can reason about.", 4)}</i></span>
            </h1>
            <p className="lede rv">
              Files go in. A world an AI can cite comes out.
            </p>
            <div className="actions rv">
              <Link className="btn" href={signedIn ? "/workspace" : "/login"}>Compile sample data</Link>
              <Link className="btn ghost" href="/evidence">Evidence</Link>
            </div>
          </div>
          <FilmBand
            src="/film/compile-cut.mp4"
            poster="/film/poster-1.png"
            href={"/film" as Route}
            label="cut 1"
          />
          <p className="fine film-note">{DISCLOSURE.fixture}</p>
        </section>

        <div className="creed">
          <div className="shell">
            <span className="creed-k">THE RULE</span>
            <p>
              <b>Measured where we have evidence. Marked as research where we do not.</b>
              {" "}Detail lives in the <Link href="/evidence">evidence record</Link>.
            </p>
          </div>
        </div>

        <Scene id={2} band="structure" eyebrow="STRUCTURE" title="What things are, and how they connect — compiled, not retrieved.">
          <FilmBand
            src="/film/compile-cut-2.mp4"
            poster="/film/poster-2.png"
            href={"/film-2" as Route}
            label="cut 2"
          />
        </Scene>

        <Scene id={3} band="change" eyebrow="KEEP TRUE" title="A source changes. Only that slice recompiles. Trace it back.">
          <FilmBand
            src="/film/compile-cut-3.mp4"
            poster="/film/poster-3.png"
            href={"/film-3" as Route}
            label="cut 3"
          />
        </Scene>

        <Scene id={4} band="answer" eyebrow="USE THE WORLD" title={<>One compiled world.<br />Every AI.</>}>
          <p className="lede rv">
            The model can change. Your knowledge stays traceable.
          </p>
          <div className="sources rv">
            {DESTINATIONS.map((name) => <span className="src" key={name}>{name}</span>)}
          </div>
          <AnswerSwitch />
          <div className="band-head rv"><span className="kicker">WHAT YOU GET</span><h3>Files, not a lock-in.</h3></div>
          <div className="artifacts rv">
            {ARTIFACTS.map(([name, text]) => (
              <article className="artifact" key={name}>
                <code>{name}</code>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </Scene>

        <Scene id={5} band="access" eyebrow="PROOF & ACCESS" title={<>Stop rebuilding knowledge<br />for every AI project.</>}>
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
            {heldRows.length > 0 ? (
              <>
                {" "}Buying access opens none of them &mdash; each opens only when the control
                behind it is qualified.
              </>
            ) : null}
          </p>

          <p className="lede rv" style={{ marginTop: 26 }}>
            The package is signed with Ed25519 and its public key is published, so a third party
            with no account here can verify it.
          </p>

          <div className="actions rv" style={{ marginTop: 24 }}>
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
        <button ref={barNextRef} className="bar-next" type="button" onClick={cta("instrument_bar", nextStep.run)}>{nextStep.label}</button>
      </div>
    </div>
  );
}

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
          <div className="stack film-scene">{children}</div>
        </div>
      </div>
    </section>
  );
}

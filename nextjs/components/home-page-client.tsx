"use client";

/**
 * Home. Three locked compile cuts carry the argument.
 * Copy is the headline, one lede, two band lines, then proof.
 */

import Link from "next/link";
import type { Route } from "next";
import { Fragment, cloneElement, isValidElement, useEffect, useRef, useState } from "react";
import CanvasTransitionLink from "@/components/canvas-transition-link";
import FilmBand from "@/components/film-band";
import Logomark from "@/components/logomark";
import WorldField, { type WorldMode } from "@/components/world-field";
import { CHANGE, WORLD, n } from "@/lib/demo-world";
import { trackFunnel, trackSceneDepth } from "@/lib/funnel-events";
import { useScrollProgress, useScrollScenes } from "@/lib/use-scroll-scenes";

const SCENES = [
  { id: 1, label: "KNOWLEDGE COMPILER" },
  { id: 2, label: "INPUT" },
  { id: 3, label: "COMPILE FILM" },
  { id: 4, label: "EVIDENCE" },
  { id: 5, label: "START" },
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

export default function HomePageClient({ heroProof }: { heroProof: React.ReactNode }) {
  const [signedIn, setSignedIn] = useState(false);

  const { scene, band } = useScrollScenes(SCENES.length);
  const progress = useScrollProgress();
  const active = SCENES.find((s) => s.id === scene) ?? SCENES[0];
  const world = BANDS[(band as BandName) in BANDS ? (band as BandName) : "scatter"];
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
  const reachedChange = BAND_ORDER.indexOf(band as BandName) >= BAND_ORDER.indexOf("change");
  useEffect(() => { trackSceneDepth(scene); }, [scene]);

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
    if (scene <= 1) return { label: "BRING YOUR SOURCES", run: () => jump(2) };
    if (scene === 2) return { label: "WATCH IT COMPILE", run: () => jump(3) };
    if (scene === 3) return { label: "FOLLOW THE EVIDENCE", run: () => jump(4) };
    if (scene < 5) return { label: "START", run: () => jump(5) };
    return signedIn
      ? { label: "OPEN WORKSPACE", run: () => window.location.assign("/workspace") }
      : { label: "SIGN IN", run: () => window.location.assign("/login") };
  })();

  return (
    <div className="page landing-page">
      {/*
        The hero film is above the fold, so it is fetched with the document, at high priority.

        Without this the browser does not learn the cut exists until React has hydrated and the
        <video> is in the DOM, which on a cold visit is a second of poster before anything
        moves. React hoists this into <head>. Only cut 1 is preloaded — the other three are
        deliberately deferred so they cannot compete for the connection, and `fetchPriority`
        keeps the hero ahead of the fonts and the stylesheet's own images.
      */}
      <link
        rel="preload"
        as="video"
        href="/film/compile-cut.mp4"
        type="video/mp4"
        fetchPriority="high"
      />
      <OpeningWorldField band={band} mode={world.mode} />

      <header className="nav" data-stuck={progress > 0.005 ? 1 : 0}>
        <Link href="/" className="wordmark" aria-label="TAVONEL home">
          <Logomark />
          <b>TAVONEL</b>
        </Link>
        <span className="mode" title="Source-grounded document and knowledge compilation.">
          <i aria-hidden="true" />
          KNOWLEDGE COMPILER
        </span>
        <nav aria-label="Sections">
          <Link href="/product">Product</Link>
          <Link href={"/solutions/ai-ready-knowledge" as Route}>Solutions</Link>
          <Link href={"/integrations" as Route}>Integrations</Link>
          <Link href="/developers">Developers</Link>
          <Link href="/security">Security</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/research">Resources</Link>
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
              <span className="line"><i>Turn documents and connected systems</i></span>
              <span className="line dim"><i>into a source-grounded world your AI can use.</i></span>
            </h1>
            <p className="lede">
              TAVONEL reads difficult sources, reconstructs structure, resolves identities and
              relationships, and compiles a versioned knowledge layer with evidence back to the page.
            </p>
            <div className="actions">
              <Link className="btn" href={signedIn ? "/workspace" : "/login"}>Compile your own files</Link>
              <Link className="btn ghost" href={"/explore" as Route}>Explore a Compiled World</Link>
            </div>
          </div>
        </section>

        <Scene id={2} band="structure" eyebrow="INPUT" title="Bring the knowledge you already have.">
          <p className="lede rv">Upload files, folders or ZIP archives, or connect the system where your knowledge already lives.</p>
          <ul className="input-formats rv" aria-label="Supported knowledge sources">
            {[
              "PDF", "Office documents", "Images / scans", "Folders", "ZIP archives",
              "Google Drive", "Dropbox", "OneDrive / SharePoint", "S3 / R2 / MinIO", "SMB / NFS / SFTP",
            ].map((source) => <li key={source}>{source}</li>)}
          </ul>
        </Scene>

        <Scene id={3} film band="change" eyebrow="COMPILE FILM" title="Watch knowledge take shape.">
          <div className="compile-film-sequence rv">
            <div className="compile-film-stages" aria-label="Compilation stages">
              {['SOURCES', 'READ', 'STRUCTURE', 'WORLD'].map((stage) => <span key={stage}>{stage}</span>)}
            </div>
            {heroProof}
            <FilmBand src="/film/compile-cut-2.mp4" poster="/film/poster-2.webp" index={1} label="READ — pages, regions and document structure" />
            <FilmBand src="/film/compile-cut-3.mp4" poster="/film/poster-3.webp" index={2} label="STRUCTURE — entities, claims, relations and evidence" />
            <FilmBand src="/film/compile-cut-4.mp4" poster="/film/poster-4.webp" index={3} label="WORLD — compiled knowledge used across AI surfaces" />
          </div>
        </Scene>

        <Scene id={4} band="answer" eyebrow="EVIDENCE" title="Follow grounded results back to the source.">
          <p className="lede rv">Object → relation → evidence → document page → exact bounding box. Ask citations open the same source evidence.</p>
          <div className="evidence-path rv" aria-label="Evidence path">
            {['Object', 'Relation', 'Evidence', 'Document page', 'Exact bbox'].map((step, index) => (
              <Fragment key={step}><span>{step}</span>{index < 4 ? <i aria-hidden="true">→</i> : null}</Fragment>
            ))}
          </div>
          <div className="actions rv"><Link className="btn" href={"/explore" as Route}>Explore a Compiled World</Link></div>
        </Scene>

        <Scene id={5} band="access" eyebrow="START" title="Compile your own knowledge.">
          <p className="lede rv">Files go in. Structured, traceable knowledge comes out.</p>
          <div className="actions rv">
            <Link className="btn" href={signedIn ? "/workspace" : "/login"}>Start with your files</Link>
            <Link className="btn ghost" href={signedIn ? "/workspace/connections" : "/login"}>Connect a source</Link>
            <Link className="btn ghost" href={"/explore" as Route}>Explore sample World</Link>
          </div>
        </Scene>
      </main>

      <footer className="site">
        <div className="shell">
          <span className="wordmark"><Logomark /><b>TAVONEL</b></span>
          <nav className="site-links" aria-label="More">
            <CanvasTransitionLink href="/film">Watch it compile</CanvasTransitionLink>
            <Link href="/research">Research</Link>
            <Link href={"/reproducibility" as Route}>Reproducibility</Link>
            <Link href={"/solutions/ai-ready-knowledge" as Route}>Solutions</Link>
            <Link href={"/integrations" as Route}>Integrations</Link>
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
          <p className="fine">Interactive product samples are labeled. Capability and evidence details remain available in their technical records.</p>
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

function OpeningWorldField({ band, mode }: { band: string; mode: WorldMode }) {
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setTimeout(() => setOpened(true), 900);
    return () => window.clearTimeout(timer);
  }, []);

  return <WorldField mode={band === "scatter" && opened ? "ingest" : mode} />;
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
  film,
  children,
}: {
  id: number;
  band: BandName;
  eyebrow: string;
  title: React.ReactNode;
  /*
    A film scene stacks instead of splitting.

    The two-column body puts a 380px title beside the content, which is right for prose and
    wrong for a four-up: it left the cut about half the page wide, and at that size the columns
    it is made of stop being readable — the exact failure the wide fixed frame was chosen to
    avoid. So a film scene puts the heading above and gives the frame the full measure.
  */
  film?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="scene" id={`s${id}`} data-scene={id} data-band={band}>
      <div className="shell">
        <div className={film ? "body film-body" : "body"}>
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
